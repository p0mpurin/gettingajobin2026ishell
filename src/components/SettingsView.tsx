import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { ArchiveRestore, ClipboardCopy, DatabaseBackup, Download, FileSpreadsheet, FolderInput, FolderOpen, KeyRound, Plus, Sparkles, Trash2, X } from "lucide-react";
import type { Settings } from "../types";
import { DISTRICTS } from "../types";
import { SUGGESTED_WORDS } from "../lib/rules";
import { FIELDS } from "../lib/fields";
import { reconcile, searchTerms } from "../lib/profile";
import { buildPrefsPrompt, parsePrefs, PREFS_SYSTEM } from "../lib/prefs";
import { api } from "../lib/api";
import { Button, Panel, SectionTitle, useToast } from "./ui";
import { AiServiceForm } from "./AssistantView";
import { AiConnect } from "./AiConnect";

export function SettingsView({
  settings,
  onSave,
  onRestored,
  onRunSetup,
}: {
  settings: Settings;
  onSave: (s: Settings) => Promise<void>;
  /** Reload everything after a backup was restored. */
  onRestored: () => void;
  onRunSetup: () => void;
}) {
  const [describe, setDescribe] = useState("");
  const [understanding, setUnderstanding] = useState(false);

  function cycleField(id: string) {
    const p = s.person;
    const want = p.fields.includes(id);
    const avoid = p.avoid_fields?.includes(id);
    set("person", {
      ...p,
      fields: want ? p.fields.filter((x) => x !== id) : avoid ? p.fields : [...p.fields, id],
      avoid_fields: want ? [...(p.avoid_fields ?? []), id] : (p.avoid_fields ?? []).filter((x) => x !== id),
    });
  }

  async function understand() {
    setUnderstanding(true);
    try {
      const prefs = parsePrefs(await api.aiOneShot(PREFS_SYSTEM, buildPrefsPrompt(describe)));
      const person = { ...s.person, roles: prefs.roles, fields: prefs.fields, avoid_fields: prefs.avoid_fields, level: prefs.level || s.person.level };
      // Describing it again starts over: old terms would keep the old jobs coming.
      setS({ ...s, person, terms: [...new Set([...prefs.terms, ...searchTerms(person)])] });
      toast("Filled in. Check it, then save");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "warn");
    } finally {
      setUnderstanding(false);
    }
  }

  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => {
    api.aiHasKey().then(setHasKey).catch(() => {});
  }, []);
  const toast = useToast();
  const [s, setS] = useState(settings);
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));

  async function exportTo(format: "md" | "csv") {
    const path = await save({
      title: format === "md" ? "Export applications to Obsidian" : "Export applications as CSV",
      defaultPath: format === "md" ? (s.vault_path ? `${s.vault_path}\\Applications.md` : "Applications.md") : "applications.csv",
      filters: [{ name: format === "md" ? "Markdown" : "CSV", extensions: [format] }],
    });
    if (!path) return;
    try {
      const n = await api.exportTracks(path, format);
      toast(`Exported ${n} application${n === 1 ? "" : "s"}`);
    } catch (e) {
      toast(String(e), "warn");
    }
  }

  async function backupNow() {
    const day = new Date().toISOString().slice(0, 10);
    const path = await save({
      title: "Save a backup of your Bolzano Jobs data",
      defaultPath: `Bolzano Jobs backup ${day}.json`,
      filters: [{ name: "Bolzano Jobs backup", extensions: ["json"] }],
    });
    if (!path) return;
    try {
      const n = await api.exportBackup(path);
      toast(`Backup saved (${n} tracked job${n === 1 ? "" : "s"})`);
    } catch (e) {
      toast(String(e), "warn");
    }
  }

  async function pickMirror() {
    const dir = await open({ title: "Choose a folder for the backup mirror (e.g. OneDrive)", directory: true, multiple: false });
    if (dir && !Array.isArray(dir)) set("mirror_path", dir);
  }

  async function mirrorNow() {
    try {
      const path = await api.mirrorNow();
      toast(`Mirror updated: ${path}`);
    } catch (e) {
      toast(String(e), "warn");
    }
  }

  async function restore() {
    const path = await open({ title: "Restore a Bolzano Jobs backup", multiple: false, directory: false, filters: [{ name: "Bolzano Jobs backup", extensions: ["json"] }] });
    if (!path || Array.isArray(path)) return;
    const ok = await ask("This replaces your settings and pipeline (status, notes, dates) with the ones in the backup. Your current data is saved first, so this can be undone.", {
      title: "Restore backup?",
      kind: "warning",
      okLabel: "Restore",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    try {
      const r = await api.importBackup(path);
      toast(`Restored ${r.tracks} tracked job${r.tracks === 1 ? "" : "s"}`);
      onRestored();
    } catch (e) {
      toast(String(e), "warn");
    }
  }

  return (
    <div className="min-w-0 flex-1 overflow-y-auto bg-void">
      <div className="sticky top-0 z-10 flex items-center border-b border-line bg-void/90 px-7 py-5 backdrop-blur">
        <div>
          <h1 className="chrome-text text-[22px] font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-[13px] text-chrome-500">Search, matching, your profile and exports.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button disabled={!dirty} onClick={() => setS(settings)}>
            Discard
          </Button>
          <Button
            variant="chrome"
            disabled={!dirty}
            onClick={async () => {
              // Search terms and preferences stay in step, and the screen shows the result.
              const next = reconcile(settings, s);
              setS(next);
              await onSave(next);
              toast("Settings saved");
            }}
          >
            Save changes
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-5 p-7">
        <Panel className="space-y-5 p-5">
          <SectionTitle>What you're looking for</SectionTitle>
          {s.ai_consent && (
            <Row label="Say it in your own words" hint="Your AI fills in the choices below for you to check. Only this text is sent.">
              <div className="flex gap-2">
                <input
                  value={describe}
                  onChange={(e) => setDescribe(e.target.value)}
                  placeholder="e.g. supermarket or warehouse work, near Meran, no sales"
                  className="chrome-border h-9 min-w-0 flex-1 rounded-lg bg-void px-3 text-[13px] outline-none placeholder:text-chrome-600"
                />
                <Button disabled={!describe.trim() || understanding} icon={<Sparkles size={14} />} onClick={understand}>
                  {understanding ? "Reading…" : "Fill in"}
                </Button>
              </div>
            </Row>
          )}
          <Row label="Kinds of work" hint="Click once to want it, twice to never see it, again to clear. Your feed only recommends real matches for these and your job titles.">
            <div className="flex flex-wrap gap-1.5">
              {FIELDS.map((f) => {
                const want = s.person.fields.includes(f.id);
                const avoid = s.person.avoid_fields?.includes(f.id);
                return (
                  <button
                    key={f.id}
                    onClick={() => cycleField(f.id)}
                    aria-label={`${f.label}: ${want ? "wanted" : avoid ? "never show" : "no preference"}`}
                    className={`h-8 rounded-full px-3 text-[12px] font-medium transition ${want ? "chrome-face" : avoid ? "border border-rose/40 bg-rose/10 text-rose line-through" : "border border-line text-chrome-400 hover:text-chrome-100"}`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </Row>
          <Row label="Job titles" hint="In your own words, in any language.">
            <TagInput values={s.person.roles} onChange={(v) => set("person", { ...s.person, roles: v })} placeholder="e.g. Cashier, Barista…" />
          </Row>
        </Panel>

        <Panel className="space-y-5 p-5">
          <SectionTitle>Search</SectionTitle>
          <Row label="Search terms" hint="Each term is searched on Karriere Südtirol and Südtiroler Jobs; results are merged and duplicates folded.">
            <TagInput values={s.terms} onChange={(v) => set("terms", v)} placeholder="Add a term…" />
          </Row>
          <Row label="Districts">
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {DISTRICTS.map(([id, name]) => {
                const on = s.districts.includes(id);
                return (
                  <button
                    key={id}
                    onClick={() => set("districts", on ? s.districts.filter((d) => d !== id) : [...s.districts, id])}
                    className={`h-8 rounded-lg px-2.5 text-left text-[12px] transition ${on ? "chrome-border bg-elevated text-chrome-50" : "border border-line text-chrome-500 hover:text-chrome-200"}`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </Row>
          <Row label="Home town" hint="Commute times are public-transport trips from here (Südtirolmobil timetable), arriving by 8:30 on a weekday.">
            <input
              value={s.home_town}
              onChange={(e) => set("home_town", e.target.value)}
              placeholder="e.g. Kaltern or Caldaro"
              className="chrome-border h-9 w-full rounded-lg bg-void px-3 text-[13px] outline-none placeholder:text-chrome-600"
            />
          </Row>
          <Row label="App language" hint="German and Italian cover the main screens so far. The rest stays in English.">
            <div className="flex gap-1.5">
              {([["en", "English"], ["de", "Deutsch"], ["it", "Italiano"]] as const).map(([id, label]) => (
                <button key={id} onClick={() => set("ui_language", id)} className={`h-8 rounded-lg px-3 text-[12px] font-medium transition ${s.ui_language === id ? "chrome-face" : "border border-line text-chrome-400 hover:text-chrome-100"}`}>
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Toggle label="Include Südtiroler Jobs (suedtirolerjobs.it)" checked={s.include_suedtiroler} onChange={(v) => set("include_suedtiroler", v)} />
          <Toggle label="Include NOI Techpark jobs" checked={s.include_noi} onChange={(v) => set("include_noi", v)} />
          <Row label="Company career sites (onboard.org)" hint="The name before .onboard.org in a company's careers link, e.g. alpitronic for alpitronic.onboard.org. All their jobs are read directly.">
            <TagInput values={s.onboard_companies} onChange={(v) => set("onboard_companies", v)} placeholder="Add a company, e.g. eurac…" />
          </Row>
          <Toggle label="Company sites: only jobs located in South Tyrol" checked={s.onboard_local_only} onChange={(v) => set("onboard_local_only", v)} />
        </Panel>

        <Panel className="space-y-5 p-5">
          <SectionTitle>Hide rules</SectionTitle>
          <Row label="Hide titles containing" hint="Whole words, any language. Jobs you already track are never hidden.">
            <TagInput values={s.hide_words} onChange={(v) => set("hide_words", v)} placeholder="Add a word, e.g. Senior…" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUGGESTED_WORDS.filter((w) => !s.hide_words.some((x) => x.toLowerCase() === w.toLowerCase())).map((w) => (
                <button
                  key={w}
                  onClick={() => set("hide_words", [...s.hide_words, w])}
                  className="flex h-6 items-center gap-1 rounded-md border border-dashed border-line-strong px-2 text-[11.5px] text-chrome-500 transition hover:text-chrome-100"
                >
                  <Plus size={10} /> {w}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Hidden companies" hint="Add one with “Hide company” on any job.">
            {s.hide_companies.length === 0 ? (
              <p className="text-[12px] text-chrome-600">None.</p>
            ) : (
              <TagInput values={s.hide_companies} onChange={(v) => set("hide_companies", v)} placeholder="" />
            )}
          </Row>
        </Panel>

        <Panel className="space-y-5 p-5">
          <SectionTitle>Updates</SectionTitle>
          <Row label="Auto-refresh">
            <div className="flex gap-1.5">
              {[0, 30, 60, 180].map((m) => (
                <button
                  key={m}
                  onClick={() => set("auto_refresh_minutes", m)}
                  className={`h-8 rounded-lg px-3 text-[12px] transition ${s.auto_refresh_minutes === m ? "chrome-face font-semibold" : "border border-line text-chrome-400 hover:text-chrome-100"}`}
                >
                  {m === 0 ? "Off" : m < 60 ? `${m} min` : `${m / 60} h`}
                </button>
              ))}
            </div>
          </Row>
          <Toggle label="Desktop notifications (new jobs, follow-ups due)" checked={s.notify_new} onChange={(v) => set("notify_new", v)} />
          <Row label="Follow-up reminder" hint="After you mark a job Applied, remind you to follow up if you haven't moved it on.">
            <div className="flex gap-1.5">
              {[0, 5, 7, 10, 14].map((d) => (
                <button
                  key={d}
                  onClick={() => set("follow_up_days", d)}
                  className={`h-8 rounded-lg px-3 text-[12px] transition ${s.follow_up_days === d ? "chrome-face font-semibold" : "border border-line text-chrome-400 hover:text-chrome-100"}`}
                >
                  {d === 0 ? "Off" : `${d} days`}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Weekly application goal" hint="Shown in the sidebar and in Insights, with a streak.">
            <div className="flex gap-1.5">
              {[0, 3, 5, 8, 10].map((g) => (
                <button
                  key={g}
                  onClick={() => set("weekly_goal", g)}
                  className={`h-8 rounded-lg px-3 text-[12px] transition ${s.weekly_goal === g ? "chrome-face font-semibold" : "border border-line text-chrome-400 hover:text-chrome-100"}`}
                >
                  {g === 0 ? "Off" : `${g} / week`}
                </button>
              ))}
            </div>
          </Row>
          <Toggle
            label="Merge duplicate listings (re-posts, German/English copies, same job on several sites)"
            checked={s.merge_duplicates}
            onChange={(v) => set("merge_duplicates", v)}
          />
        </Panel>

        <Panel className="space-y-5 p-5">
          <SectionTitle
            right={
              <Button size="sm" icon={<Sparkles size={12} />} onClick={onRunSetup}>
                Run setup again
              </Button>
            }
          >
            Matching & AI prompts
          </SectionTitle>
          <Row label="My skills" hint="Used for the match score on every job.">
            <TagInput values={s.skills} onChange={(v) => set("skills", v)} placeholder="Add a skill…" />
          </Row>
          <Row label="My profile" hint="Goes into every AI prompt. Keep it factual: the AI is told to use only what's written here.">
            <textarea
              value={s.profile}
              onChange={(e) => set("profile", e.target.value)}
              className="chrome-border selectable h-72 w-full resize-y rounded-lg bg-void p-3 font-mono text-[12px] leading-relaxed text-chrome-200 outline-none"
            />
          </Row>
        </Panel>

        <Panel className="space-y-5 p-5">
          <SectionTitle>AI</SectionTitle>
          <AiConnect
            provider={s.ai_provider}
            consented={s.ai_consent}
            onConnect={async (p) => {
              const next = { ...s, ai_provider: p, ai_consent: true };
              setS(next);
              await onSave(next);
              toast("Connected");
            }}
          />
          <details>
            <summary className="cursor-pointer text-[12.5px] text-chrome-500 transition hover:text-chrome-200">Use an API key instead</summary>
            <div className="mt-3 space-y-3">
          <AiServiceForm base={s.ai_base_url} model={s.ai_model} apiKey={apiKey} hasKey={hasKey} onBase={(v) => set("ai_base_url", v)} onModel={(v) => set("ai_model", v)} onKey={setApiKey} />
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<KeyRound size={14} />}
              disabled={!apiKey.trim()}
              onClick={async () => {
                try {
                  await api.aiSetKey(apiKey);
                  setApiKey("");
                  setHasKey(true);
                  toast("API key saved");
                } catch (e) {
                  toast(String(e), "warn");
                }
              }}
            >
              Save key
            </Button>
            {hasKey && s.ai_provider !== "key" && (
              <Button
                variant="ghost"
                onClick={async () => {
                  const next = { ...s, ai_provider: "key", ai_consent: true };
                  setS(next);
                  await onSave(next);
                  toast("Using your API key");
                }}
              >
                Use the key
              </Button>
            )}
            {hasKey && (
              <Button
                variant="ghost"
                icon={<Trash2 size={14} />}
                onClick={async () => {
                  await api.aiClearKey();
                  setHasKey(false);
                  toast("API key removed");
                }}
              >
                Remove key
              </Button>
            )}
          </div>
            </div>
          </details>
          <Row
            label="Connect another AI tool (MCP)"
            hint="For Claude Desktop, Cursor and others that run on this computer: add this to the tool's MCP settings. It gets your profile, jobs and CV paths so it can apply for you, under the limits in Autopilot."
          >
            <Button
              icon={<ClipboardCopy size={14} />}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(await api.mcpConfig());
                  toast("Connection details copied");
                } catch (e) {
                  toast(String(e), "warn");
                }
              }}
            >
              Copy connection details
            </Button>
          </Row>
        </Panel>

        <Panel className="space-y-5 p-5">
          <SectionTitle>Export</SectionTitle>
          <Row label="Obsidian vault folder" hint="Default location for the Applications.md export.">
            <div className="flex gap-2">
              <input
                value={s.vault_path}
                onChange={(e) => set("vault_path", e.target.value)}
                placeholder="C:\Users\you\Desktop\p0mpurin\cv\obsidian\job"
                className="chrome-border h-9 flex-1 rounded-lg bg-void px-3 text-[13px] outline-none placeholder:text-chrome-600"
              />
            </div>
          </Row>
          <div className="flex flex-wrap gap-2">
            <Button variant="chrome" icon={<FolderInput size={14} />} onClick={() => exportTo("md")}>
              Export to Obsidian
            </Button>
            <Button icon={<FileSpreadsheet size={14} />} onClick={() => exportTo("csv")}>
              Export CSV
            </Button>
          </div>
          <p className="flex items-center gap-1.5 text-[11.5px] text-chrome-600">
            <Download size={12} /> Exports every tracked job except hidden ones, sorted by stage.
          </p>
        </Panel>

        <Panel className="space-y-4 p-5">
          <SectionTitle>Backup & data</SectionTitle>
          <p className="text-[12.5px] leading-relaxed text-chrome-400">
            A backup holds your settings, profile, pipeline, notes and saved posting text. The app also keeps an automatic backup for each of the last 7 days. Restoring
            saves your current data first, so it can be undone.
          </p>
          <Row
            label="Mirror folder"
            hint="Every change is also copied here, outside the app's own folder. Pick a synced folder like OneDrive so your pipeline survives a deleted or wiped app folder."
          >
            <div className="flex gap-2">
              <input
                value={s.mirror_path}
                onChange={(e) => set("mirror_path", e.target.value)}
                placeholder="Not set"
                className="chrome-border h-9 flex-1 rounded-lg bg-void px-3 text-[13px] outline-none placeholder:text-chrome-600"
              />
              <Button icon={<FolderOpen size={14} />} onClick={pickMirror}>
                Choose…
              </Button>
              <Button disabled={!settings.mirror_path || dirty} onClick={mirrorNow}>
                Mirror now
              </Button>
            </div>
          </Row>
          <div className="flex flex-wrap gap-2">
            <Button variant="chrome" icon={<DatabaseBackup size={14} />} onClick={backupNow}>
              Back up now
            </Button>
            <Button icon={<ArchiveRestore size={14} />} onClick={restore}>
              Restore from backup…
            </Button>
            <Button variant="ghost" icon={<FolderOpen size={14} />} onClick={() => api.openDataFolder().catch((e) => toast(String(e), "warn"))}>
              Open data folder
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2">
        <div className="text-[13px] font-medium text-chrome-100">{label}</div>
        {hint && <div className="text-[12px] text-chrome-500">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="flex w-full items-center text-left text-[13px] text-chrome-100">
      {label}
      <span className={`ml-auto flex h-5 w-9 items-center rounded-full p-0.5 transition ${checked ? "chrome-face" : "bg-white/10"}`}>
        <span className={`h-4 w-4 rounded-full shadow transition ${checked ? "translate-x-4 bg-black" : "bg-chrome-400"}`} />
      </span>
    </button>
  );
}

export function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  function add() {
    const v = draft.trim();
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft("");
  }
  function key(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  }
  return (
    <div className="chrome-border flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg bg-void p-1.5">
      {values.map((v) => (
        <span key={v} className="flex h-6 items-center gap-1 rounded-md border border-line-strong bg-elevated pl-2 pr-1 text-[12px] text-chrome-100">
          {v}
          <button className="text-chrome-500 hover:text-chrome-50" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input data-tags value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={key} onBlur={add} placeholder={placeholder} className="h-6 min-w-24 flex-1 bg-transparent px-1 text-[12px] outline-none placeholder:text-chrome-600" />
      {draft && (
        <button onClick={add} className="text-chrome-400 hover:text-chrome-50" aria-label="Add">
          <Plus size={13} />
        </button>
      )}
    </div>
  );
}
