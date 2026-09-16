import { createHash } from "node:crypto";
import { redact, type RedactionRule } from "../../govern/redact.ts";
import { evaluate, type PolicyDecision, type ToolPolicy } from "../../govern/policy.ts";
import { McpClient, type McpContent } from "./client.ts";

export type McpAuditLine = {
  ts: string;
  connector: string;
  tool: string;
  uri: string;
  decision: PolicyDecision["decision"];
  reason: string;
  inputSchemaHash: string;
  resultHash: string | null;
  redactionHits: { rule: string; action: string; count: number }[];
};

export type BlockedMcpItem = {
  uri: string;
  decision: "deny" | "approval-required";
  reason: string;
};

export type GovernedRead = {
  contents: McpContent[];
  audit: McpAuditLine;
  blocked?: BlockedMcpItem;
  error?: "upstream-read-failed";
};

export type McpGovernance = {
  connector: string;
  tool: ToolPolicy;
  scope: { name: string; readSources: string[] };
  dataClass: "public" | "internal" | "confidential" | "restricted" | "export-controlled";
  env: "dev" | "prod";
  redactionRules?: readonly RedactionRule[];
  now?: () => string;
};

export const RESOURCE_READ_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["uri"],
  properties: { uri: { type: "string", minLength: 1 } },
} as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function schemaHash(schema: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(schema)).digest("hex")}`;
}

function hashResult(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function redactionSummary(contents: McpContent[], rules?: readonly RedactionRule[]) {
  const counts = new Map<string, { rule: string; action: string; count: number }>();
  let blocked = false;
  const safe = contents.map((content) => {
    if (typeof content.text !== "string") return content;
    const result = redact(content.text, rules);
    blocked ||= result.blocked;
    for (const hit of result.hits) {
      const key = `${hit.rule}:${hit.action}`;
      const item = counts.get(key) ?? { rule: hit.rule, action: hit.action, count: 0 };
      item.count += 1;
      counts.set(key, item);
    }
    return { ...content, text: result.text };
  });
  return { safe, blocked, hits: [...counts.values()].sort((a, b) => a.rule.localeCompare(b.rule)) };
}

/**
 * Policy and redaction boundary around the deliberately small McpClient.
 * Denied and approval-required reads are audited without contacting upstream.
 */
export class GovernedMcpClient {
  private readonly client: McpClient;
  private readonly governance: McpGovernance;

  constructor(client: McpClient, governance: McpGovernance) {
    this.client = client;
    this.governance = governance;
  }

  initialize() { return this.client.initialize(); }
  listResources(max?: number) { return this.client.listResources(max); }

  async readResource(uri: string): Promise<GovernedRead> {
    const args = { uri };
    const tool = { ...this.governance.tool, inputSchemaHash: schemaHash(RESOURCE_READ_INPUT_SCHEMA) };
    const decision = evaluate({
      tool, args, scope: this.governance.scope,
      dataClass: this.governance.dataClass, env: this.governance.env,
    });
    const base = {
      ts: this.governance.now?.() ?? new Date().toISOString(),
      connector: this.governance.connector,
      tool: tool.name,
      uri,
      decision: decision.decision,
      reason: decision.reason,
      inputSchemaHash: tool.inputSchemaHash,
    };
    if (decision.decision !== "allow") {
      return {
        contents: [],
        blocked: { uri, decision: decision.decision, reason: decision.reason },
        audit: { ...base, resultHash: null, redactionHits: [] },
      };
    }

    let raw: McpContent[];
    try {
      raw = await this.client.readResource(uri);
    } catch {
      return {
        contents: [], error: "upstream-read-failed",
        audit: { ...base, reason: `${decision.reason};upstream-read-failed`, resultHash: null, redactionHits: [] },
      };
    }
    const { safe, blocked, hits } = redactionSummary(raw, this.governance.redactionRules);
    const resultText = safe.map((item) => item.text ?? "").join("\n\n");
    if (blocked) {
      return {
        contents: [],
        blocked: { uri, decision: "deny", reason: "result-redaction-blocked" },
        audit: {
          ...base, decision: "deny", reason: "result-redaction-blocked",
          resultHash: hashResult(resultText), redactionHits: hits,
        },
      };
    }
    return {
      contents: safe,
      audit: { ...base, resultHash: hashResult(resultText), redactionHits: hits },
    };
  }
}
