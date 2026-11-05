/**
 * The For You ranking: how well a job suits this person, and why, in plain
 * words. Everything here runs locally; an AI's opinion is one optional input.
 */
import type { AiRank, Commute, Job, Person, Track } from "../types";
import { fieldById, fieldsIn, inField, wantedFields } from "./fields.ts";
import type { Analysis } from "./match.ts";
import { levelRank } from "./profile.ts";

export interface Fit {
  /** 0-100. */
  score: number;
  /** Why it suits them, strongest first. */
  reasons: string[];
  /** What speaks against it. */
  warnings: string[];
  /**
   * Whether anything about the job matches what they asked for. Being new, nearby
   * or open to beginners makes a good job better, but never makes it a match.
   */
  relevant: boolean;
  /** The field they said never to show, if this is in it. */
  avoided?: string;
}

/** Words that say nothing alone: "service" shouldn't match every technician. */
const VAGUE = new Set("service manager assistant assistent assistente support specialist spezialist junior senior worker mitarbeiter operator kraft arbeiter work job jobs normal arbeit lavoro stelle".split(" "));

/** A search term in a title, as the start of a word, or a whole word when short ("IT"). */
function termIn(term: string, title: string): boolean {
  const t = term.trim();
  if (t.length < 2) return false;
  const safe = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const end = t.length <= 3 ? "(?![\\p{L}\\p{N}])" : "";
  return new RegExp(`(?<![\\p{L}\\p{N}])${safe}${end}`, "iu").test(title);
}

/** The field to never show that this title falls in. What they asked for wins. */
export function avoidedField(title: string, person: Person): string | undefined {
  if (!person.avoid_fields?.length) return undefined;
  const wanted = wantedFields(person);
  if (wanted.some((f) => inField(f, title)) || person.roles.some((r) => r.trim() && title.toLowerCase().includes(r.trim().toLowerCase()))) return undefined;
  return person.avoid_fields.map(fieldById).find((f) => f && inField(f, title))?.label;
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
    /** Their search terms. */
    terms?: string[];
    /** Already on their list, so its own words can't count as "like jobs you saved". */
    tracked?: boolean;
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

  const wanted = wantedFields(person);
  // The title clearly belongs to work they didn't ask for: loose word matches don't count.
  const elsewhere = fieldsIn(job.title).some((f) => !wanted.includes(f));
  let relevant = false;

  // What they want to do.
  let roleHit = false;
  for (const role of person.roles) {
    const r = role.toLowerCase().trim();
    if (!r) continue;
    const words = titleWords(r).filter((w) => !VAGUE.has(w));
    if (termIn(r, job.title)) {
      add(40, `The job you asked for: ${role}`);
      roleHit = true;
      break;
    }
    if (!elsewhere && words.length && words.some((w) => termIn(w, job.title))) {
      add(26, `Close to ${role}`);
      roleHit = true;
      break;
    }
  }
  relevant = roleHit;
  if (!roleHit) {
    const field = wanted.find((f) => inField(f, job.title));
    if (field) {
      add(24, `In your field: ${field.label}`);
      relevant = true;
    } else {
      // With no fields chosen, their terms are all there is to go on.
      const term = elsewhere && wanted.length ? undefined : ctx.terms?.find((t) => termIn(t, job.title));
      if (term) {
        add(18, `Matches your search: ${term}`);
        relevant = true;
      } else if (analysis?.fieldText && wanted.some((f) => f.pattern.test(analysis.fieldText))) {
        // The posting is weaker evidence than the title.
        add(8);
      }
    }
  }

  // What they can do.
  if (analysis && analysis.matched.length) {
    const top = analysis.matched.slice(0, 3).join(", ");
    add(Math.min(30, analysis.matched.length * 7), `Uses your skills: ${top}`);
    if (analysis.missing.length > analysis.matched.length * 2) add(-8);
    // One shared word could be anywhere; two start to mean something.
    if (analysis.matched.length >= 2 && !elsewhere) relevant = true;
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
  if (learned >= 4 && !ctx.tracked) {
    add(learned, "Like jobs you've saved");
    relevant = true;
  } else add(learned);

  let final = clamp(Math.round(score), 0, 100);
  const ordered = reasons.sort((a, b) => b[0] - a[0]).map(([, why]) => why);
  // An AI read the whole profile and posting, so its view counts for half.
  if (aiRank) {
    final = clamp(Math.round(final * 0.5 + aiRank.score * 0.5), 0, 100);
    if (aiRank.reason) ordered.unshift(aiRank.reason);
    // It read the job and the person, so its verdict settles whether this is a match.
    if (aiRank.score >= 60) relevant = true;
    if (aiRank.score < 35) relevant = false;
  }
  // Someone who hasn't said what they want yet still gets a feed.
  if (!wanted.length && !person.roles.length && !ctx.terms?.length && !ctx.skills.length) relevant = true;
  const avoided = avoidedField(job.title, person);
  if (avoided) warnings.push(`You chose never to see ${avoided}`);
  return { score: final, reasons: ordered, warnings, relevant: relevant && !avoided, avoided };
}
