import type { NotionConnectorConfig } from "../shared/config.ts";
import type { NotionRequest } from "./client.ts";

export type NotionRecord = {
  id: string; workspace: string; kind: "page" | "db_row"; title: string; url: string;
  author?: string; createdTime: string; lastEditedTime: string; text: string;
  /** Database column values, name -> rendered string. Omitted when empty. */
  properties?: Record<string, string>;
};

type ApiPage = Record<string, any>;
type ApiList = { results?: any[]; has_more?: boolean; next_cursor?: string | null };
const richText = (parts: any[] | undefined) => (parts ?? []).map((part) => part.plain_text ?? part.text?.content ?? "").join("");
const blockText = (block: any) => {
  const data = block[block.type] ?? {};
  const prefix = block.type === "bulleted_list_item" ? "- " : block.type === "numbered_list_item" ? "1. " : block.type === "to_do" ? `${data.checked ? "- [x] " : "- [ ] "}` : block.type === "heading_1" ? "# " : block.type === "heading_2" ? "## " : block.type === "heading_3" ? "### " : block.type === "callout" ? "> " : "";
  const text = richText(data.rich_text ?? data.text);
  return block.type === "code" ? `\`\`\`${data.language ?? ""}\n${text}\n\`\`\`` : `${prefix}${text}`;
};

/** Render one Notion property value to a plain string. Returns "" when empty. */
function propertyValue(property: any): string {
  const type = property?.type;
  const value = property?.[type];
  switch (type) {
    case "title":
    case "rich_text":
      return richText(value);
    case "select":
      return value?.name ?? "";
    case "status":
      return value?.name ?? "";
    case "multi_select":
      return (value ?? []).map((option: any) => option.name).filter(Boolean).join(", ");
    case "date":
      return value ? `${value.start ?? ""}${value.end ? ` → ${value.end}` : ""}` : "";
    case "people":
      return (value ?? []).map((person: any) => person.name ?? person.id).filter(Boolean).join(", ");
    case "number":
      return value === null || value === undefined ? "" : String(value);
    case "checkbox":
      return value ? "yes" : "no";
    case "url":
    case "email":
    case "phone_number":
      return value ?? "";
    case "files":
      return (value ?? []).map((file: any) => file.name ?? file.external?.url ?? file.file?.url).filter(Boolean).join(", ");
    case "relation":
      return (value ?? []).map((relation: any) => relation.id).filter(Boolean).join(", ");
    case "created_by":
    case "last_edited_by":
      return value?.name ?? value?.id ?? "";
    case "formula":
      return propertyValue({ type: value?.type, [value?.type]: value?.[value?.type] });
    case "rollup":
      if (value?.type === "array") return (value.array ?? []).map((entry: any) => propertyValue(entry)).filter(Boolean).join(", ");
      return propertyValue({ type: value?.type, [value?.type]: value?.[value?.type] });
    default:
      return "";
  }
}

/** All non-title, non-audit column values that have content, in Notion's column order. */
function collectProperties(page: ApiPage): Record<string, string> | undefined {
  const skip = new Set(["title", "created_time", "last_edited_time", "created_by", "last_edited_by"]);
  const out: Record<string, string> = {};
  for (const [name, property] of Object.entries(page.properties ?? {}) as [string, any][]) {
    if (skip.has(property?.type)) continue;
    const rendered = propertyValue(property);
    if (rendered) out[name] = rendered;
  }
  return Object.keys(out).length ? out : undefined;
}

function titleOf(page: ApiPage): string {
  for (const property of Object.values(page.properties ?? {}) as any[]) {
    if (property.type === "title") return richText(property.title);
  }
  return richText(page.properties?.title?.title) || "Untitled";
}
async function list(request: NotionRequest, path: string, method: "GET" | "POST" = "GET"): Promise<any[]> {
  const results: any[] = []; let cursor: string | null | undefined;
  do { const separator = path.includes("?") ? "&" : "?"; const target = method === "GET" && cursor ? `${path}${separator}start_cursor=${encodeURIComponent(cursor)}` : path;
    const page = await request(target, method === "POST" ? { method, body: JSON.stringify(cursor ? { start_cursor: cursor } : {}) } : undefined) as ApiList;
    results.push(...(page.results ?? [])); cursor = page.has_more ? page.next_cursor : null;
  } while (cursor); return results;
}
async function toRecord(request: NotionRequest, page: ApiPage, kind: NotionRecord["kind"]): Promise<NotionRecord> {
  const blocks = await list(request, `/blocks/${page.id}/children?page_size=100`);
  const workspace = typeof page.parent?.database_id === "string" ? page.parent.database_id : typeof page.parent?.workspace === "string" ? page.parent.workspace : "default";
  const properties = collectProperties(page);
  const record: NotionRecord = { id: page.id, workspace, kind, title: titleOf(page), url: page.url ?? "", author: page.created_by?.name ?? page.created_by?.id, createdTime: page.created_time, lastEditedTime: page.last_edited_time, text: blocks.map(blockText).filter(Boolean).join("\n\n") };
  if (properties) record.properties = properties;
  return record;
}
export async function collectNotion(request: NotionRequest, config: Pick<NotionConnectorConfig, "databases" | "pages">): Promise<NotionRecord[]> {
  const records: NotionRecord[] = [];
  for (const database of config.databases) for (const page of await list(request, `/databases/${database}/query`, "POST")) records.push(await toRecord(request, page, "db_row"));
  for (const id of config.pages) records.push(await toRecord(request, await request(`/pages/${id}`) as ApiPage, "page"));
  return records.sort((a, b) => a.id.localeCompare(b.id));
}
