package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func accountAPIRequest(s *server, endpoint, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	if endpoint == "signup" {
		s.signup(rec, authTestRequest("/api/signup", body, nil))
	} else {
		s.userCreate(rec, authTestRequest("/api/users", body, nil), user{ID: 1, IsAdmin: true})
	}
	return rec
}

func TestAccountAPIsAssignAutomaticAvatarsUntilAllMotifsAreUsed(t *testing.T) {
	for _, endpoint := range []string{"signup", "admin"} {
		t.Run(endpoint, func(t *testing.T) {
			s := newBareTestServer(t)
			var initial string
			if err := s.db.QueryRow("select avatar from users where id=1").Scan(&initial); err != nil {
				t.Fatal(err)
			}
			seen := map[string]bool{strings.Split(initial, ":")[1]: true}
			for i := 1; i <= len(avatarSpecies); i++ {
				username := fmt.Sprintf("automatic%d", i)
				// Both real account APIs receive no Avatar field, like the new forms.
				rec := accountAPIRequest(s, endpoint, fmt.Sprintf(`{"Username":%q,"Password":"test-password"}`, username))
				if rec.Code != http.StatusOK {
					t.Fatalf("account %d: %d %s", i+1, rec.Code, rec.Body.String())
				}
				var value string
				if err := s.db.QueryRow("select avatar from users where username=?", username).Scan(&value); err != nil || !avatarPattern.MatchString(value) {
					t.Fatalf("invalid persisted auto avatar %q: %v", value, err)
				}
				species := strings.Split(value, ":")[1]
				if i < len(avatarSpecies) && seen[species] {
					t.Fatalf("automatic API assignment reused %s while motifs remain free", species)
				}
				if endpoint == "signup" {
					cookies := rec.Result().Cookies()
					if len(cookies) != 1 || authTestActor(t, s, cookies[0]).Avatar != value {
						t.Fatal("signup session did not expose persisted auto avatar")
					}
				}
				seen[species] = true
			}
			if len(seen) != len(avatarSpecies) {
				t.Fatalf("expected all motifs before allowing repeats, got %d", len(seen))
			}
		})
	}
}

func TestAccountAPIsReportTakenUsernameWithoutDatabaseDetails(t *testing.T) {
	for _, endpoint := range []string{"signup", "admin"} {
		t.Run(endpoint, func(t *testing.T) {
			s := newBareTestServer(t)
			first := accountAPIRequest(s, endpoint, `{"Username":"takenname","Password":"test-password"}`)
			if first.Code != http.StatusOK {
				t.Fatal(first.Code, first.Body.String())
			}
			duplicate := accountAPIRequest(s, endpoint, `{"Username":"TakenName","Password":"different-password"}`)
			if duplicate.Code != http.StatusBadRequest || strings.TrimSpace(duplicate.Body.String()) != "Username is already taken." || len(duplicate.Result().Cookies()) != 0 {
				t.Fatalf("duplicate username response: %d %s", duplicate.Code, duplicate.Body.String())
			}
			var count int
			if err := s.db.QueryRow("select count(*) from users where username='takenname'").Scan(&count); err != nil || count != 1 {
				t.Fatalf("duplicate changed account count: %d %v", count, err)
			}
		})
	}
}

func TestAccountAPIsHideUnexpectedPersistenceErrors(t *testing.T) {
	for _, endpoint := range []string{"signup", "admin"} {
		t.Run(endpoint, func(t *testing.T) {
			s := newBareTestServer(t)
			if _, err := s.db.Exec(`create trigger reject_account before insert on users begin select raise(abort,'internal_create_diagnostic'); end`); err != nil {
				t.Fatal(err)
			}
			rec := accountAPIRequest(s, endpoint, `{"Username":"cannotpersist","Password":"test-password"}`)
			if rec.Code != http.StatusInternalServerError || strings.TrimSpace(rec.Body.String()) != "Account could not be created. Please try again." || len(rec.Result().Cookies()) != 0 {
				t.Fatalf("database diagnostic leaked: %d %s", rec.Code, rec.Body.String())
			}
			var count int
			if err := s.db.QueryRow("select count(*) from users where username='cannotpersist'").Scan(&count); err != nil || count != 0 {
				t.Fatalf("failed account persisted: %d %v", count, err)
			}
		})
	}
}

func TestAccountAPIsDoNotMislabelOtherUniqueConstraintsAsTakenUsername(t *testing.T) {
	for _, endpoint := range []string{"signup", "admin"} {
		t.Run(endpoint, func(t *testing.T) {
			s := newBareTestServer(t)
			if _, err := s.db.Exec("update users set email=? where id=1", internalUserEmail("legacycollision")); err != nil {
				t.Fatal(err)
			}
			rec := accountAPIRequest(s, endpoint, `{"Username":"legacycollision","Password":"test-password"}`)
			if rec.Code != http.StatusInternalServerError || strings.TrimSpace(rec.Body.String()) != "Account could not be created. Please try again." {
				t.Fatalf("unrelated unique constraint was mislabeled: %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestAccountAPIsKeepValidationErrorsUseful(t *testing.T) {
	for _, endpoint := range []string{"signup", "admin"} {
		t.Run(endpoint, func(t *testing.T) {
			s := newBareTestServer(t)
			for _, tc := range []struct{ body, message string }{
				{`{"Username":"","Password":"test-password"}`, "Enter a username and password."},
				{`{"Username":"invalidavatar","Password":"test-password","Avatar":"https://example.test/avatar.svg"}`, "Avatar is not valid."},
			} {
				rec := accountAPIRequest(s, endpoint, tc.body)
				if rec.Code != http.StatusBadRequest || strings.TrimSpace(rec.Body.String()) != tc.message || len(rec.Result().Cookies()) != 0 {
					t.Fatalf("validation feedback: %d %s", rec.Code, rec.Body.String())
				}
			}
		})
	}
}
