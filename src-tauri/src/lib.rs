mod ai;
mod backup;
mod browser;
mod cli;
mod commute;
mod export;
mod focus;
mod mail;
mod mcp;
mod sources;
mod store;
mod tailor;
mod tools;

use futures::stream::{self, StreamExt};
use sources::Job;
use std::collections::HashMap;
use std::sync::Mutex;
use store::{Settings, Store, Track};
use tauri::{Manager, State};

pub struct AppState {
    store: Mutex<Store>,
    client: reqwest::Client,
    /// Set to stop the Easy Apply AI at its next step.
    apply_stop: std::sync::atomic::AtomicBool,
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
    // Exactly the user's terms: a term they removed stays removed.
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
    let text = sources::posting_text(&state.client, &id, &url).await?;
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

/// Text of a CV the user picked: PDF, or plain text and Markdown.
#[tauri::command]
fn read_cv(path: String) -> Result<String, String> {
    const MAX_BYTES: u64 = 15 * 1024 * 1024;
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_BYTES {
        return Err("That file is too large to be a CV.".into());
    }
    if path.to_lowercase().ends_with(".pdf") {
        // The PDF reader can panic on unusual files; that shouldn't end the app.
        let parsed = std::panic::catch_unwind(|| pdf_extract::extract_text(&path));
        let text = match parsed {
            Ok(Ok(t)) => t,
            _ => return Err("Couldn't read that PDF. Paste the text instead.".into()),
        };
        if text.trim().is_empty() {
            return Err("That PDF has no readable text (it may be a scan). Paste the text instead.".into());
        }
        return Ok(text);
    }
    std::fs::read_to_string(&path).map_err(|_| "Couldn't read that file. Use a PDF or a text file, or paste the text.".to_string())
}

#[tauri::command]
fn get_ai_ranks(state: State<AppState>) -> HashMap<String, store::AiRank> {
    state.store.lock().unwrap().data.ai_ranks.clone()
}

/// Stores a ranking the user pasted back from an AI. Same rules as the tool.
#[tauri::command]
fn import_ai_ranks(state: State<AppState>, rankings: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut store = state.store.lock().unwrap();
    let result = tools::write(&mut store.data, "rank_jobs", &serde_json::json!({ "rankings": rankings }))?;
    store.save()?;
    Ok(result)
}

/// Applies to one job in the live webview. Resolves when it's sent or the user is needed.
#[tauri::command]
async fn apply_start(app: tauri::AppHandle, state: State<'_, AppState>, id: String, bounds: browser::Bounds) -> Result<browser::Outcome, String> {
    browser::apply(&app, &state.store, &state.client, &state.apply_stop, &id, bounds).await
}

#[tauri::command]
fn apply_stop(state: State<AppState>) {
    state.apply_stop.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
async fn browser_place(app: tauri::AppHandle, bounds: browser::Bounds) -> Result<(), String> {
    browser::place(&app, bounds)
}

#[tauri::command]
async fn browser_close(app: tauri::AppHandle) -> Result<(), String> {
    browser::close(&app)
}

/// Writes a CV for one job from the user's real documents.
#[tauri::command]
async fn tailor_cv(state: State<'_, AppState>, id: String) -> Result<tailor::Tailored, String> {
    tailor::tailor(&state.client, &state.store, &id).await
}

/// Opens a generated CV. Only ones this app wrote, in its own folder.
#[tauri::command]
fn open_tailored(state: State<AppState>, path: String) -> Result<(), String> {
    let folder = state.store.lock().unwrap().dir().join("tailored");
    let wanted = std::path::Path::new(&path).canonicalize().map_err(|e| e.to_string())?;
    if !wanted.starts_with(folder.canonicalize().map_err(|e| e.to_string())?) {
        return Err("Not a CV from this app.".into());
    }
    std::process::Command::new("explorer").arg(&wanted).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Checks the mailbox login works, then remembers it.
#[tauri::command]
async fn mail_connect(state: State<'_, AppState>, address: String, host: String, password: String) -> Result<(), String> {
    let (a, h, p) = (address.trim().to_string(), host.trim().to_string(), password.trim().replace(' ', ""));
    let (a2, h2, p2) = (a.clone(), h.clone(), p.clone());
    tokio::task::spawn_blocking(move || mail::test_login(&h2, 993, &a2, &p2)).await.map_err(|e| e.to_string())??;
    ai::set_mail_password(&p)?;
    let mut store = state.store.lock().unwrap();
    let s = &mut store.data.settings;
    s.mail_enabled = true;
    s.mail_address = a;
    s.mail_host = h;
    s.mail_port = 993;
    store.save()
}

#[tauri::command]
fn mail_disconnect(state: State<AppState>) -> Result<(), String> {
    ai::clear_mail_password()?;
    let mut store = state.store.lock().unwrap();
    store.data.settings.mail_enabled = false;
    store.save()
}

/// Looks for new replies, read-only, and updates the pipeline.
#[tauri::command]
async fn mail_sync(state: State<'_, AppState>) -> Result<mail::SyncReport, String> {
    let (host, port, user, auto, days, snapshot) = {
        let store = state.store.lock().unwrap();
        let d = &store.data;
        let s = &d.settings;
        if !s.mail_enabled {
            return Err("Connect your email first.".into());
        }
        // The first look goes further back, to find applications made elsewhere.
        let days = if d.mail_last_sync == 0 { 90 } else { 14 };
        let mut snapshot = store::Data::default();
        snapshot.tracks = d.tracks.clone();
        snapshot.mail_seen = d.mail_seen.clone();
        (s.mail_host.clone(), s.mail_port, s.mail_address.clone(), s.mail_auto_update, days, snapshot)
    };
    let password = ai::get_mail_password()?;
    let (checked, found) = tokio::task::spawn_blocking(move || mail::fetch(&host, port, &user, &password, days, &snapshot)).await.map_err(|e| e.to_string())??;
    let mut report = mail::SyncReport { checked, ..Default::default() };
    let mut store = state.store.lock().unwrap();
    mail::apply(&mut store.data, found, auto, &mut report);
    store.data.mail_last_sync = store::now();
    store.save()?;
    store.mirror();
    Ok(report)
}

/// Puts a job back where it was before a reply moved it.
#[tauri::command]
fn mail_undo(state: State<AppState>, id: String, message_id: String) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    let track = store.data.tracks.get_mut(&id).ok_or("That job is gone.")?;
    let event = track.mails.iter_mut().find(|m| m.message_id == message_id).ok_or("That reply is gone.")?;
    if !event.previous_status.is_empty() {
        track.status = std::mem::take(&mut event.previous_status);
        event.moved_to.clear();
    }
    store.save()
}

#[tauri::command]
fn mail_suggestions(state: State<AppState>) -> Vec<store::MailSuggestion> {
    state.store.lock().unwrap().data.mail_suggestions.clone()
}

#[tauri::command]
fn mail_resolve(state: State<AppState>, id: String, accept: bool) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    mail::resolve_suggestion(&mut store.data, &id, accept)?;
    store.save()?;
    store.mirror();
    Ok(())
}

/// One request to the connected AI with no tools: understanding preferences, ranking.
#[tauri::command]
async fn ai_one_shot(state: State<'_, AppState>, system: String, prompt: String) -> Result<String, String> {
    ai::one_shot(&state.client, &state.store, &system, &prompt).await
}

#[tauri::command]
fn game_running() -> bool {
    focus::game_running()
}

#[tauri::command]
fn site_memory(state: State<AppState>) -> HashMap<String, store::SiteMemory> {
    state.store.lock().unwrap().data.sites.clone()
}

fn cli_of(provider: &str) -> Result<cli::Cli, String> {
    cli::parse(provider).ok_or_else(|| format!("Unknown sign-in {provider}"))
}

#[tauri::command]
async fn cli_status(provider: String) -> Result<cli::Status, String> {
    Ok(cli::status(cli_of(&provider)?).await)
}

#[tauri::command]
fn cli_sign_in(provider: String) -> Result<(), String> {
    cli::sign_in(cli_of(&provider)?)
}

#[tauri::command]
fn cli_install(provider: String) -> Result<(), String> {
    cli::install(cli_of(&provider)?)
}

/// The rules agents get, for the brief the user can paste into any AI.
#[tauri::command]
fn autopilot_rules() -> &'static str {
    tools::RULES
}

/// Records results pasted back from an AI, one job at a time, by the same rules
/// as the connector. Returns how many were recorded.
#[tauri::command]
fn import_reports(state: State<AppState>, reports: Vec<serde_json::Value>) -> Result<usize, String> {
    let mut store = state.store.lock().unwrap();
    let recorded = reports.iter().filter(|r| tools::write(&mut store.data, "report_application", r).is_ok()).count();
    store.save()?;
    store.mirror();
    Ok(recorded)
}

#[tauri::command]
fn clear_ai_ranks(state: State<AppState>) -> Result<(), String> {
    let mut store = state.store.lock().unwrap();
    store.data.ai_ranks.clear();
    store.save()
}

#[tauri::command]
async fn ai_chat(state: State<'_, AppState>, messages: Vec<serde_json::Value>) -> Result<ai::ChatReply, String> {
    ai::chat_with_settings(&state.client, &state.store, messages).await
}

#[tauri::command]
fn ai_set_key(key: String) -> Result<(), String> {
    ai::set_key(&key)
}

#[tauri::command]
fn ai_has_key() -> bool {
    ai::has_key()
}

#[tauri::command]
fn ai_clear_key() -> Result<(), String> {
    ai::clear_key()
}

/// Applies rankings, saves and drafts waiting from the MCP connector.
/// Returns how many arrived, so the UI can reload and say so.
#[tauri::command]
fn apply_ai_inbox(state: State<AppState>) -> Result<usize, String> {
    let mut store = state.store.lock().unwrap();
    let dir = store.dir();
    let applied = tools::drain_inbox(&dir, &mut store.data);
    if applied > 0 {
        store.save()?;
        store.mirror();
    }
    Ok(applied)
}

/// The config an AI tool needs to start this app's MCP connector.
#[tauri::command]
fn mcp_config() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let config = serde_json::json!({"mcpServers": {"bolzano-jobs": {"command": exe, "args": ["--mcp"]}}});
    serde_json::to_string_pretty(&config).map_err(|e| e.to_string())
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
    // Started by an AI tool: serve MCP and stay out of the window system entirely.
    if std::env::args().any(|a| a == "--mcp-apply") {
        mcp::serve_apply();
        return;
    }
    if std::env::args().any(|a| a == "--mcp") {
        let dir = portable.or_else(|| std::env::var_os("APPDATA").map(|d| std::path::PathBuf::from(d).join("com.p0mpurin.bolzanojobs")));
        if let Some(dir) = dir {
            mcp::serve(dir, std::env::args().any(|a| a == "--chat-tools"));
        }
        return;
    }
    let mut builder = tauri::Builder::default();
    // Must come first: a second launch focuses the running window instead.
    // A throwaway data folder is a separate test run, so it may run alongside.
    if std::env::var_os("BOLZANO_JOBS_DATA").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }
    let builder = builder
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
                .user_agent(concat!("BolzanoJobs/", env!("CARGO_PKG_VERSION"), " (personal job search app)"))
                .timeout(std::time::Duration::from_secs(20))
                .build()?;
            let store = Store::load(dir.clone());
            let mut store = store;
            if tools::drain_inbox(&dir, &mut store.data) > 0 {
                store.save()?;
            }
            backup::auto(&dir, &store.data);
            store.mirror();
            app.manage(AppState { store: Mutex::new(store), client, apply_stop: Default::default() });
            Ok(())
        })
        ;
    let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
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
            write_text_file,
            read_cv,
            get_ai_ranks,
            import_ai_ranks,
            clear_ai_ranks,
            ai_chat,
            ai_set_key,
            ai_has_key,
            ai_clear_key,
            apply_ai_inbox,
            mcp_config,
            autopilot_rules,
            import_reports,
            apply_start,
            apply_stop,
            browser_place,
            browser_close,
            cli_status,
            cli_sign_in,
            cli_install,
            tailor_cv,
            open_tailored,
            mail_connect,
            mail_disconnect,
            mail_sync,
            mail_undo,
            mail_suggestions,
            mail_resolve,
            game_running,
            site_memory,
            ai_one_shot
        ];
    builder
        // Employer pages live in the Easy Apply webview. They must never reach the
        // app's commands: those can read the whole profile.
        .invoke_handler(move |invoke| {
            if invoke.message.webview_ref().label() != "main" {
                invoke.resolver.reject("Not available here.");
                return true;
            }
            handler(invoke)
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    /// Reads a real PDF named by CV_TEST_PDF: `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn reads_a_pdf_cv() {
        let path = std::env::var("CV_TEST_PDF").expect("CV_TEST_PDF");
        let text = super::read_cv(path).unwrap();
        assert!(text.len() > 200 && text.contains('@'));
    }

    #[test]
    fn refuses_files_it_cannot_read() {
        assert!(super::read_cv("does-not-exist.pdf".into()).is_err());
    }

    /// With no search terms, the sources list every job: `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn no_terms_lists_all_jobs() {
        let client = reqwest::Client::builder().user_agent("BolzanoJobs-test").build().unwrap();
        let settings = super::Settings::default();
        assert!(settings.terms.is_empty() && settings.profile.is_empty(), "fresh installs carry no one's data");
        let karriere = super::sources::karriere::fetch(&client, &settings).await.unwrap();
        let stj = super::sources::suedtiroler::fetch(&client, &settings).await.unwrap();
        println!("karriere {} suedtiroler {}", karriere.len(), stj.len());
        assert!(karriere.len() > 100 && stj.len() > 20);
    }
}
