package backend

import (
	"encoding/json"
	"strings"
	"time"
)

// Cursor sources name one independently resumable pull. They line up with
// the Phase 2 part names so a split scan can advance one source at a time.
const (
	scanCursorRepos    = scanPartRepos
	scanCursorExternal = scanPartExternal
	scanCursorMerged   = scanPartMerged
	scanCursorCommits  = scanPartCommits
	scanCursorWorkflow = scanPartWorkflows

	// scanCursorSchemaVersion is the cursor row format, not the public
	// collection version. Collection stays v7 while snapshot and coverage
	// contracts are unchanged.
	scanCursorSchemaVersion = 1
)

// scanCursorWatermark is the newest stable timestamp plus the GraphQL
// endCursor observed while that timestamp was still the page boundary.
// Incremental pulls ask only for items strictly after Watermark. EndCursor
// is recorded when the page that established the watermark was stable
// (no later item shared the same timestamp).
type scanCursorWatermark struct {
	Source          string `json:"source"`
	Watermark       string `json:"watermark,omitempty"`
	EndCursor       string `json:"end_cursor,omitempty"`
	CursorStable    bool   `json:"cursor_stable"`
	Collection      string `json:"collection"`
	IncrementalRuns int    `json:"incremental_runs"`
	ReconciledAt    string `json:"reconciled_at,omitempty"`
	UpdatedAt       string `json:"updated_at,omitempty"`
	// Repos and Nodes are the last merged source page. They stay in the
	// cursor table so a later delta can be merged without rewriting the
	// public snapshot contract.
	Repos []githubRepo   `json:"repos,omitempty"`
	Nodes []mergedPRNode `json:"nodes,omitempty"`
}

func (w scanCursorWatermark) valid() bool {
	if strings.TrimSpace(w.Source) == "" || strings.TrimSpace(w.Watermark) == "" {
		return false
	}
	if _, ok := parseTimestamp(&w.Watermark); !ok {
		return false
	}
	if w.Collection != "" && w.Collection != goCanonicalCollectionVersion {
		return false
	}
	return true
}

// scanCursorBook is the per-user set of source watermarks. A missing or
// unreadable book means the next scan is a full reconciliation.
type scanCursorBook struct {
	Username string                         `json:"username"`
	Sources  map[string]scanCursorWatermark `json:"sources"`
}

func (b scanCursorBook) source(name string) (scanCursorWatermark, bool) {
	if b.Sources == nil {
		return scanCursorWatermark{}, false
	}
	mark, ok := b.Sources[name]
	if !ok || !mark.valid() {
		return scanCursorWatermark{}, false
	}
	return mark, true
}

func (b scanCursorBook) raw(name string) scanCursorWatermark {
	if b.Sources == nil {
		return scanCursorWatermark{}
	}
	return b.Sources[name]
}

// scanReconcileReason says why the next scan must pull the full source
// instead of the cursor delta. Empty means an incremental pull is allowed.
type scanReconcileReason string

const (
	scanReconcileNone     scanReconcileReason = ""
	scanReconcileMissing  scanReconcileReason = "cursor_missing"
	scanReconcileCorrupt  scanReconcileReason = "cursor_corrupt"
	scanReconcileVersion  scanReconcileReason = "collection_version"
	scanReconcileRunCount scanReconcileReason = "incremental_run_count"
	scanReconcileAge      scanReconcileReason = "cursor_age"
)

// scanIncrementalReconcileEveryN is how many successful incremental scans
// may land before the next one re-reads the whole source. The count is
// StatusTTL / #580's 24h manual rescan cooldown: seven days of daily
// rescans, then a full reconcile. It is not tuned per account.
func scanIncrementalReconcileEveryN() int {
	days := int(defaultStatusTTL / roastFreshness)
	if days < 1 {
		return 1
	}
	return days
}

// scanIncrementalReconcileAge is how old a cursor may be before the next
// scan re-reads the source. It is StatusTTL itself (the existing job-status
// freshness window), not a new production knob.
func scanIncrementalReconcileAge() time.Duration {
	return defaultStatusTTL
}

// decideScanReconcile picks a full pull when the cursor is missing, the
// stored collection version is not the current one, the incremental streak
// has reached the derived count, or the cursor is older than StatusTTL.
// A watermark that does not parse is corrupt and also reconciles. A version
// mismatch is checked before validity so a stale collection id is not
// reported as a corrupt timestamp.
func decideScanReconcile(mark scanCursorWatermark, now time.Time) scanReconcileReason {
	if mark.Collection != "" && mark.Collection != goCanonicalCollectionVersion {
		return scanReconcileVersion
	}
	if !mark.valid() {
		if strings.TrimSpace(mark.Watermark) != "" || strings.TrimSpace(mark.EndCursor) != "" {
			return scanReconcileCorrupt
		}
		return scanReconcileMissing
	}
	if mark.IncrementalRuns >= scanIncrementalReconcileEveryN() {
		return scanReconcileRunCount
	}
	anchor := mark.ReconciledAt
	if anchor == "" {
		anchor = mark.UpdatedAt
	}
	if updated, ok := parseTimestamp(&anchor); ok && now.Sub(updated) >= scanIncrementalReconcileAge() {
		return scanReconcileAge
	}
	return scanReconcileNone
}

// cursorAfterWatermark reports whether itemTime is strictly newer than the
// stored watermark. A missing watermark never matches, so the caller falls
// back to the full page.
func cursorAfterWatermark(itemTime, watermark string) bool {
	item, itemOK := parseTimestamp(&itemTime)
	bound, boundOK := parseTimestamp(&watermark)
	if !itemOK || !boundOK {
		return false
	}
	return item.After(bound)
}

func encodeCursorBook(book scanCursorBook) ([]byte, error) {
	if book.Sources == nil {
		book.Sources = map[string]scanCursorWatermark{}
	}
	return json.Marshal(book)
}
