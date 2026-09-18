/** `omnibrain doctor` — checks a machine is ready to run this project before
 *  the user hits a confusing failure three steps into setup. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  checkBunVersion, checkConnectorsConfig, checkGbrainHome, checkMeetingInbox, checkModelsPulled,
  checkOllamaRunning, formatReport, parseOllamaTags, type DoctorCheck,
} from "../lib/cli/doctor.ts";
import { loadMeetingInboxConfig } from "../lib/connectors/shared/config.ts";
import { validateMeetingInboxDirectories } from "../lib/connectors/meetings/inbox.ts";

const REPO = join(import.meta.dir, "..");
const GBRAIN_HOME = join(process.env.HOME || "", ".aletheia-brain");
const CONNECTORS_CONFIG = join(REPO, "config/connectors.json");
const MEETING_CONFIG = join(REPO, "config/meeting-inbox.json");

async function fetchPulledModelTags(host: string): Promise<string[]> {
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    return parseOllamaTags(await res.json());
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const checks: DoctorCheck[] = [];
  checks.push(checkBunVersion(Bun.version));

  const ollamaCheck = await checkOllamaRunning();
  checks.push(ollamaCheck);

  const host = process.env.OLLAMA_HOST || "http://localhost:11434";
  const pulledTags = ollamaCheck.ok ? await fetchPulledModelTags(host) : [];
  checks.push(...checkModelsPulled(pulledTags));

  checks.push(checkGbrainHome(existsSync(GBRAIN_HOME), GBRAIN_HOME));
  checks.push(checkConnectorsConfig(existsSync(CONNECTORS_CONFIG), CONNECTORS_CONFIG));
  if (!existsSync(MEETING_CONFIG)) {
    checks.push(checkMeetingInbox(false, false));
  } else {
    try {
      const meetingConfig = await loadMeetingInboxConfig(MEETING_CONFIG);
      const enabled = meetingConfig.workspaces.some((workspace) => workspace.enabled);
      if (enabled) validateMeetingInboxDirectories(meetingConfig);
      checks.push(checkMeetingInbox(true, enabled));
    } catch (error) {
      const invalidLocalState = error instanceof Error && error.message.startsWith("meeting_inbox_");
      checks.push(checkMeetingInbox(true, true, invalidLocalState ? "invalid-local-state" : "invalid-config"));
    }
  }

  console.log(formatReport(checks));
  process.exitCode = checks.some((c) => !c.ok) ? 1 : 0;
}

main();
