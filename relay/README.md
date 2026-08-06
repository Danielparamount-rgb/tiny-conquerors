# Tiny Conquerors — command relay

A deliberately stupid WebSocket fan-out for the game's lockstep multiplayer. It
knows about rooms, seats and opaque blobs; it knows nothing about maps, units or
rules.

Every peer runs the identical deterministic simulation, so they only need to
agree on **which commands happened on which turn** — that is all this forwards.
Putting game logic in here would mean two implementations of the rules to keep in
step, which is the thing lockstep exists to avoid.

## Run it locally

```bash
npm install
npm start
```

Listens on `PORT` (default 8080). The game connects to `ws://localhost:8080`
automatically when it is served from localhost, and to the deployed relay
otherwise — see `netUrl()` in `tiny-conquerors.html`.

## Deploy on Render

New → **Web Service** (not a static site) → same GitHub repo →

| setting | value |
| --- | --- |
| Root Directory | `relay` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |

Then set the hostname in `netUrl()` to match the service URL.

**Free tier caveat:** the service sleeps after ~15 minutes idle and takes about
50 seconds to wake. The first player to press Host after a quiet spell will see
"could not reach the relay" and needs to try again once. The client says so in
those words rather than pretending something else went wrong.

## Protocol

JSON text frames; `t` is the message type.

**client → server**

| message | meaning |
| --- | --- |
| `{t:'host', name}` | create a room, take seat 0 |
| `{t:'join', code, name}` | take the next free seat |
| `{t:'seat', civ, team}` | your lobby choices |
| `{t:'cfg', cfg}` | host only: map, difficulty, pace, AI count |
| `{t:'start', seed}` | host only: lock the lobby and begin |
| `{t:'cmds', turn, cmds}` | your command list for a future turn |
| `{t:'hash', turn, h}` | your `stateHash()` for a completed turn |
| `{t:'chat', msg}` | |
| `{t:'ping'}` | |

**server → client**

`{t:'joined'}`, `{t:'lobby'}`, `{t:'start'}`, `{t:'cmds'}`, `{t:'left'}`,
`{t:'desync'}`, `{t:'chat'}`, `{t:'err'}`, `{t:'pong'}`.

## Two things it does on purpose

**Seats come from the socket, never from the message.** A `cmds` frame is
re-stamped with the sender's real seat before it goes out, so a modified client
cannot issue orders as somebody else. (The game's own command handlers enforce
ownership again on arrival — belt and braces.)

**It watches the hashes.** Peers post a state fingerprint every turn; the moment
two disagree the whole room is told. A desync is a bug, and the players should
find out in a second rather than after ten minutes of divergence.
