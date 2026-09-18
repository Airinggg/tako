/**
 * The connector registry — one source of truth for which connectors exist.
 *
 * Every connector follows the same shape: it reads its block from
 * `config/connectors.json` under its own name, is run by
 * `lib/connectors/<name>/run.ts` (exposed as `npm run connectors:<name>`), and
 * writes deterministic Markdown into the git-backed source dir for `gbrain
 * sync`. Because the shape is uniform, the only per-connector facts worth
 * recording are whether it authenticates to a remote service and how often the
 * sync daemon should re-run it.
 *
 * This list used to be copy-pasted into `lib/cli/dispatch.ts`,
 * `scripts/run-connectors.ts`, `scripts/sync-daemon.ts` and `bin/omnibrain`,
 * and the four copies drifted: each grew its own special case for the old
 * `solidworks` alias, and none of them knew about the system-agnostic `cad`
 * connector that replaced it. Import from here instead of redeclaring.
 */

export type ConnectorName = "notion" | "slack" | "drive" | "discord" | "notes" | "cad" | "meetings";

export type ConnectorDescriptor = {
  /** Config key in connectors.json, npm script suffix, and run.ts directory. */
  name: ConnectorName;
  /** Connectors reaching a remote service need `token` resolved before running. */
  needsToken: boolean;
  /** Sync-daemon cadence when the config block omits `intervalSeconds`. */
  defaultIntervalSeconds?: number;
};

export const CONNECTORS: readonly ConnectorDescriptor[] = [
  { name: "notion", needsToken: true },
  { name: "slack", needsToken: true },
  { name: "drive", needsToken: true },
  { name: "discord", needsToken: true },
  { name: "notes", needsToken: false },
  // File-based: every run re-reads a complete CAD metadata export rather than
  // following a cursor, so it runs less often than the API connectors.
  { name: "cad", needsToken: false, defaultIntervalSeconds: 900 },
  { name: "meetings", needsToken: false, defaultIntervalSeconds: 600 },
];

export const CONNECTOR_NAMES: readonly ConnectorName[] = CONNECTORS.map((c) => c.name);

export function isConnectorName(value: string): value is ConnectorName {
  return CONNECTORS.some((c) => c.name === value);
}

export function connectorDescriptor(name: string): ConnectorDescriptor | undefined {
  return CONNECTORS.find((c) => c.name === name);
}

/** Entry point for one connector, relative to the repo root. */
export function connectorRunner(name: ConnectorName): string {
  return `lib/connectors/${name}/run.ts`;
}
