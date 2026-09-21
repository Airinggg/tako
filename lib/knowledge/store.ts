import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writePrivateFileAtomic } from "../util/private-file.ts";
import { KNOWLEDGE_STATUSES, KNOWLEDGE_TYPES, type KnowledgeItem } from "./model.ts";

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
    && typeof v.classification === "string"
    && typeof v.origin === "string"
    && KNOWLEDGE_STATUSES.includes(v.status as never)
    && typeof v.ownerId === "string"
    && typeof v.createdAt === "string"
    && (v.sourceUpdatedAt === null || typeof v.sourceUpdatedAt === "string")
    && (v.lastReviewedAt === null || typeof v.lastReviewedAt === "string")
    && (v.nextFreshnessReviewAt === null || typeof v.nextFreshnessReviewAt === "string")
    && Array.isArray(v.relations)
    && Array.isArray(v.reviewHistory)
    && !!v.retention && typeof v.retention === "object";
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
