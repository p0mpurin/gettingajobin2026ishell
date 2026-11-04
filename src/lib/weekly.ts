import type { Track } from "../types.ts";

const DAY = 86_400;
const WEEK = 7 * DAY;

/** Unix seconds of Monday 00:00 (local time) of the week containing `secs`. */
export function weekStart(secs: number): number {
  const d = new Date(secs * 1000);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return Math.floor(d.getTime() / 1000);
}

export interface WeeklyStats {
  thisWeek: number;
  goal: number;
  /** Consecutive weeks (ending this week, or last week if this one isn't done yet) that met the goal. */
  streak: number;
  /** Applications per week for the last 8 weeks, oldest first. */
  history: { week: number; count: number }[];
  applied: number;
  responded: number;
  interviews: number;
  /** 0-100, or null before any application. */
  responseRate: number | null;
  /** Average days from applying to a reply (interview, offer or rejection), or null. */
  avgDaysToReply: number | null;
}

const REPLIED = new Set(["interview", "offer", "rejected"]);

export function weeklyStats(tracks: Track[], goal: number, now = Date.now() / 1000): WeeklyStats {
  const applied = tracks.filter((t) => t.applied);
  const current = weekStart(now);
  const countIn = (start: number) => applied.filter((t) => t.applied! >= start && t.applied! < start + WEEK).length;

  const history = Array.from({ length: 8 }, (_, i) => {
    const week = weekStart(current - (7 - i) * WEEK + DAY);
    return { week, count: countIn(week) };
  });

  let streak = 0;
  if (goal > 0) {
    // This week counts once it reaches the goal; otherwise start from last week.
    let week = countIn(current) >= goal ? current : weekStart(current - DAY);
    while (countIn(week) >= goal && streak < 520) {
      streak++;
      week = weekStart(week - DAY);
    }
  }

  const replied = applied.filter((t) => REPLIED.has(t.status));
  const days = replied.map((t) => (t.updated - t.applied!) / DAY).filter((d) => d >= 0);
  return {
    thisWeek: countIn(current),
    goal,
    streak,
    history,
    applied: applied.length,
    responded: replied.length,
    interviews: applied.filter((t) => t.status === "interview" || t.status === "offer").length,
    responseRate: applied.length ? Math.round((replied.length / applied.length) * 100) : null,
    avgDaysToReply: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
  };
}
