/** `omnibrain setup` — scaffolds config/*.json from the committed
 *  config/*.example.json templates and reports which env vars still need
 *  setting. Never writes a real secret: copies are of the placeholder
 *  templates only, which already use "env:VARNAME" tokens. */
import { chmodSync, copyFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CONNECTORS } from "../lib/connectors/registry.ts";
import { credentialGuidePath, extractEnvPlaceholders, missingEnvVars, planConfigScaffold } from "../lib/cli/setup.ts";

const REPO = join(import.meta.dir, "..");
const CONFIG_DIR = join(REPO, "config");

function main(): void {
  const entries = readdirSync(CONFIG_DIR);
  const exampleNames = entries.filter((f) => f.endsWith(".example.json"));
  const realNames = new Set(entries.filter((f) => f.endsWith(".json") && !f.endsWith(".example.json")));

  const { toCopy, alreadyPresent } = planConfigScaffold(exampleNames, realNames);

  for (const real of toCopy) {
    const example = real.replace(/\.json$/, ".example.json");
    copyFileSync(join(CONFIG_DIR, example), join(CONFIG_DIR, real));
    chmodSync(join(CONFIG_DIR, real), 0o600);
    console.log(`created config/${real} from config/${example}`);
  }
  for (const real of alreadyPresent) {
    console.log(`config/${real} already exists — left untouched`);
  }

  const connectorsPath = join(CONFIG_DIR, "connectors.json");
  if (!existsSync(connectorsPath)) {
    console.log("\nNo config/connectors.json — nothing to check for missing credentials yet.");
    return;
  }

  const connectorsConfig = JSON.parse(readFileSync(connectorsPath, "utf8"));
  const placeholders = extractEnvPlaceholders(connectorsConfig);
  const missing = missingEnvVars(placeholders, process.env);

  console.log("\nConnectors configured in config/connectors.json:");
  const configuredNames = CONNECTORS.filter((c) => connectorsConfig[c.name]).map((c) => c.name);
  if (!configuredNames.length) {
    console.log("- none yet — edit config/connectors.json to enable one (see config/connectors.example.json for the shape).");
  }
  for (const name of configuredNames) {
    const needsToken = CONNECTORS.find((c) => c.name === name)?.needsToken;
    console.log(needsToken
      ? `- ${name}: see ${credentialGuidePath(name)} for how to get its credentials`
      : `- ${name}: no external credentials needed`);
  }

  if (missing.length) {
    console.log("\nEnvironment variables still needed:");
    for (const name of missing) console.log(`- ${name} (not set)`);
    console.log("\nSet these in your shell profile, then run `omnibrain doctor` to confirm.");
  } else if (placeholders.size) {
    console.log("\nAll referenced environment variables are already set.");
  }
}

main();
