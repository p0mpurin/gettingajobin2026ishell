import { useEffect, useState, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, RefreshCw, Search, Square, X } from "lucide-react";
import { Kbd } from "./ui";

const win = () => getCurrentWindow();

export function TitleBar({
  query,
  onQuery,
  searchRef,
  loading,
  onRefresh,
  status,
}: {
  query: string;
  onQuery: (q: string) => void;
  searchRef: RefObject<HTMLInputElement>;
  loading: boolean;
  onRefresh: () => void;
  status: string;
}) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    win().isMaximized().then(setMaximized);
    const un = win().onResized(() => win().isMaximized().then(setMaximized));
    return () => {
      un.then((f) => f());
    };
  }, []);

  return (
    <header data-tauri-drag-region className="relative z-20 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-void pl-4">
      <div data-tauri-drag-region className="flex w-[196px] items-center gap-2.5">
        <div className="chrome-face flex h-6 w-6 items-center justify-center rounded-md">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="#0a0a0b" strokeWidth="2.4" strokeLinecap="round">
            <rect x="4" y="8" width="16" height="11" rx="2" />
            <path d="M9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8" />
          </svg>
        </div>
        <span data-tauri-drag-region className="chrome-text text-[14px] font-semibold tracking-tight">
          Bolzano Jobs
        </span>
      </div>

      <label className="chrome-border group flex h-8 w-[420px] items-center gap-2 rounded-lg bg-raised px-2.5 text-chrome-400 focus-within:text-chrome-100">
        <Search size={14} />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search jobs, companies, places…"
          className="h-full flex-1 bg-transparent text-[13px] text-chrome-100 outline-none placeholder:text-chrome-500"
        />
        {query ? (
          <button className="text-chrome-500 hover:text-chrome-100" onClick={() => onQuery("")} aria-label="Clear search">
            <X size={13} />
          </button>
        ) : (
          <Kbd>/</Kbd>
        )}
      </label>

      <div data-tauri-drag-region className="flex flex-1 items-center justify-end gap-2 pr-2">
        <span data-tauri-drag-region className="hidden truncate whitespace-nowrap text-[12px] text-chrome-500 tabular-nums lg:inline">
          {status}
        </span>
        <button
          onClick={onRefresh}
          disabled={loading}
          title="Refresh (R)"
          className="chrome-border flex h-8 items-center gap-1.5 rounded-lg bg-raised px-3 text-[12px] font-medium text-chrome-200 transition hover:bg-hover disabled:opacity-60"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {loading ? "Fetching" : "Refresh"}
        </button>
      </div>

      <div className="flex h-full">
        <button aria-label="Minimize" className="flex h-full w-11 items-center justify-center text-chrome-400 hover:bg-hover hover:text-chrome-50" onClick={() => win().minimize()}>
          <Minus size={14} />
        </button>
        <button
          aria-label={maximized ? "Restore" : "Maximize"}
          className="flex h-full w-11 items-center justify-center text-chrome-400 hover:bg-hover hover:text-chrome-50"
          onClick={() => win().toggleMaximize()}
        >
          {maximized ? <Copy size={12} className="-scale-x-100" /> : <Square size={11} />}
        </button>
        <button aria-label="Close" className="flex h-full w-11 items-center justify-center text-chrome-400 hover:bg-[#c42b1c] hover:text-white" onClick={() => win().close()}>
          <X size={15} />
        </button>
      </div>
    </header>
  );
}
