import type { Job } from "../types";
import type { Analysis } from "./match";

export const LANGUAGES = ["Same as the posting", "English", "Italian", "German"] as const;
export const TONES = ["Confident and warm", "Formal", "Short and direct"] as const;
export const KINDS = ["Application email", "Cover letter", "LinkedIn message to recruiter", "Follow-up after applying"] as const;

export interface PromptOptions {
  language: string;
  tone: string;
  kind: string;
  notes: string;
}

const PHRASE: Record<string, string> = {
  "Application email": "an application email",
  "Cover letter": "a cover letter",
  "LinkedIn message to recruiter": "a LinkedIn message to a recruiter",
  "Follow-up after applying": "a follow-up message after applying",
};

const LENGTH: Record<string, string> = {
  "Application email": "180-250 words",
  "Cover letter": "250-350 words, 3-4 short paragraphs",
  "LinkedIn message to recruiter": "under 90 words",
  "Follow-up after applying": "under 120 words",
};

export function buildPrompt(profile: string, job: Job, posting: string, analysis: Analysis | null, o: PromptOptions): string {
  const language = o.language === LANGUAGES[0] ? `the same language as the job posting (${analysis?.postingLanguage ?? "detect it"})` : o.language;
  const facts = [
    `Title: ${job.title}`,
    `Company: ${job.company || "unknown"}`,
    `Location: ${job.location || "unknown"}`,
    job.salary && `Salary: ${job.salary}`,
    job.tags.length > 0 && `Type: ${job.tags.join(", ")}`,
    `Link: ${job.apply_url ?? job.url}`,
  ].filter(Boolean);

  const fit =
    analysis && analysis.score !== null
      ? `\nPRE-ANALYSIS (keyword match, double-check it)\nSkills of mine the posting asks for: ${analysis.matched.join(", ") || "none detected"}\nSkills it asks for that I lack: ${analysis.missing.join(", ") || "none detected"}\n` +
        (analysis.languages.length ? `Languages mentioned: ${analysis.languages.map((l) => `${l.lang} (${l.level})`).join(", ")}\n` : "")
      : "";

  return `You are an experienced career coach helping me write ${PHRASE[o.kind] ?? "an application email"} for a job.

RULES
- Use only facts from MY PROFILE. Never invent experience, skills, numbers, degrees or language levels.
- Lead with my strongest match for this specific job. Pick the 2-3 most relevant experiences or projects, not everything.
- Mention something specific about the company or role from the posting.
- Be honest about gaps: if the posting requires something I don't have, name it briefly and show how I would close it. Don't apologise.
- Length: ${LENGTH[o.kind] ?? "180-250 words"}. Tone: ${o.tone.toLowerCase()}. No buzzwords, no clichés like "I am writing to express my interest".
- Write it in ${language}.
- ${o.kind === "LinkedIn message to recruiter" ? "No subject line. End with my name." : "Output a subject line, the text, and a sign-off with my name, phone number and email."}
- After it, add a short list: requirements I meet, requirements I'm missing, and your verdict (strong match, good match or stretch) with one sentence why.

MY PROFILE
${profile.trim()}

THE JOB
${facts.join("\n")}
${fit}
JOB POSTING
${posting.trim() || "(not available - work from the title and company)"}
${o.notes.trim() ? `\nEXTRA NOTES FROM ME\n${o.notes.trim()}\n` : ""}`;
}
