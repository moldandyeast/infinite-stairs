# Strange Loop Parade

An endless marching band climbing an impossible Penrose stair, cut to a drone soundtrack with slot-machine and anime effects. By RM.

Live: https://infinite-stairs.moldandyeast.com

More at https://content.moldandyeast.com · follow [@nilsedison](https://twitter.com/nilsedison) on Twitter · [source on GitHub](https://github.com/moldandyeast/infinite-stairs).

Move version, driven by your body: https://infinite-stairs.moldandyeast.com/move/

## Structure

- `public/index.html` — the classic piece: one canvas, no build step.
- `public/parade.js` — the engine (world, render, audio, control deck). Exposes `window.parade` for other pages.
- `public/move/` — the body-driven version. MediaPipe Pose runs in the browser; nothing leaves the device.
  - `mapping.js` — pure functions: landmarks → body signals → knob targets (unit tested).
  - `move.js` — camera, model loading, tracking loop, skeleton picture-in-picture, deck integration.
- `wrangler.jsonc` — Cloudflare Worker serving `public/` as static assets on the custom domain. No server code.

## Move: how the body maps to the deck

| Movement | Knobs |
|---|---|
| Arm spread | zoom (wide arms = wide shot) |
| Hands up | chaos, cuts |
| Lean | dutch |
| Walk left / right | hue |
| Step closer | filter |
| Motion energy | shake, glitch, speed lines |
| Left hand height | kick |
| Right hand height | drone |
| Stomp or jump | punch burst |

The other knobs stay manual. Driven knobs show a pink dot on the deck. When nobody is in frame they ease back to where they were. Keys: B toggles the body, V hides the skeleton, K opens the deck, R randomizes.

## Run locally

```sh
npm install
npm run dev
```

## Test

```sh
npm test            # unit tests for the mapping
npm run test:browser  # Playwright smoke test of both pages with a fake camera
```

## Deploy

```sh
npm run deploy
```
