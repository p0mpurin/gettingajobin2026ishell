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
  const [d, e] = sample.jobs.slice(3);
  tracks[d.id] = { ...snap(d, "saved"), queued: true };
  tracks[e.id] = { ...snap(e, "saved"), needs_you: "Do you have a valid work permit?" };
  if (location.search.includes("morning")) {
    const j = sample.jobs[6];
    tracks[j.id] = { ...snap(j, "saved"), morning_day: new Date().toISOString().slice(0, 10) };
  }
  let settings: unknown = null;
  const mailSuggestions = [{ id: "s1", company: "Loacker HR", subject: "Ihre Bewerbung bei Loacker", date: Math.floor(Date.now() / 1000) - 5 * 86400, kind: "rejection" }];

  mockIPC(async (cmd, args) => {
    const p = args as Record<string, any>;
    switch (cmd) {
      case "get_settings":
        return (settings ??= {
          terms: ["Software", "Developer", "IT"], districts: [43, 50], include_noi: true, include_suedtiroler: true, onboard_companies: ["alpitronic"], onboard_local_only: true,
          everyday_jobs: true, do_not_disturb: true, morning_queue: location.search.includes("morning"), morning_count: 3, ui_language: new URLSearchParams(location.search).get("lang") ?? "en", ai_tailor_cv: false, mail_enabled: false, mail_address: "", mail_host: "", mail_port: 993, mail_auto_update: true,
          cvs: [{ label: "CV English", language: "English", path: "C:\\CV\\cv-en.pdf" }], answers: [{ question: "When can you start?", answer: "From next month" }], ai_can_submit: false, ai_accept_privacy: false, ai_daily_limit: 10,
          onboarded: !location.search.includes("setup"), ai_provider: "", ai_base_url: "https://api.openai.com/v1", ai_model: "gpt-4o-mini", ai_consent: location.search.includes("chat"),
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
      case "autopilot_rules":
        return "1. Sample rules.";
      case "import_reports":
        return (p.reports as unknown[]).length;
      case "cli_status":
        return { installed: true, signed_in: p.provider === "claude", account: p.provider === "claude" ? "you@example.com · pro" : "" };
      case "tailor_cv":
        await new Promise((r) => setTimeout(r, 500));
        return { path: "C:\\cv.pdf", language: "German", removed: ["Skill \"Kubernetes\" isn't in your documents"], html: "<h1>Alex Example</h1><p>Junior developer</p>" };
      case "mail_connect":
        (settings as any).mail_enabled = true;
        (settings as any).mail_address = p.address;
        return null;
      case "mail_disconnect":
        (settings as any).mail_enabled = false;
        return null;
      case "mail_sync":
        return { checked: 120, updates: [], suggestions: 1 };
      case "mail_suggestions":
        return mailSuggestions;
      case "mail_resolve":
        mailSuggestions.splice(0);
        return null;
      case "game_running":
        return false;
      case "site_memory":
        return { "acme.onboard.org": { runs: 3, sent: 1, handed_over: 2, has_captcha: true } };
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
