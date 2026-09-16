# GBrain connectors

## Decision

GBrain sources are **git-backed directories of Markdown files**. Git is the
durable system of record; GBrain syncs committed Markdown from each source into
its retrieval and graph engine. A connector writes deterministic Markdown files
into a configured source directory. It does not maintain a bespoke raw-record
store and it does not shell out to `gbrain put` for individual records.

This keeps source content inspectable, reviewable, portable, and recoverable
with ordinary Git tooling. Source API access (for example, a Notion integration
token) is solely for collection. Ingested content is never sent to a hosted
model or hosted processing service: embeddings and synthesis use configured
local models only.

## Source lifecycle

Create a dedicated Git repository (or use a directory inside a repository) for
the source content. Commit the connector output before sync; by default GBrain
imports committed state and warns about uncommitted drift.

```bash
# Run from packages/brain, always preserving the isolated brain home.
export GBRAIN_HOME="$HOME/.aletheia-brain"

# <source-dir> must be a Git repo with committed files. --force intentionally
# bypasses that safety check and is not the normal connector workflow.
bun src/cli.ts sources add <source-id> --path "<source-dir>" --name "<display-name>"

# Sync one source, or all registered sources.
bun src/cli.ts sync --source <source-id>
bun src/cli.ts sync --all
```

`sources add` accepts `--path`, `--name`, `--federated|--no-federated`, and
`--force`. `sync` accepts `--source`, `--all`, `--repo`, `--full`,
`--working-tree`, and related import controls. Use `--working-tree` only when
you deliberately want uncommitted data included; review the tree first so no
secrets or scratch files are imported.

## Connector responsibilities

A project-owned connector should:

1. Load only configuration supplied in a local ignored config file or approved
   environment variables; never hardcode a workspace name or token.
2. Collect from the authorized source API and normalize each remote record into
   a stable, source-specific Markdown path.
3. Render YAML frontmatter with provenance (source id, remote URL, authorship,
   and timestamps) plus retrieval-friendly plain text.
4. Write deterministically: the same source response produces the same path and
   file content. Keep only lightweight connector cursor metadata in the source
   directory when incremental collection is needed.
5. Let the operator inspect and commit the resulting Markdown, then run
   `gbrain sync --source <source-id>`.

The source repository can use normal Git history, review, retention, and
deletion practices. A connector should document how deletions are reflected in
the source tree; GBrain sync will then observe the committed deletion.

## Security and operations

- Keep real connector configuration and generated source directories out of
  this application repository when they contain private data. Commit an example
  configuration only.
- The connector may call the customer-authorized source API, but must never
  relay collected content to any hosted AI API.
- Keep `GBRAIN_HOME` set to the dedicated brain home before every GBrain command;
  never operate on an unrelated default brain.
- `gbrain sources status` reports sync freshness and coverage. Use Git status
  before syncing to make committed-vs-working-tree intent explicit.

### Scanned documents (local OCR)

The Drive connector OCRs PNG, JPEG, WebP, and TIFF files locally. For PDFs,
normal `unpdf` text extraction runs first; when it produces fewer than roughly
20 characters, the connector extracts the PDF's decoded embedded page images
and OCRs those. This avoids a native canvas dependency while covering the usual
image-only scanner output. Existing PDF text always wins, and any OCR, image,
PDF, or timeout failure returns the original extracted text rather than failing
the connector.

OCR uses Tesseract.js's local Node worker and WASM core. Tesseract.js normally
downloads missing language data from jsDelivr, so this project also installs the
official `@tesseract.js-data/eng` package and resolves its local
`4.0.0_best_int/eng.traineddata.gz` explicitly. The connector never allows a
URL as a language path and disables traineddata cache writes; no document or
OCR input is sent over the network.

Environment controls:

- `OCR_ENABLED=0` disables OCR. It is enabled by default.
- `OCR_LANG` selects a language code (`eng` by default).
- `OCR_LANG_PATH=/absolute/local/directory` supplies locally provisioned
  `<language>.traineddata.gz` files. It is required for languages other than
  the bundled English model.
- `OCR_LANG_GZIP=0` selects uncompressed `<language>.traineddata` in a custom
  path.
- `DRIVE_EXTRACT_TIMEOUT_MS` bounds both document extraction and OCR (45 seconds
  by default).

After OCR output is written to the normal provenance-preserving Drive Markdown,
commit it and run source sync/embed as usual. OCR does not change the renderer's
frontmatter or output paths.

### CAD (read-only metadata)

The CAD connector never starts, controls, or queries a CAD application. A
separate exporter that runs where the CAD tool / PDM lives writes a JSON or CSV
snapshot; Tako reads that file and renders deterministic Markdown under
`cad/<system>/<type>/<part-number>.md`. `tools/fusion-export/` is the bundled
exporter (a read-only Fusion 360 script); any other system that can emit the
same row shape works too.

A JSON export is an array whose rows use either `CadDoc` field names or the
human column names normalized by the connector. For example:

```json
[
  {
    "File Name": "gearbox.SLDASM",
    "Document Type": "assembly",
    "Part Number": "ASM-100",
    "Description": "Gearbox assembly",
    "Material": "",
    "Revision": "C",
    "State": "Released",
    "Configuration": "Default",
    "Checked In By": "engineer",
    "Checked In": "2026-08-31T09:00:00Z",
    "BOM": [
      { "partNumber": "P-10", "description": "Gear", "quantity": 2 }
    ],
    "Where Used": [],
    "Drawings": ["ASM-100.SLDDRW"],
    "Notes": ""
  }
]
```

The ingested content is metadata only: file/document type, part number,
description, material, revision, configuration, PDM state/check-in details,
flattened BOM, where-used links, drawing names, notes, and additional custom
properties. CAD geometry and `.SLDPRT`/`.SLDASM`/`.SLDDRW` binaries are never
read by Tako.

Run it manually with `npm run connectors:cad` or `omnibrain connect cad`; it is
also part of `npm run connectors:all` and the continuous sync daemon. It has no
cursor: every run re-reads the complete export for each system configured under
`cad.systems`, rewrites that system's Markdown set, and prunes its stale pages
without touching the others. The config shape is in
`config/connectors.example.json`; `tools/fusion-export/README.md` documents the
bundled read-only exporter.

## Project shape

```text
config/connectors.json              # ignored: local tokens and source settings
brain-sources/                      # ignored here: a Git repository in real use
  notion/
    <workspace>/<slug>-<id>.md      # connector-generated Markdown
  discord/
    <channel-slug>/<YYYY-MM-DD>.md     # one file per channel per UTC day (+ thread-<name>-<id>.md)
  slack/
    <channel-slug>/<root-ts>.md     # one file per thread (standalone msg = 1-msg thread)
  .notion-cursor.json               # per-run incremental cursor
  .slack-cursor.json                # { "<channelId>": "<lastTs>" }
lib/connectors/
  shared/                           # config, Markdown utils, pruneStale(dir, subdir, keep)
  notion/                           # collection, rendering, runnable command
  slack/  discord/  drive/  notes/  # same shape
```

The `brain-sources/` path is a convenient local default. Initialize it as a Git
repository and make an initial commit before registering it with GBrain.

**One source for every connector.** `brain-sources/` is registered once
(`gbrain sources add notion --path .../brain-sources`); each connector writes to
its own `notion/` or `slack/` subtree inside it. `gbrain sync --source notion`
then imports the whole tree. No separate GBrain source per tool.

### Slack specifics

- Auth: a bot token (`xoxb-…`) with `channels:history`, `channels:read`,
  `users:read` (+ `groups:*` for private channels). The bot must be invited to
  each channel it reads.
- One Markdown file per thread. User IDs and `<#C…|name>` / `<url|label>` markup
  are resolved to plain text at collection time. Thread-root permalinks come from
  `chat.getPermalink` — never constructed.
- Incremental by a per-channel `lastTs` cursor; `--full` re-pulls the whole
  `lookbackDays` window. **Known gap:** a new reply on a thread whose root is
  older than the lookback window is missed. An archive/`--since` mode is future
  work.
