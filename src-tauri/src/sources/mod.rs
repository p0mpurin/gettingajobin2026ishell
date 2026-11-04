pub mod karriere;
pub mod noi;
pub mod onboard;
pub mod suedtiroler;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Job {
    /// Stable id, prefixed with the source ("ks-43108", "noi-<slug>").
    pub id: String,
    pub source: String,
    pub title: String,
    pub company: String,
    pub location: String,
    /// Listing page for the job.
    pub url: String,
    /// Direct application link, when the source provides one.
    pub apply_url: Option<String>,
    pub published: Option<String>,
    pub salary: Option<String>,
    /// Short facts such as "Vollzeit" or "Full time".
    pub tags: Vec<String>,
    /// Entry-level: flagged by the source or matched in the title.
    pub junior: bool,
    pub is_new: bool,
    /// Unix seconds when this app first saw the job.
    pub first_seen: u64,
}

const JUNIOR_WORDS: &[&str] = &[
    "junior", "einsteiger", "trainee", "praktik", "intern", "stage", "tirocin",
    "apprendist", "lehrling", "neolaureat",
];

pub fn looks_junior(title: &str) -> bool {
    let t = title.to_lowercase();
    JUNIOR_WORDS.iter().any(|w| t.contains(w))
}

/// Turns posting HTML into readable plain text: one line per paragraph or
/// heading, list items prefixed with "- ".
pub fn html_to_text(html: &str) -> String {
    use scraper::{node::Node, ElementRef, Html};

    fn walk(el: ElementRef, out: &mut String) {
        for child in el.children() {
            match child.value() {
                Node::Text(t) => {
                    // Collapse runs of whitespace but keep a single space at the
                    // edges, so "<b>Workflows</b> aufbauen" stays two words.
                    let raw: &str = t;
                    let words = raw.split_whitespace().collect::<Vec<_>>().join(" ");
                    let needs_gap = !out.is_empty() && !out.ends_with([' ', '\n']);
                    if words.is_empty() {
                        if needs_gap && !raw.is_empty() {
                            out.push(' ');
                        }
                        continue;
                    }
                    if needs_gap && raw.starts_with(char::is_whitespace) {
                        out.push(' ');
                    }
                    out.push_str(&words);
                    if raw.ends_with(char::is_whitespace) {
                        out.push(' ');
                    }
                }
                Node::Element(e) => {
                    let name = e.name();
                    if matches!(name, "script" | "style" | "form") {
                        continue;
                    }
                    let block = matches!(name, "p" | "div" | "li" | "ul" | "ol" | "h1" | "h2" | "h3" | "h4" | "br" | "tr");
                    // A block right after a list marker (<li><p>…) stays on the marker's line.
                    if block && !out.ends_with('\n') && !out.ends_with("- ") && !out.is_empty() {
                        out.push('\n');
                    }
                    if name == "li" {
                        out.push_str("- ");
                    }
                    if let Some(child_el) = ElementRef::wrap(child) {
                        walk(child_el, out);
                    }
                    if block && !out.ends_with('\n') {
                        out.push('\n');
                    }
                }
                _ => {}
            }
        }
    }

    let doc = Html::parse_fragment(html);
    let mut out = String::new();
    walk(doc.root_element(), &mut out);
    out.lines().map(str::trim).filter(|l| !l.is_empty() && *l != "-").collect::<Vec<_>>().join("\n")
}

#[cfg(test)]
mod tests {
    use super::html_to_text;

    #[test]
    fn keeps_spaces_around_inline_tags() {
        let html = "<p>Datenmodelle und <strong>Workflows</strong> aufzubauen, (z.&nbsp;B. <em>.NET</em>/C#)</p>";
        assert_eq!(html_to_text(html), "Datenmodelle und Workflows aufzubauen, (z. B. .NET/C#)");
    }

    #[test]
    fn formats_headings_and_lists() {
        let html = "<h3><strong>DEINE AUFGABEN</strong></h3><ul><li><p>Code schreiben</p></li><li>Tests</li></ul><p>Ende</p>";
        assert_eq!(html_to_text(html), "DEINE AUFGABEN\n- Code schreiben\n- Tests\nEnde");
    }
}
