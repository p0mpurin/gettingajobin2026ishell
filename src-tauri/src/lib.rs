mod backup;
mod commute;
mod export;
mod sources;
mod store;

use futures::stream::{self, StreamExt};
use sources::Job;
use std::collections::HashMap;
use std::sync::Mutex;
use store::{Settings, Store, Track};
use tauri::{Manager, State};

pub struct AppState {
    store: Mutex<Store>,
    client: reqwest::Client,
}

#[derive(serde::Serialize)]
pub struct FetchResult {
    jobs: Vec<Job>,
    errors: Vec<String>,
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.store.lock().unwrap().data.settings.clone()
}

#[tauri::command]
fn save_settings(state: State<AppState>, settings: Settings) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.data.settings = settings;
    store.save()?;
    store.mirror();
    Ok(())
}

/// Writes the mirror copy now and returns its path (used by the Settings button).
#[tauri::command]
fn mirror_now(state: State<AppState>) -> Result<String, String> {
    let store = state.store.lock().unwrap();
    let folder = store.data.settings.mirror_path.trim();
    if folder.is_empty() {
        return Err("Choose a mirror folder first.".into());
    }
    backup::mirror(std::path::Path::new(folder), &store.data).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_tracks(state: State<AppState>) -> HashMap<String, Track> {
    state.store.lock().unwrap().data.tracks.clone()
}

/// Creates, updates or (with `None`) removes the tracking record for a job.
#[tauri::command]
fn set_track(state: State<AppState>, id: String, track: Option<Track>) -> Result<Option<Track>, String> {
    let mut store = state.store.lock().unwrap();
    let result = match track {
        Some(mut t) => {
            t.updated = store::now();
            if t.applied.is_none() && matches!(t.status.as_str(), "applied" | "interview" | "offer") {
                t.applied = Some(t.updated);
            }
            store.data.tracks.insert(id, t.clone());
            Some(t)
        }
        None => {
            store.data.tracks.remove(&id);
            None
        }
    };
    store.save()?;
    store.mirror();
    Ok(result)
}

#[tauri::command]
async fn fetch_jobs(state: State<'_, AppState>) -> Result<FetchResult, String> {
    let settings = state.store.lock().unwrap().data.settings.clone();
    let (karriere, noi, stj, onboard) = tokio::join!(
        sources::karriere::fetch(&state.client, &settings),
        async {
            if settings.include_noi {
                Some(sources::noi::fetch(&state.client).await)
            } else {
                None
            }
        },
        async {
            if settings.include_suedtiroler {
                Some(sources::suedtiroler::fetch(&state.client, &settings).await)
            } else {
                None
            }
        },
        sources::onboard::fetch(&state.client, &settings)
    );

    let mut jobs = Vec::new();
    let mut errors = Vec::new();
    match karriere {
        Ok(mut j) => jobs.append(&mut j),
        Err(e) => errors.push(format!("karriere-suedtirol.com: {e}")),
    }
    match noi {
        Some(Ok(mut j)) => jobs.append(&mut j),
        Some(Err(e)) => errors.push(format!("noi.bz.it: {e}")),
        None => {}
    }
    match stj {
        Some(Ok(mut j)) => jobs.append(&mut j),
        Some(Err(e)) => errors.push(format!("suedtirolerjobs.it: {e}")),
        None => {}
    }
    match onboard {
        Ok(mut j) => jobs.append(&mut j),
        Err(e) => errors.push(format!("company sites: {e}")),
    }

    let mut store = state.store.lock().unwrap();
    store.annotate(&mut jobs);
    // Keep the last good list; a fetch where every source failed shouldn't wipe it.
    if !jobs.is_empty() {
        store.data.jobs = jobs.clone();
    }
    store.save()?;
    Ok(FetchResult { jobs, errors })
}

/// Full posting text, served from the cache after the first load.
/// Commute from the home town to each job location the planner knows, keyed by
/// location. Uncached towns are looked up two at a time; failures are skipped.
#[tauri::command]
async fn commutes(state: State<'_, AppState>, locations: Vec<String>) -> Result<HashMap<String, commute::Commute>, String> {
    let (home, cached) = {
        let store = state.store.lock().unwrap();
        let s = &store.data.settings;
        (commute::town_of(&s.home_town).map(String::from).unwrap_or_else(|| s.home_town.trim().to_string()), store.data.commutes.clone())
    };
    if home.is_empty() {
        return Ok(HashMap::new());
    }
    let towns: Vec<String> = {
        let mut t: Vec<String> = locations
            .iter()
            .filter_map(|l| commute::town_of(l))
            .filter(|town| {
                cached
                    .get(&format!("{home}|{town}"))
                    .is_none_or(|c| store::now().saturating_sub(c.fetched) >= commute::MAX_AGE)
            })
            .map(String::from)
            .collect();
        t.sort();
        t.dedup();
        t
    };
    let client = state.client.clone();
    let found: Vec<(String, Result<commute::Commute, String>)> = stream::iter(towns)
        .map(|town| {
            let client = client.clone();
            let home = home.clone();
            async move {
                let r = commute::lookup(&client, &home, &town).await;
                (town, r)
            }
        })
        .buffer_unordered(2)
        .collect()
        .await;
    let key = |town: &str| format!("{home}|{town}");
    let mut store = state.store.lock().unwrap();
    for (town, r) in found {
        if let Ok(c) = r {
            store.data.commutes.insert(key(&town), c);
        }
    }
    store.save()?;
    Ok(locations
        .into_iter()
        .filter_map(|l| {
            let c = store.data.commutes.get(&key(commute::town_of(&l)?))?.clone();
            Some((l, c))
        })
        .collect())
}

#[tauri::command]
async fn job_description(state: State<'_, AppState>, id: String, url: String, refresh: Option<bool>) -> Result<String, String> {
    if !refresh.unwrap_or(false) {
        if let Some(text) = state.store.lock().unwrap().data.descriptions.get(&id) {
            return Ok(text.clone());
        }
    }
    let text = if let Some(ks_id) = id.strip_prefix("ks-") {
        sources::karriere::description(&state.client, ks_id).await?
    } else if id.starts_with("ob-") {
        sources::onboard::description(&state.client, &url).await?
    } else if id.starts_with("stj-") {
        sources::suedtiroler::description(&state.client, &url).await?
    } else {
        sources::noi::description(&state.client, &url).await?
    };
    let mut store = state.store.lock().unwrap();
    store.data.descriptions.insert(id, text.clone());
    store.save()?;
    Ok(text)
}

/// The jobs from the last fetch, re-annotated so "new" stays accurate.
#[tauri::command]
fn get_cached_jobs(state: State<AppState>) -> Vec<Job> {
    let mut store = state.store.lock().unwrap();
    let mut jobs = store.data.jobs.clone();
    store.annotate(&mut jobs);
    jobs
}

#[tauri::command]
fn get_descriptions(state: State<AppState>) -> HashMap<String, String> {
    state.store.lock().unwrap().data.descriptions.clone()
}

/// Stores posting text the user pasted for a job the app can't read itself.
#[tauri::command]
fn save_description(state: State<AppState>, id: String, text: String) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.data.descriptions.insert(id, text);
    store.save()
}

#[tauri::command]
fn export_tracks(state: State<AppState>, path: String, format: String) -> Result<usize, String> {
    let store = state.store.lock().unwrap();
    let (body, count) = match format.as_str() {
        "csv" => export::csv(&store.data.tracks),
        _ => export::markdown(&store.data.tracks),
    };
    std::fs::write(&path, body).map_err(|e| format!("{path}: {e}"))?;
    Ok(count)
}

#[tauri::command]
fn export_backup(state: State<AppState>, path: String) -> Result<usize, String> {
    let store = state.store.lock().unwrap();
    std::fs::write(&path, backup::to_json(&store.data)).map_err(|e| format!("{path}: {e}"))?;
    Ok(store.data.tracks.len())
}

/// Restores a backup file. The current data is first copied to
/// backups/before-restore-<time>.json so a restore can always be undone.
#[tauri::command]
fn import_backup(state: State<AppState>, path: String) -> Result<backup::RestoreSummary, String> {
    let json = std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
    let mut store = state.store.lock().unwrap();
    let folder = store.dir().join("backups");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let safety = folder.join(format!("before-restore-{}.json", store::now()));
    // Validate first on a copy, so a bad file leaves everything untouched.
    let mut trial = serde_json::from_str::<store::Data>(&serde_json::to_string(&store.data).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let tracks = backup::restore(&mut trial, &json)?;
    std::fs::write(&safety, backup::to_json(&store.data)).map_err(|e| e.to_string())?;
    store.data = trial;
    store.save()?;
    Ok(backup::RestoreSummary { tracks, safety_copy: safety.to_string_lossy().into_owned() })
}

/// Opens the folder holding state.json and backups/ in Explorer.
#[tauri::command]
fn open_data_folder(state: State<AppState>) -> Result<(), String> {
    let dir = state.store.lock().unwrap().dir();
    std::process::Command::new("explorer").arg(&dir).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Writes a text file the user chose in a save dialog (e.g. a calendar .ics).
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

/// Portable mode: a `PORTABLE.txt` file next to the exe means all data
/// (jobs, settings, window position, WebView storage) lives in a
/// `Bolzano Jobs Data` folder beside it instead of in %APPDATA%.
///
/// `BOLZANO_JOBS_DATA=<folder>` overrides both, so tests and demos run against
/// a throwaway folder and never touch the user's real data.
fn portable_dir() -> Option<std::path::PathBuf> {
    if let Some(dir) = std::env::var_os("BOLZANO_JOBS_DATA").filter(|d| !d.is_empty()) {
        return Some(dir.into());
    }
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    exe_dir.join("PORTABLE.txt").is_file().then(|| exe_dir.join("Bolzano Jobs Data"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let portable = portable_dir();
    tauri::Builder::default()
        // Must come first: a second launch focuses the running window instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin({
            let ws = tauri_plugin_window_state::Builder::default();
            match &portable {
                // An absolute path replaces the plugin's default config-dir location.
                Some(dir) => ws.with_filename(dir.join("window-state.json").to_string_lossy()),
                None => ws,
            }
            .build()
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            let dir = match &portable {
                Some(dir) => dir.clone(),
                None => app.path().app_data_dir()?,
            };
            // The window is created here (not from config) so portable mode can
            // keep the WebView's own data next to the exe as well.
            let config = app.config().app.windows[0].clone();
            let mut window = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
            if let Some(dir) = &portable {
                window = window.data_directory(dir.join("webview"));
            }
            window.build()?;
            let client = reqwest::Client::builder()
                .user_agent("BolzanoJobs/1.4 (personal job search app)")
                .timeout(std::time::Duration::from_secs(20))
                .build()?;
            let store = Store::load(dir.clone());
            backup::auto(&dir, &store.data);
            store.mirror();
            app.manage(AppState { store: Mutex::new(store), client });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            mirror_now,
            commutes,
            save_settings,
            get_tracks,
            set_track,
            fetch_jobs,
            job_description,
            save_description,
            get_descriptions,
            get_cached_jobs,
            export_tracks,
            export_backup,
            import_backup,
            open_data_folder,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
