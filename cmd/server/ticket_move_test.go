package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func moveTestTask(t *testing.T, s *server, column int64, position int, parent int64) int64 {
	t.Helper()
	return createTestTicket(t, s, fmt.Sprintf(`{"Title":"Task %d","Type":"task","ColumnID":%d,"Position":%d,"ParentID":%d}`, position, column, position, parent))
}

func moveTestRequest(s *server, id int64, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	s.withUser(s.ticketAction).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/tickets/%d/move", id), strings.NewReader(body)))
	return rec
}

func moveTestAssertOrder(t *testing.T, s *server, column int64, want []int64) {
	t.Helper()
	items := mustLoadTickets(t, s, 1)
	var ordered []ticket
	for _, item := range items {
		if item.ColumnID == column && boardMoveEligible(item) {
			ordered = append(ordered, item)
		}
	}
	sort.Slice(ordered, func(i, j int) bool { return boardMoveLess(ordered[i], ordered[j]) })
	got := []int64{}
	for i, item := range ordered {
		got = append(got, item.ID)
		if item.Position != i+1 {
			t.Fatalf("ticket %d position = %d; want %d", item.ID, item.Position, i+1)
		}
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("column order = %v; want %v", got, want)
	}
}

func TestBoardMoveSameColumnFirstMiddleLastAndNoOp(t *testing.T) {
	s := newTestServer(t)
	column := testColumnID(t, s, "To Do")
	a, b, c := moveTestTask(t, s, column, 1, 0), moveTestTask(t, s, column, 2, 0), moveTestTask(t, s, column, 3, 0)
	for _, step := range []struct {
		id   int64
		body string
		want []int64
	}{
		{c, fmt.Sprintf(`{"ColumnID":%d,"BeforeID":%d}`, column, a), []int64{c, a, b}},
		{c, fmt.Sprintf(`{"ColumnID":%d,"AfterID":%d}`, column, a), []int64{a, c, b}},
		{a, fmt.Sprintf(`{"ColumnID":%d}`, column), []int64{c, b, a}},
		{a, fmt.Sprintf(`{"ColumnID":%d,"AfterID":%d}`, column, b), []int64{c, b, a}},
	} {
		if rec := moveTestRequest(s, step.id, step.body); rec.Code != http.StatusOK {
			t.Fatalf("move failed: %d %s", rec.Code, rec.Body)
		}
		moveTestAssertOrder(t, s, column, step.want)
	}
	var activities int
	if err := s.db.QueryRow("select count(*) from ticket_activity where body='Changed Board order'").Scan(&activities); err != nil {
		t.Fatal(err)
	}
	if activities != 3 {
		t.Fatalf("want one activity for each actual reorder and none for no-op, got %d", activities)
	}
}

func TestBoardMoveSecondTaskToThirdDonePositionKeepsTaskData(t *testing.T) {
	s := newTestServer(t)
	toDo, done := testColumnID(t, s, "To Do"), testColumnID(t, s, "Done")
	ep := createTestTicket(t, s, `{"Title":"Epic","Type":"epic"}`)
	var source, destination []int64
	for i := 1; i <= 5; i++ {
		source = append(source, moveTestTask(t, s, toDo, i, ep))
		destination = append(destination, moveTestTask(t, s, done, i, ep))
	}
	before := mustLoadTickets(t, s, 1)
	if rec := moveTestRequest(s, source[1], fmt.Sprintf(`{"ColumnID":%d,"BeforeID":%d}`, done, destination[2])); rec.Code != http.StatusOK {
		t.Fatalf("move failed: %d %s", rec.Code, rec.Body)
	}
	moveTestAssertOrder(t, s, toDo, []int64{source[0], source[2], source[3], source[4]})
	moveTestAssertOrder(t, s, done, []int64{destination[0], destination[1], source[1], destination[2], destination[3], destination[4]})
	var old, moved ticket
	for _, item := range before {
		if item.ID == source[1] {
			old = item
		}
	}
	for _, item := range mustLoadTickets(t, s, 1) {
		if item.ID == source[1] {
			moved = item
		}
	}
	if moved.CompletedAt == "" || moved.ParentID != old.ParentID || moved.Title != old.Title || moved.Ref != old.Ref || !reflect.DeepEqual(moved.Links, old.Links) || !reflect.DeepEqual(moved.Extras, old.Extras) {
		t.Fatalf("move changed task metadata or missed completion: before=%#v after=%#v", old, moved)
	}
}

func TestBoardMoveVisibleAnchorPreservesHiddenTasks(t *testing.T) {
	s := newTestServer(t)
	column := testColumnID(t, s, "To Do")
	ids := []int64{}
	for i := 1; i <= 5; i++ {
		ids = append(ids, moveTestTask(t, s, column, i, 0))
	}
	// A filtered UI shows only 1 and 4; dropping after 4 must not append after 5.
	if rec := moveTestRequest(s, ids[0], fmt.Sprintf(`{"ColumnID":%d,"AfterID":%d}`, column, ids[3])); rec.Code != 200 {
		t.Fatal(rec.Body)
	}
	moveTestAssertOrder(t, s, column, []int64{ids[1], ids[2], ids[3], ids[0], ids[4]})
}

func TestBoardMoveNaturalImportReferenceTiesKeepExistingNeighbors(t *testing.T) {
	s := newTestServer(t)
	column, source := testColumnID(t, s, "To Do"), testColumnID(t, s, "Ready")
	refs := []string{"A10", "A2", "1.1", "1.01", "A0002", "A90071992547409930", "A90071992547409929", "İ2", "i2"}
	var ids []int64
	for _, ref := range refs {
		ids = append(ids, createTestTicket(t, s, fmt.Sprintf(`{"Title":"Import %s","Ref":"%s","Position":0,"ColumnID":%d}`, ref, ref, column)))
	}
	// These ties match the client comparator: equal numeric runs use stable IDs.
	ordered := []ticket{}
	for _, item := range mustLoadTickets(t, s, 1) {
		if item.ColumnID == column {
			ordered = append(ordered, item)
		}
	}
	sort.Slice(ordered, func(i, j int) bool { return boardMoveLess(ordered[i], ordered[j]) })
	got := []int64{}
	for _, item := range ordered {
		got = append(got, item.ID)
	}
	want := []int64{ids[2], ids[3], ids[1], ids[4], ids[0], ids[6], ids[5], ids[8], ids[7]}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("natural import refs: got %v; want %v", got, want)
	}
	moved := moveTestTask(t, s, source, 1, 0)
	if rec := moveTestRequest(s, moved, fmt.Sprintf(`{"ColumnID":%d,"BeforeID":%d}`, column, ids[0])); rec.Code != 200 {
		t.Fatal(rec.Body)
	}
	moveTestAssertOrder(t, s, column, []int64{ids[2], ids[3], ids[1], ids[4], moved, ids[0], ids[6], ids[5], ids[8], ids[7]})
}

func TestBoardMoveRejectsOtherLaneBoardAndUnavailableTasks(t *testing.T) {
	s := newTestServer(t)
	column := testColumnID(t, s, "To Do")
	a := moveTestTask(t, s, column, 1, 0)
	ep := createTestTicket(t, s, `{"Title":"Epic","Type":"epic"}`)
	foreignLane := moveTestTask(t, s, column, 1, ep)
	bid, err := s.createBoard("Other", 1)
	if err != nil {
		t.Fatal(err)
	}
	var foreignColumn int64
	if err := s.db.QueryRow("select id from columns where board_id=? order by position limit 1", bid).Scan(&foreignColumn); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{
		fmt.Sprintf(`{"ColumnID":%d,"BeforeID":%d}`, column, foreignLane),
		fmt.Sprintf(`{"ColumnID":%d}`, foreignColumn),
		fmt.Sprintf(`{"ColumnID":%d,"BeforeID":999999}`, column),
		fmt.Sprintf(`{"ColumnID":%d,"BeforeID":%d}`, column, a),
		fmt.Sprintf(`{"ColumnID":%d,"BeforeID":%d,"AfterID":%d}`, column, a, foreignLane),
	} {
		rec := moveTestRequest(s, a, body)
		if rec.Code != 400 && rec.Code != 409 {
			t.Fatalf("invalid move succeeded: %d %s", rec.Code, rec.Body)
		}
	}
	for _, field := range []string{"archived_at", "deleted_at", "is_backlog"} {
		value := "'gone'"
		if field == "is_backlog" {
			value = "1"
		}
		if _, err := s.db.Exec("update tickets set "+field+"="+value+" where id=?", a); err != nil {
			t.Fatal(err)
		}
		if rec := moveTestRequest(s, a, fmt.Sprintf(`{"ColumnID":%d}`, column)); rec.Code != 409 {
			t.Fatalf("unavailable task moved: %d", rec.Code)
		}
		if _, err := s.db.Exec("update tickets set archived_at='',deleted_at='',is_backlog=0 where id=?", a); err != nil {
			t.Fatal(err)
		}
	}
	if rec := moveTestRequest(s, ep, fmt.Sprintf(`{"ColumnID":%d}`, column)); rec.Code != 409 {
		t.Fatalf("Epic moved through task endpoint: %d", rec.Code)
	}
}

func TestBoardMoveDependenciesRejectsStatusAtomicallyButAllowsReorder(t *testing.T) {
	s := newTestServer(t)
	toDo, done := testColumnID(t, s, "To Do"), testColumnID(t, s, "Done")
	dependency := moveTestTask(t, s, toDo, 1, 0)
	blocked := createTestTicket(t, s, fmt.Sprintf(`{"Title":"Blocked","Position":2,"Links":[%d]}`, dependency))
	other := moveTestTask(t, s, done, 1, 0)
	if rec := moveTestRequest(s, blocked, fmt.Sprintf(`{"ColumnID":%d,"BeforeID":%d}`, done, other)); rec.Code != 409 {
		t.Fatalf("blocked status move result: %d %s", rec.Code, rec.Body)
	}
	moveTestAssertOrder(t, s, toDo, []int64{dependency, blocked})
	moveTestAssertOrder(t, s, done, []int64{other})
	if rec := moveTestRequest(s, blocked, fmt.Sprintf(`{"ColumnID":%d,"BeforeID":%d}`, toDo, dependency)); rec.Code != 200 {
		t.Fatal(rec.Body)
	}
	moveTestAssertOrder(t, s, toDo, []int64{blocked, dependency})
}

func TestBoardMoveSQLFailureRollsBackColumnCompletionAndOrder(t *testing.T) {
	s := newTestServer(t)
	toDo, done := testColumnID(t, s, "To Do"), testColumnID(t, s, "Done")
	a, b := moveTestTask(t, s, toDo, 1, 0), moveTestTask(t, s, done, 1, 0)
	if _, err := s.db.Exec(`create trigger prevent_order before update of position on tickets begin select raise(abort,'test position failure'); end`); err != nil {
		t.Fatal(err)
	}
	if rec := moveTestRequest(s, a, fmt.Sprintf(`{"ColumnID":%d,"BeforeID":%d}`, done, b)); rec.Code != 500 {
		t.Fatalf("expected transaction error: %d %s", rec.Code, rec.Body)
	}
	moveTestAssertOrder(t, s, toDo, []int64{a})
	moveTestAssertOrder(t, s, done, []int64{b})
	var completed string
	if err := s.db.QueryRow("select completed_at from tickets where id=?", a).Scan(&completed); err != nil {
		t.Fatal(err)
	}
	if completed != "" {
		t.Fatal("failed move committed completion")
	}
}

func TestBoardMoveRepeatingDoneTaskCreatesNextOccurrenceOnce(t *testing.T) {
	s := newTestServer(t)
	done := testColumnID(t, s, "Done")
	id := createTestTicket(t, s, `{"Title":"Daily fern check","Position":1,"Extras":{"RepeatDays":2,"Checklist":[{"Text":"Count ferns","Done":true}]}}`)
	for i := 0; i < 2; i++ {
		if rec := moveTestRequest(s, id, fmt.Sprintf(`{"ColumnID":%d}`, done)); rec.Code != 200 {
			t.Fatal(rec.Body)
		}
	}
	var occurrences int
	if err := s.db.QueryRow("select count(*) from ticket_repetitions where ticket_id=?", id).Scan(&occurrences); err != nil {
		t.Fatal(err)
	}
	if occurrences != 1 {
		t.Fatalf("next occurrences = %d; want 1", occurrences)
	}
	items := mustLoadTickets(t, s, 1)
	if len(items) != 2 {
		t.Fatalf("tasks = %d; want completed and next", len(items))
	}
	for _, item := range items {
		if item.ID != id && (item.ColumnID == done || item.Extras.Checklist[0].Done || item.Extras.RepeatDays != 2) {
			t.Fatalf("bad next occurrence: %#v", item)
		}
	}
}

func TestBoardMoveRequiresBoardAccessAndSession(t *testing.T) {
	s := newTestServer(t)
	column := testColumnID(t, s, "To Do")
	id := moveTestTask(t, s, column, 1, 0)
	other := insertTestUser(t, s, "moveguest", "Move guest", "moveguest@example.test")
	rec := httptest.NewRecorder()
	s.ticketAction(rec, httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/tickets/%d/move", id), strings.NewReader(fmt.Sprintf(`{"ColumnID":%d}`, column))), user{ID: other})
	if rec.Code != 403 {
		t.Fatalf("unshared board access: %d", rec.Code)
	}
	s.authMode = "local"
	if rec := moveTestRequest(s, id, fmt.Sprintf(`{"ColumnID":%d}`, column)); rec.Code != 401 {
		t.Fatalf("anonymous move: %d", rec.Code)
	}
}
