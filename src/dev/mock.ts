// Browser-only stand-in for the Rust backend, so the UI can be previewed
// with `npm run dev` outside Tauri. Never loaded inside the app.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import sample from "./sample.json";

export function installMock() {
  mockWindows("main");
  const tracks: Record<string, unknown> = {};
  const [a, b, c] = sample.jobs;
  const snap = (j: (typeof sample.jobs)[number], status: string, notes = "") => ({
    status, notes, updated: Math.floor(Date.now() / 1000) - 7200, applied: status === "saved" ? null : Math.floor(Date.now() / 1000) - 9 * 86400,
    title: j.title, company: j.company, location: j.location, url: j.url, apply_url: j.apply_url,
    followed_up: null, remind_after: null, interview_at: null, contact: "", cv: "", sent_message: "",
  });
  tracks[a.id] = snap(a, "applied", "Sent CV EN + message on 20.10.");
  tracks[b.id] = snap(b, "saved");
  tracks[c.id] = snap(c, "interview", "Interview Thursday 10:00, NOI Techpark.");
  let settings: unknown = null;

  mockIPC(async (cmd, args) => {
    const p = args as Record<string, any>;
    switch (cmd) {
      case "get_settings":
        return (settings ??= {
          terms: ["Software", "Developer", "IT"], districts: [43, 50], include_noi: true, include_suedtiroler: true, onboard_companies: ["alpitronic"], onboard_local_only: true,
          onboarded: !location.search.includes("setup"), ai_base_url: "https://api.openai.com/v1", ai_model: "gpt-4o-mini", ai_consent: location.search.includes("chat"),
          person: { name: location.search.includes("setup") ? "" : "Alex Example", email: "", phone: "", links: "", level: "junior", roles: [], fields: location.search.includes("setup") ? [] : ["it"], job_types: [], languages: [{ lang: "English", level: "C1" }, { lang: "German", level: "A2" }], max_commute: 60, background: "" },
          profile: "Name: Alex Example\nLanguages: English C1, German A2",
          skills: ["C#", ".NET", "C", "C++", "Python", "JavaScript", "TypeScript", "Rust", "SQL", "HTML", "CSS", "React", "Git", "REST", "Windows", "Linux", "Networking", "IT Support"],
          auto_refresh_minutes: 60, notify_new: true, home_town: "Kaltern", vault_path: "", mirror_path: "", follow_up_days: 7, merge_duplicates: true, watched: [], hide_words: [], hide_companies: [], saved_views: [], weekly_goal: 5,
        });
      case "save_settings":
        settings = p.settings;
        return null;
      case "get_tracks":
        return tracks;
      case "set_track":
        if (p.track) tracks[p.id] = { ...p.track, updated: Math.floor(Date.now() / 1000) };
        else delete tracks[p.id];
        return tracks[p.id] ?? null;
      case "fetch_jobs":
        await new Promise((r) => setTimeout(r, 600));
        return { jobs: sample.jobs, errors: [] };
      case "read_cv":
        return "Alex Example\nalex@example.com | +39 333 123 4567\nEnglish C1, German A2\nPython, SQL, Git";
      case "get_ai_ranks":
        return {};
      case "import_ai_ranks":
        return { stored: (p.rankings as unknown[]).length };
      case "ai_has_key":
        return location.search.includes("chat");
      case "apply_ai_inbox":
        return 0;
      case "mcp_config":
        return "{}";
      case "ai_chat":
        await new Promise((r) => setTimeout(r, 500));
        return { messages: [{ role: "assistant", content: "Here's a sample answer." }], actions: ["Read your profile", "Searched jobs for \"developer\""], text: "Here's a sample answer. I saved a draft for you to review." };
      case "get_cached_jobs":
        return [];
      case "get_descriptions":
        return sample.descriptions;
      case "job_description":
        return (sample.descriptions as Record<string, string>)[p.id] ?? "";
      case "commutes":
        return Object.fromEntries(
          (p.locations as string[]).filter((l) => /boz|bol|mer|unterinn/i.test(l)).map((l) => {
            const town = /mer/i.test(l) ? "Meran" : /unterinn/i.test(l) ? "Unterinn" : "Bozen";
            const minutes = town === "Bozen" ? 26 : town === "Meran" ? 56 : 57;
            return [l, { town, minutes, changes: town === "Bozen" ? 0 : 1, modes: town === "Meran" ? "Bus › Regionalzug" : town === "Bozen" ? "Bus" : "Bus › Bus", fetched: 0 }];
          }),
        );
      case "plugin:notification|is_permission_granted":
        return false;
      default:
        return null;
    }
  });
}
