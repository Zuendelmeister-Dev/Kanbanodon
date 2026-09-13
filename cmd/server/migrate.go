package main

import (
	"database/sql"
	"errors"
	"strconv"
	"strings"
)

// ensureColumn adds a missing SQLite column while leaving existing schemas untouched.
func ensureColumn(db *sql.DB, table, column, definition string) error {
	rs, err := db.Query("pragma table_info(" + table + ")")
	if err != nil {
		return err
	}
	defer rs.Close()
	for rs.Next() {
		var cid int
		var name, typ string
		var notNull int
		var defaultValue any
		var pk int
		if err := rs.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		if name == column {
			return nil
		}
	}
	_, err = db.Exec("alter table " + table + " add column " + column + " " + definition)
	return err
}

// migrate creates and upgrades all application tables.
func (s *server) migrate() error {
	qs := []string{
		`create table if not exists users(id integer primary key,username text unique not null,name text not null,email text unique not null,password_hash text not null,avatar text not null,is_admin integer not null default 0,must_change_password integer not null default 0,created_at text not null);`,
		`create table if not exists sessions(token_hash text primary key,user_id integer not null,expires_at text not null);`,
		`create table if not exists boards(id integer primary key,name text not null,owner_id integer not null default 0,sprint_start_date text not null default '',sprint_weeks integer not null default 2,created_at text not null);`,
		`create table if not exists sprint_names(board_id integer not null,sprint_number integer not null,name text not null,updated_at text not null,primary key(board_id,sprint_number));`,
		`create table if not exists board_users(board_id integer not null,user_id integer not null,full_access integer not null default 1,primary key(board_id,user_id));`,
		`create table if not exists columns(id integer primary key,board_id integer not null,name text not null,position integer not null);`,
		`create table if not exists milestones(id integer primary key,board_id integer not null,name text not null,due_date text not null);`,
		`create table if not exists tickets(id integer primary key,board_id integer not null,column_id integer not null,title text not null,body text not null default '',type text not null default 'task',points integer not null default 0,duration integer not null default 0,start_date text not null default '',due_date text not null default '',completed_at text not null default '',milestone_id integer not null default 0,assignee_id integer not null default 0,position integer not null default 0,is_backlog integer not null default 0,created_at text not null,updated_at text not null);`,
		`create table if not exists labels(id integer primary key,board_id integer not null,name text not null,color text not null);`,
		`create table if not exists ticket_labels(ticket_id integer not null,label_id integer not null,primary key(ticket_id,label_id));`,
		`create table if not exists ticket_links(from_ticket_id integer not null,to_ticket_id integer not null,primary key(from_ticket_id,to_ticket_id));`,
		`create table if not exists comments(id integer primary key,ticket_id integer not null,user_id integer not null,body text not null,created_at text not null);`}
	for _, q := range qs {
		if _, err := s.db.Exec(q); err != nil {
			return err
		}
	}
	if err := ensureColumn(s.db, "users", "username", "text not null default ''"); err != nil {
		return err
	}
	if err := ensureColumn(s.db, "users", "is_admin", "integer not null default 0"); err != nil {
		return err
	}
	if err := ensureColumn(s.db, "users", "must_change_password", "integer not null default 0"); err != nil {
		return err
	}
	if err := s.ensureUsernames(); err != nil {
		return err
	}
	if _, err := s.db.Exec("create unique index if not exists users_username_unique on users(username)"); err != nil {
		return err
	}
	if err := ensureColumn(s.db, "boards", "owner_id", "integer not null default 0"); err != nil {
		return err
	}
	if err := ensureColumn(s.db, "boards", "sprint_start_date", "text not null default ''"); err != nil {
		return err
	}
	if err := ensureColumn(s.db, "boards", "sprint_weeks", "integer not null default 2"); err != nil {
		return err
	}
	if err := ensureColumn(s.db, "tickets", "start_date", "text not null default ''"); err != nil {
		return err
	}
	if err := ensureColumn(s.db, "tickets", "duration", "integer not null default 0"); err != nil {
		return err
	}
	if err := ensureColumn(s.db, "tickets", "ref", "text not null default ''"); err != nil {
		return err
	}
	if err := ensureColumn(s.db, "tickets", "parent_id", "integer not null default 0"); err != nil {
		return err
	}
	if err := ensureColumn(s.db, "tickets", "is_backlog", "integer not null default 0"); err != nil {
		return err
	}
	if _, err := s.db.Exec("update tickets set duration=points where duration=0 and points>0"); err != nil {
		return err
	}
	if _, err := s.db.Exec("update tickets set type='bug' where lower(type)='problem'"); err != nil {
		return err
	}
	if _, err := s.db.Exec("update tickets set is_backlog=1 where lower(type)='idea'"); err != nil {
		return err
	}
	if _, err := s.db.Exec("update columns set name='To Do' where lower(trim(name))='backlog'"); err != nil {
		return err
	}
	if err := ensureColumn(s.db, "tickets", "completed_at", "text not null default ''"); err != nil {
		return err
	}
	_, err := s.cfg.Exec(`create table if not exists config(key text primary key,value text not null,updated_at text not null);`)
	if err != nil {
		return err
	}
	_, err = s.cfg.Exec(`insert into config(key,value,updated_at) values('auth_mode',?,?) on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at`, s.authMode, now())
	return err
}

// ensureUsernames backfills unique usernames for older user records.
func (s *server) ensureUsernames() error {
	rs, err := s.db.Query("select id,name,email,username from users order by id")
	if err != nil {
		return err
	}
	defer rs.Close()
	type row struct {
		id             int64
		name           string
		email          string
		username       string
		storedUsername string
	}
	var users []row
	taken := map[string]bool{}
	for rs.Next() {
		var u row
		if err := rs.Scan(&u.id, &u.name, &u.email, &u.username); err != nil {
			return err
		}
		u.storedUsername = u.username
		u.username = cleanUsername(u.username)
		if u.username != "" && !taken[u.username] {
			taken[u.username] = true
			users = append(users, u)
			continue
		}
		u.username = ""
		users = append(users, u)
	}
	if err := rs.Err(); err != nil {
		return err
	}
	if err := rs.Close(); err != nil {
		return err
	}
	for i := range users {
		u := &users[i]
		if u.username != "" {
			continue
		}
		base := cleanUsername(strings.Split(u.email, "@")[0])
		if base == "" {
			base = cleanUsername(u.name)
		}
		if base == "" {
			base = "user"
		}
		name := base
		for i := 2; taken[name]; i++ {
			name = base + strconv.Itoa(i)
		}
		taken[name] = true
		u.username = name
	}
	// Move changed values out of the way first. This handles legacy
	// case-sensitive pairs such as "Ada" and "ada" even with a unique index.
	for _, u := range users {
		if u.username == u.storedUsername {
			continue
		}
		temporary := "__migrate_" + strconv.FormatInt(u.id, 10) + "__"
		if _, err := s.db.Exec("update users set username=? where id=?", temporary, u.id); err != nil {
			return err
		}
	}
	for _, u := range users {
		if u.username == u.storedUsername {
			continue
		}
		if _, err := s.db.Exec("update users set username=? where id=?", u.username, u.id); err != nil {
			return err
		}
	}
	return nil
}

// seed performs startup data fixes without creating sample work items.
func (s *server) seed() error {
	admin, err := s.bootstrapAdmin()
	if err != nil {
		return err
	}
	return s.ensureBoardOwners(admin.ID)
}

// ensureBoardOwners assigns the default admin as owner for legacy ownerless boards.
func (s *server) ensureBoardOwners(defaultOwnerID int64) error {
	if defaultOwnerID <= 0 {
		return nil
	}
	_, err := s.db.Exec("update boards set owner_id=? where owner_id=0", defaultOwnerID)
	return err
}

// bootstrapAdmin creates or repairs the built-in admin account.
func (s *server) bootstrapAdmin() (user, error) {
	var u user
	err := scanUser(s.db.QueryRow("select id,username,name,email,avatar,is_admin,must_change_password from users where username=?", defaultAdminUsername), &u)
	if err == nil {
		_, _ = s.db.Exec("update users set is_admin=1 where id=?", u.ID)
		u.IsAdmin = true
		return u, s.grantUserAllBoards(u.ID)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return user{}, err
	}
	h, _ := hashPassword(defaultAdminPassword)
	res, err := s.db.Exec("insert into users(username,name,email,password_hash,avatar,is_admin,must_change_password,created_at) values(?,?,?,?,?,?,?,?)", defaultAdminUsername, "Kanbano Admin", defaultAdminEmail, h, avatar(defaultAdminUsername), 1, 1, now())
	if err != nil {
		return user{}, err
	}
	u.ID, _ = res.LastInsertId()
	u.Username = defaultAdminUsername
	u.Name = "Kanbano Admin"
	u.Email = defaultAdminEmail
	u.Avatar = avatar(defaultAdminUsername)
	u.IsAdmin = true
	u.MustChangePassword = true
	return u, s.grantUserAllBoards(u.ID)
}
