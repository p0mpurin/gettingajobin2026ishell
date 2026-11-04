# Bolzano Jobs

A desktop job-search cockpit for South Tyrol. It gathers IT jobs from local sources and scores each one against your skills. It also tracks your applications through a pipeline and writes AI prompts for honest application emails.

Built with Tauri v2, Rust and React, with an OLED-black, chrome-accented UI.

## Features

- **One feed:** jobs from Karriere Südtirol and NOI Techpark, merged and deduplicated. New ones are marked; delisted jobs you track stay visible.
- **Fit check:**
  - Every posting is scanned for ~40 technologies and scored against your skills, with generic terms like "database" weighted lower.
  - Matched and missing skills are listed.
  - Language requirements are flagged against your level, read from your profile.
  - Seniority signals are pointed out.
- **Detail pane:**
  - The full posting, cleanly formatted and cached offline.
  - If a posting can't be fetched, you can paste its text.
- **AI Email:** builds a prompt from your profile, the posting and the fit check, with rules that forbid invented facts.
  - Kinds: application email, cover letter, LinkedIn message, follow-up.
  - Choose language and tone.
  - Copy, or copy and open ChatGPT, Claude or Gemini in one click.
- **Pipeline:** a kanban board with Saved → Applied → Interview → Offer / Rejected. Drag-and-drop works, and applied dates are recorded.
- **Application tab per job:**
  - The interview date and time, with "Add to calendar" (.ics, with reminders 1 day and 1 hour before).
  - Your contact person.
  - Which CV you sent (EN/IT/DE).
  - The message you sent.
  - Notes.
  - Everything autosaves.
- **Interview reminders:** upcoming interviews are listed at the top of Pipeline, with a banner on the job and a desktop notification the day before.
- **Follow-up reminders:** an application still at Applied after N days (default 7) gets an amber "Follow up" chip, a banner, a Pipeline list and a sidebar badge. From there, "Write follow-up" opens the AI tab, and "I followed up" or "Snooze" clear it.
- **No German required filter:** keeps only postings that don't require German. It reads postings in the background as needed. Rows show "German required", "German posting" or "German a plus".
- **Duplicate merging:** bilingual copies ("(m/w/d)" and "(m/f/d)"), re-posts, and the same job on several sites become one row with "N listings". Can be turned off in Settings.
- **Hide rules:** hide every job from a company ("Hide company" on a job, with Undo), or every title containing a word like "Senior" or "Lead" (Settings, with one-click suggestions). Jobs you track are never hidden, and the list header shows how many jobs are hidden.
- **Saved views:** save the current filter, source, German filter, sort and search as a named chip above the list. Each chip shows its job count; click it to apply.
- **Weekly goal:** set applications per week (default 5). The sidebar shows this week's progress, and Insights shows a progress ring, a streak and the last 8 weeks.
- **Response stats:** reply rate, average days to a reply, and interviews, in Insights.
- **Watch companies:** star a company from any of its jobs. Watched companies get a ★ filter, a sidebar section, and their own notification when they post.
- **Backup & restore:** an automatic daily backup (last 7 kept), plus "Back up now" and "Restore from backup" in Settings. Every restore saves the current data first. A damaged state file is kept aside instead of being overwritten.
- **Insights:**
  - Market stats.
  - Your funnel.
  - Top hiring companies and locations.
  - The skills postings ask for most that you don't have yet.
- **Auto-refresh:** off, 30 min, 1 h or 3 h, with desktop notifications for new jobs.
- **Export:** your pipeline to Obsidian (`Applications.md`) or CSV.
- **Instant start:** the last job list appears immediately while a fresh fetch runs in the background, three search terms at a time (about 3–6 s).
- **Stable list:** "Best match" only re-sorts when you change sort, filter or search, after a refresh, or once background scoring finishes. It never reshuffles while you're reading.
- **Desktop behaviour:**
  - The window reopens at its last size and position.
  - Opening the app a second time focuses the running window.
  - Your last view, filter, sort and source are remembered.
- **Keyboard-first:** `J`/`K` move, `S` save, `A` applied, `I` interview, `H` hide, `P` AI tab, `N` notes, `/` search, `R` refresh, `Ctrl+1–4` views, `?` for the cheat sheet.

## Sources

| Source | How |
|---|---|
| karriere-suedtirol.com | The public JSON API the site itself uses (`/api/jobAd/search`, `/api/jobAd/{id}`). robots.txt allows it. |
| suedtirolerjobs.it | The public JSON API its job search uses (`api.suedtirolerjobs.it/jobs?query=…&regions[]=…`). Full posting text comes from the JobPosting data on each public job page. robots.txt allows /jobs/. |
| NOI Techpark | Its server-rendered job board. |
| Indeed, LinkedIn, Province | Sidebar links only. Their terms or robots.txt forbid automated access. |

Requests run one at a time with pauses. Background posting downloads are capped at 60 per refresh.

## Run

```bash
npm install
npm run tauri dev       # the app
npm run tauri build     # an installer in src-tauri/target/release/bundle
```

### Portable version

```bash
npm run portable        # src-tauri/target/release/bundle/portable/Bolzano Jobs <version> portable x64.zip
```

The zip holds `Bolzano Jobs.exe` and `PORTABLE.txt`. While that file is next to the exe, everything (jobs, notes, settings, window position, WebView storage) is kept in a `Bolzano Jobs Data` folder beside it, and nothing is written to `%APPDATA%` or `%LOCALAPPDATA%`. Delete `PORTABLE.txt` to switch to the normal location. Needs the WebView2 runtime, which Windows 10 and 11 include.

`npm run dev` on its own opens the UI in a browser with sample data (`src/dev/`), which is handy for design work.

## Data

Everything is stored locally in `%APPDATA%\com.p0mpurin.bolzanojobs\state.json`: settings, tracked jobs and notes, and cached postings. It's written atomically.

## Tests

```bash
npm test                         # app logic: merging, German detection, follow-ups, calendar
```


```bash
cd src-tauri
cargo test                       # parsers and export, offline
cargo test -- --include-ignored  # also hits the live sources
```
