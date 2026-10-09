# Task cleanup and current demo data

## One-shot scripts

On Windows, run either PowerShell script from the repository directory:

```powershell
.\scripts\clear-task-data.ps1
.\scripts\seed-demo-data.ps1
```

On Linux, macOS, or a POSIX shell, use the matching shell scripts:

```sh
sh ./scripts/clear-task-data.sh
sh ./scripts/seed-demo-data.sh
```

**The clear script permanently deletes all tickets and sprint plans across every board in this Compose database.** It does not create examples. The seed script retains existing tickets and adds three Epics, eighteen planned tasks, and six Backlog tasks per board that has not already received samples. It also sets the current demo Sprint cadence on that board.

To replace old examples with fresh dates, run the clear script followed by the seed script. Both build the current image first. After the first build, you may pass `-SkipBuild` to reuse it:

```powershell
.\scripts\clear-task-data.ps1
.\scripts\seed-demo-data.ps1 -SkipBuild
```

The equivalent shell commands are:

```sh
sh ./scripts/clear-task-data.sh
sh ./scripts/seed-demo-data.sh --skip-build
```

The scripts use the volume configured in `docker-compose.yml`, including its existing data. A temporary container runs `/app/kanbanodon -prepare-demo-data` and exits after the database transaction. It has no HTTP listener and is removed afterward. The scripts do not restart the main application or change its environment, so they do not leave a cleanup flag enabled. Refresh the browser after completion.

Both script variants resolve the repository and default Compose file from the script location, so they also work when called from another directory with an absolute script path. Their optional arguments are:

| Purpose | PowerShell | POSIX shell |
| --- | --- | --- |
| Reuse the current image | `-SkipBuild` | `--skip-build` |
| Choose another Compose file | `-ComposeFile PATH` | `--compose-file PATH` |
| Choose the Docker executable | `-DockerPath PATH` | `--docker-path PATH` |

PowerShell chooses one valid `docker.exe` from PATH and also checks per-user and standard Docker Desktop installation directories. This avoids confusing Docker Desktop's extensionless shell wrapper with its Windows executable. An explicit `-DockerPath` always takes precedence. For a standard Docker Desktop installation:

```powershell
.\scripts\seed-demo-data.ps1 -DockerPath 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
```

The shell scripts use Docker from PATH unless `--docker-path` is supplied. They also support Docker Desktop from Git Bash. Quote paths containing spaces. Each shell script provides `--help`.

The commands must target the same Compose project and volume as your application; these helpers use the repository directory as the default Compose project directory. If you previously enabled startup cleanup flags, disable those separately as described below before keeping new work. If another writer briefly locks SQLite, the script reports the database error without applying a partial change; retry after that writer finishes.

Accounts, boards, ownership, access permissions, workflow columns, label definitions, and milestones remain. Export or back up any tickets you want to keep before running the clear script. No script has to be run as part of a normal build or startup.

## Startup flags

Kanbanodon normally starts without deleting work or creating sample tasks. The standard `docker-compose.yml` offers two independent startup flags, both defaulting to `false`:

| Flag | Action when enabled |
| --- | --- |
| `KANBANODON_CLEAR_TASK_DATA` | Delete all tickets and their related data, and clear every board's sprint plan and sprint names. Do not create sample work. |
| `KANBANODON_SEED_DEMO_DATA` | Add current demo work to each board that has not been seeded yet. Retain existing tickets, and replace that board's sprint plan with the current demo cadence. |

Enable both flags to replace old work with a fresh set of examples. Cleanup and seeding run in one database transaction across all boards; if either operation fails, previous data remains intact. Invalid flag values stop startup before either operation begins.

The older `KANBANODON_RESET_DEMO_DATA=true` option remains supported and enables **both** operations. Leave it `false` when using the independent flags.

## Choose an operation

Set the flags in the shell running Compose or in a `.env` file next to `docker-compose.yml`. For cleanup only:

```dotenv
KANBANODON_CLEAR_TASK_DATA=true
KANBANODON_SEED_DEMO_DATA=false
KANBANODON_RESET_DEMO_DATA=false
```

To add examples while retaining current tickets:

```dotenv
KANBANODON_CLEAR_TASK_DATA=false
KANBANODON_SEED_DEMO_DATA=true
KANBANODON_RESET_DEMO_DATA=false
```

To clear old work and generate examples with fresh dates:

```dotenv
KANBANODON_CLEAR_TASK_DATA=true
KANBANODON_SEED_DEMO_DATA=true
KANBANODON_RESET_DEMO_DATA=false
```

After selecting the operation, start the rebuilt application container:

```sh
docker compose up -d --build --force-recreate kanbanodon
```

**Cleanup permanently deletes every ticket in the application database, including Backlog, archived, and trashed tickets.** It also removes comments, activity, notifications, labels assigned to tickets, dependency links, and repetition history. Export or back up any work you want to keep before enabling cleanup.

Accounts, passwords, sessions, board names, ownership, access permissions, workflow columns, label definitions, and milestones remain. Cleanup alone leaves existing boards empty and does not create a board. Seeding an installation without boards creates a **Dinosaur Operations** board owned by its administrator.

Seeding alone retains existing tickets and their metadata. Demo references and card positions follow existing work. On the first seed of each board, its sprint start, duration, and names are replaced by the current demo plan; this also changes how existing dated tickets map to sprints.

## Sample stories and Backlog

Every seeded board receives **three Epics, eighteen planned tasks, and six unplanned Backlog tasks**. The stories cover a solved fern-fridge mystery, a coffee bar opening, and an airborne pizza delivery service. They include independent tasks, dependency chains, branches, completed work, and work in progress. Each Epic also has two related follow-up tasks in Backlog, such as chew-proof evidence bags, tiny-arm espresso cups, and rainproof pizza flight goggles. Backlog items have no planned dates, duration, or blocking dependencies until you promote and plan them.

All sample creation and update timestamps use the time of seeding. Dates follow the current UTC calendar week. Two-week sprints begin four weeks before Monday of that week: Sprints 1 and 2 are in the past, Sprint 3 includes today, and later sprints are in the future. Planned tasks cover past, current, and several future sprints, so sprint navigation can be tested with current examples.

## Repeated starts and disabling the flags

**Cleanup runs on every application start while enabled**, including automatic restarts. If cleanup and seeding are both enabled, each start replaces the examples with a fresh set. A rebuild alone does not change a running application; the rebuilt container must start.

Seeding alone runs once per board. A marker stored in the application database prevents duplicate samples and preserves later edits to tasks and sprint plans. A newly created board can still receive examples on a later seed-enabled start. To refresh sample dates or restore deleted examples, enable cleanup and seeding together; deleting a sample manually does not remove the marker.

After the desired operation, set **all three flags back to `false`** and recreate the container:

```dotenv
KANBANODON_CLEAR_TASK_DATA=false
KANBANODON_SEED_DEMO_DATA=false
KANBANODON_RESET_DEMO_DATA=false
```

```sh
docker compose up -d --force-recreate kanbanodon
```

Changing the shell or `.env` alone does not update an existing container's environment. Disable the flags and recreate the container before editing examples you want to retain. The server logs which operations are enabled and how many boards receive samples.
