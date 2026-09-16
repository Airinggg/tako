import type { ConnectorDomain, ConnectorToolPolicy, DataClassification } from "./manifest.ts";

export type ToolPolicy = ConnectorToolPolicy & {
  /** Runtime entitlement key. Usually a gbrain source/server id or domain id. */
  source: string | ConnectorDomain;
};

export type PolicyInput = {
  tool: ToolPolicy;
  args: unknown;
  scope: { name: string; readSources: string[] };
  dataClass: DataClassification;
  env: "dev" | "prod";
};

export type PolicyDecision = {
  decision: "allow" | "deny" | "approval-required";
  reason: string;
};

const KNOWN_RISKS = new Set(["read", "create-isolated", "mutate", "destructive", "physical-control"]);

function requestsOverwrite(args: unknown): boolean {
  if (!args || typeof args !== "object") return false;
  return Object.entries(args as Record<string, unknown>).some(([key, value]) =>
    /^(?:overwrite|replace|productionOverwrite)$/i.test(key) && value === true,
  );
}

/** Product-owned, deny-by-default decision point for actual invocation args. */
export function evaluate(input: PolicyInput): PolicyDecision {
  const { tool, scope, dataClass, env } = input;
  if (!tool || !KNOWN_RISKS.has(String(tool.risk))) return { decision: "deny", reason: "unknown-tool-risk" };
  if (!Array.isArray(tool.dataClassifications) || !tool.dataClassifications.includes(dataClass)) {
    return { decision: "deny", reason: `data-classification-not-allowed:${dataClass}` };
  }
  if (!scope.readSources.includes(String(tool.source))) {
    return { decision: "deny", reason: `source-out-of-scope:${tool.source}` };
  }

  switch (tool.risk) {
    case "read":
      return { decision: "allow", reason: `read-entitled:${scope.name}` };
    case "create-isolated":
      if (env === "prod" && requestsOverwrite(input.args)) return { decision: "deny", reason: "production-overwrite-forbidden" };
      return { decision: "approval-required", reason: "isolated-create-requires-approval" };
    case "mutate":
      return { decision: "approval-required", reason: "mutation-requires-human-approval" };
    case "destructive":
      return { decision: "deny", reason: "destructive-tools-disabled" };
    case "physical-control":
      return { decision: "deny", reason: "physical-control-unsupported" };
    default:
      return { decision: "deny", reason: "unknown-tool-risk" };
  }
}
