import { invoke } from "@tauri-apps/api/core";
import type { AiRank, Job, Settings, Track, Commute } from "../types";

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
