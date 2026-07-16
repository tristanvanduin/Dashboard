"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Plus, FileCode2, AlertCircle } from "lucide-react";
import { supabase, type Script } from "@/lib/supabase";
import { ScriptCard } from "./script-card";
import { ScriptEditor } from "./script-editor";

export function ScriptLibrary() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [editing, setEditing] = useState<Script | null | "new">(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchScripts = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const { data } = await supabase
      .from("scripts")
      .select("*")
      .order("updated_at", { ascending: false });
    setScripts(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchScripts(); }, [fetchScripts]);

  // Unique tags across all scripts
  const allTags = [...new Set(scripts.flatMap((s) => s.tags))].sort();

  // Filter
  const filtered = scripts.filter((s) => {
    const matchesSearch = !search ||
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      (s.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
      s.tags.some((t) => t.includes(search.toLowerCase()));
    const matchesTag = !activeTag || s.tags.includes(activeTag);
    return matchesSearch && matchesTag;
  });

  async function handleDelete(id: string) {
    if (!supabase) return;
    await supabase.from("scripts").delete().eq("id", id);
    setDeleteConfirm(null);
    fetchScripts();
  }

  if (!supabase) {
    return (
      <div className="bg-white rounded-xl border border-border p-8 shadow-sm text-center">
        <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
        <p className="text-sm text-rm-gray font-medium mb-1">Supabase niet geconfigureerd</p>
        <p className="text-[11px] text-muted-foreground">
          Voeg NEXT_PUBLIC_SUPABASE_URL en NEXT_PUBLIC_SUPABASE_ANON_KEY toe aan .env.local
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-rm-blue">Scriptbibliotheek</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Bewaar en organiseer je Google Ads scripts
          </p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-rm-blue text-white hover:bg-rm-blue/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Nieuw script
        </button>
      </div>

      {/* Search + tag filter */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op titel, beschrijving of tag..."
            className="w-full text-sm border border-border rounded-lg pl-9 pr-3 py-2.5 focus:outline-none focus:border-rm-blue"
          />
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveTag(null)}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-full transition-colors ${
                !activeTag
                  ? "bg-rm-blue text-white"
                  : "bg-gray-100 text-muted-foreground hover:bg-gray-200"
              }`}
            >
              Alles
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`text-[10px] font-medium px-2.5 py-1 rounded-full transition-colors ${
                  activeTag === tag
                    ? "bg-rm-blue text-white"
                    : "bg-gray-100 text-muted-foreground hover:bg-gray-200"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Editor */}
      {editing !== null && (
        <ScriptEditor
          script={editing === "new" ? null : editing}
          onSaved={() => { setEditing(null); fetchScripts(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
          <p className="text-sm text-red-700">Weet je zeker dat je dit script wilt verwijderen?</p>
          <div className="flex gap-2">
            <button
              onClick={() => setDeleteConfirm(null)}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-rm-gray"
            >
              Annuleren
            </button>
            <button
              onClick={() => handleDelete(deleteConfirm)}
              className="px-3 py-1.5 text-xs bg-red-500 text-white rounded-md hover:bg-red-600"
            >
              Verwijderen
            </button>
          </div>
        </div>
      )}

      {/* Script list */}
      {loading ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">Scripts laden...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <FileCode2 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {scripts.length === 0
              ? "Nog geen scripts opgeslagen"
              : "Geen scripts gevonden voor deze zoekopdracht"
            }
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((script) => (
            <ScriptCard
              key={script.id}
              script={script}
              onEdit={(s) => setEditing(s)}
              onDelete={(id) => setDeleteConfirm(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
