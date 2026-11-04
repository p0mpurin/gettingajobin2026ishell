//! NOI Techpark job board: a server-rendered list of startup, company and
//! research jobs in the Bolzano tech park.

use super::{looks_junior, Job};
use scraper::{ElementRef, Html, Selector};

const URL: &str = "https://noi.bz.it/en/jobs-noi-techpark";

pub async fn fetch(client: &reqwest::Client) -> Result<Vec<Job>, String> {
    let html = client
        .get(URL)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    Ok(parse(&html))
}

/// Full posting text for NOI's own job pages. Jobs hosted on onboard.org are
/// rendered with JavaScript, so their text has to be pasted by hand.
pub async fn description(client: &reqwest::Client, url: &str) -> Result<String, String> {
    if !url.starts_with("https://noi.bz.it/") {
        return Err("this posting is hosted elsewhere; paste its text instead".into());
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
    let doc = Html::parse_document(&html);
    let desc = Selector::parse(".desc").unwrap();
    let main = Selector::parse("main").unwrap();
    let el = doc.select(&desc).next().or_else(|| doc.select(&main).next()).ok_or("no posting text found")?;
    Ok(super::html_to_text(&el.inner_html()))
}

/// NOI writes bilingual names ("Bozen-Bolzano"); use the German name like
/// Karriere Südtirol does, so the same town isn't counted twice.
fn normalize_place(place: &str) -> String {
    match place.split(['-', '/']).next().map(str::trim) {
        Some(first) if !first.is_empty() && place.contains('-') => first.to_string(),
        _ => place.to_string(),
    }
}

fn text(el: ElementRef) -> String {
    el.text().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse(html: &str) -> Vec<Job> {
    let doc = Html::parse_document(html);
    let card = Selector::parse("a.contentbox-white.element").unwrap();
    let title_sel = Selector::parse("h3.title").unwrap();
    let company_sel = Selector::parse(".button-tag1").unwrap();
    let tag_sel = Selector::parse(".tags .tag").unwrap();

    let mut jobs = Vec::new();
    for a in doc.select(&card) {
        let Some(href) = a.value().attr("href") else { continue };
        let Some(title) = a.select(&title_sel).next().map(text) else { continue };
        // Company tags look like "Start-Ups - Natural Smarter Pulse"; keep the name.
        let company = a
            .select(&company_sel)
            .next()
            .map(text)
            .map(|c| c.split_once(" - ").map(|(_, name)| name.to_string()).unwrap_or(c))
            .unwrap_or_default();
        let tags: Vec<String> = a.select(&tag_sel).map(text).collect();
        let location = tags
            .iter()
            .find(|t| !t.to_lowercase().contains("time"))
            .cloned()
            .map(|t| normalize_place(&t))
            .unwrap_or_else(|| "Bozen".into());
        let url = href.split("?from_career_page").next().unwrap_or(href).to_string();
        let slug = url.trim_end_matches('/').rsplit('/').next().unwrap_or(&url).to_string();
        jobs.push(Job {
            id: format!("noi-{slug}"),
            source: "noi-techpark".into(),
            junior: looks_junior(&title),
            title,
            company,
            location,
            url,
            apply_url: None,
            published: None,
            salary: None,
            tags: tags.into_iter().filter(|t| t.to_lowercase().contains("time")).collect(),
            is_new: false,
            first_seen: 0,
        });
    }
    jobs
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_card() {
        let html = r#"<a class="contentbox-white element" href="https://unibz.onboard.org/jobs/Q4AvxaGZ?from_career_page=true"><div class="button button-tag1 df">University - Free University of Bozen-Bolzano</div><h3 class="t3 title">Junior Developer</h3><div class="tags"><div class="mediumFs tag ttu">Bozen-Bolzano</div><div class="mediumFs tag ttu">Full time</div></div></a>"#;
        let jobs = super::parse(html);
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].company, "Free University of Bozen-Bolzano");
        assert_eq!(jobs[0].location, "Bozen");
        assert_eq!(jobs[0].url, "https://unibz.onboard.org/jobs/Q4AvxaGZ");
        assert!(jobs[0].junior);
    }
}

#[cfg(test)]
mod live {
    /// Hits the real page: run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live_fetch() {
        let jobs = super::fetch(&reqwest::Client::new()).await.unwrap();
        println!("noi: {} jobs", jobs.len());
        for j in jobs.iter().take(3) {
            println!("{j:?}");
        }
        assert!(!jobs.is_empty());
    }
}
