import { useEffect, useRef, useState, type ReactNode } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { CalendarPlus, FileText, NotebookPen, UserRound } from "lucide-react";
import type { Job, Track } from "../types";
import { PIPELINE } from "../types";
import { api } from "../lib/api";
import { ago } from "../lib/format";
import { buildIcs, formatWhen, fromLocalInput, toLocalInput } from "../lib/ics";
import { Button, Panel, SectionTitle, useToast } from "./ui";

const CVS = ["", "EN", "IT", "DE", "Other"] as const;
const field = "chrome-border w-full rounded-lg bg-void px-3 text-[13px] text-chrome-100 outline-none placeholder:text-chrome-600";

/**
 * Everything about one application: notes, interview time, contact, and what
 * was sent. Text fields save automatically after a short pause; writing
 * anything tracks the job as "saved" if it wasn't tracked yet.
 */
export function ApplicationTab({ job, track, onUpdate }: { job: Job; track?: Track; onUpdate: (job: Job, patch: Partial<Track>) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState(() => fromTrack(track));
  const [saved, setSaved] = useState(true);
  const timer = useRef<number>(undefined);
  const pending = useRef<Partial<Track>>({});

  useEffect(() => {
    setDraft(fromTrack(track));
    // Only reset when switching jobs, not on our own saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  function change<K extends keyof Draft>(key: K, value: Draft[K], immediate = false) {
    setDraft((d) => ({ ...d, [key]: value }));
    // The interview field is a datetime-local string in the form, unix seconds in the track.
    const patch: Partial<Track> = key === "interview" ? { interview_at: fromLocalInput(value) } : { [key]: value };
    pending.current = { ...pending.current, ...patch };
    setSaved(false);
    window.clearTimeout(timer.current);
    const flush = () => {
      onUpdate(job, pending.current);
      pending.current = {};
      setSaved(true);
    };
    if (immediate) flush();
    else timer.current = window.setTimeout(flush, 600);
  }

  async function addToCalendar() {
    const start = fromLocalInput(draft.interview);
    if (!start) return;
    const path = await save({
      title: "Save interview to calendar",
      defaultPath: `Interview ${job.company || job.title}.ics`.replace(/[\\/:*?"<>|]/g, "-"),
      filters: [{ name: "Calendar event", extensions: ["ics"] }],
    });
    if (!path) return;
    const ics = buildIcs({
      uid: `${job.id}-${start}`,
      start,
      minutes: 60,
      title: `Interview: ${job.title} – ${job.company}`,
      location: job.location || job.company,
      description: [draft.contact && `Contact: ${draft.contact}`, `Posting: ${job.apply_url ?? job.url}`].filter(Boolean).join("\n"),
    });
    try {
      await api.writeTextFile(path, ics);
      toast("Calendar file saved; open it to add the interview");
    } catch (e) {
      toast(String(e), "warn");
    }
  }

  const stage = track ? (PIPELINE.find((p) => p.id === track.status)?.label ?? track.status) : "Not tracked";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-chrome-500">
        <span>
          Status: <span className="text-chrome-200">{stage}</span>
        </span>
        {track?.applied ? <Meta label="Applied" secs={track.applied} /> : null}
        {track?.followed_up ? <Meta label="Followed up" secs={track.followed_up} /> : null}
        {track?.updated ? <span>Updated {ago(track.updated)}</span> : null}
        <span className="ml-auto">{saved ? "Saved" : "Saving…"}</span>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Panel className="space-y-3 p-4">
          <SectionTitle>
            <span className="flex items-center gap-1.5">
              <CalendarPlus size={11} /> Interview
            </span>
          </SectionTitle>
          <input
            type="datetime-local"
            value={draft.interview}
            onChange={(e) => change("interview", e.target.value, true)}
            className={`${field} h-9 [color-scheme:dark]`}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" icon={<CalendarPlus size={12} />} disabled={!draft.interview} onClick={addToCalendar}>
              Add to calendar
            </Button>
            {draft.interview && (
              <button className="text-[12px] text-chrome-500 hover:text-chrome-200" onClick={() => change("interview", "", true)}>
                Clear
              </button>
            )}
            {track?.interview_at ? <span className="ml-auto text-[12px] text-violet">{formatWhen(track.interview_at)}</span> : null}
          </div>
        </Panel>

        <Panel className="space-y-3 p-4">
          <SectionTitle>
            <span className="flex items-center gap-1.5">
              <UserRound size={11} /> Contact & CV
            </span>
          </SectionTitle>
          <input
            value={draft.contact}
            onChange={(e) => change("contact", e.target.value)}
            placeholder="Name, email, phone"
            className={`${field} h-9`}
          />
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-[12px] text-chrome-500">CV sent</span>
            {CVS.slice(1).map((cv) => (
              <button
                key={cv}
                onClick={() => change("cv", draft.cv === cv ? "" : cv, true)}
                className={`h-7 rounded-md px-2.5 text-[12px] transition ${draft.cv === cv ? "chrome-face font-semibold" : "border border-line text-chrome-400 hover:text-chrome-100"}`}
              >
                {cv}
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <Field icon={<FileText size={11} />} title="Message you sent">
        <textarea
          value={draft.sent_message}
          onChange={(e) => change("sent_message", e.target.value)}
          placeholder="Paste the email or message you sent, so you can see it before an interview."
          className={`${field} selectable h-36 resize-y py-2.5 leading-relaxed`}
        />
      </Field>

      <Field icon={<NotebookPen size={11} />} title="Notes">
        <textarea
          id="notes-editor"
          value={draft.notes}
          onChange={(e) => change("notes", e.target.value)}
          placeholder={"What happened, who you spoke to, next steps…\nWriting anything here saves the job if it isn't tracked yet."}
          className={`${field} selectable h-56 resize-y py-2.5 leading-relaxed`}
        />
      </Field>
    </div>
  );
}

interface Draft {
  notes: string;
  interview: string;
  contact: string;
  cv: string;
  sent_message: string;
}

function fromTrack(t?: Track): Draft {
  return {
    notes: t?.notes ?? "",
    interview: toLocalInput(t?.interview_at ?? null),
    contact: t?.contact ?? "",
    cv: t?.cv ?? "",
    sent_message: t?.sent_message ?? "",
  };
}

function Meta({ label, secs }: { label: string; secs: number }) {
  return (
    <span>
      {label}: <span className="text-chrome-200">{new Date(secs * 1000).toLocaleDateString("de-DE")}</span>
    </span>
  );
}

function Field({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div>
      <SectionTitle>
        <span className="flex items-center gap-1.5">
          {icon} {title}
        </span>
      </SectionTitle>
      {children}
    </div>
  );
}
