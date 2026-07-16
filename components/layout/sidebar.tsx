"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, Building2, Search, FileCode2, FolderOpen, FolderClosed, ChevronDown, ChevronRight } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { getVisibleClients, loadVisibleClientIds } from "@/lib/visible-clients";
import { loadApiClients } from "@/lib/clients";
import { migrateLocalStorageToSupabase } from "@/lib/migrate-to-supabase";
import { loadClientGroups, type GroupWithMembers } from "@/lib/client-groups";

interface VisibleClient {
  id: string;
  name: string;
}

export function Sidebar() {
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [visibleClients, setVisibleClients] = useState<VisibleClient[]>([]);
  const [groups, setGroups] = useState<GroupWithMembers[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);

  const refreshData = useCallback(async () => {
    const [, , loadedGroups] = await Promise.all([
      loadApiClients(),
      loadVisibleClientIds(),
      loadClientGroups(),
    ]);
    setVisibleClients(getVisibleClients());
    setGroups(loadedGroups);
  }, []);

  useEffect(() => {
    async function init() {
      await migrateLocalStorageToSupabase();
      await refreshData();
    }
    init();
    setMounted(true);

    function onStorage() {
      setVisibleClients(getVisibleClients());
    }
    function onGroupsChanged() {
      refreshData();
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("visible-clients-changed", onStorage);
    window.addEventListener("clients-changed", onStorage);
    window.addEventListener("groups-changed", onGroupsChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("visible-clients-changed", onStorage);
      window.removeEventListener("clients-changed", onStorage);
      window.removeEventListener("groups-changed", onGroupsChanged);
    };
  }, [refreshData]);

  function toggleGroup(groupId: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  // Filter by search
  const filtered = visibleClients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );
  const filteredIds = new Set(filtered.map((c) => c.id));

  // Build grouped + ungrouped lists
  const groupedClientIds = new Set(groups.flatMap((g) => g.clientIds));
  const ungroupedClients = filtered.filter((c) => !groupedClientIds.has(c.id));

  // Filter groups to only show those with visible+filtered clients
  const visibleGroups = groups
    .map((g) => ({
      ...g,
      clients: g.clientIds
        .map((id) => filtered.find((c) => c.id === id))
        .filter((c): c is VisibleClient => c !== undefined),
    }))
    .filter((g) => g.clients.length > 0 || !search);

  // Also filter groups by search on group name
  const matchingGroups = search
    ? visibleGroups.filter(
        (g) => g.clients.length > 0 || g.name.toLowerCase().includes(search.toLowerCase())
      )
    : visibleGroups;

  const totalCount = filtered.length;

  function ClientLink({ client }: { client: VisibleClient }) {
    const isActive = pathname === `/client/${client.id}`;
    return (
      <Link
        href={`/client/${client.id}`}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
          isActive
            ? "bg-rm-orange text-white font-medium"
            : "text-white/70 hover:bg-white/10 hover:text-white"
        }`}
      >
        <Building2 className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{client.name}</span>
      </Link>
    );
  }

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-72 bg-rm-blue flex flex-col z-50">
      {/* Logo */}
      <div className="p-6 pb-4">
        <h1 className="text-white text-xl font-bold tracking-tight">
          Ranking Masters
        </h1>
        <p className="text-white/50 text-xs mt-1">SEA Dashboard</p>
      </div>

      {/* Search */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            type="text"
            placeholder="Zoek klant..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/10 text-white text-sm rounded-lg pl-9 pr-3 py-2 placeholder:text-white/40 border border-white/10 focus:outline-none focus:border-rm-orange"
          />
        </div>
      </div>

      {/* Client list with groups */}
      <div className="flex-1 overflow-y-auto px-3 space-y-0.5">
        <p className="text-white/40 text-[11px] font-semibold uppercase tracking-wider px-3 py-2">
          Klanten{mounted ? ` (${totalCount})` : ""}
        </p>

        {/* Grouped clients */}
        {matchingGroups.map((group) => {
          const isCollapsed = collapsedGroups.has(group.id);
          const hasActiveClient = group.clients.some((c) => pathname === `/client/${c.id}`);

          return (
            <div key={group.id} className="mb-1">
              <button
                onClick={() => toggleGroup(group.id)}
                className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm transition-colors ${
                  hasActiveClient && isCollapsed
                    ? "bg-rm-orange/20 text-white"
                    : "text-white/50 hover:bg-white/5 hover:text-white/70"
                }`}
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3 h-3 shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 shrink-0" />
                )}
                {isCollapsed ? (
                  <FolderClosed className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                )}
                <span className="truncate font-medium text-[12px]">{group.name}</span>
                <span className="ml-auto text-[10px] text-white/30">{group.clients.length}</span>
              </button>

              {!isCollapsed && (
                <div className="ml-4 space-y-0.5 mt-0.5">
                  {group.clients.map((client) => (
                    <ClientLink key={client.id} client={client} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Ungrouped clients */}
        {ungroupedClients.map((client) => (
          <ClientLink key={client.id} client={client} />
        ))}
      </div>

      {/* Bottom nav */}
      <div className="p-3 border-t border-white/10 space-y-0.5">
        <Link
          href="/scripts"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
            pathname === "/scripts"
              ? "bg-rm-orange text-white font-medium"
              : "text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          <FileCode2 className="w-4 h-4" />
          Scripts
        </Link>
        <Link
          href="/settings"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
            pathname === "/settings"
              ? "bg-rm-orange text-white font-medium"
              : "text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          <Settings className="w-4 h-4" />
          Instellingen
        </Link>
      </div>
    </aside>
  );
}
