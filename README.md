# Tiny Conquerors

A pocket-sized age of kings — an original browser RTS inspired by Age of Empires II: The Conquerors.
Isometric, playable on phone (touch) and desktop (mouse + hotkeys). Single self-contained HTML file,
no external assets, no build step.

**Play:** <https://danielparamount-rgb.github.io/tiny-conquerors/> — deployed from `app/` by the
`pages` workflow on every push to `main`. Installable as a PWA — "Add to Home Screen" and it
runs offline.

## Layout

| Path | What it is |
| --- | --- |
| `tiny-conquerors.html` | The game. Canonical source, wrapper-free (~5000 lines). |
| `app/` | Deployable PWA bundle — this is the static-site publish directory. |
| `build-app.ps1` | Rebuilds `app/index.html` from the game source. Run after every change. |
| `serve.ps1` | Local dev server on <http://localhost:8741/>. |
| `HANDOFF.md` | Architecture notes, gotchas, and change history. |
| `AOE2-REFERENCE.md` | Visual-style reference notes. |

## Deploying an update

```
pwsh build-app.ps1          # regenerate app/index.html
# bump VERSION in app/sw.js (tq-v1 -> tq-v2, ...) so clients drop the old cache
git add -A && git commit -m "..." && git push
```

GitHub Pages redeploys on push to `main` (the `pages` workflow).

## Also in this repo: Stock Market 1968

`stock-market.html` — an original web revival of the 1968 roll-and-move stock-market board
game: 8 blue-chip stocks, a slider quotation board, dividends, stockholders' meetings, and
the race to $100,000. 2–8 investors (pass-and-play humans and/or computer opponents),
phone-first, single self-contained file, autosaves locally. Deployable copy lives at
`app/market/index.html` (served at <https://danielparamount-rgb.github.io/tiny-conquerors/market/>). Installable as its own
app — open `/market/` on a phone and use the Install button (Android) or Share → Add to
Home Screen (iPhone); it runs full-screen with its own icon and works offline. Design and
provenance notes: `STOCK-MARKET-NOTES.md`.

## Art and audio

All graphics and sounds are original: buildings, units, and terrain are drawn procedurally to
canvas, and every sound is synthesized live with the WebAudio API. No Age of Empires assets are
used or redistributed — the resemblance is a deliberate stylistic homage, built from scratch.
