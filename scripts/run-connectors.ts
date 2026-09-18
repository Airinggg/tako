import { readFile } from "node:fs/promises";
import { CONNECTORS, connectorRunner } from "../lib/connectors/registry.ts";

const configPath = process.env.CONNECTORS_CONFIG_PATH ?? "config/connectors.json";
const meetingConfigPath = process.env.MEETING_INBOX_CONFIG_PATH ?? "config/meeting-inbox.json";
let config: Record<string, Record<string, unknown>> = {};

try {
  config = JSON.parse(await readFile(configPath, "utf8"));
} catch (error: any) {
  if (error?.code !== "ENOENT") throw error;
  console.log(`connector config not found (${configPath}); skipping all connectors`);
}

for (const { name, needsToken } of CONNECTORS) {
  let section = config[name];
  if (name === "meetings") {
    try {
      const meetingConfig = JSON.parse(await readFile(meetingConfigPath, "utf8"));
      if (Array.isArray(meetingConfig.workspaces) && meetingConfig.workspaces.some((workspace: any) => workspace?.enabled === true)) section = { enabled: true };
    } catch { /* optional local workflow is not configured */ }
  }
  if (!section) {
    console.log(`[${name}] skipped: config block absent`);
    continue;
  }
  if (needsToken) {
    const token = section.token;
    const missingToken = typeof token !== "string" || token.length === 0 ||
      (token.startsWith("env:") && !process.env[token.slice(4)]);
    if (missingToken) {
      console.log(`[${name}] skipped: token absent`);
      continue;
    }
  }
  if (process.env.CONNECTORS_DRY_RUN === "1") {
    console.log(`[${name}] ready`);
    continue;
  }
  console.log(`[${name}] running`);
  const child = Bun.spawn(["bun", connectorRunner(name)], {
    stdin: "inherit", stdout: "inherit", stderr: "inherit", env: process.env,
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exit(exitCode);
}
