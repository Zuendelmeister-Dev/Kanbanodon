# Kanbanodon

Kanbanodon is a small, private Kanban board for people who want to structure their work without starting a large project-management platform.

The project exists for three simple reasons:

1. I wanted something fast to start and stop, with a minimal footprint. Kanbanodon should run as one container, with one local data volume, and no extra database server to operate.
2. I did not want my work data to leave my machine or server. Kanbanodon has no telemetry, no cloud sync, no external fonts, no CDN assets, and no runtime calls to third-party services.
3. My son is in his dinosaur phase, so the name and visual style became dinosaur-shaped on purpose.

Kanbanodon is free to run, uses local SQLite files, and is designed for personal work or a small trusted team.

Tasks can be created with a title, moved across the board, and completed. Backlog, checklists, assignments, and comments support everyday work. Epics, dependencies, Sprints, and Timeline are available when more planning is useful.

The application runs as one Go service with a static browser interface and local SQLite databases. No separate database server or cloud account is required. The interface and its images are bundled with the application.

## Getting started

1. Sign up or log in with an existing account.
2. Select "Create first board" to create a board, or choose a board shared with you.
3. Enter a title in "New ticket" and select "Create task" or press Enter.
4. Open the card and change its "Status", or drag it to another column.
5. Select "Done" and save to complete the task.

The default columns are "To Do", "Ready", "In Progress", "Review", and "Done". This workflow does not require Sprint planning, Epics, durations, or dates. Cards can be opened with Tab and Enter. Closing, switching away from, or logging out with an unsaved editor prompts you before discarding changes.

See [Organizing tasks](docs/task-tools.md) for more detailed instructions. [Dinosaur avatars](docs/avatars.md) are assigned to accounts automatically.

## Views and tasks

| Area | Purpose |
| --- | --- |
| Board | Create active tasks and move them through workflow columns; Epics can group tasks into lanes |
| Backlog | Collect upcoming work and promote individual tasks or a complete Epic to the board |
| Overview | Review status, assignments, and upcoming dates; filter and sort tasks |
| Timeline | View scheduled work, dependencies, Epic totals, and delays on a shared timeline |
| Board menu | Open Archive, Trash, Sharing, and JSON import/export |

A task can contain a description, checklist, assignee, due date, labels, duration, start date, milestone, parent, and dependencies. Comments support collaboration. Mentions and assignments by other users create notifications inside the application.

"Duplicate" creates a copy with a fresh work state. Archive and Trash remove tasks from active views and allow restoration. Recurring tasks create their successor when completed.

## Optional planning

### Epics and dependencies

Epics group larger pieces of work. Stories can belong to an Epic; tasks and bugs can belong to an Epic or Story. A board without Epics uses the available width for its workflow columns.

Dependencies identify work that must finish first and the tasks it enables. Unfinished dependencies prevent moving a task into "In Progress" or later columns. The server rejects dependency cycles. Dragging a card changes its status; use "Parent" in the editor to change its parent.

Select "Show dependencies" for a task to open its dependency overview. It shows the direct prerequisites, the selected task, and the tasks that depend on it, with their names and current statuses. Arrows point from prerequisite to dependent and remain within this panel. "Clear selection" closes the selection.

### Sprints

The "Sprints" panel is visible on the board. Configure the first Sprint start date and a duration of 1 to 52 whole weeks. Following Sprints are calculated from this cadence. The board shows the current Sprint and the next five; before the cadence starts, it shows the first six.

Sprint names can be edited directly. Without a custom name, a Sprint is called "Sprint N". The focus action opens that Sprint in Timeline.

A task belongs to the Sprint in which it is planned to finish: its due date, when available, otherwise its start date plus duration. Tasks without a usable date remain unscheduled. Sprint assignment does not calculate team capacity.

### Overview and Timeline

Overview and Timeline are directly available in the sidebar. Overview initially shows five main table columns; "Show planning columns" displays the additional fields.

Timeline uses stored durations and dates. When duration is missing, it assumes three days for ordinary tasks and one day for Epics. When the start date is missing, it derives the start from the due date and duration, or from the creation date. The interface explains these assumptions; they are not saved as task dates.

Task bars show planned work; saved time, delays, and dashed completion estimates appear on a thin separate rail. Unfinished tasks can show a red delay up to the current date, followed by a dashed estimate. Task names remain in the left pane and within sufficiently wide bars. Epic totals use the same time grid. Select "Show dependencies" to see a task's direct relationships in the dependency panel. Zoom changes the time grid's density; dragging pans the timeline horizontally. The date cursor shows the calendar day under the pointer.

## Accounts and permissions

| Role | Responsibilities |
| --- | --- |
| User | Create, edit, and complete tasks on accessible boards |
| Board owner | Manage access to owned boards |
| Administrator | Manage accounts, roles, password resets, and access to all boards |
| Operator | Configure the service, secure transport, and back up data |

Registration can be disabled with `KANBANODON_ALLOW_SIGNUP`. Administrators can still create accounts. Avatars are assigned automatically by the server.

An administrator password reset signs the affected account out on all devices. Changing your own password keeps the current session and signs out other sessions. Password recovery is handled by an administrator; email-based recovery is not available.

## Installation and operation

### Docker Compose

Docker with Docker Compose and a modern browser are required.

1. Replace `KANBANODON_SESSION_SECRET` in `docker-compose.yml` with a long, random value of your own.
2. Start the application:

   ```sh
   docker compose up -d --build
   ```

3. Open [localhost:8080](http://localhost:8080) in your browser.
4. On a fresh installation, log in with the initial administrator account:

   ```text
   Username: kanbanoadmin
   Password: kanbanopw
   ```

5. Set the new administrator password when prompted.

The supplied Compose configuration binds the service to `127.0.0.1:8080`, making it accessible only from the same machine. Network access requires appropriate port exposure and a reverse proxy with TLS.

Stop the application:

```sh
docker compose down
```

### Configuration

| Variable | Service default | Purpose |
| --- | --- | --- |
| `KANBANODON_ADDR` | `:8080` | HTTP listen address |
| `KANBANODON_DATA_DIR` | `data` | Database directory; `/data` inside the Docker container |
| `KANBANODON_AUTH_MODE` | `local` | Authentication mode; use `local` for normal operation |
| `KANBANODON_ALLOW_SIGNUP` | `true` | Allows account registration |
| `KANBANODON_SESSION_SECRET` | `change-me-kanbanodon` | Secret used to sign session tokens; replace it for real use |

### Storage and backups

Docker Compose uses the named volume `kanbanodon-data`. It contains `app.db` for application data and `config.db` for configuration and initialization state. Both files belong in a complete backup. For a consistent file backup, stop the service first or use a backup method designed for SQLite.

Database migrations run automatically at startup and retain existing data. The initial administrator account is created only for a fresh installation. Deleting or demoting it remains effective after a restart. An established installation without an administrator requires recovery from a suitable backup; startup does not restore a known default password.

### Export and import

The board menu exports a board as JSON. Import adds the contained tasks to the selected destination board. Repeating an import creates additional copies. Accounts and access rights are not transferred; assignments are reset during import.

Checklists, recurrence, Archive and Trash status, and comments with timestamps and author names are transferred. Comment authors are marked as imported instead of being associated with unrelated accounts that have the same numeric IDs in the destination. Activity logs and notifications are not part of a board export.

A board export supplements backups but does not replace a backup of the entire installation.

## Architecture

```mermaid
flowchart LR
    Browser["Browser interface"] -->|HTTP and JSON| Server["Go service"]
    Server --> Data[("app.db")]
    Server --> Configuration[("config.db")]
    Browser --> File["Board export as JSON"]
```

The Go service serves the interface and API from the same address. It validates sessions, board access, input, and task relationships before saving. Persistence uses SQLite through `modernc.org/sqlite`; no separate database service is needed.

The browser interface consists of HTML, CSS, and JavaScript. Hash routes preserve the selected view, board, task, and Sprint focus in the URL. Data loading and rendering happen in the browser; the server enforces permissions and persistent validation.

| Component | Contents |
| --- | --- |
| `cmd/server/main.go` | Service configuration and HTTP routes |
| `cmd/server/auth.go`, `users.go` | Accounts, sessions, and passwords |
| `cmd/server/boards.go` | Boards, sharing, and Sprint planning |
| `cmd/server/tickets.go`, `task_features.go` | Tasks, relationships, comments, recurrence, and data exchange |
| `cmd/server/migrate.go` | Database setup and migrations |
| `web/static/` | Browser interface, routing, styles, and bundled images |
| `Dockerfile`, `docker-compose.yml` | Container and runtime configuration |

`app.db` contains accounts, sessions, boards, access rules, tasks, columns, Sprint data, labels, dependencies, comments, milestones, activity, and notifications. `config.db` contains service configuration and initialization state.

## Limitations

Kanbanodon uses one application process with local SQLite files. TLS termination and complete backups are handled by the deployment environment. Cloud synchronization and email integration are not available. Sprint planning assigns work by planned completion dates; it does not calculate capacity or balance workloads automatically.
