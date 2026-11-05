export type Status = "saved" | "applied" | "interview" | "offer" | "rejected" | "hidden";

export const PIPELINE: { id: Status; label: string; tone: string }[] = [
  { id: "saved", label: "Saved", tone: "text-amber" },
  { id: "applied", label: "Applied", tone: "text-sky" },
  { id: "interview", label: "Interview", tone: "text-violet" },
  { id: "offer", label: "Offer", tone: "text-mint" },
  { id: "rejected", label: "Rejected", tone: "text-rose" },
];

export interface Job {
  id: string;
  source: "karriere-suedtirol" | "noi-techpark" | "suedtirolerjobs" | "onboard";
  title: string;
  company: string;
  location: string;
  url: string;
  apply_url: string | null;
  published: string | null;
  salary: string | null;
  tags: string[];
  junior: boolean;
  is_new: boolean;
  first_seen: number;
  /** Set on jobs rebuilt from a track whose listing is gone. */
  delisted?: boolean;
  /** Other listings of the same job (re-posts, other language, other site). */
  duplicates?: Job[];
}

export interface Track {
  status: Status;
  notes: string;
  updated: number;
  applied: number | null;
  title: string;
  company: string;
  location: string;
  url: string;
  apply_url: string | null;
  followed_up: number | null;
  remind_after: number | null;
  interview_at: number | null;
  contact: string;
  cv: string;
  sent_message: string;
  /** "field" | "senior" | "far" | "company" | "other": why "Not for me" was chosen. */
  hide_reason?: string;
  /** A draft waiting for review. Nothing here has been sent. */
  draft_subject?: string;
  draft_message?: string;
  draft_to?: string;
  draft_cv?: string;
  /** Waiting for an AI agent to apply. */
  queued?: boolean;
  /** What an agent needs from the user before this can go further. */
  needs_you?: string;
  /** "ai" when an agent reported submitting this application. */
  applied_by?: string;
  /** A CV written for this job. */
  tailored_cv?: string;
  tailored_language?: string;
  /** The day this was prepared in the morning queue, until decided. */
  morning_day?: string;
  /** Replies found in the mailbox. */
  mails?: MailEvent[];
}

export interface MailEvent {
  message_id: string;
  date: number;
  from: string;
  subject: string;
  kind: "rejection" | "interview" | "offer" | "received" | "other";
  job_id: string;
  previous_status: string;
  moved_to: string;
}

export interface MailSuggestion {
  id: string;
  company: string;
  subject: string;
  date: number;
  kind: string;
}

export interface LanguageLevel {
  lang: string;
  level: string;
}

export interface Person {
  name: string;
  email: string;
  phone: string;
  links: string;
  /** "student" | "junior" | "mid" | "senior", or empty. */
  level: string;
  roles: string[];
  /** Ids from lib/fields.ts. */
  fields: string[];
  /** Fields never to show. */
  avoid_fields: string[];
  job_types: string[];
  languages: LanguageLevel[];
  /** Longest acceptable trip in minutes (0 = don't mind). */
  max_commute: number;
  background: string;
}

export interface AiRank {
  score: number;
  reason: string;
  at: number;
}

export interface CvFile {
  label: string;
  language: string;
  path: string;
}

export interface SavedAnswer {
  question: string;
  answer: string;
}

export interface Settings {
  do_not_disturb: boolean;
  morning_queue: boolean;
  morning_count: number;
  ui_language: string;
  ai_tailor_cv: boolean;
  mail_enabled: boolean;
  mail_address: string;
  mail_host: string;
  mail_port: number;
  mail_auto_update: boolean;
  cvs: CvFile[];
  answers: SavedAnswer[];
  ai_can_submit: boolean;
  ai_accept_privacy: boolean;
  ai_daily_limit: number;
  onboarded: boolean;
  person: Person;
  /** "claude" and "codex" use the official app's sign-in; "key" or empty the API key. */
  ai_provider: string;
  ai_base_url: string;
  ai_model: string;
  ai_consent: boolean;
  terms: string[];
  districts: number[];
  include_noi: boolean;
  include_suedtiroler: boolean;
  onboard_companies: string[];
  onboard_local_only: boolean;
  profile: string;
  skills: string[];
  auto_refresh_minutes: number;
  notify_new: boolean;
  home_town: string;
  vault_path: string;
  mirror_path: string;
  follow_up_days: number;
  merge_duplicates: boolean;
  watched: string[];
  hide_words: string[];
  hide_companies: string[];
  saved_views: SavedView[];
  weekly_goal: number;
}

export interface SavedView {
  name: string;
  filter: string;
  source: string;
  german: string;
  sort: string;
  query: string;
}

export type View = "jobs" | "map" | "autopilot" | "assistant" | "pipeline" | "insights" | "settings";

export const DISTRICTS: [number, string][] = [
  [43, "Bozen & Umgebung"],
  [50, "Überetsch & Unterland"],
  [44, "Burggrafenamt · Meran"],
  [45, "Eisacktal · Brixen"],
  [48, "Pustertal · Bruneck"],
  [51, "Vinschgau"],
  [46, "Wipptal"],
  [47, "Gröden & Gadertal"],
  [49, "Trentino"],
];

export const MORE_SOURCES: [string, string][] = [
  ["Indeed", "https://it.indeed.com/jobs?q=sviluppatore&l=Bolzano"],
  ["LinkedIn", "https://www.linkedin.com/jobs/search/?keywords=software&location=Bolzano"],
  ["NOI Techpark", "https://noi.bz.it/en/jobs-noi-techpark"],
  ["Province job exchange", "https://lavoro.provincia.bz.it/it/home"],
];

/** Quickest public-transport trip from the home town, arriving by 8:30 on a weekday. */
export interface Commute {
  town: string;
  /** 0 = same town. */
  minutes: number;
  changes: number;
  modes: string;
  fetched: number;
}
