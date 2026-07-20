"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  FolderPlus, Upload, Trash2, Download, FileText, FileSpreadsheet,
  Image as ImageIcon, File, FolderOpen, Plus, X, Loader2, AlertCircle, CheckCircle2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SopError } from "../insights/sop-trigger-buttons";

/**
 * Auto-parse a sprint planning CSV into sprint_hypotheses + sprint_items.
 * Reuses the same CSV format as the sprint-planning component's importCSV.
 */
async function parseSprintCSV(file: File, clientId: string, sb: SupabaseClient) {
  const text = await file.text();
  const lines = text.split("\n");
  if (lines.length < 2) return;

  const headers = lines[0].split(",").map((h) => h.trim());

  // Parse CSV with quote handling
  const rows: Record<string, string>[] = [];
  let currentRow: string[] = [];
  let inQuote = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!inQuote) currentRow = [];

    let field = inQuote ? currentRow[currentRow.length - 1] + "\n" : "";
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === "," && !inQuote) { currentRow.push(field); field = ""; }
      else { field += ch; }
    }
    if (inQuote) { currentRow[currentRow.length - 1] = field; continue; }
    currentRow.push(field);

    const obj: Record<string, string> = {};
    for (let k = 0; k < headers.length; k++) obj[headers[k]] = (currentRow[k] || "").trim();
    if (obj["Taak"] || obj["taak"] || obj["Task"]) rows.push(obj);
  }

  const statusMap: Record<string, string> = {
    "Klaar": "done", "To Do": "todo", "in Planning": "in_planning",
    "On going": "ongoing", "Backlog / Verlopen": "expired", "Backlog": "backlog", "Verlopen": "expired",
  };

  // Detect format: hypotheses-only (has "Hypothese" column but no "Taak") or full sprint items
  const hasTaskCol = headers.some((h) => ["Taak", "taak", "Task"].includes(h));
  const hasHypCol = headers.some((h) => ["Hypothese", "hypothese"].includes(h));

  if (!hasTaskCol && hasHypCol) {
    // ── Hypotheses-only format ──
    // Each row is a hypothesis, not a task. Import as hypotheses with a placeholder task.
    const hypRows = rows.length > 0 ? rows : [];
    // Re-parse: accept all rows that have a Hypothese value (not requiring Taak)
    const allRows: Record<string, string>[] = [];
    let cr2: string[] = [];
    let iq2 = false;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!iq2) cr2 = [];
      let f2 = iq2 ? cr2[cr2.length - 1] + "\n" : "";
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (ch === '"') { iq2 = !iq2; }
        else if (ch === "," && !iq2) { cr2.push(f2); f2 = ""; }
        else { f2 += ch; }
      }
      if (iq2) { cr2[cr2.length - 1] = f2; continue; }
      cr2.push(f2);
      const o: Record<string, string> = {};
      for (let k = 0; k < headers.length; k++) o[headers[k]] = (cr2[k] || "").trim();
      if (o["Hypothese"] || o["hypothese"]) allRows.push(o);
    }

    let count = 0;
    for (const row of allRows) {
      const hypText = (row["Hypothese"] || row["hypothese"] || "").replace(/<|>/g, "").trim();
      if (!hypText) continue;

      const metrics = (row["Metrics"] || row["metrics"] || "").replace(/<|>/g, "").replace(/#N\/A/g, "").trim() || null;
      const timeframe = (row["Looptijd"] || row["looptijd"] || row["Looptijd tot Beoordeling"] || "").replace(/<|>/g, "").replace(/#N\/A/g, "").trim() || null;
      const weekStr = row["Meten vanaf week:"] || row["Week"] || "";
      const weekNum = parseInt(weekStr.replace(/#N\/A/g, "")) || null;

      const { data: hyp } = await sb
        .from("sprint_hypotheses")
        .insert({
          client_id: clientId,
          hypothesis: hypText,
          measurement_metric: metrics,
          timeframe: timeframe,
          status: "accepted",
          accepted_at: new Date().toISOString(),
        })
        .select("id").single();

      if (!hyp) continue;

      // Create a placeholder task so the hypothesis shows in the sprint board
      await sb.from("sprint_items").insert({
        client_id: clientId,
        hypothesis_id: hyp.id,
        week_number: weekNum,
        task: `Uitvoeren: ${hypText.slice(0, 80)}${hypText.length > 80 ? "..." : ""}`,
        status: "todo",
        owner: "Ranking Masters",
        metrics: metrics,
        review_timeframe: timeframe,
      });
      count++;
    }

    console.log(`[parseSprintCSV] Imported ${count} hypotheses (hypotheses-only format)`);
    return;
  }

  // ── Full sprint items format (with Taak column) ──
  if (rows.length === 0) return;

  // Group by hypothesis
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const hyp = row["Hypothese"] || row["hypothese"] || "(geen hypothese)";
    if (!groups.has(hyp)) groups.set(hyp, []);
    groups.get(hyp)!.push(row);
  }

  for (const [hypothesis, tasks] of groups) {
    const allDone = tasks.every((t) => statusMap[t["Status"]] === "done");
    const metrics = tasks[0]["Metrics"] || tasks[0]["metrics"] || null;
    const timeframe = tasks[0]["Looptijd tot Beoordeling"] || tasks[0]["looptijd"] || null;

    const { data: hyp } = await sb
      .from("sprint_hypotheses")
      .insert({
        client_id: clientId,
        hypothesis: hypothesis === "(geen hypothese)" ? "Import: geen hypothese" : hypothesis,
        measurement_metric: metrics, timeframe,
        status: allDone ? "completed" : "accepted",
        accepted_at: new Date().toISOString(),
      })
      .select("id").single();

    if (!hyp) continue;

    const sprintItems = tasks.map((t) => ({
      client_id: clientId,
      hypothesis_id: hyp.id,
      week_number: t["Week"] || t["week"] ? parseInt(t["Week"] || t["week"]) : null,
      task: t["Taak"] || t["taak"] || t["Task"] || "(geen taak)",
      status: statusMap[t["Status"] || t["status"]] || "todo",
      owner: t["Verantwoordelijke"] || t["verantwoordelijke"] || "Ranking Masters",
      metrics: t["Metrics"] || t["metrics"] || null,
      review_timeframe: t["Looptijd tot Beoordeling"] || t["looptijd"] || null,
    }));

    await sb.from("sprint_items").insert(sprintItems);
  }

  console.log(`[parseSprintCSV] Imported ${rows.length} items from ${groups.size} hypotheses`);
}

interface ClientFolder {
  id: string;
  client_id: string;
  name: string;
  created_at: string;
}

interface ClientFile {
  id: string;
  client_id: string;
  folder: string;
  file_name: string;
  file_size: number;
  content_type: string | null;
  storage_path: string;
  uploaded_at: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "vandaag";
  if (days === 1) return "gisteren";
  if (days < 30) return `${days}d geleden`;
  return new Date(dateStr).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

function FileIcon({ contentType, fileName }: { contentType: string | null; fileName: string }) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (contentType?.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext ?? ""))
    return <ImageIcon className="w-4 h-4 text-purple-500" />;
  if (["pdf"].includes(ext ?? ""))
    return <FileText className="w-4 h-4 text-red-500" />;
  if (["xls", "xlsx", "csv"].includes(ext ?? ""))
    return <FileSpreadsheet className="w-4 h-4 text-green-600" />;
  if (["doc", "docx"].includes(ext ?? ""))
    return <FileText className="w-4 h-4 text-rm-blue" />;
  return <File className="w-4 h-4 text-muted-foreground" />;
}

// Default folders for new clients
const DEFAULT_FOLDERS = ["SOP's", "Briefings", "Sprintplanning", "Rapportages", "Overig"];

export function ClientFiles({ clientId, sopErrors, onDismissError, onDismissAllErrors }: {
  clientId: string;
  sopErrors?: SopError[];
  onDismissError?: (id: string) => void;
  onDismissAllErrors?: () => void;
}) {
  const [folders, setFolders] = useState<ClientFolder[]>([]);
  const [files, setFiles] = useState<ClientFile[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Onthoudt voor welke klant we de standaardmappen al hebben aangemaakt, zodat een snelle
  // dubbele mount (React strict mode) niet twee keer dezelfde set inschiet → dubbele mappen.
  const seededClientRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }

    const [{ data: foldersData }, { data: filesData }] = await Promise.all([
      supabase.from("client_folders").select("*").eq("client_id", clientId).order("name"),
      supabase.from("client_files").select("*").eq("client_id", clientId).order("uploaded_at", { ascending: false }),
    ]);

    let loadedFolders = foldersData ?? [];

    // Ensure all default folders exist (adds missing ones for existing clients too).
    // Guard tegen dubbele seeding: maximaal één keer per klant binnen deze mount.
    const existingNames = new Set(loadedFolders.map((f: { name: string }) => f.name));
    const missing = DEFAULT_FOLDERS.filter((name) => !existingNames.has(name));
    if (missing.length > 0 && seededClientRef.current !== clientId) {
      seededClientRef.current = clientId;
      const inserts = missing.map((name) => ({ client_id: clientId, name }));
      await supabase.from("client_folders").insert(inserts);
      const { data: newFolders } = await supabase
        .from("client_folders").select("*").eq("client_id", clientId).order("name");
      loadedFolders = newFolders ?? [];
    }

    // Ontdubbel op naam (verdedig tegen historisch dubbel geseede mappen); bestanden
    // verwijzen op mapnaam, dus één zichtbare map per naam is altijd correct.
    const seenNames = new Set<string>();
    loadedFolders = loadedFolders.filter((f: { name: string }) => {
      if (seenNames.has(f.name)) return false;
      seenNames.add(f.name);
      return true;
    });

    setFolders(loadedFolders);
    setFiles(filesData ?? []);
    if (!activeFolder && loadedFolders.length > 0) {
      setActiveFolder(loadedFolders[0].name);
    }
    setLoading(false);
  }, [clientId, activeFolder]);

  useEffect(() => { refresh(); }, [refresh]);

  const activeFolderFiles = files.filter((f) => f.folder === activeFolder);
  const fileCounts = new Map<string, number>();
  for (const f of files) {
    fileCounts.set(f.folder, (fileCounts.get(f.folder) ?? 0) + 1);
  }

  async function handleCreateFolder() {
    if (!supabase || !newFolderName.trim()) return;
    await supabase.from("client_folders").insert({ client_id: clientId, name: newFolderName.trim() });
    setNewFolderName("");
    setShowNewFolder(false);
    await refresh();
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!supabase || !e.target.files?.length) return;
    setUploading(true);
    setUploadError(null);

    const errors: string[] = [];

    for (const file of Array.from(e.target.files)) {
      // Sanitize filename: remove special chars, replace spaces with underscores
      const safeName = file.name
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // strip accents
        .replace(/[^a-zA-Z0-9._-]/g, "_")                  // replace special chars
        .replace(/_+/g, "_");                                // collapse multiple underscores
      const storagePath = `${clientId}/${activeFolder}/${Date.now()}-${safeName}`;

      const { error: storageErr } = await supabase.storage
        .from("client-files")
        .upload(storagePath, file);

      if (storageErr) {
        errors.push(`${file.name}: ${storageErr.message}`);
        continue;
      }

      const { error: dbErr } = await supabase.from("client_files").insert({
        client_id: clientId,
        folder: activeFolder,
        file_name: file.name,
        file_size: file.size,
        content_type: file.type,
        storage_path: storagePath,
      });

      if (dbErr) {
        errors.push(`${file.name}: ${dbErr.message}`);
      }

      // Auto-parse sprint planning CSVs into sprint_items
      if (activeFolder === "Sprintplanning" && file.name.toLowerCase().endsWith(".csv")) {
        try {
          await parseSprintCSV(file, clientId, supabase);
          console.log(`[client-files] Auto-parsed sprint planning: ${file.name}`);
        } catch (parseErr) {
          console.error(`[client-files] Sprint parse failed for ${file.name}:`, parseErr);
          errors.push(`${file.name}: sprint import mislukt — ${parseErr instanceof Error ? parseErr.message : "onbekende fout"}`);
        }
      }
    }

    if (errors.length > 0) {
      setUploadError(errors.join("; "));
    }

    e.target.value = "";
    setUploading(false);
    await refresh();
  }

  async function handleDownload(file: ClientFile) {
    if (!supabase) return;
    const { data } = await supabase.storage
      .from("client-files")
      .createSignedUrl(file.storage_path, 60);

    if (data?.signedUrl) {
      window.open(data.signedUrl, "_blank");
    }
  }

  async function handleDeleteFile(fileId: string) {
    if (!supabase) return;
    const file = files.find((f) => f.id === fileId);
    if (file) {
      await supabase.storage.from("client-files").remove([file.storage_path]);
      await supabase.from("client_files").delete().eq("id", fileId);
    }
    setDeleteConfirm(null);
    await refresh();
  }

  async function handleDeleteFolder(folderName: string) {
    if (!supabase) return;
    // Delete all files in the folder
    const folderFiles = files.filter((f) => f.folder === folderName);
    if (folderFiles.length > 0) {
      await supabase.storage.from("client-files").remove(folderFiles.map((f) => f.storage_path));
      await supabase.from("client_files").delete().eq("client_id", clientId).eq("folder", folderName);
    }
    await supabase.from("client_folders").delete().eq("client_id", clientId).eq("name", folderName);

    if (activeFolder === folderName) setActiveFolder("");
    await refresh();
  }

  if (!supabase) return null;

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-border p-8 shadow-sm flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-rm-blue" />
      </div>
    );
  }

  const errors = sopErrors ?? [];

  return (
    <div className="space-y-4">
      {/* SOP Error Banner */}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-red-700">
                  {errors.length} SOP analyse{errors.length !== 1 ? "s" : ""} mislukt
                </h3>
                <div className="mt-2 space-y-2">
                  {errors.map((err) => (
                    <div key={err.id} className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-red-600">{err.label}</span>
                      <span className="text-red-500 truncate max-w-[400px]">{err.error}</span>
                      <span className="text-red-400 text-[10px]">
                        {new Date(err.timestamp).toLocaleString("nl-NL", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
                      </span>
                      {onDismissError && (
                        <button
                          onClick={() => onDismissError(err.id)}
                          className="ml-auto shrink-0 p-1 rounded hover:bg-red-100 transition-colors"
                          title="Markeer als afgehandeld"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-red-400 hover:text-red-600" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {errors.length > 1 && onDismissAllErrors && (
              <button
                onClick={onDismissAllErrors}
                className="text-[10px] font-medium text-red-500 hover:text-red-700 hover:underline shrink-0"
              >
                Alles afhandelen
              </button>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 pt-5 pb-4">
        <h3 className="text-sm font-semibold text-rm-blue uppercase tracking-wide">Bestanden</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          SOP's, rapportages en andere documenten per klant
        </p>
      </div>

      <div className="flex min-h-[300px]">
        {/* Folder sidebar */}
        <div className="w-48 border-r border-border bg-gray-50/50 p-2 space-y-0.5">
          {folders.map((folder) => {
            const count = fileCounts.get(folder.name) ?? 0;
            const isActive = activeFolder === folder.name;
            return (
              <button
                key={folder.id}
                onClick={() => setActiveFolder(folder.name)}
                className={`flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-xs transition-colors ${
                  isActive
                    ? "bg-rm-blue text-white font-medium"
                    : "text-rm-gray hover:bg-gray-100"
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate flex-1 text-left">{folder.name}</span>
                {count > 0 && (
                  <span className={`text-[9px] ${isActive ? "text-white/70" : "text-muted-foreground"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}

          {/* New folder */}
          {showNewFolder ? (
            <div className="p-1.5">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                placeholder="Mapnaam..."
                className="w-full text-[11px] border border-border rounded px-2 py-1.5 focus:outline-none focus:border-rm-blue"
                autoFocus
              />
              <div className="flex gap-1 mt-1">
                <button onClick={handleCreateFolder} className="text-[10px] text-rm-blue font-medium">Toevoegen</button>
                <button onClick={() => setShowNewFolder(false)} className="text-[10px] text-muted-foreground">Annuleer</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowNewFolder(true)}
              className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-lg text-[11px] text-muted-foreground hover:text-rm-blue hover:bg-gray-100 transition-colors"
            >
              <FolderPlus className="w-3 h-3" /> Nieuwe map
            </button>
          )}
        </div>

        {/* File list */}
        <div className="flex-1 p-4">
          {/* Upload bar */}
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-semibold text-rm-gray">
              {activeFolder || "Selecteer een map"}
            </h4>
            {activeFolder && (
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg bg-rm-blue text-white hover:bg-rm-blue/90 disabled:opacity-50"
                >
                  {uploading ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Uploaden...</>
                  ) : (
                    <><Upload className="w-3 h-3" /> Upload bestand</>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Upload error */}
          {uploadError && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
              <p className="text-[11px] text-red-700">Upload mislukt: {uploadError}</p>
              <button onClick={() => setUploadError(null)} className="text-[11px] text-muted-foreground ml-2">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Delete confirmation */}
          {deleteConfirm && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
              <p className="text-[11px] text-red-700">Bestand verwijderen?</p>
              <div className="flex gap-2">
                <button onClick={() => setDeleteConfirm(null)} className="text-[11px] text-muted-foreground">Annuleren</button>
                <button onClick={() => handleDeleteFile(deleteConfirm)} className="text-[11px] text-red-600 font-medium">Verwijder</button>
              </div>
            </div>
          )}

          {/* Files */}
          {activeFolderFiles.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                <File className="w-5 h-5 text-muted-foreground/30" />
              </div>
              <p className="text-xs text-muted-foreground">Geen bestanden in deze map</p>
              {activeFolder && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[11px] text-rm-blue hover:underline mt-2"
                >
                  Upload je eerste bestand
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {activeFolderFiles.map((file) => (
                <div
                  key={file.id}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <FileIcon contentType={file.content_type} fileName={file.file_name} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-rm-gray truncate">{file.file_name}</p>
                    <p className="text-[9px] text-muted-foreground">
                      {formatFileSize(file.file_size)} · {timeAgo(file.uploaded_at)}
                    </p>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleDownload(file)}
                      className="p-1.5 rounded-md hover:bg-white hover:shadow-sm"
                      title="Download"
                    >
                      <Download className="w-3 h-3 text-rm-blue" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(file.id)}
                      className="p-1.5 rounded-md hover:bg-red-50"
                      title="Verwijderen"
                    >
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
