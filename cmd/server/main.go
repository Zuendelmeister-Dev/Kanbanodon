package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// main wires the databases, routes, middleware, and HTTP server.
func main() {
	data := env("KANBANODON_DATA_DIR", "data")
	must(os.MkdirAll(data, 0755))
	s := &server{db: open(filepath.Join(data, "app.db")), cfg: open(filepath.Join(data, "config.db")), authMode: env("KANBANODON_AUTH_MODE", "local"), allowSignup: env("KANBANODON_ALLOW_SIGNUP", "true") == "true", secret: []byte(env("KANBANODON_SESSION_SECRET", "change-me-kanbanodon"))}
	must(s.migrate())
	must(s.seed())
	addr := env("KANBANODON_ADDR", ":8080")
	log.Printf("Kanbanodon listening on %s (%s mode)", addr, s.authMode)
	log.Fatal(http.ListenAndServe(addr, newHandler(s)))
}

// newHandler wires all application routes and shared HTTP middleware.
func newHandler(s *server) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", index)
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("web/static"))))
	mux.HandleFunc("/api/state", s.withUser(s.state))
	mux.HandleFunc("/api/boards", s.withUser(s.boards))
	mux.HandleFunc("/api/board-access", s.withUser(s.boardAccess))
	mux.HandleFunc("/api/users", s.withUser(s.users))
	mux.HandleFunc("/api/users/admin", s.withUser(s.userAdmin))
	mux.HandleFunc("/api/users/password", s.withUser(s.userPassword))
	mux.HandleFunc("/api/password", s.withUser(s.password))
	mux.HandleFunc("/api/login", s.login)
	mux.HandleFunc("/api/signup", s.signup)
	mux.HandleFunc("/api/logout", s.logout)
	mux.HandleFunc("/api/tickets", s.withUser(s.createTicket))
	mux.HandleFunc("/api/tickets/", s.withUser(s.ticketAction))
	mux.HandleFunc("/api/export", s.withUser(s.export))
	mux.HandleFunc("/api/import", s.withUser(s.importData))
	return secure(mux)
}

// open connects to a SQLite database and limits it to one writer connection.
func open(p string) *sql.DB {
	db, err := sql.Open("sqlite", p)
	must(err)
	db.SetMaxOpenConns(1)
	return db
}

// must stops startup immediately when a required step fails.
func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}

// env reads an environment variable or returns the provided default value.
func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// now returns the current UTC timestamp in RFC3339 format.
func now() string { return time.Now().UTC().Format(time.RFC3339) }
