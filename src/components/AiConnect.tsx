import { useCallback, useEffect, useState } from "react";
import { Check, Download, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { api, type CliStatus } from "../lib/api";
import { Button } from "./ui";

const OPTIONS: { id: "claude" | "codex"; name: string; app: string; plan: string }[] = [
  { id: "claude", name: "Claude", app: "Claude Code", plan: "Claude Pro or Max" },
  { id: "codex", name: "ChatGPT", app: "Codex", plan: "ChatGPT Plus or Pro" },
];

const POLL_MS = 3000;

/**
 * Sign-in through each provider's official app. The login page and the login
 * itself belong to them; this app only asks whether it's done.
 */
export function AiConnect({ provider, consented, onConnect }: { provider: string; consented: boolean; onConnect: (provider: string) => void | Promise<void> }) {
  const [status, setStatus] = useState<Record<string, CliStatus | undefined>>({});
  const [waiting, setWaiting] = useState<string | null>(null);
  const [error, setError] = useState("");

  const check = useCallback(async (id: string) => {
    const s = await api.cliStatus(id).catch(() => null);
    if (s) setStatus((all) => ({ ...all, [id]: s }));
    return s;
  }, []);

  useEffect(() => {
    OPTIONS.forEach((o) => check(o.id));
  }, [check]);

  // After a click, keep looking until the sign-in or install has finished.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      const s = await check(waiting);
      if (s?.signed_in) {
        setWaiting(null);
        await onConnect(waiting);
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, check, onConnect]);

  async function act(run: () => Promise<void>, id: string) {
    setError("");
    try {
      await run();
      setWaiting(id);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="space-y-2">
      {OPTIONS.map((o) => {
        const s = status[o.id];
        const active = consented && provider === o.id && s?.signed_in;
        return (
          <div key={o.id} className={`flex items-center gap-3.5 rounded-xl p-4 ${active ? "chrome-border bg-elevated" : "border border-line bg-white/[0.012]"}`}>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-chrome-50">Sign in with {o.name}</div>
              <div className="mt-0.5 truncate text-[12.5px] text-chrome-500">
                {!s
                  ? "Checking…"
                  : s.signed_in
                    ? `Signed in${s.account ? `: ${s.account}` : ""}`
                    : s.installed
                      ? `Uses your ${o.plan} plan. Sign in on ${o.name}'s own page.`
                      : `Uses your ${o.plan} plan, through ${o.name}'s official ${o.app} app.`}
              </div>
            </div>
            {!s ? (
              <Loader2 size={15} className="animate-spin text-chrome-500" />
            ) : active ? (
              <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-mint">
                <Check size={14} /> Connected
              </span>
            ) : waiting === o.id ? (
              <span className="flex items-center gap-1.5 text-[12.5px] text-chrome-400">
                <Loader2 size={13} className="animate-spin" /> Finish in the window that opened…
              </span>
            ) : s.signed_in ? (
              <Button variant="chrome" onClick={() => onConnect(o.id)}>
                Use {o.name}
              </Button>
            ) : s.installed ? (
              <Button variant="chrome" icon={<LogIn size={14} />} onClick={() => act(() => api.cliSignIn(o.id), o.id)}>
                Sign in
              </Button>
            ) : (
              <Button icon={<Download size={14} />} title={`Installs ${o.app}, ${o.name}'s official app, in a window you can watch`} onClick={() => act(() => api.cliInstall(o.id), o.id)}>
                Install {o.app}
              </Button>
            )}
          </div>
        );
      })}
      {waiting && !status[waiting]?.installed && <p className="text-[12px] leading-relaxed text-chrome-500">When the install finishes, press Sign in here.</p>}
      {error && <p className="text-[12.5px] text-rose">{error}</p>}
      <div className="flex gap-2.5 rounded-xl border border-line bg-white/[0.015] p-3 text-[12px] leading-relaxed text-chrome-400">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-mint" />
        <span>
          Connecting means your messages, and when needed your profile (including name, email, phone and CV text), job listings and page contents, go to the AI you pick, under its privacy terms. Using it counts towards your plan's limits. This app never sees your login.
        </span>
      </div>
    </div>
  );
}
