<!-- Generated from README.md by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->

# FAQ

**Is the migrated pack guaranteed to work?**
No. ModShift only uses the metadata authors publish on Modrinth. Always test the pack, and back up
your worlds before opening them with a new version.

**Why does `migrate` ask for `--loader-version`?**
A `.mrpack` must name the exact loader version. ModShift reuses the source pack's version when the
loader and Minecraft version do not change. Otherwise, pick one on the loader's website, or set
`target.loaderVersion` in the config.

**Why are some mods "not found" although they exist?**
The file may come from another site (CurseForge, GitHub) or have been modified, so its hash is
unknown to Modrinth. Use `mappings` in the config to point it at the right project.

**Are suggested alternatives equivalent to the original mod?**
No. They are search results ranked by shared categories, similar name, keywords and popularity;
the report says why each one was suggested. Check them before use.
`--include-alternatives` adds the best one to the pack, still flagged as a suggestion.

**Does ModShift support resource packs and shaders?**
They are kept unchanged in migrated `.mrpack` files but not checked yet.

**Does it work without internet?**
Yes, with `--offline`, once the cache has been filled by a previous run.
