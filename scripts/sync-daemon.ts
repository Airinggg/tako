/** Scheduled connector -> source sync runner. Local-only; logs JSONL to stdout. */
import { open, mkdir, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  BRAIN_CLI, BRAIN_PACKAGE, brainEnv, findAlethiaServe, restartAlethiaServe,
  stopAlethiaServe,
} from "../lib/cli/serve-runtime.ts";
import { dueConnectors, type SyncIntervals, type SyncScheduleState } from "../lib/sync/schedule.ts";
import { loadSyncState, saveSyncState } from "../lib/sync/state.ts";
import { CONNECTORS, type ConnectorName } from "../lib/connectors/registry.ts";

const REPO = resolve(import.meta.dir, "..");
const CONFIG_PATH = resolve(REPO, process.env.CONNECTORS_CONFIG_PATH ?? "config/connectors.json");
const STATE_PATH = resolve(REPO, process.env.SYNC_STATE_PATH ?? "config/sync-state.json");
const LOCK_PATH = join(REPO, "config/.sync-daemon.lock");
const DEFAULT_INTERVAL_SECONDS = 300;

type ConnectorConfig = Record<string, unknown> & { subdir: string; intervalSeconds?: number };
type ParsedFlags = { once: boolean; intervalSeconds: number };

let shuttingDown = false;
let activeChild: ReturnType<typeof Bun.spawn> | null = null;
let wakeSleep: (() => void) | null = null;

function log(action: string, status: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), action, status, ...details }));
}

function parseFlags(argv: readonly string[]): ParsedFlags {
  let once = false;
  let intervalSeconds = DEFAULT_INTERVAL_SECONDS;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--once") once = true;
    else if (flag === "--watch") continue;
    else if (flag === "--interval") {
      intervalSeconds = Number(argv[++index]);
      if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) throw new Error("--interval requires a positive number of seconds");
    } else if (flag === "--help" || flag === "-h") {
      console.log("Usage: bun scripts/sync-daemon.ts [--once] [--interval <sec>]");
      process.exit(0);
    } else throw new Error(`unknown flag: ${flag}`);
  }
  return { once, intervalSeconds };
}

async function configuredConnectors(): Promise<Map<ConnectorName, ConnectorConfig>> {
  const parsed: unknown = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("connector config must be an object");
  const result = new Map<ConnectorName, ConnectorConfig>();
  const root = parsed as Record<string, unknown>;
  for (const { name, defaultIntervalSeconds } of CONNECTORS) {
    const section = root[name];
    if (section === undefined) continue;
    if (!section || typeof section !== "object" || Array.isArray(section)) throw new Error(`${name} config must be an object`);
    const config = section as Record<string, unknown>;
    if (typeof config.subdir !== "string" || !config.subdir) throw new Error(`${name}.subdir must identify its GBrain source`);
    if (config.intervalSeconds !== undefined && (typeof config.intervalSeconds !== "number" || !Number.isFinite(config.intervalSeconds) || config.intervalSeconds <= 0)) {
      throw new Error(`${name}.intervalSeconds must be a positive number`);
    }
    result.set(name, {
      ...config,
      ...(config.intervalSeconds === undefined && defaultIntervalSeconds !== undefined
        ? { intervalSeconds: defaultIntervalSeconds }
        : {}),
    } as ConnectorConfig);
  }
  return result;
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function acquireLock(): Promise<() => Promise<void>> {
  await mkdir(join(REPO, "config"), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(LOCK_PATH, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
      return async () => {
        await handle.close();
        try {
          const state = JSON.parse(await readFile(LOCK_PATH, "utf8"));
          if (state.pid === process.pid) await unlink(LOCK_PATH);
        } catch { /* already removed */ }
      };
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      let pid = 0;
      try { pid = Number(JSON.parse(await readFile(LOCK_PATH, "utf8")).pid); } catch { /* corrupt lock is stale */ }
      if (pid > 0 && isAlive(pid)) throw new Error(`sync daemon already running (pid ${pid})`);
      try { await unlink(LOCK_PATH); } catch { /* another process won the stale-lock race */ }
    }
  }
  throw new Error("could not acquire sync daemon lock");
}

function message(output: string): string {
  return output.trim().split(/\r?\n/).filter(Boolean).at(-1)?.replace(/\s+/g, " ").slice(0, 500) ?? "command failed";
}

async function runChild(command: string[], cwd: string, env: Record<string, string | undefined>): Promise<void> {
  const child = Bun.spawn(command, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  activeChild = child;
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const [exitCode, out, err] = await Promise.all([child.exited, stdout, stderr]);
  activeChild = null;
  if (exitCode !== 0) throw new Error(message(err || out));
}

async function processConnector(
  connector: ConnectorName,
  config: ConnectorConfig,
  state: SyncScheduleState,
): Promise<void> {
  let phase = "connector";
  let serving: ReturnType<typeof findAlethiaServe> = null;
  log("connector", "started", { connector });
  try {
    await runChild(["npm", "run", `connectors:${connector}`], REPO, brainEnv());
    log("connector", "succeeded", { connector });
    if (shuttingDown) throw new Error("shutdown requested");

    phase = "serve_stop";
    const detected = findAlethiaServe();
    if (detected) log("serve", "stopping", { connector, pid: detected.pid, port: detected.port });
    serving = await stopAlethiaServe();
    if (serving) log("serve", "stopped", { connector, pid: serving.pid, port: serving.port });

    phase = "sync";
    log("gbrain_sync", "started", { connector, source: config.subdir });
    await runChild(["bun", BRAIN_CLI, "sync", "--source", config.subdir, "--working-tree"], BRAIN_PACKAGE, brainEnv());
    log("gbrain_sync", "succeeded", { connector, source: config.subdir });

    phase = "embed";
    log("gbrain_embed", "started", { connector, source: config.subdir });
    await runChild(["bun", BRAIN_CLI, "embed", "--all"], BRAIN_PACKAGE, brainEnv());
    log("gbrain_embed", "succeeded", { connector, source: config.subdir });

    state[connector] = { lastRunAt: new Date().toISOString(), lastStatus: "success", consecutiveFailures: 0 };
  } catch (error) {
    if (!shuttingDown) {
      const failures = (state[connector]?.consecutiveFailures ?? 0) + 1;
      state[connector] = { lastRunAt: new Date().toISOString(), lastStatus: "failure", consecutiveFailures: failures };
      log(phase, "failed", { connector, source: config.subdir, consecutiveFailures: failures, error: (error as Error).message });
    }
  } finally {
    if (serving) {
      try {
        restartAlethiaServe(serving);
        log("serve", "restarted", { connector, port: serving.port });
      } catch (error) {
        log("serve", "failed", { connector, port: serving.port, error: (error as Error).message });
      }
    }
    await saveSyncState(state, STATE_PATH);
  }
}

async function tick(defaultIntervalMs: number, state: SyncScheduleState): Promise<void> {
  const connectors = await configuredConnectors();
  const intervalConfig: SyncIntervals = {
    defaultIntervalMs,
    connectors: [...connectors.keys()],
    connectorIntervalsMs: Object.fromEntries(
      [...connectors].flatMap(([name, config]) => config.intervalSeconds ? [[name, config.intervalSeconds * 1_000]] : []),
    ),
  };
  const scheduled = Object.fromEntries([...connectors.keys()].map((name) => [name, state[name]]));
  const due = dueConnectors(scheduled, intervalConfig, Date.now());
  log("tick", "evaluated", { configured: [...connectors.keys()], due });
  for (const connector of due) {
    if (shuttingDown) break;
    await processConnector(connector as ConnectorName, connectors.get(connector as ConnectorName)!, state);
  }
}

async function sleepUntilNextTick(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveSleep) => {
    const timer = setTimeout(() => { wakeSleep = null; resolveSleep(); }, milliseconds);
    wakeSleep = () => { clearTimeout(timer); wakeSleep = null; resolveSleep(); };
  });
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const releaseLock = await acquireLock();
  const stop = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("daemon", "stopping", { signal });
    activeChild?.kill("SIGTERM");
    wakeSleep?.();
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  log("daemon", "started", { once: flags.once, intervalSeconds: flags.intervalSeconds, statePath: STATE_PATH });
  try {
    const state = await loadSyncState(STATE_PATH);
    do {
      await tick(flags.intervalSeconds * 1_000, state);
      if (flags.once || shuttingDown) break;
      await sleepUntilNextTick(flags.intervalSeconds * 1_000);
    } while (!shuttingDown);
  } finally {
    await releaseLock();
    log("daemon", "stopped");
  }
}

main().catch((error) => {
  log("daemon", "failed", { error: (error as Error).message });
  process.exitCode = 1;
});
