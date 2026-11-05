import { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, Check, ClipboardCopy, ExternalLink, Loader2, Mail, RotateCw, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import type { Job, Settings, Track } from "../types";
import type { Analysis } from "../lib/match";
import { buildPrompt, LANGUAGES, TONES } from "../lib/prompt";
import { buildRankPrompt, findApplyEmail, mailtoLink, parseRankReply } from "../lib/gpt";
import { api, type Tailored } from "../lib/api";
import { Button, Modal, useToast } from "./ui";

const field = "chrome-border h-9 w-full rounded-lg bg-void px-3 text-[13px] text-chrome-100 outline-none placeholder:text-chrome-600";

/**
 * The review screen. Whatever wrote the draft (the user, ChatGPT, the assistant,
 * another AI tool), an application only goes out after a person reads it here
 * and sends it from their own email or the employer's site.
 */
export function ApplyModal({
  job,
  track,
  settings,
  posting,
  analysis,
  onSave,
  onClose,
}: {
  job: Job;
  track?: Track;
  settings: Settings;
  posting: string;
  analysis: Analysis | null;
  onSave: (patch: Partial<Track>) => Promise<void>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [to, setTo] = useState(track?.draft_to || track?.contact?.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i)?.[0] || findApplyEmail(posting));
  const [subject, setSubject] = useState(track?.draft_subject || `Application: ${job.title}`);
  const [message, setMessage] = useState(track?.draft_message ?? "");
  const [cv, setCv] = useState(track?.draft_cv || track?.cv || "");
  const fromAi = !!track?.draft_message;

  async function copy(text: string, note: string) {
    await navigator.clipboard.writeText(text);
    toast(note);
  }

  async function saveDraft() {
    await onSave({ draft_to: to, draft_subject: subject, draft_message: message, draft_cv: cv });
    toast("Draft saved");
    onClose();
  }

  async function copyPrompt() {
    const prompt = buildPrompt(settings.profile, job, posting, analysis, { kind: "Application email", language: LANGUAGES[0], tone: TONES[0], notes: "" });
    await copy(prompt, "Prompt copied. Paste it into ChatGPT, then paste the answer here.");
    openUrl("https://chatgpt.com/");
  }

  async function openEmail() {
    const { url, fits } = mailtoLink(to, subject, message);
    if (!fits) await copy(message, "Message copied. It's too long for a mail link, so paste it into the email.");
    await openUrl(url);
  }

  async function openPage() {
    if (message.trim()) await copy(message, "Message copied, ready to paste into the application");
    await openUrl(job.apply_url ?? job.url);
  }

  async function markApplied() {
    await onSave({
      status: "applied",
      sent_message: subject.trim() ? `Subject: ${subject.trim()}\n\n${message}` : message,
      cv,
      contact: track?.contact || to,
      queued: false,
      needs_you: "",
      draft_to: "",
      draft_subject: "",
      draft_message: "",
      draft_cv: "",
    });
    toast("Marked as applied. Good luck!");
    onClose();
  }

  return (
    <Modal title={`Prepare application · ${job.title}`} onClose={onClose} width="max-w-2xl">
      <div className="space-y-3">
        {fromAi && (
          <div className="flex items-center gap-2 rounded-lg border border-sky/25 bg-sky/[0.06] px-3 py-2 text-[12.5px] text-sky">
            <Sparkles size={13} className="shrink-0" /> Check this draft before sending. Make sure every fact about you is true.
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[12px] text-chrome-500">
            To
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Not in the posting" className={`${field} mt-1`} />
          </label>
          <label className="block text-[12px] text-chrome-500">
            CV to attach
            <input value={cv} onChange={(e) => setCv(e.target.value)} placeholder="e.g. English CV" className={`${field} mt-1`} />
          </label>
        </div>
        <label className="block text-[12px] text-chrome-500">
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className={`${field} mt-1`} />
        </label>
        <label className="block text-[12px] text-chrome-500">
          <span className="flex items-center">
            Message
            {!message && (
              <button onClick={copyPrompt} className="ml-auto flex items-center gap-1 text-chrome-300 transition hover:text-chrome-50">
                <Sparkles size={11} /> Write it with ChatGPT <ArrowUpRight size={11} />
              </button>
            )}
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write your message, or get one from ChatGPT and paste it here."
            className="chrome-border selectable mt-1 h-56 w-full resize-none rounded-lg bg-void p-3 text-[13px] leading-relaxed text-chrome-100 outline-none placeholder:text-chrome-600"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!to.trim()} icon={<Mail size={14} />} onClick={openEmail} title={to.trim() ? "Opens a draft in your email app" : "Add an email address first"}>
            Open email draft
          </Button>
          <Button icon={<ExternalLink size={14} />} onClick={openPage}>
            Open application page
          </Button>
          <Button variant="ghost" disabled={!message} icon={<ClipboardCopy size={14} />} onClick={() => copy(message, "Message copied")}>
            Copy
          </Button>
        </div>
        <p className="text-[11.5px] leading-relaxed text-chrome-600">The app never sends for you. Email drafts can't attach files, so add your CV before you send.</p>

        <div className="flex items-center gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <div className="ml-auto flex gap-2">
            <Button onClick={saveDraft}>Save draft</Button>
            <Button variant="chrome" icon={<Check size={14} />} onClick={markApplied}>
              I've sent it
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Writes a CV for one job and shows it, with whatever the fact check took out. */
export function TailorModal({ job, onDone, onClose }: { job: Job; onDone: () => void; onClose: () => void }) {
  const [result, setResult] = useState<Tailored | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  const run = useCallback(async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await api.tailorCv(job.id));
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  useEffect(() => {
    run();
  }, [run]);

  return (
    <Modal title={`Tailored CV · ${job.title}`} onClose={onClose} width="max-w-3xl">
      <div className="space-y-3">
        {busy && (
          <div className="flex h-40 items-center justify-center gap-2.5 text-[13px] text-chrome-400">
            <Loader2 size={15} className="animate-spin" /> Your AI is writing it, and it'll be checked against your documents…
          </div>
        )}
        {error && <p className="selectable text-[13px] leading-relaxed text-rose">{error}</p>}
        {result && (
          <>
            {result.removed.length > 0 && (
              <div className="rounded-lg border border-amber/25 bg-amber/[0.05] px-3 py-2 text-[12px] leading-relaxed text-amber">
                <div className="mb-0.5 flex items-center gap-1.5 font-semibold">
                  <ShieldAlert size={13} /> Taken out because it isn't in your documents
                </div>
                {result.removed.slice(0, 8).map((r) => (
                  <div key={r} className="selectable">{r}</div>
                ))}
              </div>
            )}
            {/* The AI's text is shown with scripts off: sandbox with no permissions. */}
            <iframe title="Tailored CV preview" sandbox="" srcDoc={result.html} className="h-[56vh] w-full rounded-lg bg-white" />
            <p className="text-[11.5px] leading-relaxed text-chrome-600">Read it before it goes out. Facts are checked, but rewording and translation can't be checked automatically. Easy Apply will use this CV for this job.</p>
          </>
        )}
        <div className="flex items-center gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <div className="ml-auto flex gap-2">
            <Button disabled={busy} icon={<RotateCw size={13} />} onClick={run}>
              Write it again
            </Button>
            {result && (
              <Button variant="chrome" icon={<ExternalLink size={14} />} onClick={() => api.openTailored(result.path)}>
                Open PDF
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Jobs an AI gets to look at in one go. */
const RANK_JOBS = 40;

/** Ask ChatGPT (or anything else) to rank the feed, by copy and paste. */
export function GptRankModal({
  jobs,
  settings,
  postings,
  hasRanks,
  onImported,
  onClose,
}: {
  jobs: Job[];
  settings: Settings;
  postings: Record<string, string>;
  hasRanks: boolean;
  onImported: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const top = useMemo(() => jobs.slice(0, RANK_JOBS), [jobs]);

  // Ranking doesn't need contact details, so they stay out of the clipboard.
  const profile = settings.profile.split("\n").filter((l) => !/^contact:/i.test(l)).join("\n");

  async function copyPrompt() {
    await navigator.clipboard.writeText(buildRankPrompt(profile, top, postings));
    setCopied(true);
    toast("Prompt copied");
  }

  async function importReply() {
    setError("");
    try {
      const rows = parseRankReply(reply, new Set(top.map((j) => j.id)));
      const { stored } = await api.importAiRanks(rows);
      toast(`Your feed now uses ${stored} AI rankings`);
      onImported();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal title="Rank your feed with ChatGPT" onClose={onClose} width="max-w-xl">
      <div className="space-y-4 text-[13px] text-chrome-300">
        <div>
          <div className="font-medium text-chrome-100">1. Copy the prompt</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-chrome-500">It holds your profile without your contact details, and your top {top.length} jobs. You decide where to paste it.</p>
          <div className="mt-2 flex gap-2">
            <Button variant={copied ? "outline" : "chrome"} icon={copied ? <Check size={14} /> : <ClipboardCopy size={14} />} disabled={!top.length} onClick={copyPrompt}>
              {copied ? "Copied" : "Copy prompt"}
            </Button>
            <Button icon={<ArrowUpRight size={14} />} onClick={() => openUrl("https://chatgpt.com/")}>
              Open ChatGPT
            </Button>
          </div>
        </div>
        <div>
          <div className="font-medium text-chrome-100">2. Paste the answer</div>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Paste the whole reply here…"
            className="chrome-border selectable mt-2 h-32 w-full resize-none rounded-lg bg-void p-3 font-mono text-[12px] text-chrome-100 outline-none placeholder:text-chrome-600"
          />
          {error && <p className="mt-1 text-[12.5px] text-rose">{error}</p>}
        </div>
        <div className="flex items-center gap-2">
          {hasRanks && (
            <Button
              variant="ghost"
              icon={<Trash2 size={13} />}
              onClick={async () => {
                await api.clearAiRanks();
                toast("AI rankings cleared");
                onImported();
                onClose();
              }}
            >
              Clear AI rankings
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="chrome" disabled={!reply.trim()} onClick={importReply}>
              Use this ranking
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
