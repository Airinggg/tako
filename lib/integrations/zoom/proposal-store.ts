import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writePrivateFileAtomic } from "../../util/private-file.ts";
import type { MeetingProposal, MeetingProposalStatus } from "./proposal.ts";

/** Local, owner-only-permission JSON store for MeetingProposals — mirrors
 *  lib/knowledge/store.ts exactly, including its corrupt-file-backup-
 *  before-overwrite guard (a prior plan's final review hardened this
 *  pattern; this module reuses it rather than re-deriving it). */
export const DEFAULT_PROPOSAL_STORE_PATH = join(process.cwd(), "config/meeting-proposals.json");

type ProposalStoreFile = { proposals: MeetingProposal[] };

const STATUSES: MeetingProposalStatus[] = ["draft", "confirmed", "created"];

function isEvidenceAnchor(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.pageSlug === "string"
    && (v.chunkIndex === undefined || typeof v.chunkIndex === "number")
    && (v.excerpt === undefined || typeof v.excerpt === "string");
}

function isZoomMeeting(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.joinUrl === "string" && typeof v.startUrl === "string";
}

function isMeetingProposal(value: unknown): value is MeetingProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string"
    && typeof v.knowledgeItemId === "string"
    && Array.isArray(v.reasons)
    && typeof v.topic === "string"
    && typeof v.agendaText === "string"
    && Array.isArray(v.evidence) && v.evidence.every(isEvidenceAnchor)
    && (v.proposedStartAt === null || typeof v.proposedStartAt === "string")
    && typeof v.proposedDurationMinutes === "number"
    && Array.isArray(v.participantEmails)
    && STATUSES.includes(v.status as never)
    && typeof v.createdAt === "string"
    && typeof v.createdBy === "string"
    && (v.confirmedAt === null || typeof v.confirmedAt === "string")
    && (v.confirmedBy === null || typeof v.confirmedBy === "string")
    && isZoomMeeting(v.zoomMeeting);
}

/** Missing or corrupt store files are treated as an empty store, not an
 *  error — the store has no rows before the first proposal is ever saved. */
export function loadMeetingProposals(path: string = DEFAULT_PROPOSAL_STORE_PATH): MeetingProposal[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ProposalStoreFile>;
    const proposals = Array.isArray(parsed.proposals) ? parsed.proposals : [];
    return proposals.filter(isMeetingProposal);
  } catch {
    return [];
  }
}

export function saveMeetingProposals(proposals: readonly MeetingProposal[], path: string = DEFAULT_PROPOSAL_STORE_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  const file: ProposalStoreFile = { proposals: [...proposals] };
  writePrivateFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
}

/** If `path` exists but its raw content does not parse as JSON, best-effort
 *  copy the corrupt bytes aside before they get overwritten by the next
 *  save — same guard as lib/knowledge/store.ts's backUpIfCorrupt(). */
function backUpIfCorrupt(path: string): void {
  try {
    if (!existsSync(path)) return;
    const raw = readFileSync(path, "utf8");
    try {
      JSON.parse(raw);
      return;
    } catch {
      writeFileSync(`${path}.corrupt-${Date.now()}.bak`, raw, "utf8");
    }
  } catch {
    // best-effort only — never block the actual upsert.
  }
}

export function upsertMeetingProposal(proposal: MeetingProposal, path: string = DEFAULT_PROPOSAL_STORE_PATH): MeetingProposal[] {
  const proposals = loadMeetingProposals(path);
  backUpIfCorrupt(path);
  const idx = proposals.findIndex((p) => p.id === proposal.id);
  const next = idx >= 0 ? [...proposals.slice(0, idx), proposal, ...proposals.slice(idx + 1)] : [...proposals, proposal];
  saveMeetingProposals(next, path);
  return next;
}

export function getMeetingProposal(id: string, path: string = DEFAULT_PROPOSAL_STORE_PATH): MeetingProposal | undefined {
  return loadMeetingProposals(path).find((p) => p.id === id);
}
