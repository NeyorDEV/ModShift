<!-- Generated from README.md by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->

# Client and server

ModShift reads each retained mod's side from Modrinth: the version's `environment` field (for
example `client_only` or `server_only_client_optional`), or the older project fields
`client_side` / `server_side` when it is missing. The mapping between the two is the one Modrinth
itself uses for its v2 API.

- Reports list **client-only**, **server-only** and **side unknown or ambiguous** mods (missing or
  contradictory metadata). Check the ambiguous ones yourself.
- `--side server` builds a dedicated-server pack: client-only mods (and dependencies only they
  needed) are left out, with the reason in `MIGRATION_REPORT.md`. `--side client` does the reverse.
  Mods with an unknown side are **kept**, with a warning. The default, `both`, filters nothing.
- When the source pack gives no `env` for a file, the migrated `.mrpack` gets the side from
  Modrinth (never guessed when it is unknown).

```bash
modshift migrate pack.mrpack --mc 1.21.1 --loader fabric --loader-version 0.16.5 \
  --side server --out server.mrpack
```
