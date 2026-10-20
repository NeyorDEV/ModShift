# ModShift Check (GitHub Action)

Checks, on every pull request, whether a modpack can move to a target Minecraft version and
loader. The report goes to the **job summary** and to **one pull request comment**, updated on
each run.

> Not published on the GitHub Marketplace. Use it straight from this repository
> (`NeyorDEV/ModShift/action@<ref>`), pinned to a tag or a commit.

## Usage

```yaml
name: ModShift
on:
  pull_request:
    paths: ['pack/**', 'modshift.config.json']

permissions:
  contents: read
  pull-requests: write # to post the comment

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: NeyorDEV/ModShift/action@main # pin a tag or a commit SHA
        with:
          pack: pack/my-pack.mrpack
          mc: '1.21.1'
          loader: neoforge
          fail-on: not-found
```

## Inputs

| Input                | Default                  | Description                                                                       |
| -------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| `pack`               | (required)               | `.mrpack`, CurseForge export `.zip` or folder of `.jar` files.                    |
| `mc`, `loader`       | from the config          | Target Minecraft version and loader (or `target` in `modshift.config.json`).      |
| `side`               | `both`                   | `client`, `server` or `both`.                                                     |
| `config`             | `./modshift.config.json` | Configuration file.                                                               |
| `fail-on`            | (empty: never fail)      | Comma-separated statuses that fail the job: `not-found`, `alternative-suggested`… |
| `comment`            | `true`                   | Post and update one comment on the pull request.                                  |
| `token`              | `${{ github.token }}`    | Token for the comment; needs `pull-requests: write`.                              |
| `curseforge-api-key` | (none)                   | Pass a secret to resolve CurseForge export references.                            |
| `node-version`       | `22`                     | Node.js version.                                                                  |

## Outputs

`report` (Markdown report path), `json` (JSON report path), and the number of mods per status:
`compatible`, `update-found`, `alternative-suggested`, `not-found`.

## Notes

- ModShift is built from the action's repository on each run (`npm ci && npm run build`, about a
  minute), since it is not on npm yet.
- The API cache lives in the runner's temporary folder; it is not kept between runs.
- **Pull requests from forks** get a read-only token: the comment cannot be posted, a warning is
  shown and the report stays in the job summary.
- Inputs are passed to the script through environment variables, never interpolated into a shell
  command, and the pack path is passed after `--`.
