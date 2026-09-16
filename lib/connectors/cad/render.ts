import { slugify, yamlString } from "../shared/markdown.ts";
import type { CadDoc } from "./collect.ts";

/** One deterministic Markdown page per CAD document, filed under
 *  cad/<system>/<type>/<part>.md so systems (solidworks, catia…) don't collide. */
export function renderCad(doc: CadDoc): { path: string; markdown: string } {
  const base = slugify(doc.partNumber || doc.name.replace(/\.[^.]+$/, "") || "part");
  const path = `cad/${slugify(doc.system || "cad")}/${doc.type === "unknown" ? "doc" : doc.type}/${base}.md`;

  const fm = [
    "---",
    "source: cad",
    `cad_system: ${yamlString(doc.system)}`,
    `doc_type: ${doc.type}`,
    `part_number: ${yamlString(doc.partNumber)}`,
    `name: ${yamlString(doc.name)}`,
    `title: ${yamlString(doc.description || doc.partNumber || doc.name)}`,
    doc.revision ? `revision: ${yamlString(doc.revision)}` : "",
    doc.material ? `material: ${yamlString(doc.material)}` : "",
    doc.state ? `state: ${yamlString(doc.state)}` : "",
    doc.configuration ? `configuration: ${yamlString(doc.configuration)}` : "",
    doc.modifiedBy ? `modified_by: ${yamlString(doc.modifiedBy)}` : "",
    doc.modifiedAt ? `updated: ${yamlString(doc.modifiedAt)}` : "",
    "---",
  ].filter(Boolean).join("\n");

  const lines: string[] = [`# ${doc.partNumber || doc.name}${doc.revision ? `  (rev ${doc.revision})` : ""}`, ""];
  if (doc.description) lines.push(doc.description, "");

  const facts: [string, string][] = [
    ["Type", doc.type],
    ["Part number", doc.partNumber],
    ["File", doc.name],
    ["Revision", doc.revision],
    ["Material", doc.material],
    ["Configuration", doc.configuration],
    ["PDM state", doc.state],
    ["Last modified", [doc.modifiedBy, doc.modifiedAt].filter(Boolean).join(" · ")],
  ].filter(([, v]) => v);
  if (facts.length) {
    lines.push("| Field | Value |", "| --- | --- |");
    for (const [k, v] of facts) lines.push(`| ${k} | ${v} |`);
    lines.push("");
  }

  if (doc.children.length) {
    lines.push("## Bill of materials", "", "| Part number | Description | Qty |", "| --- | --- | ---: |");
    for (const c of doc.children) lines.push(`| ${c.partNumber} | ${c.description} | ${c.quantity} |`);
    lines.push("");
  }
  if (doc.whereUsed.length) lines.push("## Where used", "", doc.whereUsed.map((p) => `- ${p}`).join("\n"), "");
  if (doc.drawings.length) lines.push("## Drawings", "", doc.drawings.map((d) => `- ${d}`).join("\n"), "");

  const extra = Object.entries(doc.props);
  if (extra.length) {
    lines.push("## Custom properties", "", "| Property | Value |", "| --- | --- |");
    for (const [k, v] of extra) lines.push(`| ${k} | ${String(v).replace(/\|/g, "\\|")} |`);
    lines.push("");
  }
  if (doc.notes) lines.push("## Notes", "", doc.notes, "");

  return { path, markdown: `${fm}\n\n${lines.join("\n").trimEnd()}\n` };
}
