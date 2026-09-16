import type { Scope } from "./model.ts";

export type SkillFrontmatter = {
  name: string;
  reads: string[];
  source: string;
};

export type RealisedScope = Scope & {
  realisedSources: string[];
};

function scalar(value: string): string {
  const withoutComment = value.replace(/\s+#.*$/, "").trim();
  if ((withoutComment.startsWith('"') && withoutComment.endsWith('"'))
    || (withoutComment.startsWith("'") && withoutComment.endsWith("'"))) {
    return withoutComment.slice(1, -1);
  }
  return withoutComment;
}

/** Parse only the frontmatter fields the console needs, without a YAML dependency. */
export function parseSkillFrontmatter(markdown: string, source: string): SkillFrontmatter | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return null;

  let name = "";
  const reads: string[] = [];
  let inReads = false;
  for (const line of lines.slice(1, end)) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) {
      name = scalar(nameMatch[1]);
      inReads = false;
      continue;
    }
    const readsMatch = line.match(/^reads:\s*(.*)$/);
    if (readsMatch) {
      inReads = true;
      const inline = readsMatch[1].trim();
      if (inline.startsWith("[") && inline.endsWith("]")) {
        reads.push(...inline.slice(1, -1).split(",").map(scalar).filter(Boolean));
        inReads = false;
      }
      continue;
    }
    if (inReads) {
      const item = line.match(/^\s+-\s+(.+)$/);
      if (item) reads.push(scalar(item[1]));
      else if (/^\S/.test(line)) inReads = false;
    }
  }
  return name ? { name, reads: [...new Set(reads)].sort(), source } : null;
}

function ruleSource(filename: string): string | null {
  const parts = filename.replace(/\\/g, "/").split("/").filter(Boolean);
  const brainSources = parts.lastIndexOf("brain-sources");
  if (brainSources >= 0 && parts[brainSources + 1]) return parts[brainSources + 1];
  const skills = parts.lastIndexOf("skills");
  return skills > 0 ? parts[skills - 1] : null;
}

/** Apply the all-required-sources rule to skills and source visibility to rules. */
export function grantsForScope(
  scope: RealisedScope,
  skills: readonly SkillFrontmatter[],
  ruleFilenames: readonly string[],
): { skills: string[]; rules: string[] } {
  const readable = new Set(scope.realisedSources);
  const grantedSkills = skills
    .filter((skill) => skill.reads.length > 0 && skill.reads.every((source) => readable.has(source)))
    .map((skill) => skill.name);
  const grantedRules = ruleFilenames.filter((filename) => {
    const basename = filename.replace(/\\/g, "/").split("/").pop() ?? "";
    const source = ruleSource(filename);
    return /^_.*-rules\.md$/.test(basename) && source !== null && readable.has(source);
  });
  return {
    skills: [...new Set(grantedSkills)].sort(),
    rules: [...new Set(grantedRules)].sort(),
  };
}
