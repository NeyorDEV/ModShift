<!-- Generated from README.md by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->

# Sources: CurseForge and plugins

Modrinth is the primary source. Other sources plug in through a small contract
([`docs/plugins.md`](/plugins)): CurseForge resolves export references (below), and
**GitHub Releases** looks for a matching `.jar` in repositories you list:

```json
{ "sources": { "github-releases": { "repositories": { "my-mod.jar": "someone/my-mod" } } } }
```

Files found this way are listed under "Other sources (to verify)" in the reports and are **never
added to the migrated pack** (matched by file name only). Third-party sources can be registered
through the programmatic API.

## CurseForge packs

A CurseForge export only lists project/file IDs. To identify them, ModShift needs the CurseForge
API, which requires a key:

```bash
export CURSEFORGE_API_KEY="…"   # from https://console.curseforge.com
modshift analyze my-export.zip --mc 1.21.1 --loader neoforge
```

ModShift fetches each file's name and SHA-1, then finds **the same jar on Modrinth** by hash. The
CurseForge slug is an unverified fallback. Nothing is downloaded from CurseForge. Without a key,
these mods are reported as not identified, with instructions; jars inside the export's
`overrides/` folder are analysed either way. Details in
[`docs/curseforge-api.md`](/curseforge-api).
