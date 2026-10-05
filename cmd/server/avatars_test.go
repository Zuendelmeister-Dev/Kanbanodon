package main

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
)

func TestConcurrentAccountsUseTwentyUniqueMotifsThenAllowRepeats(t *testing.T) {
	s := newBareTestServer(t)
	var existing string
	if err := s.db.QueryRow("select avatar from users where username=?", defaultAdminUsername).Scan(&existing); err != nil {
		t.Fatal(err)
	}
	// All requests deliberately select the same occupied motif, with other seeds.
	requested := "dino-v2:" + strings.Split(existing, ":")[1] + ":1234abcd"
	var wg sync.WaitGroup
	errors := make(chan error, len(avatarSpecies)-1)
	for i := 1; i < len(avatarSpecies); i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			_, err := s.createUserAccount(accountInput{Username: "unique" + strconv.Itoa(index), Password: "test-password", Avatar: requested}, false, false)
			errors <- err
		}(i)
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	rs, err := s.db.Query("select avatar from users")
	if err != nil {
		t.Fatal(err)
	}
	seen := make(map[string]bool)
	for rs.Next() {
		var value string
		if err := rs.Scan(&value); err != nil {
			t.Fatal(err)
		}
		species := strings.Split(value, ":")[1]
		if seen[species] {
			t.Errorf("duplicate motif among first twenty accounts: %s", species)
		}
		seen[species] = true
	}
	if err := rs.Err(); err != nil {
		t.Fatal(err)
	}
	rs.Close()
	if len(seen) != 20 {
		t.Fatalf("expected twenty distinct motifs, got %d", len(seen))
	}
	created, err := s.createUserAccount(accountInput{Username: "twentyone", Password: "test-password", Avatar: requested}, false, false)
	if err != nil || created.Avatar != requested {
		t.Fatalf("account 21 should allow an occupied motif: %q %v", created.Avatar, err)
	}
}

func TestFailedAccountCreationDoesNotConsumeFreeMotif(t *testing.T) {
	s := newBareTestServer(t)
	var selected string
	for _, species := range avatarSpecies {
		value := "dino-v2:" + species + ":1234abcd"
		var count int
		if err := s.db.QueryRow("select count(*) from users where avatar like ?", "dino-v2:"+species+":%").Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count == 0 {
			selected = value
			break
		}
	}
	input := accountInput{Username: "sameusername", Password: "test-password", Avatar: selected}
	if _, err := s.createUserAccount(input, false, false); err != nil {
		t.Fatal(err)
	}
	input.Avatar = "dino-v2:therizinosaurus:abcdef12"
	if _, err := s.createUserAccount(input, false, false); err == nil {
		t.Fatal("duplicate username should fail")
	}
	input.Username = "afterfailure"
	created, err := s.createUserAccount(input, false, false)
	if err != nil || created.Avatar != input.Avatar {
		t.Fatalf("failed creation consumed a motif: %q %v", created.Avatar, err)
	}
}

func TestEveryDinosaurSpeciesIsAccepted(t *testing.T) {
	for _, species := range avatarSpecies {
		value := "dino-v2:" + species + ":1234abcd"
		got, err := accountAvatar(value)
		if err != nil || got != value {
			t.Fatalf("species %s rejected: %q %v", species, got, err)
		}
	}
}

func TestStartupReplacesOldAvatarsAndPreservesCreatorChoices(t *testing.T) {
	s := newTestServer(t)
	legacyID := insertTestUser(t, s, "legacyavatar", "Legacy", "legacyavatar@example.test")
	selectedID := insertTestUser(t, s, "selectedavatar", "Selected", "selectedavatar@example.test")
	selected := "dino-v2:pterosaur:1234abcd"
	if _, err := s.db.Exec("update users set avatar='pterosaur-wide' where id=?", legacyID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("update users set avatar=? where id=?", selected, selectedID); err != nil {
		t.Fatal(err)
	}
	var previous string
	for i := 0; i < 2; i++ {
		if err := s.seed(); err != nil {
			t.Fatal(err)
		}
		var migrated, unchanged string
		if err := s.db.QueryRow("select avatar from users where id=?", legacyID).Scan(&migrated); err != nil {
			t.Fatal(err)
		}
		if !avatarPattern.MatchString(migrated) || (i > 0 && migrated != previous) {
			t.Fatalf("migration must produce a stable creator avatar: %q", migrated)
		}
		previous = migrated
		if err := s.db.QueryRow("select avatar from users where id=?", selectedID).Scan(&unchanged); err != nil || unchanged != selected {
			t.Fatalf("selected avatar changed: %q %v", unchanged, err)
		}
	}
}

func TestNewAccountsPersistSelectedDinosaurAvatar(t *testing.T) {
	for _, endpoint := range []string{"signup", "admin"} {
		t.Run(endpoint, func(t *testing.T) {
			s := newTestServer(t)
			selected := "dino-v2:pterosaur:1234abcd"
			body := `{"Username":"newdino","Password":"test-password","Avatar":"` + selected + `"}`
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/"+endpoint, strings.NewReader(body))
			if endpoint == "signup" {
				s.signup(rec, req)
			} else {
				s.userCreate(rec, req, user{ID: 1, IsAdmin: true})
			}
			if rec.Code != http.StatusOK {
				t.Fatalf("create failed: %d %s", rec.Code, rec.Body.String())
			}
			var stored string
			if err := s.db.QueryRow("select avatar from users where username='newdino'").Scan(&stored); err != nil || stored != selected {
				t.Fatalf("avatar was not persisted: %q, %v", stored, err)
			}
			state := httptest.NewRecorder()
			s.state(state, httptest.NewRequest(http.MethodGet, "/api/state", nil), user{ID: 1, IsAdmin: true})
			if !strings.Contains(state.Body.String(), selected) {
				t.Fatal("state does not expose the persisted avatar")
			}
		})
	}
}

func TestAccountAvatarValidationAndDefaults(t *testing.T) {
	s := newTestServer(t)
	for i, value := range []string{"dino-v2:trex:1234abcd", ""} {
		created, err := s.createUserAccount(accountInput{Username: "dino" + strconv.Itoa(i), Password: "test-password", Avatar: value}, false, false)
		if err != nil || !avatarPattern.MatchString(created.Avatar) {
			t.Fatalf("expected valid generated avatar: %#v, %v", created, err)
		}
	}
	for _, endpoint := range []string{"signup", "admin"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/users", strings.NewReader(`{"Username":"badavatar","Password":"test-password","Avatar":"https://example.test/avatar.svg"}`))
		if endpoint == "signup" {
			s.signup(rec, req)
		} else {
			s.userCreate(rec, req, user{ID: 1, IsAdmin: true})
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("invalid avatar accepted: %d", rec.Code)
		}
	}
	var count int
	if err := s.db.QueryRow("select count(*) from users where username='badavatar'").Scan(&count); err != nil || count != 0 {
		t.Fatalf("invalid avatar created an account: %d %v", count, err)
	}
}
