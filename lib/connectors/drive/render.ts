import { slugify, yamlString } from "../shared/markdown.ts";
import type { DriveFile } from "./collect.ts";
export function renderDrive(file: DriveFile) {
  return { path: `drive/${slugify(file.name)}-${file.id}.md`, markdown: `---\nid: ${yamlString(file.id)}\nsource: google-drive\ntitle: ${yamlString(file.name)}\nurl: ${yamlString(file.webViewLink)}\nupdated: ${yamlString(file.modifiedTime)}\n---\n\n${file.text.trim()}\n` };
}
