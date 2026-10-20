# Loaders

ModShift knows the loaders listed below. They are defined in one place,
[`src/loaders/registry.ts`](../src/loaders/registry.ts); adding a loader means adding one entry
there.

## Supported loaders

| Kind                    | Loaders (Modrinth ids)                                                                | `migrate` to `.mrpack` |
| ----------------------- | ------------------------------------------------------------------------------------- | ---------------------- |
| Mod loaders             | `forge`, `neoforge`, `fabric`, `quilt`                                                | yes                    |
| Older mod loaders       | `liteloader`, `modloader`, `rift`, `babric`, `bta-babric`, `legacy-fabric`, `ornithe` | no (`analyze` only)    |
| Server plugin platforms | `bukkit`, `spigot`, `paper`, `purpur`, `sponge`                                       | no (`analyze` only)    |
| Proxy plugin platforms  | `bungeecord`, `waterfall`, `velocity`                                                 | no (`analyze` only)    |

The `.mrpack` format can only declare `forge`, `neoforge`, `fabric-loader` and `quilt-loader`, so
`migrate` refuses other targets with a clear message. `analyze` works for every loader: a folder
of server plugins (or a server folder with `plugins/`) can be checked against a Paper target, for
example.

Shader and resource-pack "loaders" on Modrinth (`iris`, `optifine`, `canvas`, `vanilla`,
`minecraft`, `datapack`) are not mod loaders and are not targets.

**Where the names come from:** the Modrinth API (`GET /v2/tag/loader`) and documentation are not
reachable from the development environment. The ids were cross-checked in two clients that use
them against Modrinth: packwiz (`modrinth/modrinth.go`) and Prism Launcher
(`launcher/modplatform/ModIndex.cpp`). A name that neither confirms is not included.

## Fallback compatibility

When a mod or plugin has no version for the target loader, ModShift also accepts a version made for
a loader the target is **documented** to run. Such versions are reported as
**"fallback compatibility, to test"**: they should work, but nobody checked that specific mod.

| Target      | Also accepts                | Official source                                                                                                                                                                                               |
| ----------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quilt`     | `fabric`                    | [QuiltMC/quilt-loader README](https://github.com/QuiltMC/quilt-loader): ships the Fabric loader APIs "that any fabric mods can use"                                                                           |
| `paper`     | `spigot`, `bukkit`          | [PaperMC docs, Getting started](https://github.com/PaperMC/docs/blob/main/src/content/docs/paper/admin/getting-started/getting-started.mdx): "Paper is a drop-in replacement for both CraftBukkit and Spigot" |
| `purpur`    | `paper`, `spigot`, `bukkit` | [PurpurMC/Purpur README](https://github.com/PurpurMC/Purpur): "a drop-in replacement for Paper", including "all API provided by Paper, Spigot, and Bukkit"                                                    |
| `waterfall` | `bungeecord`                | [PaperMC/Waterfall README](https://github.com/PaperMC/Waterfall): "a fork of … BungeeCord" that "will still track upstream"                                                                                   |

A native version is always preferred over a fallback (for example, a Quilt version over a Fabric
one).

### Rules that are **not** applied (no official source found)

- **NeoForge ← Forge.** NeoForge for Minecraft 1.20.1 is often said to load Forge mods, but no
  official NeoForged source reachable from here confirms it. Forge and NeoForge stay separate.
- **Spigot ← Bukkit.** Very likely, but SpigotMC's documentation is not reachable from the
  development environment. Paper and Purpur targets accept Bukkit plugins (documented above);
  a Spigot target does not.
- **Velocity** is not BungeeCord-compatible (different plugin API).
- **Forge/Fabric through compatibility layers** (e.g. Sinytra Connector) are not loader rules;
  they are handled separately and never automatically (see below).

## Compatibility layers

A compatibility layer is a mod that loads mods made for another loader. Unlike the fallbacks
above, it must be installed in the pack and is not guaranteed to work with a given mod. ModShift
therefore **only reports** these mods, in a "Compatibility layers (experimental, not guaranteed)"
section, and **never adds them** (or the layer) to the migrated pack. A mod is reported when it
has no version for the target but has one for the layer's source loader and the target Minecraft
version.

| Layer                          | Loads  | On (target) | Minecraft | Requirements (Modrinth slugs)                  | Official source                                                                                                                                                                                    |
| ------------------------------ | ------ | ----------- | --------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sinytra Connector              | Fabric | NeoForge    | 1.21.1    | `connector`, `forgified-fabric-api`            | [Connector README, `dev` branch](https://github.com/Sinytra/Connector): "allows running Fabric mods on NeoForge"; "1.21.1 is our primary supported version"                                        |
| Sinytra Connector (1.20.1 LTS) | Fabric | Forge       | 1.20.1    | `connector`, `forgified-fabric-api`            | [Connector README, `1.20.1` branch](https://github.com/Sinytra/Connector/tree/1.20.1): Fabric mods "on MinecraftForge"; the `dev` README calls 1.20.1 "long-term-support" (critical bugfixes only) |
| Kilt                           | Forge  | Fabric      | 1.20.1    | `kilt`, `fabric-api`, `fabric-language-kotlin` | [Kilt README and `fabric.mod.json`, `version/1.20.1` branch](https://github.com/KiltMC/Kilt): "brings (Neo)Forge mods into the Fabric ecosystem. Very experimental", "may break worlds"            |

Notes:

- Forgified Fabric API is "a direct _replacement_ for the Fabric API and is not compatible with
  it" (Connector README), so Fabric API itself is never reported as loadable through Connector.
- Kilt's NeoForge 1.21.1 build is described as "in progress" in its README: not listed.
- Other Minecraft versions, and loaders such as Quilt, get no hint.

To propose a new rule or layer, open an issue with a link to the loader's **official** documentation.
