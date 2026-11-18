# startpage

A personal startpage I built for myself after seeing what my friend [Stephen Okita](https://startpage.stephenokita.com) made. The idea is simple: control exactly what you see the moment you open a new tab. No noise, no algorithm, no feed you didn't ask for — just the things that actually matter to you.

I wanted something that would tell me at a glance how I'm spending my time, what I need to do, and gently push me to be more present rather than getting lost in tabs.

Live at [startpage.akn.me.uk](https://startpage.akn.me.uk).

---

## What it does

**Three snap-scroll sections:**

1. **Landing** — big clock and search bar. That's it. Clean.
2. **Dashboard** — weather, todos, a parallel time tracker, alarms, quick links.
3. **Feed** — project tracker (pulled from Notion), open GitHub PRs, calendar (CalDAV), a photo slideshow, and a thoughts feed.

### Module toggles
`modules` in [`lib/config.ts`](lib/config.ts) switches whole modules on and off without deleting them. The exam countdown, assignments tracker and camera/visitors modules are currently **off** — they were sixth-form-era features. Flipping a flag back to `true` restores the widget, its display-panel sections and its palette commands.

### Time tracking
You can run multiple timers in parallel — useful when context-switching between tasks. When you stop a timer, it keyword-matches the label against your Notion projects and automatically tags the session to the right project. The project tracker then sorts by *least time logged*, so whatever you've been neglecting floats to the top.

### Notion integration
Projects and tasks sync from Notion. Projects have categories (Tech, Music, Faith, Personal), colour codes, and keyword lists for the timer matching. You can add tasks inline from the startpage. Everything auto-refreshes every 30 minutes.

### Camera & face recognition *(currently disabled — see Module toggles)*
When you're authenticated, the site silently uses your webcam to detect motion and faces in the background. It captures on motion, runs face detection, computes a 128-dimension face descriptor, and matches against stored descriptors — so it learns who you are over time. Images go to private Supabase Storage. The feed shows recent visitors with who/when, deduped by person in the display.

### Alarms
Persistent alarms stored in the database (not localStorage). They go off with a sound regardless of which section you're on.

### Cmd+K palette
`⌘K` opens a command palette for search, `/todo`, `/alarm`, `/record`, `/dim` — the stuff you use most without reaching for the mouse.

### Auto-reload on deployment
Polls for new deployments every 30 minutes. If there's a new version and you haven't touched the page in 10 minutes, it reloads silently. So I never have to remember to refresh after pushing changes.

### TV mode (Xiaomi TV app)
The Android TV wrapper (`startpage-tv`, separate folder) loads the site with a `StartpageTV` user agent. A TV session is locked until the PIN is entered on an on-screen pad; it relocks after 15 minutes idle or when you leave the app. On the TV the page picks up a new deploy within ~20 s. For hot reload while developing, run `npm run dev -- -H 0.0.0.0` and `./tv-dev.sh` in the TV folder (`./tv-dev.sh prod` switches back). The app only loads the startpage origin or a private-LAN dev server, blocks screenshots, and keeps no form data or backups.

### Mind, reminders and the morning brief
The Mind panel holds what people want for you ("Lyra wants me to be more relaxed"), things on your mind, and reminders, next to your open tasks and upcoming reminders from Bonds (read-only). From ⌘K:
- `/remind journal tomorrow` adds a reminder due tomorrow at 09:00 (also `tonight`, `friday 6pm`, `in 2 hours`, `at 9am`, ISO dates; Europe/London time).
- `/mind <text>` adds a thought. Wishes are added in the panel with a person.
- `/brief` writes a morning summary from today's calendar, todos, reminders, wishes and Bonds, using Claude on Bedrock with the existing `AWS_*` credentials. Without them it shows a plain summary.

Mind, Bonds and the brief are **sensitive**: every device must enter the PIN, and the unlock lasts 3 minutes.

### PIN setup
```bash
node scripts/set-pin.mjs | vercel env add STARTPAGE_PIN_HASH production
```
The script asks for the PIN twice (hidden) and pipes only its PBKDF2 hash to Vercel. Five wrong entries lock the PIN for 15 minutes, doubling each time.

### Environment variables (new)
`STARTPAGE_PIN_HASH` (required for TV and sensitive data), `BONDS_API_URL` (vault API base, e.g. `https://prm.akn.me.uk/api/vaults/<id>`), `BONDS_API_TOKEN`, `BRIEF_MODEL` (optional Bedrock model id). Migrations `006_pin_attempts.sql` and `007_mind_and_lockdown.sql` must be applied.

---

## Security model

The site is publicly accessible — anyone can see public todos and photos. Logging in (via `/access` with a password) unlocks editing, private data, alarms, calendar, and the camera widget. Supabase anon key isn't exposed in the client bundle at all; all database access goes through server-side API routes using the service role key, and since migration 007 no table has an anon-key policy. A TV session needs the PIN before anything private shows; Mind, Bonds and the brief need a fresh PIN on every device.

---

## Tech

- **Next.js 14** (App Router, server components, route handlers)
- **Supabase** (Postgres + Storage) — sessions, alarms, visitors, todos, photos
- **Notion API** — projects and tasks
- **CalDAV** — private calendar
- **@vladmandic/face-api** — TinyFaceDetector + face landmarks + recognition net, all running in-browser
- **open-meteo** — weather (geolocation with IP fallback)
- **Vercel** — hosting

---

## Running locally

```bash
npm install
cp .env.example .env.local  # fill in your keys
npm run dev
```

Required env vars:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only) |
| `NOTION_TOKEN` | Notion integration token |
| `NOTION_DATABASE_ID_PROJECTS` | Notion Projects database ID |
| `NOTION_DATABASE_ID_TASKS` | Notion Tasks database ID |
| `CALDAV_URL` | CalDAV server URL |
| `CALDAV_USERNAME` | CalDAV username |
| `CALDAV_PASSWORD` | CalDAV password |
| `STARTPAGE_COOKIE_SECRET` | Password for the `/access` page |
| `GITHUB_TOKEN` | GitHub PAT for PR listing |
| `AKNCLIENT_API_KEY` | Service key for `/api/aknclient/*` (see below) |
| `STARTPAGE_OWNER_UID` | Owner uid; aknclient worklog rows and todos are scoped to it |

---

## aknClient service API

The macOS app aknClient syncs through `/api/aknclient/*`. Middleware lets the prefix through; each route authenticates with `Authorization: Bearer <AKNCLIENT_API_KEY>` (constant-time compare). Missing/invalid key: `401` JSON. `AKNCLIENT_API_KEY` unset: `503`. Worklog and todos also need `STARTPAGE_OWNER_UID` (else `503`).

| Route | Behaviour |
|---|---|
| `POST /api/aknclient/worklog` | Body `{blocks:[{id,label,project\|null,started_at,ended_at,duration_s}], range?:{from,to}}` (ISO-8601). Upserts into `time_sessions` keyed on `(source='aknclient', external_id=id)` as `is_public=false` owner rows, so they count in "This week" and project time. With `range`, deletes `source='aknclient'` rows with `started_at` in `[from,to)` whose id is not in the payload; rows from any other source are never touched. Returns `{upserted, deleted}`. Needs migration `005_time_sessions_external_id.sql`. |
| `GET /api/aknclient/todos` | `{todos:[{id,text,done,is_public}]}`, all of the owner's, private included. |
| `PATCH /api/aknclient/todos` | `{id, done}` returns the updated todo (`404` if not the owner's). |
| `GET /api/aknclient/tasks` | Same JSON as `GET /api/tasks`, private rows included. |
| `GET /api/aknclient/calendar?days=7` | Same JSON as `GET /api/integrations/calendar` (`days` 1-31, up to 100 events). |
| `POST /api/aknclient/notify` | `{title, body}` stored like `/api/notify` with `source:'aknclient'`. |

Tests: `npm test` (vitest, in-memory Supabase fake).

---

## Database schema (Supabase)

```sql
todos        (id, text, done, is_public, created_at)
time_sessions (id, label, duration_s, project, started_at, ended_at, is_public, source, external_id, created_at)
alarms       (id, time, label, enabled, created_at)
visitors     (id, captured_at, image_path, face_label)
photos       (id, url, caption, is_public, created_at)
```

Visitors' images are stored in a private `visitors` Storage bucket; the API generates 1-hour signed URLs.

---

Inspired by [Stephen Okita's startpage](https://startpage.stephenokita.com). Built for myself.
