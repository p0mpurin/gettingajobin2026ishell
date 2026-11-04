//! Backup and restore of the user's own data: settings, tracked applications
//! (with notes), first-seen dates and saved posting text. The job list itself
//! isn't included; it's refetched.

use crate::export::iso_date;
use crate::store::{now, Data, Settings, Track};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

const APP: &str = "bolzano-jobs";
const FORMAT: u32 = 1;
/// Automatic daily backups kept in `<data>/backups`.
const KEEP: usize = 7;

#[derive(Serialize, Deserialize)]
struct Backup {
    app: String,
    format: u32,
    exported_at: u64,
    settings: Settings,
    tracks: HashMap<String, Track>,
    #[serde(default)]
    seen: HashMap<String, u64>,
    #[serde(default)]
    created: u64,
    #[serde(default)]
    descriptions: HashMap<String, String>,
}

#[derive(Serialize)]
pub struct RestoreSummary {
    pub tracks: usize,
    pub safety_copy: String,
}

pub fn to_json(data: &Data) -> String {
    let b = Backup {
        app: APP.into(),
        format: FORMAT,
        exported_at: now(),
        settings: data.settings.clone(),
        tracks: data.tracks.clone(),
        seen: data.seen.clone(),
        created: data.created,
        descriptions: data.descriptions.clone(),
    };
    serde_json::to_string_pretty(&b).expect("backup serialises")
}

/// Replaces settings and tracked applications with the backup's, and merges
/// first-seen dates and posting text. Fails without touching `data` if the
/// file isn't a Bolzano Jobs backup.
pub fn restore(data: &mut Data, json: &str) -> Result<usize, String> {
    let b: Backup = serde_json::from_str(json.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("Not a valid Bolzano Jobs backup ({e})"))?;
    if b.app != APP {
        return Err("This file isn't a Bolzano Jobs backup.".into());
    }
    if b.format > FORMAT {
        return Err("This backup was made by a newer version of Bolzano Jobs.".into());
    }
    data.settings = b.settings;
    let count = b.tracks.len();
    data.tracks = b.tracks;
    for (id, t) in b.seen {
        let e = data.seen.entry(id).or_insert(t);
        *e = (*e).min(t);
    }
    if b.created != 0 && (data.created == 0 || b.created < data.created) {
        data.created = b.created;
    }
    for (id, text) in b.descriptions {
        data.descriptions.entry(id).or_insert(text);
    }
    Ok(count)
}

/// File name of the always-current copy in the mirror folder.
pub const MIRROR_FILE: &str = "Bolzano Jobs backup.json";

/// Copies the backup into the user's mirror folder: one always-current file plus
/// one per day (newest 14 kept). Never replaces a mirror that holds tracked jobs
/// with one that holds none, so a wiped data folder can't wipe the mirror too.
pub fn mirror(folder: &Path, data: &Data) -> Result<std::path::PathBuf, String> {
    std::fs::create_dir_all(folder).map_err(|e| format!("{}: {e}", folder.display()))?;
    let latest = folder.join(MIRROR_FILE);
    if data.tracks.is_empty() {
        let had_tracks = std::fs::read_to_string(&latest)
            .ok()
            .and_then(|t| serde_json::from_str::<Backup>(t.trim_start_matches('﻿')).ok())
            .is_some_and(|b| !b.tracks.is_empty());
        if had_tracks {
            return Err("The mirror holds tracked jobs and the app has none; left it untouched. Restore from it in Settings.".into());
        }
    }
    let json = to_json(data);
    let tmp = folder.join(format!("{MIRROR_FILE}.tmp"));
    std::fs::write(&tmp, &json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &latest).map_err(|e| e.to_string())?;
    let _ = std::fs::write(folder.join(format!("Bolzano Jobs backup {}.json", iso_date(now()))), &json);
    let mut daily: Vec<_> = std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("Bolzano Jobs backup 2") && n.ends_with(".json")))
        .collect();
    daily.sort();
    while daily.len() > 14 {
        let _ = std::fs::remove_file(daily.remove(0));
    }
    Ok(latest)
}

/// Writes today's automatic backup if there isn't one yet, keeping the newest
/// KEEP files. Called on startup; failures are ignored (best effort).
pub fn auto(dir: &Path, data: &Data) {
    if data.tracks.is_empty() && data.settings.profile.is_empty() {
        return;
    }
    let folder = dir.join("backups");
    if std::fs::create_dir_all(&folder).is_err() {
        return;
    }
    let today = folder.join(format!("{}.json", iso_date(now())));
    if !today.exists() {
        let _ = std::fs::write(&today, to_json(data));
    }
    let mut daily: Vec<_> = std::fs::read_dir(&folder)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.len() == 15 && n.ends_with(".json")))
        .collect();
    daily.sort();
    while daily.len() > KEEP {
        let _ = std::fs::remove_file(daily.remove(0));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_tracks_and_settings() {
        let mut a = Data::default();
        a.settings.follow_up_days = 10;
        a.tracks.insert("ks-1".into(), Track { status: "applied".into(), notes: "hi".into(), ..Default::default() });
        a.seen.insert("ks-1".into(), 100);
        let json = to_json(&a);

        let mut b = Data::default();
        b.seen.insert("ks-1".into(), 50);
        assert_eq!(restore(&mut b, &json).unwrap(), 1);
        assert_eq!(b.settings.follow_up_days, 10);
        assert_eq!(b.tracks["ks-1"].notes, "hi");
        assert_eq!(b.seen["ks-1"], 50, "keeps the earlier first-seen date");
    }

    #[test]
    fn rejects_other_files_without_changes() {
        let mut d = Data::default();
        d.tracks.insert("x".into(), Track::default());
        assert!(restore(&mut d, r#"{"hello":1}"#).is_err());
        assert!(restore(&mut d, r#"{"app":"other","format":1,"exported_at":0,"settings":{},"tracks":{}}"#).is_err());
        assert_eq!(d.tracks.len(), 1, "data untouched after a failed restore");
    }

    #[test]
    fn mirror_never_overwrites_tracks_with_empty_state() {
        let dir = std::env::temp_dir().join(format!("bj-mirror-{}", now()));
        let mut d = Data::default();
        d.tracks.insert("x".into(), Track::default());
        mirror(&dir, &d).unwrap();
        assert!(mirror(&dir, &Data::default()).is_err());
        let kept = std::fs::read_to_string(dir.join(MIRROR_FILE)).unwrap();
        assert!(kept.contains("\"x\""));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 2, "latest + today's copy");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn auto_backup_keeps_one_per_day() {
        let dir = std::env::temp_dir().join(format!("bj-auto-{}", now()));
        let mut d = Data::default();
        d.tracks.insert("x".into(), Track::default());
        auto(&dir, &d);
        auto(&dir, &d);
        let files = std::fs::read_dir(dir.join("backups")).unwrap().count();
        assert_eq!(files, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
