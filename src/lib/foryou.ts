/**
 * The For You ranking: how well a job suits this person, and why, in plain
 * words. Everything here runs locally; an AI's opinion is one optional input.
 */
import type { AiRank, Commute, Job, Person, Track } from "../types";
import { fieldById } from "./fields.ts";
import type { Analysis } from "./match.ts";
import { levelRank } from "./profile.ts";

export interface Fit {
  /** 0-100. */
  score: number;
  /** Why it suits them, strongest first. */
  reasons: string[];
  /** What speaks against it. */
  warnings: string[];
}

/** Title words that say nothing about the job. */
const STOP = new Set(
  "m w d f x mw mwd und and e per for the der die das mit with in im di del della a an of bei at als as su von zur zum team mitarbeiter mitarbeiterin collaboratore collaboratrice addetto addetta".split(" "),
);

export const titleWords = (title: string) =>
  title
    .toLowerCase()
    .split(/[^\p{L}\p{N}#+]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w));

/** Reception, help desk, office, shop and service jobs: quick to start, and worth seeing. */
const EVERYDAY = /rezeption|receptionist|ricevimento|empfang|portier|concierge|front.?(?:office|desk)|back.?office|help.?desk|service.?desk|it.?support|(?:1st|first|2nd|second).?level|support.?(?:techni|mitarbeit|specialist)|kundenservice|kundendienst|kundenberat|customer.?(?:service|support|care)|call.?center|assistenza clienti|sekretari|segreteri|büro|impiegat|sachbearbeit|verwaltung|verkauf|verkäufer|commess|kassier|cassier|filial|einzelhandel/i;

export const isEveryday = (title: string) => EVERYDAY.test(title);

/** Keeps everyday jobs in the feed: one in every few places, however high the rest score. */
export function mixFeed<T>(sorted: T[], everyday: (item: T) => boolean, every = 4): T[] {
  const rest = sorted.filter((x) => !everyday(x));
  const common = sorted.filter(everyday);
  if (!common.length || !rest.length) return sorted;
  const out: T[] = [];
  let r = 0;
  let c = 0;
  while (r < rest.length || c < common.length) {
    // Each spot takes whichever is due: the slot rule first, otherwise the higher rank.
    const slot = (out.length + 1) % every === 0;
    const nextRest = rest[r];
    const nextCommon = common[c];
    const takeCommon = c < common.length && (r >= rest.length || slot || sorted.indexOf(nextCommon) < sorted.indexOf(nextRest));
    if (takeCommon) {
      out.push(common[c++]);
    } else {
      out.push(rest[r++]);
    }
  }
  return out;
}

export interface Signals {
  words: Map<string, number>;
  companies: Map<string, number>;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const LIKED: Record<string, number> = { saved: 1, applied: 2, interview: 3, offer: 3 };

/** What the user's own actions say: jobs they kept pull similar ones up, "Not for me" pushes them down. */
export function learnSignals(tracks: Record<string, Track>): Signals {
  const words = new Map<string, number>();
  const companies = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, by: number) => m.set(k, (m.get(k) ?? 0) + by);
  for (const t of Object.values(tracks)) {
    const company = t.company.toLowerCase();
    const like = LIKED[t.status];
    if (like) {
      titleWords(t.title).forEach((w) => bump(words, w, like));
      if (company) bump(companies, company, like);
    } else if (t.status === "hidden") {
      // The reason says what was wrong: the field, the company or neither.
      if (t.hide_reason === "company") {
        if (company) bump(companies, company, -6);
      } else if (t.hide_reason !== "far" && t.hide_reason !== "senior") {
        titleWords(t.title).forEach((w) => bump(words, w, t.hide_reason === "field" ? -2 : -1));
      }
    }
  }
  return { words, companies };
}

const JOB_TYPE: Record<string, RegExp> = {
  "Full-time": /vollzeit|full.?time|tempo pieno/i,
  "Part-time": /teilzeit|part.?time|tempo parziale/i,
  Internship: /prakti|stage|tirocin|intern\b|internship/i,
  Apprenticeship: /lehr(?:e|ling)|apprendist|ausbildung/i,
  Seasonal: /saison|stagional|seasonal/i,
};

const SENIOR_TITLE = /\b(senior|lead|principal|head of|teamleiter|leiter|responsabile|direktor|direttore)\b/i;

function daysOld(job: Job): number | null {
  const iso = job.published ?? (job.first_seen ? new Date(job.first_seen * 1000).toISOString() : null);
  return iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : null;
}

function minutesLabel(m: number) {
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

export function scoreJob(
  job: Job,
  ctx: {
    person: Person;
    skills: string[];
    analysis?: Analysis;
    commute?: Commute;
    signals: Signals;
    aiRank?: AiRank;
    everyday?: boolean;
  },
): Fit {
  const { person, analysis, commute, signals, aiRank } = ctx;
  const reasons: [number, string][] = [];
  const warnings: string[] = [];
  let score = 20;
  const title = job.title.toLowerCase();
  const add = (points: number, why?: string) => {
    score += points;
    if (why) reasons.push([points, why]);
  };

  // What they want to do.
  let roleHit = false;
  for (const role of person.roles) {
    const r = role.toLowerCase().trim();
    if (!r) continue;
    const words = titleWords(r);
    if (title.includes(r)) {
      add(40, `The job you asked for: ${role}`);
      roleHit = true;
      break;
    }
    if (words.length && words.some((w) => title.includes(w))) {
      add(26, `Close to ${role}`);
      roleHit = true;
      break;
    }
  }
  if (!roleHit) {
    const field = person.fields.map(fieldById).find((f) => f?.pattern.test(job.title));
    if (field) add(24, `In your field: ${field.label}`);
    else {
      // The posting is weaker evidence than the title.
      const inPosting = analysis && person.fields.map(fieldById).find((f) => f && analysis.fieldText && f.pattern.test(analysis.fieldText));
      if (inPosting) add(8);
    }
  }

  // Everyday work counts as a match by itself unless it's a senior post.
  if (ctx.everyday && !roleHit && isEveryday(job.title) && !SENIOR_TITLE.test(job.title)) {
    add(22, "Everyday job, quick to start");
  }

  // What they can do.
  if (analysis && analysis.matched.length) {
    const top = analysis.matched.slice(0, 3).join(", ");
    add(Math.min(30, analysis.matched.length * 7), `Uses your skills: ${top}`);
    if (analysis.missing.length > analysis.matched.length * 2) add(-8);
  }

  // Experience level.
  const entry = person.level === "student" || person.level === "junior";
  if (SENIOR_TITLE.test(job.title) && entry) {
    add(-25);
    warnings.push("Senior role");
  } else if (entry && (job.junior || analysis?.junior)) {
    add(12, "Open to beginners");
  } else if (person.level === "senior" && job.junior) {
    add(-12);
  } else if (person.level === "senior" && SENIOR_TITLE.test(job.title)) {
    add(10, "Senior role, like you asked");
  }

  // Languages the posting asks for against the ones they speak.
  if (analysis) {
    const has = (lang: string) => levelRank(person.languages.find((l) => l.lang === lang)?.level ?? "");
    if (person.languages.length) {
      for (const need of analysis.languages) {
        if (need.level === "required" && has(need.lang) < 3) {
          add(-22);
          warnings.push(`Requires ${need.lang}`);
        }
      }
      const german = analysis.languages.find((l) => l.lang === "German");
      if (has("German") < 3) {
        if (!german && analysis.postingLanguage === "German") {
          add(-10);
          warnings.push("Posting is in German");
        } else if (!german) {
          add(6, "No German needed");
        }
      }
    }
  }

  // Getting there.
  if (commute) {
    const known = commute.modes === "Same town" ? "In your town" : `${minutesLabel(commute.minutes)} by public transport`;
    if (person.max_commute && commute.minutes > person.max_commute) {
      add(-16);
      warnings.push(`${minutesLabel(commute.minutes)} away`);
    } else if (commute.minutes <= (person.max_commute || 45)) {
      add(8, known);
    }
  }

  // Job type.
  const hay = `${job.title} ${job.tags.join(" ")}`;
  const typeHit = person.job_types.find((t) => JOB_TYPE[t]?.test(hay));
  if (typeHit) add(5);

  // Freshness: older postings are likelier to be filled.
  const age = daysOld(job);
  if (age !== null) {
    if (age <= 3) add(6, "Posted in the last few days");
    else if (age <= 14) add(3);
    else if (age > 60) add(-6);
  }

  // What they've shown they like.
  let learned = titleWords(job.title).reduce((n, w) => n + (signals.words.get(w) ?? 0), 0);
  const company = signals.companies.get(job.company.toLowerCase()) ?? 0;
  if (company <= -6) {
    add(-40);
    warnings.push("You passed on this company");
  }
  learned = clamp(learned + Math.max(0, company), -15, 15);
  if (learned >= 4) add(learned, "Like jobs you've saved");
  else add(learned);

  let final = clamp(Math.round(score), 0, 100);
  const ordered = reasons.sort((a, b) => b[0] - a[0]).map(([, why]) => why);
  // An AI read the whole profile and posting, so its view counts for half.
  if (aiRank) {
    final = clamp(Math.round(final * 0.5 + aiRank.score * 0.5), 0, 100);
    if (aiRank.reason) ordered.unshift(aiRank.reason);
  }
  return { score: final, reasons: ordered, warnings };
}
