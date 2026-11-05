//! Reads replies to applications from the user's mailbox and updates the pipeline.
//! The connection is strictly read-only: the mailbox is opened with EXAMINE and
//! messages are fetched with PEEK, so nothing is changed, moved or marked as read,
//! and no sending exists here at all. Only mail that matches an application is read
//! past its headers. Email text is untrusted: it's only ever classified.

use crate::store::{now, Data, MailEvent, MailSuggestion};
use crate::tools;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

const MAX_HEADERS: usize = 500;
const BODY_BYTES: usize = 30_000;

trait Stream: Read + Write + Send {}
impl<T: Read + Write + Send> Stream for T {}

struct Imap {
    conn: BufReader<Box<dyn Stream>>,
    tag: u32,
}

/// One response: its text with any literal blocks inline.
struct Reply {
    ok: bool,
    /// Untagged lines, each with its literal data if it had any.
    lines: Vec<(String, Vec<u8>)>,
}

impl Imap {
    fn connect(host: &str, port: u16) -> Result<Self, String> {
        let tcp = TcpStream::connect((host, port)).map_err(|e| format!("Couldn't reach {host}: {e}"))?;
        tcp.set_read_timeout(Some(Duration::from_secs(30))).map_err(|e| e.to_string())?;
        tcp.set_write_timeout(Some(Duration::from_secs(30))).map_err(|e| e.to_string())?;
        // Plain only for a local test server; real mail always goes over TLS.
        let stream: Box<dyn Stream> = if cfg!(test) && host == "127.0.0.1" {
            Box::new(tcp)
        } else {
            let mut roots = rustls::RootCertStore::empty();
            roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            let config = rustls::ClientConfig::builder_with_provider(rustls::crypto::ring::default_provider().into())
                .with_safe_default_protocol_versions()
                .map_err(|e| e.to_string())?
                .with_root_certificates(roots)
                .with_no_client_auth();
            let name = rustls::pki_types::ServerName::try_from(host.to_string()).map_err(|e| e.to_string())?;
            let session = rustls::ClientConnection::new(Arc::new(config), name).map_err(|e| e.to_string())?;
            Box::new(rustls::StreamOwned::new(session, tcp))
        };
        let mut me = Self { conn: BufReader::new(stream), tag: 0 };
        let mut greeting = String::new();
        me.conn.read_line(&mut greeting).map_err(|e| format!("No answer from {host}: {e}"))?;
        if !greeting.starts_with("* OK") && !greeting.starts_with("* PREAUTH") {
            return Err(format!("{host} didn't accept the connection."));
        }
        Ok(me)
    }

    fn command(&mut self, cmd: &str) -> Result<Reply, String> {
        self.tag += 1;
        let tag = format!("a{}", self.tag);
        write!(self.conn.get_mut(), "{tag} {cmd}\r\n").and_then(|_| self.conn.get_mut().flush()).map_err(|e| e.to_string())?;
        let mut lines = Vec::new();
        loop {
            let mut line = String::new();
            let n = self.conn.read_line(&mut line).map_err(|e| e.to_string())?;
            if n == 0 {
                return Err("The mail server closed the connection.".into());
            }
            if let Some(rest) = line.strip_prefix(&format!("{tag} ")) {
                return Ok(Reply { ok: rest.starts_with("OK"), lines });
            }
            let mut literal = Vec::new();
            // A line ending in {123} is followed by 123 raw bytes, then the rest of it.
            if let Some(size) = line.trim_end().strip_suffix('}').and_then(|l| l.rsplit('{').next()).and_then(|s| s.parse::<usize>().ok()) {
                literal.resize(size, 0);
                self.conn.read_exact(&mut literal).map_err(|e| e.to_string())?;
                let mut tail = String::new();
                self.conn.read_line(&mut tail).map_err(|e| e.to_string())?;
            }
            lines.push((line, literal));
        }
    }

    fn login(&mut self, user: &str, password: &str) -> Result<(), String> {
        let q = |s: &str| format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""));
        if !self.command(&format!("LOGIN {} {}", q(user), q(password)))?.ok {
            return Err("The mail server refused that address or app password.".into());
        }
        Ok(())
    }

    /// EXAMINE, not SELECT: the server itself then treats the mailbox as read-only.
    fn open_inbox(&mut self) -> Result<(), String> {
        if !self.command("EXAMINE INBOX")?.ok {
            return Err("Couldn't open the inbox.".into());
        }
        Ok(())
    }

    fn search_since(&mut self, days: u64) -> Result<Vec<u64>, String> {
        let r = self.command(&format!("UID SEARCH SINCE {}", imap_date(now().saturating_sub(days * 86400))))?;
        let mut uids: Vec<u64> = r.lines.iter().filter(|(l, _)| l.starts_with("* SEARCH")).flat_map(|(l, _)| l.split_whitespace().skip(2).filter_map(|n| n.parse().ok()).collect::<Vec<u64>>()).collect();
        uids.sort_unstable();
        // Newest first, so a huge mailbox still gets the part that matters.
        uids.reverse();
        uids.truncate(MAX_HEADERS);
        Ok(uids)
    }

    fn headers(&mut self, uids: &[u64]) -> Result<Vec<(u64, Vec<u8>)>, String> {
        if uids.is_empty() {
            return Ok(Vec::new());
        }
        let set = uids.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
        let r = self.command(&format!("UID FETCH {set} (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])"))?;
        Ok(r.lines.into_iter().filter(|(_, lit)| !lit.is_empty()).filter_map(|(line, lit)| Some((uid_of(&line)?, lit))).collect())
    }

    fn body(&mut self, uid: u64) -> Result<Vec<u8>, String> {
        let r = self.command(&format!("UID FETCH {uid} (BODY.PEEK[]<0.{BODY_BYTES}>)"))?;
        Ok(r.lines.into_iter().map(|(_, lit)| lit).find(|l| !l.is_empty()).unwrap_or_default())
    }

    fn logout(&mut self) {
        let _ = self.command("LOGOUT");
    }
}

fn uid_of(line: &str) -> Option<u64> {
    let (_, rest) = line.split_once("UID ")?;
    rest.split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()
}

fn imap_date(secs: u64) -> String {
    let iso = crate::export::iso_date(secs);
    let mut p = iso.split('-');
    let (y, m, d) = (p.next().unwrap_or("2026"), p.next().unwrap_or("1"), p.next().unwrap_or("1"));
    let month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m.parse::<usize>().unwrap_or(1).clamp(1, 12) - 1];
    format!("{}-{month}-{y}", d.trim_start_matches('0'))
}

/// Checks the address and app password work.
pub fn test_login(host: &str, port: u16, user: &str, password: &str) -> Result<(), String> {
    let mut imap = Imap::connect(host, port)?;
    imap.login(user, password)?;
    imap.open_inbox()?;
    imap.logout();
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    Rejection,
    Interview,
    Offer,
    Received,
    Other,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Rejection => "rejection",
            Kind::Interview => "interview",
            Kind::Offer => "offer",
            Kind::Received => "received",
            Kind::Other => "other",
        }
    }
}

fn has(text: &str, words: &[&str]) -> bool {
    words.iter().any(|w| text.contains(w))
}

/// Reads what kind of reply this is, in German, Italian or English. A rejection
/// beats everything: they often mention an interview or the application too.
pub fn classify(subject: &str, body: &str) -> Kind {
    let text = format!("{subject}\n{body}").to_lowercase();
    if has(&text, &["unsubscribe", "abmelden", "disiscriv", "job alert", "jobs for you", "neue jobs", "stellenangebote für dich", "newsletter"]) && !has(&text, &["ihre bewerbung", "deine bewerbung", "your application", "tua candidatura", "sua candidatura"]) {
        return Kind::Other;
    }
    let rejection = [
        "leider", "absage", "nicht berücksichtigen", "nicht berücksichtigt", "anderen kandidaten", "anderen bewerber", "nicht weiter", "unfortunately", "regret to", "not to move forward", "not moving forward",
        "other candidates", "not been successful", "not selected", "will not be", "purtroppo", "non è stata", "non e stata", "non abbiamo selezionato", "altri candidati", "altro candidato", "non proseguire", "esito negativo",
    ];
    if has(&text, &rejection) {
        return Kind::Rejection;
    }
    if has(&text, &["vertragsangebot", "job offer", "offer letter", "offerta di lavoro", "proposta di assunzione", "pleased to offer", "freuen uns, ihnen ein angebot"]) {
        return Kind::Offer;
    }
    if has(&text, &["vorstellungsgespräch", "bewerbungsgespräch", "kennenlerngespräch", "kennenlernen", "gesprächstermin", "interview", "colloquio", "incontro conoscitivo", "invite you", "einladen", "einladung"]) {
        return Kind::Interview;
    }
    if has(&text, &["eingegangen", "erhalten", "eingang", "received your", "thank you for applying", "thanks for applying", "abbiamo ricevuto", "ricevuto la", "grazie per la candidatura", "danke für deine bewerbung", "danke für ihre bewerbung"]) {
        return Kind::Received;
    }
    Kind::Other
}

/// Whether this looks like it's about a job application at all.
fn about_application(subject: &str, body: &str) -> bool {
    let t = format!("{subject}\n{body}").to_lowercase();
    has(&t, &["bewerbung", "application", "candidatura", "applying", "stelle als", "posizione di"])
}

/// The company's name without legal words, as words long enough to mean something.
fn company_words(company: &str) -> Vec<String> {
    const LEGAL: &[&str] = &["gmbh", "srl", "spa", "ag", "kg", "ohg", "snc", "sas", "group", "gruppe", "the", "und", "and", "kons", "konsgmbh", "soc", "coop", "gen", "ltd", "inc", "italia", "italien", "service"];
    company
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() >= 4 && !LEGAL.contains(w))
        .map(String::from)
        .collect()
}

/// The tracked application a message is about, if any: its sender or subject has to
/// name the company, and it can't be older than the application.
fn match_track(data: &Data, from: &str, subject: &str, date: u64) -> Option<String> {
    let hay = format!("{from} {subject}").to_lowercase();
    data.tracks
        .iter()
        .filter(|(_, t)| matches!(t.status.as_str(), "applied" | "interview" | "offer" | "rejected"))
        .filter(|(_, t)| t.applied.is_none_or(|a| date + 86400 >= a))
        .filter(|(_, t)| company_words(&t.company).iter().any(|w| hay.contains(w.as_str())))
        .max_by_key(|(_, t)| t.applied.unwrap_or(0))
        .map(|(id, _)| id.clone())
}

fn sender_name(from: &str) -> String {
    let name = from.split('<').next().unwrap_or("").trim().trim_matches('"').trim();
    if !name.is_empty() {
        return name.to_string();
    }
    // No display name: the domain is the best guess at the company.
    from.split('@').nth(1).and_then(|d| d.split('.').next()).unwrap_or(from).trim_matches('>').to_string()
}

fn fnv(s: &str) -> String {
    let h = s.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3));
    format!("{h:016x}")
}

fn plain_text(raw: &[u8]) -> String {
    let Ok(parsed) = mailparse::parse_mail(raw) else { return String::new() };
    fn walk(m: &mailparse::ParsedMail, plain: &mut String, html: &mut String) {
        let ty = m.ctype.mimetype.to_lowercase();
        if ty == "text/plain" && plain.is_empty() {
            *plain = m.get_body().unwrap_or_default();
        } else if ty == "text/html" && html.is_empty() {
            *html = m.get_body().unwrap_or_default();
        }
        m.subparts.iter().for_each(|p| walk(p, plain, html));
    }
    let (mut plain, mut html) = (String::new(), String::new());
    walk(&parsed, &mut plain, &mut html);
    if plain.trim().is_empty() {
        crate::sources::html_to_text(&html)
    } else {
        plain
    }
}

#[derive(serde::Serialize, Default, Debug)]
pub struct SyncReport {
    pub checked: usize,
    /// Status changes made, for the app to show with Undo.
    pub updates: Vec<MailEvent>,
    pub suggestions: usize,
}

/// A message read from the server, ready to be applied.
pub struct Found {
    pub message_id: String,
    pub from: String,
    pub subject: String,
    pub date: u64,
    pub kind: Kind,
    pub track: Option<String>,
}

/// Fetches what's new. Reads message text only for mail that matches an application
/// or says it's about one; everything else stays unread beyond its headers.
pub fn fetch(host: &str, port: u16, user: &str, password: &str, days: u64, data: &Data) -> Result<(usize, Vec<Found>), String> {
    let mut imap = Imap::connect(host, port)?;
    imap.login(user, password)?;
    imap.open_inbox()?;
    let uids = imap.search_since(days)?;
    let headers = imap.headers(&uids)?;
    let mut found = Vec::new();
    let checked = headers.len();
    for (uid, raw) in headers {
        let Ok((heads, _)) = mailparse::parse_headers(&raw) else { continue };
        use mailparse::MailHeaderMap;
        let get = |n: &str| heads.get_first_value(n).unwrap_or_default();
        let (from, subject) = (get("From"), get("Subject"));
        let message_id = {
            let id = get("Message-ID");
            if id.is_empty() { fnv(&format!("{from}{subject}{}", get("Date"))) } else { id }
        };
        if data.mail_seen.contains(&message_id) {
            continue;
        }
        let date = mailparse::dateparse(&get("Date")).ok().map(|d| d.max(0) as u64).unwrap_or_else(now);
        let track = match_track(data, &from, &subject, date);
        if track.is_none() && !about_application(&subject, "") {
            continue;
        }
        let body = plain_text(&imap.body(uid)?);
        if track.is_none() && !about_application(&subject, &body) {
            continue;
        }
        let kind = classify(&subject, &body);
        found.push(Found { message_id, from, subject, date, kind, track });
    }
    imap.logout();
    found.sort_by_key(|f| f.date);
    Ok((checked, found))
}

/// Applies fetched messages. Status only ever follows the replies: a rejection or
/// interview for a matched job. Replies from unknown companies become suggestions,
/// which also finds applications made outside the app.
pub fn apply(data: &mut Data, found: Vec<Found>, auto_update: bool, report: &mut SyncReport) {
    for f in found {
        data.mail_seen.insert(f.message_id.clone());
        let status_for = |k: Kind| match k {
            Kind::Rejection => Some("rejected"),
            Kind::Interview => Some("interview"),
            Kind::Offer => Some("offer"),
            _ => None,
        };
        match &f.track {
            Some(id) => {
                let Some(track) = data.tracks.get_mut(id) else { continue };
                let target = status_for(f.kind);
                let moves = auto_update
                    && target.is_some_and(|to| {
                        // A late "we've received it" can't undo a result, and a rejection is final.
                        track.status != to && track.status != "rejected" && !(to == "interview" && track.status == "offer")
                    });
                let mut event = MailEvent { message_id: f.message_id.clone(), date: f.date, from: f.from.clone(), subject: f.subject.clone(), kind: f.kind.name().into(), job_id: id.clone(), previous_status: String::new(), moved_to: String::new() };
                if moves {
                    event.previous_status = track.status.clone();
                    event.moved_to = target.unwrap_or("").to_string();
                    track.status = event.moved_to.clone();
                    track.updated = now();
                    track.queued = false;
                    report.updates.push(event.clone());
                }
                if f.kind != Kind::Other {
                    track.mails.push(event);
                }
            }
            None if f.kind != Kind::Other => {
                let company = sender_name(&f.from);
                let id = fnv(&company.to_lowercase());
                // One card per company, with the latest news on it.
                let known = data.tracks.values().any(|t| company_words(&t.company).iter().any(|w| company.to_lowercase().contains(w.as_str())));
                if known || data.mail_dismissed.contains(&id) {
                    continue;
                }
                data.mail_suggestions.retain(|s| s.id != id);
                data.mail_suggestions.push(MailSuggestion { id, company, subject: f.subject, date: f.date, kind: f.kind.name().into() });
                report.suggestions += 1;
            }
            None => {}
        }
    }
}

/// Adds a suggested past application to the pipeline, or dismisses it for good.
pub fn resolve_suggestion(data: &mut Data, id: &str, accept: bool) -> Result<(), String> {
    let pos = data.mail_suggestions.iter().position(|s| s.id == id).ok_or("That suggestion is gone.")?;
    let s = data.mail_suggestions.remove(pos);
    if !accept {
        data.mail_dismissed.insert(s.id);
        return Ok(());
    }
    let status = match s.kind.as_str() {
        "rejection" => "rejected",
        "interview" => "interview",
        "offer" => "offer",
        _ => "applied",
    };
    let track = crate::store::Track {
        status: status.into(),
        title: tools::clean_subject(&s.subject),
        company: s.company,
        updated: now(),
        applied: Some(s.date),
        notes: format!("Found in your email: {}", s.subject),
        ..Default::default()
    };
    data.tracks.insert(format!("mail-{id}"), track);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Track;

    #[test]
    fn reads_replies_in_three_languages() {
        for (s, b) in [
            ("Ihre Bewerbung", "Leider müssen wir Ihnen mitteilen..."),
            ("Your application", "Unfortunately we have decided to move forward with other candidates."),
            ("La tua candidatura", "Purtroppo la tua candidatura non è stata selezionata."),
            ("Einladung", "Leider können wir Sie nicht zum Vorstellungsgespräch einladen."),
        ] {
            assert_eq!(classify(s, b), Kind::Rejection, "{b}");
        }
        assert_eq!(classify("Einladung zum Vorstellungsgespräch", "Wir freuen uns"), Kind::Interview);
        assert_eq!(classify("Colloquio", "Vorremmo fissare un colloquio"), Kind::Interview);
        assert_eq!(classify("Offer", "We are pleased to offer you the role"), Kind::Offer);
        assert_eq!(classify("Danke für deine Bewerbung", "Sie ist bei uns eingegangen"), Kind::Received);
        assert_eq!(classify("Abbiamo ricevuto la tua candidatura", ""), Kind::Received);
        assert_eq!(classify("10 neue Jobs für dich", "Leider verpasst? Hier abmelden"), Kind::Other, "alerts aren't replies");
        assert_eq!(classify("Lunch on Friday?", "See you there"), Kind::Other);
    }

    fn data() -> Data {
        let mut d = Data::default();
        d.tracks.insert("a".into(), Track { status: "applied".into(), company: "Alpitronic GmbH".into(), applied: Some(1_000_000), ..Default::default() });
        d.tracks.insert("b".into(), Track { status: "saved".into(), company: "Saved Only AG".into(), ..Default::default() });
        d
    }

    #[test]
    fn matches_by_company_only_after_applying() {
        let d = data();
        assert_eq!(match_track(&d, "HR <jobs@alpitronic.it>", "Hello", 2_000_000).as_deref(), Some("a"));
        assert_eq!(match_track(&d, "x@y.com", "Re: Alpitronic position", 2_000_000).as_deref(), Some("a"));
        assert_eq!(match_track(&d, "HR <jobs@alpitronic.it>", "Old", 1), None, "before applying");
        assert_eq!(match_track(&d, "hr@saved-only.it", "Saved Only", 2_000_000), None, "not applied yet");
        assert_eq!(match_track(&d, "someone@gmail.com", "GmbH news", 2_000_000), None, "legal words don't match");
    }

    fn found(kind: Kind, track: Option<&str>, from: &str, id: &str) -> Found {
        Found { message_id: id.into(), from: from.into(), subject: "Ihre Bewerbung".into(), date: 2_000_000, kind, track: track.map(String::from) }
    }

    #[test]
    fn replies_move_the_pipeline_and_can_be_turned_off() {
        let mut d = data();
        let mut r = SyncReport::default();
        apply(&mut d, vec![found(Kind::Received, Some("a"), "hr@alpitronic.it", "1")], true, &mut r);
        assert_eq!(d.tracks["a"].status, "applied", "a confirmation changes nothing");
        apply(&mut d, vec![found(Kind::Interview, Some("a"), "hr@alpitronic.it", "2")], true, &mut r);
        assert_eq!(d.tracks["a"].status, "interview");
        assert_eq!(r.updates[0].previous_status, "applied");
        apply(&mut d, vec![found(Kind::Rejection, Some("a"), "hr@alpitronic.it", "3")], true, &mut r);
        assert_eq!(d.tracks["a"].status, "rejected");
        apply(&mut d, vec![found(Kind::Interview, Some("a"), "hr@alpitronic.it", "4")], true, &mut r);
        assert_eq!(d.tracks["a"].status, "rejected", "a rejection is final");
        assert_eq!(d.tracks["a"].mails.len(), 4);
        assert!(d.mail_seen.contains("3"));

        let mut d = data();
        apply(&mut d, vec![found(Kind::Rejection, Some("a"), "hr@alpitronic.it", "5")], false, &mut SyncReport::default());
        assert_eq!(d.tracks["a"].status, "applied", "off means it only records");
        assert_eq!(d.tracks["a"].mails.len(), 1);
    }

    #[test]
    fn unknown_companies_become_suggestions_that_rebuild_lost_applications() {
        let mut d = data();
        let mut r = SyncReport::default();
        apply(&mut d, vec![found(Kind::Rejection, None, "Loacker HR <hr@loacker.it>", "1"), found(Kind::Received, None, "Loacker HR <hr@loacker.it>", "2"), found(Kind::Other, None, "spam@x.it", "3")], true, &mut r);
        assert_eq!(d.mail_suggestions.len(), 1, "one per company, nothing for unrelated mail");
        let id = d.mail_suggestions[0].id.clone();
        resolve_suggestion(&mut d, &id, true).unwrap();
        let t = &d.tracks[&format!("mail-{id}")];
        assert_eq!((t.status.as_str(), t.company.as_str()), ("applied", "Loacker HR"));
        assert!(t.applied.is_some());

        apply(&mut d, vec![found(Kind::Received, None, "Other Co <hr@other.it>", "4")], true, &mut r);
        let id = d.mail_suggestions[0].id.clone();
        resolve_suggestion(&mut d, &id, false).unwrap();
        apply(&mut d, vec![found(Kind::Received, None, "Other Co <hr@other.it>", "5")], true, &mut r);
        assert!(d.mail_suggestions.is_empty(), "dismissed stays dismissed");
    }

    /// A small fake mail server that fails the test if anything could change mail.
    fn fake_server() -> (u16, std::thread::JoinHandle<Vec<String>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut read = BufReader::new(sock.try_clone().unwrap());
            sock.write_all(b"* OK ready\r\n").unwrap();
            let mut seen = Vec::new();
            let header = "From: Alpitronic HR <hr@alpitronic.it>\r\nSubject: =?UTF-8?Q?Ihre_Bewerbung?=\r\nDate: Tue, 3 Nov 2026 10:00:00 +0100\r\nMessage-ID: <m1@x>\r\n\r\n";
            let header2 = "From: Mum <mum@example.com>\r\nSubject: Dinner\r\nDate: Tue, 3 Nov 2026 11:00:00 +0100\r\nMessage-ID: <m2@x>\r\n\r\n";
            let body = "Content-Type: text/plain; charset=utf-8\r\nSubject: x\r\n\r\nLeider haben wir uns anders entschieden.";
            loop {
                let mut line = String::new();
                if read.read_line(&mut line).unwrap() == 0 {
                    break;
                }
                let (tag, cmd) = line.trim_end().split_once(' ').unwrap();
                seen.push(cmd.to_string());
                let out = if cmd.starts_with("UID SEARCH") {
                    format!("* SEARCH 7 8\r\n{tag} OK\r\n")
                } else if cmd.contains("HEADER.FIELDS") {
                    format!("* 1 FETCH (UID 7 BODY[HEADER.FIELDS (FROM)] {{{}}}\r\n{header})\r\n* 2 FETCH (UID 8 BODY[HEADER.FIELDS (FROM)] {{{}}}\r\n{header2})\r\n{tag} OK\r\n", header.len(), header2.len())
                } else if cmd.contains("BODY.PEEK[]") {
                    format!("* 1 FETCH (UID 7 BODY[]<0> {{{}}}\r\n{body})\r\n{tag} OK\r\n", body.len())
                } else {
                    format!("{tag} OK\r\n")
                };
                sock.write_all(out.as_bytes()).unwrap();
                if cmd == "LOGOUT" {
                    break;
                }
            }
            seen
        });
        (port, handle)
    }

    #[test]
    fn reads_only_what_matches_and_never_writes() {
        let (port, server) = fake_server();
        let mut d = data();
        d.tracks.get_mut("a").unwrap().applied = Some(1_000_000);
        let (checked, found) = fetch("127.0.0.1", port, "me@x.it", "pass\"word", 30, &d).unwrap();
        assert_eq!(checked, 2);
        assert_eq!(found.len(), 1, "unrelated mail is skipped");
        assert_eq!(found[0].kind, Kind::Rejection);
        assert_eq!(found[0].subject, "Ihre Bewerbung", "encoded subjects are decoded");
        let commands = server.join().unwrap();
        assert!(commands.iter().any(|c| c == "EXAMINE INBOX"), "read-only open");
        assert_eq!(commands.iter().filter(|c| c.contains("BODY.PEEK[]")).count(), 1, "only the matching mail's text was read");
        for c in &commands {
            let verb = c.split(' ').next().unwrap();
            assert!(["LOGIN", "EXAMINE", "UID", "LOGOUT"].contains(&verb), "unexpected command {c}");
            assert!(!c.contains("STORE") && !c.contains("EXPUNGE") && !c.contains("SELECT") && !c.contains("BODY["), "could change mail: {c}");
        }
        assert!(commands[0].contains("\\\""), "passwords are escaped");
    }

    /// Reaches a real mail server over TLS, no login: `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn tls_connects_to_gmail() {
        let mut imap = Imap::connect("imap.gmail.com", 993).unwrap();
        imap.logout();
    }
}
