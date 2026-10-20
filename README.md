# ModShift

> Migrate a Minecraft modpack to another Minecraft version and/or mod loader.

ModShift is an open-source command-line tool (TypeScript, Node.js 20+) that takes a modpack —
for example **1.20.1 Forge** — and checks, mod by mod, whether it can be moved to a target such as
**1.21.1 NeoForge**. It uses the public [Modrinth API v2](https://docs.modrinth.com/api/) to find
compatible versions, suggest alternatives and resolve dependencies.

> **Status:** early development. See [PROGRESS.md](./PROGRESS.md) for what works today.

## Planned features

- Inputs: Modrinth `.mrpack`, CurseForge export `.zip` (`manifest.json`), or a folder of `.jar` files.
- Mod identification by SHA-1 / SHA-512 hash through Modrinth, with jar metadata
  (`fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`, `META-INF/neoforge.mods.toml`).
- Per-mod status: **compatible**, **update found**, **alternative suggested** (to verify),
  **not found**.
- Required-dependency resolution and incompatibility detection.
- Reports as a console table, JSON or Markdown.
- Local cache of API responses and an `--offline` mode.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm test
```

Tests never hit the real network: HTTP is mocked and the global `fetch` is disabled in the
test setup.

## License

MIT
