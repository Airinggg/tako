/** Pure prerequisite checks for a new machine — no process exit, no console
 *  output here, so this is directly unit-testable. `scripts/doctor.ts` is the
 *  thin CLI wrapper that runs these and prints/exits. */

export type DoctorCheck = {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
};

const MIN_BUN_VERSION = "1.3.10";
const REQUIRED_MODELS = ["bge-m3", "qwen2.5:3b-instruct"];

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function checkBunVersion(actual: string): DoctorCheck {
  const ok = compareVersions(actual, MIN_BUN_VERSION) >= 0;
  return {
    name: "bun version",
    ok,
    detail: ok ? `${actual} (>= ${MIN_BUN_VERSION} required)` : `${actual} is older than the required ${MIN_BUN_VERSION}`,
    fix: ok ? undefined : "Upgrade: curl -fsSL https://bun.sh/install | bash",
  };
}

export async function checkOllamaRunning(host = process.env.OLLAMA_HOST || "http://localhost:11434"): Promise<DoctorCheck> {
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { name: "Ollama running", ok: true, detail: `reachable at ${host}` };
  } catch (err) {
    return {
      name: "Ollama running",
      ok: false,
      detail: `could not reach ${host} (${(err as Error).message})`,
      fix: "Install from https://ollama.ai, then run: ollama serve",
    };
  }
}

export function parseOllamaTags(json: unknown): string[] {
  const models = (json as { models?: Array<{ name?: string }> })?.models ?? [];
  return models.map((m) => m.name ?? "").filter(Boolean);
}

/** Required models are matched by prefix (before ":") so a configured family
 *  can match Ollama's locally-tagged variants — `ollama pull` tag suffixes
 *  vary and this check only cares that *a* usable variant is present. */
export function checkModelsPulled(pulledTags: string[]): DoctorCheck[] {
  return REQUIRED_MODELS.map((required) => {
    const base = required.split(":")[0];
    const ok = pulledTags.some((tag) => tag === required || tag.startsWith(`${base}:`) || tag.startsWith(`${base}-`));
    return {
      name: `model ${required}`,
      ok,
      detail: ok ? "pulled" : "not found locally",
      fix: ok ? undefined : `ollama pull ${required}`,
    };
  });
}

export function checkGbrainHome(exists: boolean, home: string): DoctorCheck {
  return {
    name: "GBRAIN_HOME",
    ok: true, // absence is fine — `omnibrain` commands create it on first use
    detail: exists ? `${home} exists` : `${home} will be created on first use`,
  };
}

export function checkConnectorsConfig(exists: boolean, path: string): DoctorCheck {
  return {
    name: "connector config",
    ok: true, // absence is fine for a brand-new machine — advisory only
    detail: exists ? `${path} present` : `${path} not found yet`,
    fix: exists ? undefined : "Run: omnibrain setup",
  };
}

export function formatReport(checks: DoctorCheck[]): string {
  const lines: string[] = [];
  for (const c of checks) {
    lines.push(`${c.ok ? "✓" : "✗"} ${c.name} — ${c.detail}`);
    if (!c.ok && c.fix) lines.push(`    fix: ${c.fix}`);
  }
  const failed = checks.filter((c) => !c.ok);
  lines.push("");
  lines.push(failed.length ? `${failed.length} check(s) failed — fix the items above, then re-run \`omnibrain doctor\`.` : "All checks passed.");
  return lines.join("\n");
}
