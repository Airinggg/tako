import { yamlString } from "../shared/markdown.ts";
import type { ValidatedMeetingPackage } from "./inbox.ts";

function inline(value: string): string {
  return value.normalize("NFC").replace(/[\r\n\t]+/g, " ").replace(/[\\`*_{}\[\]()#+.!|<>-]/g, "\\$&").trim();
}

function clock(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function fenced(text: string, language = "text"): string {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

/** Render the single canonical, citation-addressable evidence page for one meeting. */
export function renderMeetingEvidence(pkg: ValidatedMeetingPackage): {
  relativePath: string;
  markdown: string;
} {
  const { manifest } = pkg;
  const participantNames = manifest.meeting.participants?.map((person) => person.displayName) ?? [];
  const lines = [
    "---",
    "source: meetings",
    `meeting_id: ${yamlString(manifest.meeting.id)}`,
    `title: ${yamlString(manifest.meeting.title)}`,
    `workspace_id: ${yamlString(manifest.meeting.workspaceId)}`,
    `source_id: ${yamlString(pkg.workspace.sourceId)}`,
    "classification: internal",
    `started_at: ${yamlString(manifest.meeting.startedAt)}`,
    `ended_at: ${yamlString(manifest.meeting.endedAt)}`,
    `timezone: ${yamlString(manifest.meeting.timezone)}`,
    `publisher: ${yamlString(manifest.publisher.displayName)}`,
    `consent_affirmed_at: ${yamlString(manifest.consent.affirmedAt)}`,
    `package_digest: ${yamlString(pkg.packageDigest)}`,
    `transcript_digest: ${yamlString(pkg.transcriptDigest)}`,
    "analysis_status: pending-human-review",
    "---",
    "",
    `# ${inline(manifest.meeting.title)}`,
    "",
    "> This transcript is machine-generated evidence. Check it against the original meeting context. Any decisions, actions, or follow-up suggestions remain pending human review.",
    "",
    "## Meeting details",
    "",
    `- **Workspace:** ${inline(pkg.workspace.label)}`,
    `- **Time:** ${inline(manifest.meeting.startedAt)} – ${inline(manifest.meeting.endedAt)}`,
    `- **Publisher:** ${inline(manifest.publisher.displayName)}`,
    `- **Consent affirmed:** ${inline(manifest.consent.affirmedAt)}`,
  ];

  if (manifest.meeting.organizer) lines.push(`- **Organizer:** ${inline(manifest.meeting.organizer.displayName)}`);
  if (participantNames.length) lines.push(`- **Participants supplied by publisher:** ${participantNames.map(inline).join(", ")}`);
  lines.push("", "## Transcript evidence", "", "<!-- meeting-evidence:start -->");
  for (const segment of pkg.transcript) {
    lines.push(
      "",
      `<a id="${segment.id}"></a>`,
      `### ${segment.id} · ${clock(segment.startMs)}–${clock(segment.endMs)}`,
      "",
      fenced(segment.text),
    );
  }
  lines.push("", "<!-- meeting-evidence:end -->");

  if (pkg.localSummary !== undefined) {
    lines.push(
      "",
      "## Supplementary, not evidence",
      "",
      "> This local extractive summary is provided only as a reading aid. Tako must not cite it or use it to extract decisions and actions.",
      "",
      fenced(pkg.localSummary, "markdown"),
    );
  }
  lines.push("");
  return {
    relativePath: `meetings/${manifest.meeting.id}.md`,
    markdown: lines.join("\n"),
  };
}
