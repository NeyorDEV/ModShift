<!-- Generated from README.md by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->

# Interactive mode

```bash
modshift interactive my-pack.mrpack     # or simply: modshift -i
```

The assistant asks for the target Minecraft version and loader, shows the report, then lets you
decide, mod by mod (by default only the ones that need attention):

- **accept** the update (or keep the compatible version);
- **use one of the alternatives** (each still marked "suggestion, to verify");
- **exclude** the mod from migrated packs (it stays in reports);
- **ignore** it (no longer analysed).

Your choices are saved in `modshift.config.json` (as `mappings`, `exclude` and `ignore`, next to
the target), so they can be replayed by the non-interactive commands, for example in CI:

```bash
modshift migrate my-pack.mrpack --out my-pack-1.21.1.mrpack   # uses modshift.config.json
```

The interactive mode needs a terminal. In scripts it refuses to start; use `analyze` and `migrate`
instead. Press Ctrl+C at any time to quit without saving (exit code 130).
