import type { Track } from "../types";

const DAY = 86_400;

/**
 * When the next follow-up for an application is due, or null when no reminder
 * applies: only "applied" jobs get one (an interview means they replied).
 * The clock restarts after each follow-up; a snooze pushes it further out.
 */
export function followUpDue(t: Track | undefined, days: number): number | null {
  if (!t || t.status !== "applied" || !t.applied || days <= 0) return null;
  const base = Math.max(t.applied, t.followed_up ?? 0) + days * DAY;
  return Math.max(base, t.remind_after ?? 0);
}

export function isFollowUpDue(t: Track | undefined, days: number, now = Date.now() / 1000): boolean {
  const due = followUpDue(t, days);
  return due !== null && now >= due;
}

/** Whole days since a unix-seconds timestamp. */
export function daysSince(secs: number, now = Date.now() / 1000): number {
  return Math.floor((now - secs) / DAY);
}

export const SNOOZE_DAYS = 3;
export const snoozeUntil = (now = Date.now() / 1000) => now + SNOOZE_DAYS * DAY;
