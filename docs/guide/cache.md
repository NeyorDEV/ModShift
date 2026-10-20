<!-- Generated from README.md by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->

# Cache and offline mode

API responses are cached as JSON files (24 h by default):

```bash
modshift analyze pack.mrpack --mc 1.21.1 --loader fabric            # fills the cache
modshift analyze pack.mrpack --mc 1.21.1 --loader fabric --offline  # no network at all
modshift cache stats
modshift cache clear --expired
```

In `--offline` mode, any cached entry is used whatever its age. A missing entry names the request
(for example "the hash lookup of 42 file(s)"). Uncached alternative searches are skipped with a
warning instead of failing the whole run.
