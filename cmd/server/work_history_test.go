package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type historyTestItem struct {
	ID, TicketID, BoardID, ParentID, EpicID                                      int64
	Ref, Title, Type, ParentRef, ParentTitle, EpicRef, EpicTitle                 string
	StartedAt, CompletedAt, PlannedStartDate, PlannedDueDate, Source, ArchivedAt string
}

func historyTestRows(t *testing.T, s *server, board int64) []historyTestItem {
	t.Helper()
	rec := httptest.NewRecorder()
	s.history(rec, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/history?boardId=%d", board), nil), user{ID: 1, IsAdmin: true})
	if rec.Code != http.StatusOK {
		t.Fatalf("history: %d %s", rec.Code, rec.Body)
	}
	var payload struct{ Items []historyTestItem }
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	return payload.Items
}

func historyTestUpdate(t *testing.T, s *server, id int64, change func(*ticket)) *httptest.ResponseRecorder {
	t.Helper()
	var item ticket
	for _, current := range mustLoadTickets(t, s, 1) {
		if current.ID == id {
			item = current
			break
		}
	}
	if item.ID == 0 {
		t.Fatal("test ticket missing")
	}
	change(&item)
	body, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	s.ticketAction(rec, httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/tickets/%d", id), bytes.NewReader(body)), user{ID: 1, IsAdmin: true})
	return rec
}

func historyTestStatus(t *testing.T, s *server, id, column int64) {
	t.Helper()
	if rec := historyTestUpdate(t, s, id, func(item *ticket) { item.ColumnID = column }); rec.Code != http.StatusOK {
		t.Fatalf("set status: %d %s", rec.Code, rec.Body)
	}
}

func TestHistoryActualLifecycleAndImmutableSnapshots(t *testing.T) {
	s := newTestServer(t)
	ep := createTestTicket(t, s, `{"Title":"Original Epic","Type":"epic","Ref":"E4"}`)
	story := createTestTicket(t, s, fmt.Sprintf(`{"Title":"Original story","Type":"story","Ref":"4","ParentID":%d}`, ep))
	progress, done, ready := testColumnID(t, s, "In Progress"), testColumnID(t, s, "Done"), testColumnID(t, s, "Ready")
	id := createTestTicket(t, s, fmt.Sprintf(`{"Title":"Original work","Type":"task","Ref":"4.1","ParentID":%d,"ColumnID":%d,"StartDate":"2020-01-01","DueDate":"2020-01-02","StartedAt":"1999-01-01T00:00:00Z","CompletedAt":"1999-01-02T00:00:00Z"}`, story, progress))
	items := mustLoadTickets(t, s, 1)
	var actualStart string
	for _, item := range items {
		if item.ID == id {
			actualStart = item.StartedAt
		}
	}
	if _, err := time.Parse(time.RFC3339Nano, actualStart); err != nil || actualStart == "1999-01-01T00:00:00Z" {
		t.Fatalf("actual start must be server observed, got %q", actualStart)
	}
	if len(historyTestRows(t, s, 1)) != 0 {
		t.Fatal("unfinished work is not completion history")
	}
	historyTestStatus(t, s, id, done)
	first := historyTestRows(t, s, 1)
	if len(first) != 1 {
		t.Fatalf("want one completion, got %#v", first)
	}
	old := first[0]
	if old.Title != "Original work" || old.Ref != "4.1" || old.ParentID != story || old.ParentRef != "4" || old.ParentTitle != "Original story" || old.EpicID != ep || old.EpicRef != "E4" || old.EpicTitle != "Original Epic" || old.StartedAt != actualStart || old.PlannedStartDate != "2020-01-01" || old.PlannedDueDate != "2020-01-02" || old.Source != "recorded" {
		t.Fatalf("incorrect completion snapshot: %#v", old)
	}
	if rec := historyTestUpdate(t, s, id, func(item *ticket) {
		item.Title = "Edited work"
		item.Ref = "8.2"
		item.DueDate = "2099-01-01"
		item.CompletedAt = "1999-01-01T00:00:00Z"
		item.StartedAt = "1999-01-01T00:00:00Z"
	}); rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body)
	}
	if rec := historyTestUpdate(t, s, ep, func(item *ticket) { item.Title = "Renamed Epic" }); rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body)
	}
	if got := historyTestRows(t, s, 1); len(got) != 1 || got[0] != old {
		t.Fatalf("done edits changed history: %#v", got)
	}
	historyTestStatus(t, s, id, ready)
	for _, item := range mustLoadTickets(t, s, 1) {
		if item.ID == id && (item.StartedAt != "" || item.CompletedAt != "") {
			t.Fatalf("reopen must reset current episode: %#v", item)
		}
	}
	if got := historyTestRows(t, s, 1); len(got) != 1 || got[0] != old {
		t.Fatalf("reopen erased history: %#v", got)
	}
	historyTestStatus(t, s, id, progress)
	historyTestStatus(t, s, id, done)
	second := historyTestRows(t, s, 1)
	if len(second) != 2 || second[0].ID == old.ID || second[0].CompletedAt == old.CompletedAt || second[0].StartedAt == old.StartedAt || second[0].Title != "Edited work" || second[0].EpicTitle != "Renamed Epic" || second[1] != old {
		t.Fatalf("recompletion must make another snapshot: %#v", second)
	}
}

func TestHistoryArchiveTrashRestoreAndPermanentDelete(t *testing.T) {
	s := newTestServer(t)
	id := createTestTicket(t, s, fmt.Sprintf(`{"Title":"Completed","ColumnID":%d}`, testColumnID(t, s, "Done")))
	admin := user{ID: 1, IsAdmin: true}
	if rec := featureRequest(s, id, "/archive", http.MethodPost, "{}", admin); rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body)
	}
	if got := historyTestRows(t, s, 1); len(got) != 1 || got[0].ArchivedAt == "" {
		t.Fatalf("archive lost completed history: %#v", got)
	}
	if rec := featureRequest(s, id, "/trash", http.MethodPost, "{}", admin); rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body)
	}
	if got := historyTestRows(t, s, 1); len(got) != 0 {
		t.Fatalf("trash appears in history: %#v", got)
	}
	if rec := featureRequest(s, id, "/restore", http.MethodPost, "{}", admin); rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body)
	}
	if got := historyTestRows(t, s, 1); len(got) != 1 {
		t.Fatalf("restore duplicated/lost history: %#v", got)
	}
	if rec := featureRequest(s, id, "", http.MethodDelete, "", admin); rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body)
	}
	var count int
	if err := s.db.QueryRow("select count(*) from work_history where ticket_id=?", id).Scan(&count); err != nil || count != 0 {
		t.Fatalf("permanent deletion retained snapshot: %d %v", count, err)
	}
}

func TestHistoryBoardAuthorizationAndReadOnlyMethod(t *testing.T) {
	s := newTestServer(t)
	other, err := s.createBoard("Private", 1)
	if err != nil {
		t.Fatal(err)
	}
	var otherDone int64
	if err := s.db.QueryRow("select id from columns where board_id=? and name='Done'", other).Scan(&otherDone); err != nil {
		t.Fatal(err)
	}
	createTestTicket(t, s, fmt.Sprintf(`{"BoardID":%d,"ColumnID":%d,"Title":"Private completion"}`, other, otherDone))
	viewer := insertTestUser(t, s, "history-viewer", "History viewer", "history@example.test")
	if err := s.setBoardAccess(1, viewer, true); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{fmt.Sprint(other), "-1", "garbage"} {
		rec := httptest.NewRecorder()
		s.history(rec, httptest.NewRequest(http.MethodGet, "/api/history?boardId="+raw, nil), user{ID: viewer})
		if rec.Code != 403 || strings.Contains(rec.Body.String(), "Private completion") {
			t.Fatalf("unauthorized history leaked: %d %s", rec.Code, rec.Body)
		}
	}
	if got := historyTestRows(t, s, 1); len(got) != 0 {
		t.Fatalf("cross-board history: %#v", got)
	}
	if got := historyTestRows(t, s, other); len(got) != 1 || got[0].BoardID != other {
		t.Fatalf("missing scoped history: %#v", got)
	}
	rec := httptest.NewRecorder()
	s.history(rec, httptest.NewRequest(http.MethodPost, "/api/history?boardId=1", nil), user{ID: 1, IsAdmin: true})
	if rec.Code != 405 {
		t.Fatalf("history mutation allowed: %d", rec.Code)
	}
}

func TestEpicCompletionRequiresNestedActiveWorkAndReopenBeforeChangingScope(t *testing.T) {
	s := newTestServer(t)
	done, ready := testColumnID(t, s, "Done"), testColumnID(t, s, "Ready")
	ep := createTestTicket(t, s, `{"Title":"Release Epic","Type":"epic","Ref":"E1"}`)
	story := createTestTicket(t, s, fmt.Sprintf(`{"Title":"Finish story","Type":"story","Ref":"2","ParentID":%d}`, ep))
	child := createTestTicket(t, s, fmt.Sprintf(`{"Title":"Nested work","Ref":"2.1","ParentID":%d}`, story))
	backlog := createTestTicket(t, s, fmt.Sprintf(`{"Title":"Future wish","ParentID":%d,"IsBacklog":true}`, ep))
	archived := createTestTicket(t, s, fmt.Sprintf(`{"Title":"Archived work","ParentID":%d}`, ep))
	trashed := createTestTicket(t, s, fmt.Sprintf(`{"Title":"Trashed work","ParentID":%d}`, ep))
	featureRequest(s, archived, "/archive", http.MethodPost, "{}", user{ID: 1, IsAdmin: true})
	featureRequest(s, trashed, "/trash", http.MethodPost, "{}", user{ID: 1, IsAdmin: true})
	rec := historyTestUpdate(t, s, ep, func(item *ticket) { item.ColumnID = done })
	if rec.Code != 409 || !strings.Contains(rec.Body.String(), "#2 Finish story") || !strings.Contains(rec.Body.String(), "#2.1 Nested work") || strings.Contains(rec.Body.String(), "Future wish") || strings.Contains(rec.Body.String(), "Archived work") || strings.Contains(rec.Body.String(), "Trashed work") {
		t.Fatalf("wrong completion blockers: %d %s", rec.Code, rec.Body)
	}
	if got := historyTestRows(t, s, 1); len(got) != 0 {
		t.Fatalf("rejected epic completion leaked history: %#v", got)
	}
	historyTestStatus(t, s, story, done)
	historyTestStatus(t, s, child, done)
	historyTestStatus(t, s, ep, done)
	if got := historyTestRows(t, s, 1); len(got) != 3 {
		t.Fatalf("expected story/task/epic completion, got %#v", got)
	}
	for _, change := range []struct {
		id   int64
		edit func(*ticket)
	}{
		{backlog, func(item *ticket) { item.IsBacklog = false }},
		{child, func(item *ticket) { item.ColumnID = ready }},
	} {
		if rec := historyTestUpdate(t, s, change.id, change.edit); rec.Code != 409 {
			t.Fatalf("unfinished scope under completed Epic allowed: %d %s", rec.Code, rec.Body)
		}
	}
	if rec := moveTestRequest(s, child, fmt.Sprintf(`{"ColumnID":%d}`, ready)); rec.Code != 409 {
		t.Fatalf("Board move reopened child of closed Epic: %d %s", rec.Code, rec.Body)
	}
	if rec := featureRequest(s, archived, "/restore", http.MethodPost, "{}", user{ID: 1, IsAdmin: true}); rec.Code != 409 {
		t.Fatalf("restore reopened scope of closed Epic: %d %s", rec.Code, rec.Body)
	}
	create := httptest.NewRecorder()
	s.createTicket(create, httptest.NewRequest(http.MethodPost, "/api/tickets", strings.NewReader(fmt.Sprintf(`{"Title":"New unfinished child","ParentID":%d}`, ep))), user{ID: 1, IsAdmin: true})
	if create.Code != 409 {
		t.Fatalf("adding unfinished child to completed Epic allowed: %d %s", create.Code, create.Body)
	}
	createTestTicket(t, s, fmt.Sprintf(`{"Title":"Another future wish","ParentID":%d,"IsBacklog":true}`, ep))
	historyTestStatus(t, s, ep, ready)
	if rec := moveTestRequest(s, child, fmt.Sprintf(`{"ColumnID":%d}`, ready)); rec.Code != 200 {
		t.Fatalf("reopened Epic still blocks starting work: %d %s", rec.Code, rec.Body)
	}
	empty := createTestTicket(t, s, `{"Title":"Empty Epic","Type":"epic"}`)
	historyTestStatus(t, s, empty, done)
}

func TestHistoryCompletionAndRepeatRemainOneAtomicEpisode(t *testing.T) {
	s := newTestServer(t)
	done := testColumnID(t, s, "Done")
	id := createTestTicket(t, s, `{"Title":"Repeat work","Extras":{"RepeatDays":7}}`)
	for range 2 {
		if rec := moveTestRequest(s, id, fmt.Sprintf(`{"ColumnID":%d}`, done)); rec.Code != 200 {
			t.Fatal(rec.Code, rec.Body)
		}
	}
	if got := historyTestRows(t, s, 1); len(got) != 1 || got[0].StartedAt != "" {
		t.Fatalf("completion without observed start must be one point: %#v", got)
	}
	var repeats int
	if err := s.db.QueryRow("select count(*) from ticket_repetitions where ticket_id=?", id).Scan(&repeats); err != nil || repeats != 1 {
		t.Fatalf("repetition = %d %v", repeats, err)
	}
	blocked := createTestTicket(t, s, fmt.Sprintf(`{"Title":"Blocked repeat","Links":[%d],"Extras":{"RepeatDays":7}}`, createTestTicket(t, s, `{"Title":"Unfinished prerequisite"}`)))
	if rec := moveTestRequest(s, blocked, fmt.Sprintf(`{"ColumnID":%d}`, done)); rec.Code != 409 {
		t.Fatal(rec.Code, rec.Body)
	}
	if got := historyTestRows(t, s, 1); len(got) != 1 {
		t.Fatalf("rejected completion leaked snapshot: %#v", got)
	}
}

func TestHistoryLegacyMigrationAndDemoCleanup(t *testing.T) {
	s := newTestServer(t)
	id := createTestTicket(t, s, `{"Title":"Legacy done","StartDate":"2000-01-01","DueDate":"2000-01-02"}`)
	if _, err := s.db.Exec("update tickets set completed_at=?,column_id=? where id=?", "2000-01-03T12:00:00Z", testColumnID(t, s, "Done"), id); err != nil {
		t.Fatal(err)
	}
	if err := s.migrateWorkHistory(); err != nil {
		t.Fatal(err)
	}
	old := historyTestRows(t, s, 1)
	if len(old) != 1 || old[0].StartedAt != "" || old[0].Source != "legacy" || old[0].CompletedAt != "2000-01-03T12:00:00Z" {
		t.Fatalf("legacy snapshot fabricated timing: %#v", old)
	}
	if _, err := s.db.Exec("update tickets set title='New label',due_date='2099-01-01' where id=?", id); err != nil {
		t.Fatal(err)
	}
	if err := s.migrateWorkHistory(); err != nil {
		t.Fatal(err)
	}
	if got := historyTestRows(t, s, 1); len(got) != 1 || got[0] != old[0] {
		t.Fatalf("migration rewrote immutable snapshot: %#v", got)
	}
	if _, err := s.prepareDemoData(true, true, time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	got := historyTestRows(t, s, 1)
	if len(got) != 8 {
		t.Fatalf("want 1 demo Epic + 7 completed demo tasks, got %#v", got)
	}
	for _, item := range got {
		if item.Source != "demo" || item.StartedAt != "" || item.Title == "Legacy done" {
			t.Fatalf("incorrect demo snapshot: %#v", item)
		}
	}
	if _, err := s.prepareDemoData(true, false, time.Now()); err != nil {
		t.Fatal(err)
	}
	if got := historyTestRows(t, s, 1); len(got) != 0 {
		t.Fatalf("clear left history: %#v", got)
	}
}

func TestHistoryImportCompletionSnapshotAndEpicValidationAreAtomic(t *testing.T) {
	s := newTestServer(t)
	bad := `{"state":{"columns":[{"id":7,"name":"Done"},{"id":8,"name":"To Do"}],"tickets":[{"ID":1,"Type":"epic","Title":"Closed import","ColumnID":7},{"ID":2,"Title":"Open child","ParentID":1,"ColumnID":8}]}}`
	rec := httptest.NewRecorder()
	s.importData(rec, httptest.NewRequest(http.MethodPost, "/api/import?boardId=1", strings.NewReader(bad)), user{ID: 1, IsAdmin: true})
	if rec.Code != 409 || len(mustLoadTickets(t, s, 1)) != 0 || len(historyTestRows(t, s, 1)) != 0 {
		t.Fatalf("invalid Epic import was not atomic: %d %s", rec.Code, rec.Body)
	}
	good := `{"state":{"columns":[{"id":7,"name":"Done"},{"id":8,"name":"To Do"}],"tickets":[{"ID":1,"Type":"epic","Title":"Closed import","Ref":"E9","ColumnID":7,"CompletedAt":"2020-01-03T12:00:00Z"},{"ID":2,"Title":"Done child","ParentID":1,"ColumnID":7,"StartedAt":"1999-01-01T00:00:00Z","DueDate":"2020-01-02","CompletedAt":"2020-01-03T11:00:00Z"},{"ID":3,"Title":"Backlog wish","ParentID":1,"IsBacklog":true,"ColumnID":8}]}}`
	rec = httptest.NewRecorder()
	s.importData(rec, httptest.NewRequest(http.MethodPost, "/api/import?boardId=1", strings.NewReader(good)), user{ID: 1, IsAdmin: true})
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body)
	}
	got := historyTestRows(t, s, 1)
	if len(got) != 2 || got[0].Source != "import" || got[0].CompletedAt != "2020-01-03T12:00:00Z" || got[1].StartedAt != "" || got[1].EpicTitle != "Closed import" || got[1].EpicRef != "E9" || got[1].PlannedDueDate != "2020-01-02" {
		t.Fatalf("bad imported factual snapshots: %#v", got)
	}
}

func TestHistoryCustomWorkflowDoesNotInferCompletionFromLastColumn(t *testing.T) {
	s := newTestServer(t)
	done := testColumnID(t, s, "Done")
	if _, err := s.db.Exec("update columns set name='Deployment' where id=?", done); err != nil {
		t.Fatal(err)
	}
	id := createTestTicket(t, s, `{"Title":"Deploy task"}`)
	historyTestStatus(t, s, id, done)
	if got := historyTestRows(t, s, 1); len(got) != 0 {
		t.Fatalf("custom last column invented completion: %#v", got)
	}
	if _, err := s.db.Exec("update columns set name='  dOnE  ' where id=?", done); err != nil {
		t.Fatal(err)
	}
	historyTestStatus(t, s, id, done)
	if got := historyTestRows(t, s, 1); len(got) != 1 {
		t.Fatalf("trimmed Done did not complete: %#v", got)
	}
}

func TestHistoryLegacyInProgressEditDoesNotInventActualStart(t *testing.T) {
	s := newTestServer(t)
	id := createTestTicket(t, s, `{"Title":"Already underway","StartDate":"2000-01-01"}`)
	if _, err := s.db.Exec("update tickets set column_id=? where id=?", testColumnID(t, s, "In Progress"), id); err != nil {
		t.Fatal(err)
	}
	if rec := historyTestUpdate(t, s, id, func(item *ticket) { item.Title = "Edited underway" }); rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body)
	}
	historyTestStatus(t, s, id, testColumnID(t, s, "Done"))
	if got := historyTestRows(t, s, 1); len(got) != 1 || got[0].StartedAt != "" {
		t.Fatalf("editing old In Progress work invented actual start: %#v", got)
	}
}

func TestHistoryCompletionRollbackIncludesSnapshotAndObservedStart(t *testing.T) {
	s := newTestServer(t)
	id := createTestTicket(t, s, `{"Title":"Repeat atomically","Extras":{"RepeatDays":7}}`)
	// Fail after the completion snapshot has been inserted, during repeat
	// creation. Every effect must roll back with the status mutation.
	if _, err := s.db.Exec(`create trigger reject_repeat before insert on ticket_repetitions begin select raise(abort,'repeat failure'); end`); err != nil {
		t.Fatal(err)
	}
	if rec := historyTestUpdate(t, s, id, func(item *ticket) { item.ColumnID = testColumnID(t, s, "Done") }); rec.Code != 500 {
		t.Fatalf("want failed repeat, got %d %s", rec.Code, rec.Body)
	}
	if got := historyTestRows(t, s, 1); len(got) != 0 {
		t.Fatalf("failed completion leaked snapshot: %#v", got)
	}
	if got := mustLoadTickets(t, s, 1); len(got) != 1 || got[0].CompletedAt != "" || got[0].StartedAt != "" || got[0].ColumnID != testColumnID(t, s, "To Do") {
		t.Fatalf("failed completion changed workflow: %#v", got)
	}
	if _, err := s.db.Exec(`create trigger reject_start before insert on ticket_activity when new.body='Changed status' begin select raise(abort,'activity failure'); end`); err != nil {
		t.Fatal(err)
	}
	if rec := historyTestUpdate(t, s, id, func(item *ticket) { item.ColumnID = testColumnID(t, s, "In Progress") }); rec.Code != 500 {
		t.Fatalf("want failed start, got %d %s", rec.Code, rec.Body)
	}
	if got := mustLoadTickets(t, s, 1); got[0].StartedAt != "" || got[0].ColumnID != testColumnID(t, s, "To Do") {
		t.Fatalf("rejected start persisted observed timestamp: %#v", got)
	}
}

func TestHistoryConcurrentCompletionIsIdempotentAndReadFailureIsReported(t *testing.T) {
	s := newTestServer(t)
	id := createTestTicket(t, s, `{"Title":"Complete once","Extras":{"RepeatDays":1}}`)
	body := fmt.Sprintf(`{"Title":"Complete once","ColumnID":%d}`, testColumnID(t, s, "Done"))
	var group sync.WaitGroup
	responses := make(chan *httptest.ResponseRecorder, 2)
	for range 2 {
		group.Add(1)
		go func() {
			defer group.Done()
			responses <- featureRequest(s, id, "", http.MethodPut, body, user{ID: 1, IsAdmin: true})
		}()
	}
	group.Wait()
	close(responses)
	for rec := range responses {
		if rec.Code != 200 {
			t.Fatal(rec.Code, rec.Body)
		}
	}
	if got := historyTestRows(t, s, 1); len(got) != 1 {
		t.Fatalf("concurrent completion duplicated history: %#v", got)
	}
	if _, err := s.db.Exec("drop table work_history"); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	s.history(rec, httptest.NewRequest(http.MethodGet, "/api/history?boardId=1", nil), user{ID: 1, IsAdmin: true})
	if rec.Code != 500 || strings.Contains(rec.Body.String(), "no such table") {
		t.Fatalf("history must fail closed without diagnostics: %d %s", rec.Code, rec.Body)
	}
}
