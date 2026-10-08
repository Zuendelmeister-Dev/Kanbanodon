# Task cleanup and current demo data

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
