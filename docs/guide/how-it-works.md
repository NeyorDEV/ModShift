<!-- Generated from README.md by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->

# How it works

1. **Read** the pack: the `.mrpack` index (hashes) and override jars, or the CurseForge manifest
   and override jars, or a folder of jars (hashed locally, metadata read from the jar).
2. **Identify** files on Modrinth by hash (`POST /v2/version_files`), with the mod-id fallback.
3. **Look up** each project's versions for the target loader and Minecraft version
   (`GET /v2/project/{id}/version`). Preference order: native loader, then release > beta > alpha,
   then newest.
4. **Suggest** alternatives for mods without a version: Modrinth searches by similar name and by
   the same categories, filtered on the target, ranked by relevance. Mods that a documented
   compatibility layer could load are flagged (never adopted).
5. **Resolve** required dependencies recursively, and detect conflicts.
6. **Migrate** (optional): build and validate the new `.mrpack`, and copy overrides.

## Loaders

Targets can be mod loaders (`forge`, `neoforge`, `fabric`, `quilt`, plus older ones such as
`legacy-fabric` or `rift`), server plugin platforms (`bukkit`, `spigot`, `paper`, `purpur`,
`sponge`) or proxies (`bungeecord`, `waterfall`, `velocity`). `migrate` only targets the four loaders
the `.mrpack` format supports; `analyze` works for all of them, for example on a server's `plugins/`
folder.

When a mod has no version for the target loader, ModShift also accepts a version for a loader the
target is **officially documented** to run: Quilt ← Fabric, Paper ← Spigot/Bukkit,
Purpur ← Paper/Spigot/Bukkit, Waterfall ← BungeeCord. These are reported as
**"fallback compatibility, to test"**. Forge and NeoForge stay separate. Sources and the rules
deliberately left out are listed in [`docs/loaders.md`](/loaders).
