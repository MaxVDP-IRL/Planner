# Offline Planner (GitHub Pages Ready)

A single-user, offline-first productivity app for capacity planning, task decomposition, focus sessions, and lightweight stats.

## Features

- **Task capture by single-line input**: `Title 25` parses to title + minutes.
- **Forced decomposition over 30 min** with `(1/N)` suffixes and shared `groupId`.
- **Today view** with:
  - 09:00-17:00 meeting grid (16 × 30-minute segments)
  - Workblock editor (Email/Teams 30-minute units)
  - Per-day **Buffer %** for capacity calculations only
  - Today list actions: Tackle, Done, Remove from Today
  - Backlog preview filters (fits remaining, <=5/10/15/30)
  - Soft overbook warning (no hard block)
  - **Close Day** workflow with optional move-to-next-day for bumped tasks
- **Backlog view** with filters and sorting.
- **Planner view** for today + next 7 days (capacity controls + assignment by day).
- **Focus mode** (modal): Done, Extend (+5/+10/+15 with required reason), Abandon (required reason).
- **Stats view**: day snapshot + rolling 7-day summary.
- **Local export/import** of all data as JSON.

## Data Model

Tasks include:
- `id`, `title`, `minutes`, `dueDate`, `priority`, `status`, `createdAt`, `updatedAt`, `dayAssigned`
- Optional: `groupId`, `partIndex`, `partTotal`, `bumpedCount`

Other persisted objects:
- `dayPlans[date]`: meetings array, workblocks, `bufferPercent`
- `focusSessions[]`: `taskId`, `plannedMinutes`, `actualMinutes`, timestamps, outcome, extension count, reason
- `dailyStats[date]`: end-of-day snapshot

## Local development

This is a static site. Open directly in browser or serve locally:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## GitHub Pages deployment

- Commit files to your repo (root or `/docs` setup).
- In GitHub repo settings: **Pages** → source branch (`main`/`gh-pages`) and folder.
- Paths are relative, so no backend or build step is required.

## Privacy

All data is stored **locally** in your browser `localStorage`.
No authentication, no cloud sync, and no external services are used.

## Export/Import

- **Export JSON** creates a full-state JSON file.
- **Import JSON** replaces in-browser state with the uploaded file.
- Use export as backup before importing.
