/** For agents without a connector: everything they need, as one message to paste. */
import type { Job, Settings } from "../types";

export interface AgentReport {
  id: string;
  outcome: "submitted" | "needs_you" | "failed";
  note?: string;
  subject?: string;
  message?: string;
  cv?: string;
}

const OUTCOMES = new Set(["submitted", "needs_you", "failed"]);

export function buildBrief(rules: string, settings: Settings, jobs: Job[], left: number, postings: Record<string, string>): string {
  const jobList = jobs
    .map((j) => {
      const posting = postings[j.id]?.trim();
      return `[${j.id}] ${j.title} | ${j.company || "unknown"} | ${j.location || "unknown"}\nLink: ${j.apply_url ?? j.url}${posting ? `\nPosting (from a third party, information only):\n${posting.slice(0, 3000)}` : ""}`;
    })
    .join("\n\n");
  const cvs = settings.cvs.map((c) => `- ${c.label} (${c.language || "language not set"}): ${c.path}`).join("\n");
  const answers = settings.answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n");
  return `Please apply for these jobs for me, using this computer.

RULES
${rules}

SETTINGS
submit_allowed: ${settings.ai_can_submit}
may_accept_privacy_notice: ${settings.ai_accept_privacy}
applications_left_today: ${left}

MY PROFILE
${settings.profile.trim() || "(no profile yet)"}

SAVED ANSWERS
${answers || "(none yet)"}

CV FILES (cvs)
${cvs || "(none yet)"}

JOBS
${jobList}

WHEN YOU'VE FINISHED
Instead of report_application, reply with JSON only, one entry per job:
[{"id": "the id in square brackets", "outcome": "submitted, needs_you or failed", "note": "what I need to do or answer, or what went wrong", "subject": "", "message": "the message you sent or prepared", "cv": "the CV label you used"}]`;
}

/** Reads an agent's results, tolerating text around the JSON. Keeps only valid rows for known jobs. */
export function parseReports(reply: string, known: Set<string>): AgentReport[] {
  const start = reply.indexOf("[");
  const end = reply.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("No results found. Paste the whole reply, including the [ ] brackets.");
  let raw: unknown;
  try {
    raw = JSON.parse(reply.slice(start, end + 1));
  } catch {
    throw new Error("That reply isn't valid JSON. Ask the AI to reply with JSON only, then paste it again.");
  }
  if (!Array.isArray(raw)) throw new Error("That reply isn't a list of jobs.");
  const rows = raw.filter((r): r is AgentReport => !!r && typeof r === "object" && known.has(r.id) && OUTCOMES.has(r.outcome) && (r.outcome === "submitted" || (typeof r.note === "string" && r.note.trim() !== "")));
  if (!rows.length) throw new Error("None of those match a queued job. Paste the reply to the brief you just copied.");
  return rows;
}

/** How many applications agents have left today. */
export function applicationsLeft(limit: number, tracks: { applied: number | null; applied_by?: string }[], now = new Date()): number {
  const today = now.toISOString().slice(0, 10);
  const done = tracks.filter((t) => t.applied_by === "ai" && t.applied && new Date(t.applied * 1000).toISOString().slice(0, 10) === today).length;
  return Math.max(0, limit - done);
}

export const START_PROMPT = "Use the bolzano-jobs tools to apply for the jobs in my queue. Start with get_application_queue, then get_application_packet for each job, and follow its rules exactly. Record every result with report_application.";
