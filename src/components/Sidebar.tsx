import { BarChart3, Bot, Briefcase, Keyboard, KanbanSquare, MapIcon, Rocket, Settings2, Sparkles } from "lucide-react";
import { t } from "../lib/i18n";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { View } from "../types";
import { MORE_SOURCES } from "../types";
import { Kbd } from "./ui";

const NAV: { id: View; label: string; icon: typeof Briefcase; key: string }[] = [
  { id: "jobs", label: "Jobs", icon: Briefcase, key: "1" },
  { id: "pipeline", label: "Pipeline", icon: KanbanSquare, key: "2" },
  { id: "insights", label: "Insights", icon: BarChart3, key: "3" },
  { id: "settings", label: "Settings", icon: Settings2, key: "4" },
];

export function Sidebar({
  view,
  onView,
  counts,
  alerts = {},
  onShortcuts,
  autoRefresh,
  watching = [],
  onWatched,
  weekly,
  forYou,
  onForYou,
  forYouCount,
  needsYou,
}: {
  view: View;
  onView: (v: View) => void;
  counts: Partial<Record<View, number>>;
  /** Things needing attention, e.g. due follow-ups on Pipeline. */
  alerts?: Partial<Record<View, number>>;
  onShortcuts: () => void;
  autoRefresh: string;
  /** Watched companies with their open job counts. */
  watching?: { name: string; count: number }[];
  onWatched?: (name: string) => void;
  /** Applications this week against the weekly goal. */
  weekly?: { done: number; goal: number };
  /** The For You feed is showing. */
  forYou: boolean;
  onForYou: () => void;
  forYouCount: number;
  /** Jobs an AI agent handed back to the user. */
  needsYou: number;
}) {
  return (
    <nav className="flex w-[180px] shrink-0 xl:w-[212px] flex-col border-r border-line bg-void px-3 py-4">
      <div className="mb-3 space-y-0.5">
        <button
          onClick={onForYou}
          className={`flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-semibold transition ${forYou ? "chrome-face" : "chrome-border bg-raised text-chrome-100 hover:bg-hover"}`}
        >
          <Sparkles size={15} />
          {t("For You")}
          <span className={`ml-auto text-[11px] font-medium tabular-nums ${forYou ? "text-black/55" : "text-chrome-500"}`}>{forYouCount}</span>
        </button>
        <button
          onClick={() => onView("autopilot")}
          className={`relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition ${view === "autopilot" ? "chrome-border bg-elevated text-chrome-50" : "text-chrome-400 hover:bg-raised hover:text-chrome-100"}`}
        >
          <Rocket size={15} /> {t("Autopilot")}
          {needsYou > 0 && (
            <span className="ml-auto rounded-full bg-amber/15 px-1.5 text-[10.5px] font-semibold tabular-nums text-amber" title={`${needsYou} need you`}>
              {needsYou}
            </span>
          )}
        </button>
        <button
          onClick={() => onView("assistant")}
          className={`relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition ${view === "assistant" ? "chrome-border bg-elevated text-chrome-50" : "text-chrome-400 hover:bg-raised hover:text-chrome-100"}`}
        >
          <Bot size={15} /> {t("Assistant")}
        </button>
        <button
          onClick={() => onView("map")}
          className={`relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition ${view === "map" ? "chrome-border bg-elevated text-chrome-50" : "text-chrome-400 hover:bg-raised hover:text-chrome-100"}`}
        >
          <MapIcon size={15} /> {t("Map")}
        </button>
      </div>
      <div className="space-y-0.5">
        {NAV.map(({ id, label, icon: Icon, key }) => {
          const active = view === id && !forYou;
          return (
            <button
              key={id}
              onClick={() => onView(id)}
              className={`group relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition ${
                active ? "chrome-border bg-elevated text-chrome-50" : "text-chrome-400 hover:bg-raised hover:text-chrome-100"
              }`}
            >
              {active && <span className="absolute left-0 top-2 h-5 w-[2px] rounded-full bg-gradient-to-b from-white to-chrome-500" />}
              <Icon size={15} strokeWidth={active ? 2.2 : 1.8} />
              {t(label)}
              <span className="ml-auto flex items-center gap-1.5">
                {alerts[id] ? (
                  <span className="rounded-full bg-amber/15 px-1.5 text-[10.5px] font-semibold tabular-nums text-amber" title={`${alerts[id]} follow-up${alerts[id] === 1 ? "" : "s"} due`}>
                    {alerts[id]}
                  </span>
                ) : (
                  counts[id] !== undefined && <span className="text-[11px] tabular-nums text-chrome-500">{counts[id]}</span>
                )}
                <span className="opacity-0 transition group-hover:opacity-100">
                  <Kbd>⌃{key}</Kbd>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {watching.length > 0 && (
        <div className="mt-6">
          <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-chrome-600">{t("Watching")}</div>
          {watching.map((w) => (
            <button
              key={w.name}
              onClick={() => onWatched?.(w.name)}
              className="flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12px] text-chrome-400 transition hover:bg-raised hover:text-chrome-100"
            >
              <span className="h-1 w-1 shrink-0 rounded-full bg-amber" />
              <span className="truncate">{w.name}</span>
              <span className="ml-auto text-[11px] tabular-nums text-chrome-600">{w.count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-6">
        <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-chrome-600">{t("More sources")}</div>
        {MORE_SOURCES.map(([name, url]) => (
          <button
            key={name}
            onClick={() => openUrl(url)}
            className="flex h-7 w-full items-center rounded-md px-2.5 text-left text-[12px] text-chrome-500 transition hover:bg-raised hover:text-chrome-200"
          >
            {name}
            <span className="ml-auto text-[10px] text-chrome-600">↗</span>
          </button>
        ))}
      </div>

      <div className="mt-auto space-y-2 px-1">
        {weekly && weekly.goal > 0 && (
          <button onClick={() => onView("insights")} className="block w-full rounded-lg px-1.5 py-1.5 text-left transition hover:bg-raised" title="Applications this week. Click for Insights.">
            <div className="flex text-[11.5px]">
              <span className="text-chrome-400">{t("This week")}</span>
              <span className={`ml-auto tabular-nums ${weekly.done >= weekly.goal ? "text-mint" : "text-chrome-200"}`}>
                {weekly.done} / {weekly.goal}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${weekly.done >= weekly.goal ? "bg-mint" : "bg-gradient-to-r from-chrome-500 to-chrome-100"}`}
                style={{ width: `${Math.min(100, (weekly.done / weekly.goal) * 100)}%` }}
              />
            </div>
          </button>
        )}
        <div className="text-[11px] leading-relaxed text-chrome-600">{autoRefresh}</div>
        <button onClick={onShortcuts} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-[12px] text-chrome-500 transition hover:bg-raised hover:text-chrome-200">
          <Keyboard size={13} /> {t("Shortcuts")} <span className="ml-auto"><Kbd>?</Kbd></span>
        </button>
      </div>
    </nav>
  );
}
