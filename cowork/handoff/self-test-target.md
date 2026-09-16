# Self-test target (developer's own Notion)

Provided by the developer 2026-08-28 for the first live ingest.

- Notion object ID: `3ca943af75c88019a64bee683cb33662`
  (dashed form: `3ca943af-75c8-8019-a64b-ee683cb33662`)
- Copied link: `https://app.notion.com/p/3ca943af75c88019a64bee683cb33662?v=3ca943af75c880608a1e000c18cfae2c&source=copy_link`
- Developer called it a "page", but the `?v=` param (a view id) means it is
  almost certainly a **database** (or a page fronting a database view). The
  connector should `GET /v1/databases/{id}` first; if that 404s, fall back to
  `GET /v1/pages/{id}` + block children.
- Integration name: `Tako Brain` (internal / access-token auth, Read content).
  CONFIRM the developer actually shared this page/db with that connection via
  ••• → Connections before the first run, or the API returns
  `object_not_found`.

## Token
NOT in the repo. Developer keeps it locally. At run time:
`export NOTION_TOKEN=ntn_...`  (or put it in the gitignored `config/connectors.json`)

## First-run config (once the connector lands)
```json
{
  "notion": {
    "token": "env:NOTION_TOKEN",
    "databases": ["3ca943af75c88019a64bee683cb33662"],
    "pages": [],
    "includeAllShared": false
  }
}
```
If the API says it's a page, move the id to `"pages"` instead.
