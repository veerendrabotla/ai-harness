# Scheduled Tasks

Run agent goals on a recurring cadence — nightly builds, hourly health checks, weekly reports — without anyone clicking **Create task**. A schedule stores a goal, a project, and a cadence; the worker's sweep turns each due slot into a normal task that flows through the same plan → approval → execute → verify pipeline (including in-app and email notifications on completion).

**Surfaces:** `/schedules` in the web app · `POST/PATCH/DELETE /v1/schedules` in the API · fired tasks appear in **Tasks** like any other.

---

## Cadences (UTC)

| Cadence | Required fields | Example |
|---|---|---|
| `EVERY_MINUTES` | `intervalMinutes` (1–10080) | Every 5 minutes |
| `HOURLY` | `minuteOfHour` (0–59) | At :15 every hour |
| `DAILY` | `timeOfDay` (`HH:MM`) | 06:30 every day |
| `WEEKLY` | `timeOfDay` + `dayOfWeek` (0=Sun … 6=Sat) | Mondays 09:00 |

Rules:

- **All times are UTC** — identical behavior on every host, no timezone database needed. Timezone-local cadences are future work.
- Cadences are structured presets, not cron expressions: a row can only hold the fields belonging to its cadence (the API rejects ambiguous combinations).
- `nextRunAt` is always the first occurrence **strictly after** the moment it was computed.

---

## How firing works

1. The worker runs a sweep every **30 seconds** looking for `enabled = true AND next_run_at <= now` (at most 10 per cycle).
2. **Atomic claim:** `nextRunAt` is advanced with a conditional update (`WHERE id = ? AND enabled AND next_run_at = <observed>`). If another worker claimed it first, this cycle skips it — a schedule can never double-fire.
3. **Overlap guard:** if the schedule's previous task (`lastTaskId`) is still non-terminal (`QUEUED` … `VERIFYING`), this cycle skips firing. The advanced `nextRunAt` prevents catch-up bursts.
4. The sweep creates a task in `QUEUED` (state persisted first, mirroring `POST /v1/tasks`), emits `RUN_STARTED` with actor `SYSTEM` and note `scheduled task queued`, and enqueues the `start` job on the `task-lifecycle` queue.
5. Planning, approvals, execution, verification, events, usage accounting, and **notifications** are identical to manually created tasks. If the enqueue fails, the task stays `QUEUED` and the existing orphan sweeper re-enqueues it.
6. On success the schedule records `lastRunAt` and `lastTaskId`; the UI links **Last run** to the task.

Guard rails: schedules whose project is no longer `AVAILABLE` are skipped with a warning; malformed persisted cadence data is logged and skipped (the API prevents creating such rows).

---

## Creating schedules

### Web app

1. Open **Schedules** in the nav → **New schedule**.
2. Pick workspace and project, enter a name and goal, choose a cadence.
3. **Create schedule** — the row shows cadence, next run (UTC), and the last fired task.
4. **Pause** / **Resume** toggles firing without deleting history; **Resume** recomputes `nextRunAt` so an overdue schedule does not fire in a burst. **Delete** removes the schedule (already-created tasks are untouched).

### API

```http
POST /v1/schedules
Authorization: Bearer <token>
Content-Type: application/json

{
  "workspaceId": "…uuid…",
  "projectId": "…uuid…",
  "name": "Nightly build",
  "goal": "Run the full test suite and fix any failures",
  "constraints": "Do not push to main",
  "enabled": true,
  "cadence": "DAILY",
  "timeOfDay": "02:00"
}
```

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/v1/schedules?workspaceId=` | List schedules across your workspace memberships |
| `POST` | `/v1/schedules` | Create (zod-validated cadence, `nextRunAt` computed) |
| `PATCH` | `/v1/schedules/:id` | Update name/goal/constraints/enabled or full cadence config |
| `DELETE` | `/v1/schedules/:id` | Delete |

Cadence updates are **all-or-nothing**: when any cadence field is sent, include the complete config (including `cadence`). Responses use the standard `{ data, requestId }` envelope; `POST` returns `201`.

Access rules mirror tasks: creating requires workspace membership (MEMBER+), an `ACTIVE` (non-archived) workspace, and an `AVAILABLE` project; listing is scoped to workspaces you belong to.

---

## Notifications

Scheduled tasks inherit the standard completion pipeline: an in-app **Notification** row plus email (per your notification preferences), and optional webhooks. Nothing schedule-specific to configure.

---

## Audit trail

`SCHEDULE_CREATED`, `SCHEDULE_UPDATED`, and `SCHEDULE_DELETED` are written to the audit log (`entity_type = TASK_SCHEDULE`) with actor and workspace, alongside the per-run `RUN_STARTED` events emitted for every fired task.

---

## Limitations & future work

- **No timezones yet** — all cadences are UTC. Local-time cadences need an IANA timezone column + DST policy.
- **No cron expressions** — structured presets only; a cron cadence would add a parser + validation surface.
- **No catch-up** — missed slots (worker down) advance to the next occurrence rather than replaying. The oldest pending slot fires at most once when the worker returns.
- **No run-now trigger** — wait for the next slot (minimum cadence: every 1 minute, first fire within ~30–90 s of creation).
- **Single fire per cycle** — overlap guard means a schedule never runs two tasks concurrently; the skipped slot is not replayed.

---

**See also:** [Core Concepts](../concepts.md) · [Hooks & Events](hooks-and-events.md) · [Permissions & Approvals](permissions-and-approvals.md) · [Self-Hosting](self-hosting.md)
