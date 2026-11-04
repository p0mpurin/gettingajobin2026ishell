import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlarmClock,
  BellRing,
  Bot,
  CalendarClock,
  Star,
  Check,
  Copy,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardCopy,
  EyeOff,
  ExternalLink,
  FileText,
  Languages,
  MapPin,
  NotebookPen,
  RotateCw,
  Send,
  Sparkles,
  TriangleAlert,
  Bus,
} from "lucide-react";
import { commuteLabel } from "./JobList";
import type { Fit } from "../lib/foryou";
import type { Job, Settings, Status, Track, Commute } from "../types";
import { PIPELINE } from "../types";
import { api, canLoadDescription } from "../lib/api";
import { analyze, profileLanguageLevel, type Analysis } from "../lib/match";
import { buildPrompt, KINDS, LANGUAGES, TONES } from "../lib/prompt";
import { ago, shortDate, SOURCE_LABEL } from "../lib/format";
import { daysSince, SNOOZE_DAYS } from "../lib/followup";
import { formatWhen } from "../lib/ics";
import { Button, Chip, Kbd, Panel, ScoreRing, SectionTitle, useToast } from "./ui";
import { ApplicationTab } from "./ApplicationTab";

export type DetailTab = "overview" | "ai" | "notes";

export interface FollowUpActions {
  due: (id: string) => boolean;
  done: (id: string) => void;
  snooze: (id: string) => void;
  write: (id: string) => void;
}

function FollowUpBanner({ track, onWrite, onDone, onSnooze }: { track: Track; onWrite: () => void; onDone: () => void; onSnooze: () => void }) {
  const since = Math.max(track.applied ?? 0, track.followed_up ?? 0);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber/25 bg-amber/[0.06] px-4 py-3">
      <BellRing size={16} className="shrink-0 text-amber" />
      <div className="min-w-0 flex-1 text-[13px]">
        <div className="font-medium text-chrome-50">Time to follow up</div>
        <div className="text-[12px] text-chrome-400">
          {track.followed_up ? "You last followed up" : "You applied"} {daysSince(since)} days ago and haven't marked a reply.
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="chrome" icon={<Sparkles size={12} />} onClick={onWrite}>
          Write follow-up
        </Button>
        <Button size="sm" icon={<Check size={12} />} onClick={onDone}>
          I followed up
        </Button>
        <Button size="sm" variant="ghost" icon={<AlarmClock size={12} />} onClick={onSnooze}>
          Snooze {SNOOZE_DAYS} days
        </Button>
      </div>
    </div>
  );
}

export function JobDetail({
  job,
  track,
  settings,
  description,
  onDescription,
  onStatus,
  onUpdate,
  onOpenListing,
  watched,
  onToggleWatch,
  onHideCompany,
  followUp,
  aiKind,
  onAiKindUsed,
  tab,
  onTab,
  commute,
  fit,
  onPrepare,
}: {
  commute?: Commute;
  fit?: Fit;
  /** Opens the application review screen. */
  onPrepare: () => void;
  job: Job;
  track?: Track;
  settings: Settings;
  description: string | undefined;
  onDescription: (id: string, text: string) => void;
  onStatus: (job: Job, status: Status | null) => void;
  onUpdate: (job: Job, patch: Partial<Track>) => void;
  onOpenListing: (id: string) => void;
  watched: boolean;
  onToggleWatch: () => void;
  onHideCompany: () => void;
  followUp: FollowUpActions;
  /** Message type to preselect when the AI tab opens (e.g. a follow-up). */
  aiKind: string | null;
  onAiKindUsed: () => void;
  tab: DetailTab;
  onTab: (t: DetailTab) => void;
}) {
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setLoadError("");
    if (description !== undefined || !canLoadDescription(job)) {
      setLoadState("idle");
      return;
    }
    let live = true;
    setLoadState("loading");
    api
      .description(job.id, job.url)
      .then((t) => live && (onDescription(job.id, t), setLoadState("idle")))
      .catch((e) => live && (setLoadError(String(e)), setLoadState("error")));
    return () => {
      live = false;
    };
  }, [job.id]);

  const analysis = useMemo(() => analyze(job.title, description ?? "", settings.skills), [job.title, description, settings.skills]);

  async function reload() {
    setLoadState("loading");
    try {
      onDescription(job.id, await api.description(job.id, job.url, true));
      setLoadState("idle");
    } catch (e) {
      setLoadError(String(e));
      setLoadState("error");
    }
  }

  return (
    <section key={job.id} className="animate-rise flex min-w-0 flex-1 flex-col bg-void">
      {/* Header */}
      <div className="border-b border-line px-7 pb-4 pt-6">
        <div className="flex items-start gap-4">
          <div className="chrome-face flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-[18px] font-bold">
            {(job.company || job.title).trim().charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="chrome-text selectable text-[22px] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]">{job.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-chrome-400">
              <span className="flex items-center gap-1.5">
                <BriefcaseBusiness size={13} />
                {job.company || "Unknown company"}
                {job.company && (
                  <button
                    onClick={onToggleWatch}
                    title={watched ? "Stop watching this company" : "Watch this company: get notified when it posts new jobs"}
                    className={`ml-0.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] transition ${watched ? "text-amber hover:bg-amber/10" : "text-chrome-500 hover:bg-hover hover:text-chrome-100"}`}
                  >
                    <Star size={12} className={watched ? "fill-amber" : ""} />
                    {watched ? "Watching" : "Watch"}
                  </button>
                )}
              </span>
              {job.location && (
                <span className="flex items-center gap-1.5">
                  <MapPin size={13} />
                  {job.location}
                </span>
              )}
              {commute && (
                <span className="flex items-center gap-1.5" title={`Quickest weekday trip from ${settings.home_town} arriving by 8:30 (Südtirolmobil timetable)`}>
                  <Bus size={13} />
                  {commute.modes === "Same town"
                    ? "In your town"
                    : `${commuteLabel(commute)} by ${commute.modes}${commute.changes ? `, ${commute.changes} change${commute.changes > 1 ? "s" : ""}` : ""}`}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <CalendarDays size={13} />
                {job.published ? `Posted ${shortDate(job.published)}` : `Seen ${ago(job.first_seen)}`}
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {job.junior && <Chip tone="mint">Junior-friendly</Chip>}
              {job.is_new && <Chip tone="sky">New</Chip>}
              {job.salary && <Chip tone="amber">{job.salary}</Chip>}
              {job.tags.map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
              <Chip>{SOURCE_LABEL[job.source]}</Chip>
              {job.delisted && <Chip tone="rose">No longer listed</Chip>}
            </div>
          </div>
          <ScoreRing score={analysis.score} size={58} />
        </div>

        {/* Actions */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="chrome" icon={<Send size={14} />} onClick={onPrepare}>
            {track?.draft_message ? "Review draft" : "Prepare application"}
          </Button>
          <Button icon={<ExternalLink size={14} />} onClick={() => openUrl(job.apply_url ?? job.url)}>
            {job.apply_url ? "Apply page" : "Posting"}
          </Button>
          <StatusStepper track={track} onSet={(s) => onStatus(job, s)} />
          <div className="ml-auto flex items-center gap-1">
            {job.company && (
              <Button variant="ghost" size="sm" onClick={onHideCompany} title={`Hide every job from ${job.company}. Undo from the notification or in Settings.`}>
                Hide company
              </Button>
            )}
            <Button variant="ghost" icon={<EyeOff size={14} />} onClick={() => onStatus(job, track?.status === "hidden" ? null : "hidden")}>
              {track?.status === "hidden" ? "Unhide" : "Hide"}
            </Button>
          </div>
        </div>

        {fit && (fit.reasons.length > 0 || fit.warnings.length > 0) && (
          <div className="mt-4 rounded-xl border border-line bg-white/[0.015] px-4 py-3 text-[12.5px] leading-relaxed">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-chrome-100">
              <Sparkles size={12} /> Why this job · {fit.score}% for you
            </div>
            {fit.reasons.map((r) => (
              <div key={r} className="text-chrome-300">{r}</div>
            ))}
            {fit.warnings.map((w) => (
              <div key={w} className="text-amber">{w}</div>
            ))}
          </div>
        )}

        {track?.interview_at && track.interview_at > Date.now() / 1000 - 7200 && track.interview_at - Date.now() / 1000 < 7 * 86400 && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-violet/25 bg-violet/[0.06] px-4 py-3">
            <CalendarClock size={16} className="shrink-0 text-violet" />
            <div className="min-w-0 flex-1 text-[13px]">
              <div className="font-medium text-chrome-50">Interview {formatWhen(track.interview_at)}</div>
              <div className="text-[12px] text-chrome-400">
                {track.contact ? `With ${track.contact}. ` : ""}Re-read the posting{track.sent_message ? " and the message you sent" : ""} before you go.
              </div>
            </div>
            <Button size="sm" onClick={() => onTab("notes")}>
              Open application
            </Button>
          </div>
        )}
        {track && followUp.due(job.id) && (
          <FollowUpBanner track={track} onWrite={() => followUp.write(job.id)} onDone={() => followUp.done(job.id)} onSnooze={() => followUp.snooze(job.id)} />
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-line px-6">
        {(
          [
            ["overview", "Overview", FileText, "O"],
            ["ai", "AI Email", Sparkles, "P"],
            ["notes", "Application", NotebookPen, "N"],
          ] as const
        ).map(([id, label, Icon, key]) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            className={`relative flex h-10 items-center gap-1.5 px-3 text-[13px] font-medium transition ${
              tab === id ? "text-chrome-50" : "text-chrome-500 hover:text-chrome-200"
            }`}
          >
            <Icon size={14} />
            {label}
            {id === "notes" && (track?.notes || track?.sent_message || track?.interview_at) && <span className="h-1.5 w-1.5 rounded-full bg-amber" />}
            <span className="ml-1 hidden xl:inline">
              <Kbd>{key}</Kbd>
            </span>
            {tab === id && <span className="absolute inset-x-2 -bottom-px h-px bg-gradient-to-r from-transparent via-white to-transparent" />}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {tab === "overview" && (
          <Overview
            job={job}
            analysis={analysis}
            settings={settings}
            description={description}
            loadState={loadState}
            loadError={loadError}
            onReload={reload}
            onPaste={(t) => {
              onDescription(job.id, t);
              api.saveDescription(job.id, t);
            }}
            onOpenListing={onOpenListing}
          />
        )}
        {tab === "ai" && (
          <AiTab
            key={job.id + (aiKind ?? "")}
            job={job}
            settings={settings}
            description={description ?? ""}
            analysis={analysis}
            onPaste={(t) => onDescription(job.id, t)}
            initialKind={aiKind}
            onKindUsed={onAiKindUsed}
          />
        )}
        {tab === "notes" && <ApplicationTab job={job} track={track} onUpdate={onUpdate} />}
      </div>
    </section>
  );
}

function StatusStepper({ track, onSet }: { track?: Track; onSet: (s: Status | null) => void }) {
  const current = track?.status;
  return (
    <div className="chrome-border flex h-8.5 items-center rounded-lg bg-raised p-0.5">
      {PIPELINE.map((p) => {
        const active = current === p.id;
        return (
          <button
            key={p.id}
            onClick={() => onSet(active ? null : p.id)}
            title={active ? `Remove "${p.label}"` : `Mark as ${p.label}`}
            className={`flex h-full items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition ${
              active ? `bg-white/[0.08] ${p.tone}` : "text-chrome-500 hover:text-chrome-100"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-current shadow-[0_0_8px] shadow-current" : "bg-chrome-600"}`} />
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

function Overview({
  job,
  analysis,
  settings,
  description,
  loadState,
  loadError,
  onReload,
  onPaste,
  onOpenListing,
}: {
  job: Job;
  analysis: Analysis;
  settings: Settings;
  description: string | undefined;
  loadState: string;
  loadError: string;
  onReload: () => void;
  onPaste: (t: string) => void;
  onOpenListing: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const loadable = canLoadDescription(job);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {job.duplicates && job.duplicates.length > 0 && (
        <Panel className="p-4">
          <SectionTitle>
            <span className="flex items-center gap-1.5">
              <Copy size={11} /> Also listed {job.duplicates.length === 1 ? "once more" : `${job.duplicates.length} more times`}
            </span>
          </SectionTitle>
          <div className="space-y-1">
            {job.duplicates.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-hover">
                <button className="min-w-0 flex-1 truncate text-left text-chrome-200 hover:text-chrome-50" onClick={() => onOpenListing(d.id)} title="Show this listing">
                  {d.title}
                </button>
                <span className="shrink-0 text-chrome-500">{[d.location, SOURCE_LABEL[d.source], d.published && shortDate(d.published)].filter(Boolean).join(" · ")}</span>
                <button className="shrink-0 text-chrome-500 hover:text-chrome-50" onClick={() => openUrl(d.apply_url ?? d.url)} aria-label="Open listing">
                  <ExternalLink size={12} />
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <Panel className="p-5">
        <SectionTitle>Fit check</SectionTitle>
        {description === undefined && loadState !== "loading" ? (
          <p className="text-[13px] text-chrome-500">Load or paste the posting to see which of your skills it asks for.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[12px] text-chrome-400">You have ({analysis.matched.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {analysis.matched.length ? analysis.matched.map((s) => <Chip key={s} tone="mint">{s}</Chip>) : <span className="text-[12px] text-chrome-600">None detected</span>}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[12px] text-chrome-400">To learn or explain ({analysis.missing.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {analysis.missing.length ? analysis.missing.map((s) => <Chip key={s} tone="rose">{s}</Chip>) : <span className="text-[12px] text-chrome-600">Nothing missing</span>}
              </div>
            </div>
            {analysis.languages.length > 0 && (
              <div className="md:col-span-2">
                <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-chrome-400">
                  <Languages size={13} /> Languages
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.languages.map((l) => {
                    const mine = profileLanguageLevel(settings.profile, l.lang);
                    const weak = l.level === "required" && mine !== null && LEVELS.indexOf(mine.slice(-2)) < LEVELS.indexOf("B2");
                    return (
                      <Chip key={l.lang} tone={weak ? "amber" : "neutral"}>
                        {weak && <TriangleAlert size={11} />}
                        {l.lang} {l.level === "plus" ? "· a plus" : "· required"}
                        {mine && <span className="text-chrome-500">(you: {mine})</span>}
                      </Chip>
                    );
                  })}
                </div>
              </div>
            )}
            {analysis.seniorSignals.length > 0 && (
              <div className="md:col-span-2 text-[12px] text-chrome-500">
                Seniority signals: <span className="text-chrome-300">{analysis.seniorSignals.join(", ")}</span>
              </div>
            )}
          </div>
        )}
      </Panel>

      <div>
        <SectionTitle
          right={
            loadable && (
              <Button size="sm" variant="ghost" icon={<RotateCw size={12} className={loadState === "loading" ? "animate-spin" : ""} />} onClick={onReload}>
                Reload
              </Button>
            )
          }
        >
          Posting
        </SectionTitle>
        {loadState === "loading" && (
          <div className="space-y-2.5">
            {[90, 70, 85, 60, 75, 50].map((w, i) => (
              <div key={i} className="skeleton h-3" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {loadState !== "loading" && description !== undefined && description.trim() && <PostingText text={description} />}
        {loadState !== "loading" && (description === undefined || !description.trim()) && (
          <Panel className="space-y-3 p-4">
            <p className="text-[13px] text-chrome-400">
              {loadError || (loadable ? "This posting has no text." : "This posting is hosted on the company's site, which the app can't read.")} Open it and paste the
              text here to get a fit check and a better AI prompt.
            </p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste the job posting…"
              className="chrome-border h-40 w-full resize-none rounded-lg bg-void p-3 text-[13px] text-chrome-100 outline-none"
            />
            <div className="flex gap-2">
              <Button variant="chrome" size="sm" disabled={!draft.trim()} onClick={() => onPaste(draft)}>
                Save posting text
              </Button>
              <Button size="sm" icon={<ExternalLink size={12} />} onClick={() => openUrl(job.apply_url ?? job.url)}>
                Open posting
              </Button>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

/** Renders posting text with headings and bullet lists. */
function PostingText({ text }: { text: string }) {
  // Normalise the many bullet styles postings use to "- ".
  const lines = text.split("\n").map((l) => l.replace(/^[•▪◦·*–—►✓✔-]\s*/, "- "));
  return (
    <div className="selectable space-y-1.5 text-[13.5px] leading-relaxed text-chrome-200">
      {lines.map((line, i) => {
        if (line.startsWith("- ")) {
          return (
            <div key={i} className="flex gap-2.5 pl-1">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-chrome-500" />
              <span>{line.slice(2)}</span>
            </div>
          );
        }
        const heading = line.length < 60 && !/[.,:;]$/.test(line) && (line === line.toUpperCase() || /^(dein|ihr|your|what|was|wir|we |deine|i tuoi|cosa|requisiti|profil|aufgaben|tasks|requirements|offriamo|benefits)/i.test(line));
        return heading ? (
          <h4 key={i} className="pt-4 text-[12px] font-semibold uppercase tracking-[0.12em] text-chrome-50 first:pt-0">
            {line}
          </h4>
        ) : (
          <p key={i}>{line}</p>
        );
      })}
    </div>
  );
}

function AiTab({
  job,
  settings,
  description,
  analysis,
  onPaste,
  initialKind,
  onKindUsed,
}: {
  job: Job;
  settings: Settings;
  description: string;
  analysis: Analysis;
  onPaste: (t: string) => void;
  initialKind: string | null;
  onKindUsed: () => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<string>(initialKind && (KINDS as readonly string[]).includes(initialKind) ? initialKind : KINDS[0]);
  useEffect(() => {
    // Consume the preset once.
    if (initialKind) onKindUsed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [language, setLanguage] = useState<string>(LANGUAGES[0]);
  const [tone, setTone] = useState<string>(TONES[0]);
  const [notes, setNotes] = useState("");
  const prompt = buildPrompt(settings.profile, job, description, description ? analysis : null, { kind, language, tone, notes });

  async function copy(openTo?: string) {
    await navigator.clipboard.writeText(prompt);
    toast(openTo ? "Prompt copied, paste it into the chat" : "Prompt copied");
    if (openTo) openUrl(openTo);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Panel className="p-5">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="chrome-face flex h-8 w-8 items-center justify-center rounded-lg">
            <Bot size={16} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-chrome-50">AI writing prompt</div>
            <div className="text-[12px] text-chrome-500">Your profile + this posting + honesty rules, ready for ChatGPT, Claude or Gemini.</div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Write a">
            <PillSelect value={kind} onChange={setKind} options={KINDS} />
          </Field>
          <Field label="Language">
            <PillSelect value={language} onChange={setLanguage} options={LANGUAGES} />
          </Field>
          <Field label="Tone">
            <PillSelect value={tone} onChange={setTone} options={TONES} />
          </Field>
        </div>
        <Field label="Extra notes (optional)" className="mt-3">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. I can start immediately, mention the hospitality angle"
            className="chrome-border h-9 w-full rounded-lg bg-void px-3 text-[13px] outline-none placeholder:text-chrome-600"
          />
        </Field>
        {!description && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber/25 bg-amber/5 px-3 py-2 text-[12px] text-amber">
            <TriangleAlert size={13} /> No posting text yet. The prompt will be generic; paste the posting in Overview for a tailored result.
            <button className="ml-auto underline" onClick={async () => onPaste(await navigator.clipboard.readText())}>
              Paste from clipboard
            </button>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="chrome" icon={<ClipboardCopy size={14} />} onClick={() => copy()}>
            Copy prompt
          </Button>
          <Button onClick={() => copy("https://chatgpt.com/")}>Copy + ChatGPT</Button>
          <Button onClick={() => copy("https://claude.ai/new")}>Copy + Claude</Button>
          <Button onClick={() => copy("https://gemini.google.com/app")}>Copy + Gemini</Button>
        </div>
      </Panel>

      <div>
        <SectionTitle right={<span className="text-[11px] text-chrome-600 tabular-nums">{prompt.length.toLocaleString()} chars</span>}>Preview</SectionTitle>
        <pre className="chrome-border selectable max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-base p-4 font-mono text-[11.5px] leading-relaxed text-chrome-300">
          {prompt}
        </pre>
      </div>
    </div>
  );
}


function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[11px] font-medium text-chrome-500">{label}</span>
      {children}
    </label>
  );
}

function PillSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="chrome-border h-9 w-full rounded-lg bg-void px-2.5 text-[13px] text-chrome-100 outline-none">
      {options.map((o) => (
        <option key={o} value={o} className="bg-elevated">
          {o}
        </option>
      ))}
    </select>
  );
}
