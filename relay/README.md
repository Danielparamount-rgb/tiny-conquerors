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

## Stock Market 1968 tables

The same process also hosts the turn-based money game's online tables — an even
simpler room type, kept deliberately separate from the lockstep rooms above.

A **table** is a 4-letter code, an opaque state blob with a revision number, the
people sitting at it (each phone identified by a token it remembers), and the last
60 lines of table talk. Whoever finishes a turn posts the whole new state; the relay
stores it and fans it out. It never looks inside the blob and has no rules in it.

Tables live in memory and outlive their sockets (games span days); one untouched
for two weeks is swept. Every phone keeps its own copy of the latest state, so when
the free-tier service restarts the first phone back **re-seeds** the table under its
old code and play carries on. If the relay comes back holding an older revision than
a phone remembers, the newest copy wins.

**client → server**

| message | meaning |
| --- | --- |
| `{t:'tbHost', name, tok, code?, state?, rev?}` | open a table; with `code` + `state` it re-seeds one (a live code just sits you down) |
| `{t:'tbJoin', code, name, tok}` | sit at a table by code |
| `{t:'tbState', rev, state, notify?}` | publish revision `rev` (must be current + 1); `notify` lists `{tok, title, body, url}` pushes to send |
| `{t:'tbChat', n, c, x}` | a line of table talk (name, colour, text) |
| `{t:'tbPush', sub, tok?}` | remember a web-push subscription for a token (`null` forgets it) |
| `{t:'tbLeave'}` | stand up (the seat stays yours) |

**server → client**

`{t:'tbJoined', code, rev, state, chat, members, push}`, `{t:'tbState', rev, state, by}`,
`{t:'tbAck', rev}`, `{t:'tbStale', rev, state}` (your publish was behind — here is the live
table), `{t:'tbChat', n, c, x, tm}`, `{t:'tbMembers', members:[{tok, name, on}]}`,
`{t:'tbPushOk', ok}`, `{t:'err', msg, code}` (`code:'nosuch'` carries the table code so a
phone with a copy can re-seed).

Frames are capped at 256 KB; a table's state is refused above 200 KB.

### "Your throw" notifications (web push)

Push is off until the service carries VAPID keys. Generate a pair once —

```bash
cd relay && npm install && node vapid.mjs
```

— and set the three printed variables on the Render service (Environment):
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` address). Never commit
the private key. `GET /push-key` then returns the public key the app subscribes with; without
keys it answers 404 and the app hides its notification switch. Only people sitting at the
table can be notified, never the sender.

### Tests

`npm run test:tables` (from the repository root) spawns the relay on a spare port and checks
host/join, revisions, stale detection, chat, presence, oversize refusal and re-seeding after
a restart.

### Keeping it warm, tracing tables

`.github/workflows/relay-warm.yml` pings `/healthz` every ten minutes so the free tier does
not sleep between evenings. Set `TABLE_DEBUG=1` on the service to log every table publish
(token, revision, socket state) to stderr — off by default.
