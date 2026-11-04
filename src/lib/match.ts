/**
 * Compares a posting against the user's skills. Detects which known
 * technologies a posting mentions, which of those the user has, and which
 * spoken languages it asks for.
 */

/** Technologies we look for in postings. Patterns avoid false hits like "C" inside words. */
const VOCAB: [string, RegExp][] = [
  ["C#", /\bc#|\bc-sharp\b/i],
  [".NET", /\.net\b|\bdotnet\b|\basp\.net/i],
  ["C++", /\bc\+\+/i],
  // Plain "C" only in a list of languages ("C, C++", "C/C++") or "in C".
  ["C", /(?<![\w#+.\-/])C(?=\s*(?:,|\/|\)|\s(?:und|and|e|oder|or)\s))|\bin C\b(?![#+])/],
  ["Python", /\bpython\b/i],
  ["JavaScript", /\bjavascript\b|\bjs\b/i],
  ["TypeScript", /\btypescript\b|\bts\b(?=[,/ ])/i],
  ["Rust", /\brust\b/i],
  ["Java", /\bjava\b(?!\s*script)/i],
  ["Kotlin", /\bkotlin\b/i],
  ["Go", /\bgolang\b|\bgo\b(?=\s*(?:,|\/|\)|lang))/i],
  ["PHP", /\bphp\b/i],
  ["Laravel", /\blaravel\b/i],
  ["Spring", /\bspring(?:\s*boot)?\b/i],
  ["SQL", /\bsql\b|\brelational\b|\brelationale\b|\bdatenbank|\bdatabase|\bdatabas/i],
  ["PostgreSQL", /\bpostgres(?:ql)?\b/i],
  ["MySQL", /\bmysql\b|\bmariadb\b/i],
  ["MongoDB", /\bmongo(?:db)?\b/i],
  ["HTML", /\bhtml5?\b/i],
  ["CSS", /\bcss3?\b|\btailwind\b|\bsass\b|\bscss\b/i],
  ["React", /\breact(?:\.js|js)?\b/i],
  ["Next.js", /\bnext\.?js\b/i],
  ["Vue", /\bvue(?:\.js)?\b|\bnuxt\b/i],
  ["Angular", /\bangular\b/i],
  ["Node.js", /\bnode(?:\.js|js)?\b/i],
  ["REST", /\brest(?:ful)?\b|\brest[- ]?apis?\b|\bapis?\b(?!\w)/i],
  ["Git", /\bgit(?:hub|lab)?\b/i],
  ["CI/CD", /\bci\/cd\b|\bpipelines?\b|\bdevops\b/i],
  ["Docker", /\bdocker\b|\bcontainer/i],
  ["Kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["Azure", /\bazure\b/i],
  ["AWS", /\baws\b|\bamazon web services\b/i],
  ["Linux", /\blinux\b/i],
  ["Windows", /\bwindows\b|\bmicrosoft[- ]betriebssystem|\bactive directory\b/i],
  ["Networking", /\bnetzwerk(?:technik|infrastruktur|administration)|\bnetwork (?:engineer|admin\w*|infrastructure|security)|\bfirewall|\btcp\/ip\b|\bcisco\b|\breti informatiche\b/i],
  ["IT Support", /\bit[- ]support\b|\bhelp ?desk\b|\bservice ?desk\b|\b(?:1st|2nd|first|second)[- ]level\b|\bticket(?:system|ing)\b/i],
  ["Power BI", /\bpower ?bi\b/i],
  ["SAP", /\bsap\b/i],
  ["WordPress", /\bwordpress\b/i],
  ["Testing", /\bunit[- ]?tests?|\bautomated test|\btestautomati|\btesting\b|\bqualitätssicherung\b|\bmocha\b|\bjest\b/i],
  ["WebRTC", /\bwebrtc\b/i],
  ["Embedded", /\bembedded\b|\bfirmware\b|\bmicrocontroller/i],
];

const GENERIC = new Set(["SQL", "REST", "Git", "Windows", "Linux", "Networking", "IT Support", "Testing", "CI/CD", "HTML", "CSS"]);

export interface LanguageNeed {
  lang: "German" | "Italian" | "English";
  level: "required" | "plus";
}

export interface Analysis {
  /** 0-100, or null when the posting names no known technology. */
  score: number | null;
  matched: string[];
  missing: string[];
  languages: LanguageNeed[];
  postingLanguage: "German" | "Italian" | "English";
  junior: boolean;
  seniorSignals: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#+.]/g, "");

function userHas(skill: string, skills: string[]): boolean {
  const n = norm(skill);
  return skills.some((s) => {
    const m = norm(s);
    return m === n || (n === "sql" && /sql/.test(m)) || (n === "git" && m === "github");
  });
}

const LANG_WORDS: Record<LanguageNeed["lang"], RegExp> = {
  German: /\b(deutsch\w*|german|tedesco)\b/i,
  Italian: /\b(italienisch\w*|italian|italiano)\b/i,
  English: /\b(englisch\w*|english|inglese)\b/i,
};
const PLUS = /\b(vorteil|plus|gern gesehen|wünschenswert|nice to have|gradit|preferib|apprezzat|advantage|bonus)\b/i;

function detectLanguages(text: string): LanguageNeed[] {
  const needs: LanguageNeed[] = [];
  const sentences = text.split(/[\n.;•]/);
  for (const lang of Object.keys(LANG_WORDS) as LanguageNeed["lang"][]) {
    const hits = sentences.filter((s) => LANG_WORDS[lang].test(s));
    if (hits.length === 0) continue;
    needs.push({ lang, level: hits.every((s) => PLUS.test(s)) ? "plus" : "required" });
  }
  return needs;
}

function detectPostingLanguage(text: string): Analysis["postingLanguage"] {
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const de = count(/\b(und|der|die|das|wir|mit|für|sie|deine|ihre)\b/gi);
  const it = count(/\b(e|il|la|di|che|per|con|una|nostro|sviluppo)\b/gi);
  const en = count(/\b(and|the|with|you|our|for|will|your)\b/gi);
  if (de >= it && de >= en) return "German";
  return it > en ? "Italian" : "English";
}

const SENIOR = /\b(senior|lead|principal|head of|architect|teamlead|leiter|responsabile|\d\+?\s*(?:years|jahre|anni))\b/gi;

export function analyze(title: string, text: string, skills: string[]): Analysis {
  const full = `${title}\n${text}`;
  const found = VOCAB.filter(([, re]) => re.test(full)).map(([name]) => name);
  const matched = found.filter((f) => userHas(f, skills));
  const missing = found.filter((f) => !userHas(f, skills));
  const seniorSignals = [...new Set((full.match(SENIOR) ?? []).map((s) => s.toLowerCase()))].slice(0, 4);
  const junior = /\b(junior|einsteiger|trainee|praktik|intern|stage|tirocin|apprendist|neolaureat)/i.test(full);

  let score: number | null = null;
  if (found.length > 0) {
    // Weighted coverage: concrete technologies count fully, generic terms
    // (databases, APIs, Windows…) half. Dividing by at least 3 keeps a posting
    // that names one or two things from scoring like a perfect fit.
    const w = (s: string) => (GENERIC.has(s) ? 0.5 : 1);
    const total = found.reduce((n, s) => n + w(s), 0);
    const have = matched.reduce((n, s) => n + w(s), 0);
    let s = (have / Math.max(total, 3)) * 100;
    if (junior) s += 8;
    if (/\b(senior|lead|principal|head of|architect)\b/i.test(title)) s -= 25;
    score = Math.max(0, Math.min(100, Math.round(s)));
  }

  return {
    score,
    matched,
    missing,
    languages: text ? detectLanguages(text) : [],
    postingLanguage: detectPostingLanguage(full),
    junior,
    seniorSignals,
  };
}

export type GermanNeed = "required" | "implied" | "plus" | "none" | "unknown";

/**
 * How much German a posting asks for. "implied" means the posting is written
 * in German without naming languages, which in practice means German is
 * expected. "unknown" means the posting text hasn't been read yet.
 */
export function germanNeed(analysis: Analysis | undefined): GermanNeed {
  if (!analysis) return "unknown";
  const de = analysis.languages.find((l) => l.lang === "German");
  if (de) return de.level;
  return analysis.postingLanguage === "German" ? "implied" : "none";
}

export const germanOk = (need: GermanNeed) => need === "none" || need === "plus";

/** Reads levels like "German B1" from the profile text. */
export function profileLanguageLevel(profile: string, lang: string): string | null {
  const m = profile.match(new RegExp(`${lang}\\s*([ABC][12](?:/[ABC][12])?)`, "i"));
  return m ? m[1].toUpperCase() : null;
}

export function scoreTone(score: number | null): string {
  if (score === null) return "text-chrome-500";
  if (score >= 70) return "text-mint";
  if (score >= 45) return "text-amber";
  return "text-rose";
}
