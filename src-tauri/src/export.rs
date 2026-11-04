//! Exports tracked applications as an Obsidian-friendly Markdown table or CSV.

use crate::store::Track;
use std::collections::HashMap;

const ORDER: [&str; 5] = ["offer", "interview", "applied", "saved", "rejected"];

fn sorted(tracks: &HashMap<String, Track>) -> Vec<&Track> {
    let mut list: Vec<&Track> = tracks.values().filter(|t| t.status != "hidden" && !t.title.is_empty()).collect();
    list.sort_by_key(|t| (ORDER.iter().position(|s| *s == t.status).unwrap_or(9), std::cmp::Reverse(t.updated)));
    list
}

fn date(secs: Option<u64>) -> String {
    let Some(secs) = secs else { return String::new() };
    let (y, m, d) = civil(secs);
    format!("{d:02}.{m:02}.{y}")
}

/// "2026-10-29" for a unix-seconds time (UTC).
pub fn iso_date(secs: u64) -> String {
    let (y, m, d) = civil(secs);
    format!("{y}-{m:02}-{d:02}")
}

/// Days since 1970 -> civil date (Howard Hinnant's algorithm), no chrono needed.
fn civil(secs: u64) -> (i64, i64, i64) {
    let z = (secs / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

fn cell(s: &str) -> String {
    s.replace('|', "/").replace('\n', " ")
}

pub fn markdown(tracks: &HashMap<String, Track>) -> (String, usize) {
    let list = sorted(tracks);
    let mut out = String::from(
        "---\ntags: [job-search, tracker]\n---\n# Applications\n\n_Exported from Bolzano Jobs._\n\n\
         | Status | Company | Role | Location | Applied | Updated | Link | Notes |\n|---|---|---|---|---|---|---|---|\n",
    );
    for t in &list {
        let link = t.apply_url.as_deref().unwrap_or(&t.url);
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | [open]({}) | {} |\n",
            t.status,
            cell(&t.company),
            cell(&t.title),
            cell(&t.location),
            date(t.applied),
            date(Some(t.updated)),
            link,
            cell(&t.notes)
        ));
    }
    out.push_str("\nBack to [[Home]]\n");
    (out, list.len())
}

pub fn csv(tracks: &HashMap<String, Track>) -> (String, usize) {
    let q = |s: &str| format!("\"{}\"", s.replace('"', "\"\""));
    let list = sorted(tracks);
    let mut out = String::from("status,company,role,location,applied,updated,link,notes\n");
    for t in &list {
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{}\n",
            t.status,
            q(&t.company),
            q(&t.title),
            q(&t.location),
            date(t.applied),
            date(Some(t.updated)),
            q(t.apply_url.as_deref().unwrap_or(&t.url)),
            q(&t.notes)
        ));
    }
    (out, list.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_dates() {
        assert_eq!(date(Some(0)), "01.01.1970");
        assert_eq!(date(Some(1_792_454_400)), "20.10.2026");
    }

    #[test]
    fn exports_sorted_without_hidden() {
        let mut tracks = HashMap::new();
        let t = |status: &str, title: &str| Track { status: status.into(), title: title.into(), company: "ACME | Co".into(), ..Default::default() };
        tracks.insert("a".into(), t("saved", "Saved job"));
        tracks.insert("b".into(), t("interview", "Interview job"));
        tracks.insert("c".into(), t("hidden", "Hidden job"));
        let (md, n) = markdown(&tracks);
        assert_eq!(n, 2);
        assert!(md.find("Interview job").unwrap() < md.find("Saved job").unwrap());
        assert!(!md.contains("Hidden job"));
        assert!(md.contains("ACME / Co"));
    }
}
