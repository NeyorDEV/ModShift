<!-- Generated from README.md by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->

# Web interface

```bash
modshift ui            # opens http://127.0.0.1:<port>/ in your browser
modshift ui --port 8123 --no-open
```

A small local page to drop a `.mrpack` or CurseForge `.zip`, choose the target, browse the results
(sortable, filterable by status, with a detail view per mod: versions, alternatives,
dependencies), then download the migrated `.mrpack`, the `MIGRATION_REPORT.md` and the JSON
analysis. Light and dark themes follow your system, and a toggle overrides them.

<p align="center">
  <img src="../images/ui-dark.png" alt="The same analysis in the dark theme" width="720" />
</p>

The server only listens on `127.0.0.1` and protects its API with a random token. Uploaded files
stay in a temporary folder that is deleted when you stop it (Ctrl+C). See [SECURITY.md](https://github.com/NeyorDEV/ModShift/blob/main/SECURITY.md).
The web interface uses the same cache and options as the CLI (`--offline`, `--cache-dir`,
`--cache-ttl`).
