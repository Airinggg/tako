#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadDashboard } from "../lib/console/data.ts";
import { parseSkill, type ParsedSkill } from "../lib/skills/parse.ts";

const REPO = join(import.meta.dir, "..");
const SOURCES = join(REPO, "brain-sources");

function skills(): ParsedSkill[] {
  const found: ParsedSkill[] = [];
  if (!existsSync(SOURCES)) return found;
  for (const source of readdirSync(SOURCES, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const directory = join(SOURCES, source.name, "skills");
    if (!existsSync(directory)) continue;
    for (const skill of readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const file = join(directory, skill.name, "SKILL.md");
      if (!existsSync(file)) continue;
      const parsed = parseSkill(readFileSync(file, "utf8"));
      if (parsed.name) found.push(parsed);
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

const dashboard = loadDashboard();
const configuredScopes = dashboard.mode === "scopes" ? dashboard.brains : [];
const inventory = skills();

console.log(`Skills (${inventory.length})`);
for (const skill of inventory) {
  const scopes = configuredScopes.filter((scope) => scope.skillNames.includes(skill.name)).map((scope) => scope.name).sort();
  console.log(`- ${skill.name}`);
  console.log(`  reads: ${skill.reads.join(", ") || "none"}`);
  console.log(`  scopes: ${scopes.join(", ") || "none"}`);
}
if (dashboard.mode !== "scopes") console.log("\nNo configured scopes — run `omnibrain scopes`.");
