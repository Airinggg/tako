# Cross-tool person resolution

The same human appears as different strings per source: `@ada` (Slack),
`Ada Example` (Notion `created_by`), an email (Drive). Without resolution the
brain's graph sees three people. `config/people.json` maps every alias to one
canonical name.

## Config (`config/people.json` — gitignored; `.example` committed)

```json
{
  "aliases": {
    "Ada Example": ["ada", "U01ABCDEF", "ada@acme.com"],
    "Bea Example": ["bea"]
  }
}
```

- Keys are the canonical display name; values are every alias/handle/email seen
  for that person. Matching is case-insensitive and trimmed.
- No file → no-op (connectors keep raw author strings).

## Where it applies

`lib/connectors/shared/people.ts` (`loadPeople`, `canonicalPerson`). Applied in
the connector `run.ts` after collection, before render:

- **Notion** — `record.author` (from `created_by`).
- **Slack** — every `message.user` and the recomputed `participants` list.
- Drive / notes carry no author, so nothing to resolve.

Re-run the connector + `gbrain sync` after editing `config/people.json`.
