/** Turns setup answers into what the rest of the app uses, and reads them back out of a CV. */
import type { LanguageLevel, Person } from "../types";
import { fieldById, wantedFields } from "./fields.ts";
import { detectSkills } from "./match.ts";

export const EMPTY_PERSON: Person = {
  name: "",
  email: "",
  phone: "",
  links: "",
  level: "",
  roles: [],
  fields: [],
  avoid_fields: [],
  job_types: [],
  languages: [],
  max_commute: 0,
  background: "",
};

const LEVEL_TEXT: Record<string, string> = {
  student: "student or just starting out",
  junior: "junior, up to 2 years of experience",
  mid: "experienced, 3 to 7 years",
  senior: "senior, more than 7 years",
};

/** The profile text used in every AI prompt. Contains only what the user gave. */
export function buildProfileText(p: Person, skills: string[], town: string): string {
  const contact = [p.email, p.phone, town, p.links].map((s) => s.trim()).filter(Boolean).join(" · ");
  const fields = p.fields.map((f) => fieldById(f)?.label ?? f);
  const lines = [
    p.name.trim() && `Name: ${p.name.trim()}`,
    contact && `Contact: ${contact}`,
    (p.roles.length > 0 || fields.length > 0) && `Looking for: ${[...p.roles, ...fields].join(", ")}`,
    p.level && `Experience level: ${LEVEL_TEXT[p.level] ?? p.level}`,
    p.job_types.length > 0 && `Job types: ${p.job_types.join(", ")}`,
    p.languages.length > 0 && `Languages: ${p.languages.map((l) => `${l.lang} ${l.level}`.trim()).join(", ")}`,
    skills.length > 0 && `Skills: ${skills.join(", ")}`,
    p.background.trim() && `\nBackground:\n${p.background.trim()}`,
  ];
  return lines.filter(Boolean).join("\n");
}

const MAX_TERMS = 12;

/** Search terms for the job sites: the user's own job titles first, then their fields'. */
export function searchTerms(p: Person): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    const v = t.trim();
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  p.roles.forEach(add);
  wantedFields(p).forEach((f) => f.terms.forEach(add));
  return out.slice(0, MAX_TERMS);
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Keeps search terms and preferences saying the same thing when either is edited:
 * picking a field adds its terms and dropping it removes them, and removing the
 * last of a field's terms drops the field. Never adds back a term the user removed.
 */
export function reconcile<T extends { terms: string[]; person: Person; profile: string }>(prev: T, next: T): T {
  let terms = next.terms;
  const fields = next.person.fields;
  const added = fields.filter((f) => !prev.person.fields.includes(f));
  const dropped = prev.person.fields.filter((f) => !fields.includes(f));
  for (const id of dropped) {
    const own = fieldById(id)?.terms ?? [];
    terms = terms.filter((t) => !own.some((o) => same(o, t)));
  }
  for (const id of added) {
    for (const t of fieldById(id)?.terms ?? []) if (!terms.some((x) => same(x, t))) terms = [...terms, t];
  }
  const removedTerms = prev.terms.filter((t) => !next.terms.some((x) => same(x, t)));
  const kept = fields.filter((id) => {
    const own = fieldById(id)?.terms ?? [];
    const lostOne = own.some((o) => removedTerms.some((t) => same(o, t)));
    return !lostOne || own.some((o) => terms.some((t) => same(o, t)));
  });
  const person = { ...next.person, fields: kept };
  const wanted = [...person.roles, ...kept.map((f) => fieldById(f)?.label ?? f)].join(", ");
  const profile = /^Looking for:.*$/m.test(next.profile) ? next.profile.replace(/^Looking for:.*$/m, wanted ? `Looking for: ${wanted}` : "").replace(/\n{3,}/g, "\n\n") : next.profile;
  return { ...next, terms, person, profile };
}

/* ---------- reading a CV ---------- */

/** Language names as CVs write them, in the languages CVs here are written in. */
const LANGUAGES: [string, RegExp][] = [
  ["German", /\b(?:german|deutsch|tedesco)\b/i],
  ["Italian", /\b(?:italian|italienisch|italiano)\b/i],
  ["English", /\b(?:english|englisch|inglese)\b/i],
  ["French", /\b(?:french|französisch|francese)\b/i],
  ["Spanish", /\b(?:spanish|spanisch|spagnolo)\b/i],
  ["Arabic", /\b(?:arabic|arabisch|arabo)\b/i],
  ["Albanian", /\b(?:albanian|albanisch|albanese)\b/i],
  ["Urdu", /\burdu\b/i],
];
const NATIVE = /\b(?:native|mother tongue|muttersprache|madrelingua)\b/i;

export interface CvFacts {
  name: string;
  email: string;
  phone: string;
  links: string;
  skills: string[];
  languages: LanguageLevel[];
}

export function parseCv(text: string): CvFacts {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const nameLine = lines.slice(0, 8).find((l) => /^[\p{Lu}][\p{L}'’-]+(?:\s+[\p{L}'’-]+){1,3}$/u.test(l)) ?? "";
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]*\w/)?.[0] ?? "";
  // A phone number: optional +, then 8-15 digits with common separators.
  const phone = (text.match(/\+?\d[\d\s/().-]{7,18}\d/g) ?? []).find((m) => {
    const digits = m.replace(/\D/g, "").length;
    return digits >= 9 && digits <= 15 && !/^\d{4}\s*[-–]\s*\d{4}$/.test(m.trim());
  });
  const links = [...new Set(text.match(/(?:https?:\/\/|www\.|(?:github|linkedin)\.com\/)[^\s,;)]+/gi) ?? [])].slice(0, 3).join(" · ");
  const languages: LanguageLevel[] = [];
  for (const [lang, re] of LANGUAGES) {
    const hit = lines.find((l) => re.test(l));
    if (!hit) continue;
    const after = hit.slice(hit.search(re));
    // The level closest after the language's name on the line, so "English C1, Italian B2" splits right.
    const level = after.match(/\b[ABC][12](?:\s*\/\s*[ABC][12])?\b/)?.[0]?.replace(/\s/g, "") ?? (NATIVE.test(after) ? "Native" : "");
    languages.push({ lang, level });
  }
  return { name: nameLine, email, phone: phone?.trim() ?? "", links, skills: detectSkills(text), languages };
}

/** CEFR level as a number, for comparing. An unstated level counts as basic. */
export function levelRank(level: string): number {
  if (/native|mother/i.test(level)) return 6;
  const m = level.toUpperCase().match(/[ABC][12]/g);
  if (!m) return level ? 1 : 0;
  // "B1/B2" counts as the lower one: promise only what's certain.
  const first = m[0];
  return (first.charCodeAt(0) - 65) * 2 + Number(first[1]);
}
