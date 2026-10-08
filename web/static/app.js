const router = window.KanbanodonRoute;
const initialRoute = router?.parseRoute() || { view: 'board', boardId: 0, ticketId: 0, sprintNumber: 0 };

function emptyState() {
  return { boards: [], board: null, sprintNames: [], columns: [], tickets: [], labels: [], milestones: [], users: [], boardAccess: [], allBoardAccess: [], comments: [], me: null, authMode: 'local' };
}

let state = emptyState();
let view = initialRoute.view;
let editing = null;
let selectedBoardId = initialRoute.boardId || +(localStorage.getItem('kanbanodon.boardId') || 0) || 0;
let pendingTicketId = initialRoute.ticketId || 0;
let newTicketLinks = [];
let overviewSort = { key: 'dueDate', dir: 'asc' };
let overviewFilters = { type: '', status: '', q: '' };
let boardAccessSaveStatus = {};
let sprintSettingsStatus = '';
let sprintCadenceDraft = null;
let sprintStripPage = null;
let timelineZoom = 1;
let timelineEpicFilter = 'all';
// The same saved Sprint filters Board/Overview and frames the Timeline calendar.
let timelineFocusSprint = ['board', 'overview', 'timeline'].includes(view) ? initialRoute.sprintNumber || 0 : 0;
let planningSprintBoardId = initialRoute.boardId || selectedBoardId;
let timelineCenterDate = null;
let dependencyFocusTicketId = 0;
let dependencyFocusBoardId = 0;
let dependencyFocused = false;
let dependencySortMode = 'dependencies';
let dependencyRenderSnapshot = null;
const collapsedEpics = new Set();
let loadGeneration = 0;
let sessionGeneration = 0;
let editorGeneration = 0;
let drawerMutation = null;
const pendingTicketMutations = new Map();
let drawerSnapshot = '';
let drawerDraftId = 0;

// Finds the first DOM element matching a CSS selector.
const $ = s => document.querySelector(s);
// Finds all DOM elements matching a CSS selector as a real array.
const $$ = s => [...document.querySelectorAll(s)];
// Calls the JSON API and turns non-2xx responses into thrown errors.
const api = (url, opts = {}, isCurrent = () => true) => {
  const session = sessionGeneration;
  return fetch(url, { headers: { 'content-type': 'application/json' }, ...opts }).then(async r => {
    const text = await r.text();
    if (!r.ok) {
      const err = new Error(r.status >= 500 ? 'Something went wrong. Please try again.' : (text || r.statusText || 'Request failed').trim());
      err.status = r.status;
      err.url = url;
      if (isLoginRequired(err) && session === sessionGeneration && isCurrent()) showLoginRequired();
      throw err;
    }
    const body = text.trim();
    return body ? JSON.parse(body) : {};
  });
};

function currentSessionGuard() {
  const session = sessionGeneration;
  return () => session === sessionGeneration;
}

function invalidateSessionRequests() {
  sessionGeneration++;
  loadGeneration++;
  sprintCadenceDraft = null;
  sprintSettingsStatus = '';
  timelineFocusSprint = 0;
  planningSprintBoardId = 0;
  timelineCenterDate = null;
  sprintStripPage = null;
  dependencyFocusTicketId = dependencyFocusBoardId = 0;
  dependencyFocused = false;
  dependencySortMode = 'dependencies';
  collapsedEpics.clear();
}

// Returns the currently selected board id, falling back to the first accessible board.
function currentBoardId() {
  const active = +(state.board?.id || state.board?.ID || 0);
  if (active) return active;
  const first = state.boards?.[0];
  return +(first?.id || first?.ID || 0);
}

// Builds the board query string used by board-scoped API calls.
function boardQuery() {
  return '?boardId=' + encodeURIComponent(currentBoardId());
}

// Normalizes legacy or invalid ticket types to supported work item types.
function normalizeTicketType(type) {
  const value = String(type || 'task').trim().toLowerCase();
  if (value === 'problem') return 'bug';
  return ['epic', 'story', 'task', 'bug', 'idea'].includes(value) ? value : 'task';
}

// Converts API ticket payloads into the client-side ticket shape.
function normTicket(t) {
  return {
    id: t.ID ?? t.id,
    boardId: t.BoardID ?? t.boardId,
    columnId: t.ColumnID ?? t.columnId,
    title: t.Title ?? t.title,
    ref: t.Ref ?? t.ref ?? '',
    body: t.Body ?? t.body ?? '',
    type: normalizeTicketType(t.Type ?? t.type ?? 'task'),
    points: t.Points ?? t.points ?? 0,
    duration: t.Duration ?? t.duration ?? t.Points ?? t.points ?? 0,
    startDate: t.StartDate ?? t.startDate ?? '',
    dueDate: t.DueDate ?? t.dueDate ?? '',
    completedAt: t.CompletedAt ?? t.completedAt ?? '',
    milestoneId: t.MilestoneID ?? t.milestoneId ?? 0,
    assigneeId: t.AssigneeID ?? t.assigneeId ?? 0,
    parentId: t.ParentID ?? t.parentId ?? 0,
    position: t.Position ?? t.position ?? 0,
    labels: t.Labels ?? t.labels ?? [],
    links: t.Links ?? t.links ?? [],
    isBacklog: !!(t.IsBacklog ?? t.isBacklog ?? t.is_backlog ?? false),
    createdAt: t.CreatedAt ?? t.createdAt,
    updatedAt: t.UpdatedAt ?? t.updatedAt,
    extras: t.Extras ?? t.extras ?? { Checklist: [], RepeatDays: 0 },
    archivedAt: t.ArchivedAt ?? t.archivedAt ?? '',
    deletedAt: t.DeletedAt ?? t.deletedAt ?? '',
  };
}

// Converts persisted custom Sprint names into a stable client-side shape.
function normSprintName(item) {
  return {
    sprintNumber: +(item?.sprint_number ?? item?.SprintNumber ?? item?.sprintNumber ?? 0),
    name: String(item?.name ?? item?.Name ?? '').trim(),
  };
}

// Loads application state from the server and refreshes the visible UI.
async function load() {
  const generation = ++loadGeneration;
  const sessionCurrent = currentSessionGuard();
  const isCurrent = () => generation === loadGeneration && sessionCurrent();
  if (selectedBoardId && currentBoardId() && selectedBoardId !== currentBoardId()) renderView();
  try {
    const url = '/api/state' + (selectedBoardId ? ('?boardId=' + encodeURIComponent(selectedBoardId)) : '');
    const s = await api(url, {}, isCurrent);
    if (!isCurrent()) return;
    state = { ...s, tickets: (s.tickets || []).map(normTicket), sprintNames: (s.sprintNames || s.sprint_names || []).map(normSprintName).filter(item => item.sprintNumber > 0 && item.name), boards: s.boards || [], boardAccess: s.boardAccess || [], allBoardAccess: s.allBoardAccess || [] };
    selectedBoardId = currentBoardId();
    if (selectedBoardId) localStorage.setItem('kanbanodon.boardId', selectedBoardId);
    hideLogin();
    $('#app').classList.remove('hidden');
    $('.tools').classList.remove('hidden');
    render();
    if (currentUserMustChangePassword()) showPasswordChange(true);
    else hidePasswordChange();
  } catch (e) {
    if (!isCurrent()) return;
    if (isLoginRequired(e)) {
      showLoginRequired();
      return;
    }
    if (state.me && selectedBoardId !== currentBoardId()) {
      selectedBoardId = currentBoardId();
      pendingTicketId = 0;
      if (selectedBoardId) localStorage.setItem('kanbanodon.boardId', selectedBoardId);
      render();
    }
    showLoadError(e);
  }
}

// Returns whether an API failure came from an expired or missing login session.
function isLoginRequired(err) {
  return err?.status === 401 && /login required/i.test(err.message || '');
}

// Reports a refresh failure without discarding the last good client state.
function showLoadError(err) {
  console.error('Kanbanodon state refresh failed', err);
  const message = (err.message || 'Data could not be refreshed.').trim();
  if (!state.me) {
    showLoggedOut();
    $('#loginError').textContent = message;
    return;
  }
  $('#viewSubtitle').textContent = 'Could not refresh data: ' + message;
}

// Renders global chrome, filters, navigation, and the active view.
function render() {
  renderAccount();
  renderBoardSelect();
  renderFilters();
  renderNewParentSelect();
  renderNav();
  setupNewDependencyPicker();
  renderView();
  if (pendingTicketId) {
    const id = pendingTicketId;
    pendingTicketId = 0;
    openTicket(id, false);
  }
  syncRoute('replace');
}

// The visible route mirrors the current view, selected board, and optional open drawer.
function syncRoute(mode = 'push', ticketId = editing?.id || 0) {
  if (!router || !state.me) return;
  router.writeRoute(mode, view, selectedBoardId || currentBoardId(), ticketId, ['board', 'overview', 'timeline'].includes(view) ? timelineFocusSprint : 0);
}

// Applies a parsed URL hash route to the in-memory UI state.
function applyRoute(route) {
  if (!canLeaveDrawer()) { syncRoute('replace'); return; }
  closeDrawer(false);
  const requestedBoardId = route.boardId || currentBoardId() || selectedBoardId;
  if (requestedBoardId !== selectedBoardId) loadGeneration++;
  selectedBoardId = requestedBoardId;
  if (selectedBoardId) localStorage.setItem('kanbanodon.boardId', selectedBoardId);
  view = route.view || 'board';
  pendingTicketId = route.ticketId || 0;
  timelineFocusSprint = ['board', 'overview', 'timeline'].includes(view) ? +(route.sprintNumber || 0) : 0;
  planningSprintBoardId = requestedBoardId;
  sprintStripPage = null;
  if (['board', 'overview', 'timeline'].includes(view)) {
    timelineZoom = 1;
    dependencyFocusTicketId = 0;
    dependencyFocused = false;
  }
  if (view === 'timeline' && timelineFocusSprint) timelineEpicFilter = 'all';
  timelineCenterDate = null;
  if (route.boardId && route.boardId !== currentBoardId()) {
    return load();
  }
  render();
}

// Returns whether the signed-in user has global admin rights.
function currentUserIsAdmin() {
  const u = state.me || {};
  return !!(u.isAdmin ?? u.is_admin ?? u.IsAdmin);
}

// Returns the owner id for the active board.
function currentBoardOwnerId() {
  return boardOwnerId(state.board || {});
}

// Returns whether the current user can manage access to at least one board.
function currentUserCanManageBoardAccess() {
  return manageableBoards().length > 0;
}

// Reads a board id from either API or client-side casing.
function boardId(board) {
  return +(board?.id ?? board?.ID ?? 0);
}

// Reads a board name from either API or client-side casing.
function boardName(board) {
  return board?.name ?? board?.Name ?? 'Board';
}

// Reads a board owner id from either API or client-side casing.
function boardOwnerId(board) {
  return +(board?.ownerId ?? board?.owner_id ?? board?.OwnerID ?? 0);
}

// Returns whether the current user can manage a specific board.
function canManageBoard(board) {
  const me = state.me || {};
  return currentUserIsAdmin() || (!!me.id && +me.id === boardOwnerId(board));
}

// Lists boards whose sharing settings the current user can edit.
function manageableBoards() {
  return (state.boards || []).filter(b => boardId(b) && canManageBoard(b));
}

// Returns whether a user object represents an admin.
function userIsAdmin(u) {
  return !!(u.isAdmin ?? u.is_admin ?? u.IsAdmin);
}

// Returns whether the current user must change their password before continuing.
function currentUserMustChangePassword() {
  const u = state.me || {};
  return !!(u.mustChangePassword ?? u.must_change_password ?? u.MustChangePassword);
}

// Formats the visible ticket reference such as #8 or #E1.
function ticketRef(t) {
  return '#' + (t?.ref || t?.id || '');
}

// Returns the readable ticket name used in compact UI labels.
function ticketLabel(t) {
  return t?.title || ticketRef(t);
}

// Returns whether a ticket is a legacy idea note.
function isIdea(t) {
  return normalizeTicketType(t?.type) === 'idea';
}

// Returns whether a ticket is waiting in the product backlog.
function isBacklogTicket(t) {
  return !!t?.isBacklog || isIdea(t);
}

// Delivery views contain only tickets that have been promoted onto the board.
function workTickets() {
  return state.tickets.filter(t => !t.archivedAt && !t.deletedAt && !isBacklogTicket(t));
}

// Lists all tickets waiting in the product backlog.
function backlogTickets() {
  return state.tickets.filter(t => !t.archivedAt && !t.deletedAt && isBacklogTicket(t));
}

// Keeps the legacy helper available for old exports and focused unit tests.
function ideaTickets() {
  return backlogTickets().filter(isIdea);
}

// Returns direct children for a parent work item.
function childTickets(id, tickets = workTickets()) {
  return tickets.filter(t => +t.parentId === +id).sort(ticketOrder);
}

// Returns all nested descendants for a parent work item.
function descendantTickets(parentId, seen = new Set(), tickets = workTickets()) {
  if (!parentId || seen.has(+parentId)) return [];
  seen.add(+parentId);
  return childTickets(parentId, tickets).flatMap(child => [child, ...descendantTickets(child.id, seen, tickets)]);
}

// Returns whether a parent type is valid for a child type.
function parentTypeAllowed(parentType, childType) {
  const parent = normalizeTicketType(parentType);
  switch (normalizeTicketType(childType)) {
    case 'story':
      return parent === 'epic';
    case 'task':
    case 'bug':
      return parent === 'epic' || parent === 'story';
    default:
      return false;
  }
}

// Lists safe parent choices while excluding cycles, descendants, and unsuitable types.
function parentCandidates(childType = 'task', currentId = 0) {
  const current = parentTicket(currentId);
  const candidates = current && isBacklogTicket(current) ? state.tickets : workTickets();
  const blocked = new Set([+currentId, ...descendantTickets(currentId, new Set(), candidates).map(t => +t.id)].filter(Boolean));
  return candidates.filter(t => !blocked.has(+t.id) && parentTypeAllowed(t.type, childType)).sort(ticketOrder);
}

// Finds a ticket by id for parent lookups.
function parentTicket(id) {
  return state.tickets.find(t => t.id == id);
}

// Finds a user by id for assignee labels and avatars.
function userById(id) {
  return state.users.find(u => +u.id === +id);
}

// Counts direct child items for a ticket.
function childCount(id) {
  return state.tickets.filter(t => +t.parentId === +id).length;
}

// Sorts tickets by manual position and then stable ticket reference.
function ticketOrder(a, b) {
  return (+a.position || 0) - (+b.position || 0) || String(a.ref || a.id).localeCompare(String(b.ref || b.id), undefined, { numeric: true }) || (+a.id || 0) - (+b.id || 0);
}

// Renders the signed-in user account menu.
function renderAccount() {
  const name = state.me?.name || state.me?.username || 'Local User';
  const username = state.me?.username || '';
  $('#me').innerHTML = '<button id="accountBtn" class="accountBtn" type="button" title="Account menu">' + avatar(state.me?.avatar) + '<span>' + esc(name) + '</span></button><div id="accountMenu" class="accountMenu hidden"><strong>' + esc(name) + '</strong><p class="muted">@' + esc(username) + '</p><button id="accountPasswordBtn" class="ghost" type="button">Change password</button><button id="accountLogoutBtn" type="button">Logout</button></div>';
  $('#accountBtn').onclick = () => $('#accountMenu').classList.toggle('hidden');
  $('#accountPasswordBtn').onclick = () => {
    $('#accountMenu').classList.add('hidden');
    showPasswordChange(false);
  };
  $('#accountLogoutBtn').onclick = logout;
}

// Returns whether the client has useful data that should survive a session timeout.
function hasLoadedState() {
  return !!(state.me || state.board || state.boards.length || state.tickets.length);
}

// Resets in-memory data and optionally forgets the selected board.
function resetClientState(clearBoardSelection) {
  invalidateSessionRequests();
  resetDrawer();
  state = emptyState();
  if (!clearBoardSelection) return;
  selectedBoardId = 0;
  localStorage.removeItem('kanbanodon.boardId');
}

// Shows the login panel after the server reports an expired or missing session.
function showLoginRequired() {
  const hadState = hasLoadedState();
  invalidateSessionRequests();
  resetDrawer();
  state = { ...state, me: null };
  $('#me').innerHTML = '';
  $('.tools').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#passwordPanel').classList.add('hidden');
  $('#app').classList.add('hidden');
  $('#loginError').textContent = hadState ? 'Session expired. Please log in again.' : '';
  $('#signupError').textContent = '';
  $('#loginBtn').disabled = false;
  $('#signupBtn').disabled = false;
  $('#loginUsername').focus();
}

// Switches the UI into explicit logged-out mode.
function showLoggedOut() {
  resetClientState(true);
  $('#me').innerHTML = '';
  $('.tools').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#passwordPanel').classList.add('hidden');
  $('#app').classList.add('hidden');
  $('#loginError').textContent = '';
  $('#signupError').textContent = '';
  $('#loginBtn').disabled = false;
  $('#signupBtn').disabled = false;
  $('#loginUsername').focus();
}

// Hides the login panel and clears login errors.
function hideLogin() {
  $('#login').classList.add('hidden');
  const error = $('#loginError');
  if (error) error.textContent = '';
}

// Logs out through the API and resets local UI state.
async function logout() {
  if (!canLeaveDrawer()) return;
  showLoggedOut();
  const isCurrent = currentSessionGuard();
  $('#loginBtn').disabled = true;
  $('#signupBtn').disabled = true;
  try {
    await api('/api/logout', { method: 'POST', body: '{}' }, isCurrent);
  } catch (err) {
    if (isCurrent()) $('#loginError').textContent = (err.message || 'Logout failed.').trim();
  } finally {
    if (isCurrent()) {
      $('#loginBtn').disabled = false;
      $('#signupBtn').disabled = false;
    }
  }
}

// Shows the password change panel in forced or optional mode.
function showPasswordChange(forced) {
  $('#passwordPanel').classList.remove('hidden');
  $('#passwordTitle').textContent = forced ? 'Change password required' : 'Change password';
  $('#passwordHint').textContent = forced ? 'Please choose a password before continuing.' : 'Set a new password for your account.';
  $('#currentPasswordField').classList.toggle('hidden', forced);
  $('#cancelPasswordBtn').classList.toggle('hidden', forced);
  $('#passwordError').textContent = '';
  $('#newPassword').value = '';
  $('#confirmPassword').value = '';
  $('#currentPassword').value = '';
  resetPasswordRevealButtons($('#passwordPanel'));
  if (forced) {
    $('#app').classList.add('hidden');
    $('.tools').classList.add('hidden');
  }
  $('#newPassword').focus();
}

// Hides and resets the password change panel.
function hidePasswordChange() {
  $('#passwordPanel').classList.add('hidden');
  $('#passwordError').textContent = '';
}

// Resets password reveal controls back to hidden-password mode.
function resetPasswordRevealButtons(root = document) {
  root.querySelectorAll('.passwordField input[type="text"]').forEach(input => input.type = 'password');
  root.querySelectorAll('.passwordReveal').forEach(button => {
    button.classList.remove('active');
    button.title = 'Show password';
    button.setAttribute('aria-label', 'Show password');
  });
}

// Toggles a password input between masked and plain text.
function togglePasswordReveal(e) {
  const button = e.currentTarget;
  const input = document.getElementById(button.dataset.passwordTarget);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.classList.toggle('active', show);
  button.title = show ? 'Hide password' : 'Show password';
  button.setAttribute('aria-label', button.title);
}

// Builds the eye button used to reveal a password field.
function passwordRevealButton(target) {
  return '<button class="passwordReveal" data-password-target="' + escAttr(target) + '" type="button" title="Show password" aria-label="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>';
}

// Builds a password input wrapped with a reveal button.
function passwordFieldHtml(id, placeholder, className = '', attrs = '') {
  return '<label class="passwordField ' + escAttr(className) + '"><input id="' + escAttr(id) + '" ' + attrs + ' type="password" placeholder="' + escAttr(placeholder) + '"></label>';
}

// Adds reveal buttons to password fields that do not have one yet.
function enhancePasswordReveals(root = document) {
  root.querySelectorAll('.passwordField input').forEach(input => {
    const field = input.closest('.passwordField');
    if (!field || field.querySelector('.passwordReveal')) return;
    field.insertAdjacentHTML('beforeend', passwordRevealButton(input.id));
  });
  root.querySelectorAll('.passwordReveal').forEach(button => button.onclick = togglePasswordReveal);
}

// Reads and validates matching password and confirmation fields.
function confirmedPassword(passwordSelector, confirmSelector, errorSelector, missingMessage = 'Please enter a password.') {
  const input = $(passwordSelector);
  const confirm = $(confirmSelector);
  const password = input?.value || '';
  // Shows one validation error and returns null so callers can stop early.
  const fail = (message, focus) => {
    if (errorSelector) $(errorSelector).textContent = message;
    else alert(message);
    focus?.focus();
    return null;
  };
  if (!password) return fail(missingMessage, input);
  if (password !== (confirm?.value || '')) return fail('The passwords do not match.', confirm);
  return password;
}

// Clears password inputs selected by CSS selector.
function clearPasswordInputs(...selectors) {
  selectors.forEach(selector => {
    const input = $(selector);
    if (!input) return;
    input.value = '';
    input.type = 'password';
  });
  resetPasswordRevealButtons();
}

// Builds the avatar markup for a user or generated dinosaur avatar.
function avatar(name, title = '') {
  if (window.KanbanodonDinoCreator?.parse(name)) {
    return '<span class="avatar dinoAvatar" title="' + escAttr(title) + '">' + window.KanbanodonDinoCreator.createSVG(name, { size: 48 }) + '</span>';
  }
  const seed = name || 'dino';
  const tooltip = title || seed;
  return '<span class="avatar" title="' + escAttr(tooltip) + '">' + esc(seed.slice(0, 2).toUpperCase()) + '</span>';
}

// Renders board selection and new-board controls.
function renderBoardSelect() {
  const select = $('#boardSelect');
  if (!select) return;
  const boards = state.boards.length ? state.boards : [state.board].filter(b => b && (b.id || b.ID));
  select.innerHTML = boards.map(b => '<option value="' + (b.id ?? b.ID) + '">' + esc(b.name ?? b.Name ?? 'Board') + '</option>').join('');
  select.disabled = boards.length === 0;
  select.value = String(currentBoardId());
  select.onchange = () => {
    if (!canLeaveDrawer()) { select.value = String(currentBoardId()); return; }
    selectedBoardId = +select.value;
    sprintSettingsStatus = '';
    timelineFocusSprint = 0;
    timelineCenterDate = null;
    localStorage.setItem('kanbanodon.boardId', selectedBoardId);
    closeDrawer(false);
    if (router) router.writeRoute('push', view, selectedBoardId, 0);
    load();
  };
  $('#newBoardBtn').onclick = showNewBoardForm;
  $('#createBoardBtn').onclick = createBoard;
  $('#cancelBoardBtn').onclick = hideNewBoardForm;
  $('#newBoardName').onkeydown = e => {
    if (e.key === 'Enter') createBoard();
    if (e.key === 'Escape') hideNewBoardForm();
  };
}

// Shows the inline form for creating a board.
function showNewBoardForm() {
  const form = $('#newBoardForm');
  form.classList.remove('hidden');
  $('#newBoardName').value = '';
  $('#newBoardName').focus();
}

// Hides and clears the new-board form.
function hideNewBoardForm() {
  const form = $('#newBoardForm');
  if (form) form.classList.add('hidden');
}

// Creates a board through the API and selects it.
async function createBoard() {
  if (!canLeaveDrawer()) return;
  const input = $('#newBoardName');
  const payload = { Name: (input.value || '').trim() || 'New Board' };
  closeDrawer(false);
  const generation = editorGeneration;
  const isCurrent = currentSessionGuard();
  const res = await api('/api/boards', { method: 'POST', body: JSON.stringify(payload) });
  if (!isCurrent()) return;
  if (generation !== editorGeneration) { await load(); return; }
  selectedBoardId = +(res.id || res.ID);
  localStorage.setItem('kanbanodon.boardId', selectedBoardId);
  hideNewBoardForm();
  view = 'board';
  timelineFocusSprint = 0;
  timelineCenterDate = null;
  if (router) router.writeRoute('push', view, selectedBoardId, 0);
  await load();
}

// Renders the global label filter options.
function renderFilters() {
  const lf = $('#labelFilter');
  const cur = lf.value;
  lf.innerHTML = '<option value="">All labels</option>' + state.labels.map(l => '<option>' + esc(l.name) + '</option>').join('');
  lf.value = cur;
  const af = $('#assigneeFilter');
  if (af) {
    const assignee = af.value;
    af.innerHTML = '<option value="">All assignees</option>' + state.users.map(u => '<option value="' + u.id + '">' + esc(u.name || u.username || 'User') + '</option>').join('');
    af.value = [...af.options].some(o => o.value === assignee) ? assignee : '';
  }
}

// Renders the parent selector for the new-ticket composer.
function renderNewParentSelect() {
  const select = $('#newParent');
  if (!select) return;
  const current = select.value || '0';
  const candidates = parentCandidates($('#newType')?.value || 'task');
  select.innerHTML = '<option value="0">No parent</option>' + candidates.map(t => '<option value="' + t.id + '">' + esc(parentOptionLabel(t)) + '</option>').join('');
  select.value = [...select.options].some(o => o.value === current) ? current : '0';
  select.disabled = candidates.length === 0;
}

// Builds the parent selector used inside the ticket drawer.
function parentSelectHtml(ticket) {
  if (isIdea(ticket)) return '';
  const options = parentCandidates(ticket.type, ticket.id).map(t => '<option value="' + t.id + '">' + esc(parentOptionLabel(t)) + '</option>').join('');
  return '<label>Parent<select id="dParent"><option value="0">No parent</option>' + options + '</select></label>';
}

// Formats parent options without exposing ticket numbers.
function parentOptionLabel(t) {
  return ticketLabel(t) + ' (' + normalizeTicketType(t.type) + ')';
}

// Refreshes the drawer parent list after type changes.
function renderDrawerParentSelect(current = null) {
  const select = $('#dParent');
  if (!select || !editing) return;
  const wanted = String(current ?? select.value ?? editing.parentId ?? 0);
  const childType = $('#dType')?.value || editing.type;
  const candidates = parentCandidates(childType, editing.id);
  select.innerHTML = '<option value="0">No parent</option>' + candidates.map(t => '<option value="' + t.id + '">' + esc(parentOptionLabel(t)) + '</option>').join('');
  select.value = [...select.options].some(o => o.value === wanted) ? wanted : '0';
  select.disabled = candidates.length === 0;
}

// Returns ids for tickets that other work items depend on.
function blockingTicketIds() {
  const ids = new Set();
  workTickets().forEach(t => (t.links || []).forEach(id => ids.add(+id)));
  return ids;
}

// Returns whether a ticket matches the dependency quick filter.
function matchesDependencyFilter(t, value, blockers = null) {
  if (value === 'blocking') return (blockers || blockingTicketIds()).has(+t.id);
  if (value === 'blocked') return unfinishedDependencies(t).length > 0;
  return true;
}

// The global filters operate on the full state; each workspace narrows it further.
function filtered() {
  const q = $('#search').value.toLowerCase();
  const typ = $('#typeFilter').value;
  const lab = $('#labelFilter').value;
  const assignee = $('#assigneeFilter')?.value || '';
  const dep = $('#dependencyFilter')?.value || '';
  const blockers = dep === 'blocking' ? blockingTicketIds() : null;
  return state.tickets.filter(t =>
    !t.archivedAt && !t.deletedAt &&
    (!q || (t.title + t.body).toLowerCase().includes(q)) &&
    (!typ || t.type === typ) &&
    (!lab || t.labels.includes(lab)) &&
    (!assignee || String(t.assigneeId || 0) === String(assignee)) &&
    matchesDependencyFilter(t, dep, blockers)
  );
}

// Applies global filters and removes backlog tickets from delivery views.
function filteredWork() {
  return filtered().filter(t => !isBacklogTicket(t));
}

// A selected Sprint is shared by the three planning views, using saved dates only.
function selectedPlanningSprint() {
  if (!['board', 'overview', 'timeline'].includes(view)) return null;
  // A routed Sprint belongs to the requested board while its state is loading.
  if (selectedBoardId && currentBoardId() && selectedBoardId !== currentBoardId()) return null;
  if (planningSprintBoardId && planningSprintBoardId !== currentBoardId()) timelineFocusSprint = 0;
  planningSprintBoardId = currentBoardId();
  const sprint = sprintByNumber(timelineFocusSprint);
  if (timelineFocusSprint && !sprint) timelineFocusSprint = 0;
  return sprint;
}

// Board and Overview retain Epic context while showing only work in this Sprint.
function sprintFilteredWork(tickets) {
  const sprint = view === 'timeline' ? null : selectedPlanningSprint();
  if (!sprint) return tickets;
  const active = workTickets();
  const visible = new Set(tickets.filter(ticket => ticket.type !== 'epic' && ticketSprint(ticket)?.number === sprint.number).map(ticket => +ticket.id));
  tickets.filter(ticket => ticket.type === 'epic' && ticketSprint(ticket)?.number === sprint.number && !descendantTickets(ticket.id, new Set(), active).length).forEach(ticket => visible.add(+ticket.id));
  for (const id of [...visible]) {
    let ticket = parentTicket(id);
    const seen = new Set();
    while (ticket?.parentId && !seen.has(+ticket.id)) {
      seen.add(+ticket.id);
      ticket = parentTicket(ticket.parentId);
      if (ticket?.type === 'epic' && active.some(item => +item.id === +ticket.id)) visible.add(+ticket.id);
    }
  }
  return active.filter(ticket => visible.has(+ticket.id));
}

// Follow both directions so a dependency view keeps the complete connected chain.
function dependencyViewIds() {
  if (!dependencyRenderSnapshot) return connectedDependencyIds();
  if (!('ids' in dependencyRenderSnapshot)) dependencyRenderSnapshot.ids = connectedDependencyIds();
  return dependencyRenderSnapshot.ids;
}

function connectedDependencyIds() {
  if (!dependencyFocusTicketId || dependencyFocusBoardId !== currentBoardId()) return null;
  const tickets = sprintFilteredWork(workTickets());
  const selected = tickets.find(ticket => +ticket.id === dependencyFocusTicketId);
  if (!selected) { dependencyFocusTicketId = 0; dependencyFocused = false; return null; }
  const neighbors = new Map();
  dependencyHoverEdges(tickets).forEach(edge => {
    if (!neighbors.has(edge.from)) neighbors.set(edge.from, new Set());
    if (!neighbors.has(edge.to)) neighbors.set(edge.to, new Set());
    neighbors.get(edge.from).add(edge.to);
    neighbors.get(edge.to).add(edge.from);
  });
  const ids = new Set([+selected.id]);
  const queue = [+selected.id];
  for (let index = 0; index < queue.length; index++) {
    for (const id of neighbors.get(queue[index]) || []) {
      if (!ids.has(id)) { ids.add(id); queue.push(id); }
    }
  }
  return ids;
}

function dependencyFocusIds() {
  return dependencyFocused ? dependencyViewIds() : null;
}

// Dependency order is temporary; saved positions and the normal sort stay intact.
function dependencyOrderSteps() {
  if (!dependencyRenderSnapshot) return calculateDependencyOrder();
  if (!('steps' in dependencyRenderSnapshot)) dependencyRenderSnapshot.steps = calculateDependencyOrder();
  return dependencyRenderSnapshot.steps;
}

function calculateDependencyOrder() {
  const ids = dependencyViewIds();
  if (!ids) return null;
  const edges = dependencyHoverEdges(sprintFilteredWork(workTickets())).filter(edge => ids.has(edge.from) && ids.has(edge.to));
  return window.KanbanodonDependencyHover?.dependencySteps(edges, dependencyFocusTicketId) || new Map([[dependencyFocusTicketId, 1]]);
}

function planningCompare(a, b, fallback) {
  if (dependencySortMode === 'normal') return fallback(a, b);
  const steps = dependencyOrderSteps();
  if (steps) {
    const first = steps.get(+a.id);
    const second = steps.get(+b.id);
    if (first && second && first !== second) return first - second;
    if (first && !second) return -1;
    if (!first && second) return 1;
  }
  return fallback(a, b);
}

function planningWork() {
  const ids = dependencyViewIds();
  if (!ids) return sprintFilteredWork(filteredWork());
  const visible = new Set(dependencyFocused ? ids : filteredWork().map(ticket => +ticket.id));
  ids.forEach(id => visible.add(id));
  ids.forEach(id => {
    let ticket = parentTicket(id);
    const seen = new Set();
    while (ticket?.parentId && !seen.has(+ticket.id)) {
      seen.add(+ticket.id);
      ticket = parentTicket(ticket.parentId);
      if (ticket?.type === 'epic' && !ticket.archivedAt && !ticket.deletedAt && !isBacklogTicket(ticket)) visible.add(+ticket.id);
    }
  });
  return sprintFilteredWork(workTickets().filter(ticket => visible.has(+ticket.id)));
}

function toggleDependencyFocus(id) {
  if (editing && !closeDrawer()) return;
  const ticket = workTickets().find(item => +item.id === +id);
  if (!ticket) return;
  dependencyFocused = !(dependencyFocusBoardId === currentBoardId() && dependencyFocusTicketId === +id && dependencyFocused);
  dependencyFocusTicketId = +id;
  dependencyFocusBoardId = currentBoardId();
  const ids = dependencyFocusIds();
  ids?.forEach(ticketId => { const epic = topEpicFor(parentTicket(ticketId)); if (epic) collapsedEpics.delete(+epic.id); });
  if (view === 'timeline') {
    timelineFocusSprint = 0;
    timelineZoom = 1;
    timelineCenterDate = null;
    syncRoute('replace', 0);
  }
  renderDependenciesKeepingPosition(id, '[data-focus-related="' + id + '"]');
}

function openDependencies(id) {
  if (editing && !closeDrawer()) return;
  if (!workTickets().some(ticket => +ticket.id === +id)) return;
  if (!dependencyViewIds()) dependencySortMode = 'dependencies';
  dependencyFocusTicketId = +id;
  dependencyFocusBoardId = currentBoardId();
  dependencyFocused = false;
  dependencyViewIds()?.forEach(ticketId => { const epic = topEpicFor(parentTicket(ticketId)); if (epic) collapsedEpics.delete(+epic.id); });
  if (view === 'timeline') {
    timelineFocusSprint = 0;
    timelineZoom = 1;
    timelineCenterDate = null;
    syncRoute('replace', 0);
  }
  renderDependenciesKeepingPosition(id, '[data-focus-related="' + id + '"]');
}

function closeDependencies() {
  const id = dependencyFocusTicketId;
  dependencyFocusTicketId = 0;
  dependencyFocused = false;
  dependencySortMode = 'dependencies';
  renderDependenciesKeepingPosition(id, '[data-dependencies="' + id + '"]');
}

function setDependencySort(mode) {
  if (!['dependencies', 'normal'].includes(mode) || mode === dependencySortMode || !dependencyViewIds()) return;
  dependencySortMode = mode;
  renderDependenciesKeepingPosition(dependencyFocusTicketId, '[data-dependency-sort]');
}

function showOtherTasks() {
  if (editing && !closeDrawer()) return;
  if (!dependencyFocused) return;
  const id = dependencyFocusTicketId;
  dependencyFocused = false;
  renderDependenciesKeepingPosition(id, '[data-focus-related="' + id + '"]');
}

// Keep the clicked row at the same visible height when the dependency order changes.
function renderDependenciesKeepingPosition(id, focusSelector) {
  const root = $('#' + view);
  const selector = view === 'timeline' ? '.ganttTaskItem[data-timeline-id="' + id + '"]' : '[data-work-id="' + id + '"]';
  const before = root?.querySelector(selector);
  const top = before?.getBoundingClientRect?.().top;
  const chart = view === 'timeline' ? root?.querySelector('.ganttChart') : null;
  const chartTop = chart?.scrollTop || 0;
  const left = root?.scrollLeft || 0;
  const tableScroll = view === 'overview' ? root?.querySelector('.tableScroll') : null;
  const tableLeft = tableScroll?.scrollLeft || 0;
  const tableExpanded = root?.querySelector('.ticketTable')?.classList.contains('showAllColumns');
  renderView();
  if (root) root.scrollLeft = left;
  if (tableScroll) {
    root?.querySelector('.ticketTable')?.classList.toggle('showAllColumns', tableExpanded);
    const columnsToggle = root?.querySelector('.overviewColumnsToggle');
    if (columnsToggle) columnsToggle.textContent = tableExpanded ? 'Show simple table' : 'Show planning columns';
    const nextTableScroll = root?.querySelector('.tableScroll');
    if (nextTableScroll) nextTableScroll.scrollLeft = tableLeft;
  }
  const nextChart = view === 'timeline' ? root?.querySelector('.ganttChart') : null;
  if (nextChart) nextChart.scrollTop = chartTop;
  const after = root?.querySelector(selector);
  const nextTop = after?.getBoundingClientRect?.().top;
  if (Number.isFinite(top) && Number.isFinite(nextTop)) {
    if (nextChart) nextChart.scrollTop += nextTop - top;
    const finalTop = after.getBoundingClientRect().top;
    if (Number.isFinite(finalTop)) window.scrollBy?.({top: finalTop - top, left: 0, behavior: 'instant'});
  }
  const action = after?.querySelector(focusSelector) || root?.querySelector(focusSelector) || after?.querySelector('[data-dependencies-back]');
  action?.focus({preventScroll:true});
}

function toggleEpic(id) {
  if (!collapsedEpics.has(+id) && [...(dependencyViewIds() || [])].some(ticketId => +(topEpicFor(parentTicket(ticketId))?.id || 0) === +id)) {
    dependencyFocusTicketId = 0;
    dependencyFocused = false;
  }
  if (collapsedEpics.has(+id)) collapsedEpics.delete(+id); else collapsedEpics.add(+id);
  renderView();
  $('#' + view)?.querySelector('[data-epic-toggle="' + id + '"]')?.focus({preventScroll:true});
}

function planningFocusHtml() {
  const ids = dependencyViewIds();
  if (!ids) return '';
  const dependencies = window.KanbanodonDependencyHover;
  const steps = dependencyOrderSteps();
  const maxStep = Math.max(1, ...Array.from(steps?.values() || []));
  const middleStep = maxStep >= 3 ? Math.ceil(maxStep / 2) : 0;
  const palette = dependencies?.stagePalette?.(maxStep) || [];
  const keys = palette.map(({step, color}) => {
    const label = step === 1 ? 'Start' : step === maxStep ? 'End' : step === middleStep ? 'Middle' : '';
    return '<span class="dependencyStageKey" data-dependency-color="' + color + '" title="Stage ' + step + (label ? ' · ' + label.toLowerCase() : '') + '"><b>' + step + '</b>' + (label ? '<em>' + label + '</em>' : '') + '</span>';
  }).join('');
  const selected = parentTicket(dependencyFocusTicketId);
  const normalOrder = view === 'overview' ? 'Table column order' : view === 'timeline' ? 'Epic hierarchy and schedule' : 'Manual order within each status';
  const orderDescription = dependencySortMode === 'dependencies' ? 'Tasks follow dependency order' : normalOrder;
  const sorting = '<label class="dependencySortControl">Sort tasks<select data-dependency-sort aria-label="Sort tasks"><option value="dependencies"' + (dependencySortMode === 'dependencies' ? ' selected' : '') + '>Dependency order</option><option value="normal"' + (dependencySortMode === 'normal' ? ' selected' : '') + '>Normal order</option></select></label>';
  const dragHint = view === 'board' && dependencySortMode === 'dependencies' ? '<small class="boardDragHint">Choose Normal order to drag cards.</small>' : '';
  return '<div class="dependencyFocusBar" role="region" aria-label="Dependency view"><div><strong>Dependencies of ' + esc(ticketRef(selected)) + ' · ' + esc(ticketLabel(selected)) + '</strong><span>' + (dependencyFocused ? 'Connected tasks only' : 'Unrelated tasks are dimmed') + ' · ' + orderDescription + '</span>' + dragHint + '</div><div class="dependencyFocusActions">' + sorting + '<button type="button" class="dependenciesBack" data-dependencies-back>Back to normal view</button></div></div><div class="dependencyGuide"><div class="dependencyStageKeys" aria-label="Dependency stages from start to end">' + keys + '</div><small>Numbers show dependency order · Arrows point to dependent tasks</small></div>';
}

function taskEditHtml(ticket) {
  const ids = dependencyViewIds();
  const selected = ids && +ticket.id === dependencyFocusTicketId;
  const focus = '<button type="button" class="dependencyAction" data-focus-related="' + ticket.id + '" aria-label="Focus tasks connected to ' + escAttr(ticket.title) + '">Focus tasks</button>';
  const restore = '<button type="button" class="dependencyAction showOtherTasks" data-show-other-tasks>Show other tasks</button>';
  const back = '<button type="button" class="dependencyAction dependenciesBack" data-dependencies-back>Back</button>';
  const dependencies = ticket.type === 'epic' ? '' : dependencyFocused && ids?.has(+ticket.id) ? (selected ? restore + back : focus + restore) : selected ? focus + back : '<button type="button" class="dependencyAction" data-dependencies="' + ticket.id + '" aria-label="Dependencies of ' + escAttr(ticket.title) + '">Dependencies</button>';
  return '<div class="taskActions"><button type="button" class="taskEdit" data-edit-ticket="' + ticket.id + '" aria-label="Edit ' + escAttr(ticket.title) + '">Edit</button>' + dependencies + '</div>';
}

function epicToggleHtml(epic, cssClass = 'epicToggle') {
  const collapsed = collapsedEpics.has(+epic.id);
  return '<button type="button" class="' + cssClass + '" data-epic-toggle="' + epic.id + '" aria-expanded="' + !collapsed + '" aria-label="' + (collapsed ? 'Expand ' : 'Collapse ') + escAttr(epic.title) + '"><span aria-hidden="true">' + (collapsed ? '▸' : '▾') + '</span> ' + esc(epic.title) + '</button>';
}

function wirePlanningActions(root) {
  root.querySelectorAll('[data-dependency-color]').forEach(node => node.style?.setProperty('--dependency-color', node.dataset.dependencyColor));
  root.querySelectorAll('[data-edit-ticket]').forEach(button => button.onclick = event => { event.stopPropagation(); openTicket(+button.dataset.editTicket); });
  root.querySelectorAll('[data-dependencies]').forEach(button => button.onclick = event => { event.stopPropagation(); openDependencies(+button.dataset.dependencies); });
  root.querySelectorAll('[data-focus-related]').forEach(button => button.onclick = event => { event.stopPropagation(); toggleDependencyFocus(+button.dataset.focusRelated); });
  root.querySelectorAll('[data-show-other-tasks]').forEach(button => button.onclick = event => { event.stopPropagation(); showOtherTasks(); });
  root.querySelectorAll('[data-dependencies-back]').forEach(button => button.onclick = event => { event.stopPropagation(); closeDependencies(); });
  root.querySelectorAll('[data-dependency-sort]').forEach(select => select.onchange = () => setDependencySort(select.value));
  root.querySelectorAll('[data-epic-toggle]').forEach(button => button.onclick = event => { event.stopPropagation(); toggleEpic(+button.dataset.epicToggle); });
}

// Applies search filtering to backlog tickets only.
function filteredBacklog() {
  return filtered().filter(isBacklogTicket);
}

// Renders navigation state and access labels for the current user.
function renderNav() {
  const adminButton = $('[data-view="admin"]');
  if (adminButton) {
    adminButton.classList.remove('hidden');
    adminButton.textContent = currentUserIsAdmin() ? 'Admin' : 'Sharing';
  }
  const accessLabel = $('#accessSectionLabel');
  if (accessLabel) accessLabel.textContent = currentUserIsAdmin() ? 'Administration' : 'Access';
  $$('.navButton').forEach(b => b.classList.toggle('active', b.dataset.view === view));
}

// Updates the workspace title and subtitle.
function setHeader(title, subtitle) {
  $('#viewTitle').textContent = title;
  $('#viewSubtitle').textContent = subtitle || '';
}

// Shows and renders the currently active workspace view.
// Reuse the graph only within this synchronous render; later edits always recompute it.
function withDependencySnapshot(renderContent) {
  if (dependencyRenderSnapshot) return renderContent();
  dependencyRenderSnapshot = {};
  try { return renderContent(); }
  finally { dependencyRenderSnapshot = null; }
}

function renderView() {
  return withDependencySnapshot(renderActiveView);
}

function renderActiveView() {
  $$('#board,#overview,#list,#timeline,#admin,#config,#stash').forEach(x => x.classList.add('hidden'));
  $('.composer').classList.toggle('hidden', view !== 'board');
  renderNav();
  if (selectedBoardId && currentBoardId() && selectedBoardId !== currentBoardId()) {
    $('.composer').classList.add('hidden');
    setHeader('Loading board', 'Please wait while the selected board loads.');
    if (typeof renderTaskTools === 'function') renderTaskTools();
    return;
  }
  if (view === 'board') renderBoard();
  if (view === 'overview') renderOverview();
  if (view === 'backlog') renderBacklog();
  if (view === 'timeline') renderTimeline();
  if (view === 'admin') renderAdmin();
  if (view === 'config') renderConfig();
  if (view === 'archive' || view === 'trash') renderStash();
  if (typeof renderTaskTools === 'function') renderTaskTools();
}

// Renders the kanban board with Epic swimlanes.
function renderBoard() {
  setHeader(state.board?.name || 'Board', 'Plan and move tickets.');
  const root = $('#board');
  root.classList.remove('hidden');
  if (!currentBoardId()) {
    root.innerHTML = '<section class="panel emptyBoard"><h2>Welcome to Kanbanodon</h2><p class="muted">Create your first board to start organizing tasks, or ask a colleague to share theirs.</p><button type="button" id="firstBoardBtn">Create first board</button></section>';
    $('#firstBoardBtn').onclick = () => $('#newBoardBtn').click();
    return;
  }
  const tickets = planningWork();
  root.innerHTML = sprintPlannerHtml(workTickets()) + (backlogTickets().length ? boardBacklogPickerHtml() : '') + planningFocusHtml() + boardSwimlanes(tickets);
  wireSprintPlanner();
  wireBoardBacklogPicker();
  wireDnD();
  wirePlanningActions(root);
  wireWorkDependencies(root, tickets);
}

// Builds the board-level sprint cadence editor and its calculated sprint preview.
function sprintPlannerHtml(tickets) {
  const start = boardSprintStartValue();
  const weeks = boardSprintWeeks();
  const draft = currentSprintCadenceDraft();
  const status = draft ? 'Unsaved changes' : sprintSettingsStatus || (start ? 'Cadence saved' : '');
  return '<section class="panel sprintPlanner" data-sprint-view="board"><div class="planningPanelHeader"><div><h2>Sprints</h2><p>Set the first Sprint once. Every following Sprint continues automatically.</p></div><div class="sprintSettings"><label><span>First Sprint starts</span><input id="sprintStartDate" type="date" value="' + escAttr(draft ? draft.start : start) + '"></label><label><span>Duration</span><span class="sprintDurationField"><input id="sprintWeeks" type="number" min="1" max="52" step="1" value="' + escAttr(draft ? draft.weeks : weeks) + '"><em>weeks</em></span></label><button id="saveSprintSettings" type="button">Save Sprint plan</button></div></div>' + sprintSelectionHtml('board') + '<div class="sprintPreview" data-sprint-mode="editable">' + sprintPreviewHtml(tickets, start, weeks) + '</div><div class="sprintPlannerFeedback"><p id="sprintSettingsError" class="formError" role="alert"></p><span id="sprintSettingsStatus" class="sprintSettingsStatus" data-state="' + (status === 'Unsaved changes' ? 'unsaved' : status ? 'saved' : '') + '">' + esc(status) + '</span></div></section>';
}

// The same saved Sprint strip filters work views and focuses only dates in Timeline.
function sprintNavigationHtml(tickets, targetView = view) {
  const start = boardSprintStartValue();
  const weeks = boardSprintWeeks();
  const help = targetView === 'timeline' ? 'Choose a Sprint to focus its dates. All tasks stay in the timeline.' : 'Choose a Sprint to show its tasks.';
  return '<section class="panel sprintNavigation" data-sprint-view="' + escAttr(targetView) + '"><div class="planningPanelHeader"><div><h2>Sprints</h2><p>' + help + '</p></div></div>' + sprintSelectionHtml(targetView) + '<div class="sprintPreview" data-sprint-mode="readonly">' + sprintPreviewHtml(tickets, start, weeks, startOfDay(new Date()), false, targetView) + '</div></section>';
}

// Keep the active filter visible even when browsing another six-card Sprint window.
function sprintSelectionHtml(targetView = view) {
  const selected = selectedPlanningSprint();
  const summary = selected ? (targetView === 'timeline' ? 'Focused on ' : 'Showing tasks in ') + sprintName(selected) : targetView === 'timeline' ? 'Full timeline' : 'All tasks';
  return '<div class="sprintSelection"><button class="sprintAll' + (selected ? '' : ' selected') + '" data-sprint-all type="button" aria-pressed="' + !selected + '">All sprints</button><span class="sprintSelectionSummary" aria-live="polite">' + esc(summary) + '</span></div>';
}

function wireSprintNavigation(root) {
  wireSprintCards(!!boardSprintStartValue(), root, false);
}

// Builds six saved Sprints with previous/next controls and explains unscheduled work.
function sprintPreviewHtml(tickets, startValue, weeksValue, today = startOfDay(new Date()), editable = true, targetView = view) {
  const start = parseDate(startValue);
  if (!start) return '<span class="sprintPreviewNote">Choose the first Sprint start date.</span>';
  const weeks = validSprintWeeks(weeksValue);
  if (!weeks) return '<span class="sprintPreviewNote">Use a whole number from 1 to 52 weeks.</span>';
  const planned = tickets.map(ticketPlannedFinish).filter(validDate);
  const sprints = sprintWindow(startValue, weeks, today, 6, sprintStripFirstNumber(startValue, weeks));
  if (!sprints.length) return '<span class="sprintPreviewNote">No Sprints are available for these dates.</span>';
  const before = planned.filter(date => date < start).length;
  const unscheduled = tickets.length - planned.length;
  const notes = [];
  if (before) notes.push(before + ' scheduled item' + (before === 1 ? ' is' : 's are') + ' before Sprint 1');
  if (unscheduled) notes.push(unscheduled + ' item' + (unscheduled === 1 ? ' has' : 's have') + ' no planned date');
  const cards = sprints.map(sprint => sprintPreviewCardHtml(sprint, editable, targetView)).join('');
  const hasEarlier = sprints[0].number > 1;
  const hasLater = sprintWindow(startValue, weeks, today, 6, sprints[0].number + 6).length === 6;
  const previousTitle = hasEarlier ? 'Show earlier sprints' : 'No earlier sprints';
  const nextTitle = hasLater ? 'Show later sprints' : 'No later sprints';
  return '<div class="sprintStrip"><span class="sprintPageControl" title="' + previousTitle + '"><button class="sprintPageButton" data-sprint-page="-1" type="button" aria-label="Show earlier sprints"' + (hasEarlier ? '' : ' disabled') + '><span aria-hidden="true">‹</span></button></span><div class="sprintWindow">' + cards + '</div><span class="sprintPageControl" title="' + nextTitle + '"><button class="sprintPageButton" data-sprint-page="1" type="button" aria-label="Show later sprints"' + (hasLater ? '' : ' disabled') + '><span aria-hidden="true">›</span></button></span></div>' + (notes.length ? '<span class="sprintPreviewNote">' + esc(notes.join(' · ')) + '</span>' : '');
}

// Keep browsing on this board without leaking pages into a different session or cadence.
function sprintStripFirstNumber(startValue = boardSprintStartValue(), weeksValue = boardSprintWeeks()) {
  if (sprintStripPage && (sprintStripPage.boardId !== currentBoardId() || sprintStripPage.session !== sessionGeneration || sprintStripPage.start !== startValue || sprintStripPage.weeks !== +weeksValue)) sprintStripPage = null;
  return sprintStripPage?.firstNumber || selectedPlanningSprint()?.number || 0;
}

// Scope handlers to the visible view; small test surfaces can fall back to document.
function sprintNavigationScope(root = null) {
  const candidate = root || $('#' + view);
  return candidate?.querySelector('.sprintPreview') ? candidate : document;
}

// Browse the saved cadence without changing pending fields or the selected Sprint.
function pageSprintStrip(direction, root = null, editable = view === 'board', targetView = view) {
  const start = boardSprintStartValue();
  const weeks = boardSprintWeeks();
  const today = startOfDay(new Date());
  const sprints = sprintWindow(start, weeks, today, 6, sprintStripFirstNumber(start, weeks));
  if (!sprints.length || ![-1, 1].includes(direction)) return;
  const firstNumber = Math.max(1, sprints[0].number + direction * 6);
  if (firstNumber === sprints[0].number || sprintWindow(start, weeks, today, 6, firstNumber).length !== 6) return;
  sprintStripPage = {boardId: currentBoardId(), session: sessionGeneration, start, weeks, firstNumber};
  const scope = sprintNavigationScope(root);
  const preview = scope.querySelector('.sprintPreview');
  if (!preview) return;
  preview.innerHTML = sprintPreviewHtml(workTickets(), start, weeks, today, editable, targetView);
  wireSprintCards(!!start && (!editable || !sprintCadenceDirty()), scope, editable, targetView);
}

// Keep the current date phase separate from an explicitly selected Sprint.
function sprintPreviewCardHtml(sprint, editable = true, targetView = view) {
  const fallback = defaultSprintName(sprint.number);
  const name = sprintName(sprint);
  const phase = sprint.current ? 'Current' : sprint.next ? 'Next' : sprint.past ? 'Past' : 'Upcoming';
  const selected = selectedPlanningSprint()?.number === sprint.number;
  const phaseClass = (sprint.current ? ' current' : sprint.next ? ' next' : '') + (selected ? ' selected' : '');
  const jumpLabel = selected ? 'Show all sprints' : (targetView === 'timeline' ? 'Focus on ' : 'Show tasks in ') + name;
  const nameHtml = editable ? '<label><span>' + esc(fallback) + '<em>' + phase + '</em></span><input class="sprintNameInput" data-sprint-name="' + sprint.number + '" data-original-display="' + escAttr(name) + '" maxlength="80" value="' + escAttr(name) + '" title="Edit name · saved automatically" aria-label="Name for ' + escAttr(fallback) + '"></label>' : '<div class="sprintReadonlyInfo"><span>' + esc(fallback) + '<em>' + phase + '</em></span><strong>' + esc(name) + '</strong></div>';
  return '<article class="sprintCard' + phaseClass + '" data-sprint-card="' + sprint.number + '"><button class="sprintJump" data-sprint-jump="' + sprint.number + '" type="button" title="' + escAttr(jumpLabel) + '" aria-label="' + escAttr(jumpLabel) + '" aria-pressed="' + selected + '"><span aria-hidden="true">⌖</span></button>' + nameHtml + '<small>' + esc(shortRange(sprint.start, sprint.end)) + '</small><span class="sprintSelectedBadge">' + (selected ? 'Selected' : '') + '</span>' + (editable ? '<span class="sprintNameStatus" data-sprint-name-status="' + sprint.number + '" aria-live="polite"></span>' : '') + '</article>';
}

// Builds a compact board control for promoting work from Backlog into an Epic lane.
function boardBacklogPickerHtml() {
  const backlog = backlogTickets().sort(ticketOrder);
  if (!backlog.length) return '<section class="panel boardBacklogPicker empty"><div><h2>Backlog</h2><p>Everything is already on the board.</p></div><button type="button" id="boardBacklogOpen">Open Backlog</button></section>';
  const ticketOptions = backlog.map(t => '<option value="' + t.id + '">' + esc(ticketRef(t) + ' · ' + normalizePromotionType(t) + ' · ' + ticketLabel(t)) + '</option>').join('');
  const epicOptions = state.tickets.filter(t => !t.deletedAt && !t.archivedAt && normalizeTicketType(t.type) === 'epic').sort(ticketOrder).map(t => '<option value="' + t.id + '">' + esc(ticketRef(t) + ' · ' + ticketLabel(t)) + (isBacklogTicket(t) ? ' (Backlog)' : '') + '</option>').join('');
  return '<section class="panel boardBacklogPicker"><div><h2>Add from Backlog</h2><p>Select work and place it in an Epic lane.</p></div><select id="boardBacklogTicket" aria-label="Backlog ticket">' + ticketOptions + '</select><select id="boardBacklogEpic" aria-label="Target Epic"><option value="0">No Epic</option>' + epicOptions + '</select><button id="boardBacklogAdd" type="button">Add to board</button><button class="ghost" type="button" id="boardBacklogOpen">Open Backlog</button><p id="boardBacklogError" class="formError" role="alert"></p></section>';
}

// Opens the Backlog workspace from a compact board action.
function openBacklogView() {
  if (!canLeaveDrawer()) return;
  view = 'backlog';
  closeDrawer(false);
  renderView();
  syncRoute('push', 0);
}

// Attaches the sprint settings save action.
function wireSprintPlanner(root = $('#board')) {
  const button = $('#saveSprintSettings');
  if (!button) return;
  const boardId = currentBoardId();
  const sessionCurrent = currentSessionGuard();
  const isCurrent = () => sessionCurrent() && boardId === currentBoardId() && (!selectedBoardId || boardId === selectedBoardId);
  const startInput = $('#sprintStartDate');
  const weeksInput = $('#sprintWeeks');
  const draft = currentSprintCadenceDraft();
  startInput.value = draft ? draft.start : boardSprintStartValue();
  weeksInput.value = draft ? draft.weeks : String(boardSprintWeeks());
  const updateDraft = () => {
    if (!isCurrent()) return;
    const dirty = captureSprintCadenceDraft();
    setSprintSettingsStatus(dirty ? 'Unsaved changes' : boardSprintStartValue() ? 'Cadence saved' : '', dirty ? 'unsaved' : 'saved');
    $('#sprintSettingsError').textContent = '';
    wireSprintCards(!dirty && !!boardSprintStartValue(), root, true, 'board');
  };
  startInput.oninput = updateDraft;
  weeksInput.oninput = updateDraft;
  button.onclick = async () => {
    if (!isCurrent() || button.disabled) return;
    const start = startInput.value;
    const weeks = +weeksInput.value;
    const error = $('#sprintSettingsError');
    error.textContent = '';
    if (!start) {
      error.textContent = 'Choose the first sprint start date.';
      return;
    }
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
      error.textContent = 'Sprint length must be a whole number from 1 to 52 weeks.';
      return;
    }
    captureSprintCadenceDraft();
    try {
      button.disabled = true;
      startInput.disabled = true;
      weeksInput.disabled = true;
      button.textContent = 'Saving...';
      setSprintSettingsStatus('Saving...', 'saving');
      wireSprintCards(false, root, true, 'board');
      await api('/api/board-settings?boardId=' + encodeURIComponent(boardId), { method: 'PUT', body: JSON.stringify({ BoardID: boardId, SprintStartDate: start, SprintWeeks: weeks }) }, isCurrent);
      if (!isCurrent()) return;
      const previousState = state;
      sprintSettingsStatus = 'Cadence saved';
      await load();
      if (!isCurrent()) return;
      if (state === previousState) throw new Error('Sprint plan was saved, but could not be refreshed. Please try again.');
    } catch (err) {
      if (!isCurrent()) return;
      button.disabled = false;
      startInput.disabled = false;
      weeksInput.disabled = false;
      button.textContent = 'Save Sprint plan';
      const dirty = sprintCadenceDirty();
      setSprintSettingsStatus(dirty ? 'Unsaved changes' : boardSprintStartValue() ? 'Cadence saved' : '', dirty ? 'unsaved' : 'saved');
      wireSprintCards(!dirty && !!boardSprintStartValue(), root, true, 'board');
      error.textContent = (err.message || 'Sprint cadence could not be saved.').trim();
    }
  };
  wireSprintCards(!draft && !!boardSprintStartValue(), root, true, 'board');
}

// Keep editable fields through same-board renders without applying them to cards.
function currentSprintCadenceDraft() {
  if (!sprintCadenceDraft) return null;
  if (sprintCadenceDraft.boardId !== currentBoardId() || sprintCadenceDraft.session !== sessionGeneration) {
    sprintCadenceDraft = null;
    sprintSettingsStatus = '';
  } else if (sprintCadenceDraft.start === boardSprintStartValue() && +sprintCadenceDraft.weeks === boardSprintWeeks()) {
    sprintCadenceDraft = null;
    sprintSettingsStatus = boardSprintStartValue() ? 'Cadence saved' : '';
  }
  return sprintCadenceDraft;
}

// Capture only this session's current-board draft, preserving even invalid input.
function captureSprintCadenceDraft() {
  const dirty = sprintCadenceDirty();
  sprintCadenceDraft = dirty ? {boardId: currentBoardId(), session: sessionGeneration, start: $('#sprintStartDate').value, weeks: $('#sprintWeeks').value} : null;
  return dirty;
}

// Draft cadence fields never change the saved Sprint cards or task assignments.
function sprintCadenceDirty() {
  const startInput = $('#sprintStartDate');
  const weeksInput = $('#sprintWeeks');
  return !!startInput && !!weeksInput && (startInput.value !== boardSprintStartValue() || +weeksInput.value !== boardSprintWeeks());
}

// Only confirmed persisted settings use the saved success styling.
function setSprintSettingsStatus(message, phase) {
  sprintSettingsStatus = message;
  const status = $('#sprintSettingsStatus');
  if (!status) return;
  status.textContent = message;
  status.dataset.state = message ? phase : '';
}

// Bind only the visible strip, using persisted cadence even with a hidden Board draft.
function wireSprintCards(jumpEnabled, root = null, editable = true, targetView = view) {
  const boardId = currentBoardId();
  const sessionCurrent = currentSessionGuard();
  const scope = sprintNavigationScope(root);
  const isCurrent = () => sessionCurrent() && boardId === currentBoardId() && (!selectedBoardId || boardId === selectedBoardId) && view === targetView;
  [...scope.querySelectorAll('[data-sprint-all]')].forEach(button => {
    button.onclick = () => { if (isCurrent()) clearPlanningSprint(); };
  });
  [...scope.querySelectorAll('.sprintPageButton')].forEach(button => {
    button.onclick = () => {
      if (!button.disabled && isCurrent()) pageSprintStrip(+button.dataset.sprintPage, scope, editable, targetView);
    };
  });
  [...scope.querySelectorAll('.sprintJump')].forEach(button => {
    button.disabled = !jumpEnabled;
    const selected = selectedPlanningSprint()?.number === +button.dataset.sprintJump;
    button.title = jumpEnabled ? selected ? 'Show all sprints' : (targetView === 'timeline' ? 'Focus on ' : 'Show tasks in ') + sprintName(sprintByNumber(+button.dataset.sprintJump)) : 'Save the Sprint plan before selecting a Sprint';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(selected));
    button.onclick = () => {
      if (!button.disabled && isCurrent()) selectPlanningSprint(+button.dataset.sprintJump);
    };
  });
  [...scope.querySelectorAll('[data-sprint-card]')].forEach(card => {
    card.dataset.sprintDisabled = String(!jumpEnabled);
    card.onclick = event => {
      if (event.target.closest('input, button') || !jumpEnabled || !isCurrent()) return;
      selectPlanningSprint(+card.dataset.sprintCard);
    };
  });
  if (!editable) return;
  [...scope.querySelectorAll('.sprintNameInput')].forEach(input => {
    input.disabled = !jumpEnabled;
    let saveTimer = 0;
    input.oninput = () => {
      clearTimeout(saveTimer);
      if (input.disabled) return;
      const status = scope.querySelector('[data-sprint-name-status="' + input.dataset.sprintName + '"]');
      if (status) status.textContent = 'Unsaved';
      saveTimer = setTimeout(() => saveSprintName(input, boardId, sessionCurrent), 450);
    };
    input.onkeydown = event => {
      if (event.key === 'Enter') {
        clearTimeout(saveTimer);
        saveSprintName(input, boardId, sessionCurrent);
      }
      if (event.key === 'Escape') {
        clearTimeout(saveTimer);
        input.value = input.dataset.originalDisplay || defaultSprintName(+input.dataset.sprintName);
        input.blur();
      }
    };
    input.onchange = () => {
      clearTimeout(saveTimer);
      saveSprintName(input, boardId, sessionCurrent);
    };
  });
}

// Persists one inline Sprint name and refreshes all visible Sprint labels.
async function saveSprintName(input, boardId = currentBoardId(), sessionCurrent = currentSessionGuard()) {
  const isCurrent = () => sessionCurrent() && boardId === currentBoardId() && (!selectedBoardId || boardId === selectedBoardId);
  if (!isCurrent() || input.disabled || !boardSprintStartValue() || sprintCadenceDirty()) return;
  const number = +input.dataset.sprintName;
  const fallback = defaultSprintName(number);
  const display = input.value.trim() || fallback;
  const name = display === fallback ? '' : display;
  const status = document.querySelector('[data-sprint-name-status="' + number + '"]');
  if (display === input.dataset.originalDisplay) return;
  input.disabled = true;
  if (status) status.textContent = 'Saving…';
  try {
    await api('/api/sprint-names?boardId=' + encodeURIComponent(boardId), { method: 'PUT', body: JSON.stringify({ BoardID: boardId, SprintNumber: number, Name: name }) }, isCurrent);
    if (!isCurrent()) return;
    state.sprintNames = (state.sprintNames || []).filter(item => +item.sprintNumber !== number);
    if (name) state.sprintNames.push({ sprintNumber: number, name });
    if (sprintCadenceDirty()) {
      input.dataset.originalDisplay = display;
      if (status) status.textContent = '';
      return;
    }
    sprintSettingsStatus = 'Sprint name saved';
    if (['board', 'overview', 'timeline'].includes(view)) renderView();
  } catch (err) {
    if (!isCurrent()) return;
    input.disabled = sprintCadenceDirty() || !boardSprintStartValue();
    input.value = input.dataset.originalDisplay || fallback;
    if (status) status.textContent = (err.message || 'Could not save').trim();
  }
}

// Select within the current view; choosing the same Sprint returns to all work.
function selectPlanningSprint(number) {
  if ((selectedBoardId && selectedBoardId !== currentBoardId()) || !['board', 'overview', 'timeline'].includes(view) || !sprintByNumber(number) || !canLeaveDrawer()) return;
  applyPlanningSprintSelection(selectedPlanningSprint()?.number === +number ? 0 : +number);
}

function clearPlanningSprint() {
  if ((selectedBoardId && selectedBoardId !== currentBoardId()) || !['board', 'overview', 'timeline'].includes(view) || !canLeaveDrawer()) return;
  applyPlanningSprintSelection(0);
}

function applyPlanningSprintSelection(number) {
  const range = sprintByNumber(number);
  dependencyFocusTicketId = 0;
  dependencyFocusBoardId = 0;
  timelineFocusSprint = number;
  planningSprintBoardId = currentBoardId();
  dependencyFocused = false;
  timelineZoom = 1;
  timelineCenterDate = range ? addDays(range.start, Math.floor(dayDiff(range.start, range.endExclusive) / 2)) : null;
  if (view === 'timeline') timelineEpicFilter = 'all';
  const window = sprintWindow(boardSprintStartValue(), boardSprintWeeks(), startOfDay(new Date()), 6, sprintStripFirstNumber());
  if (!number || !window.some(sprint => sprint.number === number)) sprintStripPage = null;
  closeDrawer(false);
  renderView();
  syncRoute('push', 0);
}

// Explicit Timeline links remain available independently of the in-view selector.
function jumpToSprint(number) {
  if (!sprintByNumber(number) || !canLeaveDrawer()) return;
  view = 'timeline';
  applyPlanningSprintSelection(+number);
}

// Keeps the target Epic selector useful for both Epic and regular backlog items.
function wireBoardBacklogPicker() {
  const openButton = $('#boardBacklogOpen');
  if (openButton) openButton.onclick = openBacklogView;
  const ticketSelect = $('#boardBacklogTicket');
  const epicSelect = $('#boardBacklogEpic');
  const button = $('#boardBacklogAdd');
  if (!ticketSelect || !epicSelect || !button) return;
  const sync = () => {
    const ticket = parentTicket(+ticketSelect.value);
    const isEpic = normalizePromotionType(ticket) === 'epic';
    epicSelect.disabled = isEpic;
    button.textContent = isEpic ? 'Add Epic and its work' : 'Add to board';
    const currentEpic = ticket ? topEpicFor(ticket) : null;
    if (!isEpic && currentEpic) epicSelect.value = String(currentEpic.id);
  };
  ticketSelect.onchange = sync;
  sync();
  button.onclick = async () => {
    const ticket = parentTicket(+ticketSelect.value);
    const error = $('#boardBacklogError');
    error.textContent = '';
    try {
      await promoteBacklogTicket(ticket, +epicSelect.value || 0);
    } catch (err) {
      error.textContent = (err.message || 'Backlog work could not be added.').trim();
    }
  };
}

// Builds the full swimlane board for the filtered tickets.
function boardSwimlanes(tickets) {
  const lanes = boardSwimlaneData(tickets);
  const columns = dependencyFocusIds() ? state.columns.filter(column => tickets.some(ticket => ticket.type !== 'epic' && +ticket.columnId === +column.id)) : state.columns;
  const visibleColumns = columns.length ? columns : state.columns;
  if (!lanes.length) return '<section class="panel emptyBoard"><h2>' + (workTickets().length ? 'No matching tasks' : 'Your board is ready') + '</h2><p class="muted">' + (workTickets().length ? 'Clear the filters to see all tasks.' : 'Enter a title above to create your first task. No planning setup is required.') + '</p><button id="boardEmptyAction" type="button">' + (workTickets().length ? 'Reset filters' : 'Create first task') + '</button></section><section class="emptyColumns">' + state.columns.map(c => '<div class="panel"><h3>' + esc(c.name) + '</h3><span class="muted">No tasks</span></div>').join('') + '</section>';
  const colClass = 'cols' + Math.max(1, Math.min(8, visibleColumns.length || 1)) + (lanes.every(lane => !lane.epic) ? ' simpleBoard' : '');
  const counts = visibleColumns.map(c => lanes.reduce((sum, lane) => sum + boardLaneColumnItems(lane, c.id).length, 0));
  return '<section class="boardSwimlanes ' + colClass + '"><div class="boardLane boardLaneHeader"><div class="boardLaneEpicHead">Epic</div>' + visibleColumns.map((c, index) => '<div class="boardLaneColumnHead" data-col="' + c.id + '">' + esc(c.name) + ' <span>' + counts[index] + '</span></div>').join('') + '</div>' + lanes.map(lane => boardSwimlane(lane, visibleColumns)).join('') + '</section>';
}

// Groups filtered tickets into visual Epic swimlanes.
function boardSwimlaneData(tickets) {
  const groups = new Map();
  const standalone = [];
  tickets.forEach(t => {
    const epic = topEpicFor(t);
    if (!epic) {
      if (t.type !== 'epic') standalone.push(t);
      return;
    }
    const key = String(epic.id);
    if (!groups.has(key)) groups.set(key, { epic, items: [] });
    if (+t.id !== +epic.id) groups.get(key).items.push(t);
  });
  // Swimlanes are a board view concern; the ticket parent remains the single source of hierarchy.
  const lanes = [...groups.values()].sort((a, b) => ticketOrder(a.epic, b.epic));
  if (standalone.length) lanes.push({ epic: null, items: standalone.sort(boardGroupSort) });
  return lanes;
}

// Builds one Epic swimlane row across all board columns.
function boardSwimlane(lane, columns = state.columns) {
  const epicId = lane.epic ? lane.epic.id : 0;
  const collapsed = epicId && collapsedEpics.has(+epicId);
  return '<div class="boardLane' + (collapsed ? ' epicCollapsed' : '') + '">' + boardLaneEpicCell(lane) + columns.map(c => {
    const items = boardLaneColumnItems(lane, c.id);
    return '<div class="boardLaneCell">' + (collapsed ? '<span class="collapsedCount">' + items.length + ' task' + (items.length === 1 ? '' : 's') + '</span>' : '<div class="drop boardLaneDrop" data-col="' + c.id + '" data-epic="' + epicId + '">' + items.map(card).join('') + '</div>') + '</div>';
  }).join('') + '</div>';
}

// Builds the sticky Epic cell at the left of a swimlane.
function boardLaneEpicCell(lane) {
  if (!lane.epic) {
    return '<div class="boardLaneEpic boardLaneStandalone"><strong>No epic</strong><span>' + lane.items.length + ' item' + (lane.items.length === 1 ? '' : 's') + '</span></div>';
  }
  return '<div class="boardLaneEpic" data-work-id="' + lane.epic.id + '" tabindex="0"><span>Epic</span>' + epicToggleHtml(lane.epic) + '<em>' + lane.items.length + ' child item' + (lane.items.length === 1 ? '' : 's') + '</em><small>' + esc(columnName(lane.epic.columnId)) + '</small>' + taskEditHtml(lane.epic) + '</div>';
}

// Returns the cards that belong in one swimlane column.
function boardLaneColumnItems(lane, columnId) {
  return lane.items.filter(t => t.columnId == columnId).sort(boardGroupSort);
}

// Board order follows saved positions; dependency sorting is a display choice.
function boardGroupSort(a, b) {
  return planningCompare(a, b, boardNormalGroupSort);
}

function boardNormalGroupSort(a, b) {
  return (+a.position || 0) - (+b.position || 0) || boardRefCompare(String(a.ref || a.id), String(b.ref || b.id)) || (+a.id || 0) - (+b.id || 0);
}

// Keep import reference ties identical to the server's manual Board ordering.
function boardRefCompare(first, second) {
  const fold = value => String(value).replace(/[A-Z]/g, char => char.toLowerCase());
  const a = fold(first).match(/[0-9]+|[^0-9]+/g) || [];
  const b = fold(second).match(/[0-9]+|[^0-9]+/g) || [];
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    let left = a[index], right = b[index];
    if (/^[0-9]+$/.test(left) && /^[0-9]+$/.test(right)) {
      left = left.replace(/^0+/, '') || '0'; right = right.replace(/^0+/, '') || '0';
      if (left.length !== right.length) return left.length - right.length;
    }
    if (left !== right) {
      const firstPoints = [...left].map(char => char.codePointAt(0));
      const secondPoints = [...right].map(char => char.codePointAt(0));
      for (let i = 0; i < Math.min(firstPoints.length, secondPoints.length); i++) {
        if (firstPoints[i] !== secondPoints[i]) return firstPoints[i] - secondPoints[i];
      }
      return firstPoints.length - secondPoints.length;
    }
  }
  return a.length - b.length;
}

// Finds the Done column by name.
function doneColumn() {
  return state.columns.find(c => /done/i.test(c.name));
}

// Resolves dependency ids into ticket objects.
function dependencyTickets(t) {
  return (t.links || []).map(id => state.tickets.find(x => x.id == id)).filter(item => item && !item.deletedAt);
}

// Returns work items that directly depend on the given ticket.
function dependentTickets(t) {
  return state.tickets.filter(candidate => !candidate.deletedAt && !candidate.archivedAt && !isIdea(candidate) && (candidate.links || []).some(id => +id === +t.id)).sort(ticketOrder);
}

// Returns dependencies that are not yet in the Done column.
function unfinishedDependencies(t) {
  const done = doneColumn();
  return dependencyTickets(t).filter(dep => !done || dep.columnId != done.id);
}

// Starting work is allowed; Review and subsequent workflow stages need completed prerequisites.
function columnRequiresCompletedDependencies(columnId) {
  const target = state.columns.find(column => +column.id === +columnId);
  if (!target) return false;
  const name = String(target.name || '').trim().toLowerCase();
  if (['to do', 'backlog', 'ready', 'in progress'].includes(name)) return false;
  if (['review', 'done'].includes(name)) return true;
  const review = state.columns.find(column => String(column.name || '').trim().toLowerCase() === 'review');
  if (review) return +target.position >= +review.position;
  const progress = state.columns.find(column => String(column.name || '').trim().toLowerCase() === 'in progress');
  return progress ? +target.position > +progress.position : +target.position >= 3;
}

// Match the server's move check, including freely reordering within the current column.
function boardMoveBlockedTasks(ticket, columnId) {
  if (+ticket.columnId === +columnId || !columnRequiresCompletedDependencies(columnId)) return [];
  return [...new Map(dependencyTickets(ticket).filter(dependency => {
    const column = state.columns.find(item => +item.id === +dependency.columnId);
    return column && String(column.name || '').trim().toLowerCase() !== 'done';
  }).map(dependency => [+dependency.id, dependency])).values()];
}

function boardMoveBlockedReason(columnId, blocked) {
  return 'Cannot move to ' + columnName(columnId) + '. Finish these prerequisites first:\n' +
    blocked.map(ticket => ticketRef(ticket) + ' ' + ticket.title).join('\n');
}

// Returns the normalized duration in days for a ticket.
function ticketDuration(t) {
  return Math.max(0, +(t.duration ?? t.points ?? 0) || 0);
}

// Formats a ticket duration for badges and tables.
function durationLabel(t) {
  const days = ticketDuration(t);
  return days ? days + 'd' : 'No duration';
}

// Builds one draggable board card.
function card(t) {
  const blocked = unfinishedDependencies(t);
  const parent = parentTicket(t.parentId);
  const children = childCount(t.id);
  const depthClass = ' depth' + boardCardDepth(t);
  const assignee = userById(t.assigneeId);
  const assigneeName = assignee ? (assignee.name || assignee.username || 'user') : '';
  const assigneeHtml = assignee ? '<span class="cardAssignee" title="Assigned to ' + escAttr(assigneeName) + '">' + avatar(assignee.avatar, 'Assigned to ' + assigneeName) + '</span>' : '';
  const sprint = ticketSprint(t);
  const draggable = !dependencyViewIds() || dependencySortMode === 'normal';
  return '<article draggable="' + draggable + '"' + (draggable ? '' : ' title="Choose Normal order to drag cards"') + ' class="card ' + escAttr(t.type) + depthClass + (blocked.length ? ' blocked' : '') + (assignee ? ' hasAssignee' : '') + '" data-id="' + t.id + '" data-work-id="' + t.id + '">' + assigneeHtml + '<h3>' + esc(t.title) + '</h3><div class="labels">' + t.labels.map(l => '<span class="pill">' + esc(l) + '</span>').join('') + '</div><div class="meta"><span class="pill">' + esc(t.type) + '</span>' + (parent ? '<span class="pill parentPill">under ' + esc(ticketLabel(parent)) + '</span>' : '') + (children ? '<span class="pill">' + children + ' child items</span>' : '') + (ticketDuration(t) ? '<span class="pill">' + durationLabel(t) + '</span>' : '') + (checklistProgress(t) ? '<span class="pill checklistPill" title="Checklist progress">' + checklistProgress(t) + ' steps</span>' : '') + (t.dueDate ? '<span class="pill">' + esc(t.dueDate) + '</span>' : '') + (sprint ? '<span class="pill sprintPill' + (sprint.before ? ' before' : '') + '">' + esc(sprintName(sprint)) + '</span>' : '') + '</div>' + boardDependencyHtml(t, blocked) + taskEditHtml(t) + '</article>';
}

// Keeps the dependency summary on the card while hover shows direct connections.
function boardDependencyHtml(ticket, blocked = unfinishedDependencies(ticket)) {
  const dependencies = dependencyTickets(ticket);
  const dependents = dependentTickets(ticket);
  if (!dependencies.length && !dependents.length) return '';
  const count = value => value + ' task' + (value === 1 ? '' : 's');
  const needs = dependencies.length ? (blocked.length ? 'Waiting for ' + count(blocked.length) : 'Prerequisites done') : '';
  const enables = dependents.length ? 'Required by ' + count(dependents.length) : '';
  return '<div class="cardDependencyHints"><span>' + esc([needs, enables].filter(Boolean).join(' · ')) + '</span></div>';
}

// Calculates card indentation based on nested non-Epic parents.
function boardCardDepth(ticket) {
  if (!ticket.parentId || ticket.type === 'epic') return 0;
  let depth = 0;
  let current = ticket;
  const seen = new Set();
  while (current && current.parentId && !seen.has(+current.id)) {
    seen.add(+current.id);
    const parent = parentTicket(current.parentId);
    if (!parent) break;
    if (parent.type !== 'epic') depth++;
    current = parent;
  }
  return Math.min(depth, 3);
}

// Find an insertion anchor among visible cards. Hidden tasks keep their order.
function boardDropPlacement(drop, clientY, draggedId) {
  const cards = [...drop.querySelectorAll('.card')].filter(node => +node.dataset.id !== +draggedId);
  const nextIndex = cards.findIndex(node => {
    const rect = node.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  const before = nextIndex < 0 ? null : cards[nextIndex];
  const after = before ? cards[nextIndex - 1] : cards[cards.length - 1];
  const dropRect = drop.getBoundingClientRect();
  const beforeRect = before?.getBoundingClientRect();
  const afterRect = after?.getBoundingClientRect();
  const edge = beforeRect ? (afterRect ? (afterRect.bottom + beforeRect.top) / 2 : beforeRect.top - 8) : afterRect ? afterRect.bottom + 8 : dropRect.top + 14;
  return { beforeId: +(before?.dataset.id || 0), afterId: before ? 0 : +(after?.dataset.id || 0), top: Math.max(4, edge - dropRect.top + (drop.scrollTop || 0)) };
}

// Persist a minimal move rather than resending an editor snapshot of the task.
async function moveBoardTicket(ticket, columnId, placement) {
  if (selectedBoardId && selectedBoardId !== currentBoardId()) return;
  if ([...pendingTicketMutations.values()].some(binding => binding.session === sessionGeneration)) return;
  if (!closeDrawer()) return;
  const boardId = currentBoardId();
  const binding = { id: ticket.id, session: sessionGeneration };
  const sessionCurrent = currentSessionGuard();
  const isCurrent = () => sessionCurrent() && currentBoardId() === boardId && (!selectedBoardId || selectedBoardId === boardId);
  pendingTicketMutations.set(ticket.id, binding);
  showFormError('');
  try {
    await api('/api/tickets/' + ticket.id + '/move', { method: 'POST', body: JSON.stringify({ ColumnID: columnId, BeforeID: placement.beforeId, AfterID: placement.afterId }) }, isCurrent);
    if (isCurrent()) await load();
  } catch (err) {
    if (isCurrent()) showFormError((err.message || 'Ticket could not be moved.').trim());
  } finally {
    if (pendingTicketMutations.get(ticket.id) === binding) pendingTicketMutations.delete(ticket.id);
  }
}

// Attaches board card drag-and-drop, insertion preview and card click handlers.
function wireDnD() {
  const boardId = currentBoardId();
  const isCurrentBoard = () => view === 'board' && currentBoardId() === boardId && (!selectedBoardId || selectedBoardId === boardId);
  let draggedId = 0;
  let marker = null;
  let tooltip = null;
  let blockedDrop = null;
  let blockedReason = '';
  const blockedNodes = new Map();
  let suppressedClickId = 0;
  let suppressUntil = 0;
  const clearPreview = () => {
    marker?.remove(); marker = null;
    tooltip?.remove(); tooltip = null; blockedDrop = null; blockedReason = '';
    blockedNodes.forEach((description, node) => {
      node.classList.remove('boardDropBlocked');
      if (description) node.setAttribute('aria-describedby', description);
      else node.removeAttribute('aria-describedby');
    });
    blockedNodes.clear();
    $$('.boardDropTarget').forEach(node => node.classList.remove('boardDropTarget'));
  };
  const showBlockedPreview = (drop, blocked, event) => {
    const reason = boardMoveBlockedReason(+drop.dataset.col, blocked);
    if (blockedDrop !== drop || blockedReason !== reason) {
      clearPreview();
      blockedDrop = drop; blockedReason = reason;
      tooltip = document.createElement('div');
      tooltip.className = 'boardDropBlockedTooltip';
      tooltip.id = 'boardDropBlockReason';
      tooltip.setAttribute('role', 'tooltip');
      tooltip.textContent = reason;
      [drop, drop.closest('.boardLaneCell'), $('.boardLaneColumnHead[data-col="' + drop.dataset.col + '"]')].filter(Boolean).forEach(node => {
        blockedNodes.set(node, node.getAttribute('aria-describedby') || '');
        node.classList.add('boardDropBlocked');
        node.setAttribute('aria-describedby', [blockedNodes.get(node), tooltip.id].filter(Boolean).join(' '));
      });
      drop.append(tooltip);
    }
    const viewportWidth = window.innerWidth || 1024;
    const viewportHeight = window.innerHeight || 768;
    const pointerX = Number.isFinite(event.clientX) ? event.clientX : (drop.getBoundingClientRect().left || 12);
    const pointerY = Number.isFinite(event.clientY) ? event.clientY : 12;
    const box = tooltip.getBoundingClientRect?.();
    const tooltipWidth = box?.width || Math.min(420, viewportWidth - 24);
    const tooltipHeight = box?.height || 80;
    const preferredY = pointerY + 18 + tooltipHeight + 12 > viewportHeight ? pointerY - tooltipHeight - 18 : pointerY + 18;
    tooltip.style.setProperty('left', Math.max(12, Math.min(pointerX + 16, viewportWidth - tooltipWidth - 12)) + 'px');
    tooltip.style.setProperty('top', Math.max(12, Math.min(preferredY, viewportHeight - tooltipHeight - 12)) + 'px');
  };
  const emptyAction = $('#boardEmptyAction');
  if (emptyAction) emptyAction.onclick = () => { if (workTickets().length) resetTaskFilters(); else $('#newTitle').focus(); };
  $$('.card').forEach(c => {
    c.tabIndex = 0;
    c.setAttribute('role', 'group');
    c.onkeydown = event => { if (event.target === c && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openTicket(+c.dataset.id); } };
    c.ondragstart = e => {
      if (!isCurrentBoard() || (dependencyViewIds() && dependencySortMode !== 'normal') || [...pendingTicketMutations.values()].some(binding => binding.session === sessionGeneration) || e.target.closest?.('button,input,select,textarea,a')) { e.preventDefault(); return; }
      draggedId = +c.dataset.id;
      e.dataTransfer.setData('text/plain', c.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      c.classList.add('boardDragging');
    };
    c.ondragend = () => {
      suppressedClickId = draggedId; suppressUntil = Date.now() + 400;
      draggedId = 0; c.classList.remove('boardDragging'); clearPreview();
    };
    c.onclick = () => { if (+c.dataset.id !== suppressedClickId || Date.now() > suppressUntil) openTicket(+c.dataset.id); };
  });
  $$('.boardLaneEpic[data-id],.epicBoardHeader').forEach(header => header.onclick = () => openTicket(+header.dataset.id));
  $$('.drop').forEach(d => {
    d.ondragover = e => {
      const ticket = state.tickets.find(item => +item.id === draggedId);
      if (!isCurrentBoard() || !ticket || +(topEpicFor(ticket)?.id || 0) !== +d.dataset.epic || (dependencyViewIds() && dependencySortMode !== 'normal')) {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        clearPreview(); return;
      }
      e.preventDefault();
      const blocked = boardMoveBlockedTasks(ticket, +d.dataset.col);
      if (blocked.length) {
        e.dataTransfer.dropEffect = 'none';
        showBlockedPreview(d, blocked, e);
        return;
      }
      e.dataTransfer.dropEffect = 'move';
      const placement = boardDropPlacement(d, e.clientY, draggedId);
      clearPreview();
      d.classList.add('boardDropTarget');
      d.closest('.boardLaneCell')?.classList.add('boardDropTarget');
      $('.boardLaneColumnHead[data-col="' + d.dataset.col + '"]')?.classList.add('boardDropTarget');
      marker = document.createElement('div');
      marker.className = 'boardDropMarker';
      marker.setAttribute('aria-hidden', 'true');
      marker.style.setProperty('top', placement.top + 'px');
      d.append(marker);
    };
    d.ondragleave = e => { if (!d.contains(e.relatedTarget)) clearPreview(); };
    d.ondrop = async e => {
      e.preventDefault();
      const id = draggedId;
      const t = state.tickets.find(x => +x.id === id);
      const placement = t ? boardDropPlacement(d, e.clientY, id) : null;
      clearPreview();
      if (!isCurrentBoard() || !t || +(topEpicFor(t)?.id || 0) !== +d.dataset.epic || (dependencyViewIds() && dependencySortMode !== 'normal')) return;
      suppressedClickId = id; suppressUntil = Date.now() + 400;
      const blocked = boardMoveBlockedTasks(t, +d.dataset.col);
      if (blocked.length) { showFormError(boardMoveBlockedReason(+d.dataset.col, blocked)); return; }
      await moveBoardTicket(t, +d.dataset.col, placement);
    };
  });
}

// Renders board metrics, upcoming dates, and the ticket table.
function renderOverview() {
  return withDependencySnapshot(renderOverviewContent);
}

function renderOverviewContent() {
  setHeader('Overview', 'Status, planned sprints, and upcoming dates.');
  const root = $('#overview');
  root.classList.remove('hidden');
  const ts = planningWork();
  const doneCol = state.columns.find(c => /done/i.test(c.name));
  const done = ts.filter(t => doneCol && t.columnId == doneCol.id);
  const open = ts.length - done.length;
  const due = ts.filter(t => t.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
  const byType = ['epic', 'story', 'task', 'bug'].map(type => '<div class="metric"><strong>' + ts.filter(t => t.type === type).length + '</strong><span>' + type + '</span></div>').join('');
  root.innerHTML = sprintNavigationHtml(workTickets(), 'overview') + '<div class="metrics"><div class="metric"><strong>' + ts.length + '</strong><span>Tickets</span></div><div class="metric"><strong>' + open + '</strong><span>open</span></div><div class="metric"><strong>' + done.length + '</strong><span>done</span></div>' + byType + '</div><section class="panel"><h2>Upcoming dates</h2>' + (due.map(t => '<button class="row rowButton" data-open-ticket="' + t.id + '"><strong>' + esc(t.dueDate) + '</strong><span>' + esc(t.title) + '</span></button>').join('') || '<p class="muted">No due dates set</p>') + '</section>' + planningFocusHtml() + overviewTable(ts);
  wireSprintNavigation(root);
  wireOverviewControls(ts);
  if (root.querySelector('.ticketTable')) {
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'overviewColumnsToggle'; toggle.textContent = 'Show planning columns';
    toggle.onclick = () => { const expanded = root.querySelector('.ticketTable').classList.toggle('showAllColumns'); toggle.textContent = expanded ? 'Show simple table' : 'Show planning columns'; };
    root.querySelector('.tableScroll').before(toggle);
  }
  root.querySelectorAll('[data-open-ticket]').forEach(node => {
    node.onclick = () => node.matches('.ticketRow') && node.classList.contains('epic') ? toggleEpic(+node.dataset.openTicket) : openTicket(+node.dataset.openTicket);
    if (node.matches('.ticketRow')) {
      node.tabIndex = 0;
      node.onkeydown = event => { if (event.target === node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (node.classList.contains('epic')) toggleEpic(+node.dataset.openTicket); else openTicket(+node.dataset.openTicket); } };
    }
  });
  wireWorkDependencies(root, overviewRows(ts).map(row => row.ticket));
  wirePlanningActions(root);
}

// Builds the filterable overview ticket table.
function overviewTable(tickets) {
  const typeOptions = overviewTypeOptions(tickets).map(type => '<option value="' + escAttr(type) + '"' + (overviewFilters.type === type ? ' selected' : '') + '>' + esc(type) + '</option>').join('');
  const statusOptions = state.columns.map(c => '<option value="' + c.id + '"' + (String(overviewFilters.status) === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
  const rows = overviewRows(tickets);
  return '<section class="panel overviewPanel"><div class="overviewTableHeader"><h2>Ticket table</h2><div class="overviewFilters"><input id="overviewSearch" type="search" placeholder="Filter tickets" value="' + escAttr(overviewFilters.q) + '"><select id="overviewTypeFilter"><option value="">All types</option>' + typeOptions + '</select><select id="overviewStatusFilter"><option value="">All statuses</option>' + statusOptions + '</select></div></div><div class="tableScroll"><table class="ticketTable"><thead><tr>' + overviewHeader('id', 'ID') + overviewHeader('title', 'Title') + overviewHeader('type', 'Type') + overviewHeader('status', 'Status') + overviewHeader('sprint', 'Sprint') + overviewHeader('duration', 'Duration') + overviewHeader('startDate', 'Start') + overviewHeader('dueDate', 'Due') + overviewHeader('assignee', 'Assignee') + overviewHeader('milestone', 'Milestone') + overviewHeader('dependencies', 'Depends on') + overviewHeader('labels', 'Labels') + overviewHeader('updatedAt', 'Updated') + '</tr></thead><tbody>' + (rows.map(overviewRow).join('') || '<tr><td colspan="13" class="tableEmpty">No matching tickets</td></tr>') + '</tbody></table></div></section>';
}

// Builds a sortable overview table header cell.
function overviewHeader(key, label) {
  const active = overviewSort.key === key && (!dependencyViewIds() || dependencySortMode === 'normal');
  const mark = active ? (overviewSort.dir === 'asc' ? ' ^' : ' v') : '';
  return '<th><button class="tableSort" type="button" data-sort="' + key + '">' + esc(label + mark) + '</button></th>';
}

// Applies overview filters and sorting before grouping rows.
function overviewRows(tickets) {
  if (dependencyFocusIds()) return overviewGroupedRows(tickets.sort((a, b) => overviewCompare(a, b)));
  const required = dependencyViewIds();
  const q = overviewFilters.q.trim().toLowerCase();
  const rows = tickets
    .filter(t => required?.has(+t.id) || ((!overviewFilters.type || t.type === overviewFilters.type) && (!overviewFilters.status || String(t.columnId) === String(overviewFilters.status)) && (!q || overviewSearchText(t).includes(q))))
    .sort((a, b) => overviewCompare(a, b));
  return overviewGroupedRows(rows);
}

// Groups overview rows under their top-level Epic.
function overviewGroupedRows(rows) {
  const groups = new Map();
  const standalone = [];
  rows.forEach(t => {
    const epic = topEpicFor(t);
    if (!epic) {
      standalone.push({ kind: 'ticket', ticket: t, depth: 0 });
      return;
    }
    const key = String(epic.id);
    if (!groups.has(key)) groups.set(key, { epic, items: [] });
    if (+t.id !== +epic.id) groups.get(key).items.push(t);
  });
  const grouped = [...groups.values()].sort((a, b) => ticketOrder(a.epic, b.epic)).flatMap(group => {
    const childRows = group.items
      .sort((a, b) => overviewCompare(a, b))
      .map(ticket => ({ kind: 'ticket', ticket, depth: overviewHierarchyDepth(ticket, group.epic.id) }));
    return [{ kind: 'epic', ticket: group.epic, count: childRows.length }, ...(collapsedEpics.has(+group.epic.id) ? [] : childRows)];
  });
  return grouped.concat(standalone.sort((a, b) => overviewCompare(a.ticket, b.ticket)));
}

// Calculates indentation depth for overview child rows.
function overviewHierarchyDepth(ticket, epicId) {
  let depth = 0;
  let current = ticket;
  const seen = new Set();
  while (current && current.parentId && +current.parentId !== +epicId && !seen.has(+current.id)) {
    seen.add(+current.id);
    depth++;
    current = parentTicket(current.parentId);
  }
  return Math.min(depth + (ticket.parentId ? 1 : 0), 4);
}

// Builds one overview table row from a grouped row model.
function overviewRow(row) {
  if (row.kind === 'epic') return overviewEpicRow(row.ticket, row.count);
  const t = row.ticket || row;
  const deps = dependencyTickets(t).map(ticketLabel).join(', ') || 'None';
  const labels = (t.labels || []).map(l => '<span class="tableTag">' + esc(l) + '</span>').join('') || '<span class="muted">None</span>';
  const parent = parentTicket(t.parentId);
  const sprint = ticketSprint(t);
  const depthClass = ' overviewDepth' + Math.max(0, Math.min(4, +(row.depth || 0)));
  return '<tr class="ticketRow ' + escAttr(t.type || 'task') + ' overviewChildRow' + depthClass + '" data-work-id="' + t.id + '" data-open-ticket="' + t.id + '"><td>' + esc(ticketRef(t)) + '</td><td><strong>' + esc(t.title) + '</strong>' + taskEditHtml(t) + '<span class="tableSub">' + esc(parent ? 'under ' + ticketLabel(parent) : (t.body || '')) + '</span></td><td><span class="typeBadge ' + escAttr(t.type || 'task') + '">' + esc(t.type || 'task') + '</span></td><td>' + esc(columnName(t.columnId)) + '</td><td>' + sprintCellHtml(sprint) + '</td><td>' + esc(durationLabel(t)) + '</td><td>' + esc(t.startDate || '-') + '</td><td>' + esc(t.dueDate || '-') + '</td><td>' + esc(assigneeName(t.assigneeId)) + '</td><td>' + esc(milestoneName(t.milestoneId)) + '</td><td>' + esc(deps) + '</td><td><div class="tableTags">' + labels + '</div></td><td>' + esc(shortDate(t.updatedAt)) + '</td></tr>';
}

// Builds the compact Sprint label shown in Overview.
function sprintCellHtml(sprint) {
  if (!sprint) return '<span class="muted">Unscheduled</span>';
  if (sprint.before) return '<span class="overviewSprint before"><b>Before Sprint 1</b><small>Planned before cadence</small></span>';
  return '<span class="overviewSprint"><b>' + esc(sprintName(sprint)) + '</b><small>' + esc(shortRange(sprint.start, sprint.end)) + '</small></span>';
}

// Formats regular and pre-cadence Sprint assignments consistently.
function sprintName(sprint) {
  if (sprint?.before) return 'Before Sprint 1';
  if (!sprint) return '';
  return customSprintName(sprint.number) || defaultSprintName(sprint.number);
}

// Builds the overview table group header for an Epic.
function overviewEpicRow(epic, childCount) {
  const sprint = ticketSprint(epic);
  return '<tr class="ticketRow epic overviewEpicRow" data-work-id="' + epic.id + '" data-open-ticket="' + epic.id + '"><td>' + esc(ticketRef(epic)) + '</td><td colspan="12"><div class="overviewEpicHeader">' + epicToggleHtml(epic) + taskEditHtml(epic) + '<span>' + childCount + ' child item' + (childCount === 1 ? '' : 's') + (sprint ? ' · ' + esc(sprintName(sprint)) : '') + '</span></div></td></tr>';
}

// Builds searchable text for an overview row.
function overviewSearchText(t) {
  const parent = parentTicket(t.parentId);
  return [ticketRef(t), t.id, t.title, t.body, t.type, parent ? ticketLabel(parent) : '', columnName(t.columnId), t.startDate, t.dueDate, assigneeName(t.assigneeId), milestoneName(t.milestoneId), dependencySummary(t.links), (t.labels || []).join(' ')].join(' ').toLowerCase();
}

// Compares tickets according to the active overview sort.
function overviewCompare(a, b) {
  return planningCompare(a, b, overviewNormalCompare);
}

function overviewNormalCompare(a, b) {
  const key = overviewSort.key;
  const dir = overviewSort.dir === 'desc' ? -1 : 1;
  if (key === 'startDate' || key === 'dueDate' || key === 'updatedAt') {
    const aMissing = !a[key];
    const bMissing = !b[key];
    if (aMissing && !bMissing) return 1;
    if (!aMissing && bMissing) return -1;
  }
  const av = overviewSortValue(a, key);
  const bv = overviewSortValue(b, key);
  if (av < bv) return -1 * dir;
  if (av > bv) return 1 * dir;
  return (a.id - b.id) * dir;
}

// Extracts the sortable value for a given overview column.
function overviewSortValue(t, key) {
  if (key === 'id') return t.id || 0;
  if (key === 'duration') return ticketDuration(t);
  if (key === 'status') return columnName(t.columnId).toLowerCase();
  if (key === 'assignee') return assigneeName(t.assigneeId).toLowerCase();
  if (key === 'milestone') return milestoneName(t.milestoneId).toLowerCase();
  if (key === 'dependencies') return (t.links || []).length;
  if (key === 'sprint') {
    const sprint = ticketSprint(t);
    return sprint ? sprint.number : Number.MAX_SAFE_INTEGER;
  }
  if (key === 'labels') return (t.labels || []).join(', ').toLowerCase();
  if (key === 'startDate' || key === 'dueDate' || key === 'updatedAt') return t[key] || '9999-99-99';
  return String(t[key] ?? '').toLowerCase();
}

// Builds the type filter options for the overview table.
function overviewTypeOptions(tickets) {
  return [...new Set(['epic', 'story', 'task', 'bug', ...tickets.map(t => t.type).filter(Boolean)])];
}

// Attaches overview filter and sorting handlers.
function wireOverviewControls(tickets) {
  const search = $('#overviewSearch');
  const type = $('#overviewTypeFilter');
  const status = $('#overviewStatusFilter');
  if (search) search.oninput = () => { overviewFilters.q = search.value; renderOverview(); };
  if (type) type.onchange = () => { overviewFilters.type = type.value; renderOverview(); };
  if (status) status.onchange = () => { overviewFilters.status = status.value; renderOverview(); };
  $$('.tableSort').forEach(btn => btn.onclick = () => {
    const key = btn.dataset.sort;
    overviewSort = overviewSort.key === key ? { key, dir: overviewSort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'dueDate' || key === 'startDate' ? 'asc' : 'asc' };
    if (dependencyViewIds()) {
      dependencySortMode = 'normal';
      renderDependenciesKeepingPosition(dependencyFocusTicketId, '[data-sort="' + key + '"]');
    } else renderOverview();
  });
}

// Lists dependency edges in their natural prerequisite-to-dependent direction.
function dependencyHoverEdges(tickets) {
  const active = ticket => !ticket.deletedAt && !ticket.archivedAt && !isIdea(ticket);
  const visible = new Set(tickets.filter(active).map(ticket => +ticket.id));
  return tickets.filter(active).flatMap(ticket => (ticket.links || [])
    .filter(id => visible.has(+id) && +id !== +ticket.id)
    .map(id => ({ from: +id, to: +ticket.id })));
}

// Draws the explicitly opened task's connected dependency chain in place.
function wireWorkDependencies(root, tickets) {
  const layerRoot = root.querySelector('.boardSwimlanes,.tableScroll');
  window.KanbanodonDependencyHover?.wire(root, {
    nodesSelector: '.boardSwimlanes [data-work-id],.ticketTable [data-work-id]',
    idAttribute: 'data-work-id',
    layerRoot,
    routeClearance: layerRoot?.classList.contains('boardSwimlanes') ? 12 : 4,
    layout: layerRoot?.classList.contains('boardSwimlanes') ? 'board' : 'overview',
    gutterWidth: 88,
    selectedId: dependencyViewIds() ? dependencyFocusTicketId : 0,
    labelsById: Object.fromEntries(tickets.map(ticket => [ticket.id, ticket.title])),
    edges: dependencyHoverEdges(tickets),
  });
}

// Returns the display name for a column id.
function columnName(id) {
  return state.columns.find(c => c.id == id)?.name || '-';
}

// Returns the display name for a user id.
function assigneeName(id) {
  return state.users.find(u => u.id == id)?.name || 'Unassigned';
}

// Returns the display name for a milestone id.
function milestoneName(id) {
  return state.milestones.find(m => m.id == id)?.name || 'None';
}

// Formats an ISO date-time as a short date string.
function shortDate(v) {
  if (!v) return '-';
  const d = parseDate(v);
  return d ? fmtIsoDate(d) : String(v).slice(0, 10);
}

// Renders the lightweight product backlog, grouped around Epics.
function renderBacklog() {
  setHeader('Backlog', 'Shape upcoming work before it moves onto the board.');
  const root = $('#list');
  root.classList.remove('hidden');
  root.classList.remove('ideasView');
  root.classList.add('backlogView');
  const rows = filteredBacklog();
  const count = rows.length + ' item' + (rows.length === 1 ? '' : 's');
  root.innerHTML = backlogComposerHtml() + '<section class="backlogList"><div class="backlogListHeader"><div><h2>Product backlog</h2><p>Epics stay together; individual work can be assigned as it moves.</p></div><span>' + count + '</span></div>' + (rows.length ? backlogGroupsHtml(rows) : '<div class="backlogEmpty">Your backlog is clear.</div>') + '</section>';
  $('#backlogCreateBtn').onclick = createBacklogTicket;
  $('#backlogType').onchange = syncBacklogComposer;
  syncBacklogComposer();
  wireBacklogActions(root);
}

// Builds the compact backlog composer with an optional Epic assignment.
function backlogComposerHtml() {
  const epics = state.tickets.filter(t => !t.deletedAt && !t.archivedAt && normalizeTicketType(t.type) === 'epic').sort(ticketOrder);
  const epicOptions = epics.map(t => '<option value="' + t.id + '">' + esc(ticketRef(t) + ' · ' + ticketLabel(t)) + (isBacklogTicket(t) ? '' : ' (on board)') + '</option>').join('');
  return '<section class="panel backlogComposer"><div class="backlogComposerHeader"><div><h2>Add backlog item</h2><p>Capture a task now; add details when you need them.</p></div><span>' + esc(state.board?.name || 'Board') + '</span></div><div class="backlogQuickAdd"><label>Title<input id="backlogTitle" placeholder="What should be done?"></label><button id="backlogCreateBtn" class="primaryAction" type="button">Add to Backlog</button></div><details class="editorMore"><summary>More details</summary><div class="backlogComposerGrid"><label>Type<select id="backlogType"><option value="task">Task</option><option value="story">Story</option><option value="bug">Bug</option><option value="epic">Epic</option></select></label><label>Epic<select id="backlogParent"><option value="0">No Epic</option>' + epicOptions + '</select></label><label>Duration (days)<input id="backlogDuration" type="number" min="0" max="365" placeholder="Days"></label><label>Due date<input id="backlogDue" type="date"></label><label class="backlogNotes">Notes<textarea id="backlogBody" placeholder="Context or acceptance notes"></textarea></label></div></details><p id="backlogError" class="formError" role="alert"></p></section>';
}

// Disables Epic assignment when the backlog item itself is an Epic.
function syncBacklogComposer() {
  const isEpic = $('#backlogType')?.value === 'epic';
  if ($('#backlogParent')) {
    $('#backlogParent').disabled = isEpic;
    if (isEpic) $('#backlogParent').value = '0';
  }
}

// Groups backlog items beneath their Epic, followed by unassigned work.
function backlogGroupsHtml(rows) {
  const rowIds = new Set(rows.map(t => +t.id));
  const groups = new Map();
  const standalone = [];
  rows.forEach(t => {
    const epic = t.type === 'epic' ? t : topEpicFor(t);
    if (!epic) {
      standalone.push(t);
      return;
    }
    if (!groups.has(+epic.id)) groups.set(+epic.id, { epic, items: [] });
    if (+t.id !== +epic.id) groups.get(+epic.id).items.push(t);
  });
  const sections = [...groups.values()].sort((a, b) => ticketOrder(a.epic, b.epic)).map(group => backlogEpicGroupHtml(group, rowIds));
  if (standalone.length) sections.push('<section class="backlogGroup standalone"><div class="backlogGroupHeader"><div><span>Unassigned</span><h3>No Epic</h3></div><small>' + standalone.length + ' item' + (standalone.length === 1 ? '' : 's') + '</small></div><div class="backlogRows">' + standalone.sort(ticketOrder).map(backlogRowHtml).join('') + '</div></section>');
  return '<div class="backlogGroups">' + sections.join('') + '</div>';
}

// Builds one Epic section, whether the Epic itself is in Backlog or already on the board.
function backlogEpicGroupHtml(group, visibleIds) {
  const epicInBacklog = visibleIds.has(+group.epic.id) && isBacklogTicket(group.epic);
  const action = epicInBacklog ? '<button class="backlogPromoteEpic" data-backlog-id="' + group.epic.id + '" type="button">Add Epic and work to board</button>' : '<span class="backlogOnBoard">Epic on board</span>';
  return '<section class="backlogGroup epic"><div class="backlogGroupHeader"><button class="backlogEpicTitle" type="button" data-open-ticket="' + group.epic.id + '"><span>Epic ' + esc(ticketRef(group.epic)) + '</span><h3>' + esc(ticketLabel(group.epic)) + '</h3></button><div><small>' + group.items.length + ' backlog item' + (group.items.length === 1 ? '' : 's') + '</small>' + action + '</div></div><div class="backlogRows">' + (group.items.map(backlogRowHtml).join('') || '<div class="backlogGroupEmpty">No child work in Backlog yet.</div>') + '</div></section>';
}

// Builds one slim Jira-style backlog row with inline Epic placement.
function backlogRowHtml(t) {
  const epics = state.tickets.filter(epic => !epic.deletedAt && !epic.archivedAt && epic.type === 'epic' && +epic.id !== +t.id).sort(ticketOrder);
  const currentEpicId = +(topEpicFor(t)?.id || 0);
  const options = '<option value="0">No Epic</option>' + epics.map(epic => '<option value="' + epic.id + '"' + (currentEpicId === +epic.id ? ' selected' : '') + '>' + esc(ticketLabel(epic)) + (isBacklogTicket(epic) ? ' (Backlog)' : '') + '</option>').join('');
  const type = normalizePromotionType(t);
  const meta = [ticketRef(t), type, durationLabel(t), t.dueDate || 'No target date'].map(esc).join('<span aria-hidden="true">·</span>');
  return '<article class="backlogRow ' + escAttr(type) + '" data-id="' + t.id + '"><button class="backlogRowMain" data-open-ticket="' + t.id + '" type="button"><span class="typeBadge ' + escAttr(type) + '">' + esc(type) + '</span><strong>' + esc(ticketLabel(t)) + '</strong><span class="backlogRowMeta">' + meta + '</span></button><select class="backlogRowEpic" data-backlog-epic="' + t.id + '" aria-label="Epic for ' + escAttr(ticketLabel(t)) + '"' + (type === 'epic' ? ' disabled' : '') + '>' + options + '</select><button class="backlogPromote" data-backlog-id="' + t.id + '" type="button">Add to board</button></article>';
}

// Attaches backlog row, Epic, and promotion actions.
function wireBacklogActions(root) {
  root.querySelectorAll('[data-open-ticket]').forEach(button => button.onclick = () => openTicket(+button.dataset.openTicket));
  root.querySelectorAll('.backlogPromote,.backlogPromoteEpic').forEach(button => button.onclick = async () => {
    const ticket = parentTicket(+button.dataset.backlogId);
    const epicId = +(root.querySelector('[data-backlog-epic="' + ticket.id + '"]')?.value || 0);
    try {
      await promoteBacklogTicket(ticket, epicId);
    } catch (err) {
      $('#backlogError').textContent = (err.message || 'Backlog work could not be added.').trim();
    }
  });
}

const GANTT_LEFT_PAD = 88;
const GANTT_RIGHT_PAD = 16;
const timelineFitObservers = new WeakMap();

// Renders the Timeline view or an error message.
function renderTimeline() {
  setHeader('Timeline', 'Scheduled work, deadlines, and sprint planning.');
  const root = $('#timeline');
  root.classList.remove('hidden');
  try {
    renderGantt(root);
  } catch (err) {
    root.innerHTML = '<div class="event muted">Timeline could not be calculated: ' + esc(err.message || err) + '</div>';
  }
}

// Calculates and renders the Gantt chart for scheduled work.
function renderGantt(root) {
  return withDependencySnapshot(() => renderGanttContent(root));
}

function renderGanttContent(root) {
  timelineFitObservers.get(root)?.disconnect();
  timelineFitObservers.delete(root);
  // Only promoted, scheduled delivery work reaches the timeline.
  const controls = sprintNavigationHtml(workTickets(), 'timeline') + timelineControlsHtml();
  const tasks = buildGanttRows();
  const focusRange = dependencyTimelineRange(tasks) || sprintByNumber(timelineFocusSprint);
  if (!tasks.length && !focusRange) {
    root.innerHTML = controls + '<div class="event muted">No tickets with schedulable dates yet</div>';
    wireTimelineControls(root);
    return;
  }
  tasks.forEach((task, index) => task.row = index);

  const taskColumnWidth = root.clientWidth < 900 ? 230 : 320;
  const availableTimelineWidth = Math.max(520, root.clientWidth - taskColumnWidth - 32);
  const focusCenter = focusRange ? addDays(focusRange.start, Math.floor(dayDiff(focusRange.start, focusRange.endExclusive) / 2)) : null;
  let geometry = timelineGeometry(tasks, focusRange, availableTimelineWidth);
  const {rangeStart, rangeEnd, totalDays} = geometry;
  // Leave room for wrapped actions and long titles in the narrow task pane.
  const rowHeight = root.clientWidth > 0 && root.clientWidth < 620 ? 188 : root.clientWidth > 0 && root.clientWidth < 900 ? 156 : 120;
  const headHeight = 56;
  const axisHeight = 62;
  let {dayWidth, timelineWidth} = geometry;
  const bodyHeight = tasks.length * rowHeight;
  const chartHeight = headHeight + bodyHeight + axisHeight;
  const labels = '<div class="ganttTaskRows">' + tasks.map(task => ganttTaskLabel(task, rowHeight)).join('') + '</div>';
  const svg = ganttSvg(tasks, rangeStart, totalDays, dayWidth, timelineWidth, headHeight, rowHeight, bodyHeight, axisHeight, focusRange);

  applyGanttTrackSizes(root, rowHeight, tasks.length, headHeight, axisHeight);
  const rowSizing = 'data-row-height="' + rowHeight + '" data-row-count="' + tasks.length + '" data-chart-height="' + chartHeight + '"';
  root.innerHTML = '<section class="ganttFlow">' + controls + planningFocusHtml() + '<div class="ganttFlowLegend"><span><b></b> Work item</span><span><b class="epic"></b> Epic total</span><span><b class="saved"></b> Saved time</span><span><b class="late"></b> Delay</span><span><b class="estimate"></b> Best-case estimate</span>' + (boardSprintStartValue() ? '<span><b class="sprint"></b>Sprint cadence</span>' : '') + '<span class="timelineDependencyHint">Open Dependencies to inspect connections</span></div><div class="ganttChart" ' + rowSizing + '><div class="ganttTaskPane"><div class="ganttTaskHead">Task</div>' + labels + '<div class="ganttTaskFoot">Timeline</div></div><div class="ganttSvgScroll" tabindex="0" role="region" aria-label="Scrollable timeline. Hold and drag left or right to move." data-range-start="' + fmtIsoDate(rangeStart) + '" data-range-end="' + fmtIsoDate(rangeEnd) + '" data-day-width="' + dayWidth + '" data-timeline-width="' + timelineWidth + '"><svg class="ganttSvg" width="' + timelineWidth + '" height="' + chartHeight + '" viewBox="0 0 ' + timelineWidth + ' ' + chartHeight + '"' + (focusRange ? ' overflow="hidden"' : '') + ' role="img" aria-label="Gantt chart">' + svg + '</svg></div></div></section>';
  const scroll = root.querySelector('.ganttSvgScroll');
  const svgElement = root.querySelector('.ganttSvg');
  const fitViewport = () => {
    if (!focusRange || !(scroll?.clientWidth > 0) || !svgElement) return false;
    const fitted = timelineGeometry(tasks, focusRange, scroll.clientWidth);
    if (svgElement.getAttribute('width') === String(fitted.timelineWidth) && +scroll.dataset.dayWidth === fitted.dayWidth) return false;
    geometry = fitted;
    ({dayWidth, timelineWidth} = geometry);
    scroll.dataset.rangeStart = fmtIsoDate(rangeStart);
    scroll.dataset.rangeEnd = fmtIsoDate(rangeEnd);
    scroll.dataset.dayWidth = String(dayWidth);
    scroll.dataset.timelineWidth = String(timelineWidth);
    svgElement.setAttribute('width', timelineWidth);
    svgElement.setAttribute('viewBox', '0 0 ' + timelineWidth + ' ' + chartHeight);
    svgElement.innerHTML = ganttSvg(tasks, rangeStart, totalDays, dayWidth, timelineWidth, headHeight, rowHeight, bodyHeight, axisHeight, focusRange);
    return true;
  };
  fitViewport();
  wireTimelineControls(root);
  wireTimelineDependencies(root, tasks);
  wireTimelineCursor(root, rangeStart, totalDays, dayWidth, timelineWidth, !!focusRange);
  wireTimelinePan(root);
  wirePlanningActions(root);
  const requestedCenter = validDate(timelineCenterDate) ? timelineCenterDate : focusCenter;
  if (requestedCenter) centerTimelineOnDate(root, requestedCenter);
  if (focusRange && scroll && typeof window.ResizeObserver === 'function') {
    const sessionCurrent = currentSessionGuard();
    const boardId = currentBoardId();
    const observer = new window.ResizeObserver(() => {
      if (!sessionCurrent() || currentBoardId() !== boardId || (focusRange.dependencyId ? dependencyFocusTicketId !== focusRange.dependencyId : timelineFocusSprint !== focusRange.number) || !scroll.isConnected || !fitViewport()) return;
      wireTimelineControls(root);
      wireTimelineDependencies(root, tasks);
      wireTimelineCursor(root, rangeStart, totalDays, dayWidth, timelineWidth, true);
      wirePlanningActions(root);
      centerTimelineOnDate(root, validDate(timelineCenterDate) ? timelineCenterDate : focusCenter);
    });
    observer.observe(scroll);
    timelineFitObservers.set(root, observer);
  }
  root.insertAdjacentHTML('beforeend', '<details class="timelineAssumptionHint"><summary>About estimated dates</summary><p>Without a start date, work is estimated from its deadline or creation date. Missing duration uses three days, or one day for an Epic. These estimates do not change saved deadlines.</p></details>');
}

// The CSP rejects HTML style attributes; trusted DOM property writes are allowed.
function applyGanttTrackSizes(root, rowHeight, rowCount, headHeight, axisHeight) {
  const properties = {
    '--gantt-row-height': rowHeight + 'px',
    '--gantt-row-count': String(rowCount),
    '--gantt-head-height': headHeight + 'px',
    '--gantt-axis-height': axisHeight + 'px',
    '--gantt-chart-height': (headHeight + rowCount * rowHeight + axisHeight) + 'px',
  };
  Object.entries(properties).forEach(([name, value]) => root.style?.setProperty(name, value));
}

// A focused Sprint has exact calendar bounds and fits even below ten pixels/day.
function dependencyTimelineRange(tasks) {
  const required = dependencyFocusIds();
  if (!required) return null;
  const dates = tasks.filter(task => !task.isAggregate || required.has(+task.ticket?.id)).flatMap(task => [task.plannedStart, task.start, task.due, task.actualFinish]).filter(validDate);
  if (!dates.length) return null;
  return {dependencyId: dependencyFocusTicketId, start: addDays(new Date(Math.min(...dates.map(Number))), -1), endExclusive: addDays(new Date(Math.max(...dates.map(Number))), 2)};
}

function timelineGeometry(tasks, focusRange, viewportWidth, zoom = timelineZoom) {
  const dates = tasks.flatMap(task => [task.plannedStart, task.start, task.end, task.due, task.actualFinish, task.readyAt, task.delayEnd, task.overrunEnd, task.estimateEnd]).filter(validDate);
  const minDate = dates.length ? new Date(Math.min(...dates.map(Number))) : startOfDay(new Date());
  const maxDate = dates.length ? new Date(Math.max(...dates.map(Number))) : addDays(startOfDay(new Date()), 14);
  const rangeStart = focusRange ? focusRange.start : addDays(minDate, -1);
  const rangeEnd = focusRange ? focusRange.endExclusive : addDays(maxDate, 2);
  const totalDays = Math.max(1, dayDiff(rangeStart, rangeEnd));
  const availableWidth = Math.max(1, +viewportWidth || 520);
  const fittedDayWidth = Math.max(1, availableWidth - GANTT_LEFT_PAD - GANTT_RIGHT_PAD) / totalDays;
  const dayWidth = focusRange ? fittedDayWidth * zoom : Math.max(10, Math.min(90, Math.floor(fittedDayWidth * zoom)));
  const timelineWidth = focusRange && zoom <= 1 ? availableWidth : Math.max(availableWidth, totalDays * dayWidth + GANTT_LEFT_PAD + GANTT_RIGHT_PAD);
  return {rangeStart, rangeEnd, totalDays, dayWidth, timelineWidth};
}

// Builds ordered Gantt rows from tickets, Epics, and dependencies.
function buildGanttRows() {
  const visibleWork = timelineFilteredWork();
  const required = dependencyViewIds();
  const baseById = new Map(visibleWork.map(ganttTask).filter(Boolean).map(task => [task.ticket.id, task]));
  const rows = [];
  const used = new Set();
  const visibleEpicMap = new Map();
  visibleWork.forEach(t => {
    const epic = topEpicFor(t);
    if (epic) visibleEpicMap.set(+epic.id, epic);
  });
  [...visibleEpicMap.values()].sort(ticketOrder).forEach(epic => {
    const descendants = descendantTickets(epic.id);
    const childTasks = descendants.map(t => baseById.get(t.id)).filter(Boolean);
    const ownTask = (epicHasOwnTimelineConfig(epic) || (!childTasks.length && required?.has(+epic.id))) ? baseById.get(epic.id) : null;
    if (!ownTask && !childTasks.length) return;
    const groupRows = [ganttEpicAggregate(epic, childTasks, ownTask)];
    const children = timelineDescendants(epic.id, baseById);
    if (required && dependencySortMode === 'dependencies') children.sort((a, b) => planningCompare(a.ticket, b.ticket, () => 0));
    (collapsedEpics.has(+epic.id) ? [] : children).forEach(task => {
      task.depth = timelineDepth(task.ticket, epic.id);
      task.groupId = epic.id;
      groupRows.push(task);
      used.add(task.ticket.id);
    });
    groupRows.forEach((task, index) => {
      task.groupId = epic.id;
      task.groupFirst = index === 0;
      task.groupLast = index === groupRows.length - 1;
    });
    rows.push(...groupRows);
    used.add(epic.id);
  });
  const standalone = [...baseById.values()]
    .filter(task => !used.has(task.ticket.id) && !topEpicFor(task.ticket))
    .sort(ganttTaskSort);
  return rows.concat(standalone);
}

// Returns whether an Epic has explicit planning data of its own.
function epicHasOwnTimelineConfig(epic) {
  // Normal planning shows empty Epics only when they have explicit dates.
  return !!parseDate(epic.startDate) || !!parseDate(epic.dueDate);
}

// Filters timeline work by the selected Epic.
function timelineFilteredWork() {
  const items = planningWork();
  if (dependencyFocusIds()) return items;
  if (timelineEpicFilter === 'all') return items;
  const required = dependencyViewIds();
  const epicId = +timelineEpicFilter;
  return items.filter(t => required?.has(+t.id) || +t.id === epicId || +(topEpicFor(t)?.id || 0) === epicId);
}

// Builds timeline filter, zoom, and clear-path controls.
function timelineControlsHtml() {
  const epics = workTickets().filter(t => t.type === 'epic').sort(ticketOrder);
  if (timelineEpicFilter !== 'all' && !epics.some(t => String(t.id) === String(timelineEpicFilter))) timelineEpicFilter = 'all';
  const options = '<option value="all">All epics</option>' + epics.map(t => '<option value="' + t.id + '"' + (String(timelineEpicFilter) === String(t.id) ? ' selected' : '') + '>' + esc(ticketLabel(t)) + '</option>').join('');
  const focused = sprintByNumber(timelineFocusSprint);
  const focusHtml = focused ? '<span class="timelineFocusBadge"><b aria-hidden="true">⌖</b>' + esc(sprintName(focused)) + '</span><button id="timelineClearFocus" class="ghost" type="button">Show full timeline</button>' : '';
  return '<div class="ganttControls"><label>Epic<select id="timelineEpicFilter">' + options + '</select></label><label class="zoomControl">Zoom<input id="timelineZoom" type="range" min="0.65" max="3" step="0.05" value="' + escAttr(String(timelineZoom)) + '"><span>' + Math.round(timelineZoom * 100) + '%</span></label><span class="timelinePanHint">Hold and drag to move</span>' + focusHtml + '</div>';
}

// Attaches timeline filter, zoom, and path selection handlers.
function wireTimelineControls(root) {
  wireSprintNavigation(root);
  const epic = $('#timelineEpicFilter');
  if (epic) epic.onchange = () => {
    rememberTimelineCenter(root);
    timelineEpicFilter = epic.value;
    renderGantt(root);
  };
  const zoom = $('#timelineZoom');
  if (zoom) zoom.oninput = () => {
    rememberTimelineCenter(root);
    timelineZoom = +zoom.value || 1;
    renderGantt(root);
  };
  const clearFocus = $('#timelineClearFocus');
  if (clearFocus) clearFocus.onclick = clearPlanningSprint;
  root.querySelectorAll('.ganttTaskTitle,.ganttSvgTask').forEach(el => {
    const select = () => { const id = +(el.dataset.epicToggle || el.dataset.openTicket); const ticket = parentTicket(id); if (ticket?.type === 'epic') toggleEpic(id); else openTicket(id); };
    el.onclick = select;
    if (el.classList.contains('ganttSvgTask')) el.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      select();
    };
  });
  root.querySelectorAll('.ganttTaskItem').forEach(el => el.onkeydown = event => {
    if (event.target !== el || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    const ticket = parentTicket(+el.dataset.timelineId);
    if (ticket?.type === 'epic') toggleEpic(ticket.id); else openTicket(+el.dataset.timelineId);
  });
}

// Displays the connected dependency chain at the bars while labels remain in place.
function wireTimelineDependencies(root, tasks) {
  const layerRoot = root.querySelector('.ganttSvgScroll');
  if (!layerRoot || !window.KanbanodonDependencyHover) return;
  window.KanbanodonDependencyHover.wire(root, {
    nodesSelector: '.ganttTaskItem[data-timeline-id],.ganttSvgTask[data-timeline-id]',
    idAttribute: 'data-timeline-id',
    anchorSelector: '.ganttSvgBar',
    obstaclesSelector: '.ganttSvgBar,.ganttSvgDueTagBg',
    layerRoot,
    layout: 'timeline',
    gutterWidth: GANTT_LEFT_PAD,
    selectedId: dependencyViewIds() ? dependencyFocusTicketId : 0,
    labelsById: Object.fromEntries(tasks.map(task => [task.ticket.id, task.ticket.title])),
    edges: dependencyHoverEdges(tasks.map(task => task.ticket)),
  });
}

// Enables mouse and pen panning while preserving regular task clicks.
function wireTimelinePan(root) {
  const scroll = root.querySelector('.ganttSvgScroll');
  if (!scroll) return;
  let pointerId = null;
  let startX = 0;
  let startScroll = 0;
  let moved = false;
  let suppressClick = false;
  scroll.onpointerdown = event => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startScroll = scroll.scrollLeft;
    moved = false;
    scroll.classList.add('isPanning');
    try {
      scroll.setPointerCapture?.(pointerId);
    } catch (_) {
      // Synthetic test events and older browsers may not expose pointer capture.
    }
  };
  scroll.onpointermove = event => {
    if (pointerId == null || event.pointerId !== pointerId) return;
    const delta = event.clientX - startX;
    if (Math.abs(delta) > 4) moved = true;
    if (!moved) return;
    event.preventDefault();
    scroll.scrollLeft = startScroll - delta;
  };
  const finish = event => {
    if (pointerId == null || (event?.pointerId != null && event.pointerId !== pointerId)) return;
    const releasedPointer = pointerId;
    pointerId = null;
    scroll.classList.remove('isPanning');
    if (moved) {
      suppressClick = true;
      rememberTimelineCenter(root);
    }
    if (scroll.hasPointerCapture?.(releasedPointer)) scroll.releasePointerCapture(releasedPointer);
  };
  scroll.onpointerup = finish;
  scroll.onpointercancel = finish;
  scroll.onlostpointercapture = finish;
  scroll.addEventListener('click', event => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  scroll.ondragstart = () => false;
}

// Remembers the calendar date currently visible at the horizontal center.
function rememberTimelineCenter(root = document) {
  const scroll = root.querySelector?.('.ganttSvgScroll') || $('.ganttSvgScroll');
  if (!scroll) return null;
  const rangeStart = parseDate(scroll.dataset.rangeStart);
  const dayWidth = +scroll.dataset.dayWidth;
  if (!rangeStart || !dayWidth) return null;
  timelineCenterDate = timelineDateAtScrollCenter(scroll.scrollLeft, scroll.clientWidth, rangeStart, dayWidth);
  return timelineCenterDate;
}

// Centers the scrollable chart on a calendar date and clamps it to its edges.
function centerTimelineOnDate(root, date) {
  const scroll = root.querySelector('.ganttSvgScroll');
  if (!scroll || !validDate(date)) return;
  const rangeStart = parseDate(scroll.dataset.rangeStart);
  const dayWidth = +scroll.dataset.dayWidth;
  const timelineWidth = +scroll.dataset.timelineWidth;
  scroll.scrollLeft = timelineScrollForDate(date, rangeStart, dayWidth, scroll.clientWidth, timelineWidth);
}

// Converts a target calendar date into a clamped horizontal scroll offset.
function timelineScrollForDate(date, rangeStart, dayWidth, viewportWidth, timelineWidth) {
  if (!validDate(date) || !validDate(rangeStart) || !(dayWidth > 0)) return 0;
  const targetX = GANTT_LEFT_PAD + dayDiff(rangeStart, date) * dayWidth;
  const maxScroll = Math.max(0, timelineWidth - viewportWidth);
  return Math.max(0, Math.min(maxScroll, targetX - viewportWidth / 2));
}

// Resolves the date currently visible at the horizontal center of the chart.
function timelineDateAtScrollCenter(scrollLeft, viewportWidth, rangeStart, dayWidth) {
  if (!validDate(rangeStart) || !(dayWidth > 0)) return null;
  const day = Math.max(0, Math.round((scrollLeft + viewportWidth / 2 - GANTT_LEFT_PAD) / dayWidth));
  return addDays(rangeStart, day);
}

// Shows a date cursor snapped to the nearest daily grid line inside the chart.
function wireTimelineCursor(root, rangeStart, totalDays, dayWidth, timelineWidth, focusedSprint = false) {
  const svg = root.querySelector('.ganttSvg');
  const cursor = root.querySelector('.ganttSvgCursor');
  if (!svg || !cursor) return;
  const line = cursor.querySelector('.ganttSvgCursorLine');
  const tag = cursor.querySelector('.ganttSvgCursorTag');
  const text = cursor.querySelector('.ganttSvgCursorText');
  const update = event => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const viewWidth = svg.viewBox?.baseVal?.width || timelineWidth;
    const scale = viewWidth / rect.width;
    const svgX = (event.clientX - rect.left) * scale;
    const scrollRect = svg.closest('.ganttSvgScroll')?.getBoundingClientRect() || rect;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const clippedLeft = Math.max(0, scrollRect.left);
    const clippedRight = Math.min(viewportWidth, scrollRect.right);
    const visibleLeft = Math.max(0, (clippedLeft - rect.left) * scale);
    const visibleRight = Math.min(timelineWidth, (clippedRight - rect.left) * scale);
    const model = ganttCursorAtX(svgX, rangeStart, totalDays, dayWidth, timelineWidth, visibleLeft, visibleRight, focusedSprint ? totalDays - 1 : totalDays);
    line.setAttribute('x1', model.x);
    line.setAttribute('x2', model.x);
    tag.setAttribute('x', model.tagX);
    tag.setAttribute('width', model.tagWidth);
    text.setAttribute('x', model.tagX + model.tagWidth / 2);
    text.textContent = model.label;
    cursor.classList.add('visible');
  };
  svg.onmouseenter = update;
  svg.onmousemove = update;
  svg.onmouseleave = () => cursor.classList.remove('visible');
}

// Calculates the nearest timeline day and a viewport-safe tooltip position.
function ganttCursorAtX(svgX, rangeStart, totalDays, dayWidth, timelineWidth, visibleLeft = 0, visibleRight = timelineWidth, lastDay = totalDays) {
  const day = Math.max(0, Math.min(lastDay, Math.round((svgX - GANTT_LEFT_PAD) / dayWidth)));
  const x = GANTT_LEFT_PAD + day * dayWidth;
  const date = addDays(rangeStart, day);
  const label = ganttCursorDateLabel(date);
  const minTagX = Math.max(4, visibleLeft + 4);
  const maxTagRight = Math.min(timelineWidth - 4, visibleRight - 4);
  const tagWidth = Math.min(Math.max(104, label.length * 7 + 22), Math.max(60, maxTagRight - minTagX));
  const tagX = Math.max(minTagX, Math.min(x - tagWidth / 2, maxTagRight - tagWidth));
  return { day, x, date, label, tagX, tagWidth };
}

// Formats the cursor label as a readable calendar date.
function ganttCursorDateLabel(date) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' }).format(date);
}

// Returns descendant Gantt tasks in tree order for a parent.
function timelineDescendants(parentId, baseById) {
  return timelineChildTickets(parentId).flatMap(child => {
    const task = baseById.get(child.id);
    return (task ? [task] : []).concat(timelineDescendants(child.id, baseById));
  });
}

// Returns direct child tickets sorted for timeline display.
function timelineChildTickets(parentId) {
  return workTickets().filter(t => +t.parentId === +parentId).sort(timelineTreeOrder);
}

// Sorts timeline siblings by numeric ticket reference.
function timelineTreeOrder(a, b) {
  const ar = timelineRefParts(a);
  const br = timelineRefParts(b);
  if (ar[0] !== br[0]) return br[0] - ar[0];
  for (let i = 1; i < Math.max(ar.length, br.length); i++) {
    if (ar[i] == null) return -1;
    if (br[i] == null) return 1;
    if (ar[i] !== br[i]) return ar[i] - br[i];
  }
  return ticketOrder(a, b);
}

// Splits a ticket reference into numeric parts for sorting.
function timelineRefParts(ticket) {
  return String(ticket?.ref || ticket?.id || '0').split('.').map(part => {
    const n = parseInt(part.replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  });
}

// Calculates indentation depth within an Epic timeline group.
function timelineDepth(ticket, epicId) {
  let depth = 0;
  let current = ticket;
  const seen = new Set();
  while (current && current.parentId && +current.parentId !== +epicId && !seen.has(+current.id)) {
    seen.add(+current.id);
    depth++;
    current = parentTicket(current.parentId);
  }
  return Math.min(depth + 1, 4);
}

// Finds the top-level Epic for a ticket.
function topEpicFor(ticket) {
  let current = ticket;
  const seen = new Set();
  while (current && current.parentId && !seen.has(+current.id)) {
    seen.add(+current.id);
    const parent = parentTicket(current.parentId);
    if (!parent || parent.archivedAt || parent.deletedAt || isBacklogTicket(parent)) return null;
    if (parent.type === 'epic') return parent;
    current = parent;
  }
  return ticket?.type === 'epic' ? ticket : null;
}

// Sorts standalone Gantt tasks by schedule and ticket order.
function ganttTaskSort(a, b) {
  return planningCompare(a.ticket, b.ticket, () => a.start - b.start || a.due - b.due || ticketOrder(a.ticket, b.ticket));
}

// Builds the aggregate Gantt row for one Epic.
function ganttEpicAggregate(epic, childTasks, ownTask) {
  const childDates = childTasks.flatMap(task => [task.start, task.end, task.due, task.readyAt, task.delayEnd]);
  if (ownTask) childDates.push(ownTask.start, ownTask.end, ownTask.due, ownTask.readyAt, ownTask.delayEnd);
  const validChildDates = childDates.filter(validDate);
  const childStart = validChildDates.length ? new Date(Math.min(...validChildDates.map(Number))) : null;
  const childEnd = validChildDates.length ? new Date(Math.max(...validChildDates.map(Number))) : null;
  const estimateDates = childTasks.map(task => task.estimateEnd).concat(ownTask?.estimateEnd || []).filter(validDate);
  const forecastEnd = estimateDates.length ? new Date(Math.max(...estimateDates.map(Number))) : null;
  const estimateStart = forecastEnd && childEnd && forecastEnd > childEnd ? childEnd : null;
  const estimateEnd = estimateStart ? forecastEnd : null;
  const explicitStart = parseDate(epic.startDate);
  const explicitDue = parseDate(epic.dueDate);
  const start = childStart || explicitStart || ownTask?.start || startOfDay(new Date());
  let due = explicitDue || childEnd || ownTask?.due || addDays(start, 1);
  if (due <= start) due = addDays(start, 1);
  let end = childEnd || due;
  if (end <= start) end = due;
  return {
    ticket: epic,
    deps: dependencyTickets(epic),
    blocked: unfinishedDependencies(epic),
    plannedStart: start,
    start,
    due,
    end,
    actualFinish: null,
    readyAt: end,
    delayEnd: null,
    estimateStart,
    estimateEnd,
    estimateDays: estimateEnd ? dayDiff(estimateStart, estimateEnd) : 0,
    saved: false,
    late: false,
    dependencyReady: null,
    isAggregate: true,
    overrun: !!explicitDue && !!childEnd && childEnd > explicitDue,
    overrunEnd: childEnd,
    childCount: childTasks.length,
  };
}

// Builds the scheduling model for one timeline work item.
function ganttTask(ticket) {
  if (ticket.type === 'epic' && !epicHasOwnTimelineConfig(ticket) && !dependencyViewIds()?.has(+ticket.id)) return null;
  const base = ganttBase(ticket);
  if (!validDate(base.plannedStart) || !validDate(base.due)) return null;
  const deps = dependencyTickets(ticket);
  let dependencyReady = null;
  deps.forEach(dep => {
    const ready = ganttDependencyReady(dep);
    if (ready && (!dependencyReady || ready > dependencyReady)) dependencyReady = ready;
  });
  const plannedDuration = Math.max(1, dayDiff(base.plannedStart, base.due));
  const start = dependencyReady || base.plannedStart;
  let due = base.due;
  if (due <= start) due = addDays(start, plannedDuration || 1);
  const actualFinish = base.actualFinish && base.actualFinish >= start ? base.actualFinish : (base.actualFinish ? start : null);
  const today = startOfDay(new Date());
  const delayEnd = actualFinish && actualFinish > due ? actualFinish : (!actualFinish && today > due ? today : null);
  const estimateDays = delayEnd && !actualFinish ? Math.max(1, ticketDuration(ticket) || plannedDuration) : 0;
  const estimateStart = estimateDays ? delayEnd : null;
  const estimateEnd = estimateStart ? addDays(estimateStart, estimateDays) : null;
  const end = actualFinish && actualFinish < due ? actualFinish : due;
  const readyAt = actualFinish || due;
  return { ticket, deps, blocked: unfinishedDependencies(ticket), plannedStart: base.plannedStart, start, due, end, actualFinish, readyAt, delayEnd, estimateStart, estimateEnd, estimateDays, saved: actualFinish && actualFinish < due, late: !!delayEnd, dependencyReady };
}

// Calculates the planned start and due date for a ticket.
function ganttBase(ticket) {
  const explicitDue = parseDate(ticket.dueDate);
  const explicitStart = parseDate(ticket.startDate);
  const fallbackDuration = ticket.type === 'epic' ? 1 : 3;
  const duration = Math.max(1, ticketDuration(ticket) || fallbackDuration);
  const plannedStart = explicitStart || (explicitDue ? addDays(explicitDue, -duration) : dateFromCreated(ticket.createdAt) || startOfDay(new Date()));
  let due = explicitDue || addDays(plannedStart, duration);
  if (due <= plannedStart) due = addDays(plannedStart, 1);
  return { plannedStart, due, actualFinish: ganttActualFinish(ticket) };
}

// Returns the actual finish date for tickets in the Done column.
function ganttActualFinish(ticket) {
  const done = doneColumn();
  if (!done || ticket.columnId != done.id) return null;
  return parseDate(ticket.completedAt) || parseDate(ticket.updatedAt) || null;
}

// Returns the date when a dependency can unblock dependents.
function ganttDependencyReady(ticket) {
  const base = ganttBase(ticket);
  return base.actualFinish || base.due;
}

// Builds the left-side text label for a Gantt row.
function ganttTaskLabel(task, rowHeight) {
  const depText = task.isAggregate ? (task.childCount + ' child item' + (task.childCount === 1 ? '' : 's')) : (task.blocked.length ? 'Waiting for ' + task.blocked.length + ' task' + (task.blocked.length === 1 ? '' : 's') : '');
  const delayText = ganttDelayText(task);
  const detailText = [depText, delayText].filter(Boolean).join(' · ');
  const classes = ['ganttTaskItem'];
  if (task.isAggregate) classes.push('epicSummary');
  if (task.groupId && !task.isAggregate) classes.push('epicChild');
  if (task.groupLast) classes.push('groupLast');
  classes.push('indent' + Math.max(0, Math.min(4, +(task.depth || 0))));
  const typeLabel = task.isAggregate ? 'epic total' : task.ticket.type;
  const detailClasses = [task.blocked.length ? 'waiting' : '', delayText ? 'late' : ''].filter(Boolean).join(' ');

  const title = task.isAggregate ? epicToggleHtml(task.ticket, 'ganttTaskTitle') : '<button type="button" class="ganttTaskTitle" data-open-ticket="' + task.ticket.id + '">' + esc(ticketLabel(task.ticket)) + '</button>';
  return '<div class="' + classes.join(' ') + '" data-timeline-id="' + task.ticket.id + '" data-row-height="' + rowHeight + '" tabindex="0">' + title + '<span>' + esc(typeLabel) + ' · ' + fmtDate(task.start) + ' to ' + fmtDate(task.end) + '</span>' + (detailText ? '<em class="' + detailClasses + '" title="' + escAttr(detailText) + '">' + esc(detailText) + '</em>' : '') + taskEditHtml(task.ticket) + '</div>';
}

// Describes the optimistic finish projection after the live delay segment.
function ganttEstimateText(task) {
  if (!validDate(task?.estimateStart) || !validDate(task?.estimateEnd)) return '';
  const days = Math.max(0, dayDiff(task.estimateStart, task.estimateEnd));
  if (!days) return '';
  return 'Best case +' + days + 'd to ' + fmtDate(task.estimateEnd);
}

// Describes how far a task or Epic has passed its target date.
function ganttDelayText(task) {
  const delayEnd = task?.delayEnd || (task?.overrun ? task.overrunEnd : null);
  if (!validDate(task?.due) || !validDate(delayEnd)) return '';
  const days = Math.max(0, dayDiff(task.due, delayEnd));
  if (!days) return '';
  const unit = days === 1 ? 'day' : 'days';
  if (task.overrun) return days + ' ' + unit + ' over target';
  return task.actualFinish ? 'Finished ' + days + ' ' + unit + ' late' : days + ' ' + unit + ' overdue';
}

// Builds the full SVG markup for the Gantt chart.
function ganttSvg(tasks, rangeStart, totalDays, dayWidth, width, headHeight, rowHeight, bodyHeight, axisHeight, focusRange = sprintByNumber(timelineFocusSprint)) {
  const bodyTop = headHeight;
  const axisTop = headHeight + bodyHeight;
  const today = ganttSvgToday(rangeStart, totalDays, dayWidth, width, bodyTop, axisTop + axisHeight);
  const calendarClip = focusRange ? '<clipPath id="ganttCalendarClip"><rect x="' + GANTT_LEFT_PAD + '" y="' + bodyTop + '" width="' + (totalDays * dayWidth) + '" height="' + bodyHeight + '"></rect></clipPath>' : '';
  const defs = '<defs><pattern id="ganttSavedPattern" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" class="ganttSvgSavedBase"></rect><rect width="5" height="12" class="ganttSvgSavedStripe"></rect></pattern><pattern id="ganttLatePattern" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" class="ganttSvgLateBase"></rect><rect width="5" height="12" class="ganttSvgLateStripe"></rect></pattern></defs>';
  return defs + calendarClip +
    '<rect class="ganttSvgPanel" x="0" y="0" width="' + width + '" height="' + (headHeight + bodyHeight + axisHeight) + '"></rect>' +
    '<rect class="ganttSvgHead" x="0" y="0" width="' + width + '" height="' + headHeight + '"></rect>' +
    (today && width < 300 ? '' : '<text class="ganttSvgHeadText" x="8" y="22">Date range</text>') +
    ganttSvgGrid(rangeStart, totalDays, dayWidth, width, bodyTop, bodyHeight, axisTop, axisHeight, rowHeight, tasks) +
    ganttSvgSprintBands(rangeStart, totalDays, dayWidth, bodyTop, bodyHeight, axisTop, axisHeight, 'background') +
    '<g class="ganttCalendarTasks"' + (focusRange ? ' clip-path="url(#ganttCalendarClip)"' : '') + '>' + tasks.map(task => ganttSvgTask(task, rangeStart, dayWidth, headHeight, rowHeight, focusRange)).join('') + '</g>' +
    ganttSvgSprintBands(rangeStart, totalDays, dayWidth, bodyTop, bodyHeight, axisTop, axisHeight, 'foreground') +
    today +
    ganttSvgAxis(rangeStart, totalDays, dayWidth, axisTop, axisHeight, width) +
    ganttSvgCursor(headHeight + bodyHeight + axisHeight);
}

// Bands sit behind tasks; shared Sprint boundaries and header dates remain
// above task bars. The first visible Sprint start has its own boundary too.
function ganttSvgSprintBands(rangeStart, totalDays, dayWidth, bodyTop, bodyHeight, axisTop, axisHeight, layer = 'all') {
  const cadenceStart = parseDate(boardSprintStartValue());
  const weeks = boardSprintWeeks();
  if (!cadenceStart || !weeks || !validDate(rangeStart) || !(totalDays > 0 && dayWidth > 0)) return '';
  const rangeEnd = addDays(rangeStart, totalDays);
  const span = weeks * 7;
  const firstIndex = Math.max(0, Math.floor(dayDiff(cadenceStart, rangeStart) / span));
  const bands = [];
  const labels = [];
  const boundaries = new Map();
  const boundary = (date, number, kind) => {
    if (date < rangeStart || date > rangeEnd) return;
    const key = fmtIsoDate(date);
    if (!boundaries.has(key)) boundaries.set(key, { date, descriptions: [], focused: false });
    const mark = boundaries.get(key);
    mark.descriptions.push(sprintName({ number }) + (kind === 'start' ? ' starts ' + key : ' ends ' + fmtIsoDate(addDays(date, -1))));
    mark.focused ||= number === timelineFocusSprint;
  };
  for (let index = firstIndex; ; index++) {
    const start = addDays(cadenceStart, index * span);
    const endExclusive = addDays(start, span);
    if (start >= rangeEnd) break;
    if (endExclusive <= rangeStart) continue;
    const visibleStart = start < rangeStart ? rangeStart : start;
    const visibleEnd = endExclusive > rangeEnd ? rangeEnd : endExclusive;
    const x1 = ganttPx(visibleStart, rangeStart, dayWidth);
    const x2 = ganttPx(visibleEnd, rangeStart, dayWidth);
    const sprintNumber = index + 1;
    const name = sprintName({ number: sprintNumber });
    const end = addDays(endExclusive, -1);
    const description = name + ' · ' + fmtIsoDate(start) + ' to ' + fmtIsoDate(end);
    const visibleWidth = Math.max(0, x2 - x1);
    const focused = sprintNumber === timelineFocusSprint ? ' focused' : '';
    bands.push('<rect class="ganttSvgSprintBand sprint' + ((index % 2) + 1) + focused + '" x="' + x1 + '" y="' + bodyTop + '" width="' + visibleWidth + '" height="' + (bodyHeight + axisHeight) + '"><title>' + esc(description) + '</title></rect>');
    boundary(start, sprintNumber, 'start');
    boundary(endExclusive, sprintNumber, 'end');
    const labelLimit = Math.floor((visibleWidth - 14) / 6);
    if (labelLimit >= 4) labels.push('<text class="ganttSvgSprintLabel' + focused + '" x="' + (x1 + 7) + '" y="39">' + esc(truncateSvgText(name, labelLimit)) + '<title>' + esc(description) + '</title></text>');
    if (visibleWidth >= 100) labels.push('<text class="ganttSvgSprintRange' + focused + '" x="' + (x1 + 7) + '" y="51">' + esc(shortRange(start, end)) + '<title>' + esc(description) + '</title></text>');
  }
  const marks = [...boundaries].map(([date, mark]) => {
    const x = ganttPx(mark.date, rangeStart, dayWidth);
    const focused = mark.focused ? ' focused' : '';
    return '<g class="ganttSvgSprintMark' + focused + '" data-sprint-boundary-date="' + date + '"><title>' + esc(mark.descriptions.join(' · ')) + '</title>' +
      '<line class="ganttSvgSprintBoundary' + focused + '" x1="' + x + '" x2="' + x + '" y1="' + bodyTop + '" y2="' + (axisTop + axisHeight) + '"></line>' +
      '<path class="ganttSvgSprintBoundaryCap' + focused + '" d="M' + (x - 5) + ' ' + (bodyTop - 5) + ' L' + (x + 5) + ' ' + (bodyTop - 5) + ' L' + x + ' ' + bodyTop + ' Z"></path></g>';
  }).join('');
  if (layer === 'background') return bands.join('');
  if (layer === 'foreground') return marks + labels.join('');
  return bands.join('') + marks + labels.join('');
}

// A permanent local-day marker is independent of the mouse-following cursor.
// It is omitted outside the actual calendar interval rather than clamped in.
function ganttSvgToday(rangeStart, totalDays, dayWidth, width, bodyTop, height, today = startOfDay(new Date())) {
  if (!validDate(rangeStart) || !validDate(today) || !(totalDays > 0 && dayWidth > 0 && width > 0)) return '';
  const date = startOfDay(today);
  if (date < startOfDay(rangeStart) || date >= addDays(rangeStart, totalDays)) return '';
  const x = ganttPx(date, rangeStart, dayWidth);
  if (x < 0 || x > width) return '';
  const label = 'Today · ' + fmtIsoDate(date);
  const minX = width >= 300 ? GANTT_LEFT_PAD + 4 : 4;
  const tagWidth = Math.max(1, Math.min(144, width - minX - 4));
  const tagX = Math.max(minX, Math.min(x - tagWidth / 2, width - tagWidth - 4));
  const tagLabel = tagWidth >= 130 ? label : truncateSvgText(label, Math.max(4, Math.floor((tagWidth - 12) / 6)));
  return '<g class="ganttSvgToday" data-today-date="' + fmtIsoDate(date) + '" role="img" aria-label="' + escAttr(label) + '"><title>' + esc(label) + '</title>' +
    '<line class="ganttSvgTodayHalo" x1="' + x + '" x2="' + x + '" y1="' + bodyTop + '" y2="' + height + '"></line>' +
    '<line class="ganttSvgTodayLine" x1="' + x + '" x2="' + x + '" y1="' + bodyTop + '" y2="' + height + '"></line>' +
    '<circle class="ganttSvgTodayCap" cx="' + x + '" cy="' + bodyTop + '" r="4"></circle>' +
    '<rect class="ganttSvgTodayTag" x="' + tagX + '" y="5" width="' + tagWidth + '" height="26" rx="6"></rect>' +
    '<text class="ganttSvgTodayText" x="' + (tagX + tagWidth / 2) + '" y="22">' + esc(tagLabel) + '</text></g>';
}

// Builds the pointer-following date line and its top label.
function ganttSvgCursor(height) {
  return '<g class="ganttSvgCursor" aria-hidden="true"><line class="ganttSvgCursorLine" x1="0" x2="0" y1="34" y2="' + height + '"></line><rect class="ganttSvgCursorTag" x="0" y="7" width="104" height="26" rx="6"></rect><text class="ganttSvgCursorText" x="52" y="25"></text></g>';
}

// Builds SVG background rows, grid lines, and weekend shading.
function ganttSvgGrid(rangeStart, totalDays, dayWidth, width, bodyTop, bodyHeight, axisTop, axisHeight, rowHeight, tasks) {
  const parts = [];
  parts.push('<rect class="ganttSvgBody" x="0" y="' + bodyTop + '" width="' + width + '" height="' + bodyHeight + '"></rect>');
  for (let row = 0; row < tasks.length; row++) {
    const task = tasks[row];
    const y = bodyTop + row * rowHeight;
    const cls = (row % 2 ? 'even' : 'odd') + (task.isAggregate ? ' epicSummary' : task.groupId ? ' epicChild' : '');
    parts.push('<rect class="ganttSvgRow ' + cls + '" x="0" y="' + y + '" width="' + width + '" height="' + rowHeight + '"></rect>');
    parts.push('<line class="ganttSvgRowLine" x1="0" x2="' + width + '" y1="' + y + '" y2="' + y + '"></line>');
    if (task.groupLast) parts.push('<line class="ganttSvgRowLine groupLast" x1="0" x2="' + width + '" y1="' + (y + rowHeight) + '" y2="' + (y + rowHeight) + '"></line>');
  }
  parts.push('<line class="ganttSvgRowLine strong" x1="0" x2="' + width + '" y1="' + (bodyTop + bodyHeight) + '" y2="' + (bodyTop + bodyHeight) + '"></line>');
  for (let i = 0; i <= totalDays; i++) {
    const d = addDays(rangeStart, i);
    const x = ganttPx(d, rangeStart, dayWidth);
    if (i < totalDays && (d.getDay() === 0 || d.getDay() === 6)) {
      parts.push('<rect class="ganttSvgWeekend" x="' + x + '" y="' + bodyTop + '" width="' + dayWidth + '" height="' + bodyHeight + '"></rect>');
    }
    parts.push('<line class="ganttSvgGridLine" x1="' + x + '" x2="' + x + '" y1="' + bodyTop + '" y2="' + (bodyTop + bodyHeight) + '"></line>');
  }
  parts.push('<rect class="ganttSvgAxisBg" x="0" y="' + axisTop + '" width="' + width + '" height="' + axisHeight + '"></rect>');
  return parts.join('');
}

// Builds the SVG bar, due marker, and label for one Gantt task.
function ganttSvgTask(task, rangeStart, dayWidth, headHeight, rowHeight, focusRange = null) {
  const rowTop = headHeight + task.row * rowHeight;
  const h = 28;
  const y = rowTop + Math.round((rowHeight - h) / 2);
  const railY = y + h + 10;
  const railHeight = 7;
  const left = ganttPx(task.start, rangeStart, dayWidth);
  const visualEnd = task.overrun ? task.due : task.end;
  const right = ganttPx(visualEnd, rangeStart, dayWidth);
  const width = Math.max(6, right - left);
  const dueX = ganttPx(task.due, rangeStart, dayWidth);
  const showDue = !focusRange || (task.due >= focusRange.start && task.due < focusRange.endExclusive);
  const dueLabel = (task.ticket.dueDate ? 'Due ' : 'Est. finish ') + (task.ticket.dueDate || fmtIsoDate(task.due));
  const calendarWidth = focusRange ? dayDiff(focusRange.start, focusRange.endExclusive) * dayWidth : Infinity;
  let badgeLabel = dueLabel;
  let badgeWidth = Math.max(82, dueLabel.length * 7 + 12);
  if (focusRange && badgeWidth > calendarWidth) {
    const compactDate = task.due.toLocaleDateString('en-GB', {day: 'numeric', month: 'short'});
    badgeLabel = (task.ticket.dueDate ? 'Due ' : 'Est. ') + compactDate;
    if (badgeLabel.length * 7 + 12 > calendarWidth) badgeLabel = compactDate;
    badgeWidth = Math.max(1, Math.min(calendarWidth, Math.max(60, badgeLabel.length * 7 + 12)));
    badgeLabel = truncateSvgText(badgeLabel, Math.max(1, Math.floor((badgeWidth - 12) / 7)));
  }
  const badgeX = focusRange ? Math.max(GANTT_LEFT_PAD, Math.min(dueX + 7, GANTT_LEFT_PAD + calendarWidth - badgeWidth)) : dueX + 7;
  const type = escAttr(task.ticket.type || 'task');
  const blocked = task.blocked.length ? ' blocked' : '';
  const aggregate = task.isAggregate ? ' aggregate' : '';
  const label = ganttSvgBarLabel(task, width);
  const saved = task.saved ? ganttSvgSaved(task, rangeStart, dayWidth, railY, railHeight) : '';
  const late = task.late ? ganttSvgLate(task, rangeStart, dayWidth, railY, railHeight) : '';
  const overrun = task.overrun ? ganttSvgOverrun(task, rangeStart, dayWidth, railY, railHeight) : '';
  const delayText = ganttDelayText(task);
  const estimateText = ganttEstimateText(task);
  const clipId = 'ganttTaskClip' + task.ticket.id;
  return '<g class="ganttSvgTask" data-timeline-id="' + task.ticket.id + '" data-open-ticket="' + task.ticket.id + '" tabindex="0" role="button" aria-label="' + (task.isAggregate ? (collapsedEpics.has(+task.ticket.id) ? 'Expand ' : 'Collapse ') : 'Edit ') + escAttr(ticketLabel(task.ticket)) + '">' +
    '<title>' + esc(ticketLabel(task.ticket)) + ' | ' + fmtDate(task.start) + ' to ' + fmtDate(task.end) + (delayText ? ' | ' + delayText : '') + (estimateText ? ' | ' + estimateText : '') + '</title>' + saved +
    '<rect class="ganttSvgBar ' + type + blocked + aggregate + '" x="' + left + '" y="' + y + '" width="' + width + '" height="' + h + '" rx="7"></rect>' + overrun + late + ganttSvgEstimate(task, rangeStart, dayWidth, railY, railHeight) +
    '<clipPath id="' + clipId + '"><rect x="' + (left + 7) + '" y="' + y + '" width="' + Math.max(0, width - 14) + '" height="' + h + '"></rect></clipPath>' +
    (label ? '<text class="ganttSvgBarText" clip-path="url(#' + clipId + ')" x="' + (left + 9) + '" y="' + (y + 19) + '">' + esc(label) + '</text>' : '') +
    (showDue ? '<line class="ganttSvgDueLine" x1="' + dueX + '" x2="' + dueX + '" y1="' + (y - 4) + '" y2="' + (railY + railHeight + 4) + '"></line>' +
    '<rect class="ganttSvgDueTagBg" x="' + badgeX + '" y="' + (y - 24) + '" width="' + badgeWidth + '" height="20" rx="5">' + (focusRange ? '<title>' + esc(dueLabel) + '</title>' : '') + '</rect>' +
    '<text class="ganttSvgDueTag" x="' + (badgeX + 6) + '" y="' + (y - 10) + '">' + esc(badgeLabel) + '</text>' : '') +
    '</g>';
}

// Chooses a readable label for a Gantt bar width.
function ganttSvgBarLabel(task, width) {
  if (width < 70) return '';
  const text = width < 260 ? ticketLabel(task.ticket) : ticketLabel(task.ticket) + ' - ' + fmtDate(task.start) + ' to ' + fmtDate(task.end);
  return truncateSvgText(text, Math.max(4, Math.floor((width - 18) / 7)));
}

// Truncates SVG labels so they stay inside their bars.
function truncateSvgText(text, limit) {
  text = String(text || '');
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(1, limit - 3)).trimEnd() + '...';
}

// Builds the saved-time segment for early completion.
function ganttSvgSaved(task, rangeStart, dayWidth, y, h) {
  const left = ganttPx(task.actualFinish, rangeStart, dayWidth);
  const right = ganttPx(task.due, rangeStart, dayWidth);
  const width = Math.max(0, right - left);
  return width ? '<rect class="ganttSvgSaved" x="' + left + '" y="' + y + '" width="' + width + '" height="' + h + '" rx="7"></rect>' : '';
}

// Builds the delay segment for late completion.
function ganttSvgLate(task, rangeStart, dayWidth, y, h) {
  const left = ganttPx(task.due, rangeStart, dayWidth);
  const right = ganttPx(task.delayEnd, rangeStart, dayWidth);
  const width = Math.max(0, right - left);
  return width ? '<rect class="ganttSvgLate" x="' + left + '" y="' + y + '" width="' + width + '" height="' + h + '" rx="7"></rect>' : '';
}

// Builds the dashed best-case projection after an overdue open task.
function ganttSvgEstimate(task, rangeStart, dayWidth, y, h) {
  if (!validDate(task.estimateStart) || !validDate(task.estimateEnd)) return '';
  const left = ganttPx(task.estimateStart, rangeStart, dayWidth);
  const right = ganttPx(task.estimateEnd, rangeStart, dayWidth);
  const width = Math.max(0, right - left);
  return width ? '<rect class="ganttSvgEstimate" x="' + left + '" y="' + y + '" width="' + width + '" height="' + h + '" rx="7"></rect>' : '';
}

// Builds the overrun segment for Epics that exceed their due date.
function ganttSvgOverrun(task, rangeStart, dayWidth, y, h) {
  const left = ganttPx(task.due, rangeStart, dayWidth);
  const right = ganttPx(task.overrunEnd, rangeStart, dayWidth);
  const width = Math.max(0, right - left);
  return width ? '<rect class="ganttSvgLate epicOverrun" x="' + left + '" y="' + y + '" width="' + width + '" height="' + h + '" rx="7"></rect>' : '';
}

// Builds the Gantt date axis.
function ganttSvgAxis(rangeStart, totalDays, dayWidth, axisTop, axisHeight, width) {
  const parts = ['<line class="ganttSvgAxisLine" x1="0" x2="' + width + '" y1="' + axisTop + '" y2="' + axisTop + '"></line>'];
  const step = Math.max(totalDays <= 45 ? 1 : totalDays <= 180 ? 7 : 14, Math.ceil(20 / dayWidth));
  const lastDay = sprintByNumber(timelineFocusSprint) ? totalDays - 1 : totalDays;
  for (let i = 0; i <= lastDay; i += step) {
    const d = addDays(rangeStart, i);
    const x = ganttPx(d, rangeStart, dayWidth);
    parts.push('<line class="ganttSvgAxisTickLine" x1="' + x + '" x2="' + x + '" y1="' + axisTop + '" y2="' + (axisTop + 8) + '"></line>');
    parts.push('<text class="ganttSvgAxisDay" x="' + x + '" y="' + (axisTop + 27) + '">' + String(d.getDate()).padStart(2, '0') + '</text>');
  }
  parts.push(ganttSvgAxisMonths(rangeStart, totalDays, dayWidth, axisTop, axisHeight));
  return parts.join('');
}

// Builds month labels and boundaries for the Gantt axis.
function ganttSvgAxisMonths(rangeStart, totalDays, dayWidth, axisTop, axisHeight) {
  const parts = [];
  const rangeEnd = addDays(rangeStart, totalDays);
  let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  while (cursor < rangeEnd) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const segmentStart = cursor < rangeStart ? rangeStart : cursor;
    const segmentEnd = next > rangeEnd ? rangeEnd : next;
    if (segmentEnd > segmentStart) {
      const x1 = ganttPx(segmentStart, rangeStart, dayWidth);
      const x2 = ganttPx(segmentEnd, rangeStart, dayWidth);
      const label = monthLabel(cursor, rangeStart);
      parts.push('<line class="ganttSvgAxisMonthBoundary" x1="' + x1 + '" x2="' + x1 + '" y1="' + axisTop + '" y2="' + (axisTop + axisHeight) + '"></line>');
      parts.push('<text class="ganttSvgAxisMonth" x="' + ((x1 + x2) / 2) + '" y="' + (axisTop + 48) + '">' + esc(label) + '</text>');
    }
    cursor = next;
  }
  return parts.join('');
}

// Formats a month label for the timeline axis.
function monthLabel(monthStart, rangeStart) {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const name = names[monthStart.getMonth()];
  return monthStart.getFullYear() === rangeStart.getFullYear() ? name : name + ' ' + monthStart.getFullYear();
}

// Converts a date into an X coordinate on the Gantt chart.
function ganttPx(date, rangeStart, dayWidth) {
  const diff = dayDiff(rangeStart, date);
  if (!Number.isFinite(diff)) return 0;
  return GANTT_LEFT_PAD + diff * dayWidth;
}

// Returns whether a value is a usable Date object.
function validDate(d) {
  return d instanceof Date && Number.isFinite(d.getTime()) && d.getFullYear() >= 1970;
}

// Formats a Date as yyyy-mm-dd.
function fmtIsoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Returns a date shifted by a number of days.
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return startOfDay(d);
}

// Returns a date shifted by a number of months.
function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return startOfDay(d);
}

// Returns the day difference between two dates.
function dayDiff(start, end) {
  return Math.round((startOfDay(end) - startOfDay(start)) / 86400000);
}

// Returns a date normalized to midnight.
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Parses an ISO-like date string into a local Date.
function parseDate(v) {
  if (!v) return null;
  const raw = String(v);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = iso ? new Date(+iso[1], +iso[2] - 1, +iso[3]) : new Date(raw);
  if (!validDate(d)) return null;
  if (iso && (d.getFullYear() !== +iso[1] || d.getMonth() !== +iso[2] - 1 || d.getDate() !== +iso[3])) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Returns the stored first Sprint date, accepting both API naming styles.
function boardSprintStartValue() {
  return String(state.board?.sprint_start_date ?? state.board?.SprintStartDate ?? state.board?.sprintStartDate ?? '');
}

// Returns the validated board Sprint duration in whole weeks.
function boardSprintWeeks() {
  const weeks = +(state.board?.sprint_weeks ?? state.board?.SprintWeeks ?? state.board?.sprintWeeks ?? 2);
  return validSprintWeeks(weeks);
}

// Validates the editable Sprint duration without silently rounding it.
function validSprintWeeks(value) {
  const weeks = +value;
  return Number.isInteger(weeks) && weeks >= 1 && weeks <= 52 ? weeks : 0;
}

// Returns the conventional label when a Sprint has no custom name.
function defaultSprintName(number) {
  return 'Sprint ' + number;
}

// Looks up one board-scoped custom Sprint name.
function customSprintName(number) {
  return (state.sprintNames || []).find(item => +item.sprintNumber === +number)?.name || '';
}

// Builds one inclusive Sprint range from its zero-based sequence index.
function sprintRange(index, cadenceStart, weeks) {
  const span = weeks * 7;
  const start = addDays(cadenceStart, index * span);
  return { number: index + 1, start, end: addDays(start, span - 1), endExclusive: addDays(start, span) };
}

// Resolves one positive Sprint number against the persisted board cadence.
function sprintByNumber(number, startValue = boardSprintStartValue(), weeksValue = boardSprintWeeks()) {
  const start = parseDate(startValue);
  const weeks = validSprintWeeks(weeksValue);
  number = +number;
  if (!start || !weeks || !Number.isSafeInteger(number) || number < 1) return null;
  const range = sprintRange(number - 1, start, weeks);
  return validDate(range.start) && validDate(range.endExclusive) ? range : null;
}

// Returns a browsable Sprint window, starting with the current Sprint by default.
function sprintWindow(startValue = boardSprintStartValue(), weeksValue = boardSprintWeeks(), today = startOfDay(new Date()), count = 6, firstNumber = 0) {
  const start = parseDate(startValue);
  const weeks = validSprintWeeks(weeksValue);
  if (!start || !weeks || !validDate(today) || !Number.isSafeInteger(count) || count < 1 || count > 100 || !Number.isSafeInteger(firstNumber) || firstNumber < 0) return [];
  const span = weeks * 7;
  const beforeCadence = today < start;
  const currentIndex = beforeCadence ? 0 : Math.floor(dayDiff(start, today) / span);
  const firstIndex = firstNumber ? firstNumber - 1 : currentIndex;
  const sprints = Array.from({ length: count }, (_, offset) => {
    const sprint = sprintRange(firstIndex + offset, start, weeks);
    return { ...sprint, current: !beforeCadence && firstIndex + offset === currentIndex, next: beforeCadence && firstIndex + offset === 0, past: !beforeCadence && firstIndex + offset < currentIndex };
  });
  return sprints.every(sprint => validDate(sprint.start) && validDate(sprint.endExclusive)) ? sprints : [];
}

// Resolves a calendar date into the board's generated Sprint sequence.
function sprintForDate(date, startValue = boardSprintStartValue(), weeksValue = boardSprintWeeks()) {
  const start = parseDate(startValue);
  if (!start || !validDate(date)) return null;
  const weeks = validSprintWeeks(weeksValue);
  if (!weeks) return null;
  const span = weeks * 7;
  const offset = dayDiff(start, date);
  if (offset < 0) return { number: 0, before: true, start: null, end: addDays(start, -1), endExclusive: start };
  const index = Math.floor(offset / span);
  return sprintRange(index, start, weeks);
}

// Chooses the planned finish used for Sprint assignment.
function ticketPlannedFinish(ticket) {
  const due = parseDate(ticket?.dueDate);
  if (due) return due;
  const start = parseDate(ticket?.startDate);
  if (!start) return null;
  return addDays(start, Math.max(0, ticketDuration(ticket) - 1));
}

// Returns the generated Sprint in which a ticket is expected to finish.
function ticketSprint(ticket) {
  return sprintForDate(ticketPlannedFinish(ticket));
}

// Generates Sprints only as far as the latest scheduled board ticket requires.
function calculatedSprints(tickets = workTickets(), startValue = boardSprintStartValue(), weeksValue = boardSprintWeeks()) {
  const start = parseDate(startValue);
  if (!start) return [];
  const weeks = validSprintWeeks(weeksValue);
  if (!weeks) return [];
  const latest = tickets.map(ticketPlannedFinish).filter(validDate).sort((a, b) => b - a)[0];
  if (!latest || latest < start) return [];
  const last = sprintForDate(latest, startValue, weeks);
  if (!last) return [];
  return Array.from({ length: last.number }, (_, index) => sprintRange(index, start, weeks));
}

// Formats a compact inclusive date range for Sprint chips and table cells.
function shortRange(start, end) {
  const options = { day: '2-digit', month: 'short' };
  return start.toLocaleDateString('en-GB', options) + ' – ' + end.toLocaleDateString('en-GB', options);
}

// Extracts a date from a created-at timestamp.
function dateFromCreated(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1970) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Formats a Date for timeline display.
function fmtDate(d) {
  return String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0') + '.';
}

// Renders user management and board sharing administration.
function renderAdmin() {
  const isAdmin = currentUserIsAdmin();
  const boards = manageableBoards();
  setHeader(isAdmin ? 'Admin' : 'Sharing', isAdmin ? 'Manage users and board access.' : 'Share boards you own.');
  const root = $('#admin');
  root.classList.remove('hidden');
  root.innerHTML = (isAdmin ? adminCreateSection() + userManagementSection() : '') + boardSharingSection(boards);
  enhancePasswordReveals(root);
  if (isAdmin) {
    $('#createUserBtn').onclick = createUser;
  }
  $$('.userAdminToggle').forEach(input => input.onchange = updateUserAdmin);
  $$('.resetPasswordBtn').forEach(button => button.onclick = resetUserPassword);
  $$('.deleteUserBtn').forEach(button => button.onclick = deleteUser);
  $$('.boardAccessToggle').forEach(input => input.onchange = markBoardAccessDirty);
  $$('.boardAccessSaveBtn').forEach(button => button.onclick = saveBoardAccess);
}

// Builds the admin create-user form.
function adminCreateSection() {
  return '<section class="panel adminPanel"><div class="adminHeader"><h2>Create user</h2></div><div class="adminCreateForm"><input id="createUsername" placeholder="Username">' + passwordFieldHtml('createPassword', 'Initial password') + passwordFieldHtml('createConfirmPassword', 'Repeat password') + '<label class="accessToggle createUserAccess"><input id="createUserAccess" type="checkbox" checked><span>Give access to current board</span></label><button id="createUserBtn" type="button">Create user</button></div></section>';
}

// Builds the user management list.
function userManagementSection() {
  return '<section class="panel adminPanel"><div class="adminHeader"><h2>User management</h2></div>' + state.users.map(userManagementRow).join('') + '</section>';
}

// Builds one user-management row.
function userManagementRow(u) {
  const admin = userIsAdmin(u);
  const owner = currentBoardOwnerId() === +u.id;
  const self = state.me && +state.me.id === +u.id;
  const passwordId = 'resetPassword' + u.id;
  const confirmId = 'resetPasswordConfirm' + u.id;
  return '<div class="userRow adminUserRow userManagementRow">' + avatar(u.avatar) +
    '<div><strong>' + esc(u.name) + (self ? ' <span class="pill">You</span>' : '') + (owner ? ' <span class="pill">Owner</span>' : '') + (admin ? ' <span class="pill">Admin</span>' : '') + '</strong><p class="muted">@' + esc(u.username || '') + '</p></div>' +
    '<div class="adminControls userAdminControls"><label class="accessToggle"><input class="userAdminToggle" type="checkbox" data-user="' + u.id + '"' + (admin ? ' checked' : '') + (self ? ' disabled' : '') + '><span>Admin</span></label><div class="passwordReset">' + passwordFieldHtml(passwordId, 'New password', 'adminPasswordField', 'class="resetPasswordInput" data-user="' + u.id + '"') + passwordFieldHtml(confirmId, 'Repeat password', 'adminPasswordField', 'class="resetPasswordConfirmInput" data-user="' + u.id + '"') + '<button class="resetPasswordBtn ghost" data-user="' + u.id + '" type="button">Set password</button></div><button class="deleteUserBtn ghost danger" data-user="' + u.id + '" type="button"' + (self ? ' disabled' : '') + '>Delete</button></div></div>';
}

// Builds all manageable board-sharing panels.
function boardSharingSection(boards) {
  if (!boards.length) {
    return '<section class="panel adminPanel"><div class="adminHeader"><h2>Board sharing</h2></div><p class="muted">No boards are available to share yet.</p></section>';
  }
  return '<section class="panel adminPanel"><div class="adminHeader"><h2>Board sharing</h2></div><p class="muted boardSharingHint">Grant or remove full access per board. Admins and board owners keep access.</p><div class="boardSharingList">' + boards.map(boardSharingBoard).join('') + '</div></section>';
}

// Builds the sharing panel for one board.
function boardSharingBoard(board) {
  const id = boardId(board);
  const status = boardAccessSaveStatus[id] || '';
  return '<div class="boardSharingBoard" data-board="' + id + '"><div class="boardSharingBoardHeader"><div><h3>' + esc(boardName(board)) + '</h3><p class="muted">Owner: ' + esc(assigneeName(boardOwnerId(board))) + '</p></div><div class="boardSharingActions"><span class="boardAccessSaveState" data-board="' + id + '">' + esc(status) + '</span><button class="boardAccessSaveBtn" data-board="' + id + '" type="button">Save</button></div></div>' + state.users.map(u => boardSharingRow(u, board)).join('') + '</div>';
}

// Builds one board-sharing row for a user.
function boardSharingRow(u, board) {
  const admin = userIsAdmin(u);
  const id = boardId(board);
  const owner = boardOwnerId(board) === +u.id;
  const checked = (admin || owner || userHasBoardAccess(u.id, id)) ? ' checked' : '';
  const self = state.me && +state.me.id === +u.id;
  return '<div class="userRow adminUserRow boardSharingRow">' + avatar(u.avatar) +
    '<div><strong>' + esc(u.name) + (self ? ' <span class="pill">You</span>' : '') + (owner ? ' <span class="pill">Owner</span>' : '') + (admin ? ' <span class="pill">Admin</span>' : '') + '</strong><p class="muted">@' + esc(u.username || '') + '</p></div>' +
    '<div class="adminControls boardAccessControls"><label class="accessToggle"><input class="boardAccessToggle" type="checkbox" data-board="' + id + '" data-user="' + u.id + '" data-initial="' + (checked ? 'true' : 'false') + '"' + checked + ((admin || owner) ? ' disabled' : '') + '><span>Full access</span></label></div></div>';
}

// Returns whether a user currently has access to a board.
function userHasBoardAccess(userId, id = currentBoardId()) {
  const access = (state.allBoardAccess || []).length ? state.allBoardAccess : (state.boardAccess || []);
  const row = access.find(x => {
    const rowUser = +(x.userId ?? x.user_id ?? x.UserID);
    const rowBoard = +(x.boardId ?? x.board_id ?? x.BoardID ?? id);
    return rowUser === +userId && rowBoard === +id;
  });
  return !!(row && +(row.fullAccess ?? row.full_access ?? row.FullAccess));
}

// Marks a board-sharing panel as having unsaved changes.
function markBoardAccessDirty(e) {
  const id = +e.currentTarget.dataset.board;
  boardAccessSaveStatus[id] = 'Unsaved';
  const stateEl = $('.boardAccessSaveState[data-board="' + id + '"]');
  if (stateEl) stateEl.textContent = 'Unsaved';
}

// Saves changed board access rows for one board.
async function saveBoardAccess(e) {
  const button = e.currentTarget;
  const id = +button.dataset.board;
  const inputs = $$('.boardAccessToggle[data-board="' + id + '"]');
  const changed = inputs.filter(input => input.checked !== (input.dataset.initial === 'true'));
  const stateEl = $('.boardAccessSaveState[data-board="' + id + '"]');
  button.disabled = true;
  if (stateEl) stateEl.textContent = 'Saving...';
  try {
    for (const input of changed) {
      await api('/api/board-access', { method: 'POST', body: JSON.stringify({ BoardID: id, UserID: +input.dataset.user, FullAccess: input.checked }) });
      input.dataset.initial = input.checked ? 'true' : 'false';
      setBoardAccessState(id, +input.dataset.user, input.checked);
    }
    boardAccessSaveStatus[id] = 'Saved';
    if (stateEl) stateEl.textContent = 'Saved';
    window.setTimeout(() => {
      if (boardAccessSaveStatus[id] === 'Saved') {
        delete boardAccessSaveStatus[id];
        const freshState = $('.boardAccessSaveState[data-board="' + id + '"]');
        if (freshState) freshState.textContent = '';
      }
    }, 1800);
  } catch (err) {
    if (stateEl) stateEl.textContent = 'Error';
    alert((err.message || 'Board access could not be updated.').trim());
  } finally {
    button.disabled = false;
  }
}

// Updates local access state after saving board sharing.
function setBoardAccessState(boardID, userID, fullAccess) {
  const full = fullAccess ? 1 : 0;
  // Applies the saved access flag to whichever local access cache is present.
  const update = rows => {
    let row = rows.find(x => +(x.boardId ?? x.board_id ?? x.BoardID ?? boardID) === +boardID && +(x.userId ?? x.user_id ?? x.UserID) === +userID);
    if (!row) {
      row = { boardId: boardID, userId: userID };
      rows.push(row);
    }
    row.fullAccess = full;
    row.full_access = full;
  };
  update(state.allBoardAccess || (state.allBoardAccess = []));
  if (+boardID === currentBoardId()) update(state.boardAccess || (state.boardAccess = []));
}

// Toggles global admin rights for a user.
async function updateUserAdmin(e) {
  const input = e.currentTarget;
  const previous = !input.checked;
  try {
    await api('/api/users/admin', { method: 'POST', body: JSON.stringify({ UserID: +input.dataset.user, IsAdmin: input.checked }) });
    await load();
  } catch (err) {
    input.checked = previous;
    alert((err.message || 'Admin role could not be updated.').trim());
  }
}

// Sets a replacement password for a user.
async function resetUserPassword(e) {
  const userId = +e.currentTarget.dataset.user;
  const password = confirmedPassword('#resetPassword' + userId, '#resetPasswordConfirm' + userId, null, 'Please enter a new password.');
  if (!password) return;
  try {
    await api('/api/users/password', { method: 'POST', body: JSON.stringify({ UserID: userId, Password: password }) });
    clearPasswordInputs('#resetPassword' + userId, '#resetPasswordConfirm' + userId);
    alert('Password was updated. The user must change it after logging in.');
  } catch (err) {
    alert((err.message || 'Password could not be updated.').trim());
  }
}

// Creates a user from the admin form.
async function createUser() {
  const username = $('#createUsername').value.trim();
  const password = confirmedPassword('#createPassword', '#createConfirmPassword', null, 'Please enter an initial password.');
  if (!username) {
    $('#createUsername').focus();
    return;
  }
  if (!password) return;
  try {
    await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        Username: username,
        Password: password,
        BoardID: currentBoardId(),
        FullAccess: $('#createUserAccess').checked,
      }),
    });
    await load();
  } catch (err) {
    alert((err.message || 'User could not be created.').trim());
  }
}

// Deletes a regular user through the admin API.
async function deleteUser(e) {
  const userId = +e.currentTarget.dataset.user;
  const user = state.users.find(u => +u.id === userId);
  if (!user || (state.me && +state.me.id === userId)) return;
  if (!confirm('Delete ' + (user.name || user.username || 'this user') + '? This removes their sessions, comments, and board access.')) return;
  try {
    await api('/api/users', { method: 'DELETE', body: JSON.stringify({ UserID: userId }) });
    await load();
  } catch (err) {
    alert((err.message || 'User could not be deleted.').trim());
  }
}

// Renders the current configuration summary.
function renderConfig() {
  setHeader('Board information', 'A summary of your current board.');
  const root = $('#config');
  root.classList.remove('hidden');
  root.innerHTML = '<section class="panel"><h2>Current board</h2><div class="configGrid"><span>Name</span><strong>' + esc(state.board?.name || 'Board') + '</strong><span>Owner</span><strong>' + esc(assigneeName(currentBoardOwnerId())) + '</strong><span>Columns</span><strong>' + state.columns.length + '</strong><span>Labels</span><strong>' + state.labels.length + '</strong><span>Milestones</span><strong>' + state.milestones.length + '</strong><span>Tickets</span><strong>' + state.tickets.length + '</strong><span>Users</span><strong>' + state.users.length + '</strong></div></section>';
}

// The editor owns its draft; dependency and checklist edits never mutate loaded tickets.
function cloneTicketForEditing(ticket) {
  const draft = JSON.parse(JSON.stringify(ticket));
  draft.boardId = ticket.boardId || currentBoardId();
  draft.labels = [...(draft.labels || [])];
  draft.links = [...(draft.links || [])];
  return draft;
}

function resetDrawer() {
  editorGeneration++;
  editing = null;
  drawerMutation = null;
  drawerSnapshot = '';
  drawerDraftId = 0;
  pendingTicketId = 0;
  const drawer = $('#drawer');
  drawer.classList.add('hidden');
  drawer.innerHTML = '';
}

function isCurrentDrawer(binding) {
  return binding && binding.session === sessionGeneration && binding.generation === editorGeneration && editing?.id === binding.id;
}

function beginDrawerMutation() {
  if (!editing || drawerMutation || pendingTicketMutations.get(editing.id)?.session === sessionGeneration) return null;
  const binding = { id: editing.id, session: sessionGeneration, generation: editorGeneration, snapshot: currentDrawerSnapshot(), controls: [] };
  // Keep Close available, so users may navigate while a request completes.
  $('#drawer').querySelectorAll('input,select,textarea,button').forEach(field => {
    if (field.id === 'drawerCloseBtn' || field.id === 'closeBtn') return;
    binding.controls.push([field, field.disabled]);
    field.disabled = true;
  });
  drawerMutation = binding;
  pendingTicketMutations.set(binding.id, binding);
  return binding;
}

function finishDrawerMutation(binding) {
  if (pendingTicketMutations.get(binding.id) === binding) pendingTicketMutations.delete(binding.id);
  if (drawerMutation !== binding) return;
  if (binding.generation === editorGeneration && editing?.id === binding.id) {
    binding.controls.forEach(([field, disabled]) => { field.disabled = disabled; });
  }
  drawerMutation = null;
}

// Closes the ticket drawer and optionally updates the route.
function closeDrawer(updateRoute = true) {
  if (!canLeaveDrawer()) return false;
  resetDrawer();
  if (updateRoute) syncRoute('replace', 0);
  return true;
}

// Opens the ticket drawer for editing one ticket.
function openTicket(id, updateRoute = true) {
  if (selectedBoardId && selectedBoardId !== currentBoardId()) return;
  if (pendingTicketMutations.get(id)?.session === sessionGeneration) {
    $('#viewSubtitle').textContent = 'This task is still being updated. Please wait before reopening it.';
    return;
  }
  const ticket = state.tickets.find(t => t.id === id);
  if (!ticket) return;
  if (editing && !canLeaveDrawer()) return;
  resetDrawer();
  editing = cloneTicketForEditing(ticket);
  if (updateRoute) syncRoute('push', editing.id);
  const users = state.users.map(u => '<option value="' + u.id + '">' + esc(u.name) + '</option>').join('');
  const miles = '<option value="0">No milestone</option>' + state.milestones.map(m => '<option value="' + m.id + '">' + esc(m.name) + '</option>').join('');
  const labelText = editing.labels.join(', ');
  const blocked = unfinishedDependencies(editing);
  const idea = isIdea(editing);
  const typeOptions = ['epic', 'story', 'task', 'bug', 'idea'].map(type => '<option>' + type + '</option>').join('');
  const planningFields = idea ? '' : '<label>Duration (days)<input id="dDuration" type="number" min="0" max="365" value="' + ticketDuration(editing) + '"></label><label>Start date<input id="dStart" type="date" value="' + (editing.startDate || '') + '"></label><label>Due date<input id="dDue" type="date" value="' + (editing.dueDate || '') + '"></label><label>Assignee<select id="dAssignee"><option value="0">Nobody</option>' + users + '</select></label><label>Milestone<select id="dMilestone">' + miles + '</select></label>' + parentSelectHtml(editing) + dependencyPickerHtml(editing);
  $('#drawer').classList.remove('hidden');
  $('#drawer').innerHTML = '<div class="drawerHeader"><h2>' + esc(ticketRef(editing)) + '</h2><button id="drawerCloseBtn" class="iconBtn" type="button" title="Close" aria-label="Close editor">&times;</button></div><p id="drawerError" class="drawerError" role="alert"></p>' + (blocked.length && !idea ? '<p class="dependencyWarning">Review and completion require these tickets to be done: ' + blocked.map(t => esc(ticketLabel(t))).join(', ') + '</p>' : '') + '<label>Title<input id="dTitle" value="' + escAttr(editing.title) + '"></label><label>Description<textarea id="dBody">' + esc(editing.body) + '</textarea></label><label>Type<select id="dType">' + typeOptions + '</select></label>' + planningFields + '<label>Labels<input id="dLabels" value="' + escAttr(labelText) + '"></label><div style="margin-top:12px"><button id="saveBtn">Save</button> <button id="deleteBtn" class="ghost">Delete</button> <button id="closeBtn" class="ghost">Close</button></div><section class="comments"><strong>Comments</strong><div id="commentList"></div><textarea id="commentBody" placeholder="Comment"></textarea><button id="commentBtn">Comment</button></section>';
  $('#dType').value = editing.type;
  if (!idea) {
    $('#dAssignee').value = editing.assigneeId;
    $('#dMilestone').value = editing.milestoneId;
    renderDrawerParentSelect(editing.parentId || 0);
    $('#dType').onchange = () => renderDrawerParentSelect();
  }
  $('#drawerCloseBtn').onclick = closeDrawer;
  $('#saveBtn').onclick = saveDrawer;
  $('#deleteBtn').onclick = deleteTicket;
  $('#closeBtn').onclick = closeDrawer;
  $('#commentBtn').onclick = addComment;
  setupDependencyPicker();
  renderComments();
  enhanceTaskDrawer();
  drawerDraftId = editing.id;
  drawerSnapshot = currentDrawerSnapshot();
}

// Renders comments for the currently edited ticket.
function renderComments() {
  if (!editing) return;
  const list = state.comments.filter(c => (c.ticketId ?? c.ticket_id) == editing.id);
  $('#commentList').innerHTML = list.map(c => {
    const userId = +(c.userId ?? c.user_id ?? 0);
    const author = c.authorName || userById(userId)?.name || 'Former colleague';
    return '<p class="row"><strong>' + esc(author) + (!userId && c.authorName ? ' (imported)' : '') + '</strong><br>' + esc(c.body) + '<br><span class="muted">' + esc(c.createdAt ?? c.created_at) + '</span></p>';
  }).join('') || '<p class="muted">No comments yet</p>';
}

// Displays an error message inside the ticket drawer.
function showDrawerError(message) {
  const el = $('#drawerError');
  if (el) el.textContent = message || '';
}

// Builds the dependency picker markup for the drawer.
function dependencyPickerHtml(ticket) {
  return '<div class="drawerField dependencyFieldWrap"><span class="drawerLabel">Depends on</span><button id="dependencyField" class="dependencyField" type="button">' + esc(dependencySummary(ticket.links)) + '</button><div id="dependencyPicker" class="dependencyPicker hidden"><input id="dependencySearch" type="search" placeholder="Search tickets"><div id="dependencyOptions" class="dependencyOptions"></div></div></div>';
}

// Formats selected dependency ids for a compact display.
function dependencySummary(ids) {
  const deps = (ids || []).map(id => state.tickets.find(t => t.id == id)).filter(Boolean);
  return deps.length ? deps.map(ticketLabel).join(', ') : 'No dependencies';
}

// Attaches interactions for the drawer dependency picker.
function setupDependencyPicker() {
  const field = $('#dependencyField');
  const picker = $('#dependencyPicker');
  const search = $('#dependencySearch');
  if (!field || !picker || !search) return;
  field.onclick = () => {
    picker.classList.toggle('hidden');
    renderDependencyOptions();
    if (!picker.classList.contains('hidden')) search.focus();
  };
  search.oninput = renderDependencyOptions;
  renderDependencyOptions();
}

// Renders available dependency checkboxes in the drawer.
function renderDependencyOptions() {
  const root = $('#dependencyOptions');
  if (!root || !editing) return;
  const q = ($('#dependencySearch')?.value || '').toLowerCase();
  const selected = new Set((editing.links || []).map(Number));
  const options = workTickets().filter(t => t.id !== editing.id).filter(t => !q || (ticketLabel(t) + ' ' + t.type).toLowerCase().includes(q));
  root.innerHTML = options.map(t => '<label class="dependencyOption"><input type="checkbox" value="' + t.id + '" ' + (selected.has(t.id) ? 'checked' : '') + '><span><strong>' + esc(ticketLabel(t)) + '</strong><small>' + esc(t.type) + (t.dueDate ? ' - ' + esc(t.dueDate) : '') + '</small></span></label>').join('') || '<p class="muted">No matching tickets</p>';
  $$('#dependencyOptions input[type="checkbox"]').forEach(input => input.onchange = () => {
    const set = new Set((editing.links || []).map(Number));
    const id = +input.value;
    if (input.checked) set.add(id);
    else set.delete(id);
    editing.links = [...set];
    $('#dependencyField').textContent = dependencySummary(editing.links);
  });
}

// Attaches interactions for the new-ticket dependency picker.
function setupNewDependencyPicker() {
  const field = $('#newDependencyField');
  const picker = $('#newDependencyPicker');
  const search = $('#newDependencySearch');
  if (!field || !picker || !search) return;
  field.textContent = dependencySummary(newTicketLinks);
  field.onclick = () => {
    picker.classList.toggle('hidden');
    renderNewDependencyOptions();
    if (!picker.classList.contains('hidden')) search.focus();
  };
  search.oninput = renderNewDependencyOptions;
  renderNewDependencyOptions();
}

// Renders dependency checkboxes for the new-ticket composer.
function renderNewDependencyOptions() {
  const root = $('#newDependencyOptions');
  if (!root) return;
  const q = ($('#newDependencySearch')?.value || '').toLowerCase();
  const selected = new Set(newTicketLinks.map(Number));
  const options = workTickets().filter(t => !q || (ticketLabel(t) + ' ' + t.type).toLowerCase().includes(q));
  root.innerHTML = options.map(t => '<label class="dependencyOption"><input type="checkbox" value="' + t.id + '" ' + (selected.has(t.id) ? 'checked' : '') + '><span><strong>' + esc(ticketLabel(t)) + '</strong><small>' + esc(t.type) + (t.dueDate ? ' - ' + esc(t.dueDate) : '') + '</small></span></label>').join('') || '<p class="muted">No matching tickets</p>';
  $$('#newDependencyOptions input[type="checkbox"]').forEach(input => input.onchange = () => {
    const set = new Set(newTicketLinks.map(Number));
    const id = +input.value;
    if (input.checked) set.add(id);
    else set.delete(id);
    newTicketLinks = [...set];
    $('#newDependencyField').textContent = dependencySummary(newTicketLinks);
  });
}

// Persists changes from the ticket drawer.
async function saveDrawer() {
  const binding = beginDrawerMutation();
  if (!binding) return;
  const nextType = normalizeTicketType($('#dType').value);
  const idea = nextType === 'idea';
  const next = { ...editing,
    title: $('#dTitle').value,
    body: $('#dBody').value,
    type: nextType,
    duration: idea ? 0 : (+($('#dDuration')?.value || 0)),
    startDate: idea ? '' : ($('#dStart')?.value || ''),
    dueDate: idea ? '' : ($('#dDue')?.value || ''),
    assigneeId: idea ? 0 : (+($('#dAssignee')?.value || 0)),
    milestoneId: idea ? 0 : (+($('#dMilestone')?.value || 0)),
    parentId: idea ? 0 : (+($('#dParent')?.value || 0)),
    labels: $('#dLabels').value.split(',').map(x => x.trim()).filter(Boolean),
    links: idea ? [] : (editing.links || []).map(Number).filter(Boolean),
    columnId: +($('#dStatus')?.value || editing.columnId),
    extras: collectTaskExtras(),
  };
  try {
    await putTicket(next);
    if (binding.session !== sessionGeneration) return;
    if (isCurrentDrawer(binding)) {
      // Saving the task does not post a comment draft.
      const savedFields = JSON.parse(binding.snapshot);
      savedFields.forEach(field => { if (field[0] === 'commentBody') field[1] = ''; });
      drawerSnapshot = JSON.stringify(savedFields);
      if (currentDrawerSnapshot() === drawerSnapshot) closeDrawer();
    }
    await load();
  } catch (e) {
    if (isCurrentDrawer(binding)) showDrawerError((e.message || 'Ticket could not be saved.').trim());
  } finally {
    finishDrawerMutation(binding);
  }
}

// Saves a ticket through the API.
async function saveTicket(t) {
  const isCurrent = currentSessionGuard();
  await putTicket(t);
  if (isCurrent()) await load();
}

// Builds and sends the complete ticket payload without forcing an intermediate refresh.
async function putTicket(t) {
  await api('/api/tickets/' + t.id, { method: 'PUT', body: JSON.stringify({ BoardID: t.boardId || currentBoardId(), ColumnID: t.columnId || state.columns[0]?.id, ParentID: t.parentId || 0, Ref: t.ref || '', Title: t.title, Body: t.body || '', Type: t.type, Points: t.points || 0, Duration: t.duration || 0, StartDate: t.startDate || '', DueDate: t.dueDate || '', MilestoneID: t.milestoneId || 0, AssigneeID: t.assigneeId || 0, Position: t.position || 0, Labels: t.labels || [], Links: t.links || [], IsBacklog: !!t.isBacklog, Extras: t.extras || {Checklist: [], RepeatDays: 0} }) });
}

// Converts legacy idea notes into a supported delivery type when promoted.
function normalizePromotionType(t) {
  const type = normalizeTicketType(t?.type);
  return type === 'idea' ? 'task' : type;
}

// Returns all backlog descendants of a parent, preserving parent-first order.
function backlogDescendants(parentId, seen = new Set()) {
  if (!parentId || seen.has(+parentId)) return [];
  seen.add(+parentId);
  return state.tickets.filter(t => isBacklogTicket(t) && +t.parentId === +parentId).sort(ticketOrder).flatMap(child => [child, ...backlogDescendants(child.id, seen)]);
}

// Promotes an item, or an entire Epic tree, from Backlog onto the first board column.
async function promoteBacklogTicket(ticket, epicId = 0) {
  if (!ticket || !isBacklogTicket(ticket)) throw new Error('Choose a Backlog item first.');
  const firstColumn = state.columns[0]?.id;
  if (!firstColumn) throw new Error('This board has no workflow column.');
  const isEpic = normalizePromotionType(ticket) === 'epic';
  const promote = async (item, parentId = item.parentId || 0) => {
    const next = { ...item, type: normalizePromotionType(item), columnId: firstColumn, parentId, isBacklog: false };
    await putTicket(next);
  };
  if (isEpic) {
    await promote(ticket, 0);
    for (const child of backlogDescendants(ticket.id)) await promote(child);
  } else {
    const epic = epicId ? parentTicket(epicId) : null;
    if (epicId && (!epic || normalizeTicketType(epic.type) !== 'epic')) throw new Error('Choose a valid Epic.');
    if (epic && isBacklogTicket(epic)) await promote(epic, 0);
    await promote(ticket, epicId);
  }
  await load();
}

// Deletes the currently edited ticket through the API.
async function deleteTicket() {
  await taskDrawerAction('trash');
}

// Adds a comment to the currently edited ticket.
async function addComment() {
  if (!editing || drawerMutation) return;
  const commentDraft = $('#commentBody').value;
  const body = commentDraft.trim();
  if (!body) return;
  const binding = beginDrawerMutation();
  if (!binding) return;
  try {
    await api('/api/tickets/' + binding.id + '/comments', { method: 'POST', body: JSON.stringify({ Body: body }) });
    if (binding.session !== sessionGeneration) return;
    if (isCurrentDrawer(binding)) {
      if ($('#commentBody').value === commentDraft) $('#commentBody').value = '';
      // Keep the original task-field baseline, so posting does not save task edits.
      const snapshotFields = JSON.parse(drawerSnapshot || '[]');
      snapshotFields.forEach(field => { if (field[0] === 'commentBody') field[1] = ''; });
      drawerSnapshot = JSON.stringify(snapshotFields);
    }
    await load();
    if (isCurrentDrawer(binding)) {
      renderComments();
      if ($('#taskActivityList')) $('#taskActivityList').innerHTML = taskActivityHTML(binding.id);
    }
  } catch (err) {
    if (isCurrentDrawer(binding)) showDrawerError((err.message || 'Comment could not be posted.').trim());
  } finally {
    finishDrawerMutation(binding);
  }
}

// Shows a board composer error message.
function showFormError(message) {
  $('#formError').textContent = message || '';
}

$('#addBtn').onclick = async () => {
  const title = $('#newTitle').value.trim();
  showFormError('');
  if (!title) {
    showFormError('Please enter a ticket title.');
    $('#newTitle').focus();
    return;
  }
  if (!currentBoardId()) {
    showFormError('No board is available for your account yet.');
    return;
  }
  try {
    await api('/api/tickets' + boardQuery(), { method: 'POST', body: JSON.stringify({ BoardID: currentBoardId(), Title: title, Type: $('#newType').value, ParentID: +$('#newParent').value || 0, Duration: +$('#newDuration').value || 0, DueDate: $('#newDue').value, ColumnID: state.columns[0]?.id, Links: newTicketLinks }) });
    $('#newTitle').value = '';
    $('#newParent').value = '0';
    $('#newDuration').value = '';
    newTicketLinks = [];
    $('#newDependencyPicker').classList.add('hidden');
    $('#newDependencySearch').value = '';
    await load();
  } catch (e) {
    showFormError((e.message || 'Ticket could not be created.').trim());
  }
};

// Creates a typed work item in the product backlog.
async function createBacklogTicket() {
  const title = $('#backlogTitle').value.trim();
  const body = $('#backlogBody').value.trim();
  const type = normalizeTicketType($('#backlogType').value);
  if (!title) {
    $('#backlogError').textContent = 'Please enter a title.';
    $('#backlogTitle').focus();
    return;
  }
  if (!currentBoardId()) {
    $('#backlogError').textContent = 'No board is available for your account yet.';
    return;
  }
  try {
    $('#backlogError').textContent = '';
    await api('/api/tickets' + boardQuery(), { method: 'POST', body: JSON.stringify({ BoardID: currentBoardId(), Title: title, Body: body, Type: type, ParentID: type === 'epic' ? 0 : (+$('#backlogParent').value || 0), Duration: +$('#backlogDuration').value || 0, DueDate: $('#backlogDue').value || '', ColumnID: state.columns[0]?.id, IsBacklog: true }) });
    await load();
  } catch (err) {
    $('#backlogError').textContent = (err.message || 'Backlog item could not be created.').trim();
  }
}

$$('.navButton').forEach(b => b.onclick = () => {
  if (!canLeaveDrawer()) return;
  $$('.toolsMenu').forEach(menu => menu.open = false);
  view = b.dataset.view;
  if (!['board', 'overview', 'timeline'].includes(view)) timelineFocusSprint = 0;
  if (view === 'timeline' && timelineFocusSprint) { timelineEpicFilter = 'all'; timelineZoom = 1; dependencyFocusTicketId = 0; dependencyFocused = false; }
  timelineCenterDate = null;
  closeDrawer(false);
  renderView();
  syncRoute('push', 0);
});

$('#homeLink').onclick = e => {
  e.preventDefault();
  if (!canLeaveDrawer()) return;
  view = 'board';
  timelineCenterDate = null;
  closeDrawer(false);
  renderView();
  syncRoute('push', 0);
};

['search', 'typeFilter', 'labelFilter', 'assigneeFilter', 'dependencyFilter'].forEach(id => {
  const el = $('#' + id);
  if (el) {
    el.oninput = renderView;
    el.onchange = renderView;
  }
});
$('#newType').onchange = renderNewParentSelect;
$('#newTitle').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); $('#addBtn').click(); } };
$('#exportBtn').onclick = () => location.href = '/api/export' + boardQuery();
async function importBoardFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  if (!canLeaveDrawer()) { e.target.value = ''; return; }
  const url = '/api/import' + boardQuery();
  const isCurrent = currentSessionGuard();
  closeDrawer();
  try {
    const body = await f.text();
    if (!isCurrent()) return;
    await api(url, { method: 'POST', body }, isCurrent);
    if (isCurrent()) await load();
  } catch (err) {
    if (isCurrent()) showLoadError(err);
  } finally {
    e.target.value = '';
  }
}
$('#importFile').onchange = importBoardFile;
function restoreLoginRoute() {
  if (!router) return;
  const route = router.parseRoute();
  view = route.view;
  selectedBoardId = route.boardId || selectedBoardId;
  pendingTicketId = route.ticketId;
  timelineFocusSprint = ['board', 'overview', 'timeline'].includes(view) ? route.sprintNumber : 0;
  planningSprintBoardId = route.boardId || selectedBoardId;
}
$('#loginBtn').onclick = async () => {
  invalidateSessionRequests();
  resetDrawer();
  restoreLoginRoute();
  const isCurrent = currentSessionGuard();
  try {
    $('#loginError').textContent = '';
    await api('/api/login', { method: 'POST', body: JSON.stringify({ Login: $('#loginUsername').value, Password: $('#password').value }) });
    if (isCurrent()) await load();
  } catch (e) {
    if (isCurrent()) $('#loginError').textContent = (e.message || 'Login failed.').trim();
  }
};
$('#signupBtn').onclick = async () => {
  let isCurrent = currentSessionGuard();
  try {
    $('#signupError').textContent = '';
    const username = $('#signupUsername').value.trim();
    const password = confirmedPassword('#signupPassword', '#signupConfirmPassword', '#signupError');
    if (!username) {
      $('#signupError').textContent = 'Please enter a username.';
      $('#signupUsername').focus();
      return;
    }
    if (!password) return;
    invalidateSessionRequests();
    resetDrawer();
    restoreLoginRoute();
    isCurrent = currentSessionGuard();
    await api('/api/signup', { method: 'POST', body: JSON.stringify({ Username: username, Password: password }) });
    if (isCurrent()) await load();
  } catch (e) {
    if (isCurrent()) $('#signupError').textContent = (e.message || 'Signup failed.').trim();
  }
};
$('#forgotPasswordBtn').onclick = () => {
  $('#loginError').textContent = 'Please contact an admin to set a new password.';
};
$('#savePasswordBtn').onclick = async () => {
  const isCurrent = currentSessionGuard();
  try {
    $('#passwordError').textContent = '';
    const newPassword = confirmedPassword('#newPassword', '#confirmPassword', '#passwordError', 'Please enter a new password.');
    if (!newPassword) return;
    await api('/api/password', { method: 'POST', body: JSON.stringify({ CurrentPassword: $('#currentPassword').value, NewPassword: newPassword }) });
    if (!isCurrent()) return;
    invalidateSessionRequests();
    await load();
  } catch (e) {
    if (isCurrent()) $('#passwordError').textContent = (e.message || 'Password could not be changed.').trim();
  }
};
$('#cancelPasswordBtn').onclick = hidePasswordChange;
enhancePasswordReveals(document);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#drawer').classList.contains('hidden')) closeDrawer();
  else if (e.key === 'Escape' && !$('#passwordPanel').classList.contains('hidden') && !currentUserMustChangePassword()) hidePasswordChange();
});
document.addEventListener('click', e => {
  const me = $('#me');
  if (me && !me.contains(e.target)) $('#accountMenu')?.classList.add('hidden');
});
window.addEventListener('hashchange', () => {
  if (!router || !state.me) return;
  applyRoute(router.parseRoute());
});

window.openTicket = openTicket;
window.addEventListener('beforeunload', event => {
  if (editing && drawerSnapshot && currentDrawerSnapshot() !== drawerSnapshot) { event.preventDefault(); event.returnValue = ''; }
});

// Escapes text for safe HTML content.
function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

// Escapes text for safe HTML attribute values.
function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}

load();
