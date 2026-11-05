import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import type { Job } from "../types";
import { t } from "../lib/i18n";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  run: () => void;
}

const MAX_RESULTS = 9;

/** Letters in order count as a match; a word start or an exact run ranks higher. */
export function matchScore(text: string, query: string): number {
  const hay = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const at = hay.indexOf(q);
  if (at === 0) return 100;
  if (at > 0) return hay[at - 1] === " " ? 80 : 60;
  let pos = -1;
  for (const c of q) {
    pos = hay.indexOf(c, pos + 1);
    if (pos < 0) return 0;
  }
  return 20;
}

/** Ctrl+K: do anything in the app, or jump to any job or company. */
export function CommandBar({ commands, jobs, onJob, onCompany, onClose }: { commands: Command[]; jobs: Job[]; onJob: (id: string) => void; onCompany: (name: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => {
    const scored: { score: number; item: Command }[] = commands.map((c) => ({ score: matchScore(c.label, query) + 5, item: c })).filter((r) => r.score > 5);
    if (query.trim().length >= 2) {
      const companies = new Set<string>();
      for (const j of jobs) {
        const s = matchScore(`${j.title} ${j.company}`, query);
        if (s >= 60) scored.push({ score: s, item: { id: `job-${j.id}`, label: j.title, hint: j.company, run: () => onJob(j.id) } });
        if (j.company && matchScore(j.company, query) >= 60 && !companies.has(j.company)) {
          companies.add(j.company);
          scored.push({ score: matchScore(j.company, query) + 1, item: { id: `co-${j.company}`, label: j.company, hint: "Company", run: () => onCompany(j.company) } });
        }
      }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS).map((r) => r.item);
  }, [commands, jobs, query, onJob, onCompany]);

  useEffect(() => setIndex(0), [query]);

  function choose(c?: Command) {
    if (!c) return;
    onClose();
    c.run();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-[14vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div className="chrome-border sheen animate-rise w-full max-w-[580px] overflow-hidden rounded-2xl bg-raised shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <label className="flex h-12 items-center gap-2.5 border-b border-line px-4 text-chrome-400">
          <Search size={15} />
          <input
            ref={input}
            value={query}
            aria-label="Search or run a command"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(results[index]);
              } else if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
              }
            }}
            placeholder={t("Search or run a command…")}
            className="h-full flex-1 bg-transparent text-[14px] text-chrome-50 outline-none placeholder:text-chrome-600"
          />
        </label>
        <div className="max-h-[380px] overflow-y-auto p-1.5">
          {results.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-chrome-500">Nothing found.</div>}
          {results.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(c)}
              className={`flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13px] ${i === index ? "bg-elevated text-chrome-50" : "text-chrome-300"}`}
            >
              {c.icon && <span className="text-chrome-400">{c.icon}</span>}
              <span className="min-w-0 truncate">{c.label}</span>
              {c.hint && <span className="ml-1 shrink-0 truncate text-[12px] text-chrome-600">{c.hint}</span>}
              {i === index && <CornerDownLeft size={12} className="ml-auto shrink-0 text-chrome-500" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
