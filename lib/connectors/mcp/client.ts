/**
 * A minimal read-only MCP client for the connector: `initialize`, then
 * `resources/list` (paginated) and `resources/read`. It never calls a mutating
 * tool — Tako federates MCP servers, it doesn't drive them.
 *
 * The transport is injected so the whole thing tests offline. Two real
 * transports ship: Streamable-HTTP (a `url`) and stdio (a `command`).
 */

export type JsonRpcRequest = { jsonrpc: "2.0"; id: number; method: string; params?: unknown };
export type JsonRpcResponse = { jsonrpc: "2.0"; id: number; result?: any; error?: { code: number; message: string } };

/** Send one JSON-RPC request, resolve its response. */
export type Transport = (req: JsonRpcRequest) => Promise<JsonRpcResponse>;

export type McpResource = { uri: string; name: string; description?: string; mimeType?: string };
export type McpContent = { uri: string; mimeType?: string; text?: string; blob?: string };

export class McpClient {
  private id = 0;
  private transport: Transport;
  constructor(transport: Transport) { this.transport = transport; }

  private async call<T = any>(method: string, params?: unknown): Promise<T> {
    const res = await this.transport({ jsonrpc: "2.0", id: ++this.id, method, params });
    if (res.error) throw new Error(`${method}: ${res.error.message} (${res.error.code})`);
    return res.result as T;
  }

  async initialize(): Promise<{ name: string; version?: string; protocolVersion?: string }> {
    const r = await this.call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "tako-connector", version: "0.1.0" },
    });
    return {
      name: r?.serverInfo?.name ?? "mcp-server",
      version: r?.serverInfo?.version,
      protocolVersion: r?.protocolVersion,
    };
  }

  /** Every resource the server exposes (follows `nextCursor`). */
  async listResources(max = 5_000): Promise<McpResource[]> {
    const out: McpResource[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.call<{ resources?: McpResource[]; nextCursor?: string }>(
        "resources/list", cursor ? { cursor } : {},
      );
      for (const r of page?.resources ?? []) {
        if (r?.uri) out.push({ uri: r.uri, name: r.name ?? r.uri, description: r.description, mimeType: r.mimeType });
        if (out.length >= max) return out;
      }
      cursor = page?.nextCursor;
    } while (cursor);
    return out;
  }

  async readResource(uri: string): Promise<McpContent[]> {
    const r = await this.call<{ contents?: McpContent[] }>("resources/read", { uri });
    return (r?.contents ?? []).filter((c) => c && c.uri);
  }
}

// ── Streamable-HTTP transport ─────────────────────────────────────────────
/** POST JSON-RPC to a single endpoint; accept `application/json` or a one-shot
 *  `text/event-stream` reply. Carries the `Mcp-Session-Id` handed back on init. */
export function httpTransport(url: string, extraHeaders: Record<string, string> = {}, timeoutMs = 20_000): Transport {
  let sessionId = "";
  return async (req) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...extraHeaders,
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const res = await fetch(url, {
      method: "POST", headers, body: JSON.stringify(req),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) sessionId = sid;
    if (!res.ok) throw new Error(`MCP HTTP ${res.status} ${await res.text().catch(() => "")}`.slice(0, 200));
    const ctype = res.headers.get("content-type") ?? "";
    const body = await res.text();
    if (ctype.includes("text/event-stream")) {
      // take the last `data:` line that parses as our response
      const datas = body.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
      for (let i = datas.length - 1; i >= 0; i--) {
        try { const j = JSON.parse(datas[i]); if (j.id === req.id) return j as JsonRpcResponse; } catch { /* keep looking */ }
      }
      throw new Error("MCP SSE reply had no matching JSON-RPC response");
    }
    return JSON.parse(body) as JsonRpcResponse;
  };
}

// ── stdio transport (spawn a local MCP server command) ────────────────────
/** Spawn `command args`, exchange newline-delimited JSON-RPC on stdin/stdout.
 *  Requires Bun.spawn (this runs under Bun). */
export function stdioTransport(command: string, args: string[] = [], env: Record<string, string> = {}): Transport & { close: () => void } {
  // deno-lint-ignore no-explicit-any
  const proc = (globalThis as any).Bun.spawn([command, ...args], {
    stdin: "pipe", stdout: "pipe", stderr: "ignore",
    env: { ...process.env, ...env },
  });
  const writer = proc.stdin.getWriter();
  const decoder = new TextDecoder();
  let buffer = "";
  const pending = new Map<number, (r: JsonRpcResponse) => void>();

  (async () => {
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (typeof msg.id === "number" && pending.has(msg.id)) { pending.get(msg.id)!(msg); pending.delete(msg.id); }
        } catch { /* server log line — ignore */ }
      }
    }
  })();

  const t: Transport & { close: () => void } = async (req) => {
    const p = new Promise<JsonRpcResponse>((resolve) => pending.set(req.id, resolve));
    await writer.write(new TextEncoder().encode(JSON.stringify(req) + "\n"));
    return Promise.race([
      p,
      new Promise<JsonRpcResponse>((_, rej) => setTimeout(() => rej(new Error(`MCP stdio timeout on ${req.method}`)), 20_000)),
    ]);
  };
  t.close = () => { try { writer.close(); proc.kill(); } catch { /* */ } };
  return t;
}
