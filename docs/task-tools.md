# Organizing tasks

The default view shows the board and quick task creation. The backlog, search, and filters help organize work. Planning and administrative actions can be opened when needed; a simple board does not require epics, sprints, or dates.

## Creating and editing tasks

On the board, enter a title in “New ticket” and confirm with “Create task” or Enter. Additional fields are optional. In the backlog, “Add to Backlog” collects tasks that are not yet ready for work on the board. “Add to board” moves them into the first board column.

Open a card by clicking it or using Tab and Enter. The editor lets you change its title, description, status, due date, and assignee. “Planning and details” contains the type, duration, start date, milestone, parent task, labels, dependencies, and repeat settings. “Save” saves the task. Unsaved changes trigger a confirmation when closing the editor, navigating away, or logging out; “Cancel” lets you continue editing.

Change the status in the editor or by dragging the card. Tasks can enter “In Progress” while their dependencies are unfinished, so partial work can begin. “Review”, “Done”, and later workflow stages require completed prerequisites. Move the task to “Done” to complete it.

Epics offer “Complete Epic” beside “Edit” in Board, Overview, and Timeline. Every active planned descendant must be in “Done”; unfinished Backlog, archived, and trashed work does not block the Epic. Hover over a disabled completion button to see the unfinished tasks. An empty Epic can be completed deliberately. Use “Reopen Epic” to return it to the first open workflow column before adding or reopening planned work. Completing an Epic does not change its tasks. A workflow needs a column named “Done” for completion.

## Checklists and filters

Use “Add step” to add checklist items and check off individual steps. Save changes with “Save”. The card shows the number of completed and total steps.

“My tasks” shows tasks on the current board assigned to the signed-in account. Search matches titles and descriptions. “Filters” offers type, assignee, dependency, and label filters. Sprint selection combines with these task filters. Board, Overview, and Timeline show a “Task filters” panel listing active filters; use a filter's × button to remove it while retaining the other filters and chosen Sprint. “Reset filters” clears search, task filters, the chosen Sprint, and dependency focus to restore the normal view. Signing out clears task filter values.

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

The separate “History” sidebar view shows actual completions and is described below.

The "Sprints" panel is available in Board, Overview, and Timeline. In Board, set the first Sprint start date and its length in weeks, then save. Sprint cards appear after a successful save. Changes to the cadence fields are marked as unsaved; the saved cards and their dates remain unchanged until a successful save. Sprint names can be edited directly in Board.

Use the arrows beside the six Sprint cards to browse earlier or later Sprints. The current Sprint and the next five are shown by default, or the first six before the saved cadence begins. Browsing does not select a Sprint. Before Sprint 1, the earlier arrow is disabled and its tooltip reads "No earlier sprints".

Select a Sprint to filter Board or Overview to its tasks; their matching Epic headings remain visible. Sprint membership is calculated from task dates. An Epic may span several Sprints through its children. In Timeline, selection fits the Sprint's dates to the available width and initially shows only tasks whose planned intervals touch that Sprint, including tasks crossing its boundaries. “Show all tasks” keeps the Sprint's date window while restoring every row; “Only tasks in this sprint” hides unrelated rows again. “Show full timeline” clears the Sprint selection. The selected card is highlighted and marked "Selected". The selection remains active when moving between Board, Overview, and Timeline. Select "All sprints", or the same card again, to clear it. Without a selection, Board and Overview show all tasks and Timeline shows the full date range; the current Sprint is not selected automatically.

Board keeps empty, completed, and filtered-out Epics in the compact “Epics without visible tasks” list below the working grid. They remain editable and can be completed or reopened there. This avoids large empty swimlanes while preserving Epics that still need planning. Overview retains its table for managing work across Epics.

Overview and Timeline are directly available in the sidebar. The simplified Overview shows five main columns; "Show planning columns" displays additional fields. Timeline identifies assumed dates as estimates. Saved time, delays, and completion estimates appear on thin rails below the task bars, keeping task names readable.

Timeline marks Sprint starts and ends with visible vertical boundaries and contrasting background bands. Each Sprint header includes its name and date range. A permanent turquoise "Today" line identifies the current calendar day when it falls inside the displayed range, independently of the pointer's date cursor.

With a Sprint selected, dependency inspection in Board and Overview stays within that Sprint. Choose "All sprints" to inspect connections across Sprint boundaries.

Select "Dependencies" beside "Edit" to preview the complete connected chain, including its predecessors, successors, and branches. Unrelated tasks fade. Numbering starts at 1 for tasks without predecessors; each dependent stage adds one. Colors progress from blue at the start, through gold in the middle, to teal at the end, with mixed colors for intermediate stages. Parallel tasks at the same stage share a color. A two-stage chain uses blue and teal. Frames and outgoing arrows use the source task’s color. Arrows point to dependent tasks, and scrolling keeps their routes unchanged. Hover over an arrow to highlight its two endpoint tasks and fade other arrows and tasks. Hover over a task to keep all its incoming and outgoing arrows and their directly connected tasks visible. Hovering over a numbered source shows its outgoing arrows and neighbors. Moving away restores the opened chain; task hover in the normal view does not open dependencies.

"Focus tasks" hides unrelated work while keeping the whole connected chain. Each other task in the focused view has a focus button for selecting it without losing the rest of the chain. The highlighted "Show other tasks" button returns to the preview. The highlighted "Back" button, "Back to normal view" above the task area, and "Close dependencies" in the top bar close the dependency view. The selected task has a white outer frame and a "Selected" badge beside its actions; its stage color remains inside the frame. The view also identifies its reference and title. These actions work in Board, Overview, and Timeline; focused Timeline fits the connected tasks’ dates. Click a task or use "Edit" to open its editor. Epic titles expand or collapse their child tasks in all three views; the Epic summary remains visible.

Use "Sort tasks" in the dependency bar to choose "Dependency order" or "Normal order". Dependency order arranges connected tasks by stage within each Epic and Board status column. Normal order follows Board's saved manual positions, Overview's selected table column, or Timeline's hierarchy and schedule. In Overview, click a column heading to sort by it and click again to reverse the direction; this also switches an open dependency view to Normal order. The chain, numbers, and colors remain the same. Closing dependencies restores normal sorting, and switching sorts does not change saved task positions.

Drag Board cards to choose a new position within a column or in another column of the same Epic lane. The line shows the insertion point before you release the card, and the target column is highlighted. Moving the second To Do card before the third Done card sets both the new status and third position in one operation. The order remains after reloading. Parent relationships stay the same. If "Dependency order" is selected, choose "Normal order" before dragging. An allowed destination is highlighted turquoise; a destination blocked by unfinished prerequisites is highlighted red, with an opaque foreground tooltip listing the unfinished tickets. A compact task preview follows the pointer while dragging, keeping the tooltip readable. "In Progress" remains available even with unfinished dependencies. Reordering within the current column remains available.

For current examples with past, current, and future Sprints, see the separate [clear and fill test data flags](demo-data.md). The example stories also include Backlog tasks that can be moved onto the board.

“Export” and “Import” in the board menu transfer a board as JSON. Import adds tasks to the selected destination board; importing again creates additional copies. Accounts and access permissions are not transferred, and assignees are reset.

The file includes tasks, checklists, repeat settings, archive and trash status, and comments with timestamps and author names. Imported authors are identified as such and are not associated with accounts that happen to have the same numeric ID in the destination installation. Activity logs and notifications are not part of the board export.

## Actual completion history

“History” in the sidebar shows what actually completed on the current board, newest first, independently of the planning Sprint selection and global planning filters. Filter by Epic, work type, completion date, or title. Each entry shows its actual completion time and the planned due date saved at that completion. Click its title to open the current ticket. “Show older completions” adds more entries to the chart.

Turquoise bars show the elapsed interval from a recorded entry into “In Progress” until completion; Epic bars are purple. A completion marker is used when the actual start is unknown, rather than substituting a planned start date. Red bars show the time after the saved due day until actual completion. Work completed during its due day is on time. Calendar deadlines and date filters use the browser's local day; completion timestamps identify the actual instant.

Completion snapshots preserve titles, Epic relationships, deadlines, and completion times from that moment. Editing a ticket or reopening it does not rewrite previous entries. Completing it again creates another entry. Archived completed work remains visible; trashed work is hidden and permanent deletion removes its history. Old completed tickets retain their saved completion timestamps and are marked “Saved completion”; imported and demo work is identified separately. Old work has no invented start time. Exporting a planning board does not export its historical completion episodes.

Installation, configuration, and architecture are described in the [README](../README.md).
