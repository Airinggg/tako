# Lirem .dmg Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package tako as a `.dmg` the owner can hand to Lirem's Mac — a double-clickable `Install.command` that provisions the machine, pauses for the owner to fill in connector credentials, then installs an always-on `launchd` service.

**Architecture:** Pure decision logic (which install pass to run, how to render the LaunchAgent plist) lives in small, unit-tested `lib/cli/*.ts` modules, mirroring the existing `lib/cli/doctor.ts`/`lib/cli/setup.ts` pattern. `scripts/dmg-install.ts` is the thin orchestration script that calls that logic and does the actual shelling out (Homebrew, Ollama, `launchctl`) and filesystem writes — verified by a manual dry run on a real Mac, not CI, since it's fundamentally a real-machine installer. `scripts/build-dmg.sh` packages the current git-tracked tree (via `git archive`, so a gitignored file — real credentials, local state — can never accidentally ship) plus `Install.command` into a `.dmg` via macOS's built-in `hdiutil`.

**Tech Stack:** Bun/TypeScript for the orchestration and pure-logic pieces (matching the rest of `lib/cli/`), POSIX shell for `Install.command` (must be double-clickable by Finder) and `scripts/build-dmg.sh`, `node:test` per this repo's existing convention for `lib/cli/*.ts` tests.

**Spec:** `docs/superpowers/specs/2026-09-22-lirem-dmg-distribution-design.md`

## Global Constraints

- Mac-only pilot machine — no Docker, no cross-platform installer (spec §0).
- The owner performs the initial install and every future update personally — no self-update mechanism, no "check for updates" UI (spec §1, §3).
- `Install.command` opens Terminal on double-click (standard macOS `.command` behavior) — a terminal step during setup is expected, not something to hide (spec §1).
- Connector credentials are never auto-provisioned — `config/connectors.json` is filled in by the owner by hand, guided by the existing `docs/CONNECTOR_CREDENTIALS.md` (spec §1).
- Reuse `bin/omnibrain doctor`/`bin/omnibrain setup` rather than reimplementing their checks (spec §1, §2).
- No `bun build --compile` binary — run from source via `bun scripts/demo.ts`, exactly as the dev environment already does (spec §2).
- `GBRAIN_HOME` stays at the code's built-in default on Lirem's machine — no `.env` override (spec §4).
- The LaunchAgent (`com.tako.demo`) runs `bun scripts/demo.ts` at login with `KeepAlive: true`, logging to `~/Library/Logs/tako/demo.log`, not `/tmp` (spec §2).
- `Install.command` and the LaunchAgent install step must be idempotent — safe to re-run at any point without clobbering already-completed work or already-entered credentials (spec §5).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/cli/launch-agent.ts` | Pure: render a `launchd` plist XML string from typed options. No filesystem access. |
| `lib/cli/dmg-provision.ts` | Pure: decide which install pass to run (`"provision"` vs `"go-live"`), reusing `lib/cli/setup.ts`'s existing env-placeholder detection. |
| `lib/cli/doctor.ts` | Modified: export the already-existing `REQUIRED_MODELS` list so the installer pulls the exact same models `doctor` checks for, instead of a second hardcoded copy. |
| `scripts/dmg-install.ts` | Orchestration: the actual Homebrew/Ollama/npm/`launchctl` shell-outs and filesystem writes, calling the two pure modules above. |
| `Install.command` | Thin (2-line) double-clickable wrapper that execs `bun scripts/dmg-install.ts`. |
| `scripts/build-dmg.sh` | Packages the git-tracked tree + `Install.command` into `dist/tako-installer.dmg` via `git archive` + `hdiutil`. |
| `docs/DMG_DISTRIBUTION.md` | The update workflow (spec §3) and removal/uninstall command sequence (spec §7) — documented, not scripted, per the spec's own choice not to build an uninstaller. |

---

### Task 1: LaunchAgent plist renderer

**Files:**
- Create: `lib/cli/launch-agent.ts`
- Test: `tests/launch-agent.test.ts`
- Modify: `package.json:12` (register the new test file in the `node --experimental-strip-types --test` list)

**Interfaces:**
- Produces: `type LaunchAgentOptions = { label: string; bunPath: string; scriptPath: string; workingDirectory: string; stdoutPath: string; stderrPath: string }` and `renderLaunchAgentPlist(opts: LaunchAgentOptions): string` — Task 3 imports both.

- [ ] **Step 1: Write the failing test**

Create `tests/launch-agent.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderLaunchAgentPlist } from "../lib/cli/launch-agent.ts";

const SAMPLE_OPTS = {
  label: "com.tako.demo",
  bunPath: "/opt/homebrew/bin/bun",
  scriptPath: "/Users/test/tako/scripts/demo.ts",
  workingDirectory: "/Users/test/tako",
  stdoutPath: "/Users/test/Library/Logs/tako/demo.log",
  stderrPath: "/Users/test/Library/Logs/tako/demo.log",
};

test("renderLaunchAgentPlist produces valid plist XML with the required keys", () => {
  const xml = renderLaunchAgentPlist(SAMPLE_OPTS);
  for (const key of ["Label", "ProgramArguments", "KeepAlive", "StandardOutPath", "StandardErrorPath", "WorkingDirectory"]) {
    assert.match(xml, new RegExp(`<key>${key}</key>`));
  }
  // plutil -lint is macOS's own plist validator -- real syntactic
  // validation, not just "does it look like XML."
  const tmp = join(tmpdir(), `launch-agent-test-${Date.now()}.plist`);
  writeFileSync(tmp, xml);
  try {
    execFileSync("plutil", ["-lint", tmp], { encoding: "utf8" });
  } finally {
    unlinkSync(tmp);
  }
});

test("renderLaunchAgentPlist escapes XML-special characters in paths", () => {
  const xml = renderLaunchAgentPlist({ ...SAMPLE_OPTS, workingDirectory: "/Users/test/tako & co" });
  assert.match(xml, /tako &amp; co/);
  assert.doesNotMatch(xml, /tako & co</);
});

test("renderLaunchAgentPlist sets KeepAlive and RunAtLoad true, for an always-on background service", () => {
  const xml = renderLaunchAgentPlist(SAMPLE_OPTS);
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/launch-agent.test.ts`
Expected: FAIL — `Cannot find module '../lib/cli/launch-agent.ts'`

- [ ] **Step 3: Write the implementation**

Create `lib/cli/launch-agent.ts`:

```typescript
/** Pure LaunchAgent plist rendering -- no filesystem writes here, so this
 *  is directly unit-testable. scripts/dmg-install.ts is the thin caller
 *  that writes the result to ~/Library/LaunchAgents and calls launchctl. */

export type LaunchAgentOptions = {
  label: string;
  bunPath: string;
  scriptPath: string;
  workingDirectory: string;
  stdoutPath: string;
  stderrPath: string;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderLaunchAgentPlist(opts: LaunchAgentOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(opts.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(opts.bunPath)}</string>
    <string>${escapeXml(opts.scriptPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(opts.workingDirectory)}</string>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(opts.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(opts.stderrPath)}</string>
</dict>
</plist>
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/launch-agent.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Register the test in `package.json` and run the full suite**

In `package.json`'s `"test"` script, append `tests/launch-agent.test.ts` to the `node --experimental-strip-types --test` file list (same line Task 1 of the Agent Provisioning plan already extended for `tests/serve-runtime-home.test.ts` — add this new file to that same list).

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add lib/cli/launch-agent.ts tests/launch-agent.test.ts package.json
git commit -m "Add a pure LaunchAgent plist renderer for the .dmg installer"
```

---

### Task 2: Install-pass decision logic

**Files:**
- Create: `lib/cli/dmg-provision.ts`
- Modify: `lib/cli/doctor.ts:12` (export the existing `REQUIRED_MODELS` const instead of leaving it private)
- Test: `tests/dmg-provision.test.ts`
- Modify: `package.json:12` (register the new test file)

**Interfaces:**
- Consumes: `extractEnvPlaceholders(value: unknown, out?: Set<string>): Set<string>` and `missingEnvVars(varNames: Iterable<string>, env: Record<string, string | undefined>): string[]`, both already exported from `lib/cli/setup.ts`.
- Produces: `needsProvisioning(commandFound: boolean): boolean`, `determineInstallPass(connectorsConfigExists: boolean, parsedConnectorsConfig: unknown, env: Record<string, string | undefined>): "provision" | "go-live"`, and (from the `doctor.ts` change) `REQUIRED_MODELS: string[]` — Task 3 imports all three.

- [ ] **Step 1: Write the failing test**

Create `tests/dmg-provision.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { determineInstallPass, needsProvisioning } from "../lib/cli/dmg-provision.ts";

test("needsProvisioning is the inverse of commandFound", () => {
  assert.equal(needsProvisioning(true), false);
  assert.equal(needsProvisioning(false), true);
});

test("determineInstallPass returns provision when connectors.json doesn't exist yet", () => {
  assert.equal(determineInstallPass(false, null, {}), "provision");
});

test("determineInstallPass returns provision when a scaffolded placeholder's env var isn't set", () => {
  const config = { slack: { token: "env:SLACK_BOT_TOKEN" } };
  assert.equal(determineInstallPass(true, config, {}), "provision");
});

test("determineInstallPass returns go-live once the placeholder's env var is set", () => {
  const config = { slack: { token: "env:SLACK_BOT_TOKEN" } };
  assert.equal(determineInstallPass(true, config, { SLACK_BOT_TOKEN: "xoxb-real" }), "go-live");
});

test("determineInstallPass returns go-live when the owner hardcoded a real token directly, bypassing the env: convention", () => {
  const config = { slack: { token: "xoxb-11904732386992-real-token" } };
  assert.equal(determineInstallPass(true, config, {}), "go-live");
});

test("determineInstallPass with a mix of connectors stays in provision until every placeholder is resolved", () => {
  const config = {
    slack: { token: "xoxb-real-token" },
    drive: { token: "env:GOOGLE_DRIVE_ACCESS_TOKEN" },
  };
  assert.equal(determineInstallPass(true, config, {}), "provision");
  assert.equal(determineInstallPass(true, config, { GOOGLE_DRIVE_ACCESS_TOKEN: "ya29.real" }), "go-live");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/dmg-provision.test.ts`
Expected: FAIL — `Cannot find module '../lib/cli/dmg-provision.ts'`

- [ ] **Step 3: Write the implementation**

Create `lib/cli/dmg-provision.ts`:

```typescript
/** Pure decision logic for the .dmg installer (scripts/dmg-install.ts) --
 *  no shelling out or filesystem access here, so this is directly
 *  unit-testable. Mirrors lib/cli/doctor.ts's pattern: pure functions over
 *  already-collected input, with the thin orchestration script doing the
 *  actual process/filesystem work. */
import { extractEnvPlaceholders, missingEnvVars } from "./setup.ts";

/** Given whether a command was found on PATH, decide whether the
 *  installer needs to provision it. Trivial on its own, but named and
 *  exported so scripts/dmg-install.ts's provisioning steps share one
 *  decision point instead of repeating the same inverted boolean check
 *  five times. */
export function needsProvisioning(commandFound: boolean): boolean {
  return !commandFound;
}

/** Which install pass Install.command should run: "provision" (machine
 *  prerequisites + scaffold config, then stop and wait for the owner to
 *  fill in real connector credentials) or "go-live" (credentials are
 *  filled in -- install the LaunchAgent and start the server).
 *
 *  Reuses lib/cli/setup.ts's existing env-placeholder detection rather
 *  than a new heuristic: config/connectors.json still containing an
 *  unfilled "env:VARNAME" placeholder whose env var isn't set counts as
 *  "not ready yet" -- exactly the same signal `omnibrain setup` already
 *  reports to the owner. This also correctly handles an owner who
 *  bypasses the env: convention and hardcodes a real token directly:
 *  extractEnvPlaceholders finds no placeholder for that field, so it
 *  never counts as missing. A connectors.json that doesn't exist yet is
 *  trivially "not ready." */
export function determineInstallPass(
  connectorsConfigExists: boolean,
  parsedConnectorsConfig: unknown,
  env: Record<string, string | undefined>,
): "provision" | "go-live" {
  if (!connectorsConfigExists) return "provision";
  const placeholders = extractEnvPlaceholders(parsedConnectorsConfig);
  const missing = missingEnvVars(placeholders, env);
  return missing.length > 0 ? "provision" : "go-live";
}
```

In `lib/cli/doctor.ts`, change:

```typescript
const REQUIRED_MODELS = ["bge-m3", "qwen2.5:3b-instruct"];
```

to:

```typescript
export const REQUIRED_MODELS = ["bge-m3", "qwen2.5:3b-instruct"];
```

(Only the `export` keyword is added — no other change to this file. This lets `scripts/dmg-install.ts` in Task 3 pull the exact same model list `omnibrain doctor` checks for, instead of a second hardcoded copy the two could drift apart from.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/dmg-provision.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Register the test and confirm no regressions**

Add `tests/dmg-provision.test.ts` to `package.json`'s `"test"` script, same list as Task 1.

Run: `npm test`
Expected: PASS, no regressions (the `doctor.ts` export change is additive — `tests/cli-doctor.test.ts`'s existing imports are unaffected).

- [ ] **Step 6: Commit**

```bash
git add lib/cli/dmg-provision.ts lib/cli/doctor.ts tests/dmg-provision.test.ts package.json
git commit -m "Add install-pass decision logic for the .dmg installer, reusing setup.ts"
```

---

### Task 3: Installer orchestration script

**Files:**
- Create: `scripts/dmg-install.ts`
- Create: `Install.command`
- Test: `tests/dmg-install.test.ts`
- Modify: `package.json:12` (register the new test file)

**Interfaces:**
- Consumes: `REQUIRED_MODELS` (from `lib/cli/doctor.ts`, Task 2), `determineInstallPass` (from `lib/cli/dmg-provision.ts`, Task 2), `renderLaunchAgentPlist`/`LaunchAgentOptions` (from `lib/cli/launch-agent.ts`, Task 1).
- Produces: nothing further tasks import — this is the orchestration endpoint the `.dmg`'s `Install.command` invokes.

This script is a real-machine installer: Homebrew, Ollama, `launchctl`, and network access are not things a CI sandbox can meaningfully exercise. Per the spec (§6), this task's test only guards that the script wires the tested pure functions together correctly (a regression guard against someone reimplementing the decision logic inline and letting it drift) — it does **not** invoke Homebrew/Ollama/launchctl. The real acceptance test for this task is a manual dry run: after this task is committed, run `bun scripts/dmg-install.ts` yourself on a real Mac (or a scratch user account) end to end, and confirm both passes behave as designed, before this ever ships to Lirem's machine. Do not skip that manual check because the automated test passed — the automated test cannot catch a real Homebrew/Ollama/launchctl failure.

- [ ] **Step 1: Write the failing test**

Create `tests/dmg-install.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");

test("dmg-install.ts uses the shared pure decision logic instead of reimplementing it inline", () => {
  const src = readFileSync(join(REPO, "scripts/dmg-install.ts"), "utf8");
  assert.match(src, /from ["']\.\.\/lib\/cli\/dmg-provision\.ts["']/);
  assert.match(src, /determineInstallPass/);
  assert.match(src, /from ["']\.\.\/lib\/cli\/launch-agent\.ts["']/);
  assert.match(src, /renderLaunchAgentPlist/);
  assert.match(src, /from ["']\.\.\/lib\/cli\/doctor\.ts["']/);
  assert.match(src, /REQUIRED_MODELS/);
});

test("dmg-install.ts's go-live pass runs omnibrain doctor before installing the LaunchAgent", () => {
  const src = readFileSync(join(REPO, "scripts/dmg-install.ts"), "utf8");
  const goLiveStart = src.indexOf("async function goLive");
  assert.ok(goLiveStart >= 0, "expected a goLive function");
  const goLiveBody = src.slice(goLiveStart, goLiveStart + 1500);
  const doctorIdx = goLiveBody.indexOf("doctor");
  const launchctlIdx = goLiveBody.indexOf("launchctl");
  assert.ok(doctorIdx >= 0 && launchctlIdx >= 0 && doctorIdx < launchctlIdx, "doctor must run before launchctl load");
});

test("Install.command execs the orchestration script and is marked executable in git", () => {
  const src = readFileSync(join(REPO, "Install.command"), "utf8");
  assert.match(src, /^#!/, "Install.command needs a shebang to be double-clickable by Finder");
  assert.match(src, /dmg-install\.ts/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/dmg-install.test.ts`
Expected: FAIL — `ENOENT` reading `scripts/dmg-install.ts` (file doesn't exist yet)

- [ ] **Step 3: Write the implementation**

Create `scripts/dmg-install.ts`:

```typescript
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
```

Create `Install.command`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec bun scripts/dmg-install.ts
```

- [ ] **Step 4: Make `Install.command` executable and run the test to verify it passes**

```bash
chmod +x Install.command
node --experimental-strip-types --test tests/dmg-install.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Register the test and confirm no regressions**

Add `tests/dmg-install.test.ts` to `package.json`'s `"test"` script, same list as Tasks 1-2.

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Manual dry run (do not skip)**

On your own Mac (or a scratch user account — not Lirem's machine), run `bun scripts/dmg-install.ts` end to end at least once for each pass:
- First run: confirm it provisions correctly (or correctly skips already-installed prerequisites on a dev machine that already has Bun/Ollama), copies to `~/tako`, and stops with the credential-entry message.
- After filling in a test `config/connectors.json`: confirm the second run installs the LaunchAgent, `launchctl load` succeeds, and `http://localhost:4400` opens and responds.
- Confirm re-running a third time (LaunchAgent already installed) reloads cleanly instead of erroring.

Record the outcome in your task report — this is the real acceptance criterion for this task, not just the automated test in Step 4.

- [ ] **Step 7: Commit**

```bash
git add scripts/dmg-install.ts Install.command tests/dmg-install.test.ts package.json
git commit -m "Add the two-pass .dmg install orchestration script"
```

---

### Task 4: `.dmg` packaging script

**Files:**
- Create: `scripts/build-dmg.sh`
- Test: `tests/build-dmg.test.ts`
- Modify: `package.json:12` (register the new test file)

**Interfaces:**
- Consumes: `Install.command` (Task 3) must already exist and be executable in git for this task's test to pass.
- Produces: `dist/tako-installer.dmg` (or a test-supplied output directory) — the final deliverable artifact. No later task consumes this programmatically.

This task's test is a real, executable one (macOS ships `hdiutil` and `git archive` built in — no third-party dependency, no mocking needed).

- [ ] **Step 1: Write the failing test**

Create `tests/build-dmg.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");

test("build-dmg.sh produces a .dmg with Install.command but without .git, node_modules, or gitignored config", () => {
  const outDir = mkdtempSync(join(tmpdir(), "tako-dmg-test-"));
  const dmgPath = join(outDir, "tako-installer.dmg");
  let mountPoint: string | undefined;
  try {
    execFileSync(join(REPO, "scripts/build-dmg.sh"), [outDir], { cwd: REPO, stdio: "pipe" });
    assert.ok(existsSync(dmgPath), "expected the dmg to be created");
    assert.ok(statSync(dmgPath).size > 0, "dmg should not be empty");

    const attachOutput = execFileSync("hdiutil", ["attach", dmgPath, "-nobrowse", "-plist"], { encoding: "utf8" });
    const mountMatch = attachOutput.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/);
    assert.ok(mountMatch, "expected a mount point in hdiutil attach output");
    mountPoint = mountMatch![1];

    const rootEntries = execFileSync("ls", ["-A", mountPoint], { encoding: "utf8" });
    assert.match(rootEntries, /Install\.command/);
    assert.doesNotMatch(rootEntries, /^\.git$/m);
    assert.doesNotMatch(rootEntries, /node_modules/);

    const configEntries = execFileSync("ls", [join(mountPoint, "config")], { encoding: "utf8" });
    assert.match(configEntries, /connectors\.example\.json/, "the example template must ship");
    assert.doesNotMatch(configEntries, /^connectors\.json$/m, "the real, gitignored connectors.json must never ship");
    assert.match(configEntries, /industrial-connectors\.json/, "non-secret checked-in config must still ship");

    const installPerms = execFileSync("ls", ["-l", join(mountPoint, "Install.command")], { encoding: "utf8" });
    assert.match(installPerms, /^-rwx/, "Install.command must be executable on the shipped volume");
  } finally {
    if (mountPoint) execFileSync("hdiutil", ["detach", mountPoint, "-quiet"]);
    rmSync(outDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/build-dmg.test.ts`
Expected: FAIL — `scripts/build-dmg.sh` does not exist

- [ ] **Step 3: Write the implementation**

Create `scripts/build-dmg.sh`:

```bash
#!/usr/bin/env bash
# Builds dist/tako-installer.dmg (or $1/tako-installer.dmg if given) from
# the current git HEAD's tracked files plus Install.command. Using `git
# archive` rather than a hand-maintained exclude list means a gitignored
# file -- real connector credentials, local sync state -- can never
# accidentally end up in a customer's .dmg: git itself is the single
# source of truth for what ships.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$REPO_ROOT/dist}"

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

DEST="$STAGING/tako"
mkdir -p "$DEST"
git -C "$REPO_ROOT" archive HEAD | tar -x -C "$DEST"

chmod +x "$DEST/Install.command"

mkdir -p "$OUT_DIR"
OUT_PATH="$OUT_DIR/tako-installer.dmg"
rm -f "$OUT_PATH"

hdiutil create -volname "tako installer" -srcfolder "$DEST" -ov -format UDZO "$OUT_PATH"

echo "Built $OUT_PATH"
```

```bash
chmod +x scripts/build-dmg.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/build-dmg.test.ts`
Expected: PASS (1 test — this test actually shells out to `git archive` and `hdiutil`, mounts and unmounts a real disk image; it takes longer than the other unit tests in this plan, which is expected)

- [ ] **Step 5: Register the test and confirm no regressions**

Add `tests/build-dmg.test.ts` to `package.json`'s `"test"` script, same list as Tasks 1-3.

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-dmg.sh tests/build-dmg.test.ts package.json
git commit -m "Add the .dmg packaging script (git archive + hdiutil)"
```

---

### Task 5: Update and removal documentation

**Files:**
- Create: `docs/DMG_DISTRIBUTION.md`

**Interfaces:**
- Consumes: nothing programmatically — this is documentation for the owner, referencing the LaunchAgent label/paths Task 3 defines (`com.tako.demo`, `~/tako`, `~/Library/LaunchAgents/com.tako.demo.plist`).
- Produces: nothing further tasks import.

- [ ] **Step 1: Write the doc**

Create `docs/DMG_DISTRIBUTION.md`:

```markdown
# Distributing tako to Lirem as a `.dmg`

See `docs/superpowers/specs/2026-09-22-lirem-dmg-distribution-design.md`
for the full design. This doc covers the two things the owner does
*after* the initial install: shipping an update, and removing tako from
a machine entirely.

## Building the installer

```bash
./scripts/build-dmg.sh
```

Produces `dist/tako-installer.dmg`. Hand that file to whoever is doing the
install (yourself, on-site or via remote access at Lirem).

## Installing (first time)

1. Mount the `.dmg`, double-click `Install.command` (opens Terminal).
2. It provisions the machine (Homebrew, `bun`, `ollama`, the required
   models, `~/tako`, `npm install`, `omnibrain setup`) and then stops,
   printing where to fill in real connector credentials.
3. Fill in `~/tako/config/connectors.json` (see
   `docs/CONNECTOR_CREDENTIALS.md` for each connector's token guide).
4. Re-run `Install.command`. This time it installs and starts the
   `com.tako.demo` LaunchAgent and opens `http://localhost:4400`.

## Updating

There is no self-update mechanism (by design — see the spec's non-goals).
To ship a fix or new feature to the pilot machine:

```bash
cd ~/tako
git pull                      # or: git cherry-pick <sha> for a scoped fix
npm install                   # only if dependencies changed
launchctl unload ~/Library/LaunchAgents/com.tako.demo.plist
launchctl load ~/Library/LaunchAgents/com.tako.demo.plist
```

The server restarts running the new code. Check
`~/Library/Logs/tako/demo.log` to confirm it came back up cleanly.

## Removing tako from a machine

```bash
launchctl unload ~/Library/LaunchAgents/com.tako.demo.plist
rm ~/Library/LaunchAgents/com.tako.demo.plist
rm -rf ~/tako
rm -rf ~/Library/Logs/tako
brew uninstall ollama bun     # only if nothing else on the machine needs them
```

Nothing tako-owned exists outside `~/tako`, the one LaunchAgent file, and
`~/Library/Logs/tako` — this is the complete removal list.
```

- [ ] **Step 2: Commit**

```bash
git add docs/DMG_DISTRIBUTION.md
git commit -m "Document the .dmg update and removal workflow"
```

---

## Self-Review

**Spec coverage:**
- §0 Objective (a `.dmg` for a Mac pilot machine) — Tasks 3-4 (installer + packaging).
- §1 Non-goals (no signed `.app`, no self-update, terminal is fine, no auto credential provisioning, reuse `doctor`/`setup`) — reflected in Global Constraints and Task 3's design (calls `bin/omnibrain doctor`/`setup` rather than reimplementing).
- §2 Architecture (two-pass install, no compiled binary, `~/tako` install location, idempotency) — Task 3.
- §3 Update workflow — Task 5's doc.
- §4 `GBRAIN_HOME` default — Global Constraints; Task 3 never sets or overrides it.
- §5 Error handling (precondition checks, hard stop on `doctor` failure, safe re-run of the LaunchAgent install) — Task 3's `provisionMachine`/`goLive` logic and Step 6's manual dry run explicitly exercises the re-run case.
- §6 Testing strategy (pure functions unit-tested, real `.dmg`/plist validated for real, the shell orchestration verified by manual dry run not fake CI) — Tasks 1, 2, 4 use real validation (`plutil -lint`, a real `hdiutil`-built and mounted `.dmg`); Task 3 explicitly documents the manual-dry-run requirement instead of inventing a mock.
- §7 Removal/fallback — Task 5's doc, no script built (per the spec's own choice).

**Placeholder scan:** no "TBD"/"TODO"/"add appropriate X" — every step has real code or a real doc.

**Type consistency:** `LaunchAgentOptions` (Task 1) matches exactly how Task 3 constructs it (`label`, `bunPath`, `scriptPath`, `workingDirectory`, `stdoutPath`, `stderrPath`). `determineInstallPass`'s three-argument signature (Task 2) matches exactly how Task 3 calls it in `main()`. `REQUIRED_MODELS` (Task 2's export from `doctor.ts`) matches how Task 3 iterates it in `provisionMachine()`.
