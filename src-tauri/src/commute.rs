//! Public-transport commute from the user's home town to a job's town, from
//! South Tyrol's journey planner (the EFA service behind Südtirolmobil,
//! `efa.sta.bz.it`). Asked for trips arriving by 8:30 on the next weekday.
//! Results are cached per town pair, so each pair is looked up once a month.

use crate::export::iso_date;
use crate::store::now;
use serde::{Deserialize, Serialize};

const EFA: &str = "https://efa.sta.bz.it/apb";
/// Cached commutes are refreshed after this long (timetables change).
pub const MAX_AGE: u64 = 30 * 24 * 3600;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Commute {
    /// The job's town as the planner knows it (German name).
    pub town: String,
    /// Door-to-door minutes of the quickest morning trip (0 = same town).
    pub minutes: u32,
    pub changes: u32,
    /// Means of transport in order, e.g. "Bus › Regionalzug".
    pub modes: String,
    pub fetched: u64,
}

/// Italian and German town names (lower case) -> the German name the planner uses.
const TOWNS: &[(&str, &str)] = &[
    ("bozen", "Bozen"), ("bolzano", "Bozen"), ("meran", "Meran"), ("merano", "Meran"),
    ("brixen", "Brixen"), ("bressanone", "Brixen"), ("bruneck", "Bruneck"), ("brunico", "Bruneck"),
    ("leifers", "Leifers"), ("laives", "Leifers"), ("eppan", "Eppan"), ("appiano", "Eppan"),
    ("kaltern", "Kaltern"), ("caldaro", "Kaltern"), ("lana", "Lana"), ("auer", "Auer"), ("ora", "Auer"),
    ("neumarkt", "Neumarkt"), ("egna", "Neumarkt"), ("sterzing", "Sterzing"), ("vipiteno", "Sterzing"),
    ("schlanders", "Schlanders"), ("silandro", "Schlanders"), ("klausen", "Klausen"), ("chiusa", "Klausen"),
    ("terlan", "Terlan"), ("terlano", "Terlan"), ("unterinn", "Unterinn"), ("ritten", "Klobenstein"),
    ("renon", "Klobenstein"), ("andrian", "Andrian"), ("andriano", "Andrian"), ("frangart", "Frangart"),
    ("girlan", "Girlan"), ("tramin", "Tramin"), ("termeno", "Tramin"), ("kurtatsch", "Kurtatsch"),
    ("salurn", "Salurn"), ("salorno", "Salurn"), ("algund", "Algund"), ("lagundo", "Algund"),
    ("naturns", "Naturns"), ("naturno", "Naturns"), ("partschins", "Partschins"), ("marling", "Marling"),
    ("schenna", "Schenna"), ("nals", "Nals"), ("st. ulrich", "St. Ulrich"), ("ortisei", "St. Ulrich"),
    ("innichen", "Innichen"), ("san candido", "Innichen"), ("toblach", "Toblach"), ("dobbiaco", "Toblach"),
    ("sand in taufers", "Sand in Taufers"), ("campo tures", "Sand in Taufers"), ("mals", "Mals"),
    ("malles", "Mals"), ("kastelruth", "Kastelruth"), ("castelrotto", "Kastelruth"), ("vahrn", "Vahrn"),
    ("varna", "Vahrn"), ("sarnthein", "Sarnthein"), ("sarentino", "Sarnthein"), ("jenesien", "Jenesien"),
    ("deutschnofen", "Deutschnofen"), ("nova ponente", "Deutschnofen"), ("welsberg", "Welsberg"),
];

/// The first known town named in a job location like "39100 Bolzano (BZ)" or "Bologna, Bozen".
pub fn town_of(location: &str) -> Option<&'static str> {
    let l = location.to_lowercase();
    let words: Vec<&str> = l.split(|c: char| !(c.is_alphanumeric() || c == '.')).filter(|w| !w.is_empty()).collect();
    let text = format!(" {} ", words.join(" "));
    TOWNS
        .iter()
        .filter_map(|(alias, de)| text.find(&format!(" {alias} ")).map(|pos| (pos, *de)))
        .min_by_key(|(pos, _)| *pos)
        .map(|(_, de)| de)
}

#[derive(Deserialize)]
struct Locations {
    #[serde(default)]
    locations: Vec<Location>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Location {
    id: String,
    name: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    match_quality: i64,
}

/// The planner's stop for a town: its station if it has one, else its best-matching stop.
async fn stop_id(client: &reqwest::Client, town: &str) -> Result<String, String> {
    let r: Locations = client
        .get(format!("{EFA}/XML_STOPFINDER_REQUEST"))
        .query(&[("outputFormat", "rapidJSON"), ("language", "de"), ("type_sf", "any"), ("name_sf", town)])
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let prefix = town.to_lowercase();
    let mut stops: Vec<&Location> = r
        .locations
        .iter()
        .filter(|l| l.kind == "stop" && l.name.to_lowercase().starts_with(&prefix))
        .collect();
    stops.sort_by_key(|l| (!l.name.contains("Bahnhof"), -l.match_quality));
    stops.first().map(|l| l.id.clone()).ok_or_else(|| format!("no stop found for {town}"))
}

#[derive(Deserialize)]
struct Trips {
    #[serde(default)]
    journeys: Vec<Journey>,
}

#[derive(Deserialize)]
struct Journey {
    #[serde(default)]
    interchanges: u32,
    legs: Vec<Leg>,
}

#[derive(Deserialize)]
struct Leg {
    origin: Point,
    destination: Point,
    transportation: Option<Transport>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Point {
    departure_time_planned: Option<String>,
    arrival_time_planned: Option<String>,
}

#[derive(Deserialize)]
struct Transport {
    product: Option<Product>,
}

#[derive(Deserialize)]
struct Product {
    name: String,
}

/// Minutes since the epoch for an ISO time like "2026-11-04T07:33:00Z".
fn minutes(iso: &str) -> Option<i64> {
    let (date, time) = iso.split_once('T')?;
    let mut d = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let mut t = time.trim_end_matches('Z').split(':').map(|p| p.parse::<i64>().ok());
    let (h, min) = (t.next()??, t.next()??);
    // Days from civil date (Howard Hinnant's algorithm).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some((era * 146097 + doe - 719468) * 1440 + h * 60 + min)
}

/// YYYYMMDD of the next Monday-to-Friday after `secs`.
fn next_weekday(secs: u64) -> String {
    let mut day = secs / 86400 + 1;
    // 1970-01-01 was a Thursday: (day + 4) % 7 gives 0 = Sunday.
    while matches!((day + 4) % 7, 0 | 6) {
        day += 1;
    }
    iso_date(day * 86400).replace('-', "")
}

fn quickest(trips: Trips) -> Option<(u32, u32, String)> {
    trips
        .journeys
        .into_iter()
        .filter_map(|j| {
            let dep = minutes(j.legs.first()?.origin.departure_time_planned.as_deref()?)?;
            let arr = minutes(j.legs.last()?.destination.arrival_time_planned.as_deref()?)?;
            let modes: Vec<String> = j
                .legs
                .iter()
                .filter_map(|l| l.transportation.as_ref()?.product.as_ref().map(|p| p.name.clone()))
                .filter(|n| n != "footpath")
                .collect();
            Some(((arr - dep).max(0) as u32, j.interchanges, modes.join(" › ")))
        })
        .min_by_key(|(m, changes, _)| (*m, *changes))
}

pub async fn lookup(client: &reqwest::Client, home: &str, town: &str) -> Result<Commute, String> {
    if home.eq_ignore_ascii_case(town) {
        return Ok(Commute { town: town.into(), modes: "Same town".into(), fetched: now(), ..Default::default() });
    }
    let (from, to) = tokio::try_join!(stop_id(client, home), stop_id(client, town))?;
    let trips: Trips = client
        .get(format!("{EFA}/XML_TRIP_REQUEST2"))
        .query(&[
            ("outputFormat", "rapidJSON"),
            ("language", "de"),
            ("type_origin", "any"),
            ("name_origin", &from),
            ("type_destination", "any"),
            ("name_destination", &to),
            ("itdDate", &next_weekday(now())),
            ("itdTime", "0830"),
            ("itdTripDateTimeDepArr", "arr"),
            ("calcNumberOfTrips", "4"),
        ])
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let (minutes, changes, modes) = quickest(trips).ok_or_else(|| format!("no connection to {town}"))?;
    Ok(Commute { town: town.into(), minutes, changes, modes, fetched: now() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_towns_in_both_languages() {
        assert_eq!(town_of("39100 Bolzano (BZ)"), Some("Bozen"));
        assert_eq!(town_of("Bologna, Bozen"), Some("Bozen"));
        assert_eq!(town_of("Unterinn, Ritten"), Some("Unterinn"));
        assert_eq!(town_of("Caldaro sulla Strada del Vino"), Some("Kaltern"));
        assert_eq!(town_of("Oradea"), None, "whole words only");
        assert_eq!(town_of("München"), None);
    }

    #[test]
    fn weekday_and_time_maths() {
        // 2026-11-06 is a Friday; the next weekday is Monday 2026-11-09.
        assert_eq!(next_weekday(1_793_923_200), "20261109");
        assert_eq!(minutes("2026-11-04T07:33:00Z").unwrap() - minutes("2026-11-04T07:07:00Z").unwrap(), 26);
        assert_eq!(minutes("1970-01-02T00:00:00Z"), Some(1440));
    }

    /// Hits the real planner: run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live_lookup() {
        let client = reqwest::Client::builder().user_agent("BolzanoJobs-test").build().unwrap();
        for town in ["Bozen", "Unterinn", "Meran"] {
            let c = lookup(&client, "Kaltern", town).await.unwrap();
            println!("{c:?}");
            assert!(c.minutes > 10 && c.minutes < 150);
        }
    }
}
