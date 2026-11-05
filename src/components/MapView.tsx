import { useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import type { Commute, Job } from "../types";
import type { Fit } from "../lib/foryou";
import { mapHeight, OUTLINE, project, townOf } from "../lib/towns";
import { t } from "../lib/i18n";
import { Chip, ScoreRing } from "./ui";

const WIDTH = 720;
const HEIGHT = mapHeight(WIDTH);

const toneOf = (minutes?: number) => (minutes === undefined ? "#6a6a73" : minutes <= 30 ? "#7ebea5" : minutes <= 60 ? "#e3b26b" : "#e58a8a");

/** Jobs on a drawing of South Tyrol, coloured by the trip from home. No map service is called. */
export function MapView({ jobs, commutes, fits, homeTown, onOpen }: { jobs: Job[]; commutes: Record<string, Commute>; fits: Record<string, Fit>; homeTown: string; onOpen: (id: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null);

  const groups = useMemo(() => {
    const byTown = new Map<string, { town: NonNullable<ReturnType<typeof townOf>>; jobs: Job[]; minutes?: number }>();
    for (const j of jobs) {
      const town = townOf(j.location);
      if (!town) continue;
      const g = byTown.get(town.name) ?? { town, jobs: [], minutes: commutes[j.location]?.minutes };
      g.jobs.push(j);
      g.minutes ??= commutes[j.location]?.minutes;
      byTown.set(town.name, g);
    }
    return [...byTown.values()].sort((a, b) => b.jobs.length - a.jobs.length);
  }, [jobs, commutes]);

  const elsewhere = jobs.length - groups.reduce((n, g) => n + g.jobs.length, 0);
  const home = townOf(homeTown);
  const outline = OUTLINE.map(([lat, lon]) => project(lat, lon, WIDTH).join(",")).join(" ");
  const selected = groups.find((g) => g.town.name === picked);
  const list = selected ? [...selected.jobs].sort((a, b) => (fits[b.id]?.score ?? 0) - (fits[a.id]?.score ?? 0)) : [];

  return (
    <div className="view-in flex min-w-0 flex-1 bg-void">
      <div className="min-w-0 flex-1 overflow-y-auto p-7">
        <h1 className="chrome-text text-[22px] font-semibold tracking-tight">{t("Job map")}</h1>
        <p className="mt-1 text-[13px] text-chrome-500">
          {jobs.length} {t("jobs by town, coloured by how long the trip takes")}
          {elsewhere > 0 ? ` · ${elsewhere} elsewhere or remote` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-[11.5px] text-chrome-400">
          {([["#7ebea5", "Under 30 min"], ["#e3b26b", "30 to 60 min"], ["#e58a8a", "Over 1 hour"], ["#6a6a73", "Not known"]] as const).map(([c, label]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: c }} /> {t(label)}
            </span>
          ))}
        </div>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Map of jobs in South Tyrol" className="mt-4 w-full max-w-[860px]">
          <defs>
            <linearGradient id="land" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.07" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0.015" />
            </linearGradient>
          </defs>
          <polygon points={outline} fill="url(#land)" stroke="rgb(255 255 255 / 0.22)" strokeWidth="1" strokeLinejoin="round" />
          {groups.map((g) => {
            const [x, y] = project(g.town.lat, g.town.lon, WIDTH);
            const r = Math.min(26, 6 + Math.sqrt(g.jobs.length) * 2.2);
            const color = toneOf(g.minutes);
            const on = picked === g.town.name;
            const label = `${g.town.name}: ${g.jobs.length} jobs${g.minutes !== undefined ? `, ${g.minutes} minutes` : ""}`;
            return (
              <g key={g.town.name} role="button" tabIndex={0} aria-label={label} aria-pressed={on} className="map-dot cursor-pointer" onClick={() => setPicked(g.town.name)} onKeyDown={(e) => e.key === "Enter" && setPicked(g.town.name)}>
                <title>{label}</title>
                <circle cx={x} cy={y} r={r} fill={color} fillOpacity={on ? 0.55 : 0.28} stroke={color} strokeWidth={on ? 2 : 1} />
                <text x={x} y={y + 3.5} textAnchor="middle" fontSize="10" fontWeight="600" fill="#fafafa">
                  {g.jobs.length}
                </text>
                {(g.jobs.length >= 8 || on) && (
                  <text x={x} y={y + r + 11} textAnchor="middle" fontSize="10" fill="#b4b4bb">
                    {g.town.name}
                  </text>
                )}
              </g>
            );
          })}
          {home &&
            (() => {
              const [x, y] = project(home.lat, home.lon, WIDTH);
              return (
                <g pointerEvents="none">
                  <title>Home: {home.name}</title>
                  <path d={`M${x} ${y - 7} L${x + 6} ${y} L${x + 4} ${y} L${x + 4} ${y + 5} L${x - 4} ${y + 5} L${x - 4} ${y} L${x - 6} ${y} Z`} fill="#fafafa" stroke="#000" strokeWidth="1" />
                </g>
              );
            })()}
        </svg>
        <p className="mt-2 text-[11px] text-chrome-600">A simplified drawing for finding your way around, not for navigation.</p>
      </div>
      <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-base">
        {selected ? (
          <>
            <div className="border-b border-line p-4">
              <div className="text-[15px] font-semibold text-chrome-50">{selected.town.name}</div>
              <div className="text-[12px] text-chrome-500">
                {selected.jobs.length} jobs{selected.minutes !== undefined ? ` · ${selected.minutes} min by public transport` : ""}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {list.map((j) => (
                <button key={j.id} onClick={() => onOpen(j.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-raised">
                  <ScoreRing score={fits[j.id]?.score ?? null} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-chrome-100">{j.title}</span>
                    <span className="block truncate text-[12px] text-chrome-500">{j.company}</span>
                  </span>
                  {j.is_new && <Chip tone="sky">New</Chip>}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-chrome-500">
            <MapPin size={26} strokeWidth={1.4} />
            <p className="text-[13px]">{t("Pick a town to see its jobs.")}</p>
          </div>
        )}
      </aside>
    </div>
  );
}
