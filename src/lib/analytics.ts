/** What actually gets replies, from the user's own applications. */
import type { Track } from "../types";
import { FIELDS } from "./fields.ts";
import { isEveryday } from "./foryou.ts";

export interface Row {
  label: string;
  sent: number;
  replies: number;
  interviews: number;
}

const SENT = new Set(["applied", "interview", "offer", "rejected"]);
/** Below this a percentage says nothing, so the screen says so. */
export const ENOUGH = 5;

function tally(tracks: Track[], groupOf: (t: Track) => string): Row[] {
  const rows = new Map<string, Row>();
  for (const t of tracks) {
    const label = groupOf(t);
    const row = rows.get(label) ?? { label, sent: 0, replies: 0, interviews: 0 };
    row.sent += 1;
    const answered = t.status === "interview" || t.status === "offer" || t.status === "rejected" || (t.mails ?? []).some((m) => m.kind !== "received" && m.kind !== "other");
    if (answered) row.replies += 1;
    if (t.status === "interview" || t.status === "offer") row.interviews += 1;
    rows.set(label, row);
  }
  return [...rows.values()].sort((a, b) => b.sent - a.sent);
}

export function replyStats(all: Track[]) {
  const sent = all.filter((t) => SENT.has(t.status));
  return {
    total: sent.length,
    byCv: tally(sent, (t) => (t.tailored_cv ? "Tailored for the job" : t.cv?.trim() || "Not recorded")),
    byMessage: tally(sent, (t) => (t.applied_by === "ai" ? "Sent by AI" : t.sent_message?.trim() ? "Your own message" : "Not recorded")),
    byJob: tally(sent, (t) => (isEveryday(t.title) ? "Everyday jobs" : (FIELDS.find((f) => f.pattern.test(t.title))?.label ?? "Other"))),
  };
}

export const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
