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

    assert.doesNotMatch(rootEntries, /^cowork$/m, "internal cowork/ notes must not ship");
    assert.doesNotMatch(rootEntries, /^evals$/m, "internal evals/ must not ship");
    assert.doesNotMatch(rootEntries, /^tests$/m, "internal tests/ must not ship");
    const docsEntries = execFileSync("ls", ["-A", join(mountPoint, "docs")], { encoding: "utf8" });
    assert.doesNotMatch(docsEntries, /^superpowers$/m, "internal docs/superpowers/ planning docs must not ship");
  } finally {
    if (mountPoint) execFileSync("hdiutil", ["detach", mountPoint, "-quiet"]);
    rmSync(outDir, { recursive: true, force: true });
  }
});
