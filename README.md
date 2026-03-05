# startpage

A personal startpage I built for myself after seeing what my friend [Stephen Okita](https://startpage.stephenokita.com) made. The idea is simple: control exactly what you see the moment you open a new tab. No noise, no algorithm, no feed you didn't ask for — just the things that actually matter to you.

I wanted something that would tell me at a glance how I'm spending my time, what I need to do, and gently push me to be more present rather than getting lost in tabs.

Live at [startpage.akn.me.uk](https://startpage.akn.me.uk).

---

## What it does

**Three snap-scroll sections:**

1. **Landing** — big clock and search bar. That's it. Clean.
2. **Dashboard** — weather, todos, a parallel time tracker, alarms, quick links.
3. **Feed** — project tracker (pulled from Notion), open GitHub PRs, calendar (CalDAV), a photo slideshow, and recent visitors from the door camera.

### Time tracking
You can run multiple timers in parallel — useful when context-switching between tasks. When you stop a timer, it keyword-matches the label against your Notion projects and automatically tags the session to the right project. The project tracker then sorts by *least time logged*, so whatever you've been neglecting floats to the top.

### Notion integration
Projects and tasks sync from Notion. Projects have categories (Tech, Music, Faith, Personal), colour codes, and keyword lists for the timer matching. You can add tasks inline from the startpage. Everything auto-refreshes every 30 minutes.

### Camera & face recognition
When you're authenticated, the site silently uses your webcam to detect motion and faces in the background. It captures on motion, runs face detection, computes a 128-dimension face descriptor, and matches against stored descriptors — so it learns who you are over time. Images go to private Supabase Storage. The feed shows recent visitors with who/when, deduped by person in the display.

### Alarms
Persistent alarms stored in the database (not localStorage). They go off with a sound regardless of which section you're on.

### Cmd+K palette
`⌘K` opens a command palette for search, `/todo`, `/alarm`, `/record`, `/dim` — the stuff you use most without reaching for the mouse.

### Auto-reload on deployment
Polls for new deployments every 30 minutes. If there's a new version and you haven't touched the page in 10 minutes, it reloads silently. So I never have to remember to refresh after pushing changes.

---

## Security model

The site is publicly accessible — anyone can see public todos and photos. Logging in (via `/access` with a password) unlocks editing, private data, alarms, calendar, and the camera widget. Supabase anon key isn't exposed in the client bundle at all; all database access goes through server-side API routes using the service role key.

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

---

## Database schema (Supabase)

```sql
todos        (id, text, done, is_public, created_at)
time_sessions (id, label, duration_s, project, started_at, ended_at, is_public, created_at)
alarms       (id, time, label, enabled, created_at)
visitors     (id, captured_at, image_path, face_label)
photos       (id, url, caption, is_public, created_at)
```

Visitors' images are stored in a private `visitors` Storage bucket; the API generates 1-hour signed URLs.

---

Inspired by [Stephen Okita's startpage](https://startpage.stephenokita.com). Built for myself.
