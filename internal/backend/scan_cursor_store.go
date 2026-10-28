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

// ScanCursorStore keeps one watermark book per user. The table is created
// on first use and does not change public_scan_runs or historical snapshots.
type ScanCursorStore interface {
	EnsureScanCursorSchema(context.Context) error
	LoadScanCursors(context.Context, string) (scanCursorBook, error)
	SaveScanCursors(context.Context, scanCursorBook) error
}

func (s *TursoStore) EnsureScanCursorSchema(ctx context.Context) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("scan cursor store unavailable")
	}
	_, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS scan_source_cursors (
      username TEXT PRIMARY KEY,
      book TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
	if err != nil {
		return fmt.Errorf("ensure scan cursor table: %w", err)
	}
	return nil
}

// LoadScanCursors returns an empty book when the user has no row. A row
// that does not decode is returned as a corrupt watermark so the caller
// reconciles instead of trusting a partial book.
func (s *TursoStore) LoadScanCursors(ctx context.Context, username string) (scanCursorBook, error) {
	empty := scanCursorBook{Username: strings.ToLower(username), Sources: map[string]scanCursorWatermark{}}
	if err := s.EnsureScanCursorSchema(ctx); err != nil {
		return empty, err
	}
	var raw string
	err := s.db.QueryRowContext(ctx, `SELECT book FROM scan_source_cursors WHERE username = ?`, strings.ToLower(username)).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return empty, nil
	}
	if err != nil {
		return empty, fmt.Errorf("read scan cursors: %w", err)
	}
	var book scanCursorBook
	if err := json.Unmarshal([]byte(raw), &book); err != nil {
		book = empty
		book.Sources[scanCursorRepos] = scanCursorWatermark{Source: scanCursorRepos, Watermark: "corrupt"}
		return book, nil
	}
	if book.Sources == nil {
		book.Sources = map[string]scanCursorWatermark{}
	}
	book.Username = strings.ToLower(username)
	return book, nil
}

func (s *TursoStore) SaveScanCursors(ctx context.Context, book scanCursorBook) error {
	if err := s.EnsureScanCursorSchema(ctx); err != nil {
		return err
	}
	book.Username = strings.ToLower(book.Username)
	if book.Sources == nil {
		book.Sources = map[string]scanCursorWatermark{}
	}
	encoded, err := encodeCursorBook(book)
	if err != nil {
		return fmt.Errorf("encode scan cursors: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO scan_source_cursors (username, book, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        book = excluded.book,
        updated_at = excluded.updated_at`,
		book.Username, string(encoded), time.Now().UTC().UnixMilli())
	if err != nil {
		return fmt.Errorf("save scan cursors: %w", err)
	}
	return nil
}
