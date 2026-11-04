import type { Job, Track } from "../types";

/**
 * Folds listings of the same job into one: the German and English versions of
 * a bilingual ad ("(m/w/d)" vs "(m/f/d)"), re-posts with a new date, and the
 * same ad on Karriere Südtirol and NOI Techpark.
 */

/** Companies that publish under more than one name. */
const COMPANY_ALIASES: Record<string, string> = {
  "free university of bozen bolzano": "freie universitat bozen",
  "libera universita di bolzano": "freie universitat bozen",
  "unibz": "freie universitat bozen",
};

const LEGAL_FORMS =
  /\b(gmbh|ag|s\.?p\.?a|s\.?r\.?l|kg|ohg|gen\.?\s?m\.?\s?b\.?\s?h|konsgmbh|genossenschaft|co|ltd|inc|group|soc\.?\s?coop|s\.?a\.?s|snc)\b\.?/g;

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function companyKey(company: string): string {
  const k = fold(company).replace(LEGAL_FORMS, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return COMPANY_ALIASES[k] ?? k;
}

export function titleKey(title: string): string {
  return fold(title)
    .replace(/\((?:\s*[mwfdxi*]\s*[/|,]){1,3}\s*[mwfdxi*]\s*\)/g, " ") // (m/w/d), (w/m/d), (m/f/d)…
    .replace(/\b[mwf]\s*\/\s*[mwf]\s*\/\s*[dx]\b/g, " ")
    .replace(/[:*](?:in|innen)\b/g, "") // Buchhalter:in, Expert*innen
    .replace(/\*/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function rank(j: Job, tracks: Record<string, Track>): number[] {
  // Prefer the listing the user already tracks, then one with an apply link,
  // then the newest, then Karriere (it has full posting text).
  return [
    tracks[j.id] ? 1 : 0,
    j.apply_url ? 1 : 0,
    j.published ? Date.parse(j.published) || 0 : j.first_seen * 1000,
    j.source === "karriere-suedtirol" ? 1 : 0,
  ];
}

function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export function mergeDuplicates(jobs: Job[], tracks: Record<string, Track>): Job[] {
  const groups = new Map<string, Job[]>();
  for (const j of jobs) {
    const key = `${companyKey(j.company)}|${titleKey(j.title)}`;
    const g = groups.get(key);
    if (g) g.push(j);
    else groups.set(key, [j]);
  }
  const out: Job[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) {
      out.push(g[0]);
      continue;
    }
    let primary = g[0];
    for (const j of g.slice(1)) if (better(rank(j, tracks), rank(primary, tracks))) primary = j;
    const rest = g.filter((j) => j !== primary);
    out.push({
      ...primary,
      is_new: g.every((j) => j.is_new), // a re-post of an old ad isn't news
      junior: g.some((j) => j.junior),
      duplicates: rest,
    });
  }
  return out;
}
