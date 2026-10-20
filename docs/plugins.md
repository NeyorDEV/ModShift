# Mod sources (plugins)

ModShift gets its data from **sources**. Modrinth is the primary source: the engine queries it
directly to identify files by hash, find versions for the target and resolve dependencies.
Other sources plug in at two points:

| Hook             | When                                                  | Example                                                                 |
| ---------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `prepare`        | before the analysis, once per pack                    | CurseForge turns manifest references into file names and SHA-1 hashes   |
| `findCandidates` | after the analysis, for mods without a target version | GitHub Releases proposes a release `.jar` whose name matches the target |

What a source proposes through `findCandidates` is listed in the reports under **"Other sources
(to verify)"**. It is **never added to the migrated pack**: it is matched by file name only, and a
`.mrpack` needs SHA-1 and SHA-512 hashes that these sources usually do not provide.

## Built-in sources

| Id                | Name            | Hook             | Configuration                                                    |
| ----------------- | --------------- | ---------------- | ---------------------------------------------------------------- |
| `modrinth`        | Modrinth        | (primary)        | none                                                             |
| `curseforge`      | CurseForge      | `prepare`        | `CURSEFORGE_API_KEY` environment variable                        |
| `github-releases` | GitHub Releases | `findCandidates` | `sources.github-releases` in the config, optional `GITHUB_TOKEN` |

### GitHub Releases

List the repositories to look at, per mod (file name with `*` wildcards, Modrinth slug or project
id, or the mod id from the jar):

```json
{
  "sources": {
    "github-releases": {
      "repositories": {
        "my-private-mod.jar": "someone/my-private-mod",
        "othermod": "someone-else/other-mod"
      },
      "prereleases": false
    }
  }
}
```

For each listed mod without a version on Modrinth, ModShift reads
`GET https://api.github.com/repos/{owner}/{repo}/releases?per_page=30` and proposes up to three
`.jar` assets, newest first, whose file name contains the target Minecraft version (`1.21.1`, not
`1.21.10`) and, if it names a loader, one the target accepts. Drafts, pre-releases (unless
`prereleases` is `true`), uploads in progress and `-sources`/`-dev`/`-javadoc` jars are skipped.

- **Token:** optional, read only from `GITHUB_TOKEN`, sent as `Authorization: Bearer …`. Without a
  token GitHub allows 60 requests per hour; one request is made per listed repository.
- **Offline (`--offline`):** nothing is sent; a warning is added.
- **Errors** (missing repository, rate limit, network) become warnings: the analysis goes on.
- Contract checked against GitHub's official OpenAPI description
  ([github/rest-api-description](https://github.com/github/rest-api-description)) and docs.

## Writing a source

A source is a plain object implementing `ModSource` (exported by the `modshift` package):

```ts
import {
  analyzePack,
  CANDIDATE_NOTE,
  createDefaultRegistry,
  CurseForgeClient,
  findExternalCandidates,
  type ModSource,
  type SourceContext,
} from 'modshift';

const mirror: ModSource = {
  id: 'my-mirror', // lowercase letters, digits and dashes; also the key in "sources"
  name: 'My mirror',
  description: 'Jars hosted on our own server.',
  validateOptions(options) {
    if (typeof options !== 'object' || options === null) {
      throw new Error('"sources.my-mirror" must be an object');
    }
  },
  async findCandidates(mod, target, context) {
    if (context.offline) return [];
    const url = (context.options as Record<string, string> | undefined)?.[mod.fileName];
    if (!url) return [];
    return [
      {
        source: 'my-mirror',
        title: mod.title ?? mod.fileName,
        version: target.minecraftVersion,
        fileName: url.split('/').pop() ?? mod.fileName,
        url,
        reason: 'listed in our mirror',
        note: CANDIDATE_NOTE,
      },
    ];
  },
};

const registry = createDefaultRegistry({
  createCurseForgeClient: (apiKey) => new CurseForgeClient({ apiKey }),
}).register(mirror);
```

Then, after `analyzePack`, call `findExternalCandidates(result, pack, registry, contextFor)`, where
`contextFor(source)` returns a `SourceContext` (`env`, the source's `options`, `offline`, `warn`,
`log`, `debug`). See `src/commands/analyze.ts` for the CLI's version.

Rules for a source:

- **Never throw for an expected failure** (network, HTTP error, missing data): call
  `context.warn(...)` and return `[]`.
- **Send nothing when `context.offline` is true.**
- Read credentials **only** from `context.env`; never from files or command-line options.
- Every candidate has `source` equal to the source id, an `https://` URL, a `reason` and
  `note: CANDIDATE_NOTE` ("external source, to verify").
- `prepare` must leave a pack it has nothing to do with unchanged.

The CLI only loads the built-in sources. Third-party sources are registered through the
programmatic API: ModShift never loads code named in a configuration file.

## Contract tests

`test/sources/contract.ts` is a reusable [Vitest](https://vitest.dev) suite that checks these rules
(`describeSourceContract(label, scenario)`), with the network replaced by a fake `fetch`. Every
built-in source and a minimal third-party example run it (`test/sources/contract.test.ts`). To
test your own source, copy the file next to your tests and call it with your source's factory and a
scenario where it should find a file.
