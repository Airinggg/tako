# Codex Notion connector report

- Built a config-driven Notion collector that writes deterministic Markdown into a Git-backed source directory.
- Added YAML provenance frontmatter, flattened common Notion blocks, cursor-based incremental output, and `--full`.
- Added an ignored example-backed local configuration and ignored `brain-sources/` output.
- Offline fixture tests cover database/page collection mapping and Markdown rendering; they pass.
- `npm run build` passes after task 1, task 2, and task 3 changes.
- Live collection still needs the developer's authorized Notion token and network access.
- Source registration/sync needs an initialized, committed `brain-sources` Git repository and the isolated GBRAIN_HOME.
- The sandbox blocks creation of `.git/index.lock`, so all three required commits remain uncommitted in the working tree for Claude to commit.
