use crate::sources::Job;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
            terms: ["Software", "Developer", "Entwickler", "IT", "Informatik", "Sviluppatore", "Web"]
                .map(String::from)
                .to_vec(),
            districts: vec![43, 50],
            include_noi: true,
            include_suedtiroler: true,
            onboard_companies: ["alpitronic", "acsgroup", "ris", "hogast-it", "unibz", "reguest"].map(String::from).to_vec(),
            onboard_local_only: true,
            profile: include_str!("default_profile.md").to_string(),
            skills: [
                "C#", ".NET", "C", "C++", "Python", "JavaScript", "TypeScript", "Rust", "SQL", "HTML",
                "CSS", "React", "Tailwind", "Tauri", "Flask", "Git", "GitHub", "WebRTC", "REST", "API",
                "Windows", "Linux", "Networking", "IT Support", "Debugging", "OOP",
            ]
            .map(String::from)
            .to_vec(),
            auto_refresh_minutes: 60,
            notify_new: true,
            home_town: "Kaltern".into(),
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
