const STORAGE_KEY = "planner-app-state";
const WORKDAY_START_MIN = 9 * 60;
const WORKDAY_END_MIN = 17 * 60;
const SLOT_COUNT = 16;
const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

const defaultState = () => ({
  tasks: [],
  meetings: Array(SLOT_COUNT).fill(false),
  workblocks: { email: 0, teams: 0 },
  focusSecondsLeft: 1500,
  focusRunning: false,
  focusLastTick: null,
  previewSort: "priority"
});

let state = loadState();
let focusTimer = null;
let liveTimer = null;
let tackleTimer = null;
let tackleSecondsLeft = 0;
let tackleRunning = false;
let tackleTaskId = null;

boot();


function boot() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("p")) {
      history.replaceState(null, "", "./");
    }
    init();
  } catch (error) {
    console.error("Planner failed to initialize", error);
    const el = document.getElementById("bootError");
    if (el) {
      el.hidden = false;
      el.textContent = "The app hit a startup error. Open DevTools for details; your local data is still preserved.";
    }
  }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseTaskLine(line) {
  const match = line.trim().match(/^(.*)\s+(\d+)$/);
  if (!match || !match[1].trim()) return null;
  return { title: match[1].trim(), minutes: Number(match[2]) };
}

function splitTask(baseTask) {
  if (baseTask.minutes <= 30) return [baseTask];
  const groupId = baseTask.groupId || uid();
  const parts = [];
  let remaining = baseTask.minutes;
  while (remaining > 0) {
    parts.push(Math.min(30, remaining));
    remaining -= 30;
  }
  return parts.map((minutes, i) => ({
    ...baseTask,
    id: uid(),
    minutes,
    groupId,
    partIndex: i + 1,
    partTotal: parts.length
  }));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return migrateState(parsed);
  } catch {
    return defaultState();
  }
}

function migrateState(raw) {
  const base = { ...defaultState(), ...raw };
  base.meetings = Array.isArray(base.meetings) ? base.meetings.slice(0, SLOT_COUNT) : Array(SLOT_COUNT).fill(false);
  while (base.meetings.length < SLOT_COUNT) base.meetings.push(false);
  base.workblocks = { email: Number(base.workblocks?.email || 0), teams: Number(base.workblocks?.teams || 0) };
  base.previewSort = base.previewSort || "priority";
  base.tasks = (base.tasks || []).map((task) => ({
    ...task,
    id: task.id || uid(),
    title: task.title || "Untitled",
    minutes: Number(task.minutes || 30),
    dueDate: task.dueDate || todayISO(),
    priority: task.priority || "medium",
    status: task.status || "open",
    dayAssigned: task.dayAssigned || null,
    groupId: task.groupId || null,
    partIndex: task.partIndex || null,
    partTotal: task.partTotal || null
  }));
  return base;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function init() {
  document.getElementById("taskDueDate").value = todayISO();
  document.getElementById("addTaskBtn").addEventListener("click", onAddTask);
  document.getElementById("taskInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onAddTask();
    }
  });
  document.getElementById("previewSort").addEventListener("change", (e) => {
    state.previewSort = e.target.value;
    persistAndRender();
  });
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => activateView(tab.dataset.view)));
  document.getElementById("exportBtn").addEventListener("click", exportJSON);
  document.getElementById("importInput").addEventListener("change", importJSON);

  document.getElementById("emailBlocks").addEventListener("change", (e) => { state.workblocks.email = clampNum(e.target.value, 0, 16); persistAndRender(); });
  document.getElementById("teamsBlocks").addEventListener("change", (e) => { state.workblocks.teams = clampNum(e.target.value, 0, 16); persistAndRender(); });

  buildMeetingSlots();

  document.getElementById("focusStart").addEventListener("click", startFocus);
  document.getElementById("focusStop").addEventListener("click", stopFocus);
  document.getElementById("focusReset").addEventListener("click", resetFocus);

  document.getElementById("editCancel").addEventListener("click", () => document.getElementById("editDialog").close());
  document.getElementById("editForm").addEventListener("submit", onSaveEdit);

  document.getElementById("tacklePause").addEventListener("click", pauseTackle);
  document.getElementById("tackleResume").addEventListener("click", resumeTackle);
  document.getElementById("tackleClose").addEventListener("click", closeTackle);

  render();
  liveTimer = setInterval(() => renderLiveTime(), 30000);
}

function activateView(view) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `${view}View`));
}

function onAddTask() {
  const parsed = parseTaskLine(document.getElementById("taskInput").value);
  if (!parsed) return alert("Use format: title ending with minutes");
  const dueDate = document.getElementById("taskDueDate").value || todayISO();
  const priority = document.getElementById("taskPriority").value || "medium";
  const baseTask = {
    id: uid(),
    title: parsed.title,
    minutes: parsed.minutes,
    dueDate,
    priority,
    status: "open",
    dayAssigned: todayISO(),
    createdAt: new Date().toISOString(),
    groupId: null,
    partIndex: null,
    partTotal: null
  };
  const tasks = splitTask(baseTask).map((t) => ({ ...t, dayAssigned: priority === "urgent" ? todayISO() : t.dayAssigned }));
  state.tasks.push(...tasks);
  document.getElementById("taskInput").value = "";
  document.getElementById("taskInput").focus();
  persistAndRender();
}

function getOpenTasks() { return state.tasks.filter((t) => t.status !== "done"); }
function getTodayTasks() { return getOpenTasks().filter((t) => t.dayAssigned === todayISO()); }
function isOverdue(task) { return task.dueDate < todayISO(); }

function sortByPriority(a, b) {
  if (a.priority === "urgent" && b.priority !== "urgent") return -1;
  if (b.priority === "urgent" && a.priority !== "urgent") return 1;
  if (isOverdue(a) !== isOverdue(b)) return isOverdue(a) ? -1 : 1;
  const diff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (diff !== 0) return diff;
  return a.dueDate.localeCompare(b.dueDate);
}

function sortBacklogPreview(tasks) {
  const sorter = state.previewSort;
  const clone = [...tasks];
  if (sorter === "duration") {
    clone.sort((a, b) => (a.minutes - b.minutes) || a.dueDate.localeCompare(b.dueDate));
  } else if (sorter === "due") {
    clone.sort((a, b) => (isOverdue(a) === isOverdue(b) ? a.dueDate.localeCompare(b.dueDate) : isOverdue(a) ? -1 : 1));
  } else {
    clone.sort(sortByPriority);
  }
  return clone;
}

function render() {
  document.getElementById("previewSort").value = state.previewSort;
  renderToday();
  renderBacklog();
  renderPlanner();
  renderStats();
  renderFocus();
}

function renderToday() {
  const todayList = document.getElementById("todayList");
  const tasks = getTodayTasks().sort(sortByPriority);
  todayList.innerHTML = "";
  if (!tasks.length) todayList.innerHTML = "<div class='task-item'>No tasks for today.</div>";
  tasks.forEach((task) => todayList.appendChild(taskNode(task, { inToday: true })));

  const preview = document.getElementById("backlogPreview");
  preview.innerHTML = "";
  const backlog = getOpenTasks().filter((t) => t.dayAssigned !== todayISO());
  sortBacklogPreview(backlog).slice(0, 8).forEach((task) => preview.appendChild(taskNode(task, { preview: true })));
  if (!backlog.length) preview.innerHTML = "<div class='task-item'>No backlog items.</div>";

  renderLiveTime();
}

function renderBacklog() {
  const backlogList = document.getElementById("backlogList");
  backlogList.innerHTML = "";
  const tasks = getOpenTasks().sort(sortByPriority);
  if (!tasks.length) backlogList.innerHTML = "<div class='task-item'>Backlog empty.</div>";
  tasks.forEach((task) => backlogList.appendChild(taskNode(task)));
}

function taskNode(task, options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "task-item";
  const isUrgentOverbook = task.priority === "urgent" && task.dayAssigned === todayISO() && remainingAfterWork() < 0;
  wrapper.innerHTML = `
    <div>
      <strong>${escapeHtml(task.title)}</strong>
      <div class="task-meta">
        <span>${task.minutes}m</span>
        <span>Due ${task.dueDate}</span>
        <span class="priority-pill priority-${task.priority}">${task.priority}</span>
        ${task.groupId ? `<span>Part ${task.partIndex}/${task.partTotal}</span>` : ""}
      </div>
      ${isUrgentOverbook ? `<div class="warning">Urgent task added despite overbooking.</div>` : ""}
    </div>
    <div class="task-actions"></div>
  `;
  const actions = wrapper.querySelector(".task-actions");

  const tackleBtn = button("Tackle", () => openTackle(task.id));
  const doneBtn = button("Done", () => updateTask(task.id, (t) => ({ ...t, status: "done", dayAssigned: null })));
  const editBtn = button("Edit", () => openEdit(task.id), "secondary");
  const delBtn = button("Delete", () => deleteTask(task.id), "secondary");
  actions.append(tackleBtn, doneBtn, editBtn, delBtn);

  if (!options.inToday) actions.prepend(button("Add Today", () => updateTask(task.id, (t) => ({ ...t, dayAssigned: todayISO() })), "secondary"));
  if (options.inToday) actions.prepend(button("Remove", () => updateTask(task.id, (t) => ({ ...t, dayAssigned: null })), "secondary"));
  return wrapper;
}

function updateTask(id, updater) {
  state.tasks = state.tasks.map((t) => (t.id === id ? updater(t) : t));
  persistAndRender();
}

function openEdit(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  document.getElementById("editTaskId").value = task.id;
  document.getElementById("editTitle").value = task.title;
  document.getElementById("editMinutes").value = task.minutes;
  document.getElementById("editDueDate").value = task.dueDate;
  document.getElementById("editPriority").value = task.priority;
  document.getElementById("editDialog").showModal();
}

function onSaveEdit(e) {
  e.preventDefault();
  const id = document.getElementById("editTaskId").value;
  const title = document.getElementById("editTitle").value.trim();
  const minutes = clampNum(document.getElementById("editMinutes").value, 1, 1440);
  const dueDate = document.getElementById("editDueDate").value || todayISO();
  const priority = document.getElementById("editPriority").value;

  const target = state.tasks.find((t) => t.id === id);
  if (!target) return;

  if (target.groupId) {
    state.tasks = state.tasks.map((t) => t.groupId === target.groupId ? { ...t, title, dueDate, priority, dayAssigned: priority === "urgent" ? todayISO() : t.dayAssigned } : t);
  } else {
    state.tasks = state.tasks.map((t) => t.id === id ? { ...t, title, dueDate, priority, dayAssigned: priority === "urgent" ? todayISO() : t.dayAssigned } : t);
  }

  if (minutes !== target.minutes) {
    if (minutes <= 30) {
      state.tasks = state.tasks.map((t) => t.id === id ? { ...t, minutes } : t);
    } else {
      // We intentionally create a new group for this edited part to keep sibling parts in the original split group unchanged.
      const edited = state.tasks.find((t) => t.id === id);
      state.tasks = state.tasks.filter((t) => t.id !== id);
      const splits = splitTask({ ...edited, minutes, groupId: null, partIndex: null, partTotal: null, id: uid() });
      state.tasks.push(...splits);
    }
  }

  document.getElementById("editDialog").close();
  persistAndRender();
}

function deleteTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  if (task.groupId) {
    const choice = (prompt("Delete grouped task: type 'part' to delete only this part, or 'group' to delete entire group.", "part") || "").toLowerCase();
    if (choice !== "part" && choice !== "group") return;
    if (choice === "group") state.tasks = state.tasks.filter((t) => t.groupId !== task.groupId);
    if (choice === "part") state.tasks = state.tasks.filter((t) => t.id !== id);
  } else if (confirm("Delete this task?")) {
    state.tasks = state.tasks.filter((t) => t.id !== id);
  }
  persistAndRender();
}


function openTackle(taskId) {
  const task = state.tasks.find((t) => t.id === taskId && t.status !== "done");
  if (!task) return;
  tackleTaskId = task.id;
  tackleSecondsLeft = Math.max(60, task.minutes * 60);
  tackleRunning = true;
  document.getElementById("tackleTitle").textContent = `Tackling: ${task.title}`;
  document.getElementById("tackleDialog").showModal();
  renderTackleDisplay();
  clearInterval(tackleTimer);
  tackleTimer = setInterval(() => {
    if (!tackleRunning) return;
    tackleSecondsLeft = Math.max(0, tackleSecondsLeft - 1);
    renderTackleDisplay();
    if (tackleSecondsLeft === 0) {
      tackleRunning = false;
      clearInterval(tackleTimer);
      tackleTimer = null;
    }
  }, 1000);
}

function renderTackleDisplay() {
  const min = String(Math.floor(tackleSecondsLeft / 60)).padStart(2, "0");
  const sec = String(tackleSecondsLeft % 60).padStart(2, "0");
  document.getElementById("tackleDisplay").textContent = `${min}:${sec}`;
}

function pauseTackle() {
  tackleRunning = false;
}

function resumeTackle() {
  if (!tackleTaskId || tackleSecondsLeft <= 0) return;
  tackleRunning = true;
}

function closeTackle() {
  tackleRunning = false;
  clearInterval(tackleTimer);
  tackleTimer = null;
  tackleTaskId = null;
  const dialog = document.getElementById("tackleDialog");
  if (dialog.open) dialog.close();
}

function renderPlanner() {
  document.getElementById("emailBlocks").value = state.workblocks.email;
  document.getElementById("teamsBlocks").value = state.workblocks.teams;
  const meetingsMins = state.meetings.filter(Boolean).length * 30;
  const workblockMins = (state.workblocks.email + state.workblocks.teams) * 30;
  const available = Math.max(0, 480 - meetingsMins - workblockMins);
  document.getElementById("capacitySummary").textContent = `Capacity today: ${available} min (${meetingsMins} meeting, ${workblockMins} workblocks)`;
  paintMeetingSlots();
}

function buildMeetingSlots() {
  const container = document.getElementById("meetingSlots");
  container.innerHTML = "";
  for (let i = 0; i < SLOT_COUNT; i++) {
    const start = WORKDAY_START_MIN + i * 30;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-btn";
    btn.dataset.slotIndex = String(i);
    btn.textContent = `${formatMins(start)}-${formatMins(start + 30)}`;
    btn.addEventListener("click", () => {
      state.meetings[i] = !state.meetings[i];
      persistAndRender();
    });
    container.appendChild(btn);
  }
  paintMeetingSlots();
}

function paintMeetingSlots() {
  document.querySelectorAll("#meetingSlots .slot-btn").forEach((btn) => {
    const idx = Number(btn.dataset.slotIndex);
    btn.classList.toggle("active", Boolean(state.meetings[idx]));
    btn.setAttribute("aria-pressed", state.meetings[idx] ? "true" : "false");
  });
}

function renderStats() {
  const done = state.tasks.filter((t) => t.status === "done").length;
  const open = state.tasks.filter((t) => t.status !== "done").length;
  const urgentOpen = state.tasks.filter((t) => t.status !== "done" && t.priority === "urgent").length;
  document.getElementById("statsSummary").innerHTML = `<p>Open: ${open}</p><p>Completed: ${done}</p><p>Urgent open: ${urgentOpen}</p>`;
}

function renderLiveTime() {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const intervalStart = Math.max(nowMins, WORKDAY_START_MIN);
  const intervalEnd = WORKDAY_END_MIN;
  let remaining = Math.max(0, intervalEnd - intervalStart);
  let meetingsOverlap = 0;
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (!state.meetings[i]) continue;
    const slotStart = WORKDAY_START_MIN + i * 30;
    const slotEnd = slotStart + 30;
    const overlap = Math.max(0, Math.min(slotEnd, intervalEnd) - Math.max(slotStart, intervalStart));
    meetingsOverlap += overlap;
  }
  remaining = Math.max(0, remaining - meetingsOverlap);
  const workblockMins = (state.workblocks.email + state.workblocks.teams) * 30;
  const remainingAfterMeetingsWorkblocks = Math.max(0, remaining - workblockMins);
  const unfinishedToday = getTodayTasks().reduce((sum, t) => sum + t.minutes, 0);
  const remainingAfterTasks = Math.max(0, remainingAfterMeetingsWorkblocks - unfinishedToday);

  document.getElementById("liveTimeStats").innerHTML = `
    <div>Now: ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
    <div>Remaining after meetings/workblocks: ${Math.round(remainingAfterMeetingsWorkblocks)} min</div>
    <div>Remaining after unfinished Today tasks: ${Math.round(remainingAfterTasks)} min</div>
  `;
}

function remainingAfterWork() {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const intervalStart = Math.max(nowMins, WORKDAY_START_MIN);
  const intervalEnd = WORKDAY_END_MIN;
  let remaining = Math.max(0, intervalEnd - intervalStart);
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (!state.meetings[i]) continue;
    const slotStart = WORKDAY_START_MIN + i * 30;
    const slotEnd = slotStart + 30;
    remaining -= Math.max(0, Math.min(slotEnd, intervalEnd) - Math.max(slotStart, intervalStart));
  }
  remaining -= (state.workblocks.email + state.workblocks.teams) * 30;
  return remaining;
}

function startFocus() {
  if (state.focusRunning) return;
  state.focusRunning = true;
  state.focusLastTick = Date.now();
  focusTimer = setInterval(() => {
    if (!state.focusRunning) return;
    const now = Date.now();
    const elapsed = Math.floor((now - state.focusLastTick) / 1000);
    if (elapsed <= 0) return;
    state.focusLastTick = now;
    state.focusSecondsLeft = Math.max(0, state.focusSecondsLeft - elapsed);
    if (state.focusSecondsLeft === 0) stopFocus();
    saveState();
    renderFocus();
  }, 250);
  saveState();
}

function stopFocus() {
  state.focusRunning = false;
  clearInterval(focusTimer);
  focusTimer = null;
  saveState();
}

function resetFocus() {
  stopFocus();
  state.focusSecondsLeft = 1500;
  renderFocus();
  saveState();
}

function renderFocus() {
  const min = String(Math.floor(state.focusSecondsLeft / 60)).padStart(2, "0");
  const sec = String(state.focusSecondsLeft % 60).padStart(2, "0");
  document.getElementById("focusDisplay").textContent = `${min}:${sec}`;
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `planner-export-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      state = migrateState(parsed);
      persistAndRender();
    } catch {
      alert("Invalid JSON file");
    }
  };
  reader.readAsText(file);
}

function persistAndRender() {
  saveState();
  render();
}

function button(text, onClick, cls = "") {
  const btn = document.createElement("button");
  btn.textContent = text;
  btn.className = cls;
  btn.addEventListener("click", onClick);
  return btn;
}

function clampNum(v, min, max) {
  const n = Number(v);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function formatMins(total) {
  const h = String(Math.floor(total / 60)).padStart(2, "0");
  const m = String(total % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function escapeHtml(input) {
  const div = document.createElement("div");
  div.textContent = input;
  return div.innerHTML;
}
