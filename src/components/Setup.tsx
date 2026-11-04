import { useEffect, useRef, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ArrowLeft, ArrowRight, Check, ClipboardPaste, FileUp, KeyRound, Plug, Sparkles, X } from "lucide-react";
import type { LanguageLevel, Person, Settings } from "../types";
import { FIELDS, fieldById } from "../lib/fields";
import { api } from "../lib/api";
import { buildProfileText, EMPTY_PERSON, parseCv, searchTerms } from "../lib/profile";
import { WindowControls } from "./TitleBar";
import { Button } from "./ui";
import { TagInput } from "./SettingsView";
import { AiServiceForm } from "./AssistantView";

const LEVELS: [string, string, string][] = [
  ["student", "Just starting", "Student, first job or changing careers"],
  ["junior", "Some experience", "Up to 2 years"],
  ["mid", "Experienced", "3 to 7 years"],
  ["senior", "Very experienced", "More than 7 years"],
];
const JOB_TYPES = ["Full-time", "Part-time", "Internship", "Apprenticeship", "Seasonal"];
const COMMUTES: [number, string][] = [[0, "Don't mind"], [30, "30 min"], [45, "45 min"], [60, "1 hour"], [90, "1.5 hours"]];
const CEFR = ["A2", "B1", "B2", "C1", "C2", "Native"];
const BASE_LANGUAGES = ["German", "Italian", "English"];
type AiChoice = "paste" | "key" | "connector";

const STEPS = ["Start", "About you", "Your work", "How you work", "Your skills", "AI", "Finish"];

export function Setup({
  settings,
  onFinish,
  onCancel,
}: {
  settings: Settings;
  /** Saves the answers and fetches jobs. Resolves to how many it found. */
  onFinish: (next: Settings) => Promise<number>;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [person, setPerson] = useState<Person>(() => {
    const had = settings.person?.name || settings.person?.fields?.length;
    if (had) return { ...EMPTY_PERSON, ...settings.person };
    // A profile from before setup existed fills in what it can, and nothing is lost.
    const facts = parseCv(settings.profile ?? "");
    return { ...EMPTY_PERSON, name: settings.profile?.match(/^Name:\s*(.+)$/m)?.[1]?.trim() ?? facts.name, email: facts.email, phone: facts.phone, links: facts.links, languages: facts.languages, background: settings.profile ?? "" };
  });
  const [skills, setSkills] = useState<string[]>(settings.skills ?? []);
  const [town, setTown] = useState(settings.home_town ?? "");
  const [ai, setAi] = useState<AiChoice>("paste");
  const [base, setBase] = useState(settings.ai_base_url);
  const [model, setModel] = useState(settings.ai_model);
  const [apiKey, setApiKey] = useState("");
  const [building, setBuilding] = useState<"no" | "working" | "done">("no");
  const [found, setFound] = useState(0);
  const [buildError, setBuildError] = useState("");
  const set = <K extends keyof Person>(k: K, v: Person[K]) => setPerson((p) => ({ ...p, [k]: v }));

  const canContinue = step === 1 ? person.name.trim().length > 0 : step === 2 ? person.roles.length + person.fields.length > 0 : true;
  const last = STEPS.length - 1;

  async function finish() {
    setBuilding("working");
    setBuildError("");
    try {
      if (ai === "key" && apiKey.trim()) await api.aiSetKey(apiKey);
      const next: Settings = {
        ...settings,
        onboarded: true,
        person,
        skills,
        home_town: town.trim(),
        profile: buildProfileText(person, skills, town),
        terms: searchTerms(person),
        ai_base_url: base,
        ai_model: model,
      };
      setFound(await onFinish(next));
      setBuilding("done");
    } catch (e) {
      setBuildError(String(e));
      setBuilding("no");
    }
  }

  const next = () => {
    if (!canContinue) return;
    if (step < last) setStep(step + 1);
    else if (building === "no") finish();
  };

  // Enter moves on, except where Enter already means something.
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.shiftKey) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "TEXTAREA" || el.tagName === "BUTTON" || el.dataset.tags !== undefined) return;
      e.preventDefault();
      nextRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="setup-glow relative flex h-full flex-col overflow-hidden bg-void">
      <header data-tauri-drag-region className="relative z-10 flex h-12 shrink-0 items-center pl-5">
        <span data-tauri-drag-region className="chrome-text text-[14px] font-semibold tracking-tight">
          Bolzano Jobs
        </span>
        {onCancel && building === "no" && (
          <button onClick={onCancel} className="ml-4 flex items-center gap-1 text-[12px] text-chrome-500 transition hover:text-chrome-100">
            <X size={12} /> Cancel
          </button>
        )}
        <div data-tauri-drag-region className="h-full flex-1" />
        <WindowControls />
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-[680px] gap-1.5 px-8 pt-2" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((name, i) => (
          <div key={name} title={name} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.08]">
            <div className={`h-full rounded-full bg-gradient-to-r from-chrome-400 to-white transition-[width] duration-500 ${i <= step ? "w-full" : "w-0"}`} />
          </div>
        ))}
      </div>

      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8">
        <div key={step} className="animate-rise my-auto w-full max-w-[680px] py-8">
          {step === 0 && (
            <CvStep
              onCv={(text) => {
                const f = parseCv(text);
                setPerson((p) => ({
                  ...p,
                  name: p.name || f.name,
                  email: p.email || f.email,
                  phone: p.phone || f.phone,
                  links: p.links || f.links,
                  languages: p.languages.length ? p.languages : f.languages,
                  background: text.trim(),
                }));
                setSkills((s) => [...new Set([...s, ...f.skills])]);
                return f;
              }}
              onNext={next}
            />
          )}
          {step === 1 && (
            <Question title="Nice to meet you." sub="Your name and contact details go on the applications you prepare. They stay on this computer until you choose to share them.">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Your name" full>
                  <BigInput autoFocus value={person.name} onChange={(v) => set("name", v)} placeholder="First and last name" />
                </Field>
                <Field label="Email">
                  <BigInput value={person.email} onChange={(v) => set("email", v)} placeholder="you@example.com" />
                </Field>
                <Field label="Phone">
                  <BigInput value={person.phone} onChange={(v) => set("phone", v)} placeholder="+39 …" />
                </Field>
                <Field label="Where do you live?" hint="Jobs show the bus and train time from here." full>
                  <BigInput value={town} onChange={setTown} placeholder="e.g. Bozen, Meran, Brixen" />
                </Field>
              </div>
            </Question>
          )}
          {step === 2 && (
            <Question title="What kind of work do you want?" sub="Pick any fields that fit. Add job titles too if you have something specific in mind.">
              <div className="flex flex-wrap gap-2">
                {FIELDS.map((f) => (
                  <BigChip key={f.id} on={person.fields.includes(f.id)} onClick={() => set("fields", toggle(person.fields, f.id))}>
                    {f.label}
                  </BigChip>
                ))}
              </div>
              <div className="mt-6">
                <Label>Job titles (optional)</Label>
                <TagInput values={person.roles} onChange={(v) => set("roles", v)} placeholder="e.g. Pastry chef, Web developer. Press Enter to add" />
              </div>
            </Question>
          )}
          {step === 3 && (
            <Question title="How do you want to work?" sub="This keeps jobs you wouldn't take out of your way.">
              <Label>Your experience</Label>
              <div className="grid grid-cols-2 gap-2">
                {LEVELS.map(([id, name, hint]) => (
                  <button
                    key={id}
                    onClick={() => set("level", person.level === id ? "" : id)}
                    className={`rounded-xl px-4 py-3 text-left transition ${person.level === id ? "chrome-face" : "chrome-border bg-raised hover:bg-hover"}`}
                  >
                    <div className={`text-[14px] font-semibold ${person.level === id ? "" : "text-chrome-100"}`}>{name}</div>
                    <div className={`text-[12px] ${person.level === id ? "text-black/60" : "text-chrome-500"}`}>{hint}</div>
                  </button>
                ))}
              </div>
              <div className="mt-6">
                <Label>Job type</Label>
                <div className="flex flex-wrap gap-2">
                  {JOB_TYPES.map((t) => (
                    <BigChip key={t} on={person.job_types.includes(t)} onClick={() => set("job_types", toggle(person.job_types, t))}>
                      {t}
                    </BigChip>
                  ))}
                </div>
              </div>
              <div className="mt-6">
                <Label>Longest trip to work by public transport</Label>
                <div className="flex flex-wrap gap-2">
                  {COMMUTES.map(([m, label]) => (
                    <BigChip key={m} on={person.max_commute === m} onClick={() => set("max_commute", m)}>
                      {label}
                    </BigChip>
                  ))}
                </div>
              </div>
            </Question>
          )}
          {step === 4 && <SkillsStep person={person} skills={skills} onSkills={setSkills} onLanguages={(l) => set("languages", l)} />}
          {step === 5 && (
            <Question title="Want AI to help?" sub="Optional, and you can change it any time. The app works fully without it.">
              <div className="space-y-2">
                <AiCard on={ai === "paste"} onClick={() => setAi("paste")} icon={<ClipboardPaste size={17} />} title="Copy and paste with ChatGPT" tag="Free">
                  Works with ChatGPT on any plan, or any other AI. The app prepares what to paste, and you paste the answer back.
                </AiCard>
                <AiCard on={ai === "key"} onClick={() => setAi("key")} icon={<KeyRound size={17} />} title="Assistant inside the app" tag="Your API key">
                  Chat right here: "find me jobs and prepare applications". Needs a key from OpenAI, DeepSeek or similar, which you pay for by use.
                </AiCard>
                {ai === "key" && (
                  <div className="chrome-border animate-rise rounded-xl bg-raised p-4">
                    <AiServiceForm base={base} model={model} apiKey={apiKey} onBase={setBase} onModel={setModel} onKey={setApiKey} />
                  </div>
                )}
                <AiCard on={ai === "connector"} onClick={() => setAi("connector")} icon={<Plug size={17} />} title="Connect another AI tool" tag="Advanced">
                  For Claude Desktop, Cursor and similar. You'll find the connection details in Settings once setup is done.
                </AiCard>
              </div>
            </Question>
          )}
          {step === 6 && building !== "done" && (
            <Question title={`You're all set, ${person.name.trim().split(/\s+/)[0] || "friend"}.`} sub="Here's what your feed will look for. You can change any of it later in Settings.">
              <div className="chrome-border sheen divide-y divide-line rounded-xl bg-raised text-[13px]">
                <SummaryRow label="Looking for" value={[...person.roles, ...person.fields.map((f) => fieldById(f)?.label ?? f)].join(", ")} />
                <SummaryRow label="Experience" value={LEVELS.find(([id]) => id === person.level)?.[1] ?? "Not set"} />
                <SummaryRow label="From" value={town ? `${town}${person.max_commute ? `, up to ${COMMUTES.find(([m]) => m === person.max_commute)?.[1]}` : ""}` : "Not set"} />
                <SummaryRow label="Skills" value={skills.length ? skills.slice(0, 8).join(", ") + (skills.length > 8 ? ` and ${skills.length - 8} more` : "") : "None yet"} />
                <SummaryRow label="Languages" value={person.languages.map((l) => `${l.lang} ${l.level}`.trim()).join(", ") || "None yet"} />
              </div>
              {building === "working" && (
                <div className="mt-6 flex items-center gap-3 text-[13px] text-chrome-300">
                  <span className="building-ring" /> Reading the job sites and ranking them for you…
                </div>
              )}
              {buildError && <p className="mt-4 text-[13px] text-rose">{buildError}</p>}
            </Question>
          )}
          {step === 6 && building === "done" && (
            <div className="text-center">
              <div className="chrome-face mx-auto flex h-16 w-16 items-center justify-center rounded-2xl">
                <Sparkles size={26} />
              </div>
              <h1 className="chrome-text mt-6 text-[40px] font-semibold leading-tight tracking-tight">Your feed is ready.</h1>
              <p className="mt-3 text-[15px] text-chrome-400">{found > 0 ? `${found} jobs checked and ranked for you.` : "No jobs came back just now. Refresh in a moment."}</p>
              <p className="mt-1 text-[13px] text-chrome-600">It learns from what you save and pass on.</p>
            </div>
          )}
        </div>
      </main>

      <footer className="relative z-10 mx-auto flex w-full max-w-[680px] shrink-0 items-center px-8 pb-7">
        {step > 0 && building === "no" && (
          <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {step < last && !canContinue && <span className="text-[12px] text-chrome-600">{step === 1 ? "Your name is all we need here" : "Pick at least one"}</span>}
          {step === last && building === "done" ? (
            <Button variant="chrome" className="h-11 px-6 text-[14px]" icon={<ArrowRight size={15} />} onClick={onCancel}>
              Show my jobs
            </Button>
          ) : (
            <Button variant="chrome" className="h-11 px-6 text-[14px]" disabled={!canContinue || building === "working"} icon={step === last ? <Sparkles size={15} /> : <ArrowRight size={15} />} onClick={next}>
              {step === last ? "Build my feed" : step === 0 ? "Start" : "Continue"}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

function CvStep({ onCv, onNext }: { onCv: (text: string) => ReturnType<typeof parseCv>; onNext: () => void }) {
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<ReturnType<typeof parseCv> | null>(null);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);

  async function readFile(path: string) {
    setError("");
    try {
      setResult(onCv(await api.readCv(path)));
    } catch (e) {
      setError(String(e));
    }
  }
  const readRef = useRef(readFile);
  readRef.current = readFile;

  // Dropping a file only reaches the app through the window, not the page.
  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    try {
      getCurrentWebview()
        .onDragDropEvent((e) => {
          if (e.payload.type === "enter" || e.payload.type === "over") setOver(true);
          else if (e.payload.type === "leave") setOver(false);
          else if (e.payload.type === "drop") {
            setOver(false);
            if (e.payload.paths[0]) readRef.current(e.payload.paths[0]);
          }
        })
        .then((f) => (gone ? f() : (off = f)))
        .catch(() => {});
    } catch {
      /* no drop support here; the button still works */
    }
    return () => {
      gone = true;
      off?.();
    };
  }, []);

  async function pick() {
    const path = await open({ title: "Choose your CV", multiple: false, directory: false, filters: [{ name: "CV", extensions: ["pdf", "txt", "md"] }] });
    if (path && !Array.isArray(path)) readFile(path);
  }

  return (
    <div>
      <h1 className="chrome-text text-[44px] font-semibold leading-[1.08] tracking-tight">Jobs that actually suit you.</h1>
      <p className="mt-4 max-w-[520px] text-[15px] leading-relaxed text-chrome-400">A minute of questions, then every job in South Tyrol is ranked for you. Start with your CV and most answers fill themselves in.</p>

      {result ? (
        <div className="chrome-border sheen animate-rise mt-8 rounded-2xl bg-raised p-5">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-chrome-50">
            <Check size={16} className="text-mint" /> Read your CV
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-chrome-400">
            {[result.name, result.email, result.phone, result.skills.length && `${result.skills.length} skills`, result.languages.length && `${result.languages.length} languages`].filter(Boolean).join(" · ") || "No details recognised, but the text is kept for your applications."}
          </p>
          <p className="mt-1 text-[12px] text-chrome-600">You can check and change all of it on the next screens. Nothing has left this computer.</p>
        </div>
      ) : pasting ? (
        <div className="animate-rise mt-8">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the text of your CV here…"
            className="chrome-border selectable h-44 w-full resize-none rounded-2xl bg-raised p-4 text-[13px] leading-relaxed text-chrome-100 outline-none placeholder:text-chrome-600"
          />
          <div className="mt-2 flex gap-2">
            <Button variant="chrome" disabled={!text.trim()} onClick={() => setResult(onCv(text))}>
              Use this text
            </Button>
            <Button variant="ghost" onClick={() => setPasting(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className={`mt-8 rounded-2xl border border-dashed p-8 text-center transition ${over ? "border-chrome-200 bg-white/[0.05]" : "border-line-strong bg-white/[0.015]"}`}>
          <FileUp size={26} strokeWidth={1.5} className="mx-auto text-chrome-400" />
          <p className="mt-3 text-[15px] font-medium text-chrome-100">{over ? "Drop it" : "Drop your CV here"}</p>
          <p className="mt-1 text-[12px] text-chrome-600">PDF or text. It's read on this computer and isn't uploaded.</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="chrome" onClick={pick}>
              Choose a file
            </Button>
            <Button onClick={() => setPasting(true)}>Paste the text</Button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-[13px] text-rose">{error}</p>}
      {!result && (
        <button onClick={onNext} className="mt-4 text-[13px] text-chrome-500 transition hover:text-chrome-100">
          No CV at hand? Skip this
        </button>
      )}
    </div>
  );
}

function SkillsStep({ person, skills, onSkills, onLanguages }: { person: Person; skills: string[]; onSkills: (s: string[]) => void; onLanguages: (l: LanguageLevel[]) => void }) {
  const suggestions = [...new Set(person.fields.flatMap((f) => fieldById(f)?.skills ?? []))].filter((s) => !skills.includes(s));
  const shown = [...new Set([...BASE_LANGUAGES, ...person.languages.map((l) => l.lang)])];
  const [adding, setAdding] = useState("");
  const levelOf = (lang: string) => person.languages.find((l) => l.lang === lang)?.level ?? "";
  const setLevel = (lang: string, level: string) =>
    onLanguages(level === levelOf(lang) ? person.languages.filter((l) => l.lang !== lang) : [...person.languages.filter((l) => l.lang !== lang), { lang, level }]);

  return (
    <Question title="What can you do?" sub="This is what jobs get matched against. Add anything you'd be happy to be asked about.">
      <TagInput values={skills} onChange={onSkills} placeholder="Add a skill and press Enter…" />
      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} onClick={() => onSkills([...skills, s])} className="rounded-full border border-dashed border-line-strong px-3 py-1 text-[12px] text-chrome-400 transition hover:border-chrome-400 hover:text-chrome-50">
              + {s}
            </button>
          ))}
        </div>
      )}
      <div className="mt-7">
        <Label>Languages</Label>
        <div className="space-y-1.5">
          {shown.map((lang) => (
            <div key={lang} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-[13px] text-chrome-200">{lang}</span>
              <div className="flex flex-1 gap-1">
                {CEFR.map((c) => (
                  <button
                    key={c}
                    onClick={() => setLevel(lang, c)}
                    className={`h-8 flex-1 rounded-md text-[12px] font-medium transition ${levelOf(lang) === c ? "chrome-face" : "bg-white/[0.04] text-chrome-500 hover:bg-white/[0.08] hover:text-chrome-100"}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const v = adding.trim();
            if (v) onLanguages([...person.languages, { lang: v, level: "B1" }]);
            setAdding("");
          }}
        >
          <input
            data-tags
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="Another language? Type it and press Enter"
            className="h-8 w-72 bg-transparent text-[12px] text-chrome-300 outline-none placeholder:text-chrome-600"
          />
        </form>
        <p className="mt-1 text-[11.5px] text-chrome-600">A2 is basic, B1-B2 is everyday and working use, C1-C2 is fluent.</p>
      </div>
    </Question>
  );
}

function Question({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div>
      <h1 className="chrome-text text-[34px] font-semibold leading-[1.12] tracking-tight">{title}</h1>
      <p className="mb-7 mt-3 max-w-[560px] text-[14px] leading-relaxed text-chrome-400">{sub}</p>
      {children}
    </div>
  );
}

const Label = ({ children }: { children: ReactNode }) => <div className="mb-2 text-[12px] font-medium text-chrome-400">{children}</div>;

function Field({ label, hint, full, children }: { label: string; hint?: string; full?: boolean; children: ReactNode }) {
  return (
    <label className={`block ${full ? "col-span-2" : ""}`}>
      <Label>{label}</Label>
      {children}
      {hint && <span className="mt-1.5 block text-[11.5px] text-chrome-600">{hint}</span>}
    </label>
  );
}

function BigInput({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <input
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="chrome-border h-12 w-full rounded-xl bg-raised px-4 text-[15px] text-chrome-50 outline-none transition placeholder:text-chrome-600 focus:bg-elevated"
    />
  );
}

function BigChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={`h-10 rounded-full px-4 text-[13px] font-medium transition active:scale-[0.97] ${on ? "chrome-face" : "chrome-border bg-raised text-chrome-300 hover:bg-hover hover:text-chrome-50"}`}>
      {children}
    </button>
  );
}

function AiCard({ on, onClick, icon, title, tag, children }: { on: boolean; onClick: () => void; icon: ReactNode; title: string; tag: string; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={`flex w-full items-start gap-3.5 rounded-xl p-4 text-left transition ${on ? "chrome-border bg-elevated" : "border border-line bg-white/[0.012] hover:bg-raised"}`}>
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${on ? "chrome-face" : "bg-white/[0.05] text-chrome-400"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[14px] font-semibold text-chrome-50">
          {title}
          <span className="rounded-full border border-line-strong px-2 py-px text-[10.5px] font-medium text-chrome-400">{tag}</span>
        </span>
        <span className="mt-1 block text-[12.5px] leading-relaxed text-chrome-500">{children}</span>
      </span>
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 px-4 py-2.5">
      <span className="w-24 shrink-0 text-chrome-500">{label}</span>
      <span className="min-w-0 text-chrome-100">{value}</span>
    </div>
  );
}
