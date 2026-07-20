// Scoped mock-Supabase-client voor demo-mode. Onderschept queries voor de demo-klant
// ("demo-greentech") en geeft curated rijen terug; voor élke andere klant/tabel delegeert hij
// naar de echte client (passthrough) zodat de 23 echte klanten volledig ongemoeid blijven.
//
// Bewust pragmatisch: bij het serveren van demo-rijen passen we het client_id-filter toe en
// negeren we de overige filters (datum/status). De curated rijen dragen al zinnige statussen,
// dus de weergave klopt; we hoeven de PostgREST-semantiek niet volledig na te bouwen.
//
// Reads: thenable builder (await sb.from(t).select()…). Writes (insert/upsert/update/delete):
// no-op succes voor de demo-klant; anders passthrough naar echt.

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_GREENTECH_ID } from "./greentech-mock";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };

interface DemoRowSource {
  [table: string]: Row[];
}

const isDemoClientValue = (v: unknown): boolean =>
  typeof v === "string" && (v === DEMO_GREENTECH_ID || v.replace(/^gads-/, "") === DEMO_GREENTECH_ID);

class MockQuery implements PromiseLike<Result> {
  private calls: { m: string; args: unknown[] }[] = [];
  private eqFilters: Record<string, unknown> = {};
  private singleMode = false;
  private isWrite = false;

  constructor(
    private real: SupabaseClient | null,
    private table: string,
    private rows: Row[] | undefined,
  ) {}

  // ── filter/vorm-methoden: opnemen en this teruggeven ──
  private rec(m: string, args: unknown[]) { this.calls.push({ m, args }); return this; }
  select(...a: unknown[]) { return this.rec("select", a); }
  eq(col: unknown, val: unknown) { if (typeof col === "string") this.eqFilters[col] = val; return this.rec("eq", [col, val]); }
  neq(...a: unknown[]) { return this.rec("neq", a); }
  gt(...a: unknown[]) { return this.rec("gt", a); }
  gte(...a: unknown[]) { return this.rec("gte", a); }
  lt(...a: unknown[]) { return this.rec("lt", a); }
  lte(...a: unknown[]) { return this.rec("lte", a); }
  in(...a: unknown[]) { return this.rec("in", a); }
  is(...a: unknown[]) { return this.rec("is", a); }
  not(...a: unknown[]) { return this.rec("not", a); }
  or(...a: unknown[]) { return this.rec("or", a); }
  ilike(...a: unknown[]) { return this.rec("ilike", a); }
  like(...a: unknown[]) { return this.rec("like", a); }
  contains(...a: unknown[]) { return this.rec("contains", a); }
  filter(...a: unknown[]) { return this.rec("filter", a); }
  order(...a: unknown[]) { return this.rec("order", a); }
  limit(...a: unknown[]) { return this.rec("limit", a); }
  range(...a: unknown[]) { return this.rec("range", a); }
  maybeSingle() { this.singleMode = true; return this.rec("maybeSingle", []); }
  single() { this.singleMode = true; return this.rec("single", []); }

  // ── writes ──
  insert(...a: unknown[]) { this.isWrite = true; return this.rec("insert", a); }
  upsert(...a: unknown[]) { this.isWrite = true; return this.rec("upsert", a); }
  update(...a: unknown[]) { this.isWrite = true; return this.rec("update", a); }
  delete(...a: unknown[]) { this.isWrite = true; return this.rec("delete", a); }

  private servesDemo(): boolean {
    // Serveer demo-rijen als er curated data voor deze tabel is én de query de demo-klant betreft
    // (of geen client_id-filter heeft — dan geldt hij impliciet de zichtbare, incl. demo).
    if (!this.rows) return false;
    if ("client_id" in this.eqFilters) return isDemoClientValue(this.eqFilters.client_id);
    return true;
  }

  private demoResult(): Result {
    let data = this.rows ?? [];
    // Pas de eenvoudige gelijkheidsfilters toe (client_id en andere directe eq's).
    for (const [col, val] of Object.entries(this.eqFilters)) {
      if (col === "client_id") { data = data.filter((r) => isDemoClientValue(r[col]) || r[col] === val); continue; }
      data = data.filter((r) => r[col] === val);
    }
    if (this.singleMode) return { data: data[0] ?? null, error: null };
    return { data, error: null };
  }

  private async delegate(): Promise<Result> {
    if (!this.real) return this.singleMode ? { data: null, error: null } : { data: [], error: null };
    // Herbouw de query op de echte client door de opgenomen calls te replayen.
    let q: unknown = this.real.from(this.table);
    for (const { m, args } of this.calls) {
      const fn = (q as Record<string, unknown>)[m];
      if (typeof fn === "function") q = (fn as (...x: unknown[]) => unknown).apply(q, args);
    }
    return (q as PromiseLike<Result>);
  }

  then<TR1 = Result, TR2 = never>(
    onfulfilled?: ((value: Result) => TR1 | PromiseLike<TR1>) | null,
    onrejected?: ((reason: unknown) => TR2 | PromiseLike<TR2>) | null,
  ): PromiseLike<TR1 | TR2> {
    const run = async (): Promise<Result> => {
      // Writes op de demo-klant: no-op succes. Anders passthrough.
      if (this.isWrite) {
        if (this.servesDemo()) return { data: null, error: null };
        return this.delegate();
      }
      if (this.servesDemo()) return this.demoResult();
      return this.delegate();
    };
    return run().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

// Bouwt een mock-client die .from() onderschept en de rest (auth, storage, rpc…) doorlaat
// naar de echte client indien aanwezig.
export function createDemoSupabase(real: SupabaseClient | null, rows: DemoRowSource): SupabaseClient {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "from") {
        return (table: string) => new MockQuery(real, table, rows[table]);
      }
      // Overige leden delegeren naar de echte client (of no-op).
      if (real) {
        const v = (real as unknown as Record<string | symbol, unknown>)[prop];
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
      }
      return undefined;
    },
  };
  return new Proxy({}, handler) as unknown as SupabaseClient;
}
