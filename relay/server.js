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
 *     {t:'host', name}                 create a room, become seat 0
 *     {t:'join', code, name}           take the next free seat
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
  broadcast(room, lobbyView(room));
  touch(room);
}

/* --------------------------------- HTTP --------------------------------- */
const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
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
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

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
          started: false, seed: 0, cfg: null, hashes: new Map(), seen: Date.now(),
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
        if (r.started) return send(ws, { t: 'err', msg: 'that battle has already begun' });
        const seat = r.seats.findIndex((s) => !s);
        if (seat < 0) return send(ws, { t: 'err', msg: 'that room is full' });
        ws.pname = cleanName(m.name);
        r.seats[seat] = { ws, name: ws.pname, civ: 0, team: seat };
        ws.room = r; ws.seat = seat;
        send(ws, { t: 'joined', code, seat, host: false });
        broadcast(r, lobbyView(r));
        send(ws, lobbyView(r));
        touch(r);
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

/* Dead sockets and abandoned rooms. Render's free tier will also idle the whole
   service out after a while — that is expected, the client reconnects. */
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { try { ws.terminate(); } catch (_) {} return; }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  });
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (now - r.seen > IDLE_MS || r.seats.every((s) => !s)) rooms.delete(code);
  }
}, 30000);

server.listen(PORT, () => {
  console.log('Tiny Conquerors relay listening on ' + PORT);
});
