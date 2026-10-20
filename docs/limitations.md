<!-- Generated from README.md by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->

# Known limitations

- ModShift finds versions and equivalents; it never converts or patches mod code. Changing loader
  only works for mods that exist for the target loader (or have an acceptable alternative).
- Compatibility layers are only reported, never installed, and only for the combinations listed in
  [`docs/loaders.md`](/loaders#compatibility-layers).
- Only `mods/*.jar` are analysed; resource packs, shaders and configs are copied unchanged.
- CurseForge references need a `CURSEFORGE_API_KEY`.
- Alternatives and mod-id matches are heuristics: they can be wrong.
- Large packs take a while the first time (Modrinth allows 300 requests per minute); later runs
  use the cache.
- Plugin platforms (Paper, Velocity…) can be analysed, but `migrate` only writes `.mrpack` files,
  which only support Forge, NeoForge, Fabric and Quilt.
- Not tested against the live Modrinth and CurseForge APIs from the development environment (see
  [PROGRESS.md](https://github.com/NeyorDEV/ModShift/blob/main/PROGRESS.md)).
