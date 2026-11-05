import { memo, useEffect, useRef } from "react";
import { useState } from "react";
import { ArrowDownWideNarrow, BellRing, BookmarkPlus, Bus, Copy, EyeOff, Hand, Inbox, Languages, PenLine, Rocket, Sparkles, Sunrise, Star, ThumbsDown, TriangleAlert, X } from "lucide-react";
import type { Commute, Job, Track } from "../types";
import { PIPELINE } from "../types";
import type { Analysis, GermanNeed } from "../lib/match";
import type { Fit } from "../lib/foryou";
import { ageDays, shortDate, ago } from "../lib/format";
import { Button, Chip, ScoreRing } from "./ui";
import { t } from "../lib/i18n";

export type Filter = "foryou" | "all" | "new" | "junior" | "everyday" | "saved" | "tracked" | "watched";
export type Sort = "match" | "newest" | "company";
export type SourceFilter = "all" | "karriere-suedtirol" | "noi-techpark" | "suedtirolerjobs" | "onboard";

const NOT_FOR_ME: [string, string][] = [
  ["field", "Wrong field"],
  ["senior", "Too senior"],
  ["far", "Too far"],
  ["company", "This company"],
  ["other", "Other"],
];

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "junior", label: "Junior" },
  { id: "everyday", label: "Everyday" },
  { id: "saved", label: "Saved" },
  { id: "tracked", label: "Applied+" },
  { id: "watched", label: "★" },
];

export function JobList({
  jobs,
  tracks,
  analyses,
  selectedId,
  onSelect,
  filter,
  onFilter,
  counts,
  sort,
  onSort,
  source,
  onSource,
  german,
  onGerman,
  germanNeeds,
  commutes,
  maxCommute,
  onMaxCommute,
  homeTown,
  checking,
  unchecked,
  dueIds,
  isWatched,
  views,
  activeView,
  onApplyView,
  onSaveView,
  onDeleteView,
  ruleHidden,
  onEditRules,
  loading,
  fits,
  firstName,
  needsSetup,
  onNotForMe,
  onAskGpt,
  onRunSetup,
  morning,
  onApproveMorning,
  onSkipMorning,
}: {
  jobs: Job[];
  tracks: Record<string, Track>;
  analyses: Record<string, Analysis>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: Filter;
  onFilter: (f: Filter) => void;
  counts: Record<Filter, number>;
  sort: Sort;
  onSort: (s: Sort) => void;
  source: SourceFilter;
  onSource: (s: SourceFilter) => void;
  german: "any" | "ok";
  onGerman: (g: "any" | "ok") => void;
  germanNeeds: Record<string, GermanNeed>;
  /** Commute per job location (only towns the journey planner knows). */
  commutes: Record<string, Commute>;
  maxCommute: string;
  onMaxCommute: (m: string) => void;
  homeTown: string;
  /** Background posting check while the German filter is on. */
  checking: { done: number; total: number } | null;
  /** Jobs the German filter can't judge yet, so they're hidden. */
  unchecked: number;
  dueIds: string[];
  isWatched: (company: string) => boolean;
  /** Saved filter combinations with how many jobs each matches. */
  views: { name: string; count: number }[];
  activeView: string | null;
  onApplyView: (name: string) => void;
  onSaveView: (name: string) => void;
  onDeleteView: (name: string) => void;
  /** Jobs removed by hide rules (company or title word). */
  ruleHidden: number;
  onEditRules: () => void;
  loading: boolean;
  /** For You scores and reasons per job. */
  fits: Record<string, Fit>;
  firstName: string;
  /** Existing users who haven't told the app what they want yet. */
  needsSetup: boolean;
  onNotForMe: (job: Job, reason: string) => void;
  onAskGpt: () => void;
  onRunSetup: () => void;
  /** Today's prepared matches, waiting for approval. */
  morning: Job[];
  onApproveMorning: () => void;
  onSkipMorning: (job: Job) => void;
}) {
  const forYou = filter === "foryou";
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the keyboard-selected row in view.
  useEffect(() => {
    listRef.current?.querySelector(`[data-id="${CSS.escape(selectedId ?? "")}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <section className="flex w-[360px] shrink-0 flex-col border-r xl:w-[440px] border-line bg-base">
      <div className="space-y-2.5 border-b border-line px-3 py-3">
        {forYou && (
          <div className="flex items-center gap-3 px-1 pt-0.5">
            <div className="min-w-0">
              <h2 className="chrome-text text-[20px] font-semibold leading-tight tracking-tight">{t("For You")}</h2>
              <p className="truncate text-[12px] text-chrome-500">{firstName ? `${t("For You")}: ${firstName}` : t("Ranked for you")} · {t("best first")}</p>
            </div>
            <Button size="sm" className="ml-auto" icon={<Sparkles size={12} />} onClick={onAskGpt}>
              {t("Rank with ChatGPT")}
            </Button>
          </div>
        )}
        {forYou && morning.length > 0 && (
          <div className="chrome-border sheen animate-rise rounded-xl bg-raised p-3">
            <div className="flex items-center gap-2 text-[12.5px]">
              <Sunrise size={14} className="text-amber" />
              <span className="font-semibold text-chrome-50">{t("Morning queue")}</span>
              <span className="text-chrome-500">
                {morning.length} {t("ready for you")}
              </span>
              <Button size="sm" variant="chrome" className="ml-auto" onClick={onApproveMorning}>
                {t("Approve all")}
              </Button>
            </div>
            <div className="mt-2 space-y-0.5">
              {morning.map((j) => (
                <div key={j.id} className="flex items-center gap-2 text-[12px]">
                  <button onClick={() => onSelect(j.id)} className="min-w-0 flex-1 truncate text-left text-chrome-300 transition hover:text-chrome-50">
                    {j.title} <span className="text-chrome-600">· {j.company}</span>
                  </button>
                  <button aria-label={`Skip ${j.title}`} onClick={() => onSkipMorning(j)} className="text-chrome-600 transition hover:text-chrome-100">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {forYou && needsSetup && (
          <button onClick={onRunSetup} className="chrome-border sheen flex w-full items-center gap-2.5 rounded-xl bg-raised p-3 text-left transition hover:bg-hover">
            <Sparkles size={15} className="shrink-0 text-chrome-200" />
            <span className="min-w-0 text-[12.5px] leading-snug text-chrome-300">
              <span className="font-semibold text-chrome-50">Tell the app what you want.</span> A one-minute setup makes this feed far better. Your data stays as it is.
            </span>
          </button>
        )}
        {!forYou && <div className="flex flex-wrap items-center gap-1.5">
          {views.map((v) => (
            <span
              key={v.name}
              className={`group flex h-6 items-center gap-1 rounded-full border pl-2.5 pr-1 text-[11.5px] transition ${
                activeView === v.name ? "border-chrome-300 bg-elevated text-chrome-50" : "border-line text-chrome-400 hover:border-line-strong hover:text-chrome-100"
              }`}
            >
              <button onClick={() => onApplyView(v.name)} className="flex items-center gap-1.5">
                {v.name}
                <span className="tabular-nums text-chrome-600">{v.count}</span>
              </button>
              <button onClick={() => onDeleteView(v.name)} className="rounded-full p-0.5 text-chrome-600 opacity-0 transition hover:text-chrome-50 group-hover:opacity-100" aria-label={`Delete view ${v.name}`}>
                <X size={10} />
              </button>
            </span>
          ))}
          {naming ? (
            <form
              className="flex items-center"
              onSubmit={(e) => {
                e.preventDefault();
                if (viewName.trim()) onSaveView(viewName.trim());
                setViewName("");
                setNaming(false);
              }}
            >
              <input
                autoFocus
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                onBlur={() => !viewName && setNaming(false)}
                placeholder="Name this view…"
                className="chrome-border h-6 w-36 rounded-full bg-void px-2.5 text-[11.5px] outline-none placeholder:text-chrome-600"
              />
            </form>
          ) : (
            <button
              onClick={() => setNaming(true)}
              title="Save the current filters, source, German filter, sort and search as a view"
              className="flex h-6 items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 text-[11.5px] text-chrome-500 transition hover:text-chrome-100"
            >
              <BookmarkPlus size={11} /> Save view
            </button>
          )}
        </div>}
        {!forYou && <div className="chrome-border flex rounded-lg bg-void p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => onFilter(f.id)}
              className={`flex h-7 flex-1 items-center justify-center gap-1 rounded-md text-[12px] font-medium transition ${
                filter === f.id ? "chrome-face" : "text-chrome-400 hover:text-chrome-100"
              }`}
            >
              {t(f.label)}
              <span className={`text-[10px] tabular-nums ${filter === f.id ? "text-black/55" : "text-chrome-600"}`}>{counts[f.id]}</span>
            </button>
          ))}
        </div>}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px]">
          {!forYou && <ArrowDownWideNarrow size={13} className="text-chrome-500" />}
          {!forYou && <Select value={sort} onChange={(v) => onSort(v as Sort)} options={[["match", "Best match"], ["newest", "Newest"], ["company", "Company"]]} />}
          <Select
            value={source}
            onChange={(v) => onSource(v as SourceFilter)}
            options={[["all", "All sources"], ["karriere-suedtirol", "Karriere Südtirol"], ["suedtirolerjobs", "Südtiroler Jobs"], ["onboard", "Company sites"], ["noi-techpark", "NOI Techpark"]]}
          />
          <span title={`Public transport from ${homeTown || "your home town"}, arriving by 8:30. Jobs in towns the planner doesn't know stay visible.`}>
            <Select
              value={maxCommute}
              onChange={onMaxCommute}
              options={[["any", "Any commute"], ["30", "≤ 30 min"], ["45", "≤ 45 min"], ["60", "≤ 1 h"], ["90", "≤ 1.5 h"]]}
            />
          </span>
          <span className="ml-auto flex items-center gap-2 text-chrome-500 tabular-nums">
            {ruleHidden > 0 && (
              <button onClick={onEditRules} className="flex items-center gap-1 text-chrome-600 hover:text-chrome-200" title="Hidden by your hide rules. Click to edit them.">
                <EyeOff size={11} /> {ruleHidden}
              </button>
            )}
            {jobs.length} shown
          </span>
        </div>
        <button
          onClick={() => onGerman(german === "ok" ? "any" : "ok")}
          title="Show only jobs whose posting doesn't require German (German may still be listed as a plus)"
          className={`flex h-7 w-full items-center gap-2 rounded-lg px-2.5 text-[12px] font-medium transition ${
            german === "ok" ? "chrome-face" : "chrome-border bg-raised text-chrome-300 hover:bg-hover hover:text-chrome-50"
          }`}
        >
          <Languages size={13} />
          No German required
          <span className={`ml-auto text-[11px] font-normal ${german === "ok" ? "text-black/55" : "text-chrome-600"}`}>
            {german === "ok" ? "on" : "off"}
          </span>
        </button>
        {german === "ok" && (checking || unchecked > 0) && (
          <div className="space-y-1.5">
            <div className="flex text-[11px] text-chrome-500">
              {checking ? `Reading postings ${checking.done} / ${checking.total}…` : `${unchecked} postings can't be checked automatically`}
              <span className="ml-auto tabular-nums">{unchecked} hidden until checked</span>
            </div>
            {checking && (
              <div className="h-0.5 overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-chrome-500 to-chrome-100 transition-[width] duration-300"
                  style={{ width: `${(checking.done / Math.max(1, checking.total)) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-2">
        {loading && jobs.length === 0 && <Skeletons />}
        {!loading && jobs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-chrome-500">
            <Inbox size={28} strokeWidth={1.4} />
            <p className="text-[13px]">
              {forYou
                ? "Nothing matches closely yet."
                : filter === "new"
                ? "No new postings yet."
                : filter === "watched"
                  ? "No jobs from watched companies."
                  : german === "ok" && checking
                    ? "Checking postings…"
                    : "No jobs match these filters."}
            </p>
            {forYou && (
              <div className="flex max-w-[280px] flex-col items-center gap-3 text-center text-[12px] leading-relaxed text-chrome-600">
                <p>Add more fields or job titles, or see everything in Jobs.</p>
                <Button size="sm" onClick={onRunSetup}>
                  Update what you're looking for
                </Button>
              </div>
            )}
            {filter === "watched" && (
              <p className="max-w-[260px] text-center text-[12px] leading-relaxed text-chrome-600">
                Star a company from any of its jobs to watch it. You'll get a notification when it posts something new.
              </p>
            )}
            {filter === "new" && (
              <p className="max-w-[260px] text-center text-[12px] leading-relaxed text-chrome-600">
                Jobs that appear after your first day show up here for 24 hours. Auto-refresh checks for them in the background.
              </p>
            )}
          </div>
        )}
        {jobs.map((job) => (
          <Row
            key={job.id}
            job={job}
            track={tracks[job.id]}
            analysis={analyses[job.id]}
            german={germanNeeds[job.id]}
            commute={commutes[job.location]}
            fit={forYou ? fits[job.id] : undefined}
            onNotForMe={forYou ? onNotForMe : undefined}
            due={dueIds.includes(job.id)}
            watched={isWatched(job.company)}
            selected={job.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

const Row = memo(function Row({
  job,
  track,
  analysis,
  german,
  commute,
  fit,
  onNotForMe,
  due,
  watched,
  selected,
  onSelect,
}: {
  job: Job;
  track?: Track;
  analysis?: Analysis;
  german?: GermanNeed;
  commute?: Commute;
  fit?: Fit;
  onNotForMe?: (job: Job, reason: string) => void;
  due: boolean;
  watched: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const stage = track && PIPELINE.find((p) => p.id === track.status);
  const age = ageDays(job.published);
  const [asking, setAsking] = useState(false);
  return (
    <div className="group relative mb-1">
    <button
      data-id={job.id}
      onClick={() => onSelect(job.id)}
      className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
        selected ? "chrome-border bg-elevated" : "hover:bg-raised"
      } ${track?.status === "hidden" ? "opacity-40" : ""}`}
    >
      {fit ? <ScoreRing score={fit.score} size={36} /> : <ScoreRing score={analysis?.score ?? null} size={36} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {job.is_new && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky shadow-[0_0_8px] shadow-sky" title="New in the last 24 hours" />}
          <span className={`truncate text-[13px] font-semibold ${selected ? "text-chrome-50" : "text-chrome-100"}`}>{job.title}</span>
        </div>
        <div className="mt-0.5 truncate text-[12px] text-chrome-400">
          {watched && <Star size={10} className="mr-1 inline -translate-y-px fill-amber text-amber" />}
          {job.company}
          {job.location && <span className="text-chrome-600"> · {job.location}</span>}
        </div>
        {fit && fit.reasons.length > 0 && <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-chrome-200">{fit.reasons.slice(0, 2).join(" · ")}</div>}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {track?.needs_you && (
            <Chip tone="amber">
              <Hand size={10} /> Needs you
            </Chip>
          )}
          {track?.queued && (
            <Chip tone="violet">
              <Rocket size={10} /> Autopilot
            </Chip>
          )}
          {track?.draft_message && (
            <Chip tone="sky">
              <PenLine size={10} /> Draft ready
            </Chip>
          )}
          {fit?.warnings.map((w) => (
            <Chip key={w} tone="amber">
              <TriangleAlert size={10} /> {w}
            </Chip>
          ))}
          {job.junior && <Chip tone="mint">Junior</Chip>}
          {stage && <Chip tone={toneOf(stage.id)}>{stage.label}</Chip>}
          {due && (
            <Chip tone="amber">
              <BellRing size={10} /> Follow up
            </Chip>
          )}
          {!fit && (german === "required" || german === "implied") && (
            <Chip tone="neutral" className="text-chrome-400" >
              {german === "required" ? "German required" : "German posting"}
            </Chip>
          )}
          {german === "plus" && <Chip>German a plus</Chip>}
          {job.duplicates?.length ? (
            <Chip className="text-chrome-400">
              <Copy size={10} /> {job.duplicates.length + 1} listings
            </Chip>
          ) : null}
          {track?.status === "hidden" && <Chip>Hidden</Chip>}
          {job.salary && <Chip>{job.salary}</Chip>}
          {commute && (
            <Chip className={commute.minutes > 60 ? "text-chrome-500" : "text-chrome-300"}>
              <Bus size={10} /> {commuteLabel(commute)}
            </Chip>
          )}
          {job.delisted && <Chip tone="rose">Delisted</Chip>}
        </div>
      </div>
      <div className={`shrink-0 self-start pt-0.5 text-[11px] tabular-nums ${age !== null && age > 60 ? "text-chrome-600" : "text-chrome-500"}`}>
        {job.published ? shortDate(job.published) : ago(job.first_seen)}
      </div>
    </button>
    {onNotForMe && !asking && (
      <button
        onClick={() => setAsking(true)}
        title="Not for me"
        aria-label="Not for me"
        className="absolute bottom-2.5 right-2.5 flex h-6 w-6 items-center justify-center rounded-md bg-elevated text-chrome-500 opacity-0 transition hover:text-chrome-50 focus:opacity-100 group-hover:opacity-100"
      >
        <ThumbsDown size={12} />
      </button>
    )}
    {onNotForMe && asking && (
      <div className="animate-rise mx-2 mb-1 flex flex-wrap items-center gap-1 rounded-lg border border-line-strong bg-raised p-1.5 text-[11.5px]">
        <span className="px-1 text-chrome-500">Not for me:</span>
        {NOT_FOR_ME.map(([id, label]) => (
          <button key={id} onClick={() => onNotForMe(job, id)} className="rounded-md px-1.5 py-0.5 text-chrome-200 transition hover:bg-hover hover:text-chrome-50">
            {label}
          </button>
        ))}
        <button onClick={() => setAsking(false)} aria-label="Cancel" className="ml-auto rounded-md p-0.5 text-chrome-600 hover:text-chrome-100">
          <X size={12} />
        </button>
      </div>
    )}
    </div>
  );
});

export function toneOf(status: string) {
  return ({ saved: "amber", applied: "sky", interview: "violet", offer: "mint", rejected: "rose" } as const)[status as "saved"] ?? "neutral";
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="chrome-border h-7 rounded-md bg-raised px-2 text-[12px] text-chrome-200 outline-none hover:bg-hover"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v} className="bg-elevated">
          {l}
        </option>
      ))}
    </select>
  );
}

function Skeletons() {
  return (
    <div className="space-y-1 px-1">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl px-2 py-3">
          <div className="skeleton h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3 w-3/4" />
            <div className="skeleton h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function commuteLabel(c: Commute) {
  if (c.modes === "Same town") return "In town";
  const h = Math.floor(c.minutes / 60);
  return h ? `${h} h ${String(c.minutes % 60).padStart(2, "0")}` : `${c.minutes} min`;
}
