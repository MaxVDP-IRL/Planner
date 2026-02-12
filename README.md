# Planner

A single-user, offline-first productivity planner for GitHub Pages.

## Features

- **Capture tasks in one line** by typing text ending with minutes (example: `Write project update 45`).
- **Automatic split for tasks >30 minutes** into 30-minute parts.
- **Priority levels**: `low`, `medium`, `high`, `urgent` (default for new tasks is `medium`).
  - Sort priority order: urgent > high > medium > low.
  - Urgent tasks are always sorted to the top and are automatically added to Today.
- **Task defaults on creation**:
  - Default due date is today.
  - New tasks are auto-added to Today (`dayAssigned = today`).
- **Edit task support** (Today, Backlog, and Backlog preview):
  - Editable fields: title, minutes, due date, priority.
  - For split groups (`groupId`): editing title/due/priority on one part updates the full group.
  - Editing minutes affects only the selected part.
  - If edited minutes exceed 30, that part is split again into new parts.
- **Delete task support**:
  - Available in Today, Backlog, and Backlog preview.
  - For split tasks, delete prompt supports deleting one part or entire group.
- **Planner** for 09:00–17:00 with 30-minute meeting slots and Email/Teams workblocks.
- **Today live time display**:
  - Shows local current time.
  - Remaining working minutes after meetings/workblocks.
  - Remaining working minutes after unfinished Today tasks.
  - Updates every 30 seconds.
- **Focus timer** and basic **stats**.
- **Local data persistence** using `localStorage`.
- **Export/Import JSON** for backup/restore.

## Data and migration

- Uses a stable storage key: `planner-app-state`.
- On load/import, migration fills missing fields safely (e.g. default `priority = medium`, due date today) without wiping existing data.

## Run locally

Open `index.html` directly, or serve with a static server:

```bash
python3 -m http.server 8000
```

Then go to `http://localhost:8000`.
