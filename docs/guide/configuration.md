<!-- Generated from README.md by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->

# Configuration file

`modshift.config.json` (optional; JSON Schema in
[`schemas/modshift.config.schema.json`](https://github.com/NeyorDEV/ModShift/blob/main/schemas/modshift.config.schema.json)):

```json
{
  "$schema": "./schemas/modshift.config.schema.json",
  "target": { "minecraftVersion": "1.21.1", "loader": "neoforge", "loaderVersion": "21.1.77" },
  "ignore": ["optifine*.jar"],
  "exclude": ["old-minimap"],
  "mappings": { "rubidium": "embeddium", "my-local-mod.jar": "sodium" }
}
```

- `target`: defaults for `--mc`, `--loader`, `--loader-version` and `--side` (`side`).
  Command-line options win.
- `ignore`: mods left out entirely. Entries are file names (`*` wildcard), Modrinth slugs or
  project ids.
- `exclude`: mods that are analysed and reported, but left out of migrated packs (with the
  dependencies only they needed).
- `mappings`: "this mod → that Modrinth project". A mapping is your explicit choice, so it is
  reported as a replacement, not a suggestion. It also works for files Modrinth does not know.

- `sources`: options of [mod sources](/plugins), e.g. GitHub repositories to look at for
  mods that are not on Modrinth.

Unknown keys are rejected, so a typo cannot silently do nothing.
