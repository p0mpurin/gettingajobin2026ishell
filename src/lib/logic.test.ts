// Run with: npm test  (node --test, Node 22+ strips the types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { companyKey, mergeDuplicates, titleKey } from "./dedupe.ts";
import { followUpDue, isFollowUpDue } from "./followup.ts";
import { analyze, germanNeed, germanOk } from "./match.ts";
import type { Job, Track } from "../types.ts";

const job = (over: Partial<Job>): Job => ({
  id: "x",
  source: "karriere-suedtirol",
  title: "Dev",
  company: "ACME",
  location: "Bozen",
  url: "",
  apply_url: null,
  published: null,
  salary: null,
  tags: [],
  junior: false,
  is_new: false,
  first_seen: 0,
  ...over,
});

const track = (over: Partial<Track>): Track => ({
  status: "applied",
  notes: "",
  updated: 0,
  applied: 0,
  title: "",
  company: "",
  location: "",
  url: "",
  apply_url: null,
  followed_up: null,
  remind_after: null,
  ...over,
});

test("title keys ignore gender markers and language-neutral suffixes", () => {
  assert.equal(titleKey("Software Testing Engineer (m/w/d)"), titleKey("Software Testing Engineer (m/f/d)"));
  assert.equal(titleKey("Buchhalter:in"), titleKey("Buchhalter (w/m/d)"));
  assert.equal(titleKey("Service desk specialist (m/w/d)"), titleKey("Service Desk Specialist (m/f/d)"));
  assert.notEqual(titleKey("Junior Developer"), titleKey("Senior Developer"));
});

test("company keys drop legal forms and resolve aliases", () => {
  assert.equal(companyKey("Datef AG"), companyKey("Datef"));
  assert.equal(companyKey("Fri-El Green Power S.p.A."), companyKey("Fri-El Green Power"));
  assert.equal(companyKey("Free University of Bozen-Bolzano"), companyKey("Freie Universität Bozen"));
  assert.notEqual(companyKey("Terra GmbH"), companyKey("lvh"));
});

test("merges bilingual copies and keeps the best listing as primary", () => {
  const jobs = [
    job({ id: "a", title: "IT Support Engineer (m/w/d)", company: "ACS Group", published: "2026-08-10" }),
    job({ id: "b", title: "IT Support Engineer (m/f/d)", company: "ACS Group", published: "2026-08-26", apply_url: "https://x" }),
    job({ id: "c", title: "Buchhalter (w/m/d)", company: "Terra GmbH" }),
    job({ id: "d", title: "Buchhalter (w/m/d)", company: "lvh" }),
  ];
  const merged = mergeDuplicates(jobs, {});
  assert.equal(merged.length, 3, "same title at different companies must not merge");
  const acs = merged.find((j) => j.company === "ACS Group")!;
  assert.equal(acs.id, "b", "newer listing with an apply link wins");
  assert.deepEqual(acs.duplicates!.map((d) => d.id), ["a"]);
});

test("a tracked listing stays primary so its status is shown", () => {
  const jobs = [job({ id: "a", title: "Dev (m/w/d)", apply_url: "x" }), job({ id: "b", title: "Dev (m/f/d)" })];
  const merged = mergeDuplicates(jobs, { b: track({ status: "saved" }) });
  assert.equal(merged[0].id, "b");
});

test("German need: required, implied, plus, none, unknown", () => {
  const skills: string[] = [];
  assert.equal(germanNeed(undefined), "unknown");
  assert.equal(germanNeed(analyze("Dev", "Sehr gute Deutschkenntnisse.", skills)), "required");
  assert.equal(germanNeed(analyze("Dev", "Wir suchen dich für unser Team und bieten dir die Chance.", skills)), "implied");
  assert.equal(germanNeed(analyze("Dev", "Fluent English. German is a plus.", skills)), "plus");
  assert.equal(germanNeed(analyze("Dev", "You will build our web platform with the team.", skills)), "none");
  assert.ok(germanOk("plus") && germanOk("none") && !germanOk("implied") && !germanOk("unknown"));
});

test("follow-up due after N days, restarts after following up, respects snooze", () => {
  const day = 86_400;
  const t = track({ applied: 1_000 * day });
  assert.equal(followUpDue(t, 7), 1_007 * day);
  assert.ok(!isFollowUpDue(t, 7, 1_006 * day));
  assert.ok(isFollowUpDue(t, 7, 1_007 * day));
  assert.equal(followUpDue({ ...t, followed_up: 1_010 * day }, 7), 1_017 * day);
  assert.equal(followUpDue({ ...t, remind_after: 1_009 * day }, 7), 1_009 * day);
  assert.equal(followUpDue({ ...t, status: "interview" }, 7), null, "no reminder once they replied");
  assert.equal(followUpDue(t, 0), null, "0 days turns reminders off");
});

import { buildIcs, fromLocalInput, toLocalInput } from "./ics.ts";

test("calendar file is valid iCalendar with escaping, folding and reminders", () => {
  const ics = buildIcs(
    { uid: "ks-1-100", start: 1_793_350_800, minutes: 60, title: "Interview: Dev, Junior; Bozen", location: "Bozen", description: "Contact: Anna\nhttps://example.com/" + "x".repeat(120) },
    1_793_000_000,
  );
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert.match(ics, /DTSTART:20261030T090000Z\r\nDTEND:20261030T100000Z/);
  assert.match(ics, /SUMMARY:Interview: Dev\\, Junior\\; Bozen/);
  assert.match(ics, /DESCRIPTION:Contact: Anna\\n/);
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 2);
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, "lines are folded at 75 octets");
});

test("datetime-local values round-trip through unix seconds", () => {
  const secs = fromLocalInput("2026-10-30T10:00")!;
  assert.equal(toLocalInput(secs), "2026-10-30T10:00");
  assert.equal(fromLocalInput(""), null);
});

import { hiddenBy } from "./rules.ts";

test("hide rules match whole words and companies across legal forms", () => {
  assert.equal(hiddenBy("Senior Software Developer (m/w/d)", "ACME", ["Senior"], []), "word: Senior");
  assert.equal(hiddenBy("Team Lead Software*", "ACME", ["lead"], []), "word: lead");
  assert.equal(hiddenBy("Leadership Trainee", "ACME", ["Lead"], []), null, "no partial-word hits");
  assert.equal(hiddenBy("Junior Dev", "Datef AG", [], ["Datef"]), "company: Datef AG");
  assert.equal(hiddenBy("Head of IT", "X", ["Head of"], []), "word: Head of");
  assert.equal(hiddenBy("Junior Dev", "ACME", ["Senior"], ["Other"]), null);
});

import { weeklyStats, weekStart } from "./weekly.ts";

test("weekly stats: this week, streak, reply rate and days to reply", () => {
  const day = 86_400;
  // Wednesday 29 Oct 2026, 12:00 local.
  const now = new Date(2026, 9, 29, 12).getTime() / 1000;
  const mon = weekStart(now);
  assert.equal(new Date(mon * 1000).getDay(), 1, "weeks start on Monday");
  const t = (applied: number, status: Track["status"] = "applied", updated = applied) => track({ applied, status, updated });
  const tracks = [
    t(mon + day), t(mon + 2 * day), // this week: 2
    t(mon - 6 * day), t(mon - 5 * day, "interview", mon - 2 * day), // last week: 2
    t(mon - 13 * day, "rejected", mon - 10 * day), t(mon - 12 * day), // two weeks ago: 2
    t(mon - 20 * day), // three weeks ago: 1
  ];
  const s = weeklyStats(tracks, 2, now);
  assert.equal(s.thisWeek, 2);
  assert.equal(s.streak, 3, "this week + 2 previous weeks met the goal of 2");
  assert.equal(s.applied, 7);
  assert.equal(s.responded, 2);
  assert.equal(s.responseRate, 29);
  assert.equal(s.avgDaysToReply, 3);
  assert.equal(s.history.length, 8);
  assert.equal(s.history[7].count, 2);
  assert.equal(weeklyStats(tracks, 5, now).streak, 0);
  assert.equal(weeklyStats([], 5, now).responseRate, null);
});
