# Claude MCP iPaaS integration pack

This pack converts the supplied industrial-application inventory into an implementation-ready starting point for a multi-tenant iPaaS that uses Claude and MCP.

## Files

- `MCP_IPAAS_INTEGRATION_BLUEPRINT.md` — architecture, security model, connector contract, rollout, and acceptance gates.
- `connector-manifest.schema.json` — JSON Schema for connector packages and their tool-level policy metadata.
- `sample-connector-manifest.json` — a deny-by-default mock CAD connector manifest for the first vertical slice.
- `industrial-connectors.catalog.yaml` — the supplied app list normalized into execution modes, risk ceilings, and proposed waves.
- `CLAUDE_BUILD_HANDOFF.md` — a prompt/specification to give Claude when implementing the first vertical slice in the product repository.

## Recommended first move

Build the control plane, policy engine, MCP gateway, and Windows edge-agent skeleton first. Then qualify one read-only SOLIDWORKS or CATIA connector in a disposable CAD workspace. Do not begin by importing every community MCP server.
