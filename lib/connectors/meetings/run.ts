import { resolve } from "node:path";
import { loadMeetingInboxConfig, writeMeetingWorkspaceCatalog } from "../shared/config.ts";
import { ensureMeetingInbox } from "./inbox.ts";
import { importReadyMeetings } from "./import.ts";

const repo = resolve(import.meta.dir, "../../..");
const configPath = process.env.MEETING_INBOX_CONFIG_PATH ?? resolve(repo, "config/meeting-inbox.json");
const config = await loadMeetingInboxConfig(configPath);
await ensureMeetingInbox(config);
writeMeetingWorkspaceCatalog(config);
const result = await importReadyMeetings(config, {
  sourceRoot: process.env.MEETING_SOURCE_ROOT ?? resolve(repo, "brain-sources"),
  statePath: process.env.MEETING_IMPORT_STATE_PATH ?? resolve(repo, "config/meeting-import-state.json"),
  receiptsPath: process.env.MEETING_IMPORT_RECEIPTS_PATH ?? resolve(repo, "config/meeting-import-receipts.jsonl"),
  syncLogPath: process.env.SYNC_LOG_PATH ?? resolve(repo, "config/sync-log.jsonl"),
  analysisQueuePath: process.env.MEETING_ANALYSIS_QUEUE_PATH ?? resolve(repo, "config/meeting-analysis-queue.json"),
});
console.log(`meeting import: ${result.processed} processed, ${result.noOp} already present, ${result.quarantined} quarantined, ${result.queued} queued for local review`);
