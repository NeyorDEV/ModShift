<!-- Generated from README.md by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->

# Programmatic API

```ts
import { analyzePack, loadPack, ModrinthClient, FileCache, defaultCacheDir } from 'modshift';

const pack = await loadPack('my-pack.mrpack');
const api = new ModrinthClient({ cache: new FileCache(defaultCacheDir()) });
const result = await analyzePack(pack, { minecraftVersion: '1.21.1', loader: 'neoforge' }, api);
console.log(result.summary);
```

Types are included. See [`src/index.ts`](https://github.com/NeyorDEV/ModShift/blob/main/src/index.ts) for everything that is exported.
