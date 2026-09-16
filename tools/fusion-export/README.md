# Tako — Fusion 360 metadata export

A Fusion 360 **script** that reads the active design and writes one JSON array in
the shape `lib/connectors/cad/collect.ts` ingests. It **does not create geometry
or modify the model** — it is the read-only, "govern knowing" side of CAD, not a
Fusion driver. Runs on macOS and Windows (Fusion is cross-platform).

## What it exports

One row per component in the active design:

| field | source |
| --- | --- |
| `Part Number` | `component.partNumber` |
| `Description` | `component.description` |
| `Type` | `Assembly` if the component has child occurrences, else `Part` |
| `Material` | `component.material.name` |
| `Revision` | data-file `versionNumber` (root component only) |
| `Last Modified By` / `Last Modified` | data-file `lastUpdatedBy` / date (root only) |
| `children` | direct-child BOM: `[{partNumber, description, quantity}]` |
| `whereUsed` | part numbers of assemblies that contain this component |
| `props` | mass (kg), volume (cm³), area, bounding box, plus any component **attributes** |

Plus one extra row `"<design> — parameters"` carrying the design's user
parameters as text, so `gbrain search "parameter shaft_dia"` works.

Fusion has no PDM workflow **state** or linked **drawings**, so those stay empty.

## Install & run

1. Fusion → **Utilities** tab → **Add-Ins** → **Scripts and Add-Ins…**
2. **Scripts** → green **+** → *pick this folder* (`tools/fusion-export/`).
3. Select **aletheia_fusion_export** → **Run**.
4. Open the design you want first; the script exports whatever is active.
5. Choose where to save `fusion-export.json`.

## Ingest into Tako

```jsonc
// config/connectors.json
"cad": {
  "sourceDir": "brain-sources",
  "subdir": "engineering",
  "systems": {
    "fusion": { "exportFile": "/absolute/path/to/fusion-export.json" }
  }
}
```

```bash
npm run connectors:cad          # writes brain-sources/engineering/cad/fusion/…
# then the usual: gbrain sync --source engineering && gbrain embed --all
```

Or use the demo's **接続 / Connect** screen → CAD card → system `fusion`,
paste the export path, Save, Test.

## Scope

- **Read-only.** No `create`, `extrude`, `save`, or script-execution tool. If you
  want Claude to *drive* Fusion, that is a separate app-driver MCP (Autodesk ships
  one) — deliberately not part of Tako's surface. See
  `docs/mcp-ipaas/MCP_IPAAS_INTEGRATION_BLUEPRINT.md` §4 (in-process add-in) and §6
  (CAD mutation = `mutate`/`destructive` risk).
- Active design only in v0.1. A project-wide sweep (walk `app.data.dataProjects`)
  is a future flag — it opens each file, which is slow and can prompt.
