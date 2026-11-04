//! Company career portals on onboard.org (alpitronic, ACS, Raiffeisen IT, …).
//! Each company's public careers page loads `https://<company>.onboard.org/
//! de/api/v1/public/jobs.json`; the full posting is at `…/public/jobs/<id>.json`.
//! robots.txt allows everything.

use super::{html_to_text, looks_junior, Job};
use crate::store::Settings;
use futures::stream::{self, StreamExt};
use serde::Deserialize;

const PARALLEL: usize = 3;

/// Places that count as South Tyrol (German and Italian names, lower case).
const LOCAL_PLACES: &[&str] = &[
    "bozen", "bolzano", "meran", "merano", "brixen", "bressanone", "bruneck", "brunico", "leifers", "laives",
    "eppan", "appiano", "kaltern", "caldaro", "lana", "auer", "ora", "neumarkt", "egna", "sterzing", "vipiteno",
    "schlanders", "silandro", "klausen", "chiusa", "terlan", "terlano", "ritten", "renon", "unterinn", "andrian",
    "andriano", "sarntal", "kastelruth", "ortisei", "st. ulrich", "gröden", "val gardena", "innichen", "toblach",
    "sand in taufers", "mals", "naturns", "partschins", "algund", "schenna", "marling", "nals", "frangart",
    "girlan", "tramin", "kurtatsch", "salurn", "deutschnofen", "welschnofen", "völs", "jenesien", "mölten",
    "südtirol", "suedtirol", "alto adige", "south tyrol", "remote", "homeoffice", "home office",
];

pub fn is_local(location: &str) -> bool {
    let l = location.to_lowercase();
    // No location given: keep it, the posting may still be local.
    l.trim().is_empty() || LOCAL_PLACES.iter().any(|p| l.contains(p))
}

#[derive(Deserialize)]
struct Page {
    entries: Vec<Entry>,
}

#[derive(Deserialize)]
struct Business {
    title: String,
}

#[derive(Deserialize)]
struct Entry {
    id: String,
    title: String,
    published_at: Option<String>,
    formatted_locations: Option<String>,
    business: Option<Business>,
}

/// Company subdomains are letters, digits and dashes only (they go into a URL).
fn valid_company(c: &str) -> bool {
    !c.is_empty() && c.len() <= 63 && c.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
}

pub async fn fetch(client: &reqwest::Client, settings: &Settings) -> Result<Vec<Job>, String> {
    let companies: Vec<String> = settings
        .onboard_companies
        .iter()
        .map(|c| c.trim().to_lowercase())
        .filter(|c| valid_company(c))
        .collect();
    let local_only = settings.onboard_local_only;
    let results: Vec<(String, Result<Vec<Job>, String>)> = stream::iter(companies)
        .map(|company| {
            let client = client.clone();
            async move {
                let jobs = fetch_company(&client, &company, local_only).await;
                (company, jobs)
            }
        })
        .buffered(PARALLEL)
        .collect()
        .await;

    // One company being down or renamed shouldn't hide the others.
    let mut jobs = Vec::new();
    let mut failed = Vec::new();
    for (company, r) in results {
        match r {
            Ok(mut j) => jobs.append(&mut j),
            Err(e) => failed.push(format!("{company} ({e})")),
        }
    }
    if jobs.is_empty() && !failed.is_empty() {
        return Err(failed.join(", "));
    }
    Ok(jobs)
}

async fn fetch_company(client: &reqwest::Client, company: &str, local_only: bool) -> Result<Vec<Job>, String> {
    let page: Page = client
        .get(format!("https://{company}.onboard.org/de/api/v1/public/jobs.json"))
        .header("Accept", "application/json")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(page
        .entries
        .into_iter()
        .filter(|e| !local_only || is_local(e.formatted_locations.as_deref().unwrap_or("")))
        .map(|e| {
            let url = format!("https://{company}.onboard.org/jobs/{}", e.id);
            Job {
                id: format!("ob-{company}-{}", e.id),
                source: "onboard".into(),
                junior: looks_junior(&e.title),
                company: e.business.map(|b| b.title).unwrap_or_else(|| company.to_string()),
                location: e.formatted_locations.unwrap_or_default(),
                apply_url: Some(format!("{url}/form")),
                url,
                title: e.title.trim().to_string(),
                published: e.published_at,
                salary: None,
                tags: Vec::new(),
                is_new: false,
                first_seen: 0,
            }
        })
        .collect())
}

/// Full posting text for an onboard.org job URL (`https://<company>.onboard.org/jobs/<id>`).
pub async fn description(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let rest = url.strip_prefix("https://").ok_or("not an onboard.org link")?;
    let (host, path) = rest.split_once('/').ok_or("not an onboard.org link")?;
    let company = host.strip_suffix(".onboard.org").filter(|c| valid_company(c)).ok_or("not an onboard.org link")?;
    let id = path.strip_prefix("jobs/").map(|p| p.split(['/', '?']).next().unwrap_or("")).filter(|i| valid_company(i)).ok_or("not an onboard.org job link")?;
    let v: serde_json::Value = client
        .get(format!("https://{company}.onboard.org/de/api/v1/public/jobs/{id}.json"))
        .header("Accept", "application/json")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let html = v.get("description").and_then(|d| d.as_str()).unwrap_or_default();
    let types = v.get("formatted_types").and_then(|d| d.as_str()).unwrap_or_default();
    let text = html_to_text(html);
    Ok(if types.is_empty() { text } else { format!("{text}\n{types}") })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_filter_keeps_south_tyrol_and_mixed_locations() {
        assert!(is_local("Bozen"));
        assert!(is_local("Bologna, Bozen"));
        assert!(is_local("Bolzano"));
        assert!(is_local(""));
        assert!(!is_local("München"));
        assert!(!is_local("Charlotte, North Carolina"));
    }

    #[test]
    fn rejects_unsafe_company_names() {
        assert!(valid_company("acsgroup"));
        assert!(valid_company("hogast-it"));
        assert!(!valid_company("evil.com/x"));
        assert!(!valid_company(""));
    }

    /// Hits the real API: run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live_fetch() {
        let client = reqwest::Client::builder().user_agent("BolzanoJobs-test").build().unwrap();
        let settings = crate::store::Settings::default();
        let jobs = super::fetch(&client, &settings).await.unwrap();
        println!("onboard: {} local jobs", jobs.len());
        for j in jobs.iter().take(3) {
            println!("{j:?}");
        }
        assert!(jobs.iter().any(|j| j.company.to_lowercase().contains("alpitronic")));
        assert!(jobs.iter().all(|j| is_local(&j.location)));
        let text = super::description(&client, &jobs[0].url).await.unwrap();
        println!("description: {}", text.chars().take(200).collect::<String>());
        assert!(text.len() > 100);
    }
}
