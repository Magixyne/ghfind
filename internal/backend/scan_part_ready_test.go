package backend

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type failingReadyPublisher struct {
	recordingScanPublisher
	failPart     bool
	failAssemble bool
}

func (p *failingReadyPublisher) PublishScanPart(ctx context.Context, job ScanPartJob) error {
	if p.failPart && job.Part == scanPartDependents {
		return errors.New("fiction publish failed")
	}
	return p.recordingScanPublisher.PublishScanPart(ctx, job)
}

func (p *failingReadyPublisher) PublishScanAssemble(ctx context.Context, job ScanAssembleJob) error {
	if p.failAssemble {
		return errors.New("fiction assemble failed")
	}
	return p.recordingScanPublisher.PublishScanAssemble(ctx, job)
}

func readyParent(t *testing.T, store *TursoStore) scanParentRecord {
	t.Helper()
	job := ScanJob{ID: "fiction-ready-" + t.Name(), Username: "fiction-ready", RequestedAt: 1}
	if err := store.SaveScanParent(context.Background(), job, false, []string{scanPartRepos, scanPartDependents}, scanSeedEnvelope{}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.SaveScanPart(context.Background(), ScanPartJob{ParentID: job.ID, Username: job.Username, Part: scanPartRepos}, scanPartPayload{Part: scanPartRepos}); err != nil {
		t.Fatal(err)
	}
	parent, err := store.LoadScanParent(context.Background(), job.ID)
	if err != nil {
		t.Fatal(err)
	}
	return parent
}

func TestPublishFailureReleasesClaimForRedelivery(t *testing.T) {
	store := openScanPersistenceStore(t)
	publisher := &failingReadyPublisher{failPart: true}
	worker := NewScanWorker(Config{MaxAttempts: 3, ScanFanoutEnabled: true}, &fakeScanCollector{}, store, &fakeStatusStore{}, publisher, nil)
	parent := readyParent(t, store)
	part := ScanPartJob{ParentID: parent.ID, Username: parent.Username, Part: scanPartRepos, RequestedAt: 1}
	disposition, reason := worker.publishReady(context.Background(), parent, part)
	if disposition != workerRetry || reason == "" {
		t.Fatalf("first: %v %s", disposition, reason)
	}
	if len(publisher.parts) != 0 {
		t.Fatalf("failed publish recorded %+v", publisher.parts)
	}
	publisher.failPart = false
	disposition, reason = worker.publishReady(context.Background(), parent, part)
	if disposition != workerCompleted || reason != "" {
		t.Fatalf("redelivery: %v %s", disposition, reason)
	}
	if len(publisher.parts) != 1 || publisher.parts[0].Part != scanPartDependents {
		t.Fatalf("dependents=%+v", publisher.parts)
	}
	if _, _, err := store.SaveScanPart(context.Background(), ScanPartJob{ParentID: parent.ID, Username: parent.Username, Part: scanPartDependents}, scanPartPayload{Part: scanPartDependents}); err != nil {
		t.Fatal(err)
	}
	parent, err := store.LoadScanParent(context.Background(), parent.ID)
	if err != nil || !parent.Done {
		t.Fatalf("parent done=%v err=%v", parent.Done, err)
	}
	publisher.failAssemble = true
	assemblePart := ScanPartJob{ParentID: parent.ID, Username: parent.Username, Part: scanPartDependents, RequestedAt: 1}
	disposition, reason = worker.publishAssemble(context.Background(), parent, assemblePart)
	if disposition != workerRetry || reason == "" {
		t.Fatalf("assemble fail: %v %s", disposition, reason)
	}
	publisher.failAssemble = false
	disposition, reason = worker.publishAssemble(context.Background(), parent, assemblePart)
	if disposition != workerCompleted || len(publisher.assembles) != 1 {
		t.Fatalf("assemble redelivery: %v %s count=%d", disposition, reason, len(publisher.assembles))
	}
}

func TestExpiredClaimIsReclaimed(t *testing.T) {
	store := openScanPersistenceStore(t)
	parent := readyParent(t, store)
	now := time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC)
	claimed, err := store.claimReadyPublish(context.Background(), parent.ID, scanPartDependents, now)
	if err != nil || !claimed {
		t.Fatalf("claim=%v err=%v", claimed, err)
	}
	again, err := store.claimReadyPublish(context.Background(), parent.ID, scanPartDependents, now.Add(time.Minute))
	if err != nil || again {
		t.Fatalf("fresh claim reclaimed=%v err=%v", again, err)
	}
	later := now.Add(scanReadyLease())
	reclaimed, err := store.claimReadyPublish(context.Background(), parent.ID, scanPartDependents, later)
	if err != nil || !reclaimed {
		t.Fatalf("expired reclaim=%v err=%v", reclaimed, err)
	}
	publisher := &recordingScanPublisher{}
	redeliveredAt := later.Add(scanReadyLease())
	collector := &GitHubCollector{clock: func() time.Time { return redeliveredAt }}
	worker := NewScanWorker(Config{MaxAttempts: 3, ScanFanoutEnabled: true}, collector, store, &fakeStatusStore{}, publisher, nil)
	disposition, reason := worker.publishReady(context.Background(), parent, ScanPartJob{ParentID: parent.ID, Username: parent.Username, Part: scanPartRepos, RequestedAt: 1})
	if disposition != workerCompleted || len(publisher.parts) != 1 {
		t.Fatalf("redelivery after crash: %v %s parts=%d", disposition, reason, len(publisher.parts))
	}
}

func TestPublishedClaimDoesNotRepublish(t *testing.T) {
	store := openScanPersistenceStore(t)
	publisher := &recordingScanPublisher{}
	worker := NewScanWorker(Config{MaxAttempts: 3, ScanFanoutEnabled: true}, &fakeScanCollector{}, store, &fakeStatusStore{}, publisher, nil)
	parent := readyParent(t, store)
	part := ScanPartJob{ParentID: parent.ID, Username: parent.Username, Part: scanPartRepos, RequestedAt: 1}
	disposition, reason := worker.publishReady(context.Background(), parent, part)
	if disposition != workerCompleted || len(publisher.parts) != 1 {
		t.Fatalf("first publish: %v %s", disposition, reason)
	}
	disposition, reason = worker.publishReady(context.Background(), parent, part)
	if disposition != workerCompleted || len(publisher.parts) != 1 {
		t.Fatalf("redelivery republished: %v %s count=%d", disposition, reason, len(publisher.parts))
	}
}

func TestConcurrentReadyPublishClaimsOnce(t *testing.T) {
	store := openScanPersistenceStore(t)
	publisher := &recordingScanPublisher{}
	worker := NewScanWorker(Config{MaxAttempts: 3, ScanFanoutEnabled: true}, &fakeScanCollector{}, store, &fakeStatusStore{}, publisher, nil)
	parent := readyParent(t, store)
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			disposition, reason := worker.publishReady(context.Background(), parent, ScanPartJob{ParentID: parent.ID, Username: parent.Username, Part: scanPartRepos, RequestedAt: 1})
			if disposition != workerCompleted || reason != "" {
				t.Errorf("publish: %v %s", disposition, reason)
			}
		}()
	}
	wg.Wait()
	if len(publisher.parts) != 1 {
		t.Fatalf("published %d dependents", len(publisher.parts))
	}
}
