# Tiny Conquerors

A pocket-sized age of kings — an original browser RTS inspired by Age of Empires II: The Conquerors.
Isometric, playable on phone (touch) and desktop (mouse + hotkeys). Single self-contained HTML file,
no external assets, no build step.

**Play:** deployed as a static site (see `app/`). Installable as a PWA — "Add to Home Screen" and it
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

The host redeploys on push to `main`.

## Art and audio

All graphics and sounds are original: buildings, units, and terrain are drawn procedurally to
canvas, and every sound is synthesized live with the WebAudio API. No Age of Empires assets are
used or redistributed — the resemblance is a deliberate stylistic homage, built from scratch.
