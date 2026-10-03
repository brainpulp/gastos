// Gastos MCP — remote MCP server (Streamable HTTP) exposing the Gastos DB.
// Auth: secret token in the URL path (…/gastos-mcp/<TOKEN>) or Authorization: Bearer <TOKEN>.
// Deployed with verify_jwt=false; this file does its own token check.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = "gm_8b4c2b4c5016cad3640aaafeab726200a454932f9803e518";
const SERVER = { name: "gastos", version: "1.0.0" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
};

const TX_SCHEMA = `Personal finance DB (Postgres/Supabase). Main table:
transactions(id text, date date, ym, year, cat text, bank text, ars numeric, usd numeric,
  usd_rate numeric, xfer bool, raw_desc text, merchant text, referencia text, notes text,
  project text, group_id text, ai_assigned bool, ai_confidence numeric, needs_review bool,
  deleted_at timestamptz, created_at timestamptz, user_id uuid).
Conventions: amount sign negative = expense, positive = income; amounts in USD (usd) and ARS (ars).
Active rows have deleted_at IS NULL (soft-delete only — to remove, UPDATE ... SET deleted_at = now()).
Transfers/internal movements have xfer = true (usually excluded from spend totals).
Other tables: settings (per-user cats, expense_groups, monthly_budget_usd), cat_log, blue_rates(date,rate).`;

const TOOLS = [
  {
    name: "execute_sql",
    description:
      "Run a SQL statement against the Gastos personal-finance database (read AND write). " +
      "Returns {rows:[...]} for SELECT, or {status:'ok'} for INSERT/UPDATE/DELETE. " +
      "ALWAYS filter `deleted_at IS NULL` for active rows. Never hard-DELETE — soft-delete via " +
      "UPDATE ... SET deleted_at = now(). Schema:\n" + TX_SCHEMA,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "A single SQL statement." } },
      required: ["query"],
    },
  },
];

async function runSql(query: string): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/mcp_run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${text}`);
  return text;
}

function rpcResult(id: unknown, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
function rpcError(id: unknown, code: number, message: string) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function tokenFrom(req: Request): string | undefined {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("gastos-mcp");
  const pathTok = i >= 0 && parts.length > i + 1 ? parts[i + 1] : undefined;
  const header = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const qp = url.searchParams.get("token") ?? undefined;
  return pathTok || header || qp;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (tokenFrom(req) !== TOKEN) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  // GET is used by Streamable HTTP for a server->client SSE stream; we are stateless.
  if (req.method === "GET") {
    return new Response("", {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...CORS },
    });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST, GET", ...CORS } });
  }

  let msg: any;
  try { msg = await req.json(); } catch { return rpcError(null, -32700, "Parse error"); }

  const handle = async (m: any): Promise<Response | null> => {
    const { id, method, params } = m ?? {};
    // Notifications (no id) get no response body.
    if (id === undefined || id === null) return null;

    if (method === "initialize") {
      return rpcResult(id, {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions:
          "Query or modify the user's personal finances via the execute_sql tool. " +
          "Filter deleted_at IS NULL; soft-delete only.",
      });
    }
    if (method === "ping") return rpcResult(id, {});
    if (method === "tools/list") return rpcResult(id, { tools: TOOLS });
    if (method === "tools/call") {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (name !== "execute_sql") return rpcError(id, -32602, `Unknown tool: ${name}`);
      if (typeof args.query !== "string" || !args.query.trim()) {
        return rpcError(id, -32602, "Missing 'query' string");
      }
      try {
        const out = await runSql(args.query);
        return rpcResult(id, { content: [{ type: "text", text: out }] });
      } catch (e) {
        return rpcResult(id, { content: [{ type: "text", text: `ERROR: ${e.message}` }], isError: true });
      }
    }
    return rpcError(id, -32601, `Method not found: ${method}`);
  };

  // Support a single message (MCP typically sends one object per POST).
  if (Array.isArray(msg)) {
    const out: any[] = [];
    for (const m of msg) {
      const r = await handle(m);
      if (r) out.push(await r.json());
    }
    if (out.length === 0) return new Response(null, { status: 202, headers: CORS });
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", ...CORS } });
  }

  const res = await handle(msg);
  if (!res) return new Response(null, { status: 202, headers: CORS });
  return res;
});
