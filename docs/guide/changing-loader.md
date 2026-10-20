<!-- Generated from README.md by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->

# Changing loader

> **ModShift does not convert mod code.** A Forge mod cannot become a Fabric mod. ModShift looks
> for **equivalents**: the same mod published for the other loader, or a different mod that does
> a similar job.

For each mod, in this order:

1. **Same project, other loader.** Many mods are multi-loader: the same Modrinth project publishes
   Forge, NeoForge and Fabric versions. ModShift switches to the target loader's version and says
   so (`Same project: its Fabric version replaces the Forge one`). This is the safest outcome.
2. **Alternatives**, when the project has no version for the target. Candidates come from two
   Modrinth searches (similar name, same categories) filtered on the target, then are **ranked by
   relevance** (shared categories 40 %, similar name 30 %, popularity 20 %, keywords from the
   description 10 %). A candidate must have a similar name or share at least two meaningful keywords
   with the original's description: a popular mod that only shares a broad category (such as
   "utility") is not suggested. Each suggestion comes with its score and why it was chosen, for
   example
   `relevance 79/100 — similar name (minimap) · same categories (adventure, utility) · 1.0M downloads`.
   Alternatives are **suggestions, to verify**: a different mod is never a drop-in replacement
   (worlds, configs and recipes can differ).
3. **Compatibility layers.** Some third-party mods load mods made for another loader. ModShift
   knows only the combinations documented by their authors:

   | Layer                                                         | Loads       | On       | Minecraft | Also install                               |
   | ------------------------------------------------------------- | ----------- | -------- | --------- | ------------------------------------------ |
   | [Sinytra Connector](https://modrinth.com/mod/connector)       | Fabric mods | NeoForge | 1.21.1    | Forgified Fabric API (replaces Fabric API) |
   | [Sinytra Connector](https://modrinth.com/mod/connector) (LTS) | Fabric mods | Forge    | 1.20.1    | Forgified Fabric API (replaces Fabric API) |
   | [Kilt](https://modrinth.com/mod/kilt)                         | Forge mods  | Fabric   | 1.20.1    | Fabric API, Fabric Language Kotlin         |

   Mods that could run this way are listed in a **"Compatibility layers (experimental, not
   guaranteed)"** section of the reports. They are **never added to the migrated pack**: test them
   yourself, in a copy of your world. Kilt's authors describe it as very experimental and able to
   break worlds. Sources: [`docs/loaders.md`](/loaders#compatibility-layers).

4. Otherwise the mod is **not found** and excluded, with the reason in `MIGRATION_REPORT.md`.
