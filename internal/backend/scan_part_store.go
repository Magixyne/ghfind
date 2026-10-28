package backend

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ScanPartStore is the parent ledger for a split scan. Part rows live beside
// public_scan_runs in the same Turso database. The worker creates the table
// on first use; it does not migrate or rewrite existing scan rows.
type ScanPartStore interface {
	EnsureScanPartSchema(context.Context) error
	SaveScanParent(context.Context, ScanJob, bool, []string, scanSeedEnvelope) error
	SaveScanPart(context.Context, ScanPartJob, scanPartPayload) (bool, bool, error)
	LoadScanParent(context.Context, string) (scanParentRecord, error)
}

type scanSeedEnvelope struct {
	User        githubUser           `json:"user"`
	Overview    contributionOverview `json:"overview"`
	Stats       *contribStats        `json:"stats,omitempty"`
	LastYear    float64              `json:"last_year"`
	LatestEvent *string              `json:"latest_event,omitempty"`
	Full        bool                 `json:"full"`
	// InlineParts are collected once during assemble. They are not queued,
	// so they do not count toward the four-part fan-out cap.
	InlineParts []string `json:"inline_parts,omitempty"`
}

type scanParentRecord struct {
	ID       string
	Username string
	Full     bool
	Parts    []string
	Seed     scanSeedEnvelope
	Payloads map[string]scanPartPayload
	Done     bool
}

func (s *TursoStore) EnsureScanPartSchema(ctx context.Context) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("scan part store unavailable")
	}
	_, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS scan_part_runs (
      parent_id TEXT NOT NULL,
      username TEXT NOT NULL,
      part TEXT NOT NULL,
      state TEXT NOT NULL,
      payload TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (parent_id, part)
    )`)
	if err != nil {
		return fmt.Errorf("ensure scan part table: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS scan_part_parents (
      parent_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      full INTEGER NOT NULL,
      parts TEXT NOT NULL,
      seed TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
	if err != nil {
		return fmt.Errorf("ensure scan parent table: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS scan_part_ready (
      parent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY (parent_id, kind)
    )`)
	if err != nil {
		return fmt.Errorf("ensure scan ready table: %w", err)
	}
	// A table created by the first claim shape has no state. Adding the
	// columns is safe; existing rows become published so they are not
	// published again.
	if _, err = s.db.ExecContext(ctx, `ALTER TABLE scan_part_ready ADD COLUMN state TEXT NOT NULL DEFAULT 'published'`); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
		return fmt.Errorf("ensure scan ready state: %w", err)
	}
	if _, err = s.db.ExecContext(ctx, `ALTER TABLE scan_part_ready ADD COLUMN claimed_at INTEGER NOT NULL DEFAULT 0`); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
		return fmt.Errorf("ensure scan ready claimed_at: %w", err)
	}
	return nil
}

func (s *TursoStore) SaveScanParent(ctx context.Context, job ScanJob, full bool, parts []string, seed scanSeedEnvelope) error {
	if err := s.EnsureScanPartSchema(ctx); err != nil {
		return err
	}
	encodedParts, err := json.Marshal(parts)
	if err != nil {
		return fmt.Errorf("encode scan parts: %w", err)
	}
	encodedSeed, err := json.Marshal(seed)
	if err != nil {
		return fmt.Errorf("encode scan seed: %w", err)
	}
	fullBit := 0
	if full {
		fullBit = 1
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO scan_part_parents
      (parent_id, username, full, parts, seed, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(parent_id) DO UPDATE SET
        username = excluded.username,
        full = excluded.full,
        parts = excluded.parts,
        seed = excluded.seed,
        updated_at = excluded.updated_at`,
		job.ID, strings.ToLower(job.Username), fullBit, string(encodedParts), string(encodedSeed), timeNowMillis())
	if err != nil {
		return fmt.Errorf("save scan parent: %w", err)
	}
	return nil
}

// SaveScanPart records one part. The bool pair is (stored, parentComplete).
// A repeated delivery of a part that already has a payload is stored=false
// and does not overwrite the first result.
func (s *TursoStore) SaveScanPart(ctx context.Context, job ScanPartJob, payload scanPartPayload) (bool, bool, error) {
	if err := s.EnsureScanPartSchema(ctx); err != nil {
		return false, false, err
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return false, false, fmt.Errorf("encode scan part: %w", err)
	}
	state := scanSourceStateComplete
	if payload.Failed {
		state = scanSourceStateFailed
	}
	result, err := s.db.ExecContext(ctx, `INSERT INTO scan_part_runs
      (parent_id, username, part, state, payload, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(parent_id, part) DO NOTHING`,
		job.ParentID, strings.ToLower(job.Username), job.Part, state, string(encoded), timeNowMillis())
	if err != nil {
		return false, false, fmt.Errorf("save scan part: %w", err)
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return false, false, fmt.Errorf("read scan part insert: %w", err)
	}
	parent, err := s.LoadScanParent(ctx, job.ParentID)
	if err != nil {
		return inserted > 0, false, err
	}
	return inserted > 0, parent.Done, nil
}

func (s *TursoStore) LoadScanParent(ctx context.Context, parentID string) (scanParentRecord, error) {
	if err := s.EnsureScanPartSchema(ctx); err != nil {
		return scanParentRecord{}, err
	}
	var record scanParentRecord
	var fullBit int
	var partsRaw, seedRaw string
	err := s.db.QueryRowContext(ctx, `SELECT parent_id, username, full, parts, seed
      FROM scan_part_parents WHERE parent_id = ?`, parentID).Scan(&record.ID, &record.Username, &fullBit, &partsRaw, &seedRaw)
	if errors.Is(err, sql.ErrNoRows) {
		return scanParentRecord{}, fmt.Errorf("scan parent %s: %w", parentID, sql.ErrNoRows)
	}
	if err != nil {
		return scanParentRecord{}, fmt.Errorf("read scan parent: %w", err)
	}
	record.Full = fullBit == 1
	if err := json.Unmarshal([]byte(partsRaw), &record.Parts); err != nil {
		return scanParentRecord{}, fmt.Errorf("decode scan parts: %w", err)
	}
	if err := json.Unmarshal([]byte(seedRaw), &record.Seed); err != nil {
		return scanParentRecord{}, fmt.Errorf("decode scan seed: %w", err)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT part, payload FROM scan_part_runs WHERE parent_id = ?`, parentID)
	if err != nil {
		return scanParentRecord{}, fmt.Errorf("read scan parts: %w", err)
	}
	defer rows.Close()
	record.Payloads = map[string]scanPartPayload{}
	for rows.Next() {
		var part, payloadRaw string
		if err := rows.Scan(&part, &payloadRaw); err != nil {
			return scanParentRecord{}, fmt.Errorf("scan part row: %w", err)
		}
		var payload scanPartPayload
		if err := json.Unmarshal([]byte(payloadRaw), &payload); err != nil {
			return scanParentRecord{}, fmt.Errorf("decode scan part %s: %w", part, err)
		}
		record.Payloads[part] = payload
	}
	if err := rows.Err(); err != nil {
		return scanParentRecord{}, err
	}
	record.Done = len(record.Parts) > 0
	for _, part := range record.Parts {
		if _, ok := record.Payloads[part]; !ok {
			record.Done = false
			break
		}
	}
	return record, nil
}

const (
	scanReadyClaimed   = "claimed"
	scanReadyPublished = "published"
)

// scanReadyLease is how long a claimed publish may stay unpublished before
// another delivery may take it. It is one scan processing timeout, the
// existing bound on a part attempt, not a new production knob.
func scanReadyLease() time.Duration {
	return scanWorkerProcessTimeout
}

// claimReadyPublish marks this parent and kind claimed. A published row is
// left alone. A claim older than the lease may be taken again. The caller
// publishes only when claimed is true, then calls markReadyPublished.
func (s *TursoStore) claimReadyPublish(ctx context.Context, parentID, kind string, now time.Time) (bool, error) {
	if err := s.EnsureScanPartSchema(ctx); err != nil {
		return false, err
	}
	claimedAt := now.UTC().UnixMilli()
	result, err := s.db.ExecContext(ctx, `INSERT INTO scan_part_ready (parent_id, kind, state, claimed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(parent_id, kind) DO NOTHING`,
		parentID, kind, scanReadyClaimed, claimedAt)
	if err != nil {
		return false, fmt.Errorf("claim scan publish: %w", err)
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read scan publish claim: %w", err)
	}
	if inserted > 0 {
		return true, nil
	}
	staleBefore := now.UTC().Add(-scanReadyLease()).UnixMilli()
	result, err = s.db.ExecContext(ctx, `UPDATE scan_part_ready
      SET state = ?, claimed_at = ?
      WHERE parent_id = ? AND kind = ? AND state = ? AND claimed_at <= ?`,
		scanReadyClaimed, claimedAt, parentID, kind, scanReadyClaimed, staleBefore)
	if err != nil {
		return false, fmt.Errorf("reclaim scan publish: %w", err)
	}
	reclaimed, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read scan publish reclaim: %w", err)
	}
	return reclaimed > 0, nil
}

// markReadyPublished records that Publish succeeded. A crash before this
// leaves the row claimed so a later delivery can reclaim it after the lease.
func (s *TursoStore) markReadyPublished(ctx context.Context, parentID, kind string) error {
	if err := s.EnsureScanPartSchema(ctx); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `UPDATE scan_part_ready SET state = ? WHERE parent_id = ? AND kind = ?`,
		scanReadyPublished, parentID, kind)
	if err != nil {
		return fmt.Errorf("mark scan publish: %w", err)
	}
	return nil
}

// releaseReadyPublish drops a claim that did not publish, so the next
// delivery can claim it immediately.
func (s *TursoStore) releaseReadyPublish(ctx context.Context, parentID, kind string) error {
	if err := s.EnsureScanPartSchema(ctx); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM scan_part_ready WHERE parent_id = ? AND kind = ? AND state = ?`,
		parentID, kind, scanReadyClaimed)
	if err != nil {
		return fmt.Errorf("release scan publish: %w", err)
	}
	return nil
}

type scanReadyStore interface {
	claimReadyPublish(context.Context, string, string, time.Time) (bool, error)
	markReadyPublished(context.Context, string, string) error
	releaseReadyPublish(context.Context, string, string) error
}

func (w *ScanWorker) claimReadyPublish(ctx context.Context, parentID, kind string) (bool, error) {
	store, ok := w.results.(scanReadyStore)
	if !ok {
		return true, nil
	}
	now := time.Now().UTC()
	if collector, ok := w.collector.(*GitHubCollector); ok && collector.clock != nil {
		now = collector.clock().UTC()
	}
	return store.claimReadyPublish(ctx, parentID, kind, now)
}

func (w *ScanWorker) finishReadyPublish(ctx context.Context, parentID, kind string, published bool) error {
	store, ok := w.results.(scanReadyStore)
	if !ok {
		return nil
	}
	if published {
		return store.markReadyPublished(ctx, parentID, kind)
	}
	return store.releaseReadyPublish(ctx, parentID, kind)
}

func timeNowMillis() int64 {
	return time.Now().UTC().UnixMilli()
}
