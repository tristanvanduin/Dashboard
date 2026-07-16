import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import { fetchProgressSnapshot } from "@/lib/progress/server";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  const { jobId } = await context.params;
  if (!jobId) return Response.json({ error: "jobId vereist" }, { status: 400 });

  const result = await fetchProgressSnapshot(supabase, jobId);
  if (!result.trackerAvailable) {
    return Response.json(result, { status: 200 });
  }
  if (!result.found) {
    return Response.json(result, { status: 202 });
  }

  return Response.json(result, { status: 200 });
}
