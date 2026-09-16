# Claude build handoff: industrial MCP iPaaS foundation

Use the following as the implementation brief in the actual product repository.

---

You are implementing the first production-quality vertical slice of a multi-tenant iPaaS that connects Claude to industrial applications through MCP.

Read these project documents first:

1. `MCP_IPAAS_INTEGRATION_BLUEPRINT.md`
2. `connector-manifest.schema.json`
3. `industrial-connectors.catalog.yaml`

Preserve the repository's existing language, framework, conventions, deployment model, authentication, and database choices. If this is a new repository with no established stack, propose the smallest production-capable TypeScript stack and record the decision before scaffolding.

## Goal

Deliver an end-to-end, read-only pilot path:

```text
authenticated tenant user
  -> workflow/API request
  -> entitled connector/tool resolution
  -> Claude tool selection
  -> policy evaluation
  -> MCP gateway
  -> outbound-connected Windows edge agent
  -> local stdio mock CAD MCP server
  -> schema-validated result
  -> Claude response plus immutable audit events
```

The mock must be replaceable by a qualified SOLIDWORKS or CATIA MCP package without changing the control-plane contract.

## Non-negotiable design constraints

- The iPaaS is the MCP client, credential owner, policy point, and audit authority.
- The default path is a managed Claude tool loop. Do not give Claude vendor credentials or unrestricted upstream MCP URLs.
- Connector packages and tools are deny-by-default and version-pinned.
- A connector manifest must validate against `connector-manifest.schema.json` before registration or execution.
- Tenant identity comes from authenticated server context, never from an untrusted tool argument.
- Secrets are represented only by vault references and are redacted from prompts, responses, errors, and logs.
- The edge agent initiates outbound authenticated connectivity. Do not require inbound customer firewall rules.
- Local MCP is `stdio`; cloud-facing MCP is Streamable HTTP. Keep legacy SSE behind an adapter.
- Each execution includes run, step, tenant, connection, actor, deadline, and idempotency context.
- Unknown or changed tool schemas quarantine the connector until reviewed.
- No arbitrary command, shell, Python, macro, or unrestricted file-path tool is enabled.
- Physical-control tools are unsupported in this slice and must be rejected even if a server advertises them.

## Implement these modules

1. **Connector registry**
   - Register immutable connector versions and provenance.
   - Validate manifests and enforce uniqueness.
   - Store the discovered tool schema snapshot and hash.
   - Quarantine schema drift.

2. **Tenant connection service**
   - Associate a tenant with connector version, edge installation, entitlements, and secret references.
   - Support active, suspended, revoked, unhealthy, and upgrade-required states.

3. **Policy engine interface**
   - Input: actor, tenant, workflow, connector, tool, actual arguments, data classification, environment, and time.
   - Output: allow, deny, or approval-required with a stable reason code.
   - In this slice, allow only explicitly entitled read tools and isolated export-copy tools.

4. **MCP gateway/client**
   - Support `stdio` discovery/invocation through the edge agent and Streamable HTTP through a transport interface.
   - Validate inputs against the frozen upstream JSON Schema before invocation.
   - Enforce timeouts, cancellation, response-size limits, and structured error mapping.
   - Never retry a non-idempotent invocation automatically.

5. **Windows edge-agent protocol and mock**
   - Implement an outbound-authenticated session with per-invocation capabilities, expiry, nonce, and replay protection.
   - Allow only installed connector IDs/digests and configured workspace roots.
   - Launch a bundled mock `stdio` MCP server with tools such as `cad_health`, `cad_list_documents`, `cad_get_document_properties`, and `cad_export_copy`.
   - Serialize invocations per local app session.

6. **Claude adapter**
   - Convert only the policy-filtered MCP tools to Claude tool definitions.
   - Run the tool loop with a maximum turn/tool-call/runtime budget.
   - Intercept every requested call and repeat policy evaluation using actual arguments.
   - Return stable, schema-validated result envelopes.
   - Keep model ID and any MCP beta header in provider configuration, not domain code.

7. **Audit ledger and observability**
   - Append events for run started, tools exposed, tool requested, policy decision, approval state, execution dispatched, result received, and run completed/failed.
   - Record hashes and references instead of raw restricted payloads.
   - Include correlation IDs across API, Claude, gateway, edge, and connector logs.
   - Add per-connector kill switch and circuit breaker.

## Public contracts

Define versioned schemas/types for:

- `ConnectorManifest`
- `ConnectorToolPolicy`
- `TenantConnection`
- `InvocationContext`
- `PolicyDecision`
- `EdgeRegistration`
- `EdgeInvocationRequest` / `EdgeInvocationResult`
- `ToolResultEnvelope`
- `AuditEvent`

Use discriminated unions for states and error classes. Do not expose database records directly as API responses.

## Required tests

- Invalid manifest, literal secret, mutable version, and bad digest rejection.
- Tenant A cannot discover or invoke Tenant B's connector.
- Unentitled, unknown, destructive, and physical-control tools are denied.
- Tool schema drift quarantines execution.
- Path traversal, absolute-path escape, and junction/symlink escape are denied.
- Expired/replayed edge capability is denied.
- Edge disconnect and timeout return deterministic errors.
- Response and log redaction removes seeded fake secrets.
- Duplicate read is safe; duplicate non-idempotent write is not retried.
- Revocation and kill switch take effect before the next dispatch.
- Audit events form a complete ordered run history without storing raw secrets.
- Contract tests cover MCP initialization, tool listing, invocation, error, cancellation, and malformed server output.

## Delivery sequence

Implement in small reviewable increments:

1. Types, manifest validation, migrations, and tests.
2. Registry, tenant connection, and policy interfaces.
3. Mock MCP server and local transport contract tests.
4. Edge protocol/agent and end-to-end mock invocation.
5. Claude managed tool loop.
6. Audit, health, kill switch, redaction, and failure tests.
7. Documentation and a local demo script using only fake data.

After each increment, run the repository's formatter, static checks, unit tests, and relevant integration tests. Do not import a community CAD repository or implement mutation tools in this slice. End with a concise threat-model update, known limitations, and the exact steps needed to qualify the first real CAD connector.

## Acceptance scenario

Using two seeded tenants and a fake CAD document:

1. Tenant A invokes “inspect the active bracket and export a copy.”
2. Claude sees only the four entitled mock CAD tools.
3. The policy layer allows inspection and isolated export-copy.
4. The edge agent executes exactly once inside Tenant A's configured workspace.
5. The response includes structured properties and a checksum-addressed artifact reference.
6. Tenant B cannot see the connection, document, artifact, or audit events.
7. Revoking Tenant A's connection prevents a second invocation immediately.
8. The audit history explains every decision and execution without containing credentials.

---

