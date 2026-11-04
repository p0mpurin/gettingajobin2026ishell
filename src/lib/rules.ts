import { companyKey } from "./dedupe.ts";

/**
 * Hide rules: drop every job from a company, or every job whose title contains
 * a word (e.g. "Senior"). Returns why a job is hidden, or null.
 */
export function hiddenBy(title: string, company: string, words: string[], companies: string[]): string | null {
  if (company && companies.some((c) => companyKey(c) === companyKey(company))) return `company: ${company}`;
  const t = fold(title);
  for (const w of words) {
    const word = fold(w).trim();
    // Whole-word match: "Lead" hides "Team Lead" but not "Leadership Trainee".
    if (word && new RegExp(`(^|[^a-z0-9])${escape(word)}([^a-z0-9]|$)`).test(t)) return `word: ${w}`;
  }
  return null;
}

/** Words most people hiding senior roles want; offered as one-click suggestions. */
export const SUGGESTED_WORDS = ["Senior", "Lead", "Head of", "Principal", "Teamleiter", "Leiter"];

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
