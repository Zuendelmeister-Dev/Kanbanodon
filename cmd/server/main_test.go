package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

// newTestServer creates a migrated test server with one accessible board.
func newTestServer(t *testing.T) *server {
	t.Helper()
	s := newBareTestServer(t)
	id, err := s.createBoard("Kanbanodon Board", 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.setBoardAccess(id, 1, true); err != nil {
		t.Fatal(err)
	}
	return s
}

// newBareTestServer creates a migrated test server without sample boards.
func newBareTestServer(t *testing.T) *server {
	t.Helper()
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	cfg, err := sql.Open("sqlite", filepath.Join(dir, "config.db"))
	if err != nil {
		t.Fatal(err)
	}
	cfg.SetMaxOpenConns(1)
	s := &server{db: db, cfg: cfg, authMode: "test", allowSignup: true, secret: []byte("test-secret")}
	if err := s.migrate(); err != nil {
		t.Fatal(err)
	}
	if err := s.seed(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = db.Close()
		_ = cfg.Close()
	})
	return s
}

// TestSeedStartsWithoutDefaultBoard verifies that a fresh database stays empty.
func TestSeedStartsWithoutDefaultBoard(t *testing.T) {
	s := newBareTestServer(t)
	var boards, tickets int
	if err := s.db.QueryRow("select count(*) from boards").Scan(&boards); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow("select count(*) from tickets").Scan(&tickets); err != nil {
		t.Fatal(err)
	}
	if boards != 0 || tickets != 0 {
		t.Fatalf("expected fresh seed to create no boards or tickets, got %d boards and %d tickets", boards, tickets)
	}
}

// TestCreateTicketRejectsEmptyTitle verifies ticket title validation.
func TestCreateTicketRejectsEmptyTitle(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/tickets", bytes.NewBufferString(`{"Title":"   "}`))
	rec := httptest.NewRecorder()

	s.withUser(s.createTicket).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d with body %q", rec.Code, rec.Body.String())
	}
	if got := len(s.loadTickets(1)); got != 0 {
		t.Fatalf("expected no tickets to be created, got %d", got)
	}
}

// TestStateReturnsAfterTicketWasCreated verifies that state stays responsive after writes.
func TestStateReturnsAfterTicketWasCreated(t *testing.T) {
	s := newTestServer(t)
	createReq := httptest.NewRequest(http.MethodPost, "/api/tickets", bytes.NewBufferString(`{"Title":"Visible ticket","Type":"task","Points":3}`))
	createRec := httptest.NewRecorder()
	s.withUser(s.createTicket).ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("create ticket failed with status %d and body %q", createRec.Code, createRec.Body.String())
	}

	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		req := httptest.NewRequest(http.MethodGet, "/api/state", nil)
		rec := httptest.NewRecorder()
		s.withUser(s.state).ServeHTTP(rec, req)
		done <- rec
	}()

	select {
	case rec := <-done:
		if rec.Code != http.StatusOK {
			t.Fatalf("state failed with status %d and body %q", rec.Code, rec.Body.String())
		}
		var payload struct {
			Columns []map[string]any `json:"columns"`
			Tickets []ticket         `json:"tickets"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if len(payload.Columns) != 5 {
			t.Fatalf("expected seeded board columns, got %d", len(payload.Columns))
		}
		if len(payload.Tickets) != 1 || payload.Tickets[0].Title != "Visible ticket" {
			t.Fatalf("expected created ticket in state, got %#v", payload.Tickets)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("state endpoint timed out after creating a ticket")
	}
}

// TestDeleteTicketRemovesTicket verifies that deleting a ticket removes it from board state.
func TestDeleteTicketRemovesTicket(t *testing.T) {
	s := newTestServer(t)
	createReq := httptest.NewRequest(http.MethodPost, "/api/tickets", bytes.NewBufferString(`{"Title":"Delete me"}`))
	createRec := httptest.NewRecorder()
	s.withUser(s.createTicket).ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("create ticket failed with status %d and body %q", createRec.Code, createRec.Body.String())
	}
	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(createRec.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/api/tickets/"+strconv.FormatInt(created.ID, 10), nil)
	deleteRec := httptest.NewRecorder()
	s.withUser(s.ticketAction).ServeHTTP(deleteRec, deleteReq)

	if deleteRec.Code != http.StatusOK {
		t.Fatalf("delete ticket failed with status %d and body %q", deleteRec.Code, deleteRec.Body.String())
	}
	if got := len(s.loadTickets(1)); got != 0 {
		t.Fatalf("expected deleted ticket to be gone, got %d tickets", got)
	}
}

// TestMalformedTicketUpdateDoesNotOverwriteTicket verifies bad updates leave data unchanged.
func TestMalformedTicketUpdateDoesNotOverwriteTicket(t *testing.T) {
	s := newTestServer(t)
	id := createTestTicket(t, s, `{"Title":"Keep me","Type":"task"}`)

	req := httptest.NewRequest(http.MethodPut, "/api/tickets/"+strconv.FormatInt(id, 10), bytes.NewBufferString(`{`))
	rec := httptest.NewRecorder()
	s.withUser(s.ticketAction).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected bad JSON to return 400, got %d with body %q", rec.Code, rec.Body.String())
	}
	var title string
	if err := s.db.QueryRow("select title from tickets where id=?", id).Scan(&title); err != nil {
		t.Fatal(err)
	}
	if title != "Keep me" {
		t.Fatalf("expected malformed update to preserve ticket title, got %q", title)
	}
}

// TestCommentRequiresBody verifies that empty comments are rejected.
func TestCommentRequiresBody(t *testing.T) {
	s := newTestServer(t)
	id := createTestTicket(t, s, `{"Title":"Needs comment"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/tickets/"+strconv.FormatInt(id, 10)+"/comments", bytes.NewBufferString(`{"Body":"   "}`))
	rec := httptest.NewRecorder()
	s.withUser(s.ticketAction).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected empty comment body to return 400, got %d with body %q", rec.Code, rec.Body.String())
	}
	var count int
	if err := s.db.QueryRow("select count(*) from comments where ticket_id=?", id).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("expected no empty comment to be stored, got %d", count)
	}
}

// TestTicketTypeNormalizesSupportedWorkItemTypes verifies supported and legacy type names.
func TestTicketTypeNormalizesSupportedWorkItemTypes(t *testing.T) {
	for raw, want := range map[string]string{
		"":        "task",
		"problem": "bug",
		"epic":    "epic",
		"story":   "story",
		"task":    "task",
		"bug":     "bug",
		"idea":    "idea",
		"unknown": "task",
	} {
		if got := ticketType(raw); got != want {
			t.Fatalf("ticketType(%q) = %q, want %q", raw, got, want)
		}
	}
}

// TestNormalizeIdeaClearsPlanningFields verifies ideas stay outside scheduling fields.
func TestNormalizeIdeaClearsPlanningFields(t *testing.T) {
	ticket := ticket{Type: "idea", Points: 3, Duration: 5, StartDate: "2026-07-01", DueDate: "2026-07-02", CompletedAt: "2026-07-03", MilestoneID: 4, ParentID: 5, Links: []int64{1, 2}}
	normalizeTicketInput(&ticket)
	if ticket.Type != "idea" || ticket.Points != 0 || ticket.Duration != 0 || ticket.StartDate != "" || ticket.DueDate != "" || ticket.CompletedAt != "" || ticket.MilestoneID != 0 || ticket.ParentID != 0 || len(ticket.Links) != 0 {
		t.Fatalf("expected idea planning fields to be cleared, got %#v", ticket)
	}
}

// TestParentGroupingRoundTrips verifies epic-story-task parent relationships persist.
func TestParentGroupingRoundTrips(t *testing.T) {
	s := newTestServer(t)
	epicID := createTestTicket(t, s, `{"Title":"Epic","Type":"epic","Ref":"E1"}`)
	storyID := createTestTicket(t, s, `{"Title":"Story","Type":"story","ParentID":`+strconv.FormatInt(epicID, 10)+`}`)
	taskID := createTestTicket(t, s, `{"Title":"Task","Type":"task","ParentID":`+strconv.FormatInt(storyID, 10)+`}`)

	tickets := s.loadTickets(1)
	byID := map[int64]ticket{}
	for _, item := range tickets {
		byID[item.ID] = item
	}
	if byID[epicID].Ref != "E1" || byID[storyID].ParentID != epicID || byID[taskID].ParentID != storyID {
		t.Fatalf("expected ref and parent hierarchy to round-trip, got %#v", byID)
	}
}

// TestCreateTicketRejectsForeignParent verifies parents cannot cross board boundaries.
func TestCreateTicketRejectsForeignParent(t *testing.T) {
	s := newTestServer(t)
	foreignBoardID, err := s.createBoard("Foreign", 1)
	if err != nil {
		t.Fatal(err)
	}
	parentReq := httptest.NewRequest(http.MethodPost, "/api/tickets?boardId="+strconv.FormatInt(foreignBoardID, 10), bytes.NewBufferString(`{"Title":"Foreign Epic","Type":"epic"}`))
	parentRec := httptest.NewRecorder()
	s.withUser(s.createTicket).ServeHTTP(parentRec, parentReq)
	if parentRec.Code != http.StatusOK {
		t.Fatalf("create parent failed with status %d and body %q", parentRec.Code, parentRec.Body.String())
	}
	var parent struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(parentRec.Body).Decode(&parent); err != nil {
		t.Fatal(err)
	}

	childReq := httptest.NewRequest(http.MethodPost, "/api/tickets?boardId=1", bytes.NewBufferString(`{"Title":"Invalid child","ParentID":`+strconv.FormatInt(parent.ID, 10)+`}`))
	childRec := httptest.NewRecorder()
	s.withUser(s.createTicket).ServeHTTP(childRec, childReq)
	if childRec.Code != http.StatusBadRequest {
		t.Fatalf("expected foreign parent to be rejected, got %d with body %q", childRec.Code, childRec.Body.String())
	}
}

// TestUpdateTicketRejectsParentCycle verifies parent updates cannot create loops.
func TestUpdateTicketRejectsParentCycle(t *testing.T) {
	s := newTestServer(t)
	epicID := createTestTicket(t, s, `{"Title":"Epic","Type":"epic"}`)
	storyID := createTestTicket(t, s, `{"Title":"Story","Type":"story","ParentID":`+strconv.FormatInt(epicID, 10)+`}`)
	taskID := createTestTicket(t, s, `{"Title":"Task","Type":"task","ParentID":`+strconv.FormatInt(storyID, 10)+`}`)
	columnID := testColumnID(t, s, "Backlog")

	updateBody := `{"Title":"Epic","Type":"epic","ColumnID":` + strconv.FormatInt(columnID, 10) + `,"ParentID":` + strconv.FormatInt(taskID, 10) + `}`
	req := httptest.NewRequest(http.MethodPut, "/api/tickets/"+strconv.FormatInt(epicID, 10), bytes.NewBufferString(updateBody))
	rec := httptest.NewRecorder()
	s.withUser(s.ticketAction).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected parent cycle to be rejected, got %d with body %q", rec.Code, rec.Body.String())
	}
}

// TestCreateTicketRejectsIdeaParent verifies ideas cannot be used as parent work items.
func TestCreateTicketRejectsIdeaParent(t *testing.T) {
	s := newTestServer(t)
	ideaID := createTestTicket(t, s, `{"Title":"Maybe later","Type":"idea"}`)

	childReq := httptest.NewRequest(http.MethodPost, "/api/tickets", bytes.NewBufferString(`{"Title":"Delivery work","Type":"task","ParentID":`+strconv.FormatInt(ideaID, 10)+`}`))
	childRec := httptest.NewRecorder()
	s.withUser(s.createTicket).ServeHTTP(childRec, childReq)

	if childRec.Code != http.StatusBadRequest {
		t.Fatalf("expected idea parent to be rejected, got %d with body %q", childRec.Code, childRec.Body.String())
	}
}

// TestDependencyBlocksStartUntilDependencyDone verifies workflow moves respect dependencies.
func TestDependencyBlocksStartUntilDependencyDone(t *testing.T) {
	s := newTestServer(t)
	parentID := createTestTicket(t, s, `{"Title":"Foundation"}`)
	childID := createTestTicket(t, s, `{"Title":"Build on it","Links":[`+strconv.FormatInt(parentID, 10)+`]}`)

	inProgressID := testColumnID(t, s, "In Progress")
	doneID := testColumnID(t, s, "Done")
	childUpdate := `{"ColumnID":` + strconv.FormatInt(inProgressID, 10) + `,"Title":"Build on it","Type":"task","Links":[` + strconv.FormatInt(parentID, 10) + `]}`
	blockedReq := httptest.NewRequest(http.MethodPut, "/api/tickets/"+strconv.FormatInt(childID, 10), bytes.NewBufferString(childUpdate))
	blockedRec := httptest.NewRecorder()
	s.withUser(s.ticketAction).ServeHTTP(blockedRec, blockedReq)

	if blockedRec.Code != http.StatusConflict {
		t.Fatalf("expected dependency conflict, got %d with body %q", blockedRec.Code, blockedRec.Body.String())
	}

	parentUpdate := `{"ColumnID":` + strconv.FormatInt(doneID, 10) + `,"Title":"Foundation","Type":"task"}`
	parentReq := httptest.NewRequest(http.MethodPut, "/api/tickets/"+strconv.FormatInt(parentID, 10), bytes.NewBufferString(parentUpdate))
	parentRec := httptest.NewRecorder()
	s.withUser(s.ticketAction).ServeHTTP(parentRec, parentReq)
	if parentRec.Code != http.StatusOK {
		t.Fatalf("moving dependency to done failed with status %d and body %q", parentRec.Code, parentRec.Body.String())
	}
	var completedAt string
	if err := s.db.QueryRow("select completed_at from tickets where id=?", parentID).Scan(&completedAt); err != nil {
		t.Fatalf("reading completed_at failed: %v", err)
	}
	if completedAt == "" {
		t.Fatal("expected completed_at to be set when dependency moves to done")
	}

	allowedReq := httptest.NewRequest(http.MethodPut, "/api/tickets/"+strconv.FormatInt(childID, 10), bytes.NewBufferString(childUpdate))
	allowedRec := httptest.NewRecorder()
	s.withUser(s.ticketAction).ServeHTTP(allowedRec, allowedReq)
	if allowedRec.Code != http.StatusOK {
		t.Fatalf("expected start after dependency is done, got %d with body %q", allowedRec.Code, allowedRec.Body.String())
	}
}

// createTestTicket creates a ticket through the HTTP handler and returns its id.
func createTestTicket(t *testing.T, s *server, payload string) int64 {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/tickets", bytes.NewBufferString(payload))
	rec := httptest.NewRecorder()
	s.withUser(s.createTicket).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("create ticket failed with status %d and body %q", rec.Code, rec.Body.String())
	}
	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	return created.ID
}

// testColumnID returns a named workflow column id on the default board.
func testColumnID(t *testing.T, s *server, name string) int64 {
	t.Helper()
	var id int64
	if err := s.db.QueryRow("select id from columns where board_id=1 and name=?", name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// insertTestUser creates a simple database user for access-control tests.
func insertTestUser(t *testing.T, s *server, username, name, email string) int64 {
	t.Helper()
	h, err := hashPassword("secret")
	if err != nil {
		t.Fatal(err)
	}
	res, err := s.db.Exec("insert into users(username,name,email,password_hash,avatar,created_at) values(?,?,?,?,?,?)", username, name, email, h, avatar(username), now())
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

// adminCreateUser creates a user through the admin API and returns its id.
func adminCreateUser(t *testing.T, s *server, payload string) int64 {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/users", bytes.NewBufferString(payload))
	rec := httptest.NewRecorder()
	s.userCreate(rec, req, user{ID: 1, IsAdmin: true})
	if rec.Code != http.StatusOK {
		t.Fatalf("admin create user failed with status %d and body %q", rec.Code, rec.Body.String())
	}
	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	return created.ID
}

// loginCookie logs a user in through the API and returns the session cookie.
func loginCookie(t *testing.T, s *server, login, password string) *http.Cookie {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/login", bytes.NewBufferString(`{"Login":"`+login+`","Password":"`+password+`"}`))
	rec := httptest.NewRecorder()
	s.login(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login for %q failed with status %d and body %q", login, rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatalf("login for %q did not set a session cookie", login)
	}
	return cookies[0]
}

type testStatePayload struct {
	Me     user             `json:"me"`
	Boards []map[string]any `json:"boards"`
}

// stateWithCookie loads application state using an existing session cookie.
func stateWithCookie(t *testing.T, s *server, cookie *http.Cookie) testStatePayload {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/state", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	s.withUser(s.state).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("state failed with status %d and body %q", rec.Code, rec.Body.String())
	}
	var payload testStatePayload
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

// serveWithCookie invokes an authenticated handler with a session cookie.
func serveWithCookie(t *testing.T, s *server, method, path, payload string, cookie *http.Cookie, handler func(http.ResponseWriter, *http.Request, user)) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(payload))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	s.withUser(handler).ServeHTTP(rec, req)
	return rec
}

// TestAvatarUsesDinoTemplateIDs verifies avatar choices are stable template ids.
func TestAvatarUsesDinoTemplateIDs(t *testing.T) {
	valid := map[string]bool{
		"trex-stride": true, "trex-roar": true, "raptor": true, "allosaurus": true, "triceratops": true,
		"triceratops-heavy": true, "styracosaurus": true, "stegosaurus": true, "kentrosaurus": true, "ankylosaurus": true,
		"brontosaurus": true, "brachiosaurus": true, "spinosaurus": true, "parasaurolophus": true, "iguanodon": true,
		"pachycephalosaurus": true, "gallimimus": true, "pterosaur-wide": true, "pterosaur-dive": true, "dimetrodon": true,
	}

	for _, seed := range []string{"local", "ada@example.test", "grace@example.test", "kanbanodon"} {
		got := avatar(seed)
		if !valid[got] {
			t.Fatalf("avatar(%q) returned non-template id %q", seed, got)
		}
	}
	if avatar("local") != avatar("local") {
		t.Fatal("avatar selection should remain stable for the same seed")
	}
}

// TestDefaultAdminUsesStoredAvatar verifies state payloads use persisted avatar ids.
func TestDefaultAdminUsesStoredAvatar(t *testing.T) {
	s := newTestServer(t)
	s.authMode = "local"
	if _, err := s.db.Exec("update users set avatar='raptor' where username=?", defaultAdminUsername); err != nil {
		t.Fatal(err)
	}
	session := httptest.NewRecorder()
	s.setSession(session, 1)
	req := httptest.NewRequest(http.MethodGet, "/api/state", nil)
	req.AddCookie(session.Result().Cookies()[0])
	rec := httptest.NewRecorder()
	s.withUser(s.state).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("state failed with status %d and body %q", rec.Code, rec.Body.String())
	}
	var payload struct {
		Me    user `json:"me"`
		Users []struct {
			Avatar string `json:"avatar"`
		} `json:"users"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Me.Avatar != "raptor" {
		t.Fatalf("expected stored avatar for current user, got %q", payload.Me.Avatar)
	}
	if len(payload.Users) == 0 || payload.Users[0].Avatar != "raptor" {
		t.Fatalf("expected admin user list to use stored avatar, got %#v", payload.Users)
	}
}

// TestDefaultAdminCanLoginAndMustChangePassword verifies the bootstrap admin login flow.
func TestDefaultAdminCanLoginAndMustChangePassword(t *testing.T) {
	s := newTestServer(t)
	s.authMode = "local"
	req := httptest.NewRequest(http.MethodPost, "/api/login", bytes.NewBufferString(`{"Login":"kanbanoadmin","Password":"kanbanopw"}`))
	rec := httptest.NewRecorder()
	s.login(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login failed with status %d and body %q", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("expected login to set a session cookie")
	}
	stateReq := httptest.NewRequest(http.MethodGet, "/api/state", nil)
	stateReq.AddCookie(cookies[0])
	stateRec := httptest.NewRecorder()
	s.withUser(s.state).ServeHTTP(stateRec, stateReq)
	if stateRec.Code != http.StatusOK {
		t.Fatalf("state failed with status %d and body %q", stateRec.Code, stateRec.Body.String())
	}
	var payload struct {
		Me user `json:"me"`
	}
	if err := json.NewDecoder(stateRec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Me.IsAdmin || !payload.Me.MustChangePassword {
		t.Fatalf("expected default admin with forced password change, got %#v", payload.Me)
	}
}

// TestLocalModeRequiresSession verifies local mode blocks anonymous API access.
func TestLocalModeRequiresSession(t *testing.T) {
	s := newTestServer(t)
	s.authMode = "local"
	req := httptest.NewRequest(http.MethodGet, "/api/state", nil)
	rec := httptest.NewRecorder()
	s.withUser(s.state).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected local mode without a session to require login, got %d with body %q", rec.Code, rec.Body.String())
	}
}

// TestSignupCreatesRegularUserWithoutExistingBoardAccess verifies new users start isolated.
func TestSignupCreatesRegularUserWithoutExistingBoardAccess(t *testing.T) {
	s := newTestServer(t)
	s.authMode = "local"
	signupReq := httptest.NewRequest(http.MethodPost, "/api/signup", bytes.NewBufferString(`{"Username":"ada","Password":"pw"}`))
	signupRec := httptest.NewRecorder()
	s.signup(signupRec, signupReq)
	if signupRec.Code != http.StatusOK {
		t.Fatalf("signup failed with status %d and body %q", signupRec.Code, signupRec.Body.String())
	}
	cookie := signupRec.Result().Cookies()[0]
	stateReq := httptest.NewRequest(http.MethodGet, "/api/state", nil)
	stateReq.AddCookie(cookie)
	stateRec := httptest.NewRecorder()
	s.withUser(s.state).ServeHTTP(stateRec, stateReq)
	if stateRec.Code != http.StatusOK {
		t.Fatalf("state failed with status %d and body %q", stateRec.Code, stateRec.Body.String())
	}
	var initial struct {
		Me     user             `json:"me"`
		Boards []map[string]any `json:"boards"`
	}
	if err := json.NewDecoder(stateRec.Body).Decode(&initial); err != nil {
		t.Fatal(err)
	}
	if initial.Me.IsAdmin {
		t.Fatal("registered users should not be admins")
	}
	if len(initial.Boards) != 0 {
		t.Fatalf("registered user should not get existing boards, got %#v", initial.Boards)
	}

	boardReq := httptest.NewRequest(http.MethodPost, "/api/boards", bytes.NewBufferString(`{"Name":"Ada Board"}`))
	boardReq.AddCookie(cookie)
	boardRec := httptest.NewRecorder()
	s.withUser(s.boards).ServeHTTP(boardRec, boardReq)
	if boardRec.Code != http.StatusOK {
		t.Fatalf("create board failed with status %d and body %q", boardRec.Code, boardRec.Body.String())
	}
	stateReq = httptest.NewRequest(http.MethodGet, "/api/state", nil)
	stateReq.AddCookie(cookie)
	stateRec = httptest.NewRecorder()
	s.withUser(s.state).ServeHTTP(stateRec, stateReq)
	if err := json.NewDecoder(stateRec.Body).Decode(&initial); err != nil {
		t.Fatal(err)
	}
	if len(initial.Boards) != 1 {
		t.Fatalf("board creator should see their own board, got %#v", initial.Boards)
	}
}

// TestForcedPasswordChangeClearsAdminFlagRequirement verifies forced changes clear the flag.
func TestForcedPasswordChangeClearsAdminFlagRequirement(t *testing.T) {
	s := newTestServer(t)
	s.authMode = "local"
	session := httptest.NewRecorder()
	s.setSession(session, 1)
	req := httptest.NewRequest(http.MethodPost, "/api/password", bytes.NewBufferString(`{"NewPassword":"kanbanopw"}`))
	req.AddCookie(session.Result().Cookies()[0])
	rec := httptest.NewRecorder()
	s.withUser(s.password).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("password change failed with status %d and body %q", rec.Code, rec.Body.String())
	}
	var must int
	if err := s.db.QueryRow("select must_change_password from users where username=?", defaultAdminUsername).Scan(&must); err != nil {
		t.Fatal(err)
	}
	if must != 0 {
		t.Fatal("expected forced password change flag to be cleared")
	}
}

// TestBoardAccessControlsVisibleBoards verifies board visibility follows sharing flags.
func TestBoardAccessControlsVisibleBoards(t *testing.T) {
	s := newTestServer(t)
	h, err := hashPassword("very-secret-pass")
	if err != nil {
		t.Fatal(err)
	}
	res, err := s.db.Exec("insert into users(username,name,email,password_hash,avatar,created_at) values('ada','Ada','ada@example.test',?,?,?)", h, avatar("ada@example.test"), now())
	if err != nil {
		t.Fatal(err)
	}
	uid, _ := res.LastInsertId()
	if err := s.setBoardAccess(1, uid, false); err != nil {
		t.Fatal(err)
	}
	s.authMode = "team"
	recSession := httptest.NewRecorder()
	s.setSession(recSession, uid)
	cookie := recSession.Result().Cookies()[0]

	req := httptest.NewRequest(http.MethodGet, "/api/state", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	s.withUser(s.state).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("state failed with status %d and body %q", rec.Code, rec.Body.String())
	}
	var denied struct {
		Boards []map[string]any `json:"boards"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&denied); err != nil {
		t.Fatal(err)
	}
	if len(denied.Boards) != 0 {
		t.Fatalf("expected no visible boards without full access, got %#v", denied.Boards)
	}

	if err := s.setBoardAccess(1, uid, true); err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/state", nil)
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	s.withUser(s.state).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("state failed with status %d and body %q", rec.Code, rec.Body.String())
	}
	var allowed struct {
		Boards []map[string]any `json:"boards"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&allowed); err != nil {
		t.Fatal(err)
	}
	if len(allowed.Boards) != 1 {
		t.Fatalf("expected one visible board with full access, got %#v", allowed.Boards)
	}
}

// TestBoardOwnerCanGrantAndRevokeOwnBoardAccess verifies owners can manage their board.
func TestBoardOwnerCanGrantAndRevokeOwnBoardAccess(t *testing.T) {
	s := newTestServer(t)
	ownerID := insertTestUser(t, s, "owner", "Owner", "owner@example.test")
	guestID := insertTestUser(t, s, "guest", "Guest", "guest@example.test")
	boardID, err := s.createBoard("Owner Board", ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.setBoardAccess(boardID, ownerID, true); err != nil {
		t.Fatal(err)
	}

	grantReq := httptest.NewRequest(http.MethodPost, "/api/board-access", bytes.NewBufferString(`{"BoardID":`+strconv.FormatInt(boardID, 10)+`,"UserID":`+strconv.FormatInt(guestID, 10)+`,"FullAccess":true}`))
	grantRec := httptest.NewRecorder()
	s.boardAccess(grantRec, grantReq, user{ID: ownerID})
	if grantRec.Code != http.StatusOK {
		t.Fatalf("owner grant failed with status %d and body %q", grantRec.Code, grantRec.Body.String())
	}
	if !s.canAccessBoard(user{ID: guestID}, boardID) {
		t.Fatal("expected guest to access board after owner grant")
	}

	revokeReq := httptest.NewRequest(http.MethodPost, "/api/board-access", bytes.NewBufferString(`{"BoardID":`+strconv.FormatInt(boardID, 10)+`,"UserID":`+strconv.FormatInt(guestID, 10)+`,"FullAccess":false}`))
	revokeRec := httptest.NewRecorder()
	s.boardAccess(revokeRec, revokeReq, user{ID: ownerID})
	if revokeRec.Code != http.StatusOK {
		t.Fatalf("owner revoke failed with status %d and body %q", revokeRec.Code, revokeRec.Body.String())
	}
	if s.canAccessBoard(user{ID: guestID}, boardID) {
		t.Fatal("expected guest access to be removed")
	}
}

// TestBoardOwnerCannotManageOtherBoardAccessOrRemoveOwner verifies owner guardrails.
func TestBoardOwnerCannotManageOtherBoardAccessOrRemoveOwner(t *testing.T) {
	s := newTestServer(t)
	ownerID := insertTestUser(t, s, "owner", "Owner", "owner@example.test")
	guestID := insertTestUser(t, s, "guest", "Guest", "guest@example.test")
	boardID, err := s.createBoard("Owner Board", ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.setBoardAccess(boardID, ownerID, true); err != nil {
		t.Fatal(err)
	}

	foreignReq := httptest.NewRequest(http.MethodPost, "/api/board-access", bytes.NewBufferString(`{"BoardID":1,"UserID":`+strconv.FormatInt(guestID, 10)+`,"FullAccess":true}`))
	foreignRec := httptest.NewRecorder()
	s.boardAccess(foreignRec, foreignReq, user{ID: ownerID})
	if foreignRec.Code != http.StatusForbidden {
		t.Fatalf("expected owner to be blocked from another board, got %d with body %q", foreignRec.Code, foreignRec.Body.String())
	}

	selfRevokeReq := httptest.NewRequest(http.MethodPost, "/api/board-access", bytes.NewBufferString(`{"BoardID":`+strconv.FormatInt(boardID, 10)+`,"UserID":`+strconv.FormatInt(ownerID, 10)+`,"FullAccess":false}`))
	selfRevokeRec := httptest.NewRecorder()
	s.boardAccess(selfRevokeRec, selfRevokeReq, user{ID: ownerID})
	if selfRevokeRec.Code != http.StatusBadRequest {
		t.Fatalf("expected owner access removal to be blocked, got %d with body %q", selfRevokeRec.Code, selfRevokeRec.Body.String())
	}
}

// TestAdminCanManageAccessForAnyBoard verifies global admins can share any board.
func TestAdminCanManageAccessForAnyBoard(t *testing.T) {
	s := newTestServer(t)
	ownerID := insertTestUser(t, s, "owner", "Owner", "owner@example.test")
	guestID := insertTestUser(t, s, "guest", "Guest", "guest@example.test")
	boardID, err := s.createBoard("Owner Board", ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.setBoardAccess(boardID, ownerID, true); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/board-access", bytes.NewBufferString(`{"BoardID":`+strconv.FormatInt(boardID, 10)+`,"UserID":`+strconv.FormatInt(guestID, 10)+`,"FullAccess":true}`))
	rec := httptest.NewRecorder()
	s.boardAccess(rec, req, user{ID: 1, IsAdmin: true})
	if rec.Code != http.StatusOK {
		t.Fatalf("admin grant failed with status %d and body %q", rec.Code, rec.Body.String())
	}
	if !s.canAccessBoard(user{ID: guestID}, boardID) {
		t.Fatal("expected admin to grant access to any board")
	}
}

// TestStateIncludesAccessRowsForAllManageableBoards verifies admin sharing data is complete.
func TestStateIncludesAccessRowsForAllManageableBoards(t *testing.T) {
	s := newTestServer(t)
	guestID := insertTestUser(t, s, "guest", "Guest", "guest@example.test")
	boardID, err := s.createBoard("Second Board", 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.setBoardAccess(boardID, 1, true); err != nil {
		t.Fatal(err)
	}
	if err := s.setBoardAccess(boardID, guestID, true); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/state", nil)
	rec := httptest.NewRecorder()
	s.withUser(s.state).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("state failed with status %d and body %q", rec.Code, rec.Body.String())
	}
	var payload struct {
		AllBoardAccess []map[string]any `json:"allBoardAccess"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	hasGuestAccess := false
	hasDefaultBoardRows := false
	for _, row := range payload.AllBoardAccess {
		bid := int64(row["boardId"].(float64))
		uid := int64(row["userId"].(float64))
		full := int(row["fullAccess"].(float64))
		if bid == 1 {
			hasDefaultBoardRows = true
		}
		if bid == boardID && uid == guestID && full == 1 {
			hasGuestAccess = true
		}
	}
	if !hasDefaultBoardRows || !hasGuestAccess {
		t.Fatalf("expected access rows for all boards, got %#v", payload.AllBoardAccess)
	}
}

// TestAdminCanResetUserPasswordAndPromoteUser verifies admin account controls.
func TestAdminCanResetUserPasswordAndPromoteUser(t *testing.T) {
	s := newTestServer(t)
	h, err := hashPassword("old")
	if err != nil {
		t.Fatal(err)
	}
	res, err := s.db.Exec("insert into users(username,name,email,password_hash,avatar,created_at) values('grace','Grace','grace@example.test',?,?,?)", h, avatar("grace"), now())
	if err != nil {
		t.Fatal(err)
	}
	uid, _ := res.LastInsertId()

	resetReq := httptest.NewRequest(http.MethodPost, "/api/users/password", bytes.NewBufferString(`{"UserID":`+strconv.FormatInt(uid, 10)+`,"Password":"new"}`))
	resetRec := httptest.NewRecorder()
	s.withUser(s.userPassword).ServeHTTP(resetRec, resetReq)
	if resetRec.Code != http.StatusOK {
		t.Fatalf("password reset failed with status %d and body %q", resetRec.Code, resetRec.Body.String())
	}
	var hash string
	var must int
	if err := s.db.QueryRow("select password_hash,must_change_password from users where id=?", uid).Scan(&hash, &must); err != nil {
		t.Fatal(err)
	}
	if !checkPassword(hash, "new") || must != 1 {
		t.Fatal("expected reset password to be stored and force a user password change")
	}

	adminReq := httptest.NewRequest(http.MethodPost, "/api/users/admin", bytes.NewBufferString(`{"UserID":`+strconv.FormatInt(uid, 10)+`,"IsAdmin":true}`))
	adminRec := httptest.NewRecorder()
	s.withUser(s.userAdmin).ServeHTTP(adminRec, adminReq)
	if adminRec.Code != http.StatusOK {
		t.Fatalf("admin promotion failed with status %d and body %q", adminRec.Code, adminRec.Body.String())
	}
	var isAdmin int
	if err := s.db.QueryRow("select is_admin from users where id=?", uid).Scan(&isAdmin); err != nil {
		t.Fatal(err)
	}
	if isAdmin != 1 {
		t.Fatal("expected user to be promoted to admin")
	}
}

// TestAdminCanCreateUserWithBoardAccess verifies user creation stores password and access.
func TestAdminCanCreateUserWithBoardAccess(t *testing.T) {
	s := newTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/api/users", bytes.NewBufferString(`{"Username":"lin","Password":"start","BoardID":1,"FullAccess":true}`))
	rec := httptest.NewRecorder()
	s.withUser(s.users).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("create user failed with status %d and body %q", rec.Code, rec.Body.String())
	}
	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	var hash string
	var mustChange, access int
	if err := s.db.QueryRow("select password_hash,must_change_password from users where id=?", created.ID).Scan(&hash, &mustChange); err != nil {
		t.Fatal(err)
	}
	if !checkPassword(hash, "start") || mustChange != 1 {
		t.Fatal("expected created user password to be stored and force a password change")
	}
	if err := s.db.QueryRow("select full_access from board_users where board_id=1 and user_id=?", created.ID).Scan(&access); err != nil {
		t.Fatal(err)
	}
	if access != 1 {
		t.Fatal("expected created user to receive selected board access")
	}
}

// TestAdminCreatedRegularUserLoginAndBoardRightsScenario verifies regular user onboarding.
func TestAdminCreatedRegularUserLoginAndBoardRightsScenario(t *testing.T) {
	s := newTestServer(t)
	createdID := adminCreateUser(t, s, `{"Username":"local2","Password":"kanbanopw","BoardID":1,"FullAccess":true}`)
	s.authMode = "local"

	cookie := loginCookie(t, s, "local2", "kanbanopw")
	initial := stateWithCookie(t, s, cookie)
	if initial.Me.ID != createdID || initial.Me.IsAdmin || !initial.Me.MustChangePassword {
		t.Fatalf("expected regular user with forced password change, got %#v", initial.Me)
	}
	if len(initial.Boards) != 1 {
		t.Fatalf("expected regular user to see one granted board, got %#v", initial.Boards)
	}

	changeRec := serveWithCookie(t, s, http.MethodPost, "/api/password", `{"NewPassword":"changedpw"}`, cookie, s.password)
	if changeRec.Code != http.StatusOK {
		t.Fatalf("forced password change failed with status %d and body %q", changeRec.Code, changeRec.Body.String())
	}
	createRec := serveWithCookie(t, s, http.MethodPost, "/api/tickets?boardId=1", `{"Title":"Regular user ticket"}`, cookie, s.createTicket)
	if createRec.Code != http.StatusOK {
		t.Fatalf("regular user could not create ticket on granted board: status %d body %q", createRec.Code, createRec.Body.String())
	}
	if got := len(s.loadTickets(1)); got != 1 {
		t.Fatalf("expected regular user's ticket on granted board, got %d tickets", got)
	}
}

// TestAdminCreatedAdminLoginAndBoardSharingScenario verifies admin onboarding and sharing.
func TestAdminCreatedAdminLoginAndBoardSharingScenario(t *testing.T) {
	s := newTestServer(t)
	boardID, err := s.createBoard("Second Board", 1)
	if err != nil {
		t.Fatal(err)
	}
	adminID := adminCreateUser(t, s, `{"Username":"boardadmin","Password":"kanbanopw","IsAdmin":true}`)
	guestID := adminCreateUser(t, s, `{"Username":"guest","Password":"kanbanopw","FullAccess":false}`)
	s.authMode = "local"

	adminCookie := loginCookie(t, s, "boardadmin", "kanbanopw")
	adminState := stateWithCookie(t, s, adminCookie)
	if adminState.Me.ID != adminID || !adminState.Me.IsAdmin || !adminState.Me.MustChangePassword {
		t.Fatalf("expected created admin with forced password change, got %#v", adminState.Me)
	}
	if len(adminState.Boards) != 2 {
		t.Fatalf("expected admin to see every board, got %#v", adminState.Boards)
	}
	changeRec := serveWithCookie(t, s, http.MethodPost, "/api/password", `{"NewPassword":"adminchanged"}`, adminCookie, s.password)
	if changeRec.Code != http.StatusOK {
		t.Fatalf("admin password change failed with status %d and body %q", changeRec.Code, changeRec.Body.String())
	}

	guestCookie := loginCookie(t, s, "guest", "kanbanopw")
	guestState := stateWithCookie(t, s, guestCookie)
	if guestState.Me.ID != guestID || guestState.Me.IsAdmin {
		t.Fatalf("expected created guest to be regular user, got %#v", guestState.Me)
	}
	if len(guestState.Boards) != 0 {
		t.Fatalf("guest should not see boards before sharing, got %#v", guestState.Boards)
	}

	grantBody := `{"BoardID":` + strconv.FormatInt(boardID, 10) + `,"UserID":` + strconv.FormatInt(guestID, 10) + `,"FullAccess":true}`
	grantRec := serveWithCookie(t, s, http.MethodPost, "/api/board-access", grantBody, adminCookie, s.boardAccess)
	if grantRec.Code != http.StatusOK {
		t.Fatalf("created admin could not grant board access: status %d body %q", grantRec.Code, grantRec.Body.String())
	}
	guestState = stateWithCookie(t, s, guestCookie)
	if len(guestState.Boards) != 1 {
		t.Fatalf("guest should see granted board, got %#v", guestState.Boards)
	}

	revokeBody := `{"BoardID":` + strconv.FormatInt(boardID, 10) + `,"UserID":` + strconv.FormatInt(guestID, 10) + `,"FullAccess":false}`
	revokeRec := serveWithCookie(t, s, http.MethodPost, "/api/board-access", revokeBody, adminCookie, s.boardAccess)
	if revokeRec.Code != http.StatusOK {
		t.Fatalf("created admin could not revoke board access: status %d body %q", revokeRec.Code, revokeRec.Body.String())
	}
	guestState = stateWithCookie(t, s, guestCookie)
	if len(guestState.Boards) != 0 {
		t.Fatalf("guest should not see board after revoke, got %#v", guestState.Boards)
	}
}

// TestAdminCanDeleteRegularUserAndRelatedData verifies user deletion cleanup.
func TestAdminCanDeleteRegularUserAndRelatedData(t *testing.T) {
	s := newTestServer(t)
	h, err := hashPassword("old")
	if err != nil {
		t.Fatal(err)
	}
	res, err := s.db.Exec("insert into users(username,name,email,password_hash,avatar,created_at) values('lin','Lin','lin@example.test',?,?,?)", h, avatar("lin"), now())
	if err != nil {
		t.Fatal(err)
	}
	uid, _ := res.LastInsertId()
	if err := s.setBoardAccess(1, uid, true); err != nil {
		t.Fatal(err)
	}
	session := httptest.NewRecorder()
	s.setSession(session, uid)
	ticketID := createTestTicket(t, s, `{"Title":"Assigned","AssigneeID":`+strconv.FormatInt(uid, 10)+`}`)
	if _, err := s.db.Exec("insert into comments(ticket_id,user_id,body,created_at) values(?,?,?,?)", ticketID, uid, "old note", now()); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/users", bytes.NewBufferString(`{"UserID":`+strconv.FormatInt(uid, 10)+`}`))
	rec := httptest.NewRecorder()
	s.withUser(s.userDelete).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("delete user failed with status %d and body %q", rec.Code, rec.Body.String())
	}
	for name, query := range map[string]string{
		"user":         "select count(*) from users where id=?",
		"session":      "select count(*) from sessions where user_id=?",
		"board access": "select count(*) from board_users where user_id=?",
		"comment":      "select count(*) from comments where user_id=?",
	} {
		var count int
		if err := s.db.QueryRow(query, uid).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("expected deleted user's %s rows to be gone, got %d", name, count)
		}
	}
	var assigneeID int64
	if err := s.db.QueryRow("select assignee_id from tickets where id=?", ticketID).Scan(&assigneeID); err != nil {
		t.Fatal(err)
	}
	if assigneeID != 0 {
		t.Fatalf("expected deleted user's assigned tickets to be unassigned, got assignee %d", assigneeID)
	}
}

// TestAdminCannotDeleteSelf verifies an admin cannot remove their own account.
func TestAdminCannotDeleteSelf(t *testing.T) {
	s := newTestServer(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/users", bytes.NewBufferString(`{"UserID":1}`))
	rec := httptest.NewRecorder()
	s.withUser(s.userDelete).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected self-delete to return 400, got %d with body %q", rec.Code, rec.Body.String())
	}
	var count int
	if err := s.db.QueryRow("select count(*) from users where id=1").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("expected current admin account to remain")
	}
}

// TestBoardsEndpointCreatesSeparateBoard verifies board creation keeps board data isolated.
func TestBoardsEndpointCreatesSeparateBoard(t *testing.T) {
	s := newTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/boards", bytes.NewBufferString(`{"Name":"Side Project"}`))
	rec := httptest.NewRecorder()
	s.withUser(s.boards).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("create board failed with status %d and body %q", rec.Code, rec.Body.String())
	}
	var created struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || created.ID == 1 {
		t.Fatalf("expected a new board id, got %d", created.ID)
	}

	createReq := httptest.NewRequest(http.MethodPost, "/api/tickets?boardId="+strconv.FormatInt(created.ID, 10), bytes.NewBufferString(`{"Title":"Board-specific ticket"}`))
	createRec := httptest.NewRecorder()
	s.withUser(s.createTicket).ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("create ticket failed with status %d and body %q", createRec.Code, createRec.Body.String())
	}
	if got := len(s.loadTickets(1)); got != 0 {
		t.Fatalf("expected default board to stay empty, got %d tickets", got)
	}
	if got := len(s.loadTickets(created.ID)); got != 1 {
		t.Fatalf("expected new board to contain one ticket, got %d", got)
	}
}
