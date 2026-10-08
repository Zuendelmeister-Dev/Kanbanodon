// Optional task tools. Core navigation and persistence stay in app.js.
function resetTaskFilters() {
  if (selectedPlanningSprint() && !canLeaveDrawer()) return;
  ['search', 'typeFilter', 'labelFilter', 'assigneeFilter', 'dependencyFilter'].forEach(id => { const field = $('#' + id); if (field) field.value = ''; });
  if (selectedPlanningSprint()) clearPlanningSprint();
  else renderView();
  renderTaskTools();
}

function taskChecklist(extras) {
  return (extras?.Checklist || extras?.checklist || []).map(item => ({ Text: String(item.Text ?? item.text ?? ''), Done: !!(item.Done ?? item.done) }));
}

function checklistProgress(ticket) {
  const items = taskChecklist(ticket.extras);
  return items.length ? items.filter(item => item.Done).length + '/' + items.length : '';
}

function renderTaskTools() {
  const filterCount = ['typeFilter','labelFilter','assigneeFilter','dependencyFilter'].filter(id => $('#' + id)?.value).length;
  if ($('#filtersTitle')) $('#filtersTitle').textContent = 'Filters' + (filterCount ? ' (' + filterCount + ')' : '');
  const sharing = $('#boardSharingBtn');
  if (sharing) {
    sharing.textContent = currentUserIsAdmin() ? 'Admin and sharing' : 'Sharing';
    sharing.onclick = () => { if (!canLeaveDrawer()) return; closeDrawer(false); view = 'admin'; $$('.toolsMenu').forEach(menu => menu.open = false); renderView(); syncRoute('push',0); };
  }
  const mine = $('#myTasksBtn');
  if (mine) {
    mine.setAttribute?.('aria-pressed', String($('#assigneeFilter')?.value === String(state.me?.id)));
    mine.onclick = () => { if (!state.me) return; const filter = $('#assigneeFilter'); filter.value = filter.value === String(state.me.id) ? '' : String(state.me.id); renderView(); renderTaskTools(); };
  }
  const reset = $('#resetFiltersBtn'); if (reset) reset.onclick = resetTaskFilters;
  const list = $('#notificationsList');
  const notifications = state.notifications || [];
  const unread = notifications.filter(item => !item.readAt).length;
  if ($('#notificationsTitle')) $('#notificationsTitle').textContent = 'Notifications' + (unread ? ' (' + unread + ')' : '');
  if (list) {
    list.innerHTML = '<button id="readNotificationsBtn" type="button">Mark all as read</button>' + notifications.map(item => '<button class="notificationItem ' + (item.readAt ? 'read' : '') + '" type="button" data-notification="' + item.id + '"><strong>' + esc(item.title) + '</strong><span>' + esc(item.body) + '</span><small>' + esc(shortDate(item.createdAt)) + '</small></button>').join('') + (!notifications.length ? '<p class="muted">You are all caught up.</p>' : '');
    const mark = $('#readNotificationsBtn'); if (mark) mark.onclick = async () => {
      const isCurrent = currentSessionGuard();
      try { await api('/api/notifications/read', {method:'POST',body:JSON.stringify({ID:0})}, isCurrent); if (isCurrent()) await load(); }
      catch (err) { if (isCurrent()) list.textContent = err.message; }
    };
    $$('[data-notification]').forEach(button => button.onclick = async () => {
      if (!canLeaveDrawer()) return;
      const item = notifications.find(entry => +entry.id === +button.dataset.notification);
      if (!item) return;
      const isCurrent = currentSessionGuard();
      closeDrawer(false); selectedBoardId = +item.boardId; pendingTicketId = +item.ticketId; view = 'board';
      loadGeneration++;
      if (router) router.writeRoute('push', view, selectedBoardId, pendingTicketId);
      $('#notificationsMenu').open = false;
      try {
        await api('/api/notifications/read',{method:'POST',body:JSON.stringify({ID:item.id})}, isCurrent);
        if (isCurrent()) await load();
      } catch (err) { if (isCurrent()) { list.textContent = err.message; await load(); } }
    });
  }
}

function renderStash() {
  const trash = view === 'trash';
  setHeader(trash ? 'Trash' : 'Archive', trash ? 'Restore tasks together with their comments and checklist.' : 'Keep finished work without cluttering your board.');
  const root = $('#stash'); root.classList.remove('hidden');
  const tasks = state.tickets.filter(ticket => trash ? !!ticket.deletedAt : !!ticket.archivedAt && !ticket.deletedAt);
  root.innerHTML = tasks.map(ticket => '<section class="panel stashRow"><div><strong>' + esc(ticket.title) + '</strong><p class="muted">' + esc(trash ? ticket.deletedAt : ticket.archivedAt) + '</p></div><button type="button" data-restore-task="' + ticket.id + '">Restore to board</button></section>').join('') || '<section class="panel"><h2>' + (trash ? 'Trash is empty' : 'Nothing archived yet') + '</h2><p class="muted">' + (trash ? 'Removed tasks can be restored here.' : 'Archive finished tasks from their editor.') + '</p></section>';
  $$('[data-restore-task]').forEach(button => { button.textContent = 'Restore'; button.onclick = async () => {
    const isCurrent = currentSessionGuard();
    try { await api('/api/tickets/' + button.dataset.restoreTask + '/restore',{method:'POST',body:'{}'}, isCurrent); if (isCurrent()) await load(); }
    catch (err) { if (isCurrent()) showLoadError(err); }
  }; });
}

function currentDrawerSnapshot() {
  const root = $('#drawer');
  if (!root || !editing) return '';
  return JSON.stringify(Array.from(root.querySelectorAll('input,select,textarea')).filter(field => field.id !== 'dependencySearch').map(field => [field.id || field.dataset.checklistText || '', field.type === 'checkbox' ? field.checked : field.value]).concat([['links', (editing.links || []).join(',')]]));
}

function canLeaveDrawer() {
  if (!editing || !drawerSnapshot || drawerDraftId !== editing.id || currentDrawerSnapshot() === drawerSnapshot) return true;
  if (!confirm('Discard unsaved changes? Choose Cancel to keep editing and save your work.')) return false;
  drawerSnapshot = '';
  return true;
}

function checklistRowHTML(item, index) {
  return '<div class="checklistRow" data-checklist-row><input type="checkbox" data-checklist-done aria-label="Complete checklist item ' + (index + 1) + '" ' + (item.Done ? 'checked' : '') + '><input type="text" data-checklist-text="' + index + '" aria-label="Checklist item ' + (index + 1) + '" maxlength="500" value="' + escAttr(item.Text) + '"><button type="button" data-checklist-remove aria-label="Remove checklist item ' + (index + 1) + '">×</button></div>';
}

function wireChecklistRows() {
  $$('[data-checklist-remove]').forEach(button => button.onclick = () => button.closest('[data-checklist-row]').remove());
}

function collectTaskExtras() {
  return { Checklist: $$('[data-checklist-row]').map(row => ({ Text: row.querySelector('[data-checklist-text]').value.trim(), Done: row.querySelector('[data-checklist-done]').checked })).filter(item => item.Text), RepeatDays: +($('#dRepeatDays')?.value || 0) };
}

function taskActivityHTML(id) {
  return (state.activity || []).filter(entry => +entry.ticketId === +id).slice(0,30).map(entry => '<p class="activityEntry"><strong>' + esc(userById(entry.userId)?.name || 'Former colleague') + '</strong> · ' + esc(entry.body) + '<small>' + esc(new Date(entry.createdAt).toLocaleString()) + '</small></p>').join('') || '<p class="muted">No activity recorded yet.</p>';
}

function enhanceTaskDrawer() {
  const root = $('#drawer');
  const title = $('#dTitle');
  const status = document.createElement('label'); status.textContent = 'Status';
  const select = document.createElement('select'); select.id = 'dStatus';
  select.innerHTML = state.columns.map(column => '<option value="' + column.id + '">' + esc(column.name) + '</option>').join('');
  select.value = String(editing.columnId); status.append(select); title.closest('label').after(status);
  const more = document.createElement('details'); more.className = 'editorMore';
  more.innerHTML = '<summary>Planning and details</summary>';
  for (const id of ['dType','dDuration','dStart','dMilestone','dParent','dLabels']) {
    const field = $('#' + id); if (field) more.append(field.closest('label'));
  }
  const dependencies = $('#dependencyField')?.closest('.drawerField'); if (dependencies) more.append(dependencies);
  const comments = root.querySelector('.comments'); comments.before(more);
  const checklist = document.createElement('section'); checklist.className = 'taskChecklist';
  checklist.innerHTML = '<h3>Checklist</h3><div id="checklistRows">' + taskChecklist(editing.extras).map(checklistRowHTML).join('') + '</div><button type="button" id="addChecklistItem">Add step</button>';
  more.before(checklist); wireChecklistRows();
  $('#addChecklistItem').onclick = () => {
    const rows = $('#checklistRows');
    if (rows.children.length >= 100) { showDrawerError('A checklist can contain up to 100 steps.'); return; }
    rows.insertAdjacentHTML('beforeend',checklistRowHTML({Text:'',Done:false},rows.children.length)); wireChecklistRows(); rows.lastElementChild.querySelector('[data-checklist-text]').focus();
  };
  more.insertAdjacentHTML('beforeend','<label>Repeat after completion<select id="dRepeatDays"><option value="0">Does not repeat</option><option value="1">After 1 day</option><option value="7">After 7 days</option><option value="30">After 30 days</option></select></label><p class="muted">Marking this task Done creates its next occurrence with a new due date and an unchecked checklist.</p>');
  const repeat = +(editing.extras?.RepeatDays ?? editing.extras?.repeatDays ?? 0);
  if (![0,1,7,30].includes(repeat)) $('#dRepeatDays').insertAdjacentHTML('beforeend','<option value="' + repeat + '">After ' + repeat + ' days</option>');
  $('#dRepeatDays').value = String(repeat);
  const actions = $('#saveBtn').parentElement; actions.className = 'drawerActions';
  $('#saveBtn').classList.add('primaryAction'); $('#deleteBtn').textContent = 'Move to trash';
  actions.insertAdjacentHTML('beforeend','<button id="duplicateTaskBtn" type="button">Duplicate</button><button id="archiveTaskBtn" type="button">Archive</button>');
  $('#duplicateTaskBtn').onclick = () => taskDrawerAction('duplicate');
  $('#archiveTaskBtn').onclick = () => taskDrawerAction('archive');
  root.append(actions);
  const activity = document.createElement('details'); activity.className = 'taskActivity';
  activity.innerHTML = '<summary>Activity</summary><div id="taskActivityList">' + taskActivityHTML(editing.id) + '</div>'; actions.before(activity);
  $('#commentBody').placeholder = 'Write a comment. Mention a colleague with @username.';
  const eligible = state.users.filter(person => +person.id !== +state.me.id && (person.isAdmin || +person.id === currentBoardOwnerId() || state.boardAccess?.some(access => +access.userId === +person.id && access.fullAccess)));
  if (eligible.length) $('#commentBody').insertAdjacentHTML('beforebegin','<p class="muted">Mention: ' + eligible.map(person => '@' + esc(person.username)).join(' · ') + '</p>');
}

async function taskDrawerAction(action) {
  const originalSnapshot = drawerSnapshot;
  if (!editing || drawerMutation || !canLeaveDrawer()) return;
  const binding = beginDrawerMutation();
  if (!binding) return;
  const boardId = editing.boardId;
  try {
    const result = await api('/api/tickets/' + binding.id + '/' + action,{method:'POST',body:'{}'});
    if (binding.session !== sessionGeneration) return;
    const openCopy = action === 'duplicate' && isCurrentDrawer(binding);
    if (isCurrentDrawer(binding)) { drawerSnapshot = ''; closeDrawer(); }
    const closedGeneration = editorGeneration;
    await load();
    if (openCopy && result.id && binding.session === sessionGeneration && closedGeneration === editorGeneration && currentBoardId() === boardId && !editing) openTicket(result.id);
  } catch (err) {
    if (isCurrentDrawer(binding)) { drawerSnapshot = originalSnapshot; showDrawerError(err.message); }
  }
  finally { finishDrawerMutation(binding); }
}

// Refresh only the small notification list while the signed-in page is visible.
// No browser permissions, email or external service is needed.
let notificationRefreshGeneration = 0;
async function refreshNotifications() {
  if (typeof state === 'undefined' || !state.me || document.visibilityState !== 'visible') return;
  const generation = ++notificationRefreshGeneration;
  const sessionCurrent = currentSessionGuard();
  const isCurrent = () => generation === notificationRefreshGeneration && sessionCurrent();
  try {
    const result = await api('/api/notifications', {}, isCurrent);
    if (!isCurrent() || !state.me) return;
    state.notifications = result.notifications || [];
    renderTaskTools();
  } catch (err) { if (isCurrent() && !isLoginRequired(err)) console.warn('Notifications could not be refreshed',err); }
}
if (typeof setInterval !== 'undefined') setInterval(refreshNotifications,30000);
