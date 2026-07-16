"use client";

import { useState, useEffect, useCallback } from "react";
import { StickyNote, Plus, Pencil, Trash2, X, Save, Check } from "lucide-react";
import { supabase, type ClientNote } from "@/lib/supabase";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "zojuist";
  if (mins < 60) return `${mins}min geleden`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}u geleden`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "gisteren";
  if (days < 30) return `${days}d geleden`;
  return new Date(dateStr).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

const MAX_LINES = 4;

function NoteCard({
  note,
  isEditing,
  onEdit,
  onDelete,
}: {
  note: ClientNote;
  isEditing: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = note.content.split("\n");
  const isLong = lines.length > MAX_LINES || note.content.length > 200;
  const displayContent = !expanded && isLong
    ? lines.slice(0, MAX_LINES).join("\n") + (lines.length > MAX_LINES ? "..." : "")
    : note.content;

  return (
    <div
      className={`group relative rounded-lg transition-all ${
        isEditing
          ? "border border-rm-blue/20 bg-rm-blue/5"
          : "border border-border/50 hover:border-gray-300 bg-white"
      }`}
    >
      <div className="flex items-start gap-3 p-3.5">
        {/* Accent dot */}
        <div className="w-1.5 h-1.5 rounded-full bg-rm-blue/40 mt-1.5 shrink-0" />

        <div className="min-w-0 flex-1">
          {/* Title + timestamp on one line */}
          <div className="flex items-baseline gap-2 mb-1">
            {note.title && (
              <span className="text-xs font-semibold text-rm-gray">{note.title}</span>
            )}
            <span className="text-[9px] text-muted-foreground ml-auto shrink-0">{timeAgo(note.created_at)}</span>
          </div>

          {/* Content */}
          <p className="text-[11px] text-rm-gray/80 whitespace-pre-wrap leading-relaxed">{displayContent}</p>

          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-rm-blue hover:underline mt-1"
            >
              {expanded ? "Minder tonen" : "Meer tonen"}
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={onEdit} className="p-1 rounded hover:bg-gray-100" title="Bewerken">
            <Pencil className="w-3 h-3 text-muted-foreground" />
          </button>
          <button onClick={onDelete} className="p-1 rounded hover:bg-red-50" title="Verwijderen">
            <Trash2 className="w-3 h-3 text-red-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClientNotes({ clientId }: { clientId: string }) {
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const { data } = await supabase
      .from("client_notes")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    setNotes(data ?? []);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  function startEdit(note: ClientNote) {
    setEditingId(note.id);
    setTitle(note.title ?? "");
    setContent(note.content);
    setShowNew(false);
  }

  function startNew() {
    setShowNew(true);
    setEditingId(null);
    setTitle("");
    setContent("");
  }

  function cancelEdit() {
    setShowNew(false);
    setEditingId(null);
    setTitle("");
    setContent("");
  }

  async function handleSave() {
    if (!supabase || !content.trim()) return;
    setSaving(true);

    if (editingId) {
      await supabase.from("client_notes").update({
        title: title.trim() || null,
        content: content.trim(),
        updated_at: new Date().toISOString(),
      }).eq("id", editingId);
    } else {
      await supabase.from("client_notes").insert({
        client_id: clientId,
        title: title.trim() || null,
        content: content.trim(),
      });
    }

    setSaving(false);
    cancelEdit();
    fetchNotes();
  }

  async function handleDelete(id: string) {
    if (!supabase) return;
    await supabase.from("client_notes").delete().eq("id", id);
    setDeleteConfirm(null);
    fetchNotes();
  }

  if (!supabase) return null;

  return (
    <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <StickyNote className="w-4 h-4 text-rm-blue" />
          <h3 className="text-sm font-semibold text-rm-blue uppercase tracking-wide">Notities</h3>
          <span className="text-[10px] text-muted-foreground">({notes.length})</span>
        </div>
        {!showNew && !editingId && (
          <button
            onClick={startNew}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg bg-rm-blue/10 text-rm-blue hover:bg-rm-blue/20 transition-colors"
          >
            <Plus className="w-3 h-3" /> Nieuwe notitie
          </button>
        )}
      </div>

      {/* New/Edit form */}
      {(showNew || editingId) && (
        <div className="mb-4 bg-rm-blue/5 rounded-lg p-4 border border-rm-blue/10">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titel (optioneel)"
            className="w-full text-sm font-medium border-0 bg-transparent focus:outline-none placeholder:text-muted-foreground mb-2"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Notitie schrijven... (afspraken, strategie, gedachtes)"
            rows={3}
            className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-rm-blue resize-y"
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={cancelEdit} className="px-3 py-1.5 text-[11px] text-muted-foreground hover:text-rm-gray">
              Annuleren
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !content.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md bg-rm-blue text-white hover:bg-rm-blue/90 disabled:opacity-50"
            >
              <Save className="w-3 h-3" /> {saving ? "Opslaan..." : "Opslaan"}
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
          <p className="text-[11px] text-red-700">Notitie verwijderen?</p>
          <div className="flex gap-2">
            <button onClick={() => setDeleteConfirm(null)} className="text-[11px] text-muted-foreground">Annuleren</button>
            <button onClick={() => handleDelete(deleteConfirm)} className="text-[11px] text-red-600 font-medium">Verwijder</button>
          </div>
        </div>
      )}

      {/* Notes list */}
      {loading ? (
        <p className="text-[11px] text-muted-foreground py-4 text-center">Laden...</p>
      ) : notes.length === 0 && !showNew ? (
        <div className="flex flex-col items-center py-8 text-center">
          <div className="w-10 h-10 rounded-full bg-rm-blue/5 flex items-center justify-center mb-3">
            <StickyNote className="w-5 h-5 text-rm-blue/30" />
          </div>
          <p className="text-xs text-muted-foreground">Nog geen notities</p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">Leg afspraken, strategie of gedachtes vast</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              isEditing={editingId === note.id}
              onEdit={() => startEdit(note)}
              onDelete={() => setDeleteConfirm(note.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
