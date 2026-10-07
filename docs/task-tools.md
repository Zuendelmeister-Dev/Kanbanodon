# Organizing tasks

The default view shows the board and quick task creation. The backlog, search, and filters help organize work. Planning and administrative actions can be opened when needed; a simple board does not require epics, sprints, or dates.

## Creating and editing tasks

On the board, enter a title in “New ticket” and confirm with “Create task” or Enter. Additional fields are optional. In the backlog, “Add to Backlog” collects tasks that are not yet ready for work on the board. “Add to board” moves them into the first board column.

Open a card by clicking it or using Tab and Enter. The editor lets you change its title, description, status, due date, and assignee. “Planning and details” contains the type, duration, start date, milestone, parent task, labels, dependencies, and repeat settings. “Save” saves the task. Unsaved changes trigger a confirmation when closing the editor, navigating away, or logging out; “Cancel” lets you continue editing.

Change the status in the editor or by dragging the card. Unfinished dependencies prevent moving into active work and later columns. Move the task to “Done” to complete it.

## Checklists and filters

Use “Add step” to add checklist items and check off individual steps. Save changes with “Save”. The card shows the number of completed and total steps.

“My tasks” shows tasks on the current board assigned to the signed-in account. Search matches titles and descriptions. “Filters” offers type, assignee, dependency, and label filters. “Reset filters” clears search and filters.

## Duplicating, archiving, and trash

“Duplicate” creates a copy with its description, labels, and checklist. The copy starts in the first column. The assignee, dates, parent task, dependencies, repeat settings, and completed checklist items are reset.

“Archive” removes a task from active work. “Move to trash” moves it to the trash. Both areas are available through “Board menu”. “Restore” restores a task with its comments and checklist. Its previous status is retained.

## Comments, activity, and notifications

Publish a comment with “Comment”. Saving a task does not publish a comment draft. “Activity” lists creation, changes, comments, and restorations with the user and time.

A mention such as `@username` in a comment notifies the other user if they can access the board. A new assignment by another user also creates a notification. The “Notifications” menu refreshes every 30 seconds while the page is open and visible. Individual notifications or all notifications can be marked as read. No emails are sent.

## Recurring tasks

“Repeat after completion” offers intervals of 1, 7, or 30 days. Moving a task to “Done” creates exactly one next occurrence in the first column, with an unchecked checklist and a due date the selected number of days after completion. Dates are calculated using the UTC date.

Moving the original task out of “Done” and completing it again creates another next occurrence. Saving an already completed task multiple times does not create another one. Tasks are not created automatically on a calendar without completion.

## Planning and data exchange

The "Sprints" panel is visible on the board. Set the first Sprint start date and its length in weeks, then save. Sprint cards appear after a successful save. The panel shows the current Sprint and the next five, or the first six before the saved cadence begins. Changes to the cadence fields are marked as unsaved; the saved cards and their dates remain unchanged until a successful save. Sprint names can be edited directly, and the focus action fits the selected Sprint's date range to the Timeline width. "Show full timeline" restores the complete date range.

Overview and Timeline are directly available in the sidebar. The simplified Overview shows five main columns; "Show planning columns" displays additional fields. Timeline identifies assumed dates as estimates. Saved time, delays, and completion estimates appear on thin rails below the task bars, keeping task names readable.

Hover over a card or task row in Board, Overview, or Timeline to see its direct prerequisites and dependents. Keyboard focus on a task shows the same connections. Blue arrows point from prerequisite to dependent, while unrelated tasks fade into the background. The lines disappear and all tasks return to full visibility when the task is neither hovered nor focused. Showing dependencies keeps focus and scroll position unchanged. Open the task to edit its dependencies under "Planning and details".

“Export” and “Import” in the board menu transfer a board as JSON. Import adds tasks to the selected destination board; importing again creates additional copies. Accounts and access permissions are not transferred, and assignees are reset.

The file includes tasks, checklists, repeat settings, archive and trash status, and comments with timestamps and author names. Imported authors are identified as such and are not associated with accounts that happen to have the same numeric ID in the destination installation. Activity logs and notifications are not part of the board export.

Installation, configuration, and architecture are described in the [README](../README.md).
