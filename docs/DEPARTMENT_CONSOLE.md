# Department console (roadmap step 6)

The OmniBrain-style dashboard, built local and self-contained.

```bash
npm run console:serve            # http://localhost:4321
PORT=5000 npm run console:serve
```

It reads the isolated brain through the vendored `gbrain` CLI (`GBRAIN_HOME`
= `~/.aletheia-brain`). No hosted calls, and no dependency on `gbrain serve` —
it is not the same thing as `/admin` (that is gbrain's own operator console).
This one is the department + invite view from the OmniBrain demo.

## Screens

- **Scope cards** — when `config/scopes.json` contains definitions, the console
  renders one card per scope rather than one per raw GBrain source. Each card
  shows its purpose, included and excluded prefix summary, document/skill/rule/
  member counts, and aggregate sync status for its realised sources.
- **Source-card fallback** — if the scope file is absent or empty, the original
  source cards remain available with the banner `No scopes yet — run npm run
  scope:build`.
- **Share with your team** — each realised scope opens the People / invite panel
  with that scope selected. The operator supplies a kebab-case name and email;
  other realised scopes can be ticked. Submit resolves the selections again on
  the server and runs `gbrain auth register-client <name> --scopes read --source
  <primary-realised-source> --federated-read <union-of-realised-sources>`. The
  `client_id` and `client_secret` are shown **once**. A planned partial scope is
  not shareable until its carved source exists and contains the selected pages.
- **Members** — every registered client: name, scopes, readable sources, masked
  client id, and a **Revoke** button (`gbrain auth revoke-client` — tokens die
  immediately via cascade).

## Scope counts and access

- Documents are the summed page counts returned by the scope model's
  `included()` preview.
- Skills are discovered from `brain-sources/*/skills/*/SKILL.md`. The console
  parses `name` and `reads` from frontmatter and grants a skill only when every
  declared source is in the scope's realised read set. Missing or partially
  covered `reads` declarations grant nothing.
- Rules are visible `_*-rules.md` files beneath the scope's readable sources.
- Members are clients whose primary source plus `federated_read` cover every
  realised source needed by the scope.
- Sync state is aggregated from `gbrain sources status --json`; the oldest
  successful sync is shown when several sources make up one scope.

## Notes / limitations

- **Slow first paint**: the console reads each source's page list through a
  separate local CLI process. Output is briefly cached, but this remains an
  operator console rather than a concurrent web service.
- Read-only against the brain except for `register-client` / `revoke-client`.
- It binds to `127.0.0.1` and has no auth. Do not expose it. (`gbrain serve
  --http` has real admin auth; this does not.)
- Implementation: `scripts/console.ts` — a single `Bun.serve` file, self-contained
  HTML/JS, no framework, no new deps. It is NOT part of the Cloudflare-worker app
  (`app/`), which cannot spawn `gbrain`.
