"use client";

import { Copy, Check, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Script } from "@/lib/supabase";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "vandaag";
  if (days === 1) return "gisteren";
  if (days < 30) return `${days} dagen geleden`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 maand geleden" : `${months} maanden geleden`;
}

export function ScriptCard({
  script,
  onEdit,
  onDelete,
}: {
  script: Script;
  onEdit: (script: Script) => void;
  onDelete: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  function copyCode() {
    navigator.clipboard.writeText(script.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-rm-gray truncate">{script.title}</h3>
          {script.description && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
              {script.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={copyCode}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
            title="Kopieer code"
          >
            {copied
              ? <Check className="w-3.5 h-3.5 text-green-500" />
              : <Copy className="w-3.5 h-3.5 text-muted-foreground" />
            }
          </button>
          <button
            onClick={() => onEdit(script)}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
            title="Bewerken"
          >
            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={() => onDelete(script.id)}
            className="p-1.5 rounded-md hover:bg-red-50 transition-colors"
            title="Verwijderen"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
          </button>
        </div>
      </div>

      {/* Tags */}
      {script.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {script.tags.map((tag) => (
            <span
              key={tag}
              className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-rm-blue/10 text-rm-blue"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Code preview */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <pre
          className={`text-[11px] bg-gray-50 rounded-lg p-3 font-mono text-rm-gray overflow-x-auto ${
            expanded ? "" : "max-h-[80px] overflow-hidden"
          }`}
        >
          {script.code}
        </pre>
        {!expanded && script.code.split("\n").length > 4 && (
          <p className="text-[10px] text-rm-blue mt-1">
            Klik om uit te klappen ({script.code.split("\n").length} regels)
          </p>
        )}
      </button>

      {/* Footer */}
      <p className="text-[10px] text-muted-foreground mt-3">
        Bijgewerkt {timeAgo(script.updated_at)}
      </p>
    </div>
  );
}
