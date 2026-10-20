# `.mrpack` format notes

ModShift writes `.mrpack` files that follow the Modrinth modpack format. The public documentation
(`support.modrinth.com` / `docs.modrinth.com`) cannot be reached from the development
environment, so these rules were taken from Modrinth's own source code, which is what actually
validates and installs packs (repository `modrinth/code`, branch `main`, read in October 2026):

- `apps/labrinth/src/models/v3/pack.rs`: `PackFormat` / `PackFile` structures and their validation;
- `apps/labrinth/src/validate/modpack.rs`: the upload validator;
- `packages/path-util/src/lib.rs`: `SafeRelativeUtf8UnixPathBuf` (file path rules);
- `apps/labrinth/.env.local`: `WHITELISTED_MODPACK_DOMAINS`;
- `packages/app-lib/src/api/pack/install_from.rs` and `install_mrpack.rs`: the Modrinth App
  installer.

## Archive layout

- A zip archive with `modrinth.index.json` at its root.
- Optional `overrides/`, `client-overrides/` and `server-overrides/` folders, copied into the
  instance folder (client/server variants apply only to that side).
- A pack must list at least one file or contain an `overrides/` folder.

## `modrinth.index.json`

| Field           | Type   | Rule                                                                    |
| --------------- | ------ | ----------------------------------------------------------------------- |
| `formatVersion` | int    | `1`                                                                     |
| `game`          | string | must be `"minecraft"`                                                   |
| `versionId`     | string | 1 to 512 characters                                                     |
| `name`          | string | 1 to 512 characters                                                     |
| `summary`       | string | optional, at most 2048 characters                                       |
| `files`         | array  | see below                                                               |
| `dependencies`  | object | keys: `minecraft`, `forge`, `neoforge`, `fabric-loader`, `quilt-loader` |

The installer requires a `minecraft` dependency ("pack did not specify Minecraft version").

### `files[]`

| Field       | Type     | Rule                                                                             |
| ----------- | -------- | -------------------------------------------------------------------------------- |
| `path`      | string   | safe relative Unix path (see below)                                              |
| `hashes`    | object   | **both** `sha1` and `sha512` are required ("All pack files must provide…")       |
| `env`       | object   | optional; `client` / `server` → `required`, `optional`, `unsupported`, `unknown` |
| `downloads` | string[] | canonical absolute URLs on an allowed domain                                     |
| `fileSize`  | int      | unsigned 32-bit integer (bytes)                                                  |

Path rules: not empty, no leading `/`, no Windows drive prefix, no backslash, no `..` component,
and no reserved Windows device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`).

Allowed download domains: `cdn.modrinth.com`, `github.com`, `raw.githubusercontent.com`. A URL must
be identical to its parsed, normalised form.

ModShift checks all of these rules in `src/migrate/mrpackSpec.ts` before writing a pack. The JSON
Schema in `schemas/modrinth.index.schema.json` describes the same structure for external tools
and tests.
