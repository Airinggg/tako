# MCP governance — manifest, policy, audit

How Tako turns a raw MCP server into a *governed* source. This is the
small, in-repo adoption of `docs/mcp-ipaas/MCP_IPAAS_INTEGRATION_BLUEPRINT.md`
(§5 connector package contract, §6 normalized tool model, §7 isolation, §8
managed-client path). The large parts of the blueprint — multi-tenant control
plane, Windows edge agent, secret vault, durable CAE jobs — are **not** built
here; that is `docs/mcp-ipaas/CLAUDE_BUILD_HANDOFF.md`, a separate wave.

## The three pieces

### 1. Manifest — `lib/govern/manifest.ts`

Every MCP server registered in `config.mcp.servers[<name>].manifest` points at a
reviewed connector manifest. `validateManifest(obj)` mirrors
`docs/mcp-ipaas/connector-manifest.schema.json` and **rejects** a package unless:

- `version` is an immutable semver, `provenance.revision` is an immutable pin, and
  `provenance.license` is present;
- `auth.secretRefs` are all `secret://…` references — a literal secret fails;
- every tool sets `enabledByDefault: false` (deny-by-default);
- `risk: destructive | physical-control` ⇒ `approval: "always"`, `maxAttempts: 1`;
- `risk: mutate | destructive` ⇒ `checkpointRequired` **and**
  `verificationRequired`.

Tool metadata from the server itself is treated as untrusted; the manifest's
overlay is authoritative (blueprint §5).

### 2. Policy — `lib/govern/policy.ts`

`evaluate({ tool, args, scope, dataClass, env })` is the product-owned, deny-by-
default decision point, run against the **actual** invocation arguments:

| Check | Result on failure |
| --- | --- |
| known `risk` | `deny · unknown-tool-risk` |
| `tool.dataClassifications` includes `dataClass` | `deny · data-classification-not-allowed` |
| `tool.source` ∈ `scope.readSources` | `deny · source-out-of-scope` |

Then by risk (blueprint §6 risk policy):

| risk | decision |
| --- | --- |
| `read` | **allow** |
| `create-isolated` | **approval-required** (and `deny` if `env=prod` and args request an overwrite) |
| `mutate` | **approval-required** |
| `destructive` | **deny** — read-first product |
| `physical-control` | **deny** — belongs to a separate governed OT path |

This increment records `approval-required` and stops. The existing Intent-Merit
Review (`lib/review/`) is the intended human review surface, but routing an MCP
invocation into approval and resuming it is part of the deferred control plane.

### 3. Governed invocation + audit — `lib/connectors/mcp/govern.ts`

`GovernedMcpClient` wraps the deliberately small `McpClient`. Each
`resources/read` runs:

1. hash the frozen input schema (`RESOURCE_READ_INPUT_SCHEMA`) →
   `inputSchemaHash`;
2. `policy.evaluate` on the real `{ uri }` args — a `deny` / `approval-required`
   short-circuits: nothing is fetched, a `BlockedMcpItem` is recorded;
3. on `allow`, fetch, then `redact()` (`lib/govern/redact.ts`) the result text
   before it is returned — secrets/PII masked, `block` hits stop it;
4. emit one `McpAuditLine`
   `{ ts, connector, tool, uri, decision, reason, inputSchemaHash, resultHash,
   redactionHits }`.

`collectMcp` returns `{ items, audit, blocked }`; `run.ts` writes the audit to
`brain-sources/<subdir>/mcp/_audit.jsonl`. An upstream read failure is still
audited (`reason: …;upstream-read-failed`) and does not fail the run.

## Industrial register — `config/industrial-connectors.json`

The supplied YAML has 22 vendor/product rows (domain / executionPattern /
riskCeiling / proposedWave / evidence). The JSON adds the two things built here
(`cad`, `mcp-generic`, wave `built`) for a 24-entry register. `scripts/mcp-catalog.ts`
merges this curated register **over** the scraped mcpvault discovery
(`mergeIndustrialCatalog`), so a reviewed policy always wins. The demo's
**接続 / Connect** screen renders it grouped by domain with each entry's risk
ceiling, wave, and a built/not-built mark.

## What "done" means for a real industrial connector

See `docs/mcp-ipaas/MCP_IPAAS_INTEGRATION_BLUEPRINT.md` §12. In this repo the bar
is: a validated version-pinned manifest, no literal secrets, tool risks
classified with unknowns disabled, `read`/`create-isolated` only for the general
assistant surface, and every read producing an audit line.
