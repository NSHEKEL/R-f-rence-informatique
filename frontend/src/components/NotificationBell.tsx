import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, Package, ShoppingCart, Wallet } from "lucide-react";
import api, { formatDateTime } from "../api/client";
import type { Notification } from "../types";

const POLL_MS = 15000;

const icons: Record<string, typeof Bell> = {
  vente: ShoppingCart,
  stock: Package,
  caisse: Wallet,
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return "";
}

/** "il y a 5 min · 23/07/2026 à 10:53" — the exact hour always shows. */
function stamp(iso: string): string {
  const relative = timeAgo(iso);
  return relative
    ? `${relative} · ${formatDateTime(iso)}`
    : formatDateTime(iso);
}

export default function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, count] = await Promise.all([
        api.get<Notification[]>("/notifications", { params: { limit: 20 } }),
        api.get<{ count: number }>("/notifications/unread-count"),
      ]);
      setItems(list.data);
      setUnread(count.data.count);
    } catch {
      /* silently ignore polling errors (offline, session expired) */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function openItem(item: Notification) {
    setOpen(false);
    if (!item.is_read) {
      await api.post(`/notifications/${item.id}/read`).catch(() => undefined);
      refresh();
    }
    if (item.link) navigate(item.link);
  }

  async function markAll() {
    await api.post("/notifications/read-all").catch(() => undefined);
    refresh();
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-100"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-bold text-slate-900">Notifications</p>
            {unread > 0 && (
              <button
                onClick={markAll}
                className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                <CheckCheck size={14} /> Tout marquer comme lu
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                Aucune notification
              </p>
            )}
            {items.map((item) => {
              const Icon = icons[item.kind] ?? Bell;
              return (
                <button
                  key={item.id}
                  onClick={() => openItem(item)}
                  className={`flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50 ${
                    item.is_read ? "" : "bg-brand-50/40"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      item.is_read
                        ? "bg-slate-100 text-slate-400"
                        : "bg-brand-100 text-brand-700"
                    }`}
                  >
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {item.title}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {item.message}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">
                      {stamp(item.created_at)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
