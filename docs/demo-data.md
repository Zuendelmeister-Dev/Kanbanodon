# Fresh demo data

Kanbanodon normally starts without creating sample tasks. For a disposable demo installation, set `KANBANODON_RESET_DEMO_DATA=true` and recreate the application container. The standard Compose file passes this environment variable to the server and defaults it to `false`.

The setting can be supplied by the shell running Compose or by a `.env` file next to `docker-compose.yml`:

```dotenv
KANBANODON_RESET_DEMO_DATA=true
```

**This option permanently deletes every ticket in the application database, including backlog, archived, and trashed tickets.** It also removes their comments, activity, notifications, labels assigned to tickets, dependency links, and repetition history. Each board's sprint plan and sprint names are replaced. Export or back up any work you want to keep before enabling it.

Accounts, passwords, sessions, board names, ownership, access permissions, workflow columns, label definitions, and milestones remain. Every existing board receives the same three demo Epics and eighteen tasks. An installation without boards receives a new **Dinosaur Operations** board owned by its administrator.

The stories cover a solved fern-fridge mystery, a coffee bar opening, and an airborne pizza delivery service. They include independent tasks, dependency chains, branches, completed work, and work in progress. All creation and update timestamps use the time of the reset.

Dates follow the current UTC calendar week. Two-week sprints begin four weeks before Monday of that week: Sprints 1 and 2 are in the past, Sprint 3 includes today, and later sprints are in the future. Planned dates cover past, current, and several future sprints, so sprint navigation can be tested without maintaining fixed example dates.

The reset runs **on every application start while the option is enabled**, including automatic restarts. A rebuild by itself does not reset a running application; the rebuilt container must start. To retain later edits, change the option back to `false` and recreate the container again so its environment also receives the disabled setting. Changing the shell or `.env` alone does not change an existing container's environment. The server logs when the reset is enabled and when it finishes. The replacement runs in one database transaction; a failure keeps the previous data intact.
