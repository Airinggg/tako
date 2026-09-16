/** Pure config-scaffolding logic for `omnibrain setup`. Never writes a real
 *  secret — it only ever copies `*.example.json` templates (which already use
 *  `"env:VARNAME"` placeholders) and reports which env vars still need
 *  setting. `scripts/setup.ts` is the thin CLI wrapper that touches the
 *  filesystem and process.env; everything here takes its inputs as plain
 *  values so it's directly unit-testable. */

/** Given the example files present and the real files already on disk,
 *  decide what to copy. Never proposes overwriting an existing real file —
 *  a user's own edits are never at risk. */
export function planConfigScaffold(exampleNames: readonly string[], existingRealNames: ReadonlySet<string>): {
  toCopy: string[];
  alreadyPresent: string[];
} {
  const toCopy: string[] = [];
  const alreadyPresent: string[] = [];
  for (const example of exampleNames) {
    const real = example.replace(/\.example\.json$/, ".json");
    (existingRealNames.has(real) ? alreadyPresent : toCopy).push(real);
  }
  return { toCopy, alreadyPresent };
}

/** Recursively collect every `"env:VARNAME"` placeholder in a parsed config
 *  object — the set of env vars a user still needs to set for what's
 *  currently in their config. */
export function extractEnvPlaceholders(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    if (value.startsWith("env:")) out.add(value.slice(4));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractEnvPlaceholders(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) extractEnvPlaceholders(v, out);
  }
  return out;
}

export function missingEnvVars(varNames: Iterable<string>, env: Record<string, string | undefined>): string[] {
  return [...varNames].filter((name) => !env[name]);
}

/** Where the (not-yet-built-by-this-change) per-connector credential guide
 *  lives, for pointing the user at it. Kept as a pure function so tests and
 *  callers agree on the path convention without hardcoding it twice. */
export function credentialGuidePath(connectorName: string): string {
  return `docs/connectors/${connectorName}-credentials.md`;
}
