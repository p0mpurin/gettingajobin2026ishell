import { useEffect, useMemo, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertCircle, Check, ClipboardCopy, ExternalLink, FileText, Hand, ListPlus, Plug, Plus, Rocket, Send, Trash2, X } from "lucide-react";
import type { CvFile, Job, Settings, Track } from "../types";
import type { Fit } from "../lib/foryou";
import { api } from "../lib/api";
import { applicationsLeft, buildBrief, parseReports, START_PROMPT } from "../lib/autopilot";
import { Button, Chip, Panel, SectionTitle, useToast } from "./ui";
import { InboxPanel } from "./InboxPanel";
import { t } from "../lib/i18n";

const LANGUAGES = ["English", "Italian", "German", "Other"];
const QUEUE_BATCH = 5;
/** Applying costs goodwill, so weak matches never get queued in bulk. */
const QUEUE_MIN_FIT = 50;
const input = "chrome-border h-8 rounded-lg bg-void px-2.5 text-[12.5px] text-chrome-100 outline-none placeholder:text-chrome-600";

export function AutopilotView({
  settings,
  tracks,
  jobs,
  jobsById,
  fits,
  postings,
  onSaveSettings,
  onUpdate,
  onChanged,
  onRunHere,
}: {
  settings: Settings;
  tracks: Record<string, Track>;
  /** Every live job. */
  jobs: Job[];
  jobsById: Record<string, Job>;
  fits: Record<string, Fit>;
  postings: Record<string, string>;
  onSaveSettings: (s: Settings) => Promise<void>;
  onUpdate: (job: Job, patch: Partial<Track>) => Promise<void>;
  onChanged: () => void;
  /** Runs jobs in the app's own live webview. */
  onRunHere: (ids: string[]) => void;
}) {
  const toast = useToast();
  const [rules, setRules] = useState("");
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sites, setSites] = useState<Record<string, { runs: number; sent: number; handed_over: number; has_captcha: boolean }>>({});
  useEffect(() => {
    api.autopilotRules().then((r) => setRules(r ?? "")).catch(() => {});
    api.siteMemory().then((m) => setSites(m ?? {})).catch(() => {});
  }, []);

  const rows = Object.entries(tracks);
  const queue = rows.filter(([, t]) => t.queued);
  const needsYou = rows.filter(([, t]) => t.needs_you);
  const done = rows.filter(([, t]) => t.applied_by === "ai").sort((a, b) => (b[1].applied ?? 0) - (a[1].applied ?? 0));
  const left = applicationsLeft(settings.ai_daily_limit, Object.values(tracks));
  const queuedJobs = useMemo(() => queue.map(([id]) => jobsById[id]).filter(Boolean), [queue, jobsById]);

  const set = (patch: Partial<Settings>) => onSaveSettings({ ...settings, ...patch });

  async function addTop() {
    const best = jobs
      .filter((j) => fits[j.id]?.relevant && (fits[j.id]?.score ?? 0) >= QUEUE_MIN_FIT && (!tracks[j.id] || (tracks[j.id].status === "saved" && !tracks[j.id].queued && !tracks[j.id].needs_you)))
      .sort((a, b) => (fits[b.id]?.score ?? 0) - (fits[a.id]?.score ?? 0))
      .slice(0, QUEUE_BATCH);
    for (const j of best) await onUpdate(j, { queued: true });
    toast(best.length ? `Added your top ${best.length} matches` : "No more good matches to add", best.length ? "ok" : "info");
  }

  async function addCv() {
    const path = await open({ title: "Choose a CV", multiple: false, directory: false, filters: [{ name: "CV", extensions: ["pdf", "doc", "docx"] }] });
    if (!path || Array.isArray(path)) return;
    const name = path.split(/[\\/]/).pop() ?? "CV";
    const guess = /_DE\b|deutsch|german/i.test(name) ? "German" : /_IT\b|italian/i.test(name) ? "Italian" : /_EN\b|english/i.test(name) ? "English" : "Other";
    await set({ cvs: [...settings.cvs, { label: name.replace(/\.\w+$/, ""), language: guess, path }] });
  }
  const setCv = (i: number, patch: Partial<CvFile>) => set({ cvs: settings.cvs.map((c, n) => (n === i ? { ...c, ...patch } : c)) });

  async function answer(id: string, track: Track) {
    const text = answers[id]?.trim();
    if (!text) return;
    // Saved first: the job then goes back in the queue with the answer available.
    const question = track.needs_you ?? "";
    await set({ answers: [...settings.answers.filter((a) => a.question !== question), { question, answer: text }] });
    const job = jobsById[id];
    if (job) await onUpdate(job, { needs_you: "", queued: true });
    setAnswers((a) => ({ ...a, [id]: "" }));
    toast("Answer saved, job back in the queue");
  }

  async function copy(text: string, note: string) {
    await navigator.clipboard.writeText(text);
    toast(note);
  }

  async function importReply() {
    setReplyError("");
    try {
      const reports = parseReports(reply, new Set(queue.map(([id]) => id)));
      const n = await api.importReports(reports);
      setReply("");
      toast(`Recorded ${n} result${n === 1 ? "" : "s"}`);
      onChanged();
    } catch (e) {
      setReplyError(e instanceof Error ? e.message : String(e));
    }
  }

  const noCv = settings.cvs.length === 0;

  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-void">
      <div className="sticky top-0 z-10 flex items-center border-b border-line bg-void/90 px-7 py-5 backdrop-blur">
        <div>
          <h1 className="chrome-text text-[22px] font-semibold tracking-tight">{t("Autopilot")}</h1>
          <p className="mt-1 text-[13px] text-chrome-500">Let Claude or GPT apply for you, using your computer. This app tells them what to send and keeps track.</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[12px] tabular-nums text-chrome-400">
          <Chip tone={left > 0 ? "neutral" : "amber"}>{left} left today</Chip>
        </div>
      </div>

      <div className="mx-auto max-w-[900px] space-y-5 px-7 py-6">
        {needsYou.length > 0 && (
          <Panel className="space-y-3 p-5">
            <SectionTitle>Needs you · {needsYou.length}</SectionTitle>
            {needsYou.map(([id, t]) => {
              const isQuestion = (t.needs_you ?? "").trim().endsWith("?");
              return (
                <div key={id} className="rounded-xl border border-amber/20 bg-amber/[0.04] p-3.5">
                  <div className="flex items-start gap-2.5">
                    <Hand size={15} className="mt-0.5 shrink-0 text-amber" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-chrome-50">
                        {t.title} <span className="font-normal text-chrome-500">· {t.company}</span>
                      </div>
                      <div className="selectable mt-1 text-[12.5px] leading-relaxed text-chrome-200">{t.needs_you}</div>
                    </div>
                  </div>
                  {isQuestion && (
                    <form
                      className="mt-2.5 flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        answer(id, t);
                      }}
                    >
                      <input value={answers[id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [id]: e.target.value }))} placeholder="Your answer. It's saved for future forms" className={`${input} flex-1`} />
                      <Button type="submit" size="sm" disabled={!answers[id]?.trim()}>
                        Save and retry
                      </Button>
                    </form>
                  )}
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <Button size="sm" icon={<Rocket size={12} />} onClick={() => onRunHere([id])}>
                      Easy Apply
                    </Button>
                    <Button size="sm" icon={<ExternalLink size={12} />} onClick={() => openUrl(t.apply_url ?? t.url)}>
                      Open form
                    </Button>
                    <Button
                      size="sm"
                      icon={<Check size={12} />}
                      onClick={() => {
                        const job = jobsById[id];
                        if (job) onUpdate(job, { status: "applied", needs_you: "", queued: false });
                      }}
                    >
                      I finished it
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<X size={12} />}
                      onClick={() => {
                        const job = jobsById[id];
                        if (job) onUpdate(job, { needs_you: "" });
                      }}
                    >
                      Skip this job
                    </Button>
                  </div>
                </div>
              );
            })}
          </Panel>
        )}

        <Panel className="space-y-3 p-5">
          <SectionTitle
            right={
              <Button size="sm" icon={<ListPlus size={12} />} onClick={addTop}>
                Add my top {QUEUE_BATCH}
              </Button>
            }
          >
            Queue · {queue.length}
          </SectionTitle>
          {queue.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-chrome-500">Nothing queued. Add your top matches, or use "Add to Autopilot" on any job.</p>
          ) : (
            <div className="divide-y divide-line">
              {queue.map(([id, t]) => (
                <div key={id} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="w-8 shrink-0 text-center text-[11px] tabular-nums text-chrome-500">{fits[id]?.score ?? "–"}</span>
                  <span className="min-w-0 flex-1 truncate text-chrome-100">
                    {t.title} <span className="text-chrome-500">· {t.company}</span>
                  </span>
                  <button
                    aria-label={`Remove ${t.title} from the queue`}
                    className="text-chrome-600 transition hover:text-chrome-100"
                    onClick={() => {
                      const job = jobsById[id];
                      if (job) onUpdate(job, { queued: false });
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel className="space-y-4 p-5">
          <SectionTitle>Start it</SectionTitle>
          {noCv && (
            <div className="flex items-center gap-2 rounded-lg border border-amber/25 bg-amber/[0.05] px-3 py-2 text-[12.5px] text-amber">
              <AlertCircle size={14} className="shrink-0" /> Add a CV below first, so there's something to upload.
            </div>
          )}
          <Way icon={<Rocket size={16} />} title="Right here" hint="Watch your connected AI work through the queue in a live window inside this app.">
            <Button size="sm" variant="chrome" icon={<Rocket size={12} />} disabled={!queue.length} onClick={() => onRunHere(queue.map(([id]) => id))}>
              Run the queue
            </Button>
          </Way>
          <Way icon={<Plug size={16} />} title="AI with a connector" hint="Claude Desktop, Cursor and other tools that support MCP and can control your computer. Add the connection once, then send the prompt. Results appear here by themselves.">
            <Button size="sm" icon={<ClipboardCopy size={12} />} onClick={async () => copy(await api.mcpConfig(), "Connection details copied")}>
              Copy connection details
            </Button>
            <Button size="sm" icon={<Rocket size={12} />} disabled={!queue.length} onClick={() => copy(START_PROMPT, "Prompt copied. Send it to your AI")}>
              Copy start prompt
            </Button>
          </Way>
          <Way icon={<Send size={16} />} title="Any other AI that can use your computer" hint="Such as a GPT agent. Copy the brief and give it to the AI. It includes your contact details and file paths, because it needs them to fill in forms. Paste the AI's results back here.">
            <Button size="sm" icon={<ClipboardCopy size={12} />} disabled={!queuedJobs.length || !rules} onClick={() => copy(buildBrief(rules, settings, queuedJobs, left, postings), "Brief copied")}>
              Copy brief
            </Button>
          </Way>
          {queue.length > 0 && (
            <div>
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Paste the AI's results here…"
                className="chrome-border selectable h-20 w-full resize-none rounded-lg bg-void p-3 font-mono text-[12px] text-chrome-100 outline-none placeholder:text-chrome-600"
              />
              {replyError && <p className="mt-1 text-[12.5px] text-rose">{replyError}</p>}
              <Button size="sm" className="mt-1.5" disabled={!reply.trim()} onClick={importReply}>
                Record results
              </Button>
            </div>
          )}
        </Panel>

        <Panel className="space-y-4 p-5">
          <SectionTitle>What the AI may do</SectionTitle>
          <Toggle
            label="Do Not Disturb"
            hint="The AI pauses, and nothing new opens, while a game or anything else runs full screen. It carries on when you're back."
            checked={settings.do_not_disturb}
            onChange={(v) => set({ do_not_disturb: v })}
          />
          <Toggle
            label="Morning queue"
            hint="The first time the app is open after 5am, your best new matches are lined up for one-tap approval, with tailored CVs if that's on. It can only prepare while the app is open."
            checked={settings.morning_queue}
            onChange={(v) => set({ morning_queue: v })}
          />
          <Toggle
            label="Write a tailored CV for each job"
            hint="Your AI rewrites your CV for the job, in the posting's language, using only your real documents. Anything it adds that isn't in them gets taken out, but read the first few: it can't check how things are reworded."
            checked={settings.ai_tailor_cv}
            onChange={(v) => set({ ai_tailor_cv: v })}
          />
          <Toggle
            label="Let it press the final submit button"
            hint="Off: it fills in the form and stops, and you submit. On: applications go out under your name without you reading them, so start with this off until you trust the results."
            checked={settings.ai_can_submit}
            onChange={(v) => set({ ai_can_submit: v })}
          />
          <Toggle
            label="Let it accept required privacy notices"
            hint="You agree to each employer's terms without reading them. Marketing and talent-pool boxes stay unticked."
            checked={settings.ai_accept_privacy}
            onChange={(v) => set({ ai_accept_privacy: v })}
          />
          <label className="flex items-center gap-3 text-[13px] text-chrome-100">
            Most applications per day
            <input
              type="number"
              min={1}
              max={50}
              value={settings.ai_daily_limit}
              onChange={(e) => set({ ai_daily_limit: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
              className={`${input} w-16`}
            />
          </label>
          <p className="text-[11.5px] leading-relaxed text-chrome-600">Captchas, logins and questions it can't answer from your profile always come back to you under Needs you.</p>
        </Panel>

        {Object.keys(sites).length > 0 && (
          <Panel className="space-y-1.5 p-5">
            <SectionTitle>What it has learned about sites</SectionTitle>
            {Object.entries(sites)
              .sort((a, b) => b[1].runs - a[1].runs)
              .slice(0, 8)
              .map(([host, s]) => (
                <div key={host} className="flex items-center gap-2 text-[12.5px] text-chrome-300">
                  <span className="min-w-0 flex-1 truncate">{host}</span>
                  {s.has_captcha && <Chip tone="amber">Captcha</Chip>}
                  <span className="shrink-0 tabular-nums text-chrome-500">
                    {s.sent} sent · {s.handed_over} handed to you
                  </span>
                </div>
              ))}
          </Panel>
        )}

        <InboxPanel settings={settings} tracks={tracks} onSaveSettings={onSaveSettings} onChanged={onChanged} />

        <Panel className="space-y-3 p-5">
          <SectionTitle
            right={
              <Button size="sm" icon={<Plus size={12} />} onClick={addCv}>
                Add CV
              </Button>
            }
          >
            Your CVs
          </SectionTitle>
          {noCv && <p className="text-[12.5px] text-chrome-500">The AI picks the one matching each posting's language, so add one per language.</p>}
          {settings.cvs.map((c, i) => (
            <div key={c.path} className="flex items-center gap-2">
              <FileText size={14} className="shrink-0 text-chrome-500" />
              <input aria-label="CV name" value={c.label} onChange={(e) => setCv(i, { label: e.target.value })} className={`${input} min-w-0 flex-1`} />
              <select aria-label="CV language" value={c.language} onChange={(e) => setCv(i, { language: e.target.value })} className={`${input} w-28`}>
                {LANGUAGES.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
              <button aria-label={`Remove ${c.label}`} className="text-chrome-600 transition hover:text-chrome-100" onClick={() => set({ cvs: settings.cvs.filter((_, n) => n !== i) })}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </Panel>

        {settings.answers.length > 0 && (
          <Panel className="space-y-2 p-5">
            <SectionTitle>Saved answers</SectionTitle>
            {settings.answers.map((a, i) => (
              <div key={a.question} className="flex items-start gap-2 text-[12.5px]">
                <div className="min-w-0 flex-1">
                  <div className="text-chrome-400">{a.question}</div>
                  <div className="text-chrome-100">{a.answer}</div>
                </div>
                <button aria-label="Delete answer" className="mt-0.5 text-chrome-600 transition hover:text-chrome-100" onClick={() => set({ answers: settings.answers.filter((_, n) => n !== i) })}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </Panel>
        )}

        {done.length > 0 && (
          <Panel className="space-y-2 p-5">
            <SectionTitle>Sent by AI · {done.length}</SectionTitle>
            {done.slice(0, 20).map(([id, t]) => (
              <div key={id} className="flex items-center gap-2 text-[12.5px] text-chrome-300">
                <Check size={13} className="shrink-0 text-mint" />
                <span className="min-w-0 flex-1 truncate">
                  {t.title} <span className="text-chrome-500">· {t.company}</span>
                </span>
                {t.cv && <span className="shrink-0 text-chrome-600">{t.cv}</span>}
              </div>
            ))}
          </Panel>
        )}
      </div>
    </div>
  );
}

function Way({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-chrome-300">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-chrome-50">{title}</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-chrome-500">{hint}</p>
        <div className="mt-2 flex flex-wrap gap-2">{children}</div>
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-start gap-3 text-left">
      <span className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${checked ? "chrome-face justify-end" : "justify-start bg-white/[0.1]"}`}>
        <span className={`h-4 w-4 rounded-full ${checked ? "bg-black/70" : "bg-chrome-400"}`} />
      </span>
      <span>
        <span className="block text-[13px] text-chrome-100">{label}</span>
        <span className="block text-[12px] leading-relaxed text-chrome-500">{hint}</span>
      </span>
    </button>
  );
}
