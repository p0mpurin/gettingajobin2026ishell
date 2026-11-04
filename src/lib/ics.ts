/** Builds a single-event iCalendar file that Outlook, Google and Apple Calendar import. */

const pad = (n: number) => String(n).padStart(2, "0");

/** Unix seconds -> "20261030T090000Z". */
function stamp(secs: number): string {
  const d = new Date(secs * 1000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** Escapes text per RFC 5545 and folds lines longer than 75 octets. */
function text(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 74;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out.join("\r\n");
}

export interface CalendarEvent {
  uid: string;
  start: number; // unix seconds
  minutes: number;
  title: string;
  location: string;
  description: string;
}

export function buildIcs(e: CalendarEvent, now = Date.now() / 1000): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//p0mpurin//Bolzano Jobs//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}@bolzano-jobs`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.start + e.minutes * 60)}`,
    `SUMMARY:${text(e.title)}`,
    `LOCATION:${text(e.location)}`,
    `DESCRIPTION:${text(e.description)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${text(e.title)}`,
    "TRIGGER:-P1D",
    "END:VALARM",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${text(e.title)}`,
    "TRIGGER:-PT1H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** "<input type=datetime-local>" value <-> unix seconds, in local time. */
export function toLocalInput(secs: number | null): string {
  if (!secs) return "";
  const d = new Date(secs * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

/** "Thu 30 Oct, 10:00" */
export function formatWhen(secs: number): string {
  return new Date(secs * 1000).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
