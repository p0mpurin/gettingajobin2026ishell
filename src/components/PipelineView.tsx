import { useState } from "react";
import { AlarmClock, BellRing, CalendarClock, Check, ChevronLeft, ChevronRight, KanbanSquare, Sparkles } from "lucide-react";
import type { Job, Status, Track } from "../types";
import { PIPELINE } from "../types";
import { ago } from "../lib/format";
import { daysSince } from "../lib/followup";
import { formatWhen } from "../lib/ics";
import type { FollowUpActions } from "./JobDetail";
import { Button, IconButton } from "./ui";

export function PipelineView({
  tracks,
  jobsById,
  onMove,
  onOpen,
  dueIds,
  followUp,
  followUpDays,
  interviews,
}: {
  tracks: Record<string, Track>;
  jobsById: Record<string, Job>;
  onMove: (id: string, status: Status) => void;
  onOpen: (id: string) => void;
  dueIds: string[];
  followUp: FollowUpActions;
  followUpDays: number;
  /** Track ids with an upcoming interview, soonest first. */
  interviews: string[];
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const entries = Object.entries(tracks).filter(([, t]) => t.status !== "hidden");

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-void">
      <div className="border-b border-line px-7 py-5">
        <h1 className="chrome-text text-[22px] font-semibold tracking-tight">Pipeline</h1>
        <p className="mt-1 text-[13px] text-chrome-500">
          Drag cards between stages, or use the arrows. Click a card to open the job.
          {followUpDays > 0 ? ` Applications without a reply get a follow-up reminder after ${followUpDays} days.` : ""}
        </p>
      </div>
      {interviews.length > 0 && (
        <div className="border-b border-line bg-violet/[0.04] px-7 py-4">
          <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-violet">
            <CalendarClock size={14} /> Upcoming interview{interviews.length === 1 ? "" : "s"}
          </div>
          <div className="flex flex-wrap gap-2">
            {interviews.map((id) => {
              const t = tracks[id];
              return (
                <button key={id} onClick={() => onOpen(id)} className="chrome-border rounded-xl bg-raised px-4 py-2.5 text-left transition hover:bg-elevated">
                  <div className="text-[12px] font-semibold text-violet">{formatWhen(t.interview_at!)}</div>
                  <div className="max-w-[280px] truncate text-[13px] font-semibold text-chrome-100">{t.title}</div>
                  <div className="max-w-[280px] truncate text-[12px] text-chrome-500">{t.company}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {dueIds.length > 0 && (
        <div className="border-b border-line bg-amber/[0.04] px-7 py-4">
          <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-amber">
            <BellRing size={14} /> {dueIds.length} follow-up{dueIds.length === 1 ? "" : "s"} due
          </div>
          <div className="space-y-2">
            {dueIds.map((id) => {
              const t = tracks[id];
              const since = Math.max(t.applied ?? 0, t.followed_up ?? 0);
              return (
                <div key={id} className="chrome-border flex flex-wrap items-center gap-3 rounded-xl bg-raised px-4 py-2.5">
                  <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(id)}>
                    <div className="truncate text-[13px] font-semibold text-chrome-100">{t.title}</div>
                    <div className="truncate text-[12px] text-chrome-500">
                      {t.company} · {t.followed_up ? "last followed up" : "applied"} {daysSince(since)} days ago
                    </div>
                  </button>
                  <div className="flex gap-2">
                    <Button size="sm" variant="chrome" icon={<Sparkles size={12} />} onClick={() => followUp.write(id)}>
                      Write follow-up
                    </Button>
                    <Button size="sm" icon={<Check size={12} />} onClick={() => followUp.done(id)}>
                      Done
                    </Button>
                    <Button size="sm" variant="ghost" icon={<AlarmClock size={12} />} onClick={() => followUp.snooze(id)}>
                      Snooze
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-chrome-500">
          <KanbanSquare size={32} strokeWidth={1.3} />
          <p className="text-[13px]">Nothing tracked yet. Save a job with S or mark it applied with A.</p>
        </div>
      ) : (
        <div className="flex flex-1 gap-3 overflow-x-auto p-5">
          {PIPELINE.map((stage, si) => {
            const cards = entries.filter(([, t]) => t.status === stage.id).sort((a, b) => b[1].updated - a[1].updated);
            return (
              <div
                key={stage.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(stage.id);
                }}
                onDragLeave={() => setOver(null)}
                onDrop={() => {
                  if (dragId) onMove(dragId, stage.id);
                  setDragId(null);
                  setOver(null);
                }}
                className={`chrome-border flex w-[270px] shrink-0 flex-col rounded-2xl bg-base transition ${over === stage.id ? "bg-elevated" : ""}`}
              >
                <div className="flex items-center gap-2 px-4 py-3">
                  <span className={`h-2 w-2 rounded-full bg-current ${stage.tone} shadow-[0_0_10px] shadow-current`} />
                  <span className="text-[13px] font-semibold text-chrome-100">{stage.label}</span>
                  <span className="ml-auto text-[12px] tabular-nums text-chrome-500">{cards.length}</span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto px-2.5 pb-3">
                  {cards.map(([id, t]) => {
                    const live = jobsById[id];
                    return (
                      <div
                        key={id}
                        draggable
                        onDragStart={() => setDragId(id)}
                        onClick={() => onOpen(id)}
                        className="group cursor-pointer rounded-xl border border-line bg-raised p-3 transition hover:border-line-strong hover:bg-elevated"
                      >
                        <div className="line-clamp-2 text-[13px] font-semibold leading-snug text-chrome-100">{t.title || live?.title || id}</div>
                        <div className="mt-1 truncate text-[12px] text-chrome-400">{t.company || live?.company}</div>
                        {t.interview_at && t.interview_at > Date.now() / 1000 - 7200 && (
                          <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-violet/30 bg-violet/10 px-1.5 py-0.5 text-[10.5px] font-medium text-violet">
                            <CalendarClock size={10} /> {formatWhen(t.interview_at)}
                          </div>
                        )}
                        {dueIds.includes(id) && (
                          <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[10.5px] font-medium text-amber">
                            <BellRing size={10} /> Follow up
                          </div>
                        )}
                        {t.notes && <div className="mt-2 line-clamp-2 text-[11.5px] leading-snug text-chrome-500">{t.notes}</div>}
                        <div className="mt-2 flex items-center text-[11px] text-chrome-600">
                          {!live && <span className="mr-2 text-rose/80">delisted</span>}
                          {ago(t.updated)}
                          <span className="ml-auto flex opacity-0 transition group-hover:opacity-100">
                            <IconButton
                              label="Move back"
                              className="h-6 w-6"
                              disabled={si === 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                onMove(id, PIPELINE[si - 1].id);
                              }}
                            >
                              <ChevronLeft size={13} />
                            </IconButton>
                            <IconButton
                              label="Move forward"
                              className="h-6 w-6"
                              disabled={si === PIPELINE.length - 1}
                              onClick={(e) => {
                                e.stopPropagation();
                                onMove(id, PIPELINE[si + 1].id);
                              }}
                            >
                              <ChevronRight size={13} />
                            </IconButton>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
