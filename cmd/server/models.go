package main

import "database/sql"

type server struct {
	db, cfg     *sql.DB
	authMode    string
	allowSignup bool
	secret      []byte
}
type user struct {
	ID                 int64  `json:"id"`
	Username           string `json:"username"`
	Name               string `json:"name"`
	Email              string `json:"email"`
	Avatar             string `json:"avatar"`
	IsAdmin            bool   `json:"isAdmin"`
	MustChangePassword bool   `json:"mustChangePassword"`
}

const (
	defaultAdminUsername = "kanbanoadmin"
	defaultAdminPassword = "kanbanopw"
	defaultAdminEmail    = "kanbanoadmin@kanbanodon.local"
)

type ticket struct {
	ID, BoardID, ColumnID, MilestoneID, AssigneeID, ParentID int64
	// Ref is the human-facing number (for example #3.1); IDs remain integer keys for links.
	Ref, Title, Body, Type, StartDate, DueDate, CompletedAt, CreatedAt, UpdatedAt string
	Points, Duration, Position                                                    int
	Labels                                                                        []string
	Links                                                                         []int64
}

type accountInput struct {
	Username string
	Name     string
	Email    string
	Password string
}
