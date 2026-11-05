use crate::sources::Job;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// v2: spaces around inline tags are preserved in posting text.
const CACHE_VERSION: u32 = 2;

pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Settings {
    /// Search terms sent to karriere-suedtirol.com; results are merged.
    pub terms: Vec<String>,
    /// karriere-suedtirol.com district ids (43 = Bozen & Umgebung, 50 = Überetsch & Unterland, ...).
    pub districts: Vec<u32>,
    pub include_noi: bool,
    pub include_suedtiroler: bool,
    /// onboard.org company subdomains to read career pages from.
    pub onboard_companies: Vec<String>,
    /// Keep only company-portal jobs located in South Tyrol.
    pub onboard_local_only: bool,
    /// Everything about the user that goes into the AI email prompt.
    pub profile: String,
    /// Skills used for the match score.
    pub skills: Vec<String>,
    /// 0 = off.
    pub auto_refresh_minutes: u32,
    pub notify_new: bool,
    /// Home town for public-transport commute times (German or Italian name).
    pub home_town: String,
    /// Setup has been completed (or skipped by an existing user).
    pub onboarded: bool,
    /// Structured profile from setup; `profile` is the text built from it.
    pub person: Person,
    /// How the AI is reached: "claude" and "codex" use the official app's sign-in,
    /// "key" or empty uses the API key below.
    pub ai_provider: String,
    /// OpenAI-compatible service for the built-in assistant.
    pub ai_base_url: String,
    pub ai_model: String,
    /// The user has confirmed what gets shared with that service.
    pub ai_consent: bool,
    /// Search and rank everyday jobs too: reception, help desk, office, sales.
    pub everyday_jobs: bool,
    /// Pause AI work while a game or anything else runs full screen.
    pub do_not_disturb: bool,
    /// Prepare the day's best matches for one-tap approval.
    pub morning_queue: bool,
    pub morning_count: u32,
    /// "en", "de" or "it".
    pub ui_language: String,
    /// Easy Apply writes a CV for each job from the user's documents first.
    pub ai_tailor_cv: bool,
    /// Mailbox read for replies, read-only. The app password is in Credential Manager.
    pub mail_enabled: bool,
    pub mail_address: String,
    pub mail_host: String,
    pub mail_port: u16,
    /// Replies move jobs in the pipeline, not just get recorded.
    pub mail_auto_update: bool,
    /// CVs an AI agent may upload. Only paths; the files stay where they are.
    pub cvs: Vec<CvFile>,
    /// Answers to application questions, given by the user.
    pub answers: Vec<SavedAnswer>,
    /// Agents may press the final submit button themselves.
    pub ai_can_submit: bool,
    /// Agents may tick a form's required privacy notice.
    pub ai_accept_privacy: bool,
    /// Most applications an agent may submit per day.
    pub ai_daily_limit: u32,
    /// Where "Export to Obsidian" writes Applications.md.
    pub vault_path: String,
    /// A second folder (e.g. OneDrive) that gets a copy of the backup on every change.
    pub mirror_path: String,
    /// Remind to follow up this many days after applying (0 = off).
    pub follow_up_days: u32,
    /// Fold re-posted and bilingual copies of the same job into one row.
    pub merge_duplicates: bool,
    /// Companies to watch (normalised names); new jobs from them notify specially.
    pub watched: Vec<String>,
    /// Jobs whose title contains one of these words are hidden (e.g. "Senior").
    pub hide_words: Vec<String>,
    /// Every job from these companies is hidden.
    pub hide_companies: Vec<String>,
    /// Named filter combinations shown above the job list.
    pub saved_views: Vec<SavedView>,
    /// Applications per week to aim for (0 = no goal).
    pub weekly_goal: u32,
}

/// What setup asks for. Everything but the name is optional.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Person {
    pub name: String,
    pub email: String,
    pub phone: String,
    pub links: String,
    /// "student" | "junior" | "mid" | "senior", or empty.
    pub level: String,
    /// Job titles the user wants, in their own words.
    pub roles: Vec<String>,
    /// Fields of work, ids from lib/fields.ts.
    pub fields: Vec<String>,
    pub job_types: Vec<String>,
    pub languages: Vec<LanguageLevel>,
    /// Longest acceptable public-transport trip in minutes (0 = don't mind).
    pub max_commute: u32,
    /// CV text or a free description of their experience.
    pub background: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct LanguageLevel {
    pub lang: String,
    pub level: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct CvFile {
    pub label: String,
    /// The language it's written in, e.g. "English".
    pub language: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct SavedAnswer {
    pub question: String,
    pub answer: String,
}

/// What past runs learned about one site.
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub struct SiteMemory {
    pub runs: u32,
    pub sent: u32,
    pub handed_over: u32,
    pub has_captcha: bool,
    /// Buttons pressed on the way to the form in the last run that got there.
    pub steps: Vec<String>,
    pub last_note: String,
}

/// A reply about an application. Holds no message text, only what's needed to show it.
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub struct MailEvent {
    pub message_id: String,
    pub date: u64,
    pub from: String,
    pub subject: String,
    /// "rejection" | "interview" | "offer" | "received" | "other".
    pub kind: String,
    pub job_id: String,
    /// Set when this moved the job, so it can be undone.
    pub previous_status: String,
    pub moved_to: String,
}

/// A reply from a company the app doesn't know about: possibly a past application.
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub struct MailSuggestion {
    pub id: String,
    pub company: String,
    pub subject: String,
    pub date: u64,
    pub kind: String,
}

/// An AI's opinion of one job for the For You feed.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct AiRank {
    pub score: u32,
    pub reason: String,
    pub at: u64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct SavedView {
    pub name: String,
    pub filter: String,
    pub source: String,
    pub german: String,
    pub sort: String,
    pub query: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            // Setup fills in the search terms; with none, every job is listed.
            terms: Vec::new(),
            districts: vec![43, 50, 44, 45, 48, 51, 46, 47],
            include_noi: true,
            include_suedtiroler: true,
            onboard_companies: ["alpitronic", "acsgroup", "ris", "hogast-it", "unibz", "reguest"].map(String::from).to_vec(),
            onboard_local_only: true,
            profile: String::new(),
            skills: Vec::new(),
            auto_refresh_minutes: 60,
            notify_new: true,
            home_town: String::new(),
            onboarded: false,
            person: Person::default(),
            ai_provider: String::new(),
            ai_base_url: "https://api.openai.com/v1".into(),
            ai_model: "gpt-4o-mini".into(),
            ai_consent: false,
            everyday_jobs: true,
            do_not_disturb: true,
            morning_queue: false,
            morning_count: 5,
            ui_language: "en".into(),
            ai_tailor_cv: false,
            mail_enabled: false,
            mail_address: String::new(),
            mail_host: String::new(),
            mail_port: 993,
            mail_auto_update: true,
            cvs: Vec::new(),
            answers: Vec::new(),
            ai_can_submit: false,
            ai_accept_privacy: false,
            ai_daily_limit: 10,
            vault_path: String::new(),
            mirror_path: String::new(),
            follow_up_days: 7,
            merge_duplicates: true,
            watched: Vec::new(),
            hide_words: Vec::new(),
            hide_companies: Vec::new(),
            saved_views: Vec::new(),
            weekly_goal: 5,
        }
    }
}

/// A job the user is tracking. Keeps a snapshot of the listing so the
/// pipeline still works after the posting disappears from the sources.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Track {
    /// "saved" | "applied" | "interview" | "offer" | "rejected" | "hidden".
    pub status: String,
    pub notes: String,
    pub updated: u64,
    pub applied: Option<u64>,
    pub title: String,
    pub company: String,
    pub location: String,
    pub url: String,
    pub apply_url: Option<String>,
    /// When the user last followed up on this application.
    pub followed_up: Option<u64>,
    /// Snoozed follow-up reminder: don't remind before this time.
    pub remind_after: Option<u64>,
    /// Interview start, unix seconds.
    pub interview_at: Option<u64>,
    /// Contact person (name, email, phone) at the company.
    pub contact: String,
    /// Which CV version was sent, e.g. "EN", "IT", "DE".
    pub cv: String,
    /// The application message that was sent.
    pub sent_message: String,
    /// Why the user said "Not for me", which teaches the For You feed.
    pub hide_reason: String,
    /// A draft waiting for review. Nothing here has been sent.
    pub draft_subject: String,
    pub draft_message: String,
    pub draft_to: String,
    pub draft_cv: String,
    /// Waiting for an AI agent to apply.
    pub queued: bool,
    /// What an agent needs from the user before this can go further.
    pub needs_you: String,
    /// "ai" when an agent reported submitting this application.
    pub applied_by: String,
    /// A CV written for this job, and its language.
    pub tailored_cv: String,
    pub tailored_language: String,
    /// The day (YYYY-MM-DD) this was prepared in the morning queue, until decided.
    pub morning_day: String,
    /// Replies found in the mailbox.
    pub mails: Vec<MailEvent>,
}

#[derive(Serialize, Deserialize, Default)]
pub struct Data {
    #[serde(default)]
    pub settings: Settings,
    /// Job id -> unix seconds when it was first seen.
    #[serde(default)]
    pub seen: HashMap<String, u64>,
    #[serde(default)]
    pub tracks: HashMap<String, Track>,
    /// Posting text cache, job id -> plain text.
    #[serde(default)]
    pub descriptions: HashMap<String, String>,
    /// Bumped when the posting-text format changes, to drop stale cache entries.
    #[serde(default)]
    pub cache_version: u32,
    /// Last fetched job list, shown instantly on the next start.
    #[serde(default)]
    pub jobs: Vec<Job>,
    /// Unix seconds of the first fetch; jobs found then are never "new".
    #[serde(default)]
    pub created: u64,
    /// Commute cache, "Home|Town" -> trip summary.
    #[serde(default)]
    pub commutes: HashMap<String, crate::commute::Commute>,
    /// AI rankings for the For You feed, job id -> rank.
    #[serde(default)]
    pub ai_ranks: HashMap<String, AiRank>,
    /// What's been learned per website, by host name.
    #[serde(default)]
    pub sites: HashMap<String, SiteMemory>,
    /// Mail already looked at, by message id.
    #[serde(default)]
    pub mail_seen: HashSet<String>,
    /// Suggestions the user said no to, by company.
    #[serde(default)]
    pub mail_dismissed: HashSet<String>,
    #[serde(default)]
    pub mail_suggestions: Vec<MailSuggestion>,
    /// Unix seconds of the last mailbox check.
    #[serde(default)]
    pub mail_last_sync: u64,
    /// Legacy v0.1 field (job id -> status), migrated into `tracks` on load.
    #[serde(default, skip_serializing)]
    status: HashMap<String, String>,
}

pub struct Store {
    path: PathBuf,
    pub data: Data,
}

impl Store {
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("state.json");
        let mut data: Data = match std::fs::read_to_string(&path) {
            Err(_) => Data::default(), // first run
            Ok(text) => serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap_or_else(|_| {
                // Never let a damaged file be silently overwritten by an empty
                // state: keep it aside so it can be recovered.
                let _ = std::fs::rename(&path, dir.join(format!("state.corrupt-{}.json", now())));
                Data::default()
            }),
        };
        for (id, status) in std::mem::take(&mut data.status) {
            data.tracks.entry(id).or_insert(Track { status, updated: now(), ..Default::default() });
        }
        if data.created == 0 {
            data.created = data.seen.values().copied().min().unwrap_or(0);
        }
        if data.cache_version < CACHE_VERSION {
            data.descriptions.clear();
            data.cache_version = CACHE_VERSION;
        }
        // Anyone with a profile or applications from before setup existed keeps
        // their data and doesn't get sent through setup.
        if !data.settings.onboarded && (!data.tracks.is_empty() || !data.settings.profile.trim().is_empty()) {
            data.settings.onboarded = true;
        }
        Self { path, data }
    }

    /// Best-effort copy of the backup to the user's mirror folder, if set.
    pub fn mirror(&self) {
        let folder = self.data.settings.mirror_path.trim();
        if !folder.is_empty() {
            let _ = crate::backup::mirror(std::path::Path::new(folder), &self.data);
        }
    }

    /// The folder holding state.json (and backups/).
    pub fn dir(&self) -> PathBuf {
        self.path.parent().map(PathBuf::from).unwrap_or_default()
    }

    pub fn save(&self) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string(&self.data).map_err(|e| e.to_string())?;
        // Write then rename so a crash never leaves a half-written state file.
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
    }

    /// Marks jobs first seen within the last 24 hours as new, records unseen
    /// jobs, and fills empty track snapshots from the live listing.
    pub fn annotate(&mut self, jobs: &mut [Job]) {
        let now = now();
        if self.data.created == 0 {
            self.data.created = now;
        }
        // Jobs found during the first hour of use are the baseline, not news.
        let baseline = self.data.created + 3600;
        for job in jobs.iter_mut() {
            let first_seen = *self.data.seen.entry(job.id.clone()).or_insert(now);
            job.first_seen = first_seen;
            job.is_new = first_seen > baseline && now.saturating_sub(first_seen) < 24 * 3600;
            if let Some(t) = self.data.tracks.get_mut(&job.id) {
                if t.title.is_empty() {
                    t.title = job.title.clone();
                    t.company = job.company.clone();
                    t.location = job.location.clone();
                    t.url = job.url.clone();
                    t.apply_url = job.apply_url.clone();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(id: &str) -> Job {
        Job {
            id: id.into(),
            source: "karriere-suedtirol".into(),
            title: "Dev".into(),
            company: String::new(),
            location: String::new(),
            url: String::new(),
            apply_url: None,
            published: None,
            salary: None,
            tags: vec![],
            junior: false,
            is_new: false,
            first_seen: 0,
        }
    }

    #[test]
    fn first_fetch_is_baseline_and_later_jobs_are_new() {
        let mut store = Store { path: std::env::temp_dir().join("bj-test.json"), data: Data::default() };
        let mut first = vec![job("a")];
        store.annotate(&mut first);
        assert!(!first[0].is_new, "jobs from the first fetch are not new");

        // Pretend the first fetch happened two hours ago.
        store.data.created -= 7200;
        store.data.seen.insert("a".into(), store.data.created);
        let mut later = vec![job("a"), job("b")];
        store.annotate(&mut later);
        assert!(!later[0].is_new);
        assert!(later[1].is_new, "a job first seen after the baseline is new");
    }

    #[test]
    fn keeps_a_damaged_state_file_instead_of_overwriting_it() {
        let dir = std::env::temp_dir().join(format!("bj-corrupt-{}", now()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("state.json"), "{ not json").unwrap();
        let store = Store::load(dir.clone());
        assert!(store.data.tracks.is_empty());
        let kept = std::fs::read_dir(&dir).unwrap().flatten().any(|e| e.file_name().to_string_lossy().starts_with("state.corrupt-"));
        assert!(kept, "the damaged file is kept aside");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn migrates_legacy_status_map() {
        let dir = std::env::temp_dir().join("bj-migrate");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("state.json"), r#"{"seen":{"ks-1":100},"status":{"ks-1":"applied"}}"#).unwrap();
        let store = Store::load(dir);
        assert_eq!(store.data.tracks["ks-1"].status, "applied");
        assert_eq!(store.data.created, 100);
    }
}
