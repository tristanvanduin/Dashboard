"use client";

import { useEffect, useMemo, useState } from "react";
import { Beaker, Check, ChevronDown, ChevronUp, Loader2, Link2, X } from "lucide-react";
import type { InsightChannel } from "@/lib/insights/channel-of";

interface LinkedFinding {
  id: string;
  title: string;
  summary: string;
  severity: string;
}

interface LinkedRecommendation {
  id: string;
  route: string;
  object: string;
  handeling: string;
  meet_via: string;
}

interface LinkedTask {
  id: string;
  linked_recommendation_id: string;
  object: string;
  handeling: string;
  meet_via: string;
}

interface LinkedSprintItem {
  id: string;
  task: string;
  status: string;
  owner: string | null;
  metrics: string | null;
  review_timeframe: string | null;
}

interface HypothesisWorkflowItem {
  id: string;
  title: string;
  label: string;
  hypothesis: string;
  why_we_think_this: string;
  validation_or_exploitation_step: string;
  success_next_month: string;
  linked_primary_thread: string;
  linked_finding_ids: string[];
  linked_recommendation_ids: string[];
  linked_task_ids: string[];
  status: "pending" | "accepted" | "rejected";
  rejected_reason: string | null;
  accepted_into_sprint: boolean;
  linked_findings: LinkedFinding[];
  linked_recommendations: LinkedRecommendation[];
  linked_tasks: LinkedTask[];
  sprint_items: LinkedSprintItem[];
}

interface Payload {
  analysis_id: string | null;
  structured_row_id: string | null;
  structured_created_at: string | null;
  hypotheses: HypothesisWorkflowItem[];
}

interface Props {
  clientId: string;
  refreshKey?: number;
  onWorkflowChange?: () => void;
  /** Kanaal-filter. Dit block is de maand-workflow (Google-pijplijn); bij een ander kanaal toont het een eerlijke lege staat. */
  channel?: InsightChannel | null;
}

function statusTone(status: HypothesisWorkflowItem["status"]) {
  if (status === "accepted") return "bg-emerald-100 text-emerald-700";
  if (status === "rejected") return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-700";
}

type WorkflowChannel = "google" | "meta" | "linkedin";
const WF_LABEL: Record<WorkflowChannel, string> = { google: "Google", meta: "Meta", linkedin: "LinkedIn" };

export function HypothesesBlock({ clientId, refreshKey, onWorkflowChange, channel }: Props) {
  // Cross-channel heeft geen maand-SOP-workflow; onder "Alle" stapelen de drie kanalen.
  if (channel === "cross") return null;
  const wfChannels: WorkflowChannel[] = channel ? [channel as WorkflowChannel] : ["google", "meta", "linkedin"];
  return (
    <>
      {wfChannels.map((wf) => (
        <HypothesesWorkflow key={wf} clientId={clientId} refreshKey={refreshKey} onWorkflowChange={onWorkflowChange} workflowChannel={wf} />
      ))}
    </>
  );
}

function HypothesesWorkflow({ clientId, refreshKey, onWorkflowChange, workflowChannel }: {
  clientId: string;
  refreshKey?: number;
  onWorkflowChange?: () => void;
  workflowChannel: WorkflowChannel;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`/api/insights/monthly-hypotheses?client_id=${encodeURIComponent(clientId)}&channel=${workflowChannel}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as Payload;
      setPayload(data);
    } catch (error) {
      console.error("[hypotheses-block] load failed", error);
      setPayload({ analysis_id: null, structured_row_id: null, structured_created_at: null, hypotheses: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, refreshKey, workflowChannel]);

  const hypotheses = useMemo(() => {
    const list = payload?.hypotheses ?? [];
    const order = { pending: 0, accepted: 1, rejected: 2 } as const;
    return [...list].sort((a, b) => order[a.status] - order[b.status] || a.title.localeCompare(b.title));
  }, [payload]);

  async function mutateHypothesis(hypothesisId: string, action: "accept" | "reject") {
    let rejectedReason = "";
    if (action === "reject") {
      rejectedReason = window.prompt("Waarom wijs je deze hypothese af?")?.trim() || "";
      if (!rejectedReason) return;
    }

    setBusyId(hypothesisId);
    try {
      const res = await fetch("/api/insights/monthly-hypotheses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          channel: workflowChannel,
          hypothesis_id: hypothesisId,
          action,
          rejected_reason: rejectedReason,
        }),
      });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        throw new Error(errorBody?.error || "Hypothesis workflow mutatie mislukt");
      }
      await refresh();
      onWorkflowChange?.();
    } catch (error) {
      console.error(`[hypotheses-block] ${action} failed`, error);
      alert(error instanceof Error ? error.message : "Hypothesis workflow mutatie mislukt");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
        <Loader2 className="w-4 h-4 animate-spin text-rm-blue" />
      </div>
    );
  }

  if (hypotheses.length === 0) return null;

  const pendingCount = hypotheses.filter((item) => item.status === "pending").length;

  return (
    <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Beaker className="w-4 h-4 text-purple-500" />
        <h3 className="text-sm font-semibold text-purple-700 uppercase tracking-wide">
          Hypotheses workflow — {WF_LABEL[workflowChannel]}
        </h3>
        <span className="ml-auto px-2 py-0.5 text-[9px] font-bold rounded-full bg-purple-100 text-purple-600">
          {pendingCount} pending / {hypotheses.length} totaal
        </span>
      </div>

      <p className="text-[10px] text-muted-foreground mb-4">
        Bron: laatste `structured_monthly_v2` output. Accepteren zet alle gekoppelde taken door naar sprintplanning.
      </p>

      <div className="space-y-3">
        {hypotheses.map((item) => {
          const isExpanded = expanded === item.id;
          const isBusy = busyId === item.id;

          return (
            <div key={item.id} className="border border-purple-100 rounded-lg bg-purple-50/30 overflow-hidden">
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="flex flex-col gap-1 shrink-0 pt-0.5">
                  {item.status === "pending" ? (
                    <>
                      <button
                        onClick={() => mutateHypothesis(item.id, "accept")}
                        disabled={isBusy}
                        className="p-1.5 rounded-md bg-emerald-100 hover:bg-emerald-200 text-emerald-600 transition-colors"
                        title="Accepteren en alle gekoppelde taken doorzetten"
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => mutateHypothesis(item.id, "reject")}
                        disabled={isBusy}
                        className="p-1.5 rounded-md bg-red-50 hover:bg-red-100 text-red-400 transition-colors"
                        title="Afwijzen met reden"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <div className={`px-2 py-1 rounded-md text-[10px] font-semibold ${statusTone(item.status)}`}>
                      {item.status}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-semibold text-purple-700">{item.title}</p>
                    <span className="px-1.5 py-0.5 rounded bg-white border border-purple-200 text-[10px] text-purple-600">
                      {item.label}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusTone(item.status)}`}>
                      {item.status}
                    </span>
                    {item.accepted_into_sprint && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-medium">
                        in sprint
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-rm-gray leading-snug mt-1">{item.hypothesis}</p>

                  <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground flex-wrap">
                    <span>{item.linked_findings.length} bevindingen gekoppeld</span>
                    <span>{item.linked_tasks.length} taken gekoppeld</span>
                    <span>{item.sprint_items.length} sprint-items</span>
                    <span className="inline-flex items-center gap-1">
                      <Link2 className="w-3 h-3" /> {item.linked_primary_thread}
                    </span>
                  </div>

                  <button
                    onClick={() => setExpanded(isExpanded ? null : item.id)}
                    className="flex items-center gap-1 mt-1.5 text-[10px] text-purple-500 hover:text-purple-700"
                  >
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {isExpanded ? "Minder" : "Meer details"}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 pt-0 ml-12 space-y-3 text-[11px] text-muted-foreground border-t border-purple-100 mt-1 pt-3">
                  <div>
                    <p><span className="font-medium text-rm-gray">Waarom denken we dit:</span> {item.why_we_think_this}</p>
                    <p className="mt-1"><span className="font-medium text-rm-gray">Validatie / exploitatie:</span> {item.validation_or_exploitation_step}</p>
                    <p className="mt-1"><span className="font-medium text-rm-gray">Succes volgende maand:</span> {item.success_next_month}</p>
                    {item.rejected_reason && (
                      <p className="mt-1 text-red-600"><span className="font-medium">Afwijsreden:</span> {item.rejected_reason}</p>
                    )}
                  </div>

                  <div>
                    <p className="font-medium text-rm-gray mb-1">Gekoppelde bevindingen</p>
                    <div className="space-y-1">
                      {item.linked_findings.map((finding) => (
                        <p key={finding.id}>- {finding.title} ({finding.severity}) — {finding.summary}</p>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="font-medium text-rm-gray mb-1">Gekoppelde recommendations</p>
                    <div className="space-y-1">
                      {item.linked_recommendations.map((recommendation) => (
                        <p key={recommendation.id}>- {recommendation.route}: {recommendation.handeling} ({recommendation.object})</p>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="font-medium text-rm-gray mb-1">Gekoppelde taken</p>
                    <div className="space-y-1">
                      {item.linked_tasks.map((task) => (
                        <p key={task.id}>- {task.handeling} ({task.object}) · meet via {task.meet_via}</p>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="font-medium text-rm-gray mb-1">Ontstane sprint-items</p>
                    {item.sprint_items.length === 0 ? (
                      <p>Geen sprint-items aangemaakt.</p>
                    ) : (
                      <div className="space-y-1">
                        {item.sprint_items.map((sprintItem) => (
                          <p key={sprintItem.id}>- {sprintItem.task} [{sprintItem.status}]</p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
