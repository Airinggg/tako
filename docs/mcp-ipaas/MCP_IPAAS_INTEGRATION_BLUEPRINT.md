# MCP integration blueprint for a Claude-based industrial iPaaS

Prepared: 2026-08-31

## 1. Executive decision

The iPaaS should be the MCP host/client, credential owner, policy enforcement point, and audit authority. Claude should reason over a curated set of tools; it should not receive raw vendor credentials or direct, unrestricted access to community MCP servers.

Use two execution paths:

1. **Managed client path — default.** The iPaaS discovers MCP tools, converts their schemas into Claude tools, intercepts every call, applies policy/approval, executes it through the connector runtime, and sends the result back to Claude. This path supports local `stdio` servers, private networks, prompts/resources, strong approvals, and detailed audit controls.
2. **Claude hosted MCP connector — optional fast path.** Use only for public HTTPS MCP endpoints behind the iPaaS gateway and for low-risk tool-only workloads. Anthropic's current connector supports Streamable HTTP and SSE but only MCP tool calls; the API consumer still owns OAuth acquisition and refresh. Fronting every server with the iPaaS gateway avoids exposing vendor tokens and gives the product a stable policy boundary.

This split follows the current [Claude MCP connector documentation](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) and the [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28).

## 2. Assumptions

- The product is a multi-tenant B2B iPaaS, not a single-user Claude Desktop setup.
- Industrial desktop products normally run on licensed customer Windows workstations.
- CAE workloads can be long-running and may execute on an HPC scheduler.
- PLM, ERP, MES, and QMS endpoints may be SaaS, customer VPC, or on-premises.
- The supplied table is a discovery inventory. “MCP exists” is not a security, license, compatibility, or production-readiness approval.
- The first release should be read-first. Mutations are added tool by tool after deterministic tests and human approval controls exist.

## 3. Target architecture

```text
User / workflow trigger
        |
        v
Workflow API and Claude orchestrator
        |
        +--> Connector catalog and schema snapshots
        +--> Policy engine and approval service
        +--> Tenant connection and secret broker
        +--> Audit/event ledger
        |
        v
MCP gateway / tool router
        |
        +--> Public remote MCP server (HTTPS)
        |
        +--> Customer edge agent --stdio--> local MCP server --COM/API--> CAD app
        |
        +--> VPC/on-prem agent --> PLM/ERP/MES/QMS API
        |
        +--> Job adapter --> CAE/HPC scheduler --> artifacts/results
```

### Control plane

- Connector catalog, versions, provenance, compatibility, and tenant entitlements.
- OAuth client registration and connection lifecycle.
- Tool schema snapshots and policy overlays.
- Workflow definitions, approvals, schedules, and environment promotion.
- Connector health, rollout rings, revocation, and kill switches.

### Data plane

- Claude request/response orchestration.
- MCP discovery and invocation.
- Tool selection filtering and deferred loading for large catalogs.
- Tenant isolation, scoped session credentials, rate limits, timeouts, retries, and circuit breakers.
- Durable jobs for long-running CAE and export operations.
- Artifact storage for drawings, STEP/STL files, reports, screenshots, logs, and result bundles.

### Edge agent

- Runs as a signed service on a customer-managed Windows or Linux host.
- Opens an outbound mutually authenticated connection; no inbound firewall opening is required.
- Launches only administrator-approved, version-pinned MCP packages.
- Bridges local `stdio` MCP to the cloud gateway.
- Constrains files to configured workspaces and resolves paths before access.
- Enforces concurrency limits. COM/GUI applications should normally be single-session and single-writer.
- Reports application version, license presence, connector digest, capabilities, and health without returning secrets.

The MCP spec defines `stdio` and Streamable HTTP as standard transports. For HTTP it requires a single MCP endpoint, and it calls for proper authentication and Origin validation. See [MCP transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports).

## 4. Connector execution patterns

| Pattern | Applications | Required runtime | Important behavior |
| --- | --- | --- | --- |
| Local desktop/COM | CATIA, NX, SOLIDWORKS, AutoCAD, Inventor, Creo, Mastercam | Windows edge agent beside licensed app | Single writer, workspace confinement, checkpoint before mutation, screenshot/geometry verification |
| In-process add-in | Fusion 360 and products without safe out-of-process APIs | Vendor add-in plus edge sidecar | Signed add-in, narrow loopback IPC, crash isolation where possible |
| CAE/HPC job | ANSYS, Abaqus, COMSOL | Edge/VPC runner plus durable job service | Submit/status/cancel/result tools, artifact checksums, quotas, long timeout handling |
| Enterprise API | Teamcenter, Windchill, SAP, Oracle, Opcenter, Apriso, ETQ, MasterControl | Cloud, VPC, or edge connector | OAuth/service identity, pagination, optimistic concurrency, webhooks/polling |
| OT/engineering workstation | FactoryTalk, MELSOFT/GX Works, Omron Sysmac Studio | Segmented OT edge agent | Read-only first; production/physical control disabled by default; separate safety approval |

## 5. Connector package contract

Every connector package must validate against `connector-manifest.schema.json` and include:

- Stable connector ID, semantic version, vendor, domain, and owner.
- Provenance: source URL, exact commit or release, license, digest, and review date.
- Transport and placement: `stdio`, Streamable HTTP, or legacy SSE; cloud, VPC, or edge.
- Supported MCP protocol range and app-version compatibility.
- Authentication type and **secret references only**, never literal secrets.
- A snapshotted tool catalog with risk, approval, idempotency, scope, timeout, and data-classification metadata.
- Health checks, test fixtures, concurrency, and workspace constraints.
- Explicit capability flags for tools, resources, prompts, and tasks.

Do not trust MCP tool annotations or descriptions as security policy. The MCP specification explicitly treats tool behavior metadata as untrusted unless it comes from a trusted server. The iPaaS policy overlay is authoritative; see [MCP security principles](https://modelcontextprotocol.io/specification/2026-07-28#security-and-trust--safety).

## 6. Normalized tool model

Keep the original MCP tool name for protocol invocation, but assign an immutable internal identity:

```text
connector_id + connector_version + tool_name + input_schema_hash
```

Add a product-owned overlay:

- `risk`: `read`, `create_isolated`, `mutate`, `destructive`, or `physical_control`.
- `approval`: `none`, `policy`, or `always`.
- `idempotency`: `required`, `supported`, or `none`.
- `dataClassification`: allowed tenant classifications.
- `scopes`: minimum vendor/MCP scopes.
- `timeoutMs` and `maxAttempts`.
- `workspaceRequired`, `checkpointRequired`, and `verificationRequired`.
- `resultSchema` or a stable result envelope when the upstream server returns free text.

Recommended risk policy:

| Risk | Examples | Default |
| --- | --- | --- |
| Read | List documents, properties, BOM, job status | Allow within tenant entitlement |
| Create isolated | New draft, simulation in scratch workspace, export | Policy check; no production overwrite |
| Mutate | Change CAD parameters, update PLM/QMS records | Human approval and optimistic concurrency |
| Destructive | Delete, release, approve, overwrite, cancel production job | Always approve; step-up auth; checkpoint/rollback where possible |
| Physical control | PLC download, machine start/stop, safety setting | Block in general Claude workflows; separate governed OT product path |

## 7. Authentication and tenant isolation

- Store refresh tokens and vendor secrets in a vault under tenant and connection IDs.
- Issue the Claude hosted connector a short-lived broker token scoped to tenant, workflow run, connector, and allowed tool set. Never pass the vendor token to Claude.
- For user-delegated HTTP MCP, implement OAuth 2.1 authorization code with PKCE, Protected Resource Metadata discovery, audience/resource binding, issuer validation, and step-up scopes.
- For service workloads, support pre-registered client credentials only where the vendor and customer policy allow it.
- Use exact redirect URI allowlists and one-time state/PKCE records.
- Encrypt edge-agent identity with per-installation certificates and rotate them.
- Partition queues, caches, artifacts, and logs by tenant. Include tenant ID in authorization context, never accept it solely from tool arguments.
- Redact secrets and sensitive payload fields before model context and logs.

The current MCP authorization specification requires Protected Resource Metadata discovery, resource indicators, audience validation, and bearer tokens in the Authorization header rather than the URL. See [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

## 8. Claude integration

### Managed client path

1. Resolve the workflow's entitled connectors.
2. Discover or load the approved, snapshotted tool schemas.
3. Filter by policy before showing tools to Claude.
4. Send only the relevant tools to Claude; use tool search/deferred loading when there are dozens.
5. On a tool request, validate input against the frozen schema and re-run policy using actual arguments.
6. Pause for approval when required.
7. Mint a short-lived execution capability and call the gateway/edge runtime.
8. Validate and redact the result, write the audit record, and return the result to Claude.
9. Limit the number of tool turns, cumulative runtime, artifact size, and cost per run.

### Hosted MCP connector path

Expose a tenant-scoped gateway endpoint, not the upstream connector:

```json
{
  "mcp_servers": [
    {
      "type": "url",
      "url": "https://gateway.example.com/mcp",
      "name": "industrial-gateway",
      "authorization_token": "SHORT_LIVED_BROKER_TOKEN"
    }
  ],
  "tools": [
    {
      "type": "mcp_toolset",
      "mcp_server_name": "industrial-gateway",
      "default_config": {
        "enabled": false,
        "defer_loading": true
      },
      "configs": {
        "solidworks_get_mass_properties": {
          "enabled": true,
          "defer_loading": false
        }
      }
    }
  ],
  "betas": ["mcp-client-2025-11-20"]
}
```

At the time of preparation, `mcp-client-2025-11-20` is Anthropic's documented beta header. Keep it in a provider adapter/configuration value rather than scattering it through workflow code.

## 9. Workflow and job semantics

Every invocation receives:

- `runId`, `stepId`, `tenantId`, `connectionId`, and `idempotencyKey`.
- Deadline and cancellation token.
- Actor identity and approval grant.
- Workspace/artifact scope.
- Optional expected document version, ETag, or file hash.

Every result uses a stable envelope:

```json
{
  "status": "succeeded",
  "summary": "Human-readable result",
  "data": {},
  "artifacts": [],
  "warnings": [],
  "upstreamRequestId": null,
  "verification": {
    "performed": true,
    "method": "document_hash_and_mass_properties"
  }
}
```

Long operations return `accepted` plus a durable `jobId`; use separate `job_get`, `job_cancel`, and `job_result` tools. A transient transport disconnect must not cause an automatic duplicate write. Retry only reads or writes protected by an idempotency key and verified upstream behavior.

## 10. Community MCP intake

Representative repositories confirm that several CAD MCPs are local automation projects, not vendor-hosted SaaS connectors:

- [CATIA V5 MCP](https://github.com/daiemon12/catia-v5-mcp-server) uses local `stdio` and Windows COM, exposes a broad tool surface, and is MIT-licensed.
- [Siemens NX MCP](https://github.com/DreamEnding/NX_MCP) uses a `stdio` sidecar and an NXOpen bridge. Its documented certified surface is smaller than its historical tool set, which is a good model for allowlisting.
- [SolidworksMCP](https://github.com/czuryk/SolidworksMCP) uses Windows COM and documents transactions, checkpoints, idempotency, and rollback.
- [Autodesk Inventor MCP](https://github.com/hsavas/inventor-mcp) uses local Windows COM, but its license requires permission for commercial use; it must not be bundled into a commercial iPaaS until cleared.

Before adoption, pin an exact revision and complete:

1. License and vendor-terms review.
2. Maintainer/release provenance and dependency/SBOM scan.
3. Static analysis for arbitrary code execution, shell tools, unconstrained paths, and credential access.
4. MCP handshake and tool-schema snapshot.
5. Mock tests plus live-app tests on a disposable workspace.
6. Failure injection: modal dialogs, app crashes, stale handles, timeouts, disconnects, duplicate requests, and partial saves.
7. Tool-by-tool risk classification and deny-by-default allowlist.
8. Version compatibility matrix for the actual customer app releases.
9. Signed packaging and update/rollback procedure.

Fork and harden selected projects rather than pulling their default branch during installation.

## 11. Proposed rollout

### Foundation — before any production connector

- Manifest validation and immutable connector registry.
- MCP `stdio` and Streamable HTTP clients with schema snapshot tests.
- Gateway, secret broker, policy engine, approval service, audit ledger, and kill switch.
- Windows edge-agent skeleton with outbound mTLS, signed package allowlist, workspace confinement, and single-writer queue.
- Claude provider adapter with managed-client mode as default.

### Pilot — one local CAD path

- Select SOLIDWORKS or CATIA based on available licenses and test hosts.
- Start with health, connect, list/open in a disposable workspace, inspect properties, screenshot, and export-copy tools.
- Disable save-overwrite, close-without-save, arbitrary scripting, arbitrary file paths, and app shutdown.
- Add one approved mutation with checkpoint, dry-run/plan, idempotency, and postcondition verification.
- Prove tenant isolation, approval, audit replay, timeout recovery, and emergency revocation.

### Expansion

- Add NX only against its documented certified tool surface.
- Add one CAE job connector to validate durable tasks and artifacts.
- Add one PLM/ERP read connector to validate OAuth, pagination, and on-prem routing.
- Qualify remaining reported MCPs individually; do not bulk-enable them.

### Gap connectors

- Opcenter, DELMIA Apriso, ETQ Reliance, MasterControl: start with official API discovery and read/search/change-request workflows.
- FactoryTalk, MELSOFT/GX Works, Omron Sysmac Studio: read-only inventory/diagnostics first; keep write/download/control out of the general agent surface.
- Mastercam: use the same local CAD/CAM edge pattern, but add manufacturing-program verification and never dispatch machine execution from an LLM-only decision.

## 12. Definition of done for a production connector

- Manifest and all tool schemas validate and are version-pinned.
- License and vendor redistribution/automation terms are approved.
- No literal secrets exist in manifest, prompts, tool results, or logs.
- Tenant isolation and tool entitlements have automated negative tests.
- Read/write/destructive tools are correctly classified; unknown tools are disabled.
- Writes use idempotency and preconditions where supported; duplicate-delivery tests pass.
- Workspace traversal and symlink/junction escape tests pass.
- Timeouts, cancellation, app crash, edge disconnect, and retry behavior are deterministic.
- Mutations have checkpoint/rollback or explicit non-reversible warnings.
- Postcondition verification is automated for every enabled write.
- Audit records identify actor, approval, connector/version/tool, input hash, result hash, artifacts, duration, and upstream request ID.
- Health/SLO dashboards and a per-connector kill switch exist.
- Live acceptance passes on every supported vendor-app version using non-production data.

## 13. MVP success measures

- A tenant administrator can install an edge agent and connect a licensed CAD app without opening inbound ports.
- A user can run a read-only Claude workflow and receive structured properties plus a verifiable artifact.
- A proposed mutation pauses for approval, executes once, and verifies the result.
- Revoking the connection or tool entitlement takes effect before the next invocation.
- A crashed CAD app or disconnected edge agent cannot corrupt another tenant/run or cause a duplicate write.
- The entire run is explainable from immutable audit events without storing raw secrets.

