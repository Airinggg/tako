import type { DraftSkill } from "./extract.ts";

/** Render a draft skill as a reviewable SKILL.md (NOT published — status: draft). */
export function renderDraft(draft: DraftSkill, extractedFrom: string, extractedAt = new Date().toISOString()): { path: string; markdown: string } {
  const fm = [
    "---",
    `name: ${draft.name}`,
    "version: 0.0.1",
    "status: draft",
    `description: ${JSON.stringify(draft.description)}`,
    "triggers:",
    ...(draft.triggers.length ? draft.triggers.map((t) => `  - ${JSON.stringify(t)}`) : ['  - "REVIEW: no triggers extracted"']),
    "reads:",
    ...(draft.sources.length
      ? draft.sources.map((s) => `  - ${s}   # inferred from the pages the procedure cited`)
      : ["  - REVIEW   # no source inferred — set the ids this skill needs to read"]),
    'reads_note: "A scope grants this skill only if its federated-read covers every id in `reads`."',
    "mutating: false",
    "writes_pages: false",
    `extracted_from: ${extractedFrom}`,
    `extracted_at: ${extractedAt}`,
    "---",
  ].join("\n");

  const body = [
    `# ${draft.name}  (DRAFT — human review required)`,
    "",
    "> Auto-extracted from ingested content by `npm run skills:extract`. Do NOT",
    "> treat as an active skill. To promote it:",
    "> 1. Check the steps and triggers against reality; edit freely.",
    `> 2. Move this file to \`brain-sources/${extractedFrom}/skills/${draft.name}/SKILL.md\` and drop the \`status: draft\` line.`,
    `> 3. Add a row to \`brain-sources/${extractedFrom}/skills/RESOLVER.md\`.`,
    "> 4. `git commit` the source repo, then `gbrain sync --source " + extractedFrom + "`.",
    "",
    "## Procedure",
    "",
    ...draft.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    draft.sources.length ? `**Sources touched:** ${draft.sources.join(", ")}` : "",
    "",
    "## Evidence the model used",
    "",
    ...(draft.evidence.length ? draft.evidence.map((e) => `- ${e}`) : ["- (none provided — scrutinise this draft)"]),
    "",
  ].join("\n");

  return { path: `${extractedFrom}/${draft.name}.md`, markdown: `${fm}\n\n${body}` };
}
