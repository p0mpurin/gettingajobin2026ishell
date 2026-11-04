//! karriere-suedtirol.com: the public JSON search API the site itself uses.

use super::{looks_junior, Job};
use crate::store::Settings;
use futures::stream::{self, StreamExt};
use serde::Deserialize;
use std::collections::HashSet;
use std::time::Duration;

const API: &str = "https://api.karriere-suedtirol.com/api/jobAd/search";
const PER_PAGE: u32 = 50;
const MAX_PAGES: u32 = 6;

#[derive(Deserialize)]
struct Page {
    data: Vec<Ad>,
    meta: Meta,
}

#[derive(Deserialize)]
struct Meta {
    last_page: u32,
}

#[derive(Deserialize)]
struct Named {
    name: String,
}

#[derive(Deserialize)]
struct Site {
    city: Option<Named>,
    district: Option<Named>,
}

#[derive(Deserialize)]
struct Ad {
    id: u64,
    title: String,
    employer: Option<Named>,
    employer_site: Option<Site>,
    application_url: Option<String>,
    wage_from: Option<f64>,
    wage_to: Option<f64>,
    for_newcomer: Option<bool>,
    published_at: Option<String>,
    #[serde(default)]
    employment_types: Vec<Named>,
    #[serde(default)]
    work_times: Vec<Named>,
}

/// At most this many search terms are fetched at the same time.
const PARALLEL_TERMS: usize = 3;

pub async fn fetch(client: &reqwest::Client, settings: &Settings) -> Result<Vec<Job>, String> {
    let mut terms: Vec<String> = settings.terms.iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
    // No terms means every job, for people who haven't narrowed it down.
    if terms.is_empty() {
        terms.push(String::new());
    }
    let results: Vec<Result<Vec<Ad>, String>> = stream::iter(terms)
        .map(|term| {
            // Owned copies keep the future 'static + Send for Tauri's runtime.
            let client = client.clone();
            let districts = settings.districts.clone();
            async move { fetch_term(&client, &term, &districts).await }
        })
        .buffered(PARALLEL_TERMS)
        .collect()
        .await;

    let mut seen = HashSet::new();
    let mut jobs = Vec::new();
    for ads in results {
        for ad in ads? {
            if seen.insert(ad.id) {
                jobs.push(to_job(ad));
            }
        }
    }
    Ok(jobs)
}

/// All result pages for one search term, fetched one after another.
async fn fetch_term(client: &reqwest::Client, term: &str, districts: &[u32]) -> Result<Vec<Ad>, String> {
    let mut ads = Vec::new();
    let mut page = 1;
    loop {
        let mut query: Vec<(String, String)> = vec![
            ("search_term".into(), term.into()),
            ("per_page".into(), PER_PAGE.to_string()),
            ("page".into(), page.to_string()),
        ];
        for (i, d) in districts.iter().enumerate() {
            query.push((format!("district_ids[{i}]"), d.to_string()));
        }
        let res: Page = client
            .get(API)
            .header("Accept", "application/json")
            .query(&query)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;

        ads.extend(res.data);
        if page >= res.meta.last_page || page >= MAX_PAGES {
            return Ok(ads);
        }
        page += 1;
        // Be polite to the site: a short pause between pages.
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

fn to_job(ad: Ad) -> Job {
    let location = ad
        .employer_site
        .as_ref()
        .and_then(|s| s.city.as_ref().or(s.district.as_ref()))
        .map(|n| n.name.clone())
        .unwrap_or_default();
    let salary = match (ad.wage_from.unwrap_or(0.0), ad.wage_to.unwrap_or(0.0)) {
        (f, t) if f > 0.0 && t > 0.0 => Some(format!("€{f:.0}–{t:.0}")),
        (f, _) if f > 0.0 => Some(format!("from €{f:.0}")),
        _ => None,
    };
    Job {
        id: format!("ks-{}", ad.id),
        source: "karriere-suedtirol".into(),
        junior: ad.for_newcomer.unwrap_or(false) || looks_junior(&ad.title),
        url: format!("https://karriere-suedtirol.com/jobs/id-{}/", ad.id),
        title: ad.title,
        company: ad.employer.map(|e| e.name).unwrap_or_default(),
        location,
        apply_url: ad.application_url.filter(|u| !u.is_empty()).map(|u| {
            if u.starts_with("http") { u } else { format!("https://{u}") }
        }),
        published: ad.published_at.map(|p| p.chars().take(10).collect()),
        salary,
        tags: ad.employment_types.into_iter().chain(ad.work_times).map(|n| n.name).collect(),
        is_new: false,
        first_seen: 0,
    }
}

/// Full posting text for one job, from the per-job endpoint.
pub async fn description(client: &reqwest::Client, id: &str) -> Result<String, String> {
    let v: serde_json::Value = client
        .get(format!("https://api.karriere-suedtirol.com/api/jobAd/{id}"))
        .header("Accept", "application/json")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let ad = v.get("data").unwrap_or(&v);
    let html = ad.get("description").and_then(|d| d.as_str()).unwrap_or_default();
    Ok(super::html_to_text(html))
}

#[cfg(test)]
mod tests {
    /// Hits the real API: run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live_fetch() {
        let client = reqwest::Client::new();
        let settings = crate::store::Settings { terms: vec!["Software".into()], ..Default::default() };
        let jobs = super::fetch(&client, &settings).await.unwrap();
        println!("karriere: {} jobs, {} junior", jobs.len(), jobs.iter().filter(|j| j.junior).count());
        for j in jobs.iter().take(3) {
            println!("{j:?}");
        }
        assert!(!jobs.is_empty());
        let text = super::description(&client, jobs[0].id.trim_start_matches("ks-")).await.unwrap();
        println!("description: {}", &text.chars().take(400).collect::<String>());
        assert!(text.len() > 100);
    }
}
