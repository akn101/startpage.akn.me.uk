/* Minimal in-memory stand-in for the supabase-js query builder (only what the aknclient routes use). */
type Row = Record<string, any>;
type Filter = (r: Row) => boolean;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  failNext: string | null = null;

  seed(table: string, rows: Row[]) { this.tables[table] = rows.map((r) => ({ ...r })); }
  rows(table: string) { return this.tables[table] ?? (this.tables[table] = []); }
  from(table: string) { return new Query(this, table); }
}

class Query {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private payload: any; private opts: any; private returning = false; private mode: "one" | "maybe" | null = null;
  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string) { this.returning = true; return this; }
  order() { return this; }
  insert(v: any) { this.op = "insert"; this.payload = v; return this; }
  upsert(v: any[], opts: any) { this.op = "upsert"; this.payload = v; this.opts = opts; return this; }
  update(v: any) { this.op = "update"; this.payload = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  gte(c: string, v: string) { this.filters.push((r) => Date.parse(r[c]) >= Date.parse(v)); return this; }
  lt(c: string, v: string) { this.filters.push((r) => Date.parse(r[c]) < Date.parse(v)); return this; }
  not(c: string, op: string, v: string) {
    if (op !== "in") throw new Error("fake: only not-in supported");
    const list = [...v.slice(1, -1).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, "$1"));
    this.filters.push((r) => !list.includes(r[c]));
    return this;
  }
  single() { this.mode = "one"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  then(ok?: (v: any) => any, bad?: (e: any) => any) { return Promise.resolve(this.run()).then(ok, bad); }

  private run() {
    if (this.db.failNext) { const m = this.db.failNext; this.db.failNext = null; return { data: null, error: { message: m } }; }
    const rows = this.db.rows(this.table);
    const match = (r: Row) => this.filters.every((f) => f(r));
    let out: Row[] = [];
    if (this.op === "select") out = rows.filter(match);
    if (this.op === "insert") {
      const r = { id: `id-${rows.length + 1}`, ...this.payload }; rows.push(r); out = [r];
    }
    if (this.op === "upsert") {
      const keys: string[] = this.opts.onConflict.split(",");
      for (const p of this.payload) {
        const hit = rows.find((r) => keys.every((k) => r[k] != null && r[k] === p[k]));
        if (hit) Object.assign(hit, p); else rows.push({ id: `id-${rows.length + 1}`, ...p });
      }
    }
    if (this.op === "update") { out = rows.filter(match); out.forEach((r) => Object.assign(r, this.payload)); }
    if (this.op === "delete") {
      out = rows.filter(match);
      this.db.tables[this.table] = rows.filter((r) => !out.includes(r));
    }
    const data = this.returning || this.op === "select" ? out : null;
    if (this.mode) {
      if (data && data.length) return { data: data[0], error: null };
      return this.mode === "maybe" ? { data: null, error: null } : { data: null, error: { message: "no rows" } };
    }
    return { data, error: null };
  }
}
