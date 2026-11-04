import { useEffect, useRef, useState } from "react";
import { Bot, KeyRound, Send, ShieldCheck, Sparkles, Trash2, Wrench } from "lucide-react";
import type { Settings } from "../types";
import { api } from "../lib/api";
import { Button, Panel } from "./ui";

export const AI_SERVICES: [string, string, string][] = [
  ["OpenAI (GPT)", "https://api.openai.com/v1", "gpt-4o-mini"],
  ["DeepSeek", "https://api.deepseek.com/v1", "deepseek-chat"],
];

const inputClass = "chrome-border h-9 w-full rounded-lg bg-void px-3 text-[13px] text-chrome-100 outline-none placeholder:text-chrome-600";

/** Service, model and key. The key field is write-only: a saved key is never shown again. */
export function AiServiceForm({
  base,
  model,
  apiKey,
  hasKey,
  onBase,
  onModel,
  onKey,
}: {
  base: string;
  model: string;
  apiKey: string;
  hasKey?: boolean;
  onBase: (v: string) => void;
  onModel: (v: string) => void;
  onKey: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {AI_SERVICES.map(([name, url, m]) => (
          <button
            key={name}
            onClick={() => {
              onBase(url);
              onModel(m);
            }}
            className={`h-7 rounded-full px-3 text-[12px] font-medium transition ${base === url ? "chrome-face" : "border border-line-strong text-chrome-400 hover:text-chrome-50"}`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_170px] gap-2">
        <label className="block text-[12px] text-chrome-500">
          Service address
          <input value={base} onChange={(e) => onBase(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-[12px] text-chrome-500">
          Model
          <input value={model} onChange={(e) => onModel(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
      </div>
      <label className="block text-[12px] text-chrome-500">
        API key
        <input type="password" autoComplete="off" value={apiKey} onChange={(e) => onKey(e.target.value)} placeholder={hasKey ? "Saved. Type a new one to replace it" : "Paste your key"} className={`${inputClass} mt-1`} />
        <span className="mt-1 block text-[11.5px] text-chrome-600">Kept in Windows Credential Manager, never in the app's data files or backups.</span>
      </label>
    </div>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const STARTERS = ["Find the 5 best jobs for me and explain why", "Rank my whole feed", "Prepare applications for my top 3 jobs", "What should I learn to get more of these jobs?"];

export interface ChatLine {
  role: "user" | "assistant" | "error";
  text: string;
  actions?: string[];
}

/** Conversation state lives in the parent, so it survives switching views. */
export function AssistantView({
  settings,
  onSaveSettings,
  onChanged,
  chat,
  setChat,
}: {
  settings: Settings;
  onSaveSettings: (s: Settings) => Promise<void>;
  /** The assistant may have saved jobs, ranked them or written drafts. */
  onChanged: () => void;
  chat: { lines: ChatLine[]; history: unknown[] };
  setChat: (c: { lines: ChatLine[]; history: unknown[] }) => void;
}) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [base, setBase] = useState(settings.ai_base_url);
  const [model, setModel] = useState(settings.ai_model);
  const [apiKey, setApiKey] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.aiHasKey().then(setHasKey).catch(() => setHasKey(false));
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.lines.length, busy]);

  async function connect() {
    if (apiKey.trim()) await api.aiSetKey(apiKey);
    await onSaveSettings({ ...settings, ai_base_url: base.trim(), ai_model: model.trim(), ai_consent: true });
    setApiKey("");
    setHasKey(true);
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setDraft("");
    const history = [...chat.history, { role: "user", content }];
    const lines: ChatLine[] = [...chat.lines, { role: "user", text: content }];
    setChat({ lines, history });
    setBusy(true);
    try {
      const reply = await api.aiChat(history);
      setChat({ lines: [...lines, { role: "assistant", text: reply.text, actions: reply.actions }], history: [...history, ...reply.messages] });
      if (reply.actions.length) onChanged();
    } catch (e) {
      // The failed message isn't kept in the history, so it can simply be sent again.
      setChat({ lines: [...lines, { role: "error", text: String(e) }], history: chat.history });
    } finally {
      setBusy(false);
    }
  }

  if (hasKey === null) return <div className="flex-1 bg-void" />;

  if (!hasKey || !settings.ai_consent) {
    const canSave = (hasKey || apiKey.trim().length > 0) && base.trim().length > 0 && model.trim().length > 0;
    return (
      <div className="min-w-0 flex-1 overflow-y-auto bg-void">
        <div className="mx-auto max-w-[600px] px-7 py-10">
          <div className="chrome-face flex h-11 w-11 items-center justify-center rounded-xl">
            <Bot size={20} />
          </div>
          <h1 className="chrome-text mt-4 text-[26px] font-semibold tracking-tight">Your job-search assistant</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-chrome-400">Ask it to find jobs, rank your feed and write applications. It uses your own API key, so you pay the AI service directly, by use. ChatGPT Plus doesn't include API use.</p>
          <Panel className="mt-6 p-5">
            <AiServiceForm base={base} model={model} apiKey={apiKey} hasKey={!!hasKey} onBase={setBase} onModel={setModel} onKey={setApiKey} />
          </Panel>
          <div className="mt-4 flex gap-3 rounded-xl border border-line bg-white/[0.015] p-4 text-[12.5px] leading-relaxed text-chrome-400">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-mint" />
            <div>
              <span className="font-medium text-chrome-100">What gets shared with {hostOf(base)}: </span>
              your messages here and, when it needs them, your profile (including name, email, phone and CV text), job listings and your applications. Their privacy terms apply. It can save jobs and write drafts, but it can't send anything: you review and send every application yourself.
            </div>
          </div>
          <Button variant="chrome" className="mt-4" disabled={!canSave} icon={<KeyRound size={14} />} onClick={connect}>
            I understand, connect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-void">
      <div className="flex shrink-0 items-center border-b border-line px-7 py-4">
        <div>
          <h1 className="chrome-text text-[20px] font-semibold tracking-tight">Assistant</h1>
          <p className="mt-0.5 text-[12px] text-chrome-500">
            {settings.ai_model} on {hostOf(settings.ai_base_url)}. Drafts wait for your review; nothing is sent for you.
          </p>
        </div>
        {chat.lines.length > 0 && (
          <Button variant="ghost" size="sm" className="ml-auto" icon={<Trash2 size={12} />} onClick={() => setChat({ lines: [], history: [] })}>
            New chat
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] space-y-4 px-7 py-6">
          {chat.lines.length === 0 && (
            <div className="pt-10 text-center">
              <Sparkles size={24} strokeWidth={1.5} className="mx-auto text-chrome-400" />
              <p className="mt-3 text-[15px] text-chrome-200">What should we work on?</p>
              <div className="mx-auto mt-5 grid max-w-[520px] grid-cols-2 gap-2">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="chrome-border rounded-xl bg-raised p-3 text-left text-[12.5px] leading-snug text-chrome-300 transition hover:bg-hover hover:text-chrome-50">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {chat.lines.map((line, i) =>
            line.role === "user" ? (
              <div key={i} className="animate-rise ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-elevated px-4 py-2.5 text-[13.5px] leading-relaxed text-chrome-50 selectable whitespace-pre-wrap">
                {line.text}
              </div>
            ) : line.role === "error" ? (
              <div key={i} className="animate-rise rounded-xl border border-rose/25 bg-rose/[0.06] px-4 py-2.5 text-[13px] text-rose selectable">
                {line.text}
              </div>
            ) : (
              <div key={i} className="animate-rise">
                {line.actions && line.actions.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {line.actions.map((a, j) => (
                      <span key={j} className="inline-flex items-center gap-1 rounded-md border border-line-strong px-2 py-0.5 text-[11px] text-chrome-400">
                        <Wrench size={10} /> {a}
                      </span>
                    ))}
                  </div>
                )}
                <div className="selectable whitespace-pre-wrap text-[13.5px] leading-relaxed text-chrome-100">{line.text}</div>
              </div>
            ),
          )}
          {busy && (
            <div className="flex items-center gap-2.5 text-[12.5px] text-chrome-500">
              <span className="building-ring" /> Working…
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>

      <form
        className="mx-auto w-full max-w-[720px] shrink-0 px-7 pb-6"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <div className="chrome-border flex items-end gap-2 rounded-2xl bg-raised p-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            rows={1}
            placeholder="Ask about your jobs…"
            className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13.5px] text-chrome-50 outline-none placeholder:text-chrome-600"
          />
          <Button type="submit" variant="chrome" disabled={!draft.trim() || busy} aria-label="Send" icon={<Send size={14} />} />
        </div>
      </form>
    </div>
  );
}
