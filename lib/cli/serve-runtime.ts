import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gbrainHome } from "../eval/qa.ts";

export const REPO_ROOT = resolve(import.meta.dir, "../..");
export const BRAIN_PACKAGE = join(REPO_ROOT, "packages/brain");
export const BRAIN_CLI = join(BRAIN_PACKAGE, "src/cli.ts");
export const GBRAIN_HOME = gbrainHome();
const SERVE_STATE = join(tmpdir(), `tako-omnibrain-serve-${process.getuid?.() ?? "user"}.json`);

export type ServeProcess = { pid: number; port: number; managed: boolean };

export function brainEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GBRAIN_HOME };
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readManagedServe(): ServeProcess | null {
  if (!existsSync(SERVE_STATE)) return null;
  try {
    const state = JSON.parse(readFileSync(SERVE_STATE, "utf8"));
    if (state.repo === REPO_ROOT && Number.isInteger(state.pid) && Number.isInteger(state.port) && isAlive(state.pid)) {
      return { pid: state.pid, port: state.port, managed: true };
    }
  } catch { /* stale or malformed state */ }
  try { unlinkSync(SERVE_STATE); } catch { /* already gone */ }
  return null;
}

export function findAlethiaServe(): ServeProcess | null {
  const managed = readManagedServe();
  if (managed) return managed;
  // This fallback only matters if the state file above is lost or was never
  // written (e.g. a serve process started outside serveGbrain()) -- the
  // normal path is already fully cross-platform. `ps` itself is Unix-only;
  // rather than reimplement this scan against Windows' very different
  // process-listing tools for a fallback-of-a-fallback, skip it there and
  // rely on the state file, which is how every process this codebase starts
  // is actually tracked.
  if (process.platform === "win32") return null;
  const result = spawnSync("ps", ["eww", "-axo", "pid=,command="], { encoding: "utf8" });
  if (result.status !== 0) return null;
  for (const line of result.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2];
    if (!/src\/cli\.ts\s+serve\b/.test(command) || !command.includes("--http")) continue;
    const isThisRepo = command.includes(BRAIN_CLI);
    const hasProtectedHome = command.includes(`GBRAIN_HOME=${GBRAIN_HOME}`);
    if (!isThisRepo && !hasProtectedHome) continue;
    return { pid, port: Number(command.match(/--port\s+(\d+)/)?.[1] ?? 8787), managed: false };
  }
  return null;
}

export async function stopAlethiaServe(): Promise<ServeProcess | null> {
  const serving = findAlethiaServe();
  if (!serving) return null;
  process.kill(serving.pid, "SIGTERM");
  for (let attempt = 0; attempt < 50 && isAlive(serving.pid); attempt++) await Bun.sleep(100);
  if (isAlive(serving.pid)) throw new Error(`serve process ${serving.pid} did not stop`);
  if (serving.managed) {
    try { unlinkSync(SERVE_STATE); } catch { /* wrapper already cleaned it */ }
  }
  return serving;
}

export function restartAlethiaServe(serving: ServeProcess): void {
  const child = spawn(process.execPath, [join(REPO_ROOT, "bin/omnibrain"), "serve", "--port", String(serving.port)], {
    cwd: REPO_ROOT, detached: true, stdio: "ignore", env: process.env,
  });
  child.unref();
}

function requestedPort(flags: readonly string[]): number {
  const index = flags.indexOf("--port");
  const value = index >= 0 ? Number(flags[index + 1]) : 8787;
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error("--port requires a number from 1 to 65535");
  return value;
}

export async function serveGbrain(flags: string[]): Promise<void> {
  const existing = findAlethiaServe();
  if (existing) throw new Error(`serve is already running on port ${existing.port} (pid ${existing.pid})`);
  const port = requestedPort(flags);
  const cliFlags = flags.includes("--port") ? [...flags] : [...flags, "--port", String(port)];
  const child = spawn("bun", [BRAIN_CLI, "serve", "--http", ...cliFlags], {
    cwd: BRAIN_PACKAGE, env: brainEnv(), stdio: "inherit",
  });
  writeFileSync(SERVE_STATE, JSON.stringify({ pid: process.pid, port, repo: REPO_ROOT, startedAt: new Date().toISOString() }));
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    child.kill(signal);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
  try {
    const current = JSON.parse(readFileSync(SERVE_STATE, "utf8"));
    if (current.pid === process.pid) unlinkSync(SERVE_STATE);
  } catch { /* state was removed by sync */ }
  if (!stopping && exitCode !== 0) throw new Error(`gbrain serve exited ${exitCode}`);
}
