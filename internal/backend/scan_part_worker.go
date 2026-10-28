package backend

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/rabbitmq/amqp091-go"
)

// scanFanoutCollector is the optional collector surface used only when
// GHFIND_SCAN_FANOUT_ENABLED is on. The default worker still calls Collect.
type scanFanoutCollector interface {
	SeedScan(context.Context, string) (scanSeedSignals, githubUser, contributionOverview, *contribStats, float64, *time.Time, error)
	CollectScanPart(context.Context, string, string, bool, githubUser, contributionOverview) (scanPartPayload, error)
	assembleCollectedScan(context.Context, bool, githubUser, contributionOverview, *contribStats, float64, *time.Time, map[string]scanPartPayload) (ScanResult, map[string]string, error)
}

// maybeSplitScan seeds the account and, for a heavy plan, publishes part
// jobs. A light plan returns false so the caller keeps the in-process path.
// Search parts share one lane and are published together; consumers still
// run that lane one part at a time because each search part is its own
// message and the parent records them independently. The planner already
// capped the set at maxScanFanoutParts.
func (w *ScanWorker) maybeSplitScan(ctx context.Context, job ScanJob, collector scanFanoutCollector, store ScanPartStore) (bool, error) {
	signals, user, overview, stats, lastYear, latest, err := collector.SeedScan(ctx, job.Username)
	if err != nil {
		return false, err
	}
	// Parent jobs are the quick admission path. Full collection is the
	// in-process deepen step after a partial quick scan, not a fan-out.
	signals.Full = false
	plan := planScanFanout(signals)
	if !plan.Split {
		return false, nil
	}
	var latestRaw *string
	if latest != nil {
		value := latest.UTC().Format(time.RFC3339)
		latestRaw = &value
	}
	seed := scanSeedEnvelope{User: user, Overview: overview, Stats: stats, LastYear: lastYear, LatestEvent: latestRaw, Full: signals.Full, InlineParts: plan.InlineParts}
	parts := plan.parts()
	if err := store.SaveScanParent(ctx, job, signals.Full, parts, seed); err != nil {
		return false, err
	}
	for _, part := range plan.SearchParts {
		if err := w.publisher.PublishScanPart(ctx, ScanPartJob{
			ParentID: job.ID, Username: job.Username, Phase: scanPhasePart, Part: part,
			RequestedAt: job.RequestedAt, Full: signals.Full, Lane: 0,
		}); err != nil {
			return false, err
		}
	}
	for index, part := range plan.ParallelParts {
		if err := w.publisher.PublishScanPart(ctx, ScanPartJob{
			ParentID: job.ID, Username: job.Username, Phase: scanPhasePart, Part: part,
			RequestedAt: job.RequestedAt, Full: signals.Full, Lane: index + 1,
		}); err != nil {
			return false, err
		}
	}
	return true, nil
}

func (w *ScanWorker) consumePartDeliveries(ctx context.Context, deliveries <-chan amqp091.Delivery, concurrency int) error {
	return w.consumeRaw(ctx, deliveries, concurrency, w.handlePartDelivery)
}

func (w *ScanWorker) consumeAssembleDeliveries(ctx context.Context, deliveries <-chan amqp091.Delivery, concurrency int) error {
	return w.consumeRaw(ctx, deliveries, concurrency, w.handleAssembleDelivery)
}

func (w *ScanWorker) consumeRaw(ctx context.Context, deliveries <-chan amqp091.Delivery, concurrency int, handle func(context.Context, amqp091.Delivery)) error {
	semaphore := make(chan struct{}, concurrency)
	var inFlight sync.WaitGroup
	for {
		select {
		case <-ctx.Done():
			inFlight.Wait()
			return nil
		case delivery, open := <-deliveries:
			if !open {
				inFlight.Wait()
				return nil
			}
			semaphore <- struct{}{}
			inFlight.Add(1)
			go func() {
				defer inFlight.Done()
				defer func() { <-semaphore }()
				handle(ctx, delivery)
			}()
		}
	}
}

func (w *ScanWorker) handlePartDelivery(ctx context.Context, delivery amqp091.Delivery) {
	var job ScanPartJob
	if err := json.Unmarshal(delivery.Body, &job); err != nil || job.ParentID == "" || job.Part == "" || job.Username == "" {
		_ = delivery.Reject(false)
		return
	}
	processCtx, cancel := context.WithTimeout(ctx, scanWorkerProcessTimeout)
	disposition, reason := w.processPart(processCtx, job)
	cancel()
	w.finishChildDelivery(ctx, delivery, job.Attempt, disposition, reason, func(nextAttempt int) error {
		job.Attempt = nextAttempt
		return w.publisher.PublishScanPartRetry(ctx, job, retryDelay(job.Attempt))
	}, func(reason string) error {
		return w.publisher.PublishScanPartDead(ctx, job, reason)
	})
}

func (w *ScanWorker) processPart(ctx context.Context, job ScanPartJob) (workerDisposition, string) {
	collector, ok := w.collector.(scanFanoutCollector)
	store, storeOK := w.results.(ScanPartStore)
	if !ok || !storeOK {
		return workerDead, "scan fan-out collector unavailable"
	}
	parent, err := store.LoadScanParent(ctx, job.ParentID)
	if err != nil {
		return workerRetry, err.Error()
	}
	if _, already := parent.Payloads[job.Part]; already {
		if parent.Done {
			return w.publishAssemble(ctx, parent, job)
		}
		return workerCompleted, ""
	}
	payload, err := collector.CollectScanPart(ctx, job.Username, job.Part, parent.Full, parent.Seed.User, parent.Seed.Overview)
	if err != nil {
		if errors.Is(err, ErrGitHubAccountNotFound) || errors.Is(err, ErrGitHubAuthRequired) {
			payload = scanPartPayload{Part: job.Part, Failed: true, Error: err.Error()}
		} else if job.Attempt+1 >= w.config.MaxAttempts {
			payload = scanPartPayload{Part: job.Part, Failed: true, Error: err.Error()}
		} else {
			return workerRetry, err.Error()
		}
	}
	_, done, err := store.SaveScanPart(ctx, job, payload)
	if err != nil {
		return workerRetry, err.Error()
	}
	if !done {
		return workerCompleted, ""
	}
	parent, err = store.LoadScanParent(ctx, job.ParentID)
	if err != nil {
		return workerRetry, err.Error()
	}
	return w.publishReady(ctx, parent, job)
}

// publishReady emits the dependent part once the independent parts are in,
// then the assemble job once dependents are in too.
func (w *ScanWorker) publishReady(ctx context.Context, parent scanParentRecord, job ScanPartJob) (workerDisposition, string) {
	if _, ok := parent.Payloads[scanPartDependents]; !ok && containsPart(parent.Parts, scanPartDependents) && job.Part != scanPartDependents {
		independentDone := true
		for _, part := range parent.Parts {
			if part == scanPartDependents {
				continue
			}
			if _, present := parent.Payloads[part]; !present {
				independentDone = false
				break
			}
		}
		if independentDone {
			err := w.publisher.PublishScanPart(ctx, ScanPartJob{
				ParentID: job.ParentID, Username: job.Username, Phase: scanPhasePart, Part: scanPartDependents,
				RequestedAt: job.RequestedAt, Full: parent.Full,
			})
			if err != nil {
				return workerRetry, err.Error()
			}
			return workerCompleted, ""
		}
	}
	if parent.Done {
		return w.publishAssemble(ctx, parent, job)
	}
	return workerCompleted, ""
}

func (w *ScanWorker) publishAssemble(ctx context.Context, parent scanParentRecord, job ScanPartJob) (workerDisposition, string) {
	err := w.publisher.PublishScanAssemble(ctx, ScanAssembleJob{
		ParentID: parent.ID, Username: parent.Username, Phase: scanPhaseAssemble,
		RequestedAt: job.RequestedAt, Full: parent.Full,
	})
	if err != nil {
		return workerRetry, err.Error()
	}
	return workerCompleted, ""
}

func (w *ScanWorker) handleAssembleDelivery(ctx context.Context, delivery amqp091.Delivery) {
	var job ScanAssembleJob
	if err := json.Unmarshal(delivery.Body, &job); err != nil || job.ParentID == "" || job.Username == "" {
		_ = delivery.Reject(false)
		return
	}
	processCtx, cancel := context.WithTimeout(ctx, scanWorkerProcessTimeout)
	disposition, reason := w.processAssemble(processCtx, job)
	cancel()
	w.finishChildDelivery(ctx, delivery, job.Attempt, disposition, reason, func(nextAttempt int) error {
		job.Attempt = nextAttempt
		return w.publisher.PublishScanAssembleRetry(ctx, job, retryDelay(job.Attempt))
	}, func(reason string) error {
		return w.publisher.PublishScanAssembleDead(ctx, job, reason)
	})
}

func (w *ScanWorker) processAssemble(ctx context.Context, job ScanAssembleJob) (workerDisposition, string) {
	collector, ok := w.collector.(scanFanoutCollector)
	store, storeOK := w.results.(ScanPartStore)
	if !ok || !storeOK {
		return workerDead, "scan fan-out collector unavailable"
	}
	parent, err := store.LoadScanParent(ctx, job.ParentID)
	if err != nil {
		return workerRetry, err.Error()
	}
	if !parent.Done {
		return workerRetry, "scan parts incomplete"
	}
	for _, part := range parent.Seed.InlineParts {
		if _, present := parent.Payloads[part]; present {
			continue
		}
		payload, err := collector.CollectScanPart(ctx, parent.Username, part, parent.Full, parent.Seed.User, parent.Seed.Overview)
		if err != nil {
			payload = scanPartPayload{Part: part, Failed: true, Error: err.Error()}
		}
		parent.Payloads[part] = payload
	}
	var latest *time.Time
	if parent.Seed.LatestEvent != nil {
		parsed, parseErr := time.Parse(time.RFC3339, *parent.Seed.LatestEvent)
		if parseErr == nil {
			latest = &parsed
		}
	}
	scan, sources, err := collector.assembleCollectedScan(ctx, parent.Full, parent.Seed.User, parent.Seed.Overview, parent.Seed.Stats, parent.Seed.LastYear, latest, parent.Payloads)
	if err != nil {
		return workerRetry, err.Error()
	}
	scan.SourceStatus = mergedSourceStatus(scan, sources)
	return w.persistFinishedScan(ctx, job.asScanJob(), scan)
}

func (w *ScanWorker) persistFinishedScan(ctx context.Context, job ScanJob, scan ScanResult) (workerDisposition, string) {
	startedAt := time.Now()
	created, err := w.results.PersistCollectedScan(ctx, job, scan)
	if errors.Is(err, ErrScanJobConflict) {
		w.metrics.recordWorkerJobFailed(ScanJobKind, "conflict", time.Since(startedAt))
		return workerDead, err.Error()
	}
	if err != nil {
		w.metrics.recordWorkerJobRetry(ScanJobKind, time.Since(startedAt))
		return workerRetry, err.Error()
	}
	if w.scanCache != nil {
		if err := w.scanCache.SetCachedScan(ctx, scan.Metrics.Username, scan); err != nil {
			w.log.Warn("cache collected scan", "job_id", job.ID, "error", err)
		}
	}
	if created {
		recordSuccessfulScanOutcome(ctx, w.outcomes, w.lookupGate, w.revisions, scan.Metrics.Username, job.LookupHash, job.Campaign, time.Now().UTC())
	}
	completed := newScanJobStatus(job, JobCompleted, "")
	if !created {
		completed.Error = "duplicate_delivery"
	}
	if err := w.statuses.Put(ctx, completed); err != nil {
		return workerRetry, "status store unavailable: " + err.Error()
	}
	return workerCompleted, ""
}

func (w *ScanWorker) finishChildDelivery(ctx context.Context, delivery amqp091.Delivery, attempt int, disposition workerDisposition, reason string, retry func(int) error, dead func(string) error) {
	switch disposition {
	case workerCompleted:
		_ = delivery.Ack(false)
	case workerRetry:
		next := attempt + 1
		if next >= w.config.MaxAttempts {
			if err := dead(reason); err != nil {
				_ = delivery.Nack(false, true)
				return
			}
			_ = delivery.Ack(false)
			return
		}
		if err := retry(next); err != nil {
			_ = delivery.Nack(false, true)
			return
		}
		_ = delivery.Ack(false)
	case workerDead:
		if err := dead(reason); err != nil {
			_ = delivery.Nack(false, true)
			return
		}
		_ = delivery.Ack(false)
	}
}

func containsPart(parts []string, want string) bool {
	for _, part := range parts {
		if part == want {
			return true
		}
	}
	return false
}
