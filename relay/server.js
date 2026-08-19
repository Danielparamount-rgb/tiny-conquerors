'use strict';
/* ===================== Tiny Conquerors — command relay =====================
 *
 * Deliberately stupid. It knows about rooms, seats and blobs; it knows nothing
 * about maps, units or rules. Every peer runs the identical deterministic
 * simulation and they only need to agree on WHICH COMMANDS happened on WHICH
 * TURN — so that is all this forwards. Adding game logic here would mean two
 * implementations of the rules to keep in step, which is the thing lockstep
 * exists to avoid.
 *
 * The one judgement it does make is desync detection: peers post a hash of
 * their world state every turn, and if two peers disagree the room is told at
 * once rather than drifting silently for ten minutes.
 *
 * Protocol is JSON text frames, `t` is the type.
 *
 *   client -> server
 *     {t:'host', name, v}              create a room, become seat 0 (v = build version)
 *     {t:'join', code, name, v}        take the next free seat — v must match the host's
 *     {t:'seat', civ, team}            set your civ / team in the lobby
 *     {t:'cfg', cfg}                   host only: map, difficulty, pace, AI count
 *     {t:'start', seed}                host only: lock the lobby and begin
 *     {t:'cmds', turn, cmds}           your command list for a future turn
 *     {t:'hash', turn, h}              your stateHash() for a completed turn
 *     {t:'chat', msg}
 *     {t:'ping'}
 *
 *   server -> client
 *     {t:'joined', code, seat, host}   you are in
 *     {t:'lobby', players, cfg, host}  whenever the lobby changes
 *     {t:'start', seed, cfg, players}  the match begins
 *     {t:'cmds', seat, turn, cmds}     someone else's commands
 *     {t:'left', seat, name}           someone dropped
 *     {t:'desync', turn, hashes}       the peers stopped agreeing
 *     {t:'err', msg}
 *     {t:'pong'}
 */

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const MAX_SEATS = 8;
const MAX_ROOMS = 200;
const IDLE_MS = 30 * 60 * 1000;      // a room with nobody talking is swept
const MAX_FRAME = 64 * 1024;         // a turn's commands are tiny; anything huge is a bug or an attack
/* When somebody drops mid-battle their seat is handed to the computer. Every
   peer must do that on the SAME turn or the simulations part company, and only
   the relay knows the socket died — so the relay names the turn. It picks one
   comfortably beyond anything any peer has sent for, because no peer can have
   executed past the dropped player's last command yet. */
const AI_TAKEOVER_DELAY = 20;        // turns (~1s) — invisible, and far beyond NET_LAG
/* Reconnect works by REPLAY, not by shipping a snapshot. A snapshot of this game
   hashes identical on load and then diverges the moment it is stepped, because
   saveGame drops unit paths and reloading rewinds the simulation RNG. Replaying
   the command stream from turn 0 needs neither: it is the same determinism the
   whole design already rests on, and it measures at 159-709x real time, so a
   ten-minute absence is caught up in a few seconds.

   So the room keeps a journal: every NON-EMPTY command list plus every seat
   handover. Empty lists are the overwhelming majority and are simply implied. */
const MAX_JOURNAL = 40000;           // entries; past this a room stops being rejoinable
/* How fast a vanished player is noticed. This matters more than it looks: until
   the relay spots the drop, every other peer is stalled waiting for orders that
   are never coming.
   Locally a closed socket raises 'close' at once. Behind Render's proxy it does
   NOT — the server sees nothing at all, and the only thing that reveals the
   corpse is a missed heartbeat. Measured on the deployed service: with a 30s
   ping the delay was anywhere up to a minute.
   Pinging every 5s and allowing three misses puts detection at ~15-20s while
   still forgiving a phone that briefly suspends its tab. */
const PING_MS = 5000;
const MISSES_ALLOWED = 3;

/* Room codes skip O/0/I/1/S/5 — these get read aloud and typed on phones. */
const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ23456789';
const rooms = new Map();

function makeCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function cleanName(n) {
  return String(n == null ? '' : n).replace(/[^\w \-']/g, '').trim().slice(0, 16) || 'Player';
}

function lobbyView(room) {
  return {
    t: 'lobby',
    host: room.hostSeat,
    cfg: room.cfg,
    started: room.started,
    players: room.seats
      .map((s, i) => (s ? { seat: i, name: s.name, civ: s.civ, team: s.team } : null))
      .filter(Boolean),
  };
}

function send(ws, obj) {
  if (ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (_) { /* the socket is going away anyway */ }
  }
}

function broadcast(room, obj, exceptSeat) {
  room.seats.forEach((s, i) => { if (s && i !== exceptSeat) send(s.ws, obj); });
}

function touch(room) { room.seen = Date.now(); }

function journal(room, entry) {
  if (room.journalFull) return;
  room.journal.push(entry);
  // A room that outruns the journal simply stops being rejoinable. Better to say
  // so than to hand a returning player an incomplete replay, which would desync
  // them the moment they arrived.
  if (room.journal.length >= MAX_JOURNAL) { room.journalFull = true; room.journal = []; }
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  const seat = ws.seat;
  if (room.seats[seat] && room.seats[seat].ws === ws) room.seats[seat] = null;
  ws.room = null;
  const name = ws.pname || 'Player';
  const left = room.seats.filter(Boolean).length;
  if (left === 0) { rooms.delete(room.code); return; }
  // the host leaving promotes the lowest remaining seat, so a lobby never strands
  if (room.hostSeat === seat) room.hostSeat = room.seats.findIndex(Boolean);
  broadcast(room, { t: 'left', seat, name });
  if (room.started) {
    // Name the turn on which the computer picks up their banner. maxTurn is the
    // furthest ahead ANY peer has sent for, and nobody can have executed past
    // the leaver's last command, so this turn is still in everyone's future.
    const turn = (room.maxTurn || 0) + AI_TAKEOVER_DELAY;
    if (!room.aiSeats.includes(seat)) room.aiSeats.push(seat);
    room.vacated[seat] = name;                 // so they get their own seat back
    journal(room, { turn, ai: seat });
    broadcast(room, { t: 'ai', seat, turn, name });
  } else {
    broadcast(room, lobbyView(room));
  }
  touch(room);
}

/* --------------------------------- HTTP --------------------------------- */
/* Report mailbox: the game's benchmark mode POSTs a JSON blob here and a
   developer reads it back with GET /reports. Same philosophy as the rest of
   the relay — it stores opaque blobs and knows nothing about their contents.
   Memory only; a redeploy empties the box, which is fine for a mailbox. */
const REPORT_CAP = 30, REPORT_MAX = 32 * 1024;
const reports = [];
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  if (req.url === '/report' || req.url === '/reports') {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (req.method === 'POST' && req.url === '/report') {
      let body = '', dead = false;
      req.on('data', c => {
        if (dead) return;
        body += c;
        if (body.length > REPORT_MAX) { dead = true; res.writeHead(413, CORS); res.end(); req.destroy(); }
      });
      req.on('end', () => {
        if (dead) return;
        reports.push({ at: new Date().toISOString(), body: String(body).slice(0, REPORT_MAX) });
        while (reports.length > REPORT_CAP) reports.shift();
        res.writeHead(200, { ...CORS, 'content-type': 'text/plain' });
        res.end('ok');
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/reports') {
      res.writeHead(200, { ...CORS, 'content-type': 'application/json' });
      return res.end(JSON.stringify(reports));
    }
    res.writeHead(405, CORS); return res.end();
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(
    'Tiny Conquerors relay\n' +
    'rooms: ' + rooms.size + '\n' +
    'players: ' + [...rooms.values()].reduce((n, r) => n + r.seats.filter(Boolean).length, 0) + '\n'
  );
});

/* ------------------------------- WebSocket ------------------------------- */
const wss = new WebSocketServer({ server, maxPayload: MAX_FRAME });

wss.on('connection', (ws) => {
  ws.missed = 0;
  ws.on('pong', () => { ws.missed = 0; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (_) { return send(ws, { t: 'err', msg: 'bad message' }); }
    if (!m || typeof m.t !== 'string') return;
    const room = ws.room;

    switch (m.t) {
      case 'ping':
        return send(ws, { t: 'pong' });

      case 'host': {
        if (room) return send(ws, { t: 'err', msg: 'already in a room' });
        if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', msg: 'the relay is full — try again shortly' });
        const code = makeCode();
        if (!code) return send(ws, { t: 'err', msg: 'could not allocate a room' });
        const r = {
          code, seats: new Array(MAX_SEATS).fill(null), hostSeat: 0,
          // The build version the room runs on. The game's service worker
          // updates politely (never mid-match), so peers on DIFFERENT builds
          // are routine — and a mixed-version lockstep room is a guaranteed
          // desync. Refusing at the door beats drifting five minutes in.
          ver: typeof m.v === 'string' ? m.v.slice(0, 24) : '',
          started: false, seed: 0, cfg: null, hashes: new Map(),
          maxTurn: 0, seen: Date.now(),
          journal: [], journalFull: false,  // the replay a returning player needs
          startPlayers: null,               // the seats/civs the match was BUILT from
          aiSeats: [], vacated: {},         // who the computer holds, and under whose name
          sentUpTo: {},                     // seat -> highest turn it has sent for
        };
        rooms.set(code, r);
        ws.pname = cleanName(m.name);
        r.seats[0] = { ws, name: ws.pname, civ: 0, team: 0 };
        ws.room = r; ws.seat = 0;
        send(ws, { t: 'joined', code, seat: 0, host: true });
        send(ws, lobbyView(r));
        return;
      }

      case 'join': {
        if (room) return send(ws, { t: 'err', msg: 'already in a room' });
        const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
        const r = rooms.get(code);
        if (!r) return send(ws, { t: 'err', msg: 'no room with that code' });
        const jv = typeof m.v === 'string' ? m.v.slice(0, 24) : '';
        if (jv !== (r.ver || ''))
          return send(ws, { t: 'err', msg: 'Different game versions — close and reopen the game on BOTH devices, then try again. (host: ' + (r.ver || 'older build') + ', you: ' + (jv || 'older build') + ')' });
        const name = cleanName(m.name);

        if (r.started) {
          // Coming back to a battle in progress. Prefer the seat they left —
          // matched on name — so two people who both dropped don't swap towns.
          if (r.journalFull)
            return send(ws, { t: 'err', msg: 'that battle has run too long to rejoin' });
          let seat = r.aiSeats.find((s) => !r.seats[s] && r.vacated[s] === name);
          if (seat === undefined) seat = r.aiSeats.find((s) => !r.seats[s]);
          if (seat === undefined)
            return send(ws, { t: 'err', msg: 'that battle is under way and every seat is taken' });
          ws.pname = name;
          r.seats[seat] = { ws, name, civ: 0, team: 0 };
          ws.room = r; ws.seat = seat;
          /* Where the replay must stop and the live stream take over.
             Peers send turns in strictly increasing order, so for any turn at or
             below the LOWEST turn every present seat has sent for, the journal
             holds every non-empty list there will ever be — anything absent is
             genuinely empty. Above that line a lagging seat still owes us turns,
             and those arrive live, so the rejoiner waits for them normally.
             Cutting anywhere higher would have it invent empty commands for
             orders that simply hadn't been sent yet. */
          let cut = r.maxTurn;
          for (let s = 0; s < MAX_SEATS; s++) {
            if (s === seat || !r.seats[s]) continue;
            cut = Math.min(cut, r.sentUpTo[s] === undefined ? 0 : r.sentUpTo[s]);
          }
          send(ws, {
            t: 'rejoin', code, seat,
            seed: r.seed, cfg: r.cfg, players: r.startPlayers,
            journal: r.journal, turn: r.maxTurn, cut,
            // Above the cut a seat may already have sent turns the rejoiner will
            // never see again (they went out before it connected, and empty ones
            // were never journalled). Per-seat high-water marks let it fill those
            // in as empty rather than waiting for a message that isn't coming.
            sentUpTo: Object.assign({}, r.sentUpTo),
            aiSeats: r.aiSeats.slice(),
          });
          broadcast(r, { t: 'back', seat, name }, seat);
          touch(r);
          return;
        }

        const seat = r.seats.findIndex((s) => !s);
        if (seat < 0) return send(ws, { t: 'err', msg: 'that room is full' });
        ws.pname = name;
        r.seats[seat] = { ws, name, civ: 0, team: seat };
        ws.room = r; ws.seat = seat;
        send(ws, { t: 'joined', code, seat, host: false });
        broadcast(r, lobbyView(r));
        send(ws, lobbyView(r));
        touch(r);
        return;
      }

      case 'resume': {
        // The returning player says they have caught up. Name the turn on which
        // they take their own banner back; everyone flips on it together.
        if (!room || !room.started) return;
        if (!room.aiSeats.includes(ws.seat)) return;
        const turn = (room.maxTurn || 0) + AI_TAKEOVER_DELAY;
        room.aiSeats = room.aiSeats.filter((s) => s !== ws.seat);
        delete room.vacated[ws.seat];
        journal(room, { turn, hu: ws.seat });
        const msg = { t: 'human', seat: ws.seat, turn, name: ws.pname };
        broadcast(room, msg); send(ws, msg);
        touch(room);
        return;
      }

      case 'seat': {
        if (!room || room.started) return;
        const s = room.seats[ws.seat];
        if (!s) return;
        if (Number.isInteger(m.civ)) s.civ = Math.max(0, Math.min(63, m.civ));
        if (Number.isInteger(m.team)) s.team = Math.max(0, Math.min(7, m.team));
        broadcast(room, lobbyView(room));
        send(ws, lobbyView(room));
        touch(room);
        return;
      }

      case 'cfg': {
        if (!room || room.started) return;
        if (ws.seat !== room.hostSeat) return send(ws, { t: 'err', msg: 'only the host sets the battle' });
        room.cfg = m.cfg && typeof m.cfg === 'object' ? m.cfg : null;
        broadcast(room, lobbyView(room));
        send(ws, lobbyView(room));
        touch(room);
        return;
      }

      case 'start': {
        if (!room || room.started) return;
        if (ws.seat !== room.hostSeat) return send(ws, { t: 'err', msg: 'only the host can begin' });
        room.started = true;
        room.seed = (Number.isInteger(m.seed) ? m.seed : (Math.random() * 4294967296)) >>> 0;
        const view = lobbyView(room);
        // Remember the roster the simulation was BUILT from — a player who
        // rejoins later must reconstruct the same game, not the current lobby.
        room.startPlayers = view.players;
        const msg = { t: 'start', seed: room.seed, cfg: room.cfg, players: view.players, host: room.hostSeat };
        broadcast(room, msg); send(ws, msg);
        touch(room);
        return;
      }

      case 'cmds': {
        // The hot path. Forward verbatim and stamp the sender's seat — a peer
        // cannot claim to be somebody else, because the seat comes from the
        // socket rather than from the message.
        if (!room || !room.started) return;
        if (!Number.isInteger(m.turn) || !Array.isArray(m.cmds)) return;
        if (m.turn > (room.maxTurn || 0)) room.maxTurn = m.turn; // the takeover turn is chosen from this
        if (m.turn > (room.sentUpTo[ws.seat] || -1)) room.sentUpTo[ws.seat] = m.turn;
        // Only lists with something in them are journalled; empty is the common
        // case by a wide margin and a replay can simply assume it.
        if (m.cmds.length) journal(room, { turn: m.turn, seat: ws.seat, cmds: m.cmds });
        broadcast(room, { t: 'cmds', seat: ws.seat, turn: m.turn, cmds: m.cmds }, ws.seat);
        touch(room);
        return;
      }

      case 'hash': {
        if (!room || !room.started) return;
        if (!Number.isInteger(m.turn) || typeof m.h !== 'string') return;
        let byTurn = room.hashes.get(m.turn);
        if (!byTurn) { byTurn = {}; room.hashes.set(m.turn, byTurn); }
        byTurn[ws.seat] = m.h;
        const vals = Object.values(byTurn);
        if (vals.length > 1 && vals.some((v) => v !== vals[0]) && !room.desynced) {
          room.desynced = true;
          const all = { t: 'desync', turn: m.turn, hashes: byTurn };
          broadcast(room, all); send(ws, all);
        }
        // keep only a short trailing window — this is a check, not a journal
        if (room.hashes.size > 300) {
          const oldest = Math.min(...room.hashes.keys());
          room.hashes.delete(oldest);
        }
        touch(room);
        return;
      }

      case 'chat': {
        if (!room) return;
        const msg = String(m.msg == null ? '' : m.msg).slice(0, 200);
        if (!msg) return;
        broadcast(room, { t: 'chat', seat: ws.seat, name: ws.pname, msg });
        touch(room);
        return;
      }

      default:
        return;
    }
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

/* Dead sockets. Terminating one raises 'close', which is what actually runs
   leave() and starts the AI handover — behind a proxy this is the ONLY thing
   that does. */
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.missed >= MISSES_ALLOWED) { try { ws.terminate(); } catch (_) {} return; }
    ws.missed++;
    try { ws.ping(); } catch (_) {}
  });
}, PING_MS);

/* Abandoned rooms. Render's free tier will also idle the whole service out after
   a while, which ends any match in progress — in-memory rooms do not survive it. */
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (now - r.seen > IDLE_MS || r.seats.every((s) => !s)) rooms.delete(code);
  }
}, 30000);

server.listen(PORT, () => {
  console.log('Tiny Conquerors relay listening on ' + PORT);
});
