import { NextRequest } from "next/server";
import { getSupabase } from "@/lib/analysis/helpers";
import {
  buildPreparedContextRow,
  savePreparedContext,
} from "@/lib/analysis/monthly-prepared-context";

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ error: "Supabase niet geconfigureerd" }, { status: 500 });

  let clientId = "";
  try {
    const body = await request.json();
    clientId = String(body.client_id || "");
  } catch {
    return Response.json({ error: "Verwacht: { client_id: string }" }, { status: 400 });
  }

  if (!clientId) {
    return Response.json({ error: "client_id is verplicht" }, { status: 400 });
  }

  try {
    const { prepared } = await buildPreparedContextRow(supabase, clientId);
    const { data, error } = await savePreparedContext(supabase, prepared);
    if (error) {
      throw error;
    }
    return Response.json({
      prepared_context_id: data?.id ?? null,
      analysis_date: prepared.analysis_date,
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Prepared context opbouw mislukt",
    }, { status: 500 });
  }
}
