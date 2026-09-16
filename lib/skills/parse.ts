export type ParsedSkill = {
  name: string;
  description: string;
  triggers: string[];
  reads: string[];
  steps: string[];
};

function scalar(value: string): string {
  const withoutComment = value.replace(/\s+#.*$/, "").trim();
  if ((withoutComment.startsWith('"') && withoutComment.endsWith('"'))
    || (withoutComment.startsWith("'") && withoutComment.endsWith("'"))) {
    return withoutComment.slice(1, -1);
  }
  return withoutComment;
}

function frontmatter(markdown: string): Record<string, string | string[]> {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return {};
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return {};

  const values: Record<string, string | string[]> = {};
  let listKey = "";
  for (const line of lines.slice(1, end)) {
    const field = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (field) {
      const [, key, raw] = field;
      listKey = "";
      if (raw.trim().startsWith("[") && raw.trim().endsWith("]")) {
        values[key] = raw.trim().slice(1, -1).split(",").map(scalar).filter(Boolean);
      } else if (raw.trim()) {
        values[key] = scalar(raw);
      } else {
        values[key] = [];
        listKey = key;
      }
      continue;
    }
    if (listKey) {
      const item = line.match(/^\s+-\s+(.+)$/);
      if (item) (values[listKey] as string[]).push(scalar(item[1]));
      else if (/^\S/.test(line)) listKey = "";
    }
  }
  return values;
}

function procedureSteps(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const heading = lines.findIndex((line) => /^##\s+Procedure\s*$/i.test(line.trim()));
  if (heading < 0) return [];

  const steps: string[] = [];
  let current: string[] | null = null;
  const finish = () => {
    if (current?.length) steps.push(current.join(" ").replace(/\s+/g, " ").trim());
    current = null;
  };
  for (const line of lines.slice(heading + 1)) {
    if (/^##\s+/.test(line.trim())) break;
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (numbered) {
      finish();
      current = [numbered[1].trim()];
      continue;
    }
    if (current && line.trim()) current.push(line.trim());
  }
  finish();
  return steps;
}

/** Parse the reviewed skill fields and its numbered Procedure steps. */
export function parseSkill(markdown: string): ParsedSkill {
  const values = frontmatter(markdown);
  const strings = (key: string) => Array.isArray(values[key]) ? [...values[key]] as string[] : [];
  return {
    name: typeof values.name === "string" ? values.name : "",
    description: typeof values.description === "string" ? values.description : "",
    triggers: strings("triggers"),
    reads: [...new Set(strings("reads"))],
    steps: procedureSteps(markdown),
  };
}
