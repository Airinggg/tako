import { readFile } from "node:fs/promises";

/**
 * Cross-tool person resolution. The same human shows up as different strings in
 * each source: `@ada` in Slack, `Ada Example` in Notion, an email in Drive.
 * `config/people.json` maps every known alias to one canonical name so the brain
 * (and its graph) treats them as one person.
 *
 * Shape (config/people.json — gitignored, .example committed):
 *   { "aliases": { "Ada Example": ["ada", "U01ABCDEF", "ada@acme.com"] } }
 */
export type PeopleMap = {
  /** lowercased alias -> canonical display name */
  index: Map<string, string>;
  /** true when the config file exists (so a connector can note it) */
  configured: boolean;
};

export async function loadPeople(path = "config/people.json"): Promise<PeopleMap> {
  const index = new Map<string, string>();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { index, configured: false };
  }
  const parsed = JSON.parse(raw);
  const aliases: Record<string, unknown> = parsed?.aliases ?? {};
  for (const [canonical, list] of Object.entries(aliases)) {
    index.set(canonical.toLowerCase(), canonical);
    if (Array.isArray(list)) {
      for (const alias of list) {
        if (typeof alias === "string" && alias.trim()) index.set(alias.trim().toLowerCase(), canonical);
      }
    }
  }
  return { index, configured: true };
}

/** Map one raw author/handle/email to its canonical name; unknown -> unchanged. */
export function canonicalPerson(raw: string | undefined | null, people: PeopleMap): string {
  if (!raw) return raw ?? "";
  return people.index.get(raw.trim().toLowerCase()) ?? raw;
}
