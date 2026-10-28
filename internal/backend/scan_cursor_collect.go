package backend

import (
	"context"
	"time"
)

// inventoryCapture carries the owned-original page of the collect running
// on this context, including the fork total. Incremental mode copies that
// page into the cursor table. It stays off the public snapshot.
type inventoryCapture struct {
	Repos     *[]githubRepo
	ForkCount *float64
}

// scanCursorPlan is one source's decision for this scan. Full is a
// reconciliation pull. Since is the watermark an incremental pull stops at.
type scanCursorPlan struct {
	Source string
	Full   bool
	Since  string
	Reason scanReconcileReason
	Prev   scanCursorWatermark
}

// planScanCursors decides each resumable source independently. A missing,
// corrupt, stale, or version-mismatched cursor reconciles that source.
// Other sources may still increment. The clock is the collector clock so
// tests pin age without sleeping.
func planScanCursors(book scanCursorBook, now time.Time) map[string]scanCursorPlan {
	plans := map[string]scanCursorPlan{}
	for _, source := range []string{scanCursorRepos, scanCursorExternal, scanCursorMerged} {
		raw := book.raw(source)
		reason := decideScanReconcile(raw, now)
		plan := scanCursorPlan{Source: source, Full: reason != scanReconcileNone, Reason: reason, Prev: raw}
		if reason == scanReconcileNone {
			plan.Since = raw.Watermark
		}
		plans[source] = plan
	}
	return plans
}

// baselineFromBook rebuilds the previous source pages stored beside the
// watermarks. Incremental merges start from these pages.
func baselineFromBook(book scanCursorBook) scanSnapshotBaseline {
	baseline := scanSnapshotBaseline{}
	if mark, ok := book.source(scanCursorRepos); ok {
		baseline.Repos = append([]githubRepo(nil), mark.Repos...)
		baseline.ForkCount = mark.ForkCount
	}
	if mark, ok := book.source(scanCursorExternal); ok {
		baseline.External = append([]mergedPRNode(nil), mark.Nodes...)
	}
	if mark, ok := book.source(scanCursorMerged); ok {
		baseline.Merged = append([]mergedPRNode(nil), mark.Nodes...)
	}
	return baseline
}

// advanceCursorBook records the merged page for the sources this scan
// touched. A full plan resets that source's incremental streak.
func advanceCursorBook(book scanCursorBook, plans map[string]scanCursorPlan, baseline scanSnapshotBaseline, endCursors map[string]string, now time.Time) scanCursorBook {
	if book.Sources == nil {
		book.Sources = map[string]scanCursorWatermark{}
	}
	for source, plan := range plans {
		var items []scanCursorItem
		switch source {
		case scanCursorRepos:
			items = reposToCursorItems(baseline.Repos)
		case scanCursorExternal:
			items = nodesToCursorItems(baseline.External)
		case scanCursorMerged:
			items = nodesToCursorItems(baseline.Merged)
		default:
			continue
		}
		if len(items) == 0 {
			// No page was observed. Leave the previous watermark in place so
			// a later scan does not treat "now" as the last-seen pushedAt.
			continue
		}
		endCursor := ""
		stable := false
		if endCursors != nil {
			endCursor = endCursors[source]
			stable = endCursor != ""
		}
		book.Sources[source] = cursorWatermarkFromItems(source, items, endCursor, stable, plan.Prev, plan.Full, now)
	}
	return book
}

// collectCursorPart runs one part with the cursor plan for that source.
// Sources without a plan (commits, workflows, dependents) stay on the
// existing full/quick path. The returned bool is whether the pull itself
// was a delta rather than a reconcile.
func (c *GitHubCollector) collectCursorPart(ctx context.Context, username, part string, full bool, seed githubUser, overview contributionOverview, plan scanCursorPlan) (scanPartPayload, bool, error) {
	if plan.Full || plan.Since == "" || full {
		payload, err := c.CollectScanPart(ctx, username, part, full, seed, overview)
		return payload, false, err
	}
	payload := scanPartPayload{Part: part}
	if c == nil || c.github == nil || !c.github.HasToken() {
		return payload, true, ErrGitHubAuthRequired
	}
	login := seed.Login
	if login == "" {
		login = username
	}
	switch part {
	case scanPartRepos:
		repos, forks, incomplete, err := c.github.ownedOriginalInventorySince(ctx, login, full, plan.Since)
		if err != nil {
			return payload, true, err
		}
		payload.Repos = repos
		payload.ForkCount = forks
		payload.ReposIncomplete = incomplete
	case scanPartExternal:
		external, err := c.github.fetchExternalMergedPRsSince(ctx, login, externalMergedPRCap, plan.Since)
		if err != nil {
			return payload, true, err
		}
		if external == nil {
			payload.ExternalMissing = true
			break
		}
		payload.External = external
	case scanPartMerged:
		nodes, err := c.github.fetchMergedPRNodesSince(ctx, login, mergedPRWindow, plan.Since)
		if err != nil {
			return payload, true, err
		}
		payload.WindowNodes = nodes
		if overview.MergedPRCount > float64(mergedPRWindow) {
			payload.MergedIncomplete = true
		}
	default:
		collected, err := c.CollectScanPart(ctx, username, part, full, seed, overview)
		return collected, false, err
	}
	return payload, true, nil
}

// quickCoverageExceeded reports whether an assembled quick scan still owes
// a fullscan under the #582 truncation rules. Incremental mode does not
// invent a second escalation path.
func quickCoverageExceeded(scan ScanResult) bool {
	return scan.Collection != nil && scan.Collection.Mode == "quick" && scan.Collection.Coverage == "partial_public"
}

// collectIncremental merges per-source deltas into the stored cursor pages,
// then scores that merged page with the same finish path as Collect.
// A missing cursor, or a delta that still exceeds quick coverage, falls
// through to Collect / CollectFull so the published row matches a full pull.
func (w *ScanWorker) collectIncremental(ctx context.Context, job ScanJob) (ScanResult, error) {
	collector, ok := w.collector.(*GitHubCollector)
	if !ok {
		return w.collector.Collect(ctx, job.Username)
	}
	store, ok := w.results.(ScanCursorStore)
	if !ok {
		return collector.Collect(ctx, job.Username)
	}
	now := time.Now().UTC()
	if collector.clock != nil {
		now = collector.clock().UTC()
	}
	book, err := store.LoadScanCursors(ctx, job.Username)
	if err != nil {
		return ScanResult{}, err
	}
	plans := planScanCursors(book, now)
	anyIncremental := false
	for _, plan := range plans {
		if !plan.Full && plan.Since != "" {
			anyIncremental = true
			break
		}
	}
	if !anyIncremental {
		var captured []githubRepo
		var forkCount float64
		scan, err := collector.Collect(context.WithValue(ctx, inventoryCapture{}, inventoryCapture{Repos: &captured, ForkCount: &forkCount}), job.Username)
		if err != nil {
			return ScanResult{}, err
		}
		if !quickCoverageExceeded(scan) {
			w.rememberInProcessCursors(ctx, store, job.Username, book, plans, captured, forkCount, now)
		}
		return scan, nil
	}
	_, user, overview, stats, lastYear, latest, err := collector.SeedScan(ctx, job.Username)
	if err != nil {
		return ScanResult{}, err
	}
	baseline := baselineFromBook(book)
	payloads := map[string]scanPartPayload{}
	incrementalParts := map[string]bool{}
	for _, part := range []string{scanPartRepos, scanPartExternal, scanPartMerged, scanPartCommits, scanPartWorkflows} {
		plan := plans[part]
		payload, delta, err := collector.collectCursorPart(ctx, job.Username, part, false, user, overview, plan)
		if err != nil {
			return ScanResult{}, err
		}
		if delta {
			incrementalParts[part] = true
			baseline, payload = applyIncrementalPayload(baseline, payload, false)
		} else {
			baseline = foldPayloadBaseline(baseline, payload)
		}
		payload.Incremental = false
		payloads[part] = payload
	}
	scan, sources, err := collector.assembleCollectedScan(ctx, false, user, overview, stats, lastYear, latest, payloads)
	if err != nil {
		return ScanResult{}, err
	}
	scan.SourceStatus = mergedSourceStatus(scan, sources)
	if quickCoverageExceeded(scan) {
		// Delta left the quick window. #582 deepens with a full collect.
		var captured []githubRepo
		var forkCount float64
		fullScan, fullErr := collector.CollectFull(context.WithValue(ctx, inventoryCapture{}, inventoryCapture{Repos: &captured, ForkCount: &forkCount}), job.Username)
		if fullErr != nil {
			return ScanResult{}, fullErr
		}
		reconcile := map[string]scanCursorPlan{}
		for source, plan := range plans {
			plan.Full = true
			plan.Since = ""
			reconcile[source] = plan
		}
		fullBaseline := baseline
		fullBaseline.Repos = append([]githubRepo(nil), captured...)
		fullBaseline.ForkCount = forkCount
		book = advanceCursorBook(book, reconcile, fullBaseline, nil, now)
		if mark, ok := book.Sources[scanCursorRepos]; ok {
			mark.ForkCount = forkCount
			book.Sources[scanCursorRepos] = mark
		}
		book.Username = job.Username
		if saveErr := store.SaveScanCursors(ctx, book); saveErr != nil {
			return ScanResult{}, saveErr
		}
		return fullScan, nil
	}
	book = advanceCursorBook(book, plans, baseline, nil, now)
	book.Username = job.Username
	if err := store.SaveScanCursors(ctx, book); err != nil {
		return ScanResult{}, err
	}
	return scan, nil
}

// rememberInProcessCursors stores the source pages from a reconcile that
// went through Collect. Only the resumable inventory and PR windows are
// kept; commits and workflows stay on their existing full pull.
func (w *ScanWorker) rememberInProcessCursors(ctx context.Context, store ScanCursorStore, username string, book scanCursorBook, plans map[string]scanCursorPlan, repos []githubRepo, forkCount float64, now time.Time) {
	// Inventory is the page Collect just walked. PR windows stay on the full
	// window until a part scan stores their nodes.
	baseline := scanSnapshotBaseline{Repos: append([]githubRepo(nil), repos...), ForkCount: forkCount}
	book = advanceCursorBook(book, plans, baseline, nil, now)
	if mark, ok := book.Sources[scanCursorRepos]; ok {
		mark.ForkCount = forkCount
		book.Sources[scanCursorRepos] = mark
	}
	book.Username = username
	_ = store.SaveScanCursors(ctx, book)
}
