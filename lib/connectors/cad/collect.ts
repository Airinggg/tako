import { readFile } from "node:fs/promises";

/**
 * CAD connector — read-only, system-agnostic (SolidWorks, CATIA V5, Fusion,
 * NX…). It does NOT drive the CAD app or parse CAD binaries. On the machine
 * where the CAD tool / PDM runs, a companion exports part / assembly / drawing
 * metadata + BOM to a JSON array or CSV; this reads that file and normalises
 * it. Tako then answers questions about the CAD data ("which parts use
 * 6061?", "what changed in rev C?") — it never creates geometry.
 */

export type CadChild = { partNumber: string; description: string; quantity: number };

export type CadDoc = {
  system: string;             // "solidworks" | "catia" | "fusion" | "nx" | …
  name: string;               // file name, e.g. "gearbox-housing.SLDPRT"
  type: "part" | "assembly" | "drawing" | "unknown";
  partNumber: string;
  description: string;
  material: string;
  revision: string;
  state: string;              // PDM workflow state, e.g. "Released"
  configuration: string;
  modifiedBy: string;
  modifiedAt: string;         // ISO if parseable, else the raw string
  children: CadChild[];       // BOM (assemblies)
  whereUsed: string[];        // part numbers of assemblies that use this
  drawings: string[];         // linked drawing file names
  notes: string;
  props: Record<string, string>; // any custom properties not mapped above
};

// column-name → field, case/space/underscore-insensitive
const MAP: Record<string, keyof CadDoc> = {
  name: "name", filename: "name", file: "name", document: "name",
  partnumber: "partNumber", pn: "partNumber", partno: "partNumber", number: "partNumber",
  description: "description", desc: "description", title: "description",
  material: "material", mat: "material",
  revision: "revision", rev: "revision",
  state: "state", workflowstate: "state", status: "state",
  configuration: "configuration", config: "configuration",
  modifiedby: "modifiedBy", author: "modifiedBy", lastmodifiedby: "modifiedBy", checkedinby: "modifiedBy",
  modifiedat: "modifiedAt", modified: "modifiedAt", date: "modifiedAt", lastmodified: "modifiedAt", checkedin: "modifiedAt",
  type: "type", doctype: "type", documenttype: "type",
  notes: "notes", note: "notes", comments: "notes", comment: "notes",
};

const norm = (k: string) => k.toLowerCase().replace(/[\s_\-./]+/g, "");

function classifyType(raw: string, name: string): CadDoc["type"] {
  const t = raw.toLowerCase();
  // SolidWorks .sldasm/.sldprt/.slddrw · CATIA .CATProduct/.CATPart/.CATDrawing
  // Fusion has no per-file ext · NX .prt (ambiguous — needs the type column)
  if (t.includes("assembl") || t.includes("product") || /\.(sldasm|catproduct|asm)$/i.test(name)) return "assembly";
  if (t.includes("part") || /\.(sldprt|catpart|prt)$/i.test(name)) return "part";
  if (t.includes("draw") || /\.(slddrw|catdrawing|drw|dwg)$/i.test(name)) return "drawing";
  return "unknown";
}

function toIso(raw: string): string {
  const t = Date.parse(raw);
  return Number.isNaN(t) ? raw.trim() : new Date(t).toISOString();
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v ?? "").split(/[;,\n]+/).map((s) => s.trim()).filter(Boolean);
}

function asChildren(v: unknown): CadChild[] {
  if (!Array.isArray(v)) return [];
  return v.map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const pn = String(o.partNumber ?? o.pn ?? o.number ?? o.name ?? "").trim();
    return {
      partNumber: pn,
      description: String(o.description ?? o.desc ?? "").trim(),
      quantity: Number(o.quantity ?? o.qty ?? 1) || 1,
    };
  }).filter((c) => c.partNumber);
}

/** Turn one raw export row into a CadDoc. Unknown columns land in `props`. */
export function normaliseRow(row: Record<string, unknown>, system = "cad"): CadDoc {
  const doc: CadDoc = {
    system, name: "", type: "unknown", partNumber: "", description: "", material: "",
    revision: "", state: "", configuration: "", modifiedBy: "", modifiedAt: "",
    children: [], whereUsed: [], drawings: [], notes: "", props: {},
  };
  let rawType = "";
  for (const [key, value] of Object.entries(row)) {
    const n = norm(key);
    if (n === "children" || n === "bom" || n === "components") { doc.children = asChildren(value); continue; }
    if (n === "whereused" || n === "usedin" || n === "parents") { doc.whereUsed = asList(value); continue; }
    if (n === "drawings" || n === "drawing" || n === "linkeddrawings") { doc.drawings = asList(value); continue; }
    // a nested { props | properties | customProperties } object folds into props
    if ((n === "props" || n === "properties" || n === "customproperties" || n === "attributes")
        && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v !== "" && v != null) doc.props[k] = String(v);
      }
      continue;
    }
    const field = MAP[n];
    if (field === "type") { rawType = String(value ?? ""); continue; }
    if (field) { (doc as Record<string, unknown>)[field] = String(value ?? "").trim(); continue; }
    if (value !== "" && value != null && (typeof value !== "object" || Array.isArray(value))) {
      doc.props[key] = Array.isArray(value) ? value.join(", ") : String(value);
    }
  }
  doc.type = classifyType(rawType, doc.name);
  if (doc.modifiedAt) doc.modifiedAt = toIso(doc.modifiedAt);
  if (!doc.partNumber) doc.partNumber = doc.name.replace(/\.[^.]+$/, "");
  return doc;
}

// ── minimal CSV (comma, double-quote, CRLF-tolerant) ──────────────────────
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "", record: string[] = [], inQ = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { record.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      record.push(field); rows.push(record); field = ""; record = [];
    } else field += c;
  }
  if (field !== "" || record.length) { record.push(field); rows.push(record); }
  const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (nonEmpty.length < 2) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/** Read and normalise one metadata export (JSON array, {rows|documents|parts:[…]},
 *  or CSV). `system` labels the rows (solidworks / catia / …). */
export async function collectCad(exportFile: string, system = "cad"): Promise<CadDoc[]> {
  const text = await readFile(exportFile, "utf8");
  let rows: Record<string, unknown>[] = [];
  const trimmed = text.trimStart();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed
      : Array.isArray(parsed?.rows) ? parsed.rows
      : Array.isArray(parsed?.documents) ? parsed.documents
      : Array.isArray(parsed?.parts) ? parsed.parts
      : [];
  } else {
    rows = parseCsv(text);
  }
  return rows
    .map((r) => normaliseRow(r, system))
    .filter((d) => d.partNumber || d.name)
    .sort((a, b) => a.partNumber.localeCompare(b.partNumber) || a.name.localeCompare(b.name));
}
