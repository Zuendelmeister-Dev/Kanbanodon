package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
)

func mustLoadTickets(t *testing.T, s *server, boardID int64) []ticket {
	t.Helper()
	items, err := s.loadTickets(boardID)
	if err != nil {
		t.Fatal(err)
	}
	return items
}

func mustRows(t *testing.T, db *sql.DB, query string, args ...any) []map[string]any {
	t.Helper()
	items, err := rows(db, query, args...)
	if err != nil {
		t.Fatal(err)
	}
	return items
}

func mustOne(t *testing.T, db *sql.DB, query string, args ...any) map[string]any {
	t.Helper()
	item, err := one(db, query, args...)
	if err != nil {
		t.Fatal(err)
	}
	return item
}

func mustStrings(t *testing.T, db *sql.DB, query string, args ...any) []string {
	t.Helper()
	items, err := strs(db, query, args...)
	if err != nil {
		t.Fatal(err)
	}
	return items
}

func mustNotificationRows(t *testing.T, s *server, actor user) []map[string]any {
	t.Helper()
	items, err := s.notificationRows(actor)
	if err != nil {
		t.Fatal(err)
	}
	return items
}

func TestDatabaseReadersReturnQueryScanAndIterationErrors(t *testing.T) {
	s := newTestServer(t)
	if items, err := rows(s.db, "select * from missing_table"); err == nil || items != nil {
		t.Fatal("query failure became empty success")
	}
	if item, err := one(s.db, "select * from missing_table"); err == nil || item != nil {
		t.Fatal("single-row query failure became empty success")
	}
	if items, err := strs(s.db, "select null"); err == nil || items != nil {
		t.Fatal("string scan failure became success")
	}
	if items, err := ints(s.db, "select 'not an integer'"); err == nil || items != nil {
		t.Fatal("integer scan failure became success")
	}
	if items, err := rows(s.db, "select 1 as value union all select abs(-9223372036854775808)"); err == nil || items != nil {
		t.Fatal("iteration failure returned a partial result")
	}
	if items, err := ints(s.db, "select 1 union all select abs(-9223372036854775808)"); err == nil || items != nil {
		t.Fatal("integer iteration failure returned a partial result")
	}
	if items, err := strs(s.db, "select 'first' union all select abs(-9223372036854775808)"); err == nil || items != nil {
		t.Fatal("string iteration failure returned a partial result")
	}
}

func TestStateAndExportRejectIncompleteData(t *testing.T) {
	for _, tc := range []struct{ name, damage string }{
		{"ticket query", "alter table tickets rename column extras to damaged_extras"},
		{"ticket scan", "update tickets set duration='invalid'"},
		{"corrupt extras", "update tickets set extras='not json'"},
		{"labels", "drop table ticket_labels"},
		{"links", "drop table ticket_links"},
		{"comments", "drop table comments"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := newTestServer(t)
			createTestTicket(t, s, `{"Title":"Keep existing data"}`)
			if _, err := s.db.Exec(tc.damage); err != nil {
				t.Fatal(err)
			}
			for _, handler := range []func(http.ResponseWriter, *http.Request, user){s.state, s.export} {
				rec := httptest.NewRecorder()
				handler(rec, httptest.NewRequest(http.MethodGet, "/api/state?boardId=1", nil), user{ID: 1, IsAdmin: true})
				if rec.Code != 500 || strings.Contains(rec.Body.String(), `"tickets"`) {
					t.Fatalf("partial snapshot escaped: %d %s", rec.Code, rec.Body.String())
				}
			}
		})
	}
}

func setTestDependencies(s *server, id int64, links ...int64) *httptest.ResponseRecorder {
	column, err := firstCol(s.db, 1)
	if err != nil {
		rec := httptest.NewRecorder()
		rec.WriteHeader(500)
		return rec
	}
	data, _ := json.Marshal(ticket{Title: "Task", ColumnID: column, Links: links})
	return featureRequest(s, id, "", http.MethodPut, string(data), user{ID: 1, IsAdmin: true})
}

func TestDependencyCyclesAreRejectedWithoutChangingStoredLinks(t *testing.T) {
	s := newTestServer(t)
	a := createTestTicket(t, s, `{"Title":"A"}`)
	b := createTestTicket(t, s, `{"Title":"B"}`)
	c := createTestTicket(t, s, `{"Title":"C"}`)
	if rec := setTestDependencies(s, a, b); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	if rec := setTestDependencies(s, b, a); rec.Code != 400 {
		t.Fatal("two-node cycle accepted", rec.Code)
	}
	if links, err := ints(s.db, "select to_ticket_id from ticket_links where from_ticket_id=?", b); err != nil || len(links) != 0 {
		t.Fatal("rejected cycle changed links", links, err)
	}
	if rec := setTestDependencies(s, b, c); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	if rec := setTestDependencies(s, c, a); rec.Code != 400 {
		t.Fatal("long cycle accepted", rec.Code)
	}
	if rec := setTestDependencies(s, a); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	if rec := setTestDependencies(s, c, a); rec.Code != 200 {
		t.Fatal("valid chain rejected", rec.Body.String())
	}
}

func TestConcurrentDependencyChangesCannotIntroduceCycle(t *testing.T) {
	s := newTestServer(t)
	a := createTestTicket(t, s, `{"Title":"A"}`)
	b := createTestTicket(t, s, `{"Title":"B"}`)
	var wg sync.WaitGroup
	results := make(chan int, 2)
	for _, pair := range [][2]int64{{a, b}, {b, a}} {
		wg.Add(1)
		go func(pair [2]int64) { defer wg.Done(); results <- setTestDependencies(s, pair[0], pair[1]).Code }(pair)
	}
	wg.Wait()
	close(results)
	counts := map[int]int{}
	for code := range results {
		counts[code]++
	}
	if counts[200] != 1 || counts[400] != 1 {
		t.Fatalf("expected one committed edge and one rejected cycle: %#v", counts)
	}
}

func TestImportRejectsDependencyCyclesAtomically(t *testing.T) {
	s := newTestServer(t)
	body := `{"state":{"tickets":[{"ID":11,"Title":"A","Links":[12],"Labels":["should roll back"]},{"ID":12,"Title":"B","Links":[11]}]}}`
	rec := httptest.NewRecorder()
	s.importData(rec, httptest.NewRequest(http.MethodPost, "/api/import?boardId=1", strings.NewReader(body)), user{ID: 1, IsAdmin: true})
	if rec.Code != 400 || len(mustLoadTickets(t, s, 1)) != 0 {
		t.Fatal("cyclic import did not roll back", rec.Code, rec.Body.String())
	}
	var count int
	if err := s.db.QueryRow("select count(*) from labels where name='should roll back'").Scan(&count); err != nil || count != 0 {
		t.Fatal("import leaked metadata", count, err)
	}
}

func TestCommentExportRoundTripPreservesBodyDateAndPortableAuthor(t *testing.T) {
	s := newTestServer(t)
	id := createTestTicket(t, s, `{"Title":"Portable"}`)
	if _, err := s.db.Exec("update users set name='Alice' where id=1"); err != nil {
		t.Fatal(err)
	}
	date := "2026-10-04T12:34:56.123456789Z"
	if _, err := s.db.Exec("insert into comments(ticket_id,user_id,body,created_at) values(?,1,?,?)", id, "Context <safe>", date); err != nil {
		t.Fatal(err)
	}
	source := int64(1)
	for pass := 0; pass < 2; pass++ {
		exported := httptest.NewRecorder()
		s.export(exported, httptest.NewRequest(http.MethodGet, "/api/export?boardId="+strconv.FormatInt(source, 10), nil), user{ID: 1, IsAdmin: true})
		if exported.Code != 200 {
			t.Fatal(exported.Code, exported.Body.String())
		}
		destination, err := s.createBoard("Imported", 1)
		if err != nil {
			t.Fatal(err)
		}
		imported := httptest.NewRecorder()
		s.importData(imported, httptest.NewRequest(http.MethodPost, "/api/import?boardId="+strconv.FormatInt(destination, 10), strings.NewReader(exported.Body.String())), user{ID: 1, IsAdmin: true})
		if imported.Code != 200 {
			t.Fatal(imported.Code, imported.Body.String())
		}
		var author, body, created string
		var userID int64
		if err := s.db.QueryRow("select c.author_name,c.body,c.created_at,c.user_id from comments c join tickets t on t.id=c.ticket_id where t.board_id=?", destination).Scan(&author, &body, &created, &userID); err != nil {
			t.Fatal(err)
		}
		if author != "Alice" || body != "Context <safe>" || created != date || userID != 0 {
			t.Fatalf("comment changed or mapped to another account: %q %q %q %d", author, body, created, userID)
		}
		source = destination
	}
}

func TestImportUnknownCommentTicketRollsBack(t *testing.T) {
	s := newTestServer(t)
	rec := httptest.NewRecorder()
	s.importData(rec, httptest.NewRequest(http.MethodPost, "/api/import?boardId=1", strings.NewReader(`{"state":{"tickets":[{"ID":1,"Title":"A"}],"comments":[{"ticketId":999,"body":"Orphan"}]}}`)), user{ID: 1, IsAdmin: true})
	if rec.Code != 400 || len(mustLoadTickets(t, s, 1)) != 0 {
		t.Fatal("orphan comment import did not roll back", rec.Code, rec.Body.String())
	}
}

func TestReopeningAndRecompletingCreatesNextOccurrenceEachTime(t *testing.T) {
	s := newTestServer(t)
	id := createTestTicket(t, s, `{"Title":"Daily","Extras":{"RepeatDays":1}}`)
	var done int64
	if err := s.db.QueryRow("select id from columns where board_id=1 and name='Done'").Scan(&done); err != nil {
		t.Fatal(err)
	}
	first, err := firstCol(s.db, 1)
	if err != nil {
		t.Fatal(err)
	}
	for _, column := range []int64{done, first, done} {
		rec := featureRequest(s, id, "", http.MethodPut, fmt.Sprintf(`{"Title":"Daily","ColumnID":%d}`, column), user{ID: 1, IsAdmin: true})
		if rec.Code != 200 {
			t.Fatal(rec.Code, rec.Body.String())
		}
	}
	if tasks := mustLoadTickets(t, s, 1); len(tasks) != 3 {
		t.Fatalf("two completions must create two occurrences, got %d tasks", len(tasks))
	}
}

func TestNotificationsEndpointMethodsAndReadFailure(t *testing.T) {
	s := newTestServer(t)
	colleague := insertTestUser(t, s, "notify", "Colleague", "notify@example.test")
	if err := s.setBoardAccess(1, colleague, true); err != nil {
		t.Fatal(err)
	}
	createTestTicket(t, s, fmt.Sprintf(`{"Title":"Assigned","AssigneeID":%d}`, colleague))
	rec := httptest.NewRecorder()
	s.notifications(rec, httptest.NewRequest(http.MethodGet, "/api/notifications", nil), user{ID: colleague})
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Assigned to you") {
		t.Fatal(rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	s.notifications(rec, httptest.NewRequest(http.MethodPost, "/api/notifications", nil), user{ID: colleague})
	if rec.Code != 405 {
		t.Fatal("notifications accepted wrong method")
	}
	if _, err := s.db.Exec("drop table notifications"); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	s.notifications(rec, httptest.NewRequest(http.MethodGet, "/api/notifications", nil), user{ID: colleague})
	if rec.Code != 500 {
		t.Fatal("notifications read failure became success", rec.Code)
	}
}

func TestDefaultColumnQueryFailureCannotCreateTask(t *testing.T) {
	s := newTestServer(t)
	if _, err := s.db.Exec("drop table columns"); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	s.createTicket(rec, httptest.NewRequest(http.MethodPost, "/api/tickets", strings.NewReader(`{"Title":"Must not save"}`)), user{ID: 1, IsAdmin: true})
	if rec.Code != 500 || len(mustLoadTickets(t, s, 1)) != 0 {
		t.Fatal("column failure created a malformed task", rec.Code, rec.Body.String())
	}
}

func TestLegacyCyclesDoNotBlockUnrelatedWorkOrRepair(t *testing.T) {
	s := newTestServer(t)
	a := createTestTicket(t, s, `{"Title":"Old A"}`)
	b := createTestTicket(t, s, `{"Title":"Old B"}`)
	c := createTestTicket(t, s, `{"Title":"Old C"}`)
	d := createTestTicket(t, s, `{"Title":"Old D"}`)
	for _, edge := range [][2]int64{{a, b}, {b, a}, {c, d}, {d, c}} {
		if _, err := s.db.Exec("insert into ticket_links(from_ticket_id,to_ticket_id) values(?,?)", edge[0], edge[1]); err != nil {
			t.Fatal(err)
		}
	}
	other := createTestTicket(t, s, `{"Title":"Unrelated new task"}`)
	if rec := setTestDependencies(s, other); rec.Code != 200 {
		t.Fatal("legacy cycles blocked unrelated work", rec.Body.String())
	}
	if rec := setTestDependencies(s, a); rec.Code != 200 {
		t.Fatal("another legacy cycle blocked repair", rec.Body.String())
	}
	if rec := setTestDependencies(s, c); rec.Code != 200 {
		t.Fatal("could not repair old cycle", rec.Body.String())
	}
	imported := httptest.NewRecorder()
	s.importData(imported, httptest.NewRequest(http.MethodPost, "/api/import?boardId=1", strings.NewReader(`{"state":{"tickets":[{"ID":101,"Title":"Independent","Links":[]}]}}`)), user{ID: 1, IsAdmin: true})
	if imported.Code != 200 {
		t.Fatal(imported.Code, imported.Body.String())
	}
}

func TestImportedSelfDependencyIsRejected(t *testing.T) {
	s := newTestServer(t)
	rec := httptest.NewRecorder()
	s.importData(rec, httptest.NewRequest(http.MethodPost, "/api/import?boardId=1", strings.NewReader(`{"state":{"tickets":[{"ID":101,"Title":"Self","Links":[101]}]}}`)), user{ID: 1, IsAdmin: true})
	if rec.Code != 400 || len(mustLoadTickets(t, s, 1)) != 0 {
		t.Fatal("self-dependent import accepted", rec.Code, rec.Body.String())
	}
}

func TestNotificationAccessIsFilteredBeforeLimitAndReadErrorsPropagate(t *testing.T) {
	s := newTestServer(t)
	colleague := insertTestUser(t, s, "notifylimit", "Colleague", "notifylimit@example.test")
	if err := s.setBoardAccess(1, colleague, true); err != nil {
		t.Fatal(err)
	}
	createTestTicket(t, s, fmt.Sprintf(`{"Title":"Visible","AssigneeID":%d}`, colleague))
	private, err := s.createBoard("Private", 1)
	if err != nil {
		t.Fatal(err)
	}
	id := createTestTicket(t, s, fmt.Sprintf(`{"BoardID":%d,"Title":"Private"}`, private))
	for i := 0; i < 101; i++ {
		if _, err := s.db.Exec("insert into notifications(user_id,ticket_id,body,created_at) values(?,?,'No access',?)", colleague, id, now()); err != nil {
			t.Fatal(err)
		}
	}
	items := mustNotificationRows(t, s, user{ID: colleague})
	if len(items) != 1 || items[0]["title"] != "Visible" {
		t.Fatalf("inaccessible notifications displaced permitted ones: %#v", items)
	}
	if _, err := s.db.Exec("drop table board_users"); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	s.notifications(rec, httptest.NewRequest(http.MethodGet, "/api/notifications", nil), user{ID: colleague})
	if rec.Code != 500 {
		t.Fatal("permission query failure became empty success", rec.Code, rec.Body.String())
	}
}
