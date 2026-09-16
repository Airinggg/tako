import { slugify, yamlString } from "../shared/markdown.ts";
import type { NotionRecord } from "./collect.ts";

export function renderNotion(record: NotionRecord): { path: string; markdown: string } {
  const id = record.id.replace(/[^a-zA-Z0-9-]/g, "");
  const path = `notion/${slugify(record.workspace)}/${slugify(record.title)}-${id}.md`;

  const frontmatter = [
    "---",
    `id: ${yamlString(record.id)}`,
    "source: notion",
    `title: ${yamlString(record.title)}`,
    `url: ${yamlString(record.url)}`,
    `author: ${yamlString(record.author)}`,
    `created: ${yamlString(record.createdTime)}`,
    `updated: ${yamlString(record.lastEditedTime)}`,
    "---",
  ].join("\n");

  const sections: string[] = [];
  if (record.properties && Object.keys(record.properties).length) {
    sections.push(`## Properties\n\n${Object.entries(record.properties).map(([name, value]) => `- **${name}:** ${value}`).join("\n")}`);
  }
  if (record.text.trim()) sections.push(record.text.trim());

  const markdown = `${frontmatter}\n\n${sections.join("\n\n")}\n`;
  return { path, markdown };
}
