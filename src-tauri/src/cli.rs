//! Sign in with Claude or ChatGPT, through their official apps. Claude Code and
//! Codex do the signing in on the provider's own page and hold the login; this
//! app only starts them and never sees a token. Each run gets nothing but the
//! tools named here: no shell, no web, no user plugins.

use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

/// A run this long has gone wrong.
const MAX_RUN: Duration = Duration::from_secs(15 * 60);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Cli {
    Claude,
    Codex,
}

pub fn parse(provider: &str) -> Option<Cli> {
    match provider {
        "claude" => Some(Cli::Claude),
        "codex" => Some(Cli::Codex),
        _ => None,
    }
}

/// How to start the app: npm's .cmd shim can't safely take our arguments, so
/// Codex installed that way is started through Node directly.
struct Bin {
    program: PathBuf,
    prefix: Vec<String>,
}

fn locate(name: &str) -> Vec<PathBuf> {
    let mut command = std::process::Command::new("where.exe");
    use std::os::windows::process::CommandExt;
    let out = command.arg(name).creation_flags(CREATE_NO_WINDOW).output();
    let mut found: Vec<PathBuf> = out
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().map(|l| PathBuf::from(l.trim())).collect())
        .unwrap_or_default();
    // An app started from Explorer may have an older PATH than a terminal.
    let home = |var: &str, tail: &str| std::env::var_os(var).map(|h| Path::new(&h).join(tail));
    let usual = match name {
        "claude" => vec![home("USERPROFILE", ".local/bin/claude.exe"), home("APPDATA", "npm/claude.cmd")],
        _ => vec![home("APPDATA", "npm/codex.cmd"), home("USERPROFILE", ".local/bin/codex.exe")],
    };
    found.extend(usual.into_iter().flatten().filter(|p| p.is_file()));
    found
}

fn find(cli: Cli) -> Option<Bin> {
    let name = if cli == Cli::Claude { "claude" } else { "codex" };
    // Lets a test run use a copy without installing it; only with a throwaway data folder.
    if std::env::var_os("BOLZANO_JOBS_DATA").is_some() {
        if let Some(path) = std::env::var_os("BOLZANO_CODEX_JS").filter(|_| cli == Cli::Codex) {
            return Some(Bin { program: "node".into(), prefix: vec![path.to_string_lossy().into_owned()] });
        }
    }
    for path in locate(name) {
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if ext == "exe" {
            return Some(Bin { program: path, prefix: Vec::new() });
        }
        if ext == "cmd" {
            let dir = path.parent()?;
            let package = if cli == Cli::Claude { "@anthropic-ai/claude-code/cli.js" } else { "@openai/codex/bin/codex.js" };
            let script = [dir.join("node_modules").join(package), dir.join("..").join(package)].into_iter().find(|p| p.is_file());
            if let Some(script) = script {
                return Some(Bin { program: "node".into(), prefix: vec![script.to_string_lossy().into_owned()] });
            }
        }
    }
    None
}

fn command(bin: &Bin) -> tokio::process::Command {
    let mut c = tokio::process::Command::new(&bin.program);
    c.args(&bin.prefix).creation_flags(CREATE_NO_WINDOW).kill_on_drop(true);
    c
}

#[derive(Serialize, Default)]
pub struct Status {
    pub installed: bool,
    pub signed_in: bool,
    /// Who it's signed in as, as far as the app says.
    pub account: String,
}

pub async fn status(cli: Cli) -> Status {
    let Some(bin) = find(cli) else { return Status::default() };
    let args: &[&str] = if cli == Cli::Claude { &["auth", "status"] } else { &["login", "status"] };
    let out = tokio::time::timeout(Duration::from_secs(20), command(&bin).args(args).stdin(Stdio::null()).output()).await;
    let Ok(Ok(out)) = out else { return Status { installed: true, ..Default::default() } };
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    match cli {
        Cli::Claude => {
            let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            let plan = v["subscriptionType"].as_str().unwrap_or("");
            let email = v["email"].as_str().unwrap_or("");
            // An API key in the environment isn't the sign-in being asked for.
            let signed_in = v["loggedIn"].as_bool() == Some(true) && v["authMethod"].as_str() == Some("claude.ai");
            Status { installed: true, signed_in, account: [email, plan].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · ") }
        }
        Cli::Codex => Status { installed: true, signed_in: out.status.success() && text.contains("ChatGPT"), account: if text.contains("ChatGPT") { "ChatGPT".into() } else { String::new() } },
    }
}

/// Opens a terminal window on the user's click: they see exactly what's running.
fn terminal(command_line: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("cmd").raw_arg(format!("/c start \"Bolzano Jobs\" {command_line}")).spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn quoted(bin: &Bin) -> String {
    std::iter::once(bin.program.to_string_lossy().into_owned()).chain(bin.prefix.iter().cloned()).map(|p| format!("\"{p}\"")).collect::<Vec<_>>().join(" ")
}

/// Starts the official sign-in, which opens the provider's own page.
pub fn sign_in(cli: Cli) -> Result<(), String> {
    let bin = find(cli).ok_or("Install it first.")?;
    let sub = if cli == Cli::Claude { "auth login" } else { "login" };
    terminal(&format!("cmd /c \"{} {sub}\"", quoted(&bin)))
}

pub fn install(cli: Cli) -> Result<(), String> {
    match cli {
        Cli::Claude => terminal("powershell -NoProfile -ExecutionPolicy Bypass -Command \"irm https://claude.ai/install.ps1 | iex; pause\""),
        Cli::Codex => terminal("cmd /c \"npm install -g @openai/codex & pause\""),
    }
}

pub struct McpServer {
    pub name: String,
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

pub struct Spec {
    pub system: String,
    pub prompt: String,
    /// None for plain text work with no tools at all.
    pub server: Option<McpServer>,
    pub cwd: PathBuf,
}

/// The one place that decides what the official app may do in a run.
pub fn build_args(cli: Cli, spec: &Spec) -> Vec<String> {
    let to_strings = |a: &[&str]| a.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    match cli {
        Cli::Claude => {
            let mut args = to_strings(&["-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--disable-slash-commands", "--strict-mcp-config", "--setting-sources", "", "--tools", "", "--permission-mode", "default"]);
            if let Some(s) = &spec.server {
                let env: serde_json::Map<String, Value> = s.env.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
                let config = json!({"mcpServers": {&s.name: {"type": "stdio", "command": s.program, "args": s.args, "env": env}}});
                args.extend(["--allowedTools".into(), format!("mcp__{}", s.name), "--mcp-config".into(), config.to_string()]);
            }
            args.extend(["--system-prompt".into(), spec.system.clone()]);
            args
        }
        Cli::Codex => {
            let toml = |v: &str| serde_json::to_string(v).unwrap_or_default();
            let mut args = to_strings(&["exec", "--json", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only"]);
            let mut set = |kv: String| {
                args.push("-c".into());
                args.push(kv);
            };
            set("approval_policy=\"never\"".into());
            set("web_search=\"disabled\"".into());
            for off in ["shell_tool", "apps", "plugins", "multi_agent", "image_generation", "view_image"] {
                set(format!("features.{off}=false"));
            }
            if let Some(s) = &spec.server {
                set(format!("mcp_servers.{}.command={}", s.name, toml(&s.program)));
                set(format!("mcp_servers.{}.args={}", s.name, json!(s.args)));
                set(format!("mcp_servers.{}.default_tools_approval_mode=\"approve\"", s.name));
                for (k, v) in &s.env {
                    set(format!("mcp_servers.{}.env.{k}={}", s.name, toml(v)));
                }
            }
            args.push("-C".into());
            args.push(spec.cwd.to_string_lossy().into_owned());
            args.push("-".into());
            args
        }
    }
}

#[derive(Debug)]
pub enum Event {
    Text(String),
    Tool(String, Value),
}

/// Reads one line of the app's output. An Err means it has tools it shouldn't.
pub fn read_event(cli: Cli, line: &str) -> Result<Vec<Event>, String> {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return Ok(Vec::new()) };
    let mut out = Vec::new();
    match cli {
        Cli::Claude => match v["type"].as_str().unwrap_or("") {
            "system" if v["subtype"] == "init" => {
                let extra: Vec<&str> = v["tools"].as_array().into_iter().flatten().filter_map(|t| t.as_str()).filter(|t| !t.starts_with("mcp__")).collect();
                if !extra.is_empty() {
                    return Err(format!("Stopped: Claude came up with tools it shouldn't have ({}).", extra.join(", ")));
                }
            }
            "assistant" => {
                for block in v["message"]["content"].as_array().into_iter().flatten() {
                    match block["type"].as_str() {
                        Some("text") => out.push(Event::Text(block["text"].as_str().unwrap_or("").to_string())),
                        Some("tool_use") => out.push(Event::Tool(block["name"].as_str().unwrap_or("").to_string(), block["input"].clone())),
                        _ => {}
                    }
                }
            }
            _ => {}
        },
        Cli::Codex => {
            let item = &v["item"];
            match item["type"].as_str().unwrap_or("") {
                "command_execution" | "file_change" | "web_search" => return Err(format!("Stopped: ChatGPT tried to use a tool it shouldn't have ({}).", item["type"].as_str().unwrap_or(""))),
                "agent_message" if v["type"] == "item.completed" => out.push(Event::Text(item["text"].as_str().unwrap_or("").to_string())),
                "mcp_tool_call" if v["type"] == "item.started" => out.push(Event::Tool(item["tool"].as_str().unwrap_or("").to_string(), item["arguments"].clone())),
                _ => {}
            }
            if v["type"] == "turn.failed" || v["type"] == "error" {
                let m = v["error"]["message"].as_str().or(v["message"].as_str()).unwrap_or("ChatGPT reported an error.");
                return Err(m.chars().take(300).collect());
            }
        }
    }
    Ok(out)
}

/// Runs the official app until it's done, stopped or `finished` says the job's over.
pub async fn run(cli: Cli, spec: &Spec, stop: &AtomicBool, finished: &AtomicBool, mut on_event: impl FnMut(Event) + Send) -> Result<(), String> {
    let name = if cli == Cli::Claude { "Claude Code" } else { "Codex" };
    let bin = find(cli).ok_or_else(|| format!("{name} isn't installed. Connect it in Settings."))?;
    std::fs::create_dir_all(&spec.cwd).map_err(|e| e.to_string())?;
    let mut c = command(&bin);
    c.args(build_args(cli, spec))
        .current_dir(&spec.cwd)
        // The user asked to use their sign-in, not a key that happens to be set.
        .env_remove("ANTHROPIC_API_KEY")
        .env_remove("ANTHROPIC_AUTH_TOKEN")
        .env_remove("OPENAI_API_KEY")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = c.spawn().map_err(|e| format!("Couldn't start {name}: {e}"))?;
    // Long prompts go over stdin: Windows limits command lines.
    let prompt = match cli {
        Cli::Claude => spec.prompt.clone(),
        Cli::Codex => format!("{}\n\n{}", spec.system, spec.prompt),
    };
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    tokio::spawn(async move {
        let _ = stdin.write_all(prompt.as_bytes()).await;
        let _ = stdin.shutdown().await;
    });
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    let errors = tokio::spawn(async move {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s).await;
        s
    });
    let mut lines = BufReader::new(child.stdout.take().ok_or("no stdout")?).lines();
    let started = Instant::now();
    let mut grace: Option<Instant> = None;
    loop {
        if stop.load(Ordering::SeqCst) || started.elapsed() > MAX_RUN {
            let _ = child.kill().await;
            return Ok(());
        }
        if finished.load(Ordering::SeqCst) {
            // Give it a moment to end by itself, then end it.
            let at = *grace.get_or_insert_with(Instant::now);
            if at.elapsed() > Duration::from_secs(3) {
                let _ = child.kill().await;
                return Ok(());
            }
        }
        match tokio::time::timeout(Duration::from_millis(300), lines.next_line()).await {
            Err(_) => continue,
            Ok(Err(e)) => return Err(e.to_string()),
            Ok(Ok(None)) => break,
            Ok(Ok(Some(line))) => match read_event(cli, &line) {
                Ok(events) => events.into_iter().for_each(&mut on_event),
                Err(e) => {
                    let _ = child.kill().await;
                    return Err(e);
                }
            },
        }
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() && !finished.load(Ordering::SeqCst) {
        let detail = errors.await.unwrap_or_default();
        let lower = detail.to_lowercase();
        if lower.contains("login") || lower.contains("log in") || lower.contains("auth") {
            return Err(format!("{name} isn't signed in. Sign in again in Settings."));
        }
        return Err(format!("{name} stopped: {}", detail.trim().chars().take(300).collect::<String>()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> Spec {
        Spec {
            system: "RULES".into(),
            prompt: "GO".into(),
            server: Some(McpServer { name: "bolzano_apply".into(), program: "C:\\A B\\app.exe".into(), args: vec!["--mcp-apply".into()], env: vec![("BJ_TOKEN".into(), "t\"1".into())] }),
            cwd: "C:\\work".into(),
        }
    }

    #[test]
    fn claude_gets_only_the_form_tools() {
        let a = build_args(Cli::Claude, &spec());
        let after = |flag: &str| a[a.iter().position(|x| x == flag).unwrap() + 1].clone();
        assert_eq!(after("--tools"), "", "built-in tools off");
        assert_eq!(after("--setting-sources"), "", "no user hooks or plugins");
        assert_eq!(after("--allowedTools"), "mcp__bolzano_apply");
        assert!(a.contains(&"--strict-mcp-config".to_string()));
        let config: Value = serde_json::from_str(&after("--mcp-config")).unwrap();
        assert_eq!(config["mcpServers"]["bolzano_apply"]["env"]["BJ_TOKEN"], "t\"1");
    }

    #[test]
    fn codex_gets_only_the_form_tools() {
        let a = build_args(Cli::Codex, &spec());
        for must in ["--ignore-user-config", "--ephemeral", "features.shell_tool=false", "web_search=\"disabled\"", "approval_policy=\"never\"", "read-only"] {
            assert!(a.iter().any(|x| x == must), "{must}");
        }
        assert!(a.iter().any(|x| x == "mcp_servers.bolzano_apply.env.BJ_TOKEN=\"t\\\"1\""), "values are quoted for TOML");
        assert_eq!(a.last().unwrap(), "-", "the prompt comes over stdin");
    }

    #[test]
    fn text_only_work_gets_no_tools_at_all() {
        let plain = Spec { server: None, ..spec() };
        let a = build_args(Cli::Claude, &plain);
        assert!(!a.iter().any(|x| x == "--allowedTools" || x == "--mcp-config"));
        assert_eq!(a[a.iter().position(|x| x == "--tools").unwrap() + 1], "");
        assert!(!build_args(Cli::Codex, &plain).iter().any(|x| x.starts_with("mcp_servers")));
    }

    #[test]
    fn any_tool_beyond_ours_stops_the_run() {
        assert!(read_event(Cli::Claude, r#"{"type":"system","subtype":"init","tools":["mcp__bolzano_apply__fill"]}"#).is_ok());
        assert!(read_event(Cli::Claude, r#"{"type":"system","subtype":"init","tools":["Bash","mcp__x__y"]}"#).unwrap_err().contains("Bash"));
        assert!(read_event(Cli::Codex, r#"{"type":"item.started","item":{"type":"command_execution","command":"dir"}}"#).is_err());
        assert!(read_event(Cli::Codex, r#"{"type":"item.started","item":{"type":"mcp_tool_call","tool":"fill"}}"#).is_ok());
    }

    #[test]
    fn reads_what_the_ai_says() {
        let e = read_event(Cli::Claude, r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}"#).unwrap();
        assert!(matches!(&e[0], Event::Text(t) if t == "Hi"));
        let e = read_event(Cli::Codex, r#"{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}"#).unwrap();
        assert!(matches!(&e[0], Event::Text(t) if t == "Done"));
        assert!(read_event(Cli::Claude, "not json").unwrap().is_empty());
    }
}
