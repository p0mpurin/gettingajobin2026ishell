import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Star } from "lucide-react";
import type { Job, Track } from "../types";
import { PIPELINE } from "../types";
import { companyKey } from "../lib/dedupe";
import { shortDate } from "../lib/format";
import type { Fit } from "../lib/foryou";
import { t } from "../lib/i18n";
import { Button, Chip, Modal, ScoreRing } from "./ui";

/** Everything about one employer: open roles, and your history with them. */
export function CompanyPage({
  name,
  jobs,
  tracks,
  fits,
  watched,
  onToggleWatch,
  onHide,
  onOpen,
  onClose,
}: {
  name: string;
  jobs: Job[];
  tracks: Record<string, Track>;
  fits: Record<string, Fit>;
  watched: boolean;
  onToggleWatch: () => void;
  onHide: () => void;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const key = companyKey(name);
  const open = jobs.filter((j) => !j.delisted && companyKey(j.company) === key).sort((a, b) => (fits[b.id]?.score ?? 0) - (fits[a.id]?.score ?? 0));
  const history = Object.entries(tracks)
    .filter(([, tr]) => companyKey(tr.company) === key && tr.status !== "hidden" && tr.status !== "saved")
    .sort((a, b) => (b[1].applied ?? 0) - (a[1].applied ?? 0));
  const mails = history.flatMap(([, tr]) => tr.mails ?? []);

  return (
    <Modal title={name} onClose={onClose} width="max-w-2xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{open.length} open</Chip>
          <Chip tone={history.length ? "sky" : "neutral"}>{history.length} applied</Chip>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" icon={<Star size={12} className={watched ? "fill-amber text-amber" : ""} />} onClick={onToggleWatch}>
              {t("Watch")}
            </Button>
            <Button size="sm" icon={<ExternalLink size={12} />} onClick={() => openUrl(`https://www.google.com/search?q=${encodeURIComponent(`${name} reviews kununu`)}`)}>
              {t("Look up reviews")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onHide}>
              {t("Hide company")}
            </Button>
          </div>
        </div>
        <div>
          <div className="mb-1 text-[12px] font-medium text-chrome-400">{t("Open roles")}</div>
          {open.length === 0 && <p className="text-[12.5px] text-chrome-600">Nothing open right now.</p>}
          <div className="max-h-64 overflow-y-auto">
            {open.map((j) => (
              <button key={j.id} onClick={() => onOpen(j.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-hover">
                <ScoreRing score={fits[j.id]?.score ?? null} size={30} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-chrome-100">{j.title}</span>
                <span className="shrink-0 text-[12px] text-chrome-500">{j.location}</span>
              </button>
            ))}
          </div>
        </div>
        {history.length > 0 && (
          <div>
            <div className="mb-1 text-[12px] font-medium text-chrome-400">{t("Your history")}</div>
            {history.map(([id, tr]) => {
              const stage = PIPELINE.find((p) => p.id === tr.status);
              return (
                <div key={id} className="flex items-center gap-2 py-1 text-[12.5px] text-chrome-300">
                  <span className={stage?.tone}>{stage?.label ?? tr.status}</span>
                  <span className="min-w-0 flex-1 truncate">{tr.title}</span>
                  {tr.applied && <span className="shrink-0 text-chrome-600">{shortDate(new Date(tr.applied * 1000).toISOString())}</span>}
                </div>
              );
            })}
            {mails.length > 0 && <p className="mt-1 text-[11.5px] text-chrome-600">{mails.length} replies found in your email.</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
