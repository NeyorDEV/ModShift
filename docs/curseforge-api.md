# CurseForge API notes

ModShift can resolve the `projectID` / `fileID` references of a CurseForge export
(`manifest.json`) through the CurseForge API. This feature is **optional**.

## Enabling it

- Get an API key from the [CurseForge for Studios console](https://console.curseforge.com).
- Export it as `CURSEFORGE_API_KEY` in your shell or CI secrets. ModShift reads the key **only**
  from this environment variable: never from a file, a command-line option or the config.
- Without a key, CurseForge references are not resolved. The report says so with a warning, and
  each reference is listed as "not found" with that reason.

The key is sent only in the `x-api-key` header to `api.curseforge.com`. It never appears in cache
keys, logs or error messages.

## What ModShift does with the API

1. `POST /v1/mods/files` with `{"fileIds": [...]}` → file name, size and hashes (`algo` 1 = SHA-1,
   2 = MD5).
2. `POST /v1/mods` with `{"modIds": [...]}` → project name and slug.
3. The file's **SHA-1** is then looked up on Modrinth. Many authors publish the very same jar on
   both platforms, so this is a reliable, verified identification.
4. When the hash is unknown on Modrinth, the CurseForge slug is tried as a Modrinth slug. This is
   reported as "identified by mod id only (unverified)".

Responses are wrapped in `{"data": ...}` and cached like Modrinth responses (`--cache-ttl`,
`--offline`, `modshift cache`). On `429` and `5xx` responses, the client retries with backoff and
honours `Retry-After`.

## Terms of use

ModShift **never downloads files from CurseForge** and never writes CurseForge URLs into generated
packs (the `.mrpack` format only allows Modrinth and GitHub download domains anyway). Only metadata
is used, to identify mods. This avoids redistributing files whose authors disabled third-party
distribution (`downloadUrl: null` / `allowModDistribution: false`).

Read the API terms shown in the CurseForge for Studios console (where the key is created) before
using your key in automation.

## How this was verified

The official documentation (`docs.curseforge.com`) and the API host are not reachable from the
environment ModShift was developed in, so they could not be read directly. The endpoints, the
`x-api-key` header, the `data` wrapper, field names and enum values were cross-checked in two
widely used open-source clients, which agree with each other:

- [packwiz](https://github.com/packwiz/packwiz): `curseforge/request.go`;
- [Prism Launcher](https://github.com/PrismLauncher/PrismLauncher):
  `launcher/modplatform/flame/FlameAPI.cpp`, whose comments link to the matching sections of the
  official docs.

The public rate limits are not documented in these sources. ModShift sends at most two batched
requests per pack.

**Not verified against the live API.** Run it once with a real key before relying on it.
