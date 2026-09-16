import { slugify, yamlString } from "../shared/markdown.ts";
import type { NoteRecord } from "./collect.ts";

/** Strip an existing YAML frontmatter block so it doesn't nest inside ours. */
function stripFrontmatter(text: string): string {
  return text.startsWith("---\n") ? text.replace(/^---\n[\s\S]*?\n---\n?/, "") : text;
}

export function renderNote(record: NoteRecord): { path: string; markdown: string } {
  const slugPath = record.relPath.replace(/\.[^.]+$/, "").split("/").map(slugify).join("/");
  const path = `notes/${slugify(record.rootName)}/${slugPath}.md`;

  const frontmatter = [
    "---",
    "source: notes",
    `title: ${yamlString(record.title)}`,
    `path: ${yamlString(record.relPath)}`,
    `root: ${yamlString(record.rootName)}`,
    `updated: ${yamlString(record.updated)}`,
    "---",
  ].join("\n");

  return { path, markdown: `${frontmatter}\n\n${stripFrontmatter(record.text).trim()}\n` };
}
