import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writePrivateFileAtomic } from "../util/private-file.ts";
import {
  KNOWLEDGE_CLASSIFICATIONS, KNOWLEDGE_ORIGINS, KNOWLEDGE_STATUSES, KNOWLEDGE_TYPES, type KnowledgeItem,
} from "./model.ts";

/** Local, owner-only-permission JSON store for KnowledgeItems — mirrors the
 *  existing config/reviews.json and config/workers-state.json pattern in
 *  this repo (one JSON file, atomic tmp-write-then-rename), but enforces
 *  0600 via the shared writePrivateFileAtomic() helper since knowledge
 *  items, like the review items they route through, are sensitive
 *  operational data, not public content. See spec Part B.5 for why this is
 *  a thin layer beside gbrain rather than a schema change to it. */
export const DEFAULT_KNOWLEDGE_STORE_PATH = join(process.cwd(), "config/knowledge-items.json");

type KnowledgeStoreFile = { items: KnowledgeItem[] };

function isEvidenceAnchor(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.pageSlug === "string"
    && (v.chunkIndex === undefined || typeof v.chunkIndex === "number")
    && (v.excerpt === undefined || typeof v.excerpt === "string");
}

function isKnowledgeItem(value: unknown): value is KnowledgeItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string"
    && KNOWLEDGE_TYPES.includes(v.type as never)
    && typeof v.title === "string"
    && typeof v.description === "string"
    && Array.isArray(v.evidence) && v.evidence.every(isEvidenceAnchor)
    && typeof v.sourceWorkspace === "string"
    && typeof v.sourceConnector === "string"
    && KNOWLEDGE_CLASSIFICATIONS.includes(v.classification as never)
    && KNOWLEDGE_ORIGINS.includes(v.origin as never)
    && KNOWLEDGE_STATUSES.includes(v.status as never)
    && typeof v.ownerId === "string"
    && typeof v.createdAt === "string"
    && (v.sourceUpdatedAt === null || typeof v.sourceUpdatedAt === "string")
    && (v.lastReviewedAt === null || typeof v.lastReviewedAt === "string")
    && (v.nextFreshnessReviewAt === null || typeof v.nextFreshnessReviewAt === "string")
    && Array.isArray(v.relations)
    && Array.isArray(v.reviewHistory)
    && isRetention(v.retention);
}

function isRetention(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.policyRef === "string" && typeof v.deletionImplication === "string";
}

/** Missing or corrupt store files are treated as an empty store, not an
 *  error — the store has no rows before the first item is ever saved. */
export function loadKnowledgeItems(path: string = DEFAULT_KNOWLEDGE_STORE_PATH): KnowledgeItem[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<KnowledgeStoreFile>;
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return items.filter(isKnowledgeItem);
  } catch {
    return [];
  }
}

export function saveKnowledgeItems(items: readonly KnowledgeItem[], path: string = DEFAULT_KNOWLEDGE_STORE_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  const file: KnowledgeStoreFile = { items: [...items] };
  writePrivateFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
}

/** If `path` exists but its raw content does not parse as JSON, best-effort
 *  copy the corrupt bytes aside before they get overwritten by the next
 *  save — otherwise a load-then-save-the-whole-file upsert would silently
 *  destroy whatever was in the file (approved items and their review
 *  history, in the real use case) with no trace it ever existed. A file
 *  that parses fine (even if some rows fail the KnowledgeItem type guard)
 *  is left alone; failure to write the backup must never block the actual
 *  upsert. */
function backUpIfCorrupt(path: string): void {
  try {
    if (!existsSync(path)) return;
    const raw = readFileSync(path, "utf8");
    try {
      JSON.parse(raw);
      return; // parses fine — no backup needed, even if some rows are invalid
    } catch {
      writeFileSync(`${path}.corrupt-${Date.now()}.bak`, raw, "utf8");
    }
  } catch {
    // best-effort only — never block the actual upsert.
  }
}

/** Insert-or-replace by id, then persist the whole store atomically.
 *  Returns the resulting full list, matching lib/review/model.ts-adjacent
 *  callers' habit of reading back the post-write state without a second
 *  disk read. */
export function upsertKnowledgeItem(item: KnowledgeItem, path: string = DEFAULT_KNOWLEDGE_STORE_PATH): KnowledgeItem[] {
  const items = loadKnowledgeItems(path);
  backUpIfCorrupt(path);
  const idx = items.findIndex((i) => i.id === item.id);
  const next = idx >= 0 ? [...items.slice(0, idx), item, ...items.slice(idx + 1)] : [...items, item];
  saveKnowledgeItems(next, path);
  return next;
}

export function getKnowledgeItem(id: string, path: string = DEFAULT_KNOWLEDGE_STORE_PATH): KnowledgeItem | undefined {
  return loadKnowledgeItems(path).find((i) => i.id === id);
}
