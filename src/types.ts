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
}

export interface Settings {
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

export type View = "jobs" | "pipeline" | "insights" | "settings";

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
