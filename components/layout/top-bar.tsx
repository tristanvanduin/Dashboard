"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { Bell, AlertTriangle, Info, X } from "lucide-react";
import { getAllClients } from "@/lib/clients";

interface Notification {
  clientName: string;
  clientId: string;
  severity: "critical" | "warning" | "info";
  message: string;
}

export function TopBar() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);

    // Fetch notifications from overview data
    async function loadNotifications() {
      try {
        const clients = getAllClients().filter((c) => c.id.startsWith("gads-"));
        if (clients.length === 0) return;

        const customerIds = clients.map((c) => c.id.replace("gads-", "")).join(",");
        const res = await fetch(`/api/google-ads/overview?customerIds=${customerIds}`);
        const data = await res.json();

        const notifs: Notification[] = [];
        for (const account of data.accounts || []) {
          const client = clients.find((c) => c.id === `gads-${account.customerId}`);
          const name = client?.name ?? account.customerId;
          const clientId = client?.id ?? "";

          if (account.ytd) {
            // YoY decline > 20%
            if (account.yoy?.convChange !== null && account.yoy.convChange < -20) {
              notifs.push({
                clientName: name, clientId,
                severity: "critical",
                message: `Conversies ${Math.round(account.yoy.convChange)}% YoY`,
              });
            }
            // Very low ROAS
            if (account.ytd.roas > 0 && account.ytd.roas < 1) {
              notifs.push({
                clientName: name, clientId,
                severity: "warning",
                message: `ROAS ${account.ytd.roas.toFixed(1)}x — onder break-even`,
              });
            }
            // High CPA (> €200)
            if (account.ytd.cpa > 200) {
              notifs.push({
                clientName: name, clientId,
                severity: "warning",
                message: `CPA ${new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(account.ytd.cpa)}`,
              });
            }
          }
          if (account.error) {
            notifs.push({
              clientName: name, clientId,
              severity: "info",
              message: "Fout bij ophalen data",
            });
          }
        }

        notifs.sort((a, b) => {
          const order = { critical: 0, warning: 1, info: 2 };
          return order[a.severity] - order[b.severity];
        });
        setNotifications(notifs);
      } catch { /* ignore */ }
    }

    loadNotifications();
  }, []);

  // Close panel on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const getTitle = () => {
    if (pathname === "/") return "Vandaag";
    if (pathname === "/portfolio") return "Klantoverzicht";
    if (pathname === "/settings") return "Instellingen";
    if (!mounted) return "Dashboard";
    const clientId = pathname.replace("/client/", "");
    const client = getAllClients().find((c) => c.id === clientId);
    return client?.name || "Dashboard";
  };

  const criticalCount = notifications.filter((n) => n.severity === "critical").length;
  const totalCount = notifications.length;

  return (
    <header className="h-16 border-b border-border bg-white flex items-center justify-between px-6 sticky top-0 z-40">
      <h2 className="text-lg font-bold text-rm-blue">{getTitle()}</h2>

      <div className="flex items-center gap-4">
        {/* Notification bell */}
        {mounted && (
          <div className="relative" ref={panelRef}>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <Bell className="w-5 h-5 text-muted-foreground" />
              {totalCount > 0 && (
                <span className={`absolute -top-0.5 -right-0.5 w-5 h-5 text-[10px] font-bold rounded-full flex items-center justify-center text-white ${
                  criticalCount > 0 ? "bg-red-500" : "bg-amber-500"
                }`}>
                  {totalCount > 9 ? "9+" : totalCount}
                </span>
              )}
            </button>

            {/* Dropdown */}
            {showNotifications && (
              <div className="absolute right-0 top-12 w-80 bg-white rounded-xl border border-border shadow-lg overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-semibold text-rm-blue">Meldingen</span>
                  <button onClick={() => setShowNotifications(false)}>
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    Geen meldingen — alles ziet er goed uit.
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto divide-y divide-border">
                    {notifications.map((n, i) => (
                      <a
                        key={i}
                        href={n.clientId ? `/client/${n.clientId}` : "#"}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                        onClick={() => setShowNotifications(false)}
                      >
                        {n.severity === "critical" ? (
                          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                        ) : n.severity === "warning" ? (
                          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        ) : (
                          <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-rm-gray">{n.clientName}</p>
                          <p className="text-xs text-muted-foreground">{n.message}</p>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <span className="text-sm text-muted-foreground">
          {mounted
            ? new Date().toLocaleDateString("nl-NL", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            : ""
          }
        </span>
      </div>
    </header>
  );
}
