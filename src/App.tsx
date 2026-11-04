import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MousePointerClick, TriangleAlert, X } from "lucide-react";
import type { Job, Settings, Status, Track, View, Commute } from "./types";
import { api, canLoadDescription } from "./lib/api";
import { analyze, germanNeed, germanOk, type Analysis, type GermanNeed } from "./lib/match";
import { ago } from "./lib/format";
import { usePersisted } from "./lib/persist";
import { companyKey, mergeDuplicates } from "./lib/dedupe";
import { isFollowUpDue, snoozeUntil } from "./lib/followup";
import { formatWhen } from "./lib/ics";
import { hiddenBy } from "./lib/rules";
import { weeklyStats } from "./lib/weekly";
import type { SavedView } from "./types";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { JobList, type Filter, type Sort, type SourceFilter } from "./components/JobList";
import { JobDetail, type DetailTab } from "./components/JobDetail";
import { PipelineView } from "./components/PipelineView";
import { InsightsView } from "./components/InsightsView";
import { SettingsView } from "./components/SettingsView";
import { Kbd, Modal, ToastProvider, useToast } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

const TRACKED = new Set(["applied", "interview", "offer", "rejected"]);

function Shell() {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tracks, setTracksState] = useState<Record<string, Track>>({});
  const setTracks: typeof setTracksState = (v) =>
    setTracksState((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      tracksRef.current = next;
      return next;
    });
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [view, setView] = usePersisted<View>("view", "jobs", ["jobs", "pipeline", "insights", "settings"]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("bolzano-jobs.selected");
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (selectedId) localStorage.setItem("bolzano-jobs.selected", selectedId);
    } catch {
      /* not remembered */
    }
  }, [selectedId]);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [filter, setFilter] = usePersisted<Filter>("filter", "all", ["all", "new", "junior", "saved", "tracked", "watched"]);
  const [sort, setSort] = usePersisted<Sort>("sort", "match", ["match", "newest", "company"]);
  const [source, setSource] = usePersisted<SourceFilter>("source", "all", ["all", "karriere-suedtirol", "noi-techpark", "suedtirolerjobs", "onboard"]);
  const [german, setGerman] = usePersisted<"any" | "ok">("german", "any", ["any", "ok"]);
  const [maxCommute, setMaxCommute] = usePersisted<string>("commute", "any", ["any", "30", "45", "60", "90"]);
  const [commutes, setCommutes] = useState<Record<string, Commute>>({});
  const [aiKind, setAiKind] = useState<string | null>(null);
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [shortcuts, setShortcuts] = useState(false);
  const [, tick] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const jobsRef = useRef<Job[]>([]);
  const resortRef = useRef<() => void>(() => {});
  // Latest tracks for async saves, so quick successive edits don't overwrite each other.
  const tracksRef = useRef<Record<string, Track>>({});

  /* ---------- data ---------- */

  const refresh = useCallback(
    async (auto = false) => {
      setLoading(true);
      try {
        const res = await api.fetchJobs();
        const before = new Set(jobsRef.current.map((j) => j.id));
        const fresh = before.size ? res.jobs.filter((j) => !before.has(j.id)) : [];
        jobsRef.current = res.jobs;
        setJobs(res.jobs);
        setErrors(res.errors);
        setFetchedAt(Date.now() / 1000);
        resortRef.current();
        if (fresh.length) {
          const fromWatched = fresh.filter((j) => watchedRef.current(j.company));
          toast(
            fromWatched.length
              ? `${fresh.length} new job${fresh.length === 1 ? "" : "s"}, ${fromWatched.length} from watched companies`
              : `${fresh.length} new job${fresh.length === 1 ? "" : "s"}`,
            "info",
          );
          if (auto) notify(fresh, fromWatched);
        } else if (!auto && before.size) {
          toast("Up to date");
        }
        if (res.errors.length) toast("Some sources failed to load", "warn");
      } catch (e) {
        setErrors([String(e)]);
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    api.getSettings().then(setSettings);
    api.getTracks().then(setTracks);
    api.getDescriptions().then((d) => {
      setDescriptions(d);
      setTimeout(() => resortRef.current(), 0);
    });
    // Show the last list instantly, then refresh in the background.
    api
      .getCachedJobs()
      .then((cached) => {
        if (cached.length && !jobsRef.current.length) {
          jobsRef.current = cached;
          setJobs(cached);
        }
      })
      .finally(() => refresh());
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Auto-refresh.
  useEffect(() => {
    const minutes = settings?.auto_refresh_minutes ?? 0;
    if (!minutes) return;
    const t = setInterval(() => refresh(true), minutes * 60_000);
    return () => clearInterval(t);
  }, [settings?.auto_refresh_minutes, refresh]);

  async function notify(fresh: Job[], fromWatched: Job[] = []) {
    if (!settings?.notify_new) return;
    let ok = await isPermissionGranted();
    if (!ok) ok = (await requestPermission()) === "granted";
    if (!ok) return;
    // Watched companies get their own, more specific notification.
    for (const j of fromWatched.slice(0, 3)) {
      sendNotification({ title: `${j.company} posted a new job`, body: `${j.title}${j.location ? ` · ${j.location}` : ""}` });
    }
    const junior = fresh.filter((j) => j.junior).length;
    sendNotification({
      title: `${fresh.length} new job${fresh.length === 1 ? "" : "s"} in South Tyrol`,
      body: `${fresh.slice(0, 3).map((j) => j.title).join(" · ")}${junior ? `\n${junior} junior-friendly` : ""}`,
    });
  }

  // Quietly load posting text, one at a time: normally for the jobs most worth
  // scoring; with the German filter on, for every job, since the filter can
  // only judge postings it has read. Text is cached, so each is fetched once.
  useEffect(() => {
    if (!jobs.length) return;
    const wanted = (j: Job) => german === "ok" || j.junior || j.is_new || tracks[j.id];
    const queue = jobs
      .filter((j) => canLoadDescription(j) && descriptions[j.id] === undefined && wanted(j))
      .slice(0, german === "ok" ? 800 : 60);
    if (!queue.length) {
      setChecking(null);
      return;
    }
    let stop = false;
    (async () => {
      for (let i = 0; i < queue.length; i++) {
        if (stop) return;
        const j = queue[i];
        if (german === "ok") setChecking({ done: i, total: queue.length });
        try {
          const text = await api.description(j.id, j.url);
          setDescriptions((d) => ({ ...d, [j.id]: text }));
        } catch {
          /* listing may have vanished; skip */
        }
        await new Promise((r) => setTimeout(r, german === "ok" ? 350 : 650));
      }
      if (!stop) {
        setChecking(null);
        resortRef.current();
      }
    })();
    return () => {
      stop = true;
    };
    // Only re-run when the job list or the filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, german]);

  /* ---------- derived ---------- */

  // Live jobs plus tracked jobs whose listing has disappeared.
  const allJobs = useMemo(() => {
    const live = new Set(jobs.map((j) => j.id));
    const delisted: Job[] = Object.entries(tracks)
      .filter(([id, t]) => !live.has(id) && t.title)
      .map(([id, t]) => ({
        id,
        source: id.startsWith("noi-") ? "noi-techpark" : id.startsWith("stj-") ? "suedtirolerjobs" : id.startsWith("ob-") ? "onboard" : "karriere-suedtirol",
        title: t.title,
        company: t.company,
        location: t.location,
        url: t.url,
        apply_url: t.apply_url,
        published: null,
        salary: null,
        tags: [],
        junior: false,
        is_new: false,
        first_seen: t.updated,
        delisted: true,
      }));
    const all = [...jobs, ...delisted];
    return settings?.merge_duplicates === false ? all : mergeDuplicates(all, tracks);
  }, [jobs, tracks, settings?.merge_duplicates]);

  // Every listing by id, including folded duplicates, so links to any of them resolve.
  const jobsById = useMemo(() => {
    const out: Record<string, Job> = {};
    for (const j of allJobs) {
      out[j.id] = j;
      for (const d of j.duplicates ?? []) out[d.id] ??= { ...d, duplicates: [j, ...(j.duplicates ?? []).filter((x) => x.id !== d.id)] };
    }
    return out;
  }, [allJobs]);

  const analyses = useMemo(() => {
    const out: Record<string, Analysis> = {};
    if (!settings) return out;
    for (const j of allJobs) {
      const d = descriptions[j.id];
      if (d !== undefined) out[j.id] = analyze(j.title, d, settings.skills);
    }
    return out;
  }, [allJobs, descriptions, settings]);

  const watchedKeys = useMemo(() => new Set((settings?.watched ?? []).map(companyKey)), [settings?.watched]);
  const isWatched = useCallback((company: string) => !!company && watchedKeys.has(companyKey(company)), [watchedKeys]);
  const watchedRef = useRef(isWatched);
  watchedRef.current = isWatched;

  const matchesFilter = useCallback(
    (j: Job, f: Filter) => {
      const st = tracks[j.id]?.status;
      if (f === "new") return j.is_new;
      if (f === "junior") return j.junior;
      if (f === "saved") return st === "saved";
      if (f === "tracked") return st !== undefined && TRACKED.has(st);
      if (f === "watched") return !j.delisted && isWatched(j.company);
      return !j.delisted;
    },
    [tracks, isWatched],
  );

  // Commute times for every job town (cached in the backend, looked up once per town).
  const homeTown = settings?.home_town ?? "";
  const locationKey = useMemo(() => [...new Set(jobs.map((j) => j.location).filter(Boolean))].sort().join("\n"), [jobs]);
  useEffect(() => {
    if (!homeTown.trim() || !locationKey) return;
    let live = true;
    api
      .commutes(locationKey.split("\n"))
      .then((c) => live && setCommutes(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [locationKey, homeTown]);

  const germanNeeds = useMemo(() => {
    const out: Record<string, GermanNeed> = {};
    for (const j of allJobs) out[j.id] = germanNeed(analyses[j.id]);
    return out;
  }, [allJobs, analyses]);

  // Jobs removed by hide rules; tracked jobs always stay visible.
  const ruleHidden = useMemo(() => {
    const out = new Set<string>();
    const words = settings?.hide_words ?? [];
    const companies = settings?.hide_companies ?? [];
    if (!words.length && !companies.length) return out;
    for (const j of allJobs) if (!tracks[j.id] && hiddenBy(j.title, j.company, words, companies)) out.add(j.id);
    return out;
  }, [allJobs, tracks, settings?.hide_words, settings?.hide_companies]);

  const base = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allJobs.filter(
      (j) =>
        (source === "all" || j.source === source) &&
        !ruleHidden.has(j.id) &&
        (german === "any" || germanOk(germanNeeds[j.id])) &&
        (maxCommute === "any" || !commutes[j.location] || commutes[j.location].minutes <= Number(maxCommute)) &&
        (!q || `${j.title} ${j.company} ${j.location} ${j.tags.join(" ")}`.toLowerCase().includes(q)),
    );
  }, [allJobs, query, source, german, germanNeeds, ruleHidden, maxCommute, commutes]);

  // Postings the German filter can't judge yet (not read, or unreadable).
  const uncheckedCount = useMemo(
    () => (german === "ok" ? allJobs.filter((j) => !j.delisted && germanNeeds[j.id] === "unknown").length : 0),
    [german, allJobs, germanNeeds],
  );

  const followUpDays = settings?.follow_up_days ?? 7;
  const dueIds = useMemo(
    () => Object.entries(tracks).filter(([, t]) => isFollowUpDue(t, followUpDays)).map(([id]) => id),
    // tick re-evaluates as time passes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks, followUpDays, fetchedAt],
  );

  // Interviews from two hours ago onwards, soonest first.
  const interviews = useMemo(() => {
    const from = Date.now() / 1000 - 2 * 3600;
    return Object.entries(tracks)
      .filter(([, t]) => t.interview_at && t.interview_at > from && t.status !== "rejected")
      .sort((a, b) => (a[1].interview_at ?? 0) - (b[1].interview_at ?? 0))
      .map(([id]) => id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, fetchedAt]);

  // A reminder the day before each interview (once per interview time).
  useEffect(() => {
    if (!settings?.notify_new) return;
    const now = Date.now() / 1000;
    for (const id of interviews) {
      const t = tracks[id];
      const at = t?.interview_at ?? 0;
      if (at - now > 26 * 3600 || at < now) continue;
      const key = `bolzano-jobs.interview-notified.${id}.${at}`;
      try {
        if (localStorage.getItem(key)) continue;
        localStorage.setItem(key, "1");
      } catch {
        continue;
      }
      (async () => {
        let ok = await isPermissionGranted();
        if (!ok) ok = (await requestPermission()) === "granted";
        if (!ok) return;
        sendNotification({
          title: `Interview ${formatWhen(at)}`,
          body: `${t.title} at ${t.company}. Open Bolzano Jobs to review the posting and what you sent.`,
        });
      })();
    }
  }, [interviews, tracks, settings?.notify_new]);

  // One desktop notification per day while follow-ups are due.
  useEffect(() => {
    if (!dueIds.length || !settings?.notify_new) return;
    const today = new Date().toDateString();
    try {
      if (localStorage.getItem("bolzano-jobs.followup-notified") === today) return;
      localStorage.setItem("bolzano-jobs.followup-notified", today);
    } catch {
      return;
    }
    (async () => {
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === "granted";
      if (!ok) return;
      const names = dueIds.slice(0, 3).map((id) => tracks[id]?.company || tracks[id]?.title).join(", ");
      sendNotification({
        title: `${dueIds.length} follow-up${dueIds.length === 1 ? "" : "s"} due`,
        body: `No reply yet from ${names}. Open Pipeline to follow up or snooze.`,
      });
    })();
  }, [dueIds, settings?.notify_new, tracks]);

  // Scores used for ordering are a snapshot, refreshed only at natural moments
  // (sort/filter/search change, refresh, background scoring finished), so the
  // list doesn't reshuffle under the user while scores stream in.
  const analysesRef = useRef(analyses);
  analysesRef.current = analyses;
  const [sortEpoch, setSortEpoch] = useState(0);
  const resort = useCallback(() => setSortEpoch((n) => n + 1), []);
  resortRef.current = resort;
  const sortScores = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const [id, a] of Object.entries(analysesRef.current)) out[id] = a.score;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortEpoch, sort, filter, source, query, german, settings?.skills]);

  const visible = useMemo(() => {
    const hiddenOk = filter === "saved" || filter === "tracked";
    const list = base.filter((j) => matchesFilter(j, filter) && (hiddenOk || tracks[j.id]?.status !== "hidden"));
    const score = (j: Job) => sortScores[j.id] ?? (j.junior ? 40 : -1);
    const date = (j: Job) => j.published ?? new Date(j.first_seen * 1000).toISOString();
    return list.sort((a, b) =>
      sort === "company"
        ? a.company.localeCompare(b.company)
        : sort === "newest"
          ? date(b).localeCompare(date(a))
          : score(b) - score(a) || date(b).localeCompare(date(a)),
    );
  }, [base, filter, sort, matchesFilter, sortScores, tracks]);

  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>;
    for (const f of ["all", "new", "junior", "saved", "tracked", "watched"] as Filter[]) {
      c[f] = base.filter((j) => matchesFilter(j, f) && (f === "saved" || f === "tracked" || tracks[j.id]?.status !== "hidden")).length;
    }
    return c;
  }, [base, matchesFilter, tracks]);

  // Keep a valid selection.
  useEffect(() => {
    if (view === "jobs" && visible.length && !visible.some((j) => j.id === selectedId)) setSelectedId(visible[0].id);
  }, [visible, selectedId, view]);

  const selected = selectedId ? jobsById[selectedId] : undefined;

  /* ---------- actions ---------- */

  const snapshot = (job: Job, prev?: Track): Track => ({
    status: prev?.status ?? "saved",
    notes: prev?.notes ?? "",
    updated: 0,
    applied: prev?.applied ?? null,
    title: job.title,
    company: job.company,
    location: job.location,
    url: job.url,
    apply_url: job.apply_url,
    followed_up: prev?.followed_up ?? null,
    remind_after: prev?.remind_after ?? null,
    interview_at: prev?.interview_at ?? null,
    contact: prev?.contact ?? "",
    cv: prev?.cv ?? "",
    sent_message: prev?.sent_message ?? "",
  });

  async function patchTrack(id: string, patch: Partial<Track>, message: string) {
    const prev = tracks[id];
    const job = jobsById[id];
    if (!prev || !job) return;
    const saved = await api.setTrack(id, { ...snapshot(job, prev), ...patch });
    if (saved) setTracks((t) => ({ ...t, [id]: saved }));
    toast(message);
  }

  const followUps = {
    due: (id: string) => dueIds.includes(id),
    done: (id: string) => patchTrack(id, { followed_up: Math.floor(Date.now() / 1000), remind_after: null }, "Follow-up logged, next reminder in " + followUpDays + " days"),
    snooze: (id: string) => patchTrack(id, { remind_after: Math.floor(snoozeUntil()) }, "Snoozed for 3 days"),
    write: (id: string) => {
      setSelectedId(id);
      setFilter("tracked");
      setView("jobs");
      setAiKind("Follow-up after applying");
      setTab("ai");
    },
  };

  async function setStatus(job: Job, status: Status | null) {
    const prev = tracks[job.id];
    let next: Track | null;
    if (status === null) {
      next = prev?.notes ? { ...snapshot(job, prev), status: "saved" } : null;
    } else {
      next = { ...snapshot(job, prev), status };
    }
    const saved = await api.setTrack(job.id, next);
    setTracks((t) => {
      const copy = { ...t };
      if (saved) copy[job.id] = saved;
      else delete copy[job.id];
      return copy;
    });
    if (status === null) toast(prev?.notes ? "Kept as saved because it has notes" : "Removed from pipeline");
    else if (status === "hidden") toast("Hidden");
    else toast(`Marked as ${status}`);
  }

  /** Saves application details; creates a "saved" track if the job wasn't tracked. */
  async function updateTrack(job: Job, patch: Partial<Track>) {
    const prev = tracksRef.current[job.id];
    const saved = await api.setTrack(job.id, { ...snapshot(job, prev), ...patch });
    if (saved) setTracks((t) => ({ ...t, [job.id]: saved }));
  }

  async function moveTrack(id: string, status: Status) {
    const job = jobsById[id];
    if (job) await setStatus(job, status);
  }

  async function updateSettings(next: Settings) {
    await api.saveSettings(next);
    setSettings(next);
  }

  async function hideCompany(company: string) {
    if (!settings || settings.hide_companies.includes(company)) return;
    const before = settings;
    await updateSettings({ ...settings, hide_companies: [...settings.hide_companies, company] });
    toast(`All jobs from ${company} hidden`, "ok", { label: "Undo", run: () => updateSettings(before) });
  }

  /* Saved views */
  const currentView = (): Omit<SavedView, "name"> => ({ filter, source, german, sort, query });
  const viewMatches = (v: Omit<SavedView, "name">, j: Job) => {
    const q = v.query.trim().toLowerCase();
    return (
      !ruleHidden.has(j.id) &&
      (v.source === "all" || j.source === v.source) &&
      (v.german !== "ok" || germanOk(germanNeeds[j.id])) &&
      (!q || `${j.title} ${j.company} ${j.location} ${j.tags.join(" ")}`.toLowerCase().includes(q)) &&
      matchesFilter(j, v.filter as Filter) &&
      (v.filter === "saved" || v.filter === "tracked" || tracks[j.id]?.status !== "hidden")
    );
  };
  const savedViews = settings?.saved_views ?? [];
  const viewCounts = savedViews.map((v) => ({ name: v.name, count: allJobs.filter((j) => viewMatches(v, j)).length }));
  const cur = currentView();
  const activeView = savedViews.find((v) => v.filter === cur.filter && v.source === cur.source && v.german === cur.german && v.sort === cur.sort && v.query === cur.query)?.name ?? null;

  async function saveView(name: string) {
    if (!settings) return;
    const views = [...settings.saved_views.filter((v) => v.name !== name), { name, ...currentView() }];
    await updateSettings({ ...settings, saved_views: views });
    toast(`Saved view “${name}”`);
  }
  function applyView(name: string) {
    const v = savedViews.find((x) => x.name === name);
    if (!v) return;
    setFilter(v.filter as Filter);
    setSource(v.source as SourceFilter);
    setGerman(v.german as "any" | "ok");
    setSort(v.sort as Sort);
    setQuery(v.query);
  }
  async function deleteView(name: string) {
    if (!settings) return;
    const before = settings;
    await updateSettings({ ...settings, saved_views: settings.saved_views.filter((v) => v.name !== name) });
    toast(`Deleted view “${name}”`, "ok", { label: "Undo", run: () => updateSettings(before) });
  }

  const weekly = useMemo(() => {
    const s = weeklyStats(Object.values(tracks), settings?.weekly_goal ?? 0);
    return { done: s.thisWeek, goal: s.goal };
  }, [tracks, settings?.weekly_goal]);

  async function toggleWatch(company: string) {
    if (!settings) return;
    const key = companyKey(company);
    const on = watchedKeys.has(key);
    const watched = on ? settings.watched.filter((c) => companyKey(c) !== key) : [...settings.watched, company];
    const next = { ...settings, watched };
    await api.saveSettings(next);
    setSettings(next);
    toast(on ? `Stopped watching ${company}` : `Watching ${company}: you'll be notified about new jobs`);
  }

  const watching = useMemo(
    () =>
      (settings?.watched ?? []).map((name) => ({
        name,
        count: allJobs.filter((j) => !j.delisted && companyKey(j.company) === companyKey(name)).length,
      })),
    [settings?.watched, allJobs],
  );

  async function saveSettings(s: Settings) {
    await api.saveSettings(s);
    const searchChanged = JSON.stringify([s.terms, s.districts, s.include_noi, s.include_suedtiroler, s.onboard_companies, s.onboard_local_only]) !==
      JSON.stringify([settings?.terms, settings?.districts, settings?.include_noi, settings?.include_suedtiroler, settings?.onboard_companies, settings?.onboard_local_only]);
    setSettings(s);
    if (searchChanged) refresh();
  }

  /* ---------- keyboard ---------- */

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = (e.target as HTMLElement).closest("input, textarea, select");
      if (e.key === "Escape") {
        if (shortcuts) setShortcuts(false);
        else if (typing) (e.target as HTMLElement).blur();
        else if (query) setQuery("");
        return;
      }
      if (e.ctrlKey && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        setView((["jobs", "pipeline", "insights", "settings"] as View[])[Number(e.key) - 1]);
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setView("jobs");
        searchRef.current?.focus();
        return;
      }
      if (typing || e.ctrlKey || e.altKey || e.metaKey) return;

      const idx = visible.findIndex((j) => j.id === selectedId);
      const move = (d: number) => {
        const next = visible[Math.max(0, Math.min(visible.length - 1, idx + d))];
        if (next) setSelectedId(next.id);
      };
      const k = e.key;
      if (k === "?") setShortcuts(true);
      else if (k === "/") {
        e.preventDefault();
        setView("jobs");
        searchRef.current?.focus();
      } else if (k === "r") refresh();
      else if (view !== "jobs") return;
      else if (k === "j" || k === "ArrowDown") (e.preventDefault(), move(1));
      else if (k === "k" || k === "ArrowUp") (e.preventDefault(), move(-1));
      else if (!selected) return;
      else if (k === "Enter") openUrl(selected.apply_url ?? selected.url);
      else if (k === "s") setStatus(selected, tracks[selected.id]?.status === "saved" ? null : "saved");
      else if (k === "a") setStatus(selected, tracks[selected.id]?.status === "applied" ? null : "applied");
      else if (k === "i") setStatus(selected, "interview");
      else if (k === "h") {
        setStatus(selected, tracks[selected.id]?.status === "hidden" ? null : "hidden");
        move(1);
      } else if (k === "o") setTab("overview");
      else if (k === "p") setTab("ai");
      else if (k === "n") {
        // Focus the editor only when asked for with N, so other shortcuts keep working.
        e.preventDefault();
        setTab("notes");
        setTimeout(() => document.getElementById("notes-editor")?.focus(), 50);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------- render ---------- */

  const pipelineCount = Object.values(tracks).filter((t) => t.status !== "hidden").length;
  const status = loading ? "Fetching sources…" : fetchedAt ? `${jobs.length} jobs · updated ${ago(fetchedAt)}` : "";
  const autoText = settings?.auto_refresh_minutes
    ? `Auto-refresh every ${settings.auto_refresh_minutes < 60 ? `${settings.auto_refresh_minutes} min` : `${settings.auto_refresh_minutes / 60} h`}${settings.notify_new ? " with notifications" : ""}.`
    : "Auto-refresh is off.";

  return (
    <div className="flex h-full flex-col">
      <TitleBar query={query} onQuery={(q) => (setQuery(q), setView("jobs"))} searchRef={searchRef} loading={loading} onRefresh={() => refresh()} status={status} />
      {errors.length > 0 && (
        <div className="flex items-center gap-2 border-b border-rose/20 bg-rose/5 px-4 py-1.5 text-[12px] text-rose">
          <TriangleAlert size={13} />
          {errors.join(" · ")}
          <button className="ml-auto opacity-70 hover:opacity-100" onClick={() => setErrors([])} aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <Sidebar
          view={view}
          onView={setView}
          counts={{ jobs: counts.all, pipeline: pipelineCount }}
          alerts={{ pipeline: dueIds.length }}
          watching={watching}
          weekly={weekly}
          onWatched={(name) => {
            setFilter("watched");
            setQuery(name);
            setView("jobs");
          }}
          onShortcuts={() => setShortcuts(true)}
          autoRefresh={autoText}
        />
        <ErrorBoundary resetKey={view + (selectedId ?? "")}>
        {view === "jobs" && (
          <>
            <JobList
              jobs={visible}
              tracks={tracks}
              analyses={analyses}
              selectedId={selectedId}
              onSelect={setSelectedId}
              filter={filter}
              onFilter={setFilter}
              counts={counts}
              sort={sort}
              onSort={setSort}
              source={source}
              onSource={setSource}
              german={german}
              onGerman={setGerman}
              germanNeeds={germanNeeds}
              commutes={commutes}
              maxCommute={maxCommute}
              onMaxCommute={setMaxCommute}
              homeTown={settings?.home_town ?? ""}
              checking={checking}
              unchecked={uncheckedCount}
              dueIds={dueIds}
              isWatched={isWatched}
              views={viewCounts}
              activeView={activeView}
              onApplyView={applyView}
              onSaveView={saveView}
              onDeleteView={deleteView}
              ruleHidden={ruleHidden.size}
              onEditRules={() => setView("settings")}
              loading={loading}
            />
            {selected && settings ? (
              <JobDetail
                job={selected}
                track={tracks[selected.id]}
                settings={settings}
                description={descriptions[selected.id]}
                onDescription={(id, text) => setDescriptions((d) => ({ ...d, [id]: text }))}
                onStatus={setStatus}
                onUpdate={updateTrack}
                onOpenListing={(id) => setSelectedId(id)}
                watched={isWatched(selected.company)}
                onToggleWatch={() => toggleWatch(selected.company)}
                onHideCompany={() => hideCompany(selected.company)}
                followUp={followUps}
                aiKind={aiKind}
                onAiKindUsed={() => setAiKind(null)}
                tab={tab}
                onTab={setTab}
                commute={commutes[selected.location]}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-void text-chrome-500">
                <MousePointerClick size={28} strokeWidth={1.4} />
                <p className="text-[13px]">{loading ? "Loading jobs…" : "Select a job"}</p>
              </div>
            )}
          </>
        )}
        {view === "pipeline" && (
          <PipelineView
            tracks={tracks}
            jobsById={jobsById}
            onMove={moveTrack}
            dueIds={dueIds}
            followUp={followUps}
            followUpDays={followUpDays}
            interviews={interviews}
            onOpen={(id) => {
              setSelectedId(id);
              setFilter(tracks[id]?.status === "saved" ? "saved" : "tracked");
              setView("jobs");
            }}
          />
        )}
        {view === "insights" && <InsightsView jobs={allJobs} tracks={tracks} analyses={analyses} weeklyGoal={settings?.weekly_goal ?? 0} />}
        {view === "settings" && settings && (
          <SettingsView
            settings={settings}
            onSave={saveSettings}
            onRestored={() => {
              api.getSettings().then(setSettings);
              api.getTracks().then(setTracks);
              api.getDescriptions().then(setDescriptions);
            }}
          />
        )}
        </ErrorBoundary>
      </div>
      {shortcuts && <ShortcutsModal onClose={() => setShortcuts(false)} />}
    </div>
  );
}

const SHORTCUTS: [string[], string][] = [
  [["J", "↓"], "Next job"],
  [["K", "↑"], "Previous job"],
  [["Enter"], "Open apply page"],
  [["S"], "Save / unsave"],
  [["A"], "Mark applied"],
  [["I"], "Mark interview"],
  [["H"], "Hide and move on"],
  [["O"], "Overview tab"],
  [["P"], "AI email tab"],
  [["N"], "Notes tab"],
  [["/"], "Search"],
  [["R"], "Refresh"],
  [["Ctrl", "1–4"], "Switch view"],
  [["Esc"], "Clear / close"],
];

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={label} className="flex items-center text-[13px] text-chrome-300">
            {label}
            <span className="ml-auto flex gap-1">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
