import { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Loader2, Mail, Plus, RefreshCw, ShieldCheck, Undo2, X } from "lucide-react";
import type { MailSuggestion, Settings, Track } from "../types";
import { api } from "../lib/api";
import { Button, Panel, SectionTitle, useToast } from "./ui";

/** Name, mail server and where to make an app password. */
const SERVICES: [string, string, string][] = [
  ["Gmail", "imap.gmail.com", "https://myaccount.google.com/apppasswords"],
  ["iCloud", "imap.mail.me.com", "https://account.apple.com/account/manage"],
  ["Yahoo", "imap.mail.yahoo.com", "https://login.yahoo.com/account/security"],
];

const input = "chrome-border h-9 w-full rounded-lg bg-void px-3 text-[13px] text-chrome-100 outline-none placeholder:text-chrome-600";
const KIND_LABEL: Record<string, string> = { rejection: "said no", interview: "wants an interview", offer: "made an offer", received: "confirmed your application" };

export function InboxPanel({
  settings,
  tracks,
  onSaveSettings,
  onChanged,
}: {
  settings: Settings;
  tracks: Record<string, Track>;
  onSaveSettings: (s: Settings) => Promise<void>;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [service, setService] = useState(0);
  const [host, setHost] = useState(SERVICES[0][1]);
  const [address, setAddress] = useState(settings.mail_address);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<MailSuggestion[]>([]);

  const loadSuggestions = useCallback(() => {
    api.mailSuggestions().then((s) => setSuggestions(s ?? [])).catch(() => {});
  }, []);
  useEffect(loadSuggestions, [loadSuggestions]);

  // Status changes that replies made, newest first, for Undo.
  const moved = useMemo(
    () =>
      Object.entries(tracks)
        .flatMap(([id, t]) => (t.mails ?? []).filter((m) => m.moved_to).map((m) => ({ id, track: t, mail: m })))
        .sort((a, b) => b.mail.date - a.mail.date)
        .slice(0, 8),
    [tracks],
  );

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.mailConnect(address, host, password);
      setPassword("");
      // The backend saved the connection: keep this copy in step before saving anything else.
      await onSaveSettings({ ...settings, mail_enabled: true, mail_address: address.trim(), mail_host: host.trim(), mail_port: 993 });
      await check();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setBusy(true);
    setError("");
    try {
      const r = await api.mailSync();
      onChanged();
      loadSuggestions();
      toast(r.updates.length ? `${r.updates.length} application${r.updates.length === 1 ? "" : "s"} updated` : `Looked through ${r.checked} emails, nothing new`, r.updates.length ? "ok" : "info");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id: string, accept: boolean) {
    await api.mailResolve(id, accept);
    loadSuggestions();
    if (accept) onChanged();
  }

  if (!settings.mail_enabled) {
    const [, , passwordPage] = SERVICES[service];
    return (
      <Panel className="space-y-3 p-5">
        <SectionTitle>Your inbox</SectionTitle>
        <p className="text-[12.5px] leading-relaxed text-chrome-400">Connect your email and replies update your pipeline by themselves: rejections, interviews and offers. It also finds applications you made outside this app.</p>
        <form className="space-y-3" onSubmit={connect}>
          <div className="flex flex-wrap gap-1.5">
            {SERVICES.map(([name, server], i) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setService(i);
                  setHost(server);
                }}
                className={`h-7 rounded-full px-3 text-[12px] font-medium transition ${service === i ? "chrome-face" : "border border-line-strong text-chrome-400 hover:text-chrome-50"}`}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[12px] text-chrome-500">
              Email address
              <input type="email" required autoComplete="off" value={address} onChange={(e) => setAddress(e.target.value)} className={`${input} mt-1`} />
            </label>
            <label className="block text-[12px] text-chrome-500">
              <span className="flex items-center">
                App password
                <button type="button" onClick={() => openUrl(passwordPage)} className="ml-auto text-chrome-300 transition hover:text-chrome-50">
                  Make one ↗
                </button>
              </span>
              <input type="password" required autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Not your normal password" className={`${input} mt-1`} />
            </label>
          </div>
          <div className="flex gap-2.5 rounded-xl border border-line bg-white/[0.015] p-3 text-[12px] leading-relaxed text-chrome-400">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-mint" />
            <span>Read-only: it can't send, delete, move or mark anything as read. It reads the sender and subject of recent emails, and the text only of ones about a job application. Nothing leaves this computer. The password is kept in Windows Credential Manager.</span>
          </div>
          {error && <p className="selectable text-[12.5px] text-rose">{error}</p>}
          <Button type="submit" variant="chrome" disabled={busy || !address.trim() || !password.trim()} icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}>
            Connect email
          </Button>
        </form>
      </Panel>
    );
  }

  return (
    <Panel className="space-y-3 p-5">
      <SectionTitle
        right={
          <Button size="sm" disabled={busy} icon={busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} onClick={check}>
            Check now
          </Button>
        }
      >
        Your inbox
      </SectionTitle>
      <div className="text-[12.5px] text-chrome-400">
        Connected to <span className="text-chrome-100">{settings.mail_address}</span>, read-only. Checked every 30 minutes while the app is open.
      </div>
      <button role="switch" aria-checked={settings.mail_auto_update} onClick={() => onSaveSettings({ ...settings, mail_auto_update: !settings.mail_auto_update })} className="flex w-full items-start gap-3 text-left">
        <span className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${settings.mail_auto_update ? "chrome-face justify-end" : "justify-start bg-white/[0.1]"}`}>
          <span className={`h-4 w-4 rounded-full ${settings.mail_auto_update ? "bg-black/70" : "bg-chrome-400"}`} />
        </span>
        <span>
          <span className="block text-[13px] text-chrome-100">Move jobs when a reply comes in</span>
          <span className="block text-[12px] leading-relaxed text-chrome-500">It reads replies by their wording, so it can get one wrong: every move can be undone here. Off: replies are only listed on the job.</span>
        </span>
      </button>
      {error && <p className="selectable text-[12.5px] text-rose">{error}</p>}

      {suggestions.length > 0 && (
        <div className="space-y-1.5 border-t border-line pt-3">
          <div className="text-[12.5px] font-medium text-chrome-100">Applications it found that aren't in your pipeline</div>
          {suggestions.map((s) => (
            <div key={s.id} className="flex items-center gap-2 text-[12.5px]">
              <div className="min-w-0 flex-1">
                <div className="truncate text-chrome-200">
                  {s.company} <span className="text-chrome-500">{KIND_LABEL[s.kind] ?? ""}</span>
                </div>
                <div className="selectable truncate text-[11.5px] text-chrome-600">{s.subject}</div>
              </div>
              <Button size="sm" icon={<Plus size={12} />} onClick={() => resolve(s.id, true)}>
                Add
              </Button>
              <button aria-label={`Not an application: ${s.company}`} title="Not an application" className="text-chrome-600 transition hover:text-chrome-100" onClick={() => resolve(s.id, false)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {moved.length > 0 && (
        <div className="space-y-1.5 border-t border-line pt-3">
          <div className="text-[12.5px] font-medium text-chrome-100">Recent updates</div>
          {moved.map(({ id, track, mail }) => (
            <div key={mail.message_id} className="flex items-center gap-2 text-[12.5px] text-chrome-300">
              <Check size={13} className="shrink-0 text-mint" />
              <span className="min-w-0 flex-1 truncate">
                {track.company} moved to {mail.moved_to}: <span className="text-chrome-500">{mail.subject}</span>
              </span>
              <button
                title="This was wrong: put it back"
                aria-label={`Undo the move for ${track.company}`}
                className="text-chrome-500 transition hover:text-chrome-50"
                onClick={async () => {
                  await api.mailUndo(id, mail.message_id);
                  onChanged();
                }}
              >
                <Undo2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-line pt-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await api.mailDisconnect();
            await onSaveSettings({ ...settings, mail_enabled: false });
          }}
        >
          Disconnect email
        </Button>
      </div>
    </Panel>
  );
}
