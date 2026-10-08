package main

import (
	"database/sql"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"
)

// resetDemoDataIfEnabled retains the original combined reset option.
func (s *server) resetDemoDataIfEnabled(setting string, at time.Time) error {
	return s.prepareDemoDataIfEnabled("false", "false", setting, at)
}

// prepareDemoDataIfEnabled validates every option before changing any data.
// Clear and seed can run independently, or atomically together. All default off.
func (s *server) prepareDemoDataIfEnabled(clearSetting, seedSetting, resetSetting string, at time.Time) error {
	settings := []struct{ name, value string }{
		{"KANBANODON_CLEAR_TASK_DATA", clearSetting},
		{"KANBANODON_SEED_DEMO_DATA", seedSetting},
		{"KANBANODON_RESET_DEMO_DATA", resetSetting},
	}
	enabled := make([]bool, len(settings))
	for i, setting := range settings {
		value, err := strconv.ParseBool(setting.value)
		if err != nil {
			return fmt.Errorf("%s must be true or false: %w", setting.name, err)
		}
		enabled[i] = value
	}
	clear, seed := enabled[0] || enabled[2], enabled[1] || enabled[2]
	if !clear && !seed {
		return nil
	}
	if clear {
		log.Print("Task data cleanup is enabled: deleting ALL tickets and sprint plans")
	}
	if seed {
		log.Print("Demo seed is enabled: adding current sample work to boards not yet seeded")
	}
	boards, err := s.prepareDemoData(clear, seed, at)
	if err != nil {
		return fmt.Errorf("prepare demo data: %w", err)
	}
	log.Printf("Task data preparation complete: cleanup=%t; demo added to %d board(s), each with 3 epics, 18 planned tasks and 6 backlog tasks; users and access retained", clear, boards)
	return nil
}

// demoWeekStart uses UTC calendar dates to match the dates stored in SQLite.
func demoWeekStart(at time.Time) time.Time {
	utc := at.UTC()
	day := time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
	return day.AddDate(0, 0, -((int(day.Weekday()) + 6) % 7))
}

// resetDemoData atomically replaces all task data and each board's sprint plan.
func (s *server) resetDemoData(at time.Time) (int, error) {
	return s.prepareDemoData(true, true, at)
}

// prepareDemoData changes all boards in one transaction. A seed marker keeps
// additive startup seeding from duplicating work or moving sprint plans again.
func (s *server) prepareDemoData(clear, seed bool, at time.Time) (int, error) {
	if !clear && !seed {
		return 0, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec("create table if not exists demo_data_seeds(board_id integer primary key,seeded_at text not null)"); err != nil {
		return 0, err
	}
	if clear {
		for _, table := range []string{"ticket_repetitions", "notifications", "ticket_activity", "comments", "ticket_links", "ticket_labels", "tickets", "sprint_names", "demo_data_seeds"} {
			if _, err := tx.Exec("delete from " + table); err != nil {
				return 0, err
			}
		}
		if _, err := tx.Exec("update boards set sprint_start_date='',sprint_weeks=2"); err != nil {
			return 0, err
		}
	}
	if !seed {
		return 0, tx.Commit()
	}
	boardIDs, err := ints(tx, "select id from boards order by id")
	if err != nil {
		return 0, err
	}
	if len(boardIDs) == 0 {
		var ownerID int64
		if err := tx.QueryRow("select id from users where is_admin=1 order by id limit 1").Scan(&ownerID); err != nil {
			return 0, fmt.Errorf("a demo board needs an administrator: %w", err)
		}
		res, err := tx.Exec("insert into boards(name,owner_id,created_at) values('Dinosaur Operations',?,?)", ownerID, at.UTC().Format(time.RFC3339))
		if err != nil {
			return 0, err
		}
		id, err := res.LastInsertId()
		if err != nil {
			return 0, err
		}
		if _, err := tx.Exec("insert into board_users(board_id,user_id,full_access) values(?,?,1)", id, ownerID); err != nil {
			return 0, err
		}
		boardIDs = append(boardIDs, id)
	}
	week := demoWeekStart(at)
	stamp := at.UTC().Format(time.RFC3339)
	seeded := 0
	for _, boardID := range boardIDs {
		var previous int
		if err := tx.QueryRow("select count(*) from demo_data_seeds where board_id=?", boardID).Scan(&previous); err != nil {
			return 0, err
		}
		if previous != 0 {
			continue
		}
		columns, err := demoColumns(tx, boardID)
		if err != nil {
			return 0, err
		}
		if _, err := tx.Exec("update boards set sprint_start_date=?,sprint_weeks=2 where id=?", week.AddDate(0, 0, -28).Format("2006-01-02"), boardID); err != nil {
			return 0, err
		}
		if _, err := tx.Exec("delete from sprint_names where board_id=?", boardID); err != nil {
			return 0, err
		}
		for i, name := range []string{"Fern Fridge Incident", "Evidence Cleanup", "Cretaceous Coffee", "First Pizza Flight", "Rooftop Landing Lessons", "The Cheese Comet", "No Dinosaurs Left Hungry"} {
			if _, err := tx.Exec("insert into sprint_names(board_id,sprint_number,name,updated_at) values(?,?,?,?)", boardID, i+1, name, stamp); err != nil {
				return 0, err
			}
		}
		if err := seedDemoBoard(tx, boardID, columns, week, stamp); err != nil {
			return 0, err
		}
		if _, err := tx.Exec("insert into demo_data_seeds(board_id,seeded_at) values(?,?)", boardID, stamp); err != nil {
			return 0, err
		}
		seeded++
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return seeded, nil
}

// demoColumns retains custom workflows. Missing standard names fall back to the
// nearest existing position; only an entirely empty workflow gets new columns.
func demoColumns(tx *sql.Tx, boardID int64) (map[string]int64, error) {
	items, err := rows(tx, "select id,name from columns where board_id=? order by position,id", boardID)
	if err != nil {
		return nil, err
	}
	names := []string{"To Do", "Ready", "In Progress", "Review", "Done"}
	if len(items) == 0 {
		for i, name := range names {
			res, err := tx.Exec("insert into columns(board_id,name,position) values(?,?,?)", boardID, name, i)
			if err != nil {
				return nil, err
			}
			id, err := res.LastInsertId()
			if err != nil {
				return nil, err
			}
			items = append(items, map[string]any{"id": id, "name": name})
		}
	}
	result := map[string]int64{}
	for i, name := range names {
		fallback := i
		if fallback >= len(items) {
			fallback = len(items) - 1
		}
		result[name] = items[fallback]["id"].(int64)
		for _, item := range items {
			if strings.EqualFold(strings.TrimSpace(item["name"].(string)), name) {
				result[name] = item["id"].(int64)
				break
			}
		}
	}
	return result, nil
}

type demoTask struct {
	title, body, kind, status string
	start, due                int
	dependencies              []int // Earlier zero-based tasks in the same epic.
}

type demoEpic struct {
	title, body string
	tasks       []demoTask
}

// demoStory supplies branches, chains, and an independent task across past,
// current, and future sprints. Offsets are relative to this week's Monday.
func demoStory() []demoEpic {
	return []demoEpic{
		{"The Great Fern Fridge Heist", "Someone ate the evidence. The herbivores insist that is standard quality assurance.", []demoTask{
			{"Count the missing fern sandwiches", "Count crumbs before the Stegosaurus sweeps them under the rug.", "task", "Done", -28, -26, nil},
			{"Interview the suspiciously full Triceratops", "Offer immunity in exchange for the lunchbox location.", "task", "Done", -25, -23, []int{0}},
			{"Repair the fridge's tiny T-Rex handle", "The arms were not the problem. The handle was.", "bug", "Done", -25, -22, []int{0}},
			{"Install a salad-powered security camera", "Motion detection ignores innocent falling leaves.", "task", "Done", -21, -19, []int{1, 2}},
			{"Return the sandwiches to their rightful dinos", "Include a sincere apology and a fresh fern.", "task", "Done", -18, -16, []int{3}},
			{"Write the no-snacking-on-evidence policy", "Legal has requested a chew-proof version.", "task", "Done", -17, -15, nil},
		}},
		{"Open the Cretaceous Coffee Bar", "A tiny espresso machine meets enormous customers. Keep the queue moving and the T-Rex away from the milk frother.", []demoTask{
			{"Measure mugs against actual dinosaur mouths", "The Diplodocus ordered a bucket. That is a useful data point.", "task", "Done", 0, 1, nil},
			{"Build the Triceratops-proof counter", "Three horns count as three potential drink holders.", "task", "In Progress", 2, 4, []int{0}},
			{"Teach the raptors to form one orderly queue", "Clever girls can still wait their turn.", "task", "Ready", 2, 5, []int{0}},
			{"Fix the volcanic milk frother", "Cappuccino should not require an evacuation.", "bug", "To Do", 5, 7, []int{1}},
			{"Serve the first Meteor Mocha", "Wait for both the counter and the queue before opening.", "task", "To Do", 8, 10, []int{2, 3}},
			{"Name the fern-flavoured loyalty programme", "Current favourite: Buy nine, the tenth is prehistoric.", "task", "To Do", 7, 11, nil},
		}},
		{"Pterodactyl Pizza Delivery", "Launch the park's first airborne pizza service. The cheese may stretch; the delivery promises should not.", []demoTask{
			{"Map safe flight paths above the snack bar", "Avoid the long-neck shortcut and all active volcanoes.", "task", "Ready", 14, 17, nil},
			{"Build a pizza box with landing gear", "No cheese left on the runway.", "task", "To Do", 18, 23, []int{0}},
			{"Train pilots to resist mid-flight toppings", "Delivery is not an all-you-can-eat buffet.", "task", "To Do", 18, 24, []int{0}},
			{"Test the first rooftop pizza landing", "Safety observer gets the first slice.", "task", "To Do", 28, 32, []int{1, 2}},
			{"Deliver to the Diplodocus penthouse", "The penthouse is simply the top of its neck.", "task", "To Do", 35, 39, []int{3}},
			{"Celebrate without triggering the cheese comet", "Order responsibly. Meteor-sized portions are out of scope.", "task", "To Do", 49, 53, []int{4}},
		}},
	}
}

// demoBacklog adds unplanned follow-up work to each story. It belongs in Backlog
// until promoted, so it has no schedule, duration, or blocking dependencies.
func demoBacklog() [][]demoTask {
	return [][]demoTask{
		{
			{title: "Design chew-proof fridge evidence bags", body: "The first prototype disappeared during quality assurance.", kind: "task"},
			{title: "Plan the herbivore midnight snack club", body: "Membership requires bringing your own gigantic leaf.", kind: "story"},
		},
		{
			{title: "Prototype an espresso cup for tiny T-Rex arms", body: "Two handles, one extremely enthusiastic customer.", kind: "task"},
			{title: "Invent the Jurassic decaf menu", body: "The raptors have already volunteered for the double-blind tasting.", kind: "story"},
		},
		{
			{title: "Research rainproof pizza flight goggles", body: "Seeing the runway should not depend on mozzarella visibility.", kind: "task"},
			{title: "Plan a gluten-free asteroid delivery route", body: "Customer requests a contactless landing and absolutely no extinction event.", kind: "story"},
		},
	}
}

// demoSequence appends demo references and positions after existing work,
// including hidden tickets whose references should not be reused.
func demoSequence(tx *sql.Tx, boardID int64) (epicBase, taskBase, position int, err error) {
	items, err := rows(tx, "select id,ref,position from tickets where board_id=?", boardID)
	if err != nil {
		return 0, 0, 0, err
	}
	for _, item := range items {
		ref := strings.TrimSpace(item["ref"].(string))
		if ref == "" {
			ref = strconv.FormatInt(item["id"].(int64), 10)
		}
		if strings.HasPrefix(ref, "E") {
			if n, parseErr := strconv.Atoi(strings.TrimPrefix(ref, "E")); parseErr == nil && n > epicBase {
				epicBase = n
			}
		} else if n, parseErr := strconv.Atoi(strings.SplitN(ref, ".", 2)[0]); parseErr == nil && n > taskBase {
			taskBase = n
		}
		if next := int(item["position"].(int64)) + 1; next > position {
			position = next
		}
	}
	return epicBase, taskBase, position, nil
}

func seedDemoBoard(tx *sql.Tx, boardID int64, columns map[string]int64, week time.Time, stamp string) error {
	epicBase, taskBase, position, err := demoSequence(tx, boardID)
	if err != nil {
		return err
	}
	date := func(offset int) string { return week.AddDate(0, 0, offset).Format("2006-01-02") }
	completed := func(offset int) string {
		value := date(offset) + "T12:00:00Z"
		if value > stamp {
			return stamp
		}
		return value
	}
	for epicIndex, epic := range demoStory() {
		ep := ticket{BoardID: boardID, ColumnID: columns["To Do"], Ref: fmt.Sprintf("E%d", epicBase+epicIndex+1), Title: epic.title, Body: epic.body, Type: "epic", StartDate: date(epic.tasks[0].start), DueDate: date(epic.tasks[len(epic.tasks)-1].due), Position: position}
		if epicIndex == 0 {
			ep.ColumnID = columns["Done"]
			ep.CompletedAt = completed(-15)
		}
		epicID, err := insertDemoTicket(tx, ep, stamp)
		if err != nil {
			return err
		}
		position++
		var taskIDs []int64
		for taskIndex, task := range epic.tasks {
			work := ticket{BoardID: boardID, ColumnID: columns[task.status], ParentID: epicID, Ref: strconv.Itoa(taskBase + epicIndex*6 + taskIndex + 1), Title: task.title, Body: task.body, Type: task.kind, Duration: task.due - task.start + 1, StartDate: date(task.start), DueDate: date(task.due), Position: position}
			if task.status == "Done" {
				work.CompletedAt = completed(task.due)
			}
			id, err := insertDemoTicket(tx, work, stamp)
			if err != nil {
				return err
			}
			var links []int64
			for _, source := range task.dependencies {
				if source < 0 || source >= len(taskIDs) {
					return fmt.Errorf("invalid demo dependency for %s", task.title)
				}
				links = append(links, taskIDs[source])
			}
			if err := validateDependencyGraph(tx, boardID, map[int64][]int64{id: links}); err != nil {
				return err
			}
			if err := replaceTicketMeta(tx, id, boardID, []string{"demo"}, links); err != nil {
				return err
			}
			taskIDs = append(taskIDs, id)
			position++
		}
		for index, task := range demoBacklog()[epicIndex] {
			work := ticket{BoardID: boardID, ColumnID: columns["To Do"], ParentID: epicID, Ref: strconv.Itoa(taskBase + 19 + epicIndex*2 + index), Title: task.title, Body: task.body, Type: task.kind, IsBacklog: true, Position: position}
			id, err := insertDemoTicket(tx, work, stamp)
			if err != nil {
				return err
			}
			if err := replaceTicketMeta(tx, id, boardID, []string{"demo"}, nil); err != nil {
				return err
			}
			position++
		}
	}
	return nil
}

func insertDemoTicket(tx *sql.Tx, t ticket, stamp string) (int64, error) {
	res, err := tx.Exec("insert into tickets(board_id,column_id,parent_id,ref,title,body,type,duration,start_date,due_date,completed_at,position,is_backlog,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", t.BoardID, t.ColumnID, t.ParentID, t.Ref, t.Title, t.Body, t.Type, t.Duration, t.StartDate, t.DueDate, t.CompletedAt, t.Position, t.IsBacklog, stamp, stamp)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}
