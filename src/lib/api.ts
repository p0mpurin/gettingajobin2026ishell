import { invoke } from "@tauri-apps/api/core";
import type { AiRank, Job, MailEvent, MailSuggestion, Settings, Track, Commute } from "../types";

export interface Tailored {
  path: string;
  language: string;
  /** What the fact check took out. */
  removed: string[];
  html: string;
}

export interface CliStatus {
  installed: boolean;
  signed_in: boolean;
  account: string;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ApplyOutcome {
  outcome: "submitted" | "needs_you" | "failed";
  note: string;
}

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  getTracks: () => invoke<Record<string, Track>>("get_tracks"),
  setTrack: (id: string, track: Track | null) => invoke<Track | null>("set_track", { id, track }),
  getCachedJobs: () => invoke<Job[]>("get_cached_jobs"),
  fetchJobs: () => invoke<{ jobs: Job[]; errors: string[] }>("fetch_jobs"),
  description: (id: string, url: string, refresh = false) => invoke<string>("job_description", { id, url, refresh }),
  getDescriptions: () => invoke<Record<string, string>>("get_descriptions"),
  saveDescription: (id: string, text: string) => invoke<void>("save_description", { id, text }),
  exportBackup: (path: string) => invoke<number>("export_backup", { path }),
  importBackup: (path: string) => invoke<{ tracks: number; safety_copy: string }>("import_backup", { path }),
  commutes: (locations: string[]) => invoke<Record<string, Commute>>("commutes", { locations }),
  readCv: (path: string) => invoke<string>("read_cv", { path }),
  getAiRanks: () => invoke<Record<string, AiRank>>("get_ai_ranks"),
  importAiRanks: (rankings: { id: string; score: number; reason: string }[]) => invoke<{ stored: number }>("import_ai_ranks", { rankings }),
  clearAiRanks: () => invoke<void>("clear_ai_ranks"),
  aiChat: (messages: unknown[]) => invoke<{ messages: unknown[]; actions: string[]; text: string }>("ai_chat", { messages }),
  aiSetKey: (key: string) => invoke<void>("ai_set_key", { key }),
  aiHasKey: () => invoke<boolean>("ai_has_key"),
  aiClearKey: () => invoke<void>("ai_clear_key"),
  applyAiInbox: () => invoke<number>("apply_ai_inbox"),
  autopilotRules: () => invoke<string>("autopilot_rules"),
  importReports: (reports: unknown[]) => invoke<number>("import_reports", { reports }),
  applyStart: (id: string, bounds: Bounds) => invoke<ApplyOutcome>("apply_start", { id, bounds }),
  applyStop: () => invoke<void>("apply_stop"),
  browserPlace: (bounds: Bounds) => invoke<void>("browser_place", { bounds }),
  browserClose: () => invoke<void>("browser_close"),
  cliStatus: (provider: string) => invoke<CliStatus>("cli_status", { provider }),
  cliSignIn: (provider: string) => invoke<void>("cli_sign_in", { provider }),
  cliInstall: (provider: string) => invoke<void>("cli_install", { provider }),
  tailorCv: (id: string) => invoke<Tailored>("tailor_cv", { id }),
  openTailored: (path: string) => invoke<void>("open_tailored", { path }),
  mailConnect: (address: string, host: string, password: string) => invoke<void>("mail_connect", { address, host, password }),
  mailDisconnect: () => invoke<void>("mail_disconnect"),
  mailSync: () => invoke<{ checked: number; updates: MailEvent[]; suggestions: number }>("mail_sync"),
  mailUndo: (id: string, messageId: string) => invoke<void>("mail_undo", { id, messageId }),
  mailSuggestions: () => invoke<MailSuggestion[]>("mail_suggestions"),
  mailResolve: (id: string, accept: boolean) => invoke<void>("mail_resolve", { id, accept }),
  gameRunning: () => invoke<boolean>("game_running"),
  siteMemory: () => invoke<Record<string, { runs: number; sent: number; handed_over: number; has_captcha: boolean }>>("site_memory"),
  aiOneShot: (system: string, prompt: string) => invoke<string>("ai_one_shot", { system, prompt }),
  mcpConfig: () => invoke<string>("mcp_config"),
  mirrorNow: () => invoke<string>("mirror_now"),
  openDataFolder: () => invoke<void>("open_data_folder"),
  writeTextFile: (path: string, contents: string) => invoke<void>("write_text_file", { path, contents }),
  exportTracks: (path: string, format: "md" | "csv") => invoke<number>("export_tracks", { path, format }),
};

/** Whether the app can read this job's posting text by itself. */
export function canLoadDescription(job: Job): boolean {
  return job.source === "karriere-suedtirol" || job.source === "suedtirolerjobs" || job.source === "onboard" || job.url.startsWith("https://noi.bz.it/");
}
