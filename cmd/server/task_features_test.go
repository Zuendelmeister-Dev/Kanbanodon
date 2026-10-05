package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func featureRequest(s *server, id int64, action, method, body string, actor user) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	s.ticketAction(rec, httptest.NewRequest(method, fmt.Sprintf("/api/tickets/%d%s", id, action), strings.NewReader(body)), actor)
	return rec
}

func TestChecklistTrashRestoreAndArchivePreserveTaskData(t *testing.T) {
	s := newTestServer(t)
	id := createTestTicket(t, s, `{"Title":"Checklist","Extras":{"Checklist":[{"Text":"Prepare","Done":true},{"Text":"Review","Done":false}],"RepeatDays":7}}`)
	if _, err := s.db.Exec("insert into comments(ticket_id,user_id,body,created_at) values(?,1,'Keep this comment',?)", id, now()); err != nil {
		t.Fatal(err)
	}
	actor := user{ID: 1, IsAdmin: true}
	for _, action := range []string{"/archive", "/trash", "/restore"} {
		rec := featureRequest(s, id, action, http.MethodPost, "{}", actor)
		if rec.Code != 200 {
			t.Fatalf("%s: %d %s", action, rec.Code, rec.Body.String())
		}
		var stored ticket
		for _, item := range mustLoadTickets(t, s, 1) {
			if item.ID == id {
				stored = item
			}
		}
		if stored.Extras == nil || len(stored.Extras.Checklist) != 2 || !stored.Extras.Checklist[0].Done || stored.Extras.RepeatDays != 7 {
			t.Fatalf("lost checklist: %#v", stored)
		}
		if action == "/archive" && stored.ArchivedAt == "" {
			t.Fatal("not archived")
		}
		if action == "/trash" && stored.DeletedAt == "" {
			t.Fatal("not trashed")
		}
		if action == "/restore" && (stored.DeletedAt != "" || stored.ArchivedAt != "") {
			t.Fatal("not restored")
		}
	}
	var count int
	s.db.QueryRow("select count(*) from comments where ticket_id=?", id).Scan(&count)
	if count != 1 {
		t.Fatal("restore lost comments")
	}
}

func TestDuplicateTaskResetsProgressAndDoesNotCopyComments(t *testing.T) {
	s := newTestServer(t)
	id := createTestTicket(t, s, `{"Title":"Original","Body":"Context","DueDate":"2030-01-01","Labels":["repeatable"],"Extras":{"Checklist":[{"Text":"Step","Done":true}],"RepeatDays":7}}`)
	rec := featureRequest(s, id, "/duplicate", http.MethodPost, "{}", user{ID: 1, IsAdmin: true})
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	var result struct{ ID int64 }
	json.Unmarshal(rec.Body.Bytes(), &result)
	for _, item := range mustLoadTickets(t, s, 1) {
		if item.ID == result.ID {
			if item.Title != "Original (copy)" || item.Body != "Context" || item.Extras.RepeatDays != 0 || item.Extras.Checklist[0].Done || item.DueDate != "" || len(item.Labels) != 1 {
				t.Fatalf("invalid copy: %#v", item)
			}
			return
		}
	}
	t.Fatal("copy missing")
}

func TestRepeatingCompletionIsAtomicAndResetsChecklist(t *testing.T) {
	s := newTestServer(t)
	id := createTestTicket(t, s, `{"Title":"Weekly","Extras":{"Checklist":[{"Text":"Finish","Done":true}],"RepeatDays":7}}`)
	var done int64
	s.db.QueryRow("select id from columns where board_id=1 and name='Done'").Scan(&done)
	body := fmt.Sprintf(`{"Title":"Weekly","ColumnID":%d}`, done) // Legacy updates preserve extras.
	var wg sync.WaitGroup
	responses := make(chan *httptest.ResponseRecorder, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			responses <- featureRequest(s, id, "", http.MethodPut, body, user{ID: 1, IsAdmin: true})
		}()
	}
	wg.Wait()
	close(responses)
	for rec := range responses {
		if rec.Code != 200 {
			t.Fatal(rec.Code, rec.Body.String())
		}
	}
	tasks := mustLoadTickets(t, s, 1)
	if len(tasks) != 2 {
		t.Fatalf("expected exactly one next occurrence, got %d tickets", len(tasks))
	}
	for _, item := range tasks {
		if item.ID != id && (item.Extras.Checklist[0].Done || item.DueDate == "" || item.CompletedAt != "" || item.ColumnID == done || item.Extras.RepeatDays != 7) {
			t.Fatalf("bad recurrence: %#v", item)
		}
	}
}

func TestFeatureActionsRequireBoardAccessAndMentionsStayPrivate(t *testing.T) {
	s := newTestServer(t)
	recipient := insertTestUser(t, s, "colleague", "Colleague", "colleague@example.test")
	outsider := insertTestUser(t, s, "outsider", "Outsider", "outsider@example.test")
	if err := s.setBoardAccess(1, recipient, true); err != nil {
		t.Fatal(err)
	}
	id := createTestTicket(t, s, fmt.Sprintf(`{"Title":"Team task","AssigneeID":%d}`, recipient))
	for _, action := range []string{"/duplicate", "/archive", "/trash", "/restore"} {
		rec := featureRequest(s, id, action, http.MethodPost, "{}", user{ID: outsider})
		if rec.Code != 403 {
			t.Fatalf("outsider can %s: %d", action, rec.Code)
		}
	}
	rec := featureRequest(s, id, "/comments", http.MethodPost, `{"Body":"@colleague please review @colleague and @outsider"}`, user{ID: 1, IsAdmin: true})
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	items := mustNotificationRows(t, s, user{ID: recipient})
	if len(items) != 2 {
		t.Fatalf("assignment and one mention expected, got %#v", items)
	}
	if len(mustNotificationRows(t, s, user{ID: outsider})) != 0 {
		t.Fatal("mention exposed private task")
	}
	if err := s.setBoardAccess(1, recipient, false); err != nil {
		t.Fatal(err)
	}
	if len(mustNotificationRows(t, s, user{ID: recipient})) != 0 {
		t.Fatal("revoked access still exposes notification")
	}
	read := httptest.NewRecorder()
	s.readNotifications(read, httptest.NewRequest(http.MethodPost, "/api/notifications/read", strings.NewReader(`{"ID":0}`)), user{ID: outsider})
	var unread int
	s.db.QueryRow("select count(*) from notifications where user_id=? and read_at=''", recipient).Scan(&unread)
	if unread != 2 {
		t.Fatal("outsider marked another user's notifications read")
	}
}

func TestTaskExtrasRejectInvalidInputAndExportRoundTrip(t *testing.T) {
	s := newTestServer(t)
	for _, payload := range []string{`{"Title":"Bad","Extras":{"RepeatDays":-1}}`, `{"Title":"Bad","Extras":{"Checklist":[{"Text":" "}]}}`} {
		rec := httptest.NewRecorder()
		s.createTicket(rec, httptest.NewRequest(http.MethodPost, "/api/tickets", strings.NewReader(payload)), user{ID: 1, IsAdmin: true})
		if rec.Code != 400 {
			t.Fatal("accepted invalid extras", rec.Code)
		}
	}
	id := createTestTicket(t, s, `{"Title":"Portable","Extras":{"Checklist":[{"Text":"Keep","Done":true}],"RepeatDays":30}}`)
	featureRequest(s, id, "/archive", http.MethodPost, "{}", user{ID: 1, IsAdmin: true})
	export := httptest.NewRecorder()
	s.export(export, httptest.NewRequest(http.MethodGet, "/api/export?boardId=1", nil), user{ID: 1, IsAdmin: true})
	imp := httptest.NewRecorder()
	s.importData(imp, httptest.NewRequest(http.MethodPost, "/api/import?boardId=1", strings.NewReader(export.Body.String())), user{ID: 1, IsAdmin: true})
	if imp.Code != 200 {
		t.Fatal(imp.Code, imp.Body.String())
	}
	items := mustLoadTickets(t, s, 1)
	if len(items) != 2 || items[1].Extras.RepeatDays != 30 || !items[1].Extras.Checklist[0].Done || items[1].ArchivedAt == "" {
		t.Fatalf("export lost optional features: %#v", items)
	}
}
