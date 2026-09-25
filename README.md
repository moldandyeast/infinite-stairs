# Strange Loop Parade

An endless marching band climbing an impossible Penrose stair, cut to a drone soundtrack with slot-machine and anime effects. By RM.

Live: https://infinite-stairs.moldandyeast.com

More at https://content.moldandyeast.com · follow [@nilsedison](https://twitter.com/nilsedison) on Twitter · [source on GitHub](https://github.com/moldandyeast/infinite-stairs).

## Structure

- `public/index.html` — the whole piece: one canvas, one script, no build step.
- `wrangler.jsonc` — Cloudflare Worker serving `public/` as static assets on the custom domain.

## Run locally

```sh
npm install
npm run dev
```

## Deploy

```sh
npm run deploy
```
