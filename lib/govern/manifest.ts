/** Pure validation for the product-owned industrial connector manifest. */

export type ConnectorDomain = "cad" | "cam" | "cae" | "plm" | "erp" | "mes" | "qms" | "ot" | "other";
export type ToolRisk = "read" | "create-isolated" | "mutate" | "destructive" | "physical-control";
export type ToolApproval = "none" | "policy" | "always";
export type DataClassification = "public" | "internal" | "confidential" | "restricted" | "export-controlled";

export type ConnectorToolPolicy = {
  name: string;
  inputSchemaHash: string;
  risk: ToolRisk;
  approval: ToolApproval;
  idempotency: "required" | "supported" | "none";
  scopes?: string[];
  timeoutMs: number;
  maxAttempts: number;
  dataClassifications: DataClassification[];
  enabledByDefault: false;
  workspaceRequired?: boolean;
  checkpointRequired?: boolean;
  verificationRequired: boolean;
  resultSchemaRef?: string;
};

export type ConnectorManifest = {
  schemaVersion: "1.0";
  id: string;
  displayName: string;
  version: string;
  vendor: string;
  domain: ConnectorDomain;
  owner: { team: string; contact: string };
  provenance: {
    sourceType: "vendor" | "community" | "internal";
    sourceUrl: string;
    revision: string;
    license: string;
    licenseApproved: boolean;
    artifactDigest: string;
    sbomRef?: string;
    reviewedAt: string;
  };
  execution: {
    placement: "cloud" | "vpc" | "edge-windows" | "edge-linux" | "hpc";
    transport: "stdio" | "streamable-http" | "sse-legacy";
    command?: string;
    args?: string[];
    endpointRef?: string;
    workingDirectoryRef?: string;
    environmentSecretRefs?: Record<string, string>;
    concurrency: number;
    timeoutMs: number;
    workspaceRequired?: boolean;
    outboundOnly?: boolean;
  };
  protocol: {
    minimumVersion: string;
    testedVersion: string;
    schemaSnapshotHash: string;
    backwardCompatibilityTested?: boolean;
  };
  auth: {
    type: "none" | "local-session" | "oauth2-authorization-code-pkce" | "oauth2-client-credentials" | "api-key" | "windows-integrated" | "mtls";
    secretRefs: string[];
    scopes?: string[];
    stepUpSupported?: boolean;
  };
  capabilities: { tools: boolean; resources: boolean; prompts: boolean; tasks: boolean };
  tools: ConnectorToolPolicy[];
  operations: {
    healthTool: string;
    killSwitch: true;
    rollbackSupported: boolean;
    supportRunbookRef: string;
    metricsPrefix?: string;
  };
};

export type ManifestValidation = { ok: boolean; errors: string[] };

const DOMAINS = new Set<ConnectorDomain>(["cad", "cam", "cae", "plm", "erp", "mes", "qms", "ot", "other"]);
const RISKS = new Set<ToolRisk>(["read", "create-isolated", "mutate", "destructive", "physical-control"]);
const APPROVALS = new Set<ToolApproval>(["none", "policy", "always"]);
const CLASSES = new Set<DataClassification>(["public", "internal", "confidential", "restricted", "export-controlled"]);
const PLACEMENTS = new Set(["cloud", "vpc", "edge-windows", "edge-linux", "hpc"]);
const TRANSPORTS = new Set(["stdio", "streamable-http", "sse-legacy"]);
const AUTH_TYPES = new Set(["none", "local-session", "oauth2-authorization-code-pkce", "oauth2-client-credentials", "api-key", "windows-integrated", "mtls"]);
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA256 = /^sha256:[a-fA-F0-9]{64}$/;
const SECRET_REF = /^secret:\/\/.+/;

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const integer = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && Number(value) >= min && Number(value) <= max;

/**
 * Validate the security-relevant subset of connector-manifest.schema.json.
 * It intentionally returns every discovered error so a connector can be fixed
 * in one review without ever partially registering it.
 */
export function validateManifest(value: unknown): ManifestValidation {
  const errors: string[] = [];
  const fail = (path: string, message: string) => errors.push(`${path}: ${message}`);
  if (!object(value)) return { ok: false, errors: ["manifest: must be an object"] };

  if (value.schemaVersion !== "1.0") fail("schemaVersion", 'must equal "1.0"');
  if (!text(value.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) || value.id.length < 3 || value.id.length > 80) fail("id", "must be a 3-80 character kebab-case id");
  if (!text(value.displayName) || value.displayName.length > 120) fail("displayName", "must be 1-120 characters");
  if (!text(value.version) || !SEMVER.test(value.version)) fail("version", "must be an immutable semantic version");
  if (!text(value.vendor) || value.vendor.length > 120) fail("vendor", "must be 1-120 characters");
  if (!DOMAINS.has(value.domain as ConnectorDomain)) fail("domain", "is not an approved connector domain");

  if (!object(value.owner)) fail("owner", "must be an object");
  else {
    if (!text(value.owner.team)) fail("owner.team", "is required");
    if (!text(value.owner.contact)) fail("owner.contact", "is required");
  }

  if (!object(value.provenance)) fail("provenance", "must be an object");
  else {
    if (!["vendor", "community", "internal"].includes(String(value.provenance.sourceType))) fail("provenance.sourceType", "must be vendor, community, or internal");
    if (!text(value.provenance.sourceUrl)) fail("provenance.sourceUrl", "is required");
    if (!text(value.provenance.revision) || value.provenance.revision.length < 7 || /^(?:main|master|head|latest|stable)$/i.test(value.provenance.revision)) fail("provenance.revision", "must pin an immutable revision");
    if (!text(value.provenance.license)) fail("provenance.license", "is required");
    if (value.provenance.licenseApproved !== true) fail("provenance.licenseApproved", "must be true before use");
    if (!text(value.provenance.artifactDigest) || !SHA256.test(value.provenance.artifactDigest)) fail("provenance.artifactDigest", "must be a sha256 digest");
    if (!text(value.provenance.reviewedAt) || Number.isNaN(Date.parse(value.provenance.reviewedAt))) fail("provenance.reviewedAt", "must be an ISO date-time");
  }

  if (!object(value.execution)) fail("execution", "must be an object");
  else {
    if (!PLACEMENTS.has(String(value.execution.placement))) fail("execution.placement", "is invalid");
    if (!TRANSPORTS.has(String(value.execution.transport))) fail("execution.transport", "is invalid");
    if (value.execution.transport === "stdio" && !text(value.execution.command)) fail("execution.command", "is required for stdio");
    if (value.execution.transport !== "stdio" && !text(value.execution.endpointRef)) fail("execution.endpointRef", "is required for HTTP/SSE transports");
    if (!integer(value.execution.concurrency, 1, 1_000)) fail("execution.concurrency", "must be an integer from 1 to 1000");
    if (!integer(value.execution.timeoutMs, 1_000, 86_400_000)) fail("execution.timeoutMs", "must be 1000-86400000");
    if (value.execution.environmentSecretRefs !== undefined) {
      if (!object(value.execution.environmentSecretRefs)) fail("execution.environmentSecretRefs", "must be an object of secret:// references");
      else for (const [key, ref] of Object.entries(value.execution.environmentSecretRefs)) if (!text(ref) || !SECRET_REF.test(ref)) fail(`execution.environmentSecretRefs.${key}`, "literal secrets are forbidden; use secret://");
    }
  }

  if (!object(value.protocol)) fail("protocol", "must be an object");
  else {
    if (!text(value.protocol.minimumVersion)) fail("protocol.minimumVersion", "is required");
    if (!text(value.protocol.testedVersion)) fail("protocol.testedVersion", "is required");
    if (!text(value.protocol.schemaSnapshotHash) || !SHA256.test(value.protocol.schemaSnapshotHash)) fail("protocol.schemaSnapshotHash", "must be a sha256 digest");
  }

  if (!object(value.auth)) fail("auth", "must be an object");
  else {
    if (!AUTH_TYPES.has(String(value.auth.type))) fail("auth.type", "is invalid");
    if (!Array.isArray(value.auth.secretRefs)) fail("auth.secretRefs", "must be an array");
    else for (const [i, ref] of value.auth.secretRefs.entries()) if (!text(ref) || !SECRET_REF.test(ref)) fail(`auth.secretRefs[${i}]`, "literal secrets are forbidden; use secret://");
  }

  if (!object(value.capabilities) || !["tools", "resources", "prompts", "tasks"].every((key) => typeof value.capabilities?.[key] === "boolean")) fail("capabilities", "must declare boolean tools, resources, prompts, and tasks flags");

  if (!Array.isArray(value.tools) || value.tools.length === 0) fail("tools", "must contain at least one tool policy");
  else value.tools.forEach((raw, i) => {
    const path = `tools[${i}]`;
    if (!object(raw)) { fail(path, "must be an object"); return; }
    if (!text(raw.name) || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.name)) fail(`${path}.name`, "is invalid");
    if (!text(raw.inputSchemaHash) || !SHA256.test(raw.inputSchemaHash)) fail(`${path}.inputSchemaHash`, "must be a sha256 digest");
    if (!RISKS.has(raw.risk as ToolRisk)) fail(`${path}.risk`, "is invalid");
    if (!APPROVALS.has(raw.approval as ToolApproval)) fail(`${path}.approval`, "is invalid");
    if (!["required", "supported", "none"].includes(String(raw.idempotency))) fail(`${path}.idempotency`, "is invalid");
    if (!integer(raw.timeoutMs, 1_000, 86_400_000)) fail(`${path}.timeoutMs`, "must be 1000-86400000");
    if (!integer(raw.maxAttempts, 1, 5)) fail(`${path}.maxAttempts`, "must be 1-5");
    if (!Array.isArray(raw.dataClassifications) || raw.dataClassifications.length === 0 || raw.dataClassifications.some((c) => !CLASSES.has(c as DataClassification))) fail(`${path}.dataClassifications`, "must contain approved classifications");
    if (raw.enabledByDefault !== false) fail(`${path}.enabledByDefault`, "must be false (deny by default)");
    if (typeof raw.verificationRequired !== "boolean") fail(`${path}.verificationRequired`, "must be boolean");
    if ((raw.risk === "destructive" || raw.risk === "physical-control") && raw.approval !== "always") fail(`${path}.approval`, `${raw.risk} tools require always`);
    if ((raw.risk === "destructive" || raw.risk === "physical-control") && raw.maxAttempts !== 1) fail(`${path}.maxAttempts`, `${raw.risk} tools require exactly one attempt`);
    if ((raw.risk === "mutate" || raw.risk === "destructive") && raw.checkpointRequired !== true) fail(`${path}.checkpointRequired`, `${raw.risk} tools require a checkpoint`);
    if ((raw.risk === "mutate" || raw.risk === "destructive") && raw.verificationRequired !== true) fail(`${path}.verificationRequired`, `${raw.risk} tools require verification`);
    if (raw.risk === "mutate" && !["policy", "always"].includes(String(raw.approval))) fail(`${path}.approval`, "mutate tools require policy or always");
  });

  if (!object(value.operations)) fail("operations", "must be an object");
  else {
    if (!text(value.operations.healthTool)) fail("operations.healthTool", "is required");
    if (value.operations.killSwitch !== true) fail("operations.killSwitch", "must be true");
    if (typeof value.operations.rollbackSupported !== "boolean") fail("operations.rollbackSupported", "must be boolean");
    if (!text(value.operations.supportRunbookRef)) fail("operations.supportRunbookRef", "is required");
  }

  return { ok: errors.length === 0, errors };
}
