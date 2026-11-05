import type { ReactNode } from "react";
import type { Job, Track } from "../types";
import { PIPELINE } from "../types";
import type { Analysis } from "../lib/match";
import { weeklyStats } from "../lib/weekly";
import { Flame, Target } from "lucide-react";
import { Panel, ScoreRing, SectionTitle } from "./ui";
import { ENOUGH, percent, replyStats, type Row } from "../lib/analytics";
import { t } from "../lib/i18n";

export function InsightsView({
  jobs,
  tracks,
  analyses,
  weeklyGoal,
}: {
  jobs: Job[];
  tracks: Record<string, Track>;
  analyses: Record<string, Analysis>;
  weeklyGoal: number;
}) {
  const w = weeklyStats(Object.values(tracks), weeklyGoal);
  const maxWeek = Math.max(1, weeklyGoal, ...w.history.map((h) => h.count));
  const live = jobs.filter((j) => !j.delisted);
  const newToday = live.filter((j) => j.is_new).length;
  const junior = live.filter((j) => j.junior).length;
  const scored = Object.entries(analyses).filter(([id, a]) => a.score !== null && live.some((j) => j.id === id));
  const strong = scored.filter(([, a]) => (a.score ?? 0) >= 70).length;
  const applied = Object.values(tracks).filter((t) => ["applied", "interview", "offer", "rejected"].includes(t.status)).length;
  const interviews = Object.values(tracks).filter((t) => ["interview", "offer"].includes(t.status)).length;

  const replies = replyStats(Object.values(tracks));
  const companies = top(live.map((j) => j.company).filter(Boolean), 8);
  const places = top(live.map((j) => j.location).filter(Boolean), 8);
  const missing = top(scored.flatMap(([, a]) => a.missing), 10);

  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-void">
      <div className="border-b border-line px-7 py-5">
        <h1 className="chrome-text text-[22px] font-semibold tracking-tight">Insights</h1>
        <p className="mt-1 text-[13px] text-chrome-500">What the South Tyrol market looks like right now, and how your search is going.</p>
      </div>
      <div className="view-in mx-auto max-w-5xl space-y-5 p-7">
        <Panel className="p-5">
          <SectionTitle>{t("What gets replies")}</SectionTitle>
          {replies.total === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-chrome-500">Once you've sent applications, this shows which CVs, messages and kinds of job actually get answers.</p>
          ) : (
            <div className="grid gap-5 md:grid-cols-3">
              <ReplyGroup title="By CV" rows={replies.byCv} />
              <ReplyGroup title="By message" rows={replies.byMessage} />
              <ReplyGroup title="By kind of job" rows={replies.byJob} />
            </div>
          )}
          {replies.total > 0 && replies.total < ENOUGH * 2 && <p className="mt-3 text-[11.5px] text-chrome-600">You've sent {replies.total} so far: too few to draw conclusions, so treat these as early hints.</p>}
        </Panel>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Open jobs" value={live.length} hint={`${newToday} new in 24h`} />
          <Stat label="Junior-friendly" value={junior} hint={`${pct(junior, live.length)} of all`} />
          <Stat label="Strong matches" value={strong} hint={`of ${scored.length} analysed`} />
          <Stat label="Applications" value={applied} hint={`${interviews} interview${interviews === 1 ? "" : "s"}`} />
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
          <Panel className="p-5">
            <SectionTitle>
              <span className="flex items-center gap-1.5">
                <Target size={11} /> Weekly goal
              </span>
            </SectionTitle>
            {weeklyGoal > 0 ? (
              <div className="flex items-center gap-5">
                <ScoreRing
                  score={Math.min(100, Math.round((w.thisWeek / weeklyGoal) * 100))}
                  size={84}
                  tone={w.thisWeek >= weeklyGoal ? "text-mint" : "text-chrome-200"}
                  label={`${Math.min(100, Math.round((w.thisWeek / weeklyGoal) * 100))}%`}
                />
                <div className="min-w-0 flex-1">
                  <div className="chrome-text text-[26px] font-semibold leading-none tabular-nums">
                    {w.thisWeek} <span className="text-[15px] text-chrome-500">/ {weeklyGoal}</span>
                  </div>
                  <div className="mt-1.5 text-[12px] text-chrome-500">
                    applications this week{w.thisWeek >= weeklyGoal ? ": goal reached" : `, ${weeklyGoal - w.thisWeek} to go`}
                  </div>
                  <div className={`mt-2 flex items-center gap-1.5 text-[12px] ${w.streak ? "text-amber" : "text-chrome-600"}`}>
                    <Flame size={13} /> {w.streak} week{w.streak === 1 ? "" : "s"} streak
                  </div>
                </div>
                <div className="flex h-20 items-end gap-1.5" title="Applications per week, last 8 weeks">
                  {w.history.map((h, i) => (
                    <div key={h.week} className="flex w-3.5 flex-col items-center justify-end gap-1">
                      <div
                        className={`w-full rounded-sm ${h.count >= weeklyGoal ? "bg-mint/70" : i === w.history.length - 1 ? "bg-chrome-200" : "bg-white/15"}`}
                        style={{ height: `${Math.max(3, (h.count / maxWeek) * 64)}px` }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-chrome-500">Set a weekly goal in Settings to track your pace.</p>
            )}
          </Panel>
          <Panel className="p-5">
            <SectionTitle>Responses</SectionTitle>
            <div className="grid grid-cols-3 gap-3">
              <MiniStat label="Reply rate" value={w.responseRate === null ? "–" : `${w.responseRate}%`} hint={`${w.responded} of ${w.applied} applications`} />
              <MiniStat label="Days to reply" value={w.avgDaysToReply === null ? "–" : String(w.avgDaysToReply)} hint="on average" />
              <MiniStat label="Interviews" value={String(w.interviews)} hint="incl. offers" />
            </div>
            <p className="mt-3 text-[11px] text-chrome-600">A reply means you moved the job to Interview, Offer or Rejected.</p>
          </Panel>
        </div>

        <Panel className="p-5">
          <SectionTitle>Your funnel</SectionTitle>
          <div className="flex items-end gap-3">
            {PIPELINE.map((p) => {
              const n = Object.values(tracks).filter((t) => t.status === p.id).length;
              const max = Math.max(1, ...PIPELINE.map((q) => Object.values(tracks).filter((t) => t.status === q.id).length));
              return (
                <div key={p.id} className="flex flex-1 flex-col items-center gap-2">
                  <span className="text-[13px] font-semibold tabular-nums text-chrome-100">{n}</span>
                  <div className={`flex h-28 w-full items-end overflow-hidden rounded-lg bg-white/[0.025] ${p.tone}`}>
                    <div
                      className="w-full rounded-lg border-t border-current"
                      style={{
                        height: `${Math.max(n ? 6 : 0, (n / max) * 100)}%`,
                        transition: "height .5s cubic-bezier(.2,.8,.2,1)",
                        background: "linear-gradient(180deg, color-mix(in srgb, currentColor 38%, transparent), color-mix(in srgb, currentColor 6%, transparent))",
                        boxShadow: "inset 0 1px 0 rgb(255 255 255 / .25)",
                      }}
                    />
                  </div>
                  <span className="text-[12px] text-chrome-400">{p.label}</span>
                </div>
              );
            })}
          </div>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-3">
          <BarList title="Top hiring companies" rows={companies} />
          <BarList title="Where the jobs are" rows={places} />
          <BarList
            title="Skills to learn next"
            rows={missing}
            empty="Open a few jobs so their postings get analysed."
            footer="Counted across the postings you've opened."
          />
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <div className="text-[11.5px] text-chrome-500">{label}</div>
      <div className="chrome-text mt-1 text-[22px] font-semibold leading-none tabular-nums">{value}</div>
      <div className="mt-1.5 text-[11px] text-chrome-600">{hint}</div>
    </div>
  );
}

function ReplyGroup({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div>
      <div className="mb-2 text-[12px] font-medium text-chrome-400">{title}</div>
      <div className="space-y-2">
        {rows.slice(0, 5).map((r) => (
          <div key={r.label}>
            <div className="flex text-[12px]">
              <span className="min-w-0 flex-1 truncate text-chrome-200">{r.label}</span>
              <span className="ml-2 shrink-0 tabular-nums text-chrome-500">
                {r.replies} of {r.sent} · {r.interviews} interview{r.interviews === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-gradient-to-r from-chrome-500 to-chrome-100 transition-[width] duration-500" style={{ width: `${percent(r.replies, r.sent)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Panel className="p-4">
      <div className="text-[12px] text-chrome-500">{label}</div>
      <div className="chrome-text mt-1 text-[30px] font-semibold leading-none tabular-nums">{value}</div>
      <div className="mt-2 text-[11.5px] text-chrome-500">{hint}</div>
    </Panel>
  );
}

function BarList({ title, rows, empty, footer }: { title: string; rows: [string, number][]; empty?: string; footer?: ReactNode }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <Panel className="p-5">
      <SectionTitle>{title}</SectionTitle>
      {rows.length === 0 && <p className="text-[12px] text-chrome-600">{empty ?? "No data yet."}</p>}
      <div className="space-y-2">
        {rows.map(([name, n]) => (
          <div key={name}>
            <div className="flex text-[12px]">
              <span className="truncate text-chrome-200">{name}</span>
              <span className="ml-auto pl-2 tabular-nums text-chrome-500">{n}</span>
            </div>
            <div className="mt-1 h-1 rounded-full bg-white/[0.04]">
              <div className="h-1 rounded-full bg-gradient-to-r from-chrome-500 to-chrome-100" style={{ width: `${(n / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      {footer && <p className="mt-3 text-[11px] text-chrome-600">{footer}</p>}
    </Panel>
  );
}

function top(items: string[], n: number): [string, number][] {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "0%");
