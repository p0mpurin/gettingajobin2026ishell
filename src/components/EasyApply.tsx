import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, CircleStop, Hand, Loader2, Minimize2, RotateCw, Send, ShieldAlert, Sparkles, X } from "lucide-react";
import { t } from "../lib/i18n";
import type { Job, Settings, Track } from "../types";
import { api, type ApplyOutcome } from "../lib/api";
import { Button, Chip } from "./ui";

interface LogLine {
  kind: string;
  text: string;
}

const NEXT_JOB_DELAY = 2500;

/**
 * The live view: what the AI is doing on the left, the real page on the right.
 * The page is a real webview laid over the empty area, so the user can step in
 * and type or click at any moment.
 */
export function EasyApply({
  ids,
  jobsById,
  tracks,
  settings,
  onSaveSettings,
  onUpdate,
  onChanged,
  onClose,
}: {
  ids: string[];
  jobsById: Record<string, Job>;
  tracks: Record<string, Track>;
  settings: Settings;
  onSaveSettings: (s: Settings) => Promise<void>;
  onUpdate: (job: Job, patch: Partial<Track>) => Promise<void>;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [log, setLog] = useState<LogLine[]>([]);
  const [status, setStatus] = useState("Starting");
  const [result, setResult] = useState<ApplyOutcome | null>(null);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const job = jobsById[ids[index]];
  const running = !result && !error;

  const bounds = () => {
    const r = host.current!.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };

  // Keep the page exactly over its area as the window changes.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const place = () => api.browserPlace(bounds()).catch(() => {});
    const obs = new ResizeObserver(place);
    obs.observe(el);
    window.addEventListener("resize", place);
    return () => {
      obs.disconnect();
      window.removeEventListener("resize", place);
    };
  }, []);

  useEffect(() => {
    const un = listen<LogLine>("apply-event", (e) => {
      if (e.payload.kind === "status") setStatus(e.payload.text);
      else setLog((l) => [...l.slice(-200), e.payload]);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [log.length]);

  // Run one job. A new attempt or the next job starts this again.
  useEffect(() => {
    if (!job) return;
    let live = true;
    setResult(null);
    setError("");
    setStatus("Starting");
    api
      .applyStart(job.id, bounds())
      .then((r) => {
        if (!live) return;
        setResult(r);
        onChanged();
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, attempt]);

  // In a queue, move on by itself after anything that went out.
  useEffect(() => {
    if (result?.outcome !== "submitted" || index >= ids.length - 1) return;
    const t = setTimeout(() => {
      setLog([]);
      setIndex((i) => i + 1);
    }, NEXT_JOB_DELAY);
    return () => clearTimeout(t);
  }, [result, index, ids.length]);

  async function close() {
    await api.applyStop().catch(() => {});
    await api.browserClose().catch(() => {});
    onClose();
  }

  function nextJob() {
    setLog([]);
    setAnswer("");
    setIndex((i) => i + 1);
  }

  async function saveAnswerAndRetry() {
    const question = result?.note ?? "";
    await onSaveSettings({ ...settings, answers: [...settings.answers.filter((a) => a.question !== question), { question, answer: answer.trim() }] });
    setAnswer("");
    setAttempt((n) => n + 1);
  }

  async function iFinished() {
    if (job) await onUpdate(job, { status: "applied", needs_you: "", queued: false });
    if (index < ids.length - 1) nextJob();
    else close();
  }

  const isQuestion = result?.note.trim().endsWith("?");
  const hasNext = index < ids.length - 1;
  void tracks;

  return (
    <div className="absolute inset-x-0 bottom-0 top-12 z-30 flex bg-void">
      <aside className="flex w-[330px] shrink-0 flex-col border-r border-line bg-base">
        <div className="border-b border-line p-4">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-chrome-300" />
            <span className="chrome-text text-[14px] font-semibold">Easy Apply</span>
            {ids.length > 1 && (
              <span className="text-[12px] tabular-nums text-chrome-500">
                {index + 1} of {ids.length}
              </span>
            )}
            <button onClick={close} aria-label="Close" className="ml-auto text-chrome-500 transition hover:text-chrome-50">
              <X size={16} />
            </button>
          </div>
          <div className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug text-chrome-50">{job?.title}</div>
          <div className="truncate text-[12px] text-chrome-500">{job?.company}</div>
          <div className="mt-2.5 flex flex-wrap gap-1">
            <Chip tone={settings.ai_can_submit ? "mint" : "neutral"}>{settings.ai_can_submit ? "Submits for you" : "You press submit"}</Chip>
            <Chip tone={settings.ai_accept_privacy ? "mint" : "neutral"}>{settings.ai_accept_privacy ? "Accepts privacy notices" : "You accept privacy notices"}</Chip>
            {settings.do_not_disturb && <Chip tone="violet">{t("Do Not Disturb")}</Chip>}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-4 text-[12.5px] leading-relaxed">
          {log.map((l, i) =>
            l.kind === "blocked" ? (
              <div key={i} className="animate-rise flex gap-1.5 text-amber">
                <ShieldAlert size={13} className="mt-0.5 shrink-0" /> <span className="selectable min-w-0">{l.text}</span>
              </div>
            ) : l.kind === "thought" ? (
              <div key={i} className="animate-rise selectable whitespace-pre-wrap text-chrome-400">
                {l.text}
              </div>
            ) : (
              <div key={i} className="animate-rise flex gap-1.5 text-chrome-200">
                <Check size={13} className="mt-0.5 shrink-0 text-mint" /> <span className="selectable min-w-0">{l.text}</span>
              </div>
            ),
          )}
          {running && (
            <div className="flex items-center gap-2 text-chrome-500">
              <Loader2 size={13} className="animate-spin" /> {status}…
            </div>
          )}
          <div ref={logEnd} />
        </div>

        <div className="space-y-2 border-t border-line p-4">
          {running && (
            <div className="flex gap-2">
              <Button className="flex-1" icon={<CircleStop size={14} />} onClick={() => api.applyStop()}>
                Stop the AI
              </Button>
              <Button variant="ghost" icon={<Minimize2 size={14} />} title="Minimizes the window. It keeps working and won't take focus." onClick={() => getCurrentWindow().minimize()}>
                {t("Run in background")}
              </Button>
            </div>
          )}
          {error && (
            <>
              <p className="selectable text-[12.5px] leading-relaxed text-rose">{error}</p>
              <Button className="w-full" icon={<RotateCw size={14} />} onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            </>
          )}
          {result?.outcome === "submitted" && (
            <div className="animate-rise rounded-xl border border-mint/25 bg-mint/[0.06] p-3 text-[13px] text-mint">
              <div className="flex items-center gap-1.5 font-semibold">
                <Send size={13} /> Application sent
              </div>
              <div className="mt-0.5 text-[12px] text-chrome-400">{hasNext ? "Moving to the next job…" : "It's in your pipeline, with a picture of the confirmation saved."}</div>
            </div>
          )}
          {result && result.outcome !== "submitted" && (
            <div className="animate-rise space-y-2">
              <div className="rounded-xl border border-amber/25 bg-amber/[0.06] p-3 text-[12.5px] leading-relaxed text-amber">
                <div className="mb-0.5 flex items-center gap-1.5 font-semibold">
                  <Hand size={13} /> Your turn
                </div>
                <span className="selectable">{result.note}</span>
              </div>
              {isQuestion && (
                <form
                  className="flex gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (answer.trim()) saveAnswerAndRetry();
                  }}
                >
                  <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" className="chrome-border h-8 min-w-0 flex-1 rounded-lg bg-void px-2.5 text-[12.5px] text-chrome-100 outline-none placeholder:text-chrome-600" />
                  <Button type="submit" size="sm" disabled={!answer.trim()}>
                    Continue
                  </Button>
                </form>
              )}
              <p className="text-[11.5px] text-chrome-600">The page on the right is live: you can finish it there yourself.</p>
              <Button variant="chrome" className="w-full" icon={<Check size={14} />} onClick={iFinished}>
                I sent it
              </Button>
            </div>
          )}
          {!running && hasNext && result?.outcome !== "submitted" && (
            <Button className="w-full" onClick={nextJob}>
              Skip to the next job
            </Button>
          )}
          {!running && !hasNext && (
            <Button variant="ghost" className="w-full" onClick={close}>
              Close
            </Button>
          )}
        </div>
      </aside>
      {/* The webview sits exactly over this empty area. */}
      <div ref={host} className="min-w-0 flex-1 bg-white/[0.02]" />
    </div>
  );
}
