//! suedtirolerjobs.it: the public JSON API its job search uses
//! (`api.suedtirolerjobs.it/jobs?query=…&regions[]=/regions/N`), and the
//! JobPosting structured data on each public job page for the full text.

use super::{html_to_text, looks_junior, Job};
use crate::store::Settings;
use futures::stream::{self, StreamExt};
use serde::Deserialize;
use std::collections::HashSet;
use std::time::Duration;

const API: &str = "https://api.suedtirolerjobs.it/jobs";
const PER_PAGE: u32 = 50;
const MAX_PAGES: u32 = 6;
const PARALLEL_TERMS: usize = 3;

/// Karriere Südtirol district ids (used in Settings) -> Südtiroler Jobs region ids.
fn regions_for(districts: &[u32]) -> Vec<u32> {
    let mut out: Vec<u32> = districts
        .iter()
        .filter_map(|d| match d {
            43 => Some(35), // Bozen & Umgebung -> Bozen
            44 => Some(37), // Burggrafenamt
            45 => Some(38), // Eisacktal
            46 => Some(42), // Wipptal
            47 => Some(40), // Gröden & Gadertal -> Salten-Schlern
            48 => Some(39), // Pustertal
            50 => Some(41), // Überetsch & Unterland
            51 => Some(36), // Vinschgau
            _ => None,      // Trentino / outside South Tyrol: not on this site
        })
        .collect();
    out.sort_unstable();
    out.dedup();
    out
}

#[derive(Deserialize)]
struct Page {
    #[serde(rename = "hydra:member")]
    member: Vec<Offer>,
    #[serde(rename = "hydra:totalItems")]
    total: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Company {
    company_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Offer {
    /// A number in the API, kept as JSON so a string id would also work.
    id: serde_json::Value,
    title: String,
    url: String,
    company_profile: Option<Company>,
    job_location: Option<String>,
    date_posted: Option<String>,
    custom_date_posted: Option<String>,
    employment_types_as_string: Option<String>,
    salary_from: Option<serde_json::Value>,
    salary_to: Option<serde_json::Value>,
    hide_salary: Option<bool>,
    is_remote: Option<bool>,
}

pub async fn fetch(client: &reqwest::Client, settings: &Settings) -> Result<Vec<Job>, String> {
    let regions = regions_for(&settings.districts);
    if regions.is_empty() {
        return Ok(Vec::new());
    }
    let mut terms: Vec<String> = settings.terms.iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
    // No terms means every job, for people who haven't narrowed it down.
    if terms.is_empty() {
        terms.push(String::new());
    }
    let results: Vec<Result<Vec<Offer>, String>> = stream::iter(terms)
        .map(|term| {
            let client = client.clone();
            let regions = regions.clone();
            async move { fetch_term(&client, &term, &regions).await }
        })
        .buffered(PARALLEL_TERMS)
        .collect()
        .await;

    let mut seen = HashSet::new();
    let mut jobs = Vec::new();
    for offers in results {
        for o in offers? {
            if seen.insert(id_of(&o)) {
                jobs.push(to_job(o));
            }
        }
    }
    Ok(jobs)
}

async fn fetch_term(client: &reqwest::Client, term: &str, regions: &[u32]) -> Result<Vec<Offer>, String> {
    let mut offers = Vec::new();
    let mut page = 1;
    loop {
        let mut query: Vec<(String, String)> = vec![
            ("query".into(), term.into()),
            ("itemsPerPage".into(), PER_PAGE.to_string()),
            ("page".into(), page.to_string()),
        ];
        for r in regions {
            query.push(("regions[]".into(), format!("/regions/{r}")));
        }
        let res: Page = client
            .get(API)
            .header("Accept", "application/ld+json")
            .query(&query)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let got = res.member.len() as u32;
        offers.extend(res.member);
        if got < PER_PAGE || page * PER_PAGE >= res.total || page >= MAX_PAGES {
            return Ok(offers);
        }
        page += 1;
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

fn id_of(o: &Offer) -> String {
    match &o.id {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn number(v: &Option<serde_json::Value>) -> f64 {
    match v {
        Some(serde_json::Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(serde_json::Value::String(s)) => s.parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

fn to_job(o: Offer) -> Job {
    let id = id_of(&o);
    let salary = if o.hide_salary.unwrap_or(false) {
        None
    } else {
        match (number(&o.salary_from), number(&o.salary_to)) {
            (f, t) if f > 0.0 && t > 0.0 => Some(format!("€{f:.0}–{t:.0}")),
            (f, _) if f > 0.0 => Some(format!("from €{f:.0}")),
            _ => None,
        }
    };
    let mut tags: Vec<String> = o
        .employment_types_as_string
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if o.is_remote.unwrap_or(false) {
        tags.push("Remote".into());
    }
    let published = o.custom_date_posted.or(o.date_posted).map(|d| d.chars().take(10).collect());
    Job {
        id: format!("stj-{id}"),
        source: "suedtirolerjobs".into(),
        junior: looks_junior(&o.title),
        title: o.title,
        company: o.company_profile.and_then(|c| c.company_name).map(|n| n.trim().to_string()).unwrap_or_default(),
        location: o.job_location.unwrap_or_default(),
        url: o.url,
        apply_url: None,
        published,
        salary,
        tags,
        is_new: false,
        first_seen: 0,
    }
}

/// Full posting text from the JobPosting structured data on the public job page.
pub async fn description(client: &reqwest::Client, url: &str) -> Result<String, String> {
    if !url.starts_with("https://www.suedtirolerjobs.it/jobs/") {
        return Err("not a Südtiroler Jobs posting".into());
    }
    let html = client
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let doc = scraper::Html::parse_document(&html);
    let sel = scraper::Selector::parse(r#"script[type="application/ld+json"]"#).unwrap();
    for script in doc.select(&sel) {
        let raw: String = script.text().collect();
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else { continue };
        if v.get("@type").and_then(|t| t.as_str()) == Some("JobPosting") {
            if let Some(d) = v.get("description").and_then(|d| d.as_str()) {
                return Ok(html_to_text(d));
            }
        }
    }
    Err("no posting text found on the page".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn maps_districts_to_regions() {
        assert_eq!(super::regions_for(&[43, 50]), vec![35, 41]);
        assert!(super::regions_for(&[49]).is_empty(), "Trentino isn't on the site");
    }

    /// Hits the real API: run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live_fetch() {
        let client = reqwest::Client::builder().user_agent("BolzanoJobs-test").build().unwrap();
        let settings = crate::store::Settings { terms: vec!["Software".into()], ..Default::default() };
        let jobs = super::fetch(&client, &settings).await.unwrap();
        println!("suedtirolerjobs: {} jobs", jobs.len());
        for j in jobs.iter().take(3) {
            println!("{j:?}");
        }
        assert!(!jobs.is_empty());
        let text = super::description(&client, &jobs[0].url).await.unwrap();
        println!("description: {}", text.chars().take(300).collect::<String>());
        assert!(text.len() > 100);
    }
}
