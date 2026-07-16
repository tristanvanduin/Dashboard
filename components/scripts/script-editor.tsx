"use client";

import { useState } from "react";
import { X, Save, Check } from "lucide-react";
import { supabase, type Script } from "@/lib/supabase";

interface ScriptEditorProps {
  script?: Script | null;
  onSaved: () => void;
  onCancel: () => void;
}

export function ScriptEditor({ script, onSaved, onCancel }: ScriptEditorProps) {
  const [title, setTitle] = useState(script?.title ?? "");
  const [description, setDescription] = useState(script?.description ?? "");
  const [code, setCode] = useState(script?.code ?? "");
  const [tagsInput, setTagsInput] = useState(script?.tags.join(", ") ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isEdit = !!script;

  async function handleSave() {
    if (!supabase || !title.trim() || !code.trim()) return;
    setSaving(true);

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    const record = {
      title: title.trim(),
      description: description.trim() || null,
      code: code.trim(),
      tags,
      updated_at: new Date().toISOString(),
    };

    if (isEdit) {
      await supabase.from("scripts").update(record).eq("id", script.id);
    } else {
      await supabase.from("scripts").insert(record);
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onSaved();
    }, 500);
  }

  return (
    <div className="bg-white rounded-xl border border-rm-blue/20 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-rm-blue">
          {isEdit ? "Script bewerken" : "Nieuw script"}
        </h3>
        <button onClick={onCancel} className="p-1 rounded-md hover:bg-gray-100">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-medium text-rm-gray block mb-1">Titel *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Bijv. Budget Pacing Script"
            className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-rm-blue"
          />
        </div>

        <div>
          <label className="text-[11px] font-medium text-rm-gray block mb-1">Beschrijving</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Korte beschrijving van wat het script doet"
            className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-rm-blue"
          />
        </div>

        <div>
          <label className="text-[11px] font-medium text-rm-gray block mb-1">Tags</label>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="budget, pacing, automated (komma-gescheiden)"
            className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-rm-blue"
          />
        </div>

        <div>
          <label className="text-[11px] font-medium text-rm-gray block mb-1">Code *</label>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="// Plak je Google Ads script hier..."
            rows={12}
            className="w-full text-sm font-mono border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-rm-blue resize-y bg-gray-50"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-rm-gray transition-colors"
          >
            Annuleren
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim() || !code.trim()}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
              saved
                ? "bg-green-500 text-white"
                : "bg-rm-blue text-white hover:bg-rm-blue/90"
            } disabled:opacity-50`}
          >
            {saved ? (
              <><Check className="w-3.5 h-3.5" /> Opgeslagen</>
            ) : (
              <><Save className="w-3.5 h-3.5" /> {saving ? "Opslaan..." : "Opslaan"}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
