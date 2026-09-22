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
