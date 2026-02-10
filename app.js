const STORAGE_KEY = 'offlinePlanner.v1';
const DEFAULT_WORKBLOCKS = { email: 1, teams: 1 };
const VIEWS = ['Today', 'Backlog', 'Planner', 'Stats'];
let activeView = 'Today';
let state = loadState();
let focusSession = null;

init();

function init() {
  renderNav();
  bindTopbar();
  render();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    tasks: [],
    dayPlans: {},
    focusSessions: [],
    dailyStats: {}
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid(prefix='id') {
  return `${prefix}_${Math.random().toString(36).slice(2,10)}_${Date.now().toString(36)}`;
}

function todayISO() { return new Date().toISOString().slice(0,10); }
function addDays(iso, days){ const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); }
function nowIso() { return new Date().toISOString(); }

function getPlan(day) {
  if (!state.dayPlans[day]) {
    state.dayPlans[day] = {
      meetings: Array(16).fill(false),
      workblocks: { ...DEFAULT_WORKBLOCKS },
      bufferPercent: 0
    };
  }
  return state.dayPlans[day];
}

function parseTaskLine(line) {
  const trimmed = line.trim();
  const m = trimmed.match(/^(.*\S)\s+(\d+)$/);
  if (!m) throw new Error('Task line must end with a number of minutes.');
  const title = m[1].trim();
  const minutes = Number(m[2]);
  if (!title || !minutes || minutes < 1) throw new Error('Invalid task input.');
  return { title, minutes };
}

function splitMinutes(minutes) {
  if (minutes <= 30) return [minutes];
  const full = Math.floor(minutes / 30);
  const rem = minutes % 30;
  if (rem === 0) return Array(full).fill(30);
  if (rem < 10 && full > 0) return [...Array(full - 1).fill(30), 30 + rem];
  return [...Array(full).fill(30), rem];
}

function addTaskFromLine(line, dueDate, priority) {
  const parsed = parseTaskLine(line);
  const parts = splitMinutes(parsed.minutes);
  const groupId = parts.length > 1 ? uid('group') : undefined;
  parts.forEach((mins, idx) => {
    const task = {
      id: uid('task'),
      title: parts.length > 1 ? `${parsed.title} (${idx + 1}/${parts.length})` : parsed.title,
      minutes: mins,
      dueDate: dueDate || null,
      priority: priority || 'low',
      status: 'open',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      dayAssigned: priority === 'urgent' ? todayISO() : null,
      groupId,
      partIndex: parts.length > 1 ? idx + 1 : null,
      partTotal: parts.length > 1 ? parts.length : null,
      bumpedCount: 0
    };
    state.tasks.push(task);
  });
  saveState();
}

function dueBucket(task, day=todayISO()) {
  if (!task.dueDate) return 'none';
  if (task.dueDate < day) return 'overdue';
  if (task.dueDate === day) return 'today';
  if (task.dueDate <= addDays(day, 7)) return 'week';
  return 'later';
}

function sortOpenTasks(tasks) {
  const day = todayISO();
  const pRank = { urgent: 0, high: 1, low: 2 };
  return [...tasks].sort((a,b) => {
    if (a.priority !== b.priority) return pRank[a.priority] - pRank[b.priority];
    const ad = dueBucket(a, day) === 'overdue' ? 0 : 1;
    const bd = dueBucket(b, day) === 'overdue' ? 0 : 1;
    if (ad !== bd) return ad - bd;
    const adate = a.dueDate || '9999-99-99';
    const bdate = b.dueDate || '9999-99-99';
    if (adate !== bdate) return adate.localeCompare(bdate);
    return a.minutes - b.minutes;
  });
}

function capacityForDay(day) {
  const plan = getPlan(day);
  const meetingMins = plan.meetings.filter(Boolean).length * 30;
  const workblockMins = Object.values(plan.workblocks).reduce((s,v)=>s+Number(v||0),0) * 30;
  return Math.max(0, 480 - meetingMins - workblockMins);
}

function plannedForDay(day) {
  return state.tasks.filter(t => t.status === 'open' && t.dayAssigned === day).reduce((s,t)=>s+t.minutes,0);
}

function adjustedPlannedForDay(day) {
  const p = plannedForDay(day);
  const buffer = getPlan(day).bufferPercent || 0;
  return Math.round(p * (1 + buffer / 100));
}

function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = '';
  VIEWS.forEach(name => {
    const b = document.createElement('button');
    b.textContent = name;
    if (name === activeView) b.classList.add('active');
    b.onclick = () => { activeView = name; renderNav(); render(); };
    nav.appendChild(b);
  });
}

function bindTopbar() {
  document.getElementById('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `planner-export-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  document.getElementById('importInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const parsed = JSON.parse(fr.result);
        if (!parsed.tasks || !parsed.dayPlans) throw new Error('Invalid format');
        state = parsed;
        saveState();
        render();
      } catch (err) {
        alert(`Import failed: ${err.message}`);
      }
    };
    fr.readAsText(file);
  });
}

function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  if (activeView === 'Today') renderToday(app);
  if (activeView === 'Backlog') renderBacklog(app);
  if (activeView === 'Planner') renderPlanner(app);
  if (activeView === 'Stats') renderStats(app);
}

function taskTable(tasks, opts = {}) {
  const { showTodayActions=false, showBacklogActions=false, showPlannerActions=false, day=todayISO() } = opts;
  const table = document.createElement('table');
  table.className = 'task-table';
  table.innerHTML = `<thead><tr><th>Title</th><th>Min</th><th>Due</th><th>Priority</th><th>Actions</th></tr></thead>`;
  const tb = document.createElement('tbody');
  tasks.forEach(task => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(task.title)}</td><td>${task.minutes}</td><td>${task.dueDate || '-'}</td><td><span class="badge priority-${task.priority}">${task.priority}</span></td><td class="actions"></td>`;
    const actions = tr.querySelector('.actions');
    const done = mkBtn('Done', () => { task.status = 'done'; task.updatedAt = nowIso(); saveState(); render(); }, 'primary');
    const tackle = mkBtn('Tackle', () => startFocus(task.id));
    const remToday = mkBtn('Remove from Today', () => { task.dayAssigned = null; task.updatedAt = nowIso(); saveState(); render(); });
    const addToday = mkBtn('Add to Today', () => { task.dayAssigned = todayISO(); task.updatedAt = nowIso(); saveState(); render(); });
    const removePlan = mkBtn('Unassign', () => { task.dayAssigned = null; task.updatedAt = nowIso(); saveState(); render(); });

    if (showTodayActions) { actions.append(tackle, done, remToday); }
    if (showBacklogActions) { actions.append(addToday); }
    if (showPlannerActions) {
      if (task.dayAssigned === day) actions.append(removePlan); else actions.append(mkBtn('Assign', () => { task.dayAssigned = day; task.updatedAt = nowIso(); saveState(); render(); }));
    }
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  return table;
}

function renderTaskInput(container) {
  const tpl = document.getElementById('taskInputTemplate').content.cloneNode(true);
  tpl.getElementById?.('taskForm');
  container.appendChild(tpl);
  const form = container.querySelector('#taskForm');
  form.onsubmit = (e) => {
    e.preventDefault();
    try {
      addTaskFromLine(
        form.querySelector('#taskLine').value,
        form.querySelector('#taskDue').value,
        form.querySelector('#taskPriority').value
      );
      form.reset();
      render();
    } catch (err) {
      alert(err.message);
    }
  };
}

function renderToday(app) {
  const day = todayISO();
  const plan = getPlan(day);
  const wrap = document.createElement('div');
  wrap.className = 'columns';

  const left = document.createElement('div');
  renderTaskInput(left);

  const capacity = document.createElement('section');
  capacity.className = 'card';
  capacity.innerHTML = `<h2>Capacity (09:00-17:00)</h2><div class="small">Toggle unavailable meeting slots.</div>`;
  const grid = document.createElement('div');
  grid.className = 'grid16';
  for (let i=0;i<16;i++) {
    const hr = 9 + Math.floor(i/2);
    const mm = i%2===0 ? '00' : '30';
    const btn = mkBtn(`${String(hr).padStart(2,'0')}:${mm}`, () => {
      plan.meetings[i] = !plan.meetings[i]; saveState(); render();
    });
    btn.className = `slot ${plan.meetings[i] ? 'off':''}`;
    grid.appendChild(btn);
  }
  const wb = document.createElement('div');
  wb.className = 'row wrap';
  wb.innerHTML = `
    <label>Email blocks <input type="number" min="0" step="1" id="wbEmail" value="${plan.workblocks.email ?? 1}" /></label>
    <label>Teams blocks <input type="number" min="0" step="1" id="wbTeams" value="${plan.workblocks.teams ?? 1}" /></label>
    <label>Buffer % <input type="number" min="0" max="100" step="5" id="buffer" value="${plan.bufferPercent || 0}" /></label>
    <button id="resetBuffer">Reset Buffer</button>
  `;
  wb.querySelector('#wbEmail').onchange = (e) => { plan.workblocks.email = Number(e.target.value||0); saveState(); render(); };
  wb.querySelector('#wbTeams').onchange = (e) => { plan.workblocks.teams = Number(e.target.value||0); saveState(); render(); };
  wb.querySelector('#buffer').onchange = (e) => { plan.bufferPercent = Number(e.target.value||0); saveState(); render(); };
  wb.querySelector('#resetBuffer').onclick = () => { plan.bufferPercent = 0; saveState(); render(); };

  const available = capacityForDay(day);
  const planned = plannedForDay(day);
  const adjusted = adjustedPlannedForDay(day);
  const remaining = available - adjusted;

  const totals = document.createElement('div');
  totals.className = `row wrap ${remaining < 0 ? 'warn-text' : ''}`;
  totals.innerHTML = `<strong>Available: ${available}m</strong><strong>Planned: ${planned}m</strong><strong>Adjusted (${plan.bufferPercent || 0}%): ${adjusted}m</strong><strong>Remaining: ${remaining}m</strong>`;

  capacity.append(grid, wb, totals);
  if (remaining < 0) {
    const banner = document.createElement('div');
    banner.className = 'banner';
    banner.textContent = 'Overbooked today (soft warning): capacity is below buffer-adjusted planned time.';
    capacity.appendChild(banner);
  }

  const todayTasks = sortOpenTasks(state.tasks.filter(t => t.status === 'open' && t.dayAssigned === day));
  const todayCard = document.createElement('section');
  todayCard.className = 'card';
  todayCard.innerHTML = '<h2>Today List</h2>';
  todayCard.appendChild(taskTable(todayTasks, { showTodayActions: true }));

  const closeCard = document.createElement('section');
  closeCard.className = 'card';
  closeCard.innerHTML = `<h3>End of day</h3><label><input type="checkbox" id="moveBumped" /> Move bumped tasks to next day</label>`;
  const closeBtn = mkBtn('Close Day', () => closeDay(day, closeCard.querySelector('#moveBumped').checked), 'warn');
  closeCard.appendChild(closeBtn);

  const preview = document.createElement('section');
  preview.className = 'card';
  const remainingNominal = Math.max(0, available - planned);
  const pool = sortOpenTasks(state.tasks.filter(t => t.status === 'open' && !t.dayAssigned));
  const fit = pool.filter(t => t.minutes <= remainingNominal);
  const le5 = pool.filter(t => t.minutes <= 5);
  const le10 = pool.filter(t => t.minutes <= 10);
  const le15 = pool.filter(t => t.minutes <= 15);
  const le30 = pool.filter(t => t.minutes <= 30);
  preview.innerHTML = `<h3>Backlog preview</h3><div class="small">Fits remaining: ${fit.length} | <=5: ${le5.length} | <=10: ${le10.length} | <=15: ${le15.length} | <=30: ${le30.length}</div>`;
  preview.appendChild(taskTable(pool.slice(0,10), { showBacklogActions: true }));

  left.append(capacity, todayCard, closeCard);
  wrap.append(left, preview);
  app.appendChild(wrap);
}

function closeDay(day, moveToNext) {
  const openToday = state.tasks.filter(t => t.status === 'open' && t.dayAssigned === day);
  openToday.forEach(t => {
    t.bumpedCount = (t.bumpedCount || 0) + 1;
    t.dayAssigned = moveToNext ? addDays(day, 1) : null;
    t.updatedAt = nowIso();
  });
  state.dailyStats[day] = makeDailySnapshot(day);
  saveState();
  render();
}

function makeDailySnapshot(day) {
  const sessions = state.focusSessions.filter(s => s.startAt.slice(0,10) === day);
  const completedMinutes = sessions.filter(s => s.outcome === 'done').reduce((n,s)=>n+s.actualMinutes,0);
  const plannedMinutes = plannedForDay(day);
  const plannedTasks = state.tasks.filter(t => t.dayAssigned === day).length;
  const doneTaskIds = new Set(sessions.filter(s => s.outcome === 'done').map(s => s.taskId));
  const doneTasks = doneTaskIds.size;
  const bumpedTasks = state.tasks.filter(t => t.bumpedCount > 0 && t.updatedAt.slice(0,10) === day).length;
  const extensionCount = sessions.reduce((n,s)=>n + (s.extensionCount || 0),0);
  const extensionRate = sessions.length ? (extensionCount / sessions.length) : 0;
  const errors = sessions.filter(s => s.outcome === 'done').map(s => Math.abs(s.actualMinutes - s.plannedMinutes));
  const avgEstimationError = errors.length ? Math.round(errors.reduce((a,b)=>a+b,0)/errors.length) : 0;
  return { day, plannedMinutes, completedMinutes, plannedTasks, doneTasks, bumpedTasks, extensionRate, avgEstimationError, createdAt: nowIso() };
}

function renderBacklog(app) {
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = `<h2>Backlog</h2>
  <div class="row wrap">
    <label>Duration <select id="dur"><option value="all">All</option><option value="5"><=5</option><option value="10"><=10</option><option value="15"><=15</option><option value="30"><=30</option></select></label>
    <label>Due <select id="due"><option value="all">All</option><option value="overdue">Overdue</option><option value="today">Today</option><option value="week">This week</option></select></label>
    <label>Priority <select id="priority"><option value="all">All</option><option value="urgent">Urgent</option><option value="high">High</option><option value="low">Low</option></select></label>
    <label>Sort <select id="sort"><option value="priority">Priority-first</option><option value="due">Due-date-first</option><option value="short">Shortest-first</option></select></label>
  </div>`;
  app.appendChild(card);
  const list = document.createElement('div');
  card.appendChild(list);

  const draw = () => {
    const d = card.querySelector('#dur').value;
    const due = card.querySelector('#due').value;
    const p = card.querySelector('#priority').value;
    const sortMode = card.querySelector('#sort').value;
    let tasks = state.tasks.filter(t => t.status === 'open');
    if (d !== 'all') tasks = tasks.filter(t => t.minutes <= Number(d));
    if (due !== 'all') tasks = tasks.filter(t => dueBucket(t) === due);
    if (p !== 'all') tasks = tasks.filter(t => t.priority === p);
    if (sortMode === 'priority') tasks = sortOpenTasks(tasks);
    if (sortMode === 'due') tasks = [...tasks].sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999'));
    if (sortMode === 'short') tasks = [...tasks].sort((a,b)=>a.minutes-b.minutes);
    list.innerHTML = '';
    list.appendChild(taskTable(tasks, { showBacklogActions: true }));
  };
  card.querySelectorAll('select').forEach(s => s.onchange = draw);
  draw();
}

function renderPlanner(app) {
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = '<h2>Planner (today + next 7 days)</h2>';
  const days = document.createElement('div');
  days.className = 'day-list';
  const start = todayISO();
  for (let i=0;i<=7;i++) {
    const day = addDays(start, i);
    const plan = getPlan(day);
    const openTasks = sortOpenTasks(state.tasks.filter(t=>t.status==='open'));
    const div = document.createElement('div');
    div.className = 'day-card';
    const avail = capacityForDay(day);
    const planM = plannedForDay(day);
    const adj = adjustedPlannedForDay(day);
    div.innerHTML = `<h3>${day}</h3><div class="row wrap"><label>Meetings <input type="number" min="0" max="16" value="${plan.meetings.filter(Boolean).length}" id="m"></label><label>Email <input type="number" min="0" value="${plan.workblocks.email||0}" id="e"></label><label>Teams <input type="number" min="0" value="${plan.workblocks.teams||0}" id="t"></label><label>Buffer % <input type="number" min="0" max="100" step="5" value="${plan.bufferPercent||0}" id="b"></label></div><div class="small">Capacity: ${avail}m | Planned: ${planM}m | Adjusted: ${adj}m</div>`;
    div.querySelector('#m').onchange = (e) => {
      const num = Math.max(0, Math.min(16, Number(e.target.value||0)));
      plan.meetings = Array.from({length:16},(_,idx)=>idx < num);
      saveState(); render();
    };
    div.querySelector('#e').onchange = (e) => { plan.workblocks.email = Number(e.target.value||0); saveState(); render(); };
    div.querySelector('#t').onchange = (e) => { plan.workblocks.teams = Number(e.target.value||0); saveState(); render(); };
    div.querySelector('#b').onchange = (e) => { plan.bufferPercent = Number(e.target.value||0); saveState(); render(); };
    div.appendChild(taskTable(openTasks.filter(t => !t.dayAssigned || t.dayAssigned === day), { showPlannerActions: true, day }));
    days.appendChild(div);
  }
  card.appendChild(days);
  app.appendChild(card);
}

function rolling7() {
  const out = [];
  const t = todayISO();
  for (let i=0;i<7;i++) {
    const d = addDays(t, -i);
    out.push(state.dailyStats[d] || makeDailySnapshot(d));
  }
  return out;
}

function renderStats(app) {
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = `<h2>Stats</h2><label>Day <input type="date" id="day" value="${todayISO()}" /></label><button id="load">Load Day Snapshot</button><div id="dayStats" class="small"></div><h3>7-day rolling</h3><div id="roll" class="small"></div>`;
  app.appendChild(card);
  const drawDay = () => {
    const day = card.querySelector('#day').value;
    const snap = state.dailyStats[day] || makeDailySnapshot(day);
    card.querySelector('#dayStats').innerHTML = `Planned vs completed minutes: ${snap.plannedMinutes}/${snap.completedMinutes}<br/>Planned vs done tasks: ${snap.plannedTasks}/${snap.doneTasks}<br/>Bumped: ${snap.bumpedTasks}<br/>Extension rate: ${(snap.extensionRate*100).toFixed(1)}%<br/>Avg estimation error: ${snap.avgEstimationError}m`;
  };
  card.querySelector('#load').onclick = drawDay;
  drawDay();
  const rows = rolling7().map(s => `${s.day}: planned ${s.plannedMinutes}m, completed ${s.completedMinutes}m, done ${s.doneTasks}/${s.plannedTasks}, bumped ${s.bumpedTasks}`).join('<br/>');
  card.querySelector('#roll').innerHTML = rows;
}

function startFocus(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  focusSession = {
    sessionId: uid('focus'),
    taskId,
    plannedMinutes: task.minutes,
    actualMinutes: 0,
    startAt: nowIso(),
    endAt: null,
    outcome: null,
    extensionCount: 0,
    reason: null,
    timerSeconds: task.minutes * 60,
    interval: null
  };
  openFocus(task);
}

function openFocus(task) {
  const modal = document.getElementById('focusModal');
  const c = document.getElementById('focusContent');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  c.innerHTML = `<div><h2>${escapeHtml(task.title)}</h2><div class="timer" id="timer">${fmtTime(focusSession.timerSeconds)}</div><div class="row wrap" style="justify-content:center"><button class="primary" id="done">Done</button><button id="ext5">Extend +5</button><button id="ext10">Extend +10</button><button id="ext15">Extend +15</button><button class="warn" id="abandon">Abandon</button></div><div class="row wrap" style="justify-content:center;margin-top:0.6rem"><label>Reason <select id="reason"><option value="">Select reason</option><option>scope grew</option><option>interruption</option><option>underestimated</option><option>dependency</option><option>blocked</option><option>reprioritised</option><option>needs breakdown</option></select></label></div></div>`;
  focusSession.interval = setInterval(() => {
    focusSession.timerSeconds -= 1;
    if (focusSession.timerSeconds < 0) focusSession.timerSeconds = 0;
    c.querySelector('#timer').textContent = fmtTime(focusSession.timerSeconds);
  }, 1000);

  c.querySelector('#done').onclick = () => finishFocus('done');
  c.querySelector('#abandon').onclick = () => finishFocus('abandon', true);
  c.querySelector('#ext5').onclick = () => extendFocus(5);
  c.querySelector('#ext10').onclick = () => extendFocus(10);
  c.querySelector('#ext15').onclick = () => extendFocus(15);
}

function extendFocus(extra) {
  const reason = document.getElementById('reason').value;
  if (!reason) return alert('Select an extension reason.');
  focusSession.timerSeconds += extra * 60;
  focusSession.extensionCount += 1;
  focusSession.reason = reason;
}

function finishFocus(outcome, needsReason = false) {
  const reason = document.getElementById('reason').value;
  if (needsReason && !reason) return alert('Select an abandon reason.');
  clearInterval(focusSession.interval);
  focusSession.endAt = nowIso();
  focusSession.outcome = outcome;
  const actual = Math.max(1, Math.round((new Date(focusSession.endAt) - new Date(focusSession.startAt)) / 60000));
  focusSession.actualMinutes = actual;
  if (reason) focusSession.reason = reason;

  const task = state.tasks.find(t => t.id === focusSession.taskId);
  if (task && outcome === 'done') {
    task.status = 'done';
    task.updatedAt = nowIso();
  }
  state.focusSessions.push({ ...focusSession });
  focusSession = null;
  document.getElementById('focusModal').classList.add('hidden');
  document.getElementById('focusModal').setAttribute('aria-hidden', 'true');
  saveState();
  render();
}

function mkBtn(text, onclick, klass='') {
  const b = document.createElement('button');
  b.textContent = text;
  if (klass) b.classList.add(klass);
  b.onclick = onclick;
  return b;
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2,'0');
  const s = (sec % 60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

function escapeHtml(str='') {
  return str
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}
