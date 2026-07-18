"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckCircle2, XCircle, Loader2, ExternalLink, Copy, Check, Eye, EyeOff, Building2, FolderPlus, Trash2, Pencil, Plus, X, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAllClients, saveApiClients, type Client } from "@/lib/clients";
import { getVisibleClientIds, setVisibleClientIds } from "@/lib/visible-clients";
import {
  loadClientGroups, createGroup, renameGroup, deleteGroup,
  addClientToGroup, removeClientFromGroup,
  type GroupWithMembers,
} from "@/lib/client-groups";

interface ConnectionStatus {
  googleAds: { configured: boolean; hasManagerId: boolean };
  metaAds: { configured: boolean; hasAppCredentials: boolean };
  anyConnected: boolean;
}

function StatusBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600">
      <CheckCircle2 className="w-4 h-4" /> Verbonden
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <XCircle className="w-4 h-4" /> Niet geconfigureerd
    </span>
  );
}

function EnvVar({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <code
      onClick={() => {
        navigator.clipboard.writeText(name);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded text-[11px] font-mono text-rm-gray cursor-pointer hover:bg-gray-200 transition-colors"
    >
      {name}
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
    </code>
  );
}

function ClientVisibilitySection() {
  const [allClients, setAllClients] = useState<Client[]>(() => getAllClients());
  const [visibleIds, setVisible] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setVisible(getVisibleClientIds());
    // Re-read when API clients are saved (e.g. after "Verbinding testen")
    function onClientsChanged() {
      const updated = getAllClients();
      setAllClients(updated);
      setVisible(getVisibleClientIds());
    }
    window.addEventListener("clients-changed", onClientsChanged);
    return () => window.removeEventListener("clients-changed", onClientsChanged);
  }, []);

  function toggle(clientId: string) {
    const updated = visibleIds.includes(clientId)
      ? visibleIds.filter((id) => id !== clientId)
      : [...visibleIds, clientId];
    setVisible(updated);
    setVisibleClientIds(updated);
    window.dispatchEvent(new Event("visible-clients-changed"));
  }

  function selectAll() {
    const all = filtered.map((c) => c.id);
    const updated = [...new Set([...visibleIds, ...all])];
    setVisible(updated);
    setVisibleClientIds(updated);
    window.dispatchEvent(new Event("visible-clients-changed"));
  }

  function selectNone() {
    const filteredIds = new Set(filtered.map((c) => c.id));
    const updated = visibleIds.filter((id) => !filteredIds.has(id));
    setVisible(updated);
    setVisibleClientIds(updated);
    window.dispatchEvent(new Event("visible-clients-changed"));
  }

  const filtered = allClients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );
  const visibleCount = allClients.filter((c) => visibleIds.includes(c.id)).length;

  return (
    <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-rm-blue text-base">Klanten in sidebar</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Selecteer welke klanten zichtbaar zijn in het menu. {visibleCount} van {allClients.length} zichtbaar.
            {allClients.length > 0 && allClients[0].source === "google-ads" && (
              <span className="text-green-600 font-medium ml-1">· Live vanuit Google Ads</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={selectAll}
            className="text-[11px] text-rm-blue hover:underline"
          >
            Alles aan
          </button>
          <span className="text-muted-foreground text-[11px]">·</span>
          <button
            onClick={selectNone}
            className="text-[11px] text-muted-foreground hover:underline"
          >
            Alles uit
          </button>
        </div>
      </div>

      {/* Search */}
      {allClients.length > 10 && (
        <div className="mb-3">
          <input
            type="text"
            placeholder="Zoek klant..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-rm-blue"
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto">
        {filtered.map((client) => {
          const isVisible = visibleIds.includes(client.id);
          return (
            <button
              key={client.id}
              onClick={() => toggle(client.id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
                isVisible
                  ? "bg-rm-blue/5 border border-rm-blue/20 text-rm-gray"
                  : "bg-gray-50 border border-transparent text-muted-foreground"
              }`}
            >
              {isVisible
                ? <Eye className="w-4 h-4 text-rm-blue shrink-0" />
                : <EyeOff className="w-4 h-4 text-gray-300 shrink-0" />
              }
              <Building2 className="w-3.5 h-3.5 shrink-0" />
              <span className={`truncate ${isVisible ? "font-medium" : ""}`}>
                {client.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Client Groups Management ──────────────────────────────────────────────

function ClientGroupsSection() {
  const [groups, setGroups] = useState<GroupWithMembers[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");

  const refresh = useCallback(async () => {
    const loaded = await loadClientGroups();
    setGroups(loaded);
    setAllClients(getAllClients());
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    await createGroup(newGroupName.trim());
    setNewGroupName("");
    await refresh();
    window.dispatchEvent(new Event("groups-changed"));
  }

  async function handleRename(groupId: string) {
    if (!editingName.trim()) return;
    await renameGroup(groupId, editingName.trim());
    setEditingId(null);
    await refresh();
    window.dispatchEvent(new Event("groups-changed"));
  }

  async function handleDelete(groupId: string) {
    await deleteGroup(groupId);
    await refresh();
    window.dispatchEvent(new Event("groups-changed"));
  }

  async function handleAddClient(clientId: string, groupId: string) {
    await addClientToGroup(clientId, groupId);
    setAddingToGroup(null);
    setClientSearch("");
    await refresh();
    window.dispatchEvent(new Event("groups-changed"));
  }

  async function handleRemoveClient(clientId: string, groupId: string) {
    await removeClientFromGroup(clientId, groupId);
    await refresh();
    window.dispatchEvent(new Event("groups-changed"));
  }

  // Clients that are already in a group
  const assignedClientIds = new Set(groups.flatMap((g) => g.clientIds));

  if (loading) return null;

  return (
    <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-rm-blue text-base">Klantgroepen</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Organiseer klanten in mapjes in de sidebar. {groups.length} groep{groups.length !== 1 ? "en" : ""} aangemaakt.
          </p>
        </div>
      </div>

      {/* Create new group */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
          placeholder="Nieuwe groep naam..."
          className="flex-1 text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-rm-blue"
        />
        <button
          onClick={handleCreateGroup}
          disabled={!newGroupName.trim()}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-rm-blue text-white hover:bg-rm-blue/90 disabled:opacity-50"
        >
          <FolderPlus className="w-3.5 h-3.5" /> Aanmaken
        </button>
      </div>

      {/* Groups list */}
      <div className="space-y-3">
        {groups.map((group) => {
          const groupClients = group.clientIds
            .map((id) => allClients.find((c) => c.id === id))
            .filter((c): c is Client => c !== undefined);

          return (
            <div key={group.id} className="border border-border rounded-lg p-4">
              {/* Group header */}
              <div className="flex items-center justify-between mb-2">
                {editingId === group.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleRename(group.id)}
                      className="flex-1 text-sm border border-border rounded px-2 py-1 focus:outline-none focus:border-rm-blue"
                      autoFocus
                    />
                    <button onClick={() => handleRename(group.id)} className="text-[11px] text-rm-blue font-medium">Opslaan</button>
                    <button onClick={() => setEditingId(null)} className="text-[11px] text-muted-foreground">Annuleer</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-rm-blue" />
                    <span className="text-sm font-semibold text-rm-gray">{group.name}</span>
                    <span className="text-[10px] text-muted-foreground">({groupClients.length})</span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  {editingId !== group.id && (
                    <button
                      onClick={() => { setEditingId(group.id); setEditingName(group.name); }}
                      className="p-1 rounded hover:bg-gray-100"
                    >
                      <Pencil className="w-3 h-3 text-muted-foreground" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(group.id)}
                    className="p-1 rounded hover:bg-red-50"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              </div>

              {/* Clients in this group */}
              <div className="space-y-1 mb-2">
                {groupClients.map((client) => (
                  <div
                    key={client.id}
                    className="flex items-center justify-between px-2 py-1.5 rounded bg-gray-50 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="truncate text-rm-gray">{client.name}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveClient(client.id, group.id)}
                      className="p-0.5 rounded hover:bg-red-50 shrink-0"
                      title="Verwijder uit groep"
                    >
                      <X className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                ))}
                {groupClients.length === 0 && (
                  <p className="text-[11px] text-muted-foreground px-2 py-1">Nog geen klanten in deze groep</p>
                )}
              </div>

              {/* Add client button */}
              {addingToGroup === group.id ? (
                <div className="mt-2">
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Zoek klant om toe te voegen..."
                    className="w-full text-xs border border-border rounded px-2 py-1.5 mb-1 focus:outline-none focus:border-rm-blue"
                    autoFocus
                  />
                  <div className="max-h-[150px] overflow-y-auto space-y-0.5">
                    {allClients
                      .filter((c) =>
                        !group.clientIds.includes(c.id) &&
                        c.name.toLowerCase().includes(clientSearch.toLowerCase())
                      )
                      .slice(0, 20)
                      .map((client) => (
                        <button
                          key={client.id}
                          onClick={() => handleAddClient(client.id, group.id)}
                          className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-rm-gray hover:bg-rm-blue/5 text-left"
                        >
                          <Plus className="w-3 h-3 text-rm-blue shrink-0" />
                          <span className="truncate">{client.name}</span>
                          {assignedClientIds.has(client.id) && (
                            <span className="ml-auto text-[9px] text-muted-foreground shrink-0">al in groep</span>
                          )}
                        </button>
                      ))}
                  </div>
                  <button
                    onClick={() => { setAddingToGroup(null); setClientSearch(""); }}
                    className="text-[11px] text-muted-foreground mt-1"
                  >
                    Sluiten
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingToGroup(group.id)}
                  className="flex items-center gap-1 text-[11px] text-rm-blue hover:underline mt-1"
                >
                  <Plus className="w-3 h-3" /> Klant toevoegen
                </button>
              )}
            </div>
          );
        })}

        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nog geen groepen. Maak een groep aan om klanten te bundelen.
          </p>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testingGoogle, setTestingGoogle] = useState(false);
  const [testingMeta, setTestingMeta] = useState(false);
  const [googleResult, setGoogleResult] = useState<string | null>(null);
  const [metaResult, setMetaResult] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/connections")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  async function testGoogle() {
    setTestingGoogle(true);
    setGoogleResult(null);
    try {
      const res = await fetch("/api/google-ads?action=customers");
      const data = await res.json();
      if (data.error) {
        setGoogleResult(`Fout: ${data.error}`);
      } else if (data.customers) {
        // Save accounts as selectable clients
        const apiClients: Client[] = data.customers.map((c: { customerId: string; descriptiveName: string }) => ({
          id: `gads-${c.customerId}`,
          name: c.descriptiveName || c.customerId,
          googleAdsCustomerId: c.customerId,
          source: "google-ads" as const,
        }));
        saveApiClients(apiClients);
        setGoogleResult(`Verbonden! ${data.customers.length} account(s) gevonden en beschikbaar als klanten.`);
      }
    } catch (e) {
      setGoogleResult(`Verbinding mislukt: ${e instanceof Error ? e.message : "Onbekende fout"}`);
    }
    setTestingGoogle(false);
  }

  async function testMeta() {
    setTestingMeta(true);
    setMetaResult(null);
    try {
      const res = await fetch("/api/meta-ads?action=accounts");
      const data = await res.json();
      if (data.error) {
        setMetaResult(`Fout: ${data.error}`);
      } else if (data.accounts) {
        setMetaResult(`Verbonden! ${data.accounts.length} ad account(s) gevonden: ${data.accounts.map((a: { name: string }) => a.name).join(", ")}`);
      }
    } catch (e) {
      setMetaResult(`Verbinding mislukt: ${e instanceof Error ? e.message : "Onbekende fout"}`);
    }
    setTestingMeta(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-rm-blue" />
      </div>
    );
  }

  const googleConnected = status?.googleAds.configured ?? false;
  const metaConnected = status?.metaAds.configured ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-rm-blue">Instellingen</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          API koppelingen en dashboard configuratie. Credentials worden ingesteld via{" "}
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">.env.local</code>
        </p>
      </div>

      {/* Overall status */}
      {!status?.anyConnected && (
        <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-rm-blue font-medium mb-1">Dashboard draait op demo data</p>
          <p className="text-xs text-muted-foreground">
            Configureer de API keys in <code className="font-mono">.env.local</code> om live data te gebruiken.
            Kopieer <code className="font-mono">.env.example</code> als startpunt.
          </p>
        </div>
      )}

      {/* ── Client Visibility ──────────────────────────────── */}
      <ClientVisibilitySection />

      {/* ── Client Groups ──────────────────────────────────── */}
      <ClientGroupsSection />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Google Ads ──────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-rm-blue text-base">Google Ads API</h3>
            <StatusBadge connected={googleConnected} />
          </div>

          {googleConnected ? (
            <div className="space-y-4">
              <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800 font-medium">Credentials geconfigureerd</p>
                <p className="text-xs text-green-700 mt-1">
                  {status?.googleAds.hasManagerId
                    ? "MCC Manager ID is ingesteld — je kunt meerdere klantaccounts benaderen."
                    : "Geen MCC Manager ID — alleen direct gekoppelde accounts beschikbaar."}
                </p>
              </div>

              <Button
                onClick={testGoogle}
                variant="outline"
                className="w-full gap-2"
                disabled={testingGoogle}
              >
                {testingGoogle ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Verbinding testen
              </Button>

              {googleResult && (
                <div className={`px-4 py-3 rounded-lg text-sm ${
                  googleResult.startsWith("Verbonden")
                    ? "bg-green-50 border border-green-200 text-green-800"
                    : "bg-red-50 border border-red-200 text-red-800"
                }`}>
                  {googleResult}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Voeg de volgende variabelen toe aan je <code className="font-mono text-xs">.env.local</code>:
              </p>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <EnvVar name="GOOGLE_ADS_DEVELOPER_TOKEN" />
                  <span className="text-[10px] text-muted-foreground">Verplicht</span>
                </div>
                <div className="flex items-center justify-between">
                  <EnvVar name="GOOGLE_ADS_CLIENT_ID" />
                  <span className="text-[10px] text-muted-foreground">Verplicht</span>
                </div>
                <div className="flex items-center justify-between">
                  <EnvVar name="GOOGLE_ADS_CLIENT_SECRET" />
                  <span className="text-[10px] text-muted-foreground">Verplicht</span>
                </div>
                <div className="flex items-center justify-between">
                  <EnvVar name="GOOGLE_ADS_REFRESH_TOKEN" />
                  <span className="text-[10px] text-muted-foreground">Verplicht</span>
                </div>
                <div className="flex items-center justify-between">
                  <EnvVar name="GOOGLE_ADS_MANAGER_CUSTOMER_ID" />
                  <span className="text-[10px] text-muted-foreground">Optioneel (MCC)</span>
                </div>
              </div>

              <div className="border-t border-border pt-4 space-y-2">
                <p className="text-xs font-semibold text-rm-gray">Hoe kom je aan deze keys?</p>
                <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                  <li>
                    Ga naar{" "}
                    <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" className="text-rm-blue hover:underline inline-flex items-center gap-0.5">
                      Google Cloud Console <ExternalLink className="w-3 h-3" />
                    </a>{" "}
                    en maak een OAuth2 Client ID aan (type: Web application)
                  </li>
                  <li>
                    Ga naar{" "}
                    <a href="https://ads.google.com/aw/apicenter" target="_blank" rel="noopener" className="text-rm-blue hover:underline inline-flex items-center gap-0.5">
                      Google Ads API Center <ExternalLink className="w-3 h-3" />
                    </a>{" "}
                    voor je Developer Token
                  </li>
                  <li>
                    Genereer een Refresh Token via de{" "}
                    <a href="https://developers.google.com/oauthplayground/" target="_blank" rel="noopener" className="text-rm-blue hover:underline inline-flex items-center gap-0.5">
                      OAuth Playground <ExternalLink className="w-3 h-3" />
                    </a>{" "}
                    met scope <code className="font-mono text-[10px]">https://www.googleapis.com/auth/adwords</code>
                  </li>
                  <li>Kopieer alles naar <code className="font-mono">.env.local</code> en herstart de dev server</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* ── Meta Ads ────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-rm-blue text-base">Meta Ads API</h3>
            <StatusBadge connected={metaConnected} />
          </div>

          {metaConnected ? (
            <div className="space-y-4">
              <div className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800 font-medium">Access Token geconfigureerd</p>
                <p className="text-xs text-green-700 mt-1">
                  {status?.metaAds.hasAppCredentials
                    ? "App ID en Secret zijn ingesteld — token kan automatisch verlengd worden."
                    : "Geen App ID/Secret — token verloopt na ~60 dagen en moet handmatig vernieuwd worden."}
                </p>
              </div>

              <Button
                onClick={testMeta}
                variant="outline"
                className="w-full gap-2"
                disabled={testingMeta}
              >
                {testingMeta ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Verbinding testen
              </Button>

              {metaResult && (
                <div className={`px-4 py-3 rounded-lg text-sm ${
                  metaResult.startsWith("Verbonden")
                    ? "bg-green-50 border border-green-200 text-green-800"
                    : "bg-red-50 border border-red-200 text-red-800"
                }`}>
                  {metaResult}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Voeg de volgende variabelen toe aan je <code className="font-mono text-xs">.env.local</code>:
              </p>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <EnvVar name="META_ADS_ACCESS_TOKEN" />
                  <span className="text-[10px] text-muted-foreground">Verplicht</span>
                </div>
                <div className="flex items-center justify-between">
                  <EnvVar name="META_ADS_APP_ID" />
                  <span className="text-[10px] text-muted-foreground">Optioneel (token refresh)</span>
                </div>
                <div className="flex items-center justify-between">
                  <EnvVar name="META_ADS_APP_SECRET" />
                  <span className="text-[10px] text-muted-foreground">Optioneel (token refresh)</span>
                </div>
              </div>

              <div className="border-t border-border pt-4 space-y-2">
                <p className="text-xs font-semibold text-rm-gray">Hoe kom je aan deze keys?</p>
                <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                  <li>
                    Ga naar{" "}
                    <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener" className="text-rm-blue hover:underline inline-flex items-center gap-0.5">
                      Meta for Developers <ExternalLink className="w-3 h-3" />
                    </a>{" "}
                    en maak een app aan (type: Business)
                  </li>
                  <li>Voeg de Marketing API product toe aan je app</li>
                  <li>
                    Genereer een User Access Token via de{" "}
                    <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener" className="text-rm-blue hover:underline inline-flex items-center gap-0.5">
                      Graph API Explorer <ExternalLink className="w-3 h-3" />
                    </a>{" "}
                    met permissions: <code className="font-mono text-[10px]">ads_read, ads_management</code>
                  </li>
                  <li>Wissel het token om voor een long-lived token (geldig ~60 dagen)</li>
                  <li>Kopieer alles naar <code className="font-mono">.env.local</code> en herstart de dev server</li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* ── LinkedIn Ads ────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-rm-blue text-base">LinkedIn Ads API</h3>
            <span className="text-[11px] text-muted-foreground px-2 py-0.5 rounded-full bg-gray-100">Via .env.local</span>
          </div>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Het LinkedIn-datamodel en de sync-laag staan klaar. Voeg de volgende variabelen toe aan je{" "}
              <code className="font-mono text-xs">.env.local</code> om de koppeling te activeren:
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <EnvVar name="LINKEDIN_CLIENT_ID" />
                <span className="text-[10px] text-muted-foreground">Verplicht</span>
              </div>
              <div className="flex items-center justify-between">
                <EnvVar name="LINKEDIN_CLIENT_SECRET" />
                <span className="text-[10px] text-muted-foreground">Verplicht</span>
              </div>
              <div className="flex items-center justify-between">
                <EnvVar name="LINKEDIN_REFRESH_TOKEN" />
                <span className="text-[10px] text-muted-foreground">Verplicht</span>
              </div>
            </div>
            <div className="border-t border-border pt-4 space-y-2">
              <p className="text-xs font-semibold text-rm-gray">Hoe kom je aan deze keys?</p>
              <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li>
                  Maak een app aan in het{" "}
                  <a href="https://www.linkedin.com/developers/apps" target="_blank" rel="noopener" className="text-rm-blue hover:underline inline-flex items-center gap-0.5">
                    LinkedIn Developer Portal <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
                <li>Vraag toegang aan tot de Advertising API (Marketing Developer Platform)</li>
                <li>Genereer via OAuth2 een refresh token met scope <code className="font-mono text-[10px]">r_ads, r_ads_reporting</code></li>
                <li>Kopieer alles naar <code className="font-mono">.env.local</code> en herstart de dev server</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      {/* Architecture info */}
      <div className="bg-white rounded-xl border border-border p-6 shadow-sm">
        <h3 className="font-semibold text-rm-blue text-base mb-3">Architectuur</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-muted-foreground">
          <div className="space-y-1">
            <p className="font-semibold text-rm-gray">API Calls</p>
            <p>Alle API calls gaan via Next.js server-side routes. Credentials verlaten nooit de server.</p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-rm-gray">Data Flow</p>
            <p>Google Ads + Meta → Unified Adapter → ClientHistoricalData → Forecast Engine → Dashboard</p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-rm-gray">Fallback</p>
            <p>Zonder API keys draait het dashboard op deterministische demo data. Geen data gaat verloren.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
