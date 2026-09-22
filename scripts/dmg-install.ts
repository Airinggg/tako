#!/usr/bin/env bun
/** Orchestrates the two-pass Lirem .dmg install described in
 *  docs/superpowers/specs/2026-09-22-lirem-dmg-distribution-design.md.
 *  Pure decision logic lives in lib/cli/dmg-provision.ts and
 *  lib/cli/launch-agent.ts; this script does the actual shelling out and
 *  filesystem writes. It is a real-machine installer and is verified by a
 *  manual dry run on a real Mac before ever touching Lirem's machine --
 *  it is not, and cannot be, CI-testable end to end. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { REQUIRED_MODELS } from "../lib/cli/doctor.ts";
import { determineInstallPass } from "../lib/cli/dmg-provision.ts";
import { renderLaunchAgentPlist } from "../lib/cli/launch-agent.ts";

const HOME = homedir();
const INSTALL_DIR = join(HOME, "tako");
const LAUNCH_AGENT_LABEL = "com.tako.demo";
const LAUNCH_AGENT_PATH = join(HOME, "Library/LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
const LOG_DIR = join(HOME, "Library/Logs/tako");
const LOG_PATH = join(LOG_DIR, "demo.log");
const CONNECTORS_CONFIG_PATH = join(INSTALL_DIR, "config/connectors.json");
const SOURCE_ROOT = join(import.meta.dir, "..");

function commandFound(name: string): boolean {
  return spawnSync("command", ["-v", name], { shell: true }).status === 0;
}

function run(command: string, args: string[], options: { cwd?: string } = {}): void {
  const result = spawnSync(command, args, { cwd: options.cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status})`);
  }
}

function provisionMachine(): void {
  console.log("=== tako installer: provisioning this machine ===\n");

  if (!commandFound("brew")) {
    console.log("Installing Homebrew...");
    run("/bin/bash", ["-c", '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"']);
  } else {
    console.log("Homebrew already installed, skipping.");
  }

  for (const formula of ["bun", "ollama"]) {
    if (!commandFound(formula)) {
      console.log(`Installing ${formula}...`);
      run("brew", ["install", formula]);
    } else {
      console.log(`${formula} already installed, skipping.`);
    }
  }

  console.log("Starting ollama...");
  spawnSync("brew", ["services", "start", "ollama"]);

  for (const model of REQUIRED_MODELS) {
    console.log(`Pulling model ${model}...`);
    run("ollama", ["pull", model]);
  }

  if (!existsSync(INSTALL_DIR)) {
    console.log(`Copying tako to ${INSTALL_DIR}...`);
    run("cp", ["-R", SOURCE_ROOT, INSTALL_DIR]);
  } else {
    console.log(`${INSTALL_DIR} already exists, leaving it in place.`);
  }

  console.log("Installing dependencies (npm install)...");
  run("npm", ["install"], { cwd: INSTALL_DIR });

  console.log("Scaffolding config...");
  run("bun", ["bin/omnibrain", "setup"], { cwd: INSTALL_DIR });

  console.log(`
Machine provisioning is done.

Next: fill in ${CONNECTORS_CONFIG_PATH} with Lirem's real connector
credentials (see docs/CONNECTOR_CREDENTIALS.md), then re-run
Install.command to go live.
`);
}

async function waitForServer(url: string, attempts = 20, delayMs = 500): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

async function goLive(): Promise<void> {
  console.log("=== tako installer: going live ===\n");

  const doctorResult = spawnSync("bun", ["bin/omnibrain", "doctor"], { cwd: INSTALL_DIR, stdio: "inherit" });
  if (doctorResult.status !== 0) {
    throw new Error("omnibrain doctor reported failing checks -- fix them before going live (see the report above).");
  }

  mkdirSync(LOG_DIR, { recursive: true });

  const bunPath = spawnSync("which", ["bun"], { encoding: "utf8" }).stdout.trim() || "/opt/homebrew/bin/bun";
  const plist = renderLaunchAgentPlist({
    label: LAUNCH_AGENT_LABEL,
    bunPath,
    scriptPath: join(INSTALL_DIR, "scripts/demo.ts"),
    workingDirectory: INSTALL_DIR,
    stdoutPath: LOG_PATH,
    stderrPath: LOG_PATH,
  });

  if (existsSync(LAUNCH_AGENT_PATH)) {
    console.log("LaunchAgent already installed -- reloading with the current config...");
    spawnSync("launchctl", ["unload", LAUNCH_AGENT_PATH]);
  }
  writeFileSync(LAUNCH_AGENT_PATH, plist);
  run("launchctl", ["load", LAUNCH_AGENT_PATH]);

  console.log("Waiting for the server to come up...");
  const ok = await waitForServer("http://localhost:4400");
  if (ok) {
    spawnSync("open", ["http://localhost:4400"]);
    console.log("tako is running at http://localhost:4400");
  } else {
    console.log(`tako did not respond in time -- check ${LOG_PATH} for errors.`);
  }
}

function readConnectorsConfig(): unknown {
  if (!existsSync(CONNECTORS_CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONNECTORS_CONFIG_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const configExists = existsSync(CONNECTORS_CONFIG_PATH);
  const pass = determineInstallPass(configExists, readConnectorsConfig(), process.env);
  if (pass === "provision") {
    provisionMachine();
  } else {
    await goLive();
  }
}

main();
