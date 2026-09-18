import { readFile } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { writePrivateFileAtomic } from "../../util/private-file.ts";
import type { MeetingInboxConfig, MeetingInboxWorkspace } from "../meetings/inbox.ts";

export type NotionConnectorConfig = {
  token: string;
  sourceDir: string;
  subdir: string;
  databases: string[];
  pages: string[];
  notionVersion: string;
};

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function asStrings(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`${path} must be an array of strings`);
  return value;
}

export function resolveSecret(value: string, env: Record<string, string | undefined> = process.env): string {
  if (!value.startsWith("env:")) return value;
  const name = value.slice(4);
  const resolved = env[name];
  if (!name || !resolved) throw new Error(`Environment variable ${name || "<missing>"} is required`);
  return resolved;
}

export type SlackConnectorConfig = {
  token: string;
  sourceDir: string;
  subdir: string;
  channels: string[];
  includeThreads: boolean;
  lookbackDays: number;
};

function asBool(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
}

function asNumber(value: unknown, path: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${path} must be a positive number`);
  return value;
}

function asRelativeSubdir(value: unknown, path: string): string {
  const subdir = asString(value, path);
  const normalized = normalize(subdir);
  if (isAbsolute(normalized) || normalized === "." || normalized === ".." || normalized.startsWith(`..${process.platform === "win32" ? "\\\\" : "/"}`)) {
    throw new Error(`${path} must be a non-empty relative directory within sourceDir`);
  }
  return normalized;
}

async function loadSection(path: string, key: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || !(key in parsed)) throw new Error(`config.${key} is required`);
  const section = (parsed as Record<string, unknown>)[key];
  if (!section || typeof section !== "object") throw new Error(`config.${key} must be an object`);
  return section as Record<string, unknown>;
}

export async function loadNotionConfig(path = "config/connectors.json"): Promise<NotionConnectorConfig> {
  const value = await loadSection(path, "notion");
  return {
    token: resolveSecret(asString(value.token, "notion.token")),
    sourceDir: asString(value.sourceDir, "notion.sourceDir"),
    subdir: asRelativeSubdir(value.subdir, "notion.subdir"),
    databases: asStrings(value.databases, "notion.databases"),
    pages: asStrings(value.pages, "notion.pages"),
    notionVersion: asString(value.notionVersion, "notion.notionVersion"),
  };
}

export async function loadSlackConfig(path = "config/connectors.json"): Promise<SlackConnectorConfig> {
  const value = await loadSection(path, "slack");
  return {
    token: resolveSecret(asString(value.token, "slack.token")),
    sourceDir: asString(value.sourceDir, "slack.sourceDir"),
    subdir: asRelativeSubdir(value.subdir, "slack.subdir"),
    channels: asStrings(value.channels, "slack.channels"),
    includeThreads: asBool(value.includeThreads, "slack.includeThreads", true),
    lookbackDays: asNumber(value.lookbackDays, "slack.lookbackDays", 30),
  };
}

export type NotesConnectorConfig = {
  sourceDir: string;
  subdir: string;
  roots: string[];
  extensions: string[];
};

export async function loadNotesConfig(path = "config/connectors.json"): Promise<NotesConnectorConfig> {
  const value = await loadSection(path, "notes");
  const extensions = value.extensions === undefined ? [".md", ".markdown", ".txt"] : asStrings(value.extensions, "notes.extensions");
  return {
    sourceDir: asString(value.sourceDir, "notes.sourceDir"),
    subdir: asRelativeSubdir(value.subdir, "notes.subdir"),
    roots: asStrings(value.roots, "notes.roots"),
    extensions: extensions.map((ext) => (ext.startsWith(".") ? ext : `.${ext}`).toLowerCase()),
  };
}

export type DriveConnectorConfig = { token: string; sourceDir: string; subdir: string; folderIds: string[] };

export async function loadDriveConfig(path = "config/connectors.json"): Promise<DriveConnectorConfig> {
  const value = await loadSection(path, "drive");
  return {
    token: resolveSecret(asString(value.token, "drive.token")),
    sourceDir: asString(value.sourceDir, "drive.sourceDir"),
    subdir: asRelativeSubdir(value.subdir, "drive.subdir"),
    folderIds: asStrings(value.folderIds, "drive.folderIds"),
  };
}

export type DiscordConnectorConfig = {
  token: string;
  sourceDir: string;
  subdir: string;
  guildId: string;
  channels: string[];
  includeThreads: boolean;
  lookbackDays: number;
};

export async function loadDiscordConfig(path = "config/connectors.json"): Promise<DiscordConnectorConfig> {
  const value = await loadSection(path, "discord");
  return {
    token: resolveSecret(asString(value.token, "discord.token")),
    sourceDir: asString(value.sourceDir, "discord.sourceDir"),
    subdir: asRelativeSubdir(value.subdir, "discord.subdir"),
    guildId: asString(value.guildId, "discord.guildId"),
    channels: asStrings(value.channels, "discord.channels"),
    includeThreads: asBool(value.includeThreads, "discord.includeThreads", true),
    lookbackDays: asNumber(value.lookbackDays, "discord.lookbackDays", 30),
  };
}

export type CadConnectorConfig = {
  sourceDir: string;
  subdir: string;
  /** One metadata export per CAD system, produced on the machine where that
   *  system / PDM runs. JSON array or CSV. No CAD binaries are parsed. */
  systems: Record<string, { exportFile: string }>;
};

export type McpServerEntry = {
  /** Streamable-HTTP endpoint … */
  url?: string;
  headers?: Record<string, string>;
  /** … or a local stdio command. Exactly one of url / command. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Reviewed connector manifest. Required before the connector can execute. */
  manifest: string;
  source?: string;
  readSources?: string[];
  dataClass?: "public" | "internal" | "confidential" | "restricted" | "export-controlled";
  environment?: "dev" | "prod";
};
export type McpConnectorConfig = {
  sourceDir: string;
  subdir: string;
  /** Read-only MCP servers to federate, keyed by a short name. */
  servers: Record<string, McpServerEntry>;
};

export async function loadMcpConfig(path = "config/connectors.json"): Promise<McpConnectorConfig> {
  const value = await loadSection(path, "mcp");
  const raw = value.servers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error('mcp.servers must be an object like { "confluence": { "url": "https://…/mcp" } }');
  }
  const servers: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    const e = (entry ?? {}) as Record<string, unknown>;
    const url = typeof e.url === "string" ? e.url : undefined;
    const command = typeof e.command === "string" ? e.command : undefined;
    if (!url && !command) throw new Error(`mcp.servers.${name} needs a "url" or a "command"`);
    const manifest = asString(e.manifest, `mcp.servers.${name}.manifest`);
    servers[name] = {
      url, command, manifest,
      args: Array.isArray(e.args) ? e.args.map(String) : undefined,
      headers: (e.headers && typeof e.headers === "object") ? e.headers as Record<string, string> : undefined,
      env: (e.env && typeof e.env === "object") ? e.env as Record<string, string> : undefined,
      source: typeof e.source === "string" ? e.source : undefined,
      readSources: Array.isArray(e.readSources) ? e.readSources.map(String) : undefined,
      dataClass: ["public", "internal", "confidential", "restricted", "export-controlled"].includes(String(e.dataClass)) ? e.dataClass as McpServerEntry["dataClass"] : undefined,
      environment: e.environment === "prod" ? "prod" : "dev",
    };
  }
  if (Object.keys(servers).length === 0) throw new Error("mcp.servers has no entries");
  return {
    sourceDir: asString(value.sourceDir, "mcp.sourceDir"),
    subdir: asRelativeSubdir(value.subdir, "mcp.subdir"),
    servers,
  };
}

export async function loadCadConfig(path = "config/connectors.json"): Promise<CadConnectorConfig> {
  const value = await loadSection(path, "cad");
  const raw = value.systems;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error('cad.systems must be an object like { "solidworks": { "exportFile": "…" } }');
  }
  const systems: Record<string, { exportFile: string }> = {};
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    const e = entry as Record<string, unknown> | undefined;
    systems[name] = { exportFile: asString(e?.exportFile, `cad.systems.${name}.exportFile`) };
  }
  if (Object.keys(systems).length === 0) throw new Error("cad.systems has no entries");
  return {
    sourceDir: asString(value.sourceDir, "cad.sourceDir"),
    subdir: asRelativeSubdir(value.subdir, "cad.subdir"),
    systems,
  };
}

const SAFE_LOCAL_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${path}.${unknown} is not allowed`);
}

/** Load the separate, local-only meeting inbox configuration. */
export async function loadMeetingInboxConfig(path = "config/meeting-inbox.json"): Promise<MeetingInboxConfig> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("meeting inbox config must be an object");
  const root = parsed as Record<string, unknown>;
  exactKeys(root, ["schemaVersion", "inboxRoot", "processedRecoveryDays", "workspaces"], "config");
  if (root.schemaVersion !== "1.0") throw new Error("config.schemaVersion must equal 1.0");
  const inboxRoot = asString(root.inboxRoot, "config.inboxRoot");
  if (!isAbsolute(inboxRoot) || resolve(inboxRoot) !== inboxRoot) throw new Error("config.inboxRoot must be a canonical absolute path");
  if (root.processedRecoveryDays !== 7) throw new Error("config.processedRecoveryDays must equal 7");
  if (!Array.isArray(root.workspaces)) throw new Error("config.workspaces must be an array");

  const workspaces: MeetingInboxWorkspace[] = root.workspaces.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`config.workspaces[${index}] must be an object`);
    const workspace = entry as Record<string, unknown>;
    const prefix = `config.workspaces[${index}]`;
    exactKeys(workspace, ["id", "label", "sourceId", "classification", "retentionDays", "enabled"], prefix);
    const id = asString(workspace.id, `${prefix}.id`);
    const label = asString(workspace.label, `${prefix}.label`);
    const sourceId = asString(workspace.sourceId, `${prefix}.sourceId`);
    if (!SAFE_LOCAL_ID.test(id)) throw new Error(`${prefix}.id must be path-safe lowercase text`);
    if (!SAFE_LOCAL_ID.test(sourceId)) throw new Error(`${prefix}.sourceId must be path-safe lowercase text`);
    if (Array.from(label).length > 120) throw new Error(`${prefix}.label must be at most 120 characters`);
    if (workspace.classification !== "internal") throw new Error(`${prefix}.classification must equal internal`);
    if (!Number.isSafeInteger(workspace.retentionDays) || Number(workspace.retentionDays) < 1 || Number(workspace.retentionDays) > 3650) throw new Error(`${prefix}.retentionDays must be an integer between 1 and 3650`);
    if (typeof workspace.enabled !== "boolean") throw new Error(`${prefix}.enabled must be a boolean`);
    return { id, label, sourceId, classification: "internal", retentionDays: Number(workspace.retentionDays), enabled: workspace.enabled };
  });
  for (const field of ["id", "label", "sourceId"] as const) {
    const values = workspaces.map((workspace) => workspace[field]);
    if (new Set(values).size !== values.length) throw new Error(`config.workspace ${field} values must be unique`);
  }
  return { schemaVersion: "1.0", inboxRoot, processedRecoveryDays: 7, workspaces };
}

/** Publish only the non-secret choices the standalone transcriber needs. */
export function writeMeetingWorkspaceCatalog(config: MeetingInboxConfig, updatedAt = new Date().toISOString()): string {
  const path = join(config.inboxRoot, "workspace-catalog.json");
  const catalog = {
    schemaVersion: "1.0",
    workspaces: config.workspaces.filter((workspace) => workspace.enabled).map(({ id, label, classification }) => ({ id, label, classification })),
    updatedAt,
  };
  writePrivateFileAtomic(path, `${JSON.stringify(catalog, null, 2)}\n`);
  return path;
}
