# Security

## Reporting a vulnerability

Please report vulnerabilities privately, through GitHub's
[security advisories](https://github.com/NeyorDEV/ModShift/security/advisories/new) for this
repository, rather than in a public issue. Include the ModShift version, the command you ran and,
if possible, a minimal pack that reproduces the problem.

## Threat model

ModShift reads modpacks and jar files downloaded from the internet. They must be treated as
**untrusted input**. The review below lists what is done about each risk. It applies to the CLI;
the local web UI has its own section in its documentation.

| Risk                                | Mitigation                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code execution from jars**        | Jars are only read as zip archives: ModShift extracts `fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`, `META-INF/neoforge.mods.toml` and `META-INF/MANIFEST.MF` as text. No class is loaded, nothing is executed (no `eval`, no child process, nothing imported from input content). |
| **Zip slip** (`../` paths)          | Entries are never written to disk by their archive name. `.mrpack` index paths and override paths must be safe relative paths (no `..`, absolute path, backslash, drive prefix or Windows device name), or they are ignored with a warning. Generated packs are re-validated before writing.   |
| **Zip bombs**                       | Before inflating, ModShift checks the declared size of each entry (256 MiB, 8 MiB for jar metadata), the total (1 GiB, 32 MiB for jar metadata) and the number of entries (50,000). Pack files over 1 GiB are refused.                                                                         |
| **Malformed metadata**              | JSON and TOML are parsed with safe parsers (`JSON.parse`, `smol-toml`). Every field is type-checked before use, and parse errors are reported as warnings for that jar only.                                                                                                                   |
| **Symbolic links** in a mods folder | Only regular files are read; links are skipped.                                                                                                                                                                                                                                                |
| **Config file**                     | `modshift.config.json` is limited to 1 MiB, validated strictly (unknown keys rejected) and never evaluated.                                                                                                                                                                                    |
| **Secrets**                         | The only secret is the optional `CURSEFORGE_API_KEY`, read from the environment and sent only to `api.curseforge.com`. It never appears in cache keys, logs, reports or error messages. There is no secret in the repository.                                                                  |
| **Network**                         | Only HTTPS requests to `api.modrinth.com` (and `api.curseforge.com` with a key), with a fixed User-Agent, timeouts, retry limits and client-side rate limiting.                                                                                                                                |
| **Files written**                   | Only cache entries (hashed names inside the cache directory) and the paths you pass (`--output`, `--out` and the `MIGRATION_REPORT.md` next to it). `--out` is never overwritten without `--force`.                                                                                            |

## Out of scope

- ModShift does not scan jars for malware: a mod found on Modrinth or CurseForge can still be
  malicious. Only install mods from authors you trust.
- Alternatives and mod-id matches are suggestions: check them before playing.
