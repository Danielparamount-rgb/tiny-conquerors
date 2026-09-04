# Stock Market 1968 — design & provenance notes

`stock-market.html` is an original, self-contained web revival of the 1968 roll-and-move
stock-market board game published by Whitman (Western Publishing Co.) — "the classic money
game" with eight real-company stocks and a sliding price indicator in the middle of the
board. Playable 2–8 (any mix of humans pass-and-play and computer investors), phone-first,
no build step, no external assets beyond an optional Google Fonts load that degrades to
system faces offline.

All artwork, text, and sound here are original: the board is drawn in SVG, the rules text is
written from scratch in our own words, and every sound is synthesized with WebAudio. Company
names appear as historical references to the 1968 game's stock roster. Not affiliated with
the original publishers.

## Sources

The v6 build implements the actual rules printed inside the box lid, transcribed by the
owner of a physical copy, plus full-board photographs from the same copy. That covers the
rules of play essentially completely; the remaining reconstructions are layout details the
photographs could not resolve.

## The rules as implemented (from the owner's transcription)

- **Everybody starts at work** with no money, at one of four corner occupations:
  Prospector 2/12→$400 · Deep Sea Diver 3/11→$300 · Doctor 4/10→$200 · Policeman 5/9→$100.
  A salary pays **on every throw of its numbers, no matter which player throws**.
- **$1,000 banked → you must play the market**: place your piece on any of the four START
  squares, free. The $100 START fee is charged on *landing* there later, never on passing.
- **Movement follows printed arrows** — the arrow of the square being *left*. Leaving a
  START square instead branches on the throw: odd one way, even the other.
- **One indicator, see-saw prices**: every square lands moves the indicator by its printed
  amount; four issues climb as it rises, their mirror partners fall. At the ends of the
  table the indicator **bounces** — leftover movement reverses.
- **Buying** happens only at the moment of landing on a company square, that company only,
  any affordable amount, at the *post-move* price. Some squares are printed LIMIT 1 SHARE;
  meeting entrances allow exactly one. No buying on fee squares, SELL ALL squares, corners,
  or inside a meeting.
- **Selling** (voluntary) happens at one moment only: immediately before your own throw, at
  board prices. Forced sales — SELL ALL squares, or covering a bill — go at the stock's
  **very lowest board price**.
- **Cash dividends** pay the printed $1–$4 a share on landing, for shares already held —
  never for shares bought on that same landing.
- **Stockholders meetings** are detour rows, one per side, joining a mirror pair's two
  entrance squares. Land on an entrance to buy one share and step in; pass it mid-throw
  holding at least one share and you may turn in. Landing on **N FOR 1 pays N additional
  shares per share held** (5 held on 3 FOR 1 → 15 more). You continue through in the same
  direction, exit onto the paired stock's entrance, and follow its arrow; that entrance
  opens only on a later turn. You may sell at a meeting, never buy.
- **Going broke** (a bill unpayable even after forced sales) returns all stock and money to
  the bank and sends you back to work.
- **The win is judged at your own turn to throw**: cash plus stock at board prices reaching
  the target ($100,000 printed; the game offers $50,000 and $25,000 tables as the rules
  invite players to agree on other amounts).

## Table variants (setup options)

The printed rules invite the table to set its own terms, and the game offers two:

- **House-rules opening** — skips the working start entirely: every investor is dealt
  $1,000 and one share of every issue, standing on a START square (spread across the four
  sides), and the first throw plays immediately. Going broke still sends you back to work
  the classic way. Simulated house games run roughly half the length of classic ones.
- **Timed sitting** — no dollar target; after 20 full rounds the richest investor at the
  bell wins (the printed WINNING paragraph's "play for a specified time" variant).

- **Short game** — house opening, first to $25,000 *or* the richest after 15 rounds,
  whichever comes first (a rounds cap and a target can now coexist).
- **Partner play** — seats pair up (1&2, 3&4 …) and pool their worth: a side wins the moment
  any partner comes to the dice with the pair's combined worth at the target. Needs an even
  table of four or more.
- **Presets** — Printed Rules ($100,000, work for your stake), Family Game ($50,000) and Short
  Game set the options in one tap.

All are available in local setup and to the online host in the lobby, and all survive
save/resume.

## Computer investors (v13)

Five personalities can be seated, each with its own reserve, buying threshold, selling
threshold and appetite for meetings: **Steady Hand**, **Bold Plunger**, **Dividend Hunter**
(holds the $3–$4 payers), **Meeting Chaser** (a share at every entrance) and **Contrarian**
(buys the floor, sells the first bounce). Three skill levels sit on top: *Easy* dithers and
keeps cash, *Normal* plays the persona straight, *Hard* keeps the broker paid without floor
sales, buys only with real headroom and sells the top of a column. Simulated at $50,000:
easy tables run ~290 median turns, normal ~185, hard ~175. Computers also drop a line of
table talk in character (a big buy, a good sale, a meeting jackpot, going broke), at most one
every three turns each. `Autoplay to the End` lets the computer play every seat of a local
game, with Stop handing the dice back at the next human throw.

## Coach, referee, recap (v13)

- **Coach** — nine one-time pointers through a first game (the first throw, pay day, the
  arrows, the indicator, buying where you land, selling before the throw, meetings, the broker,
  SELL ALL), each a callout anchored to the control it talks about. Settings can switch it off
  or replay it; "Guided First Game" on the splash resets it.
- **Referee** — tapping any square opens its printed face, what happens there, and what it
  would do to *you* right now (where the indicator would go, the new price, your dividend or
  fee); every line of the Ticker Wire carries a `?` that opens the rule it came from (the engine
  tags each log line with a rule key, kept in `st.logWhy`).
- **Recap** — the win card shows net worth turn by turn, the indicator's journey (`st.mHist`),
  standings by side, the winner's story (best sale, realized gains and trades from a per-stock
  cost basis), household records kept per name on the device, and a shareable recap card
  (image via the Web Share API where available, text otherwise).

## Settings & accessibility (v13)

Sound, haptics, patterned pawns (eight SVG/CSS patterns so colour is never the only clue),
large type (a 15 % zoom), left-handed controls (dice and buttons swap sides), coach tips,
a reduce-motion override, and — on a relay table — turn notifications. Pawns carry spoken
titles (name and square), the indicator announces its notch, and the board's squares were
already labelled. A phone turned sideways gets two columns with the board sized to the height;
tablets and desks get the board at full height.

## Documented vs. reconstructed

The board is transcribed square by square from the owner's photographs. The track has
**48 squares**: the four corner squares are the PAY BROKER FEE squares (UP 20 and DOWN 20
alternating, each shared by the two sides it joins, each sending you on counter-clockwise),
and eleven squares run between them on every side with a SELL ALL beside each corner. The
four occupations (Prospector, Deep Sea Diver, Doctor, Policeman) are not track squares:
they are panels printed inside the board at the inner corners, where working pieces wait
for their stake — a correction the owner caught in v14 after v12 had placed them on the
corners and added a PAY square at both ends of every side. Every square's company, printed
dividend, indicator move, direction arrow and floor price is from the photographs; the two
PURCHASE LIMIT ONE SHARE squares on each side (3rd and 9th from a corner) carry the
STOCKHOLDERS ENTER wedges; the four boxed two-row meeting tracks have a 1 FOR 1 beside
each entrance on the outer row and seven cells across the inner row, palindromic on every
side. The printed arrows run clockwise on squares 1–8 of every side (read from that side's
seat) and counter-clockwise on squares 9–11 and the corners; START squares send odd throws
clockwise ("← ODD") and even the other way. Company colours follow the print (Alcoa red,
Am. Motors yellow, J.I. Case amber, Gen. Mills light blue, Int. Shoe magenta, Maytag teal,
Western Publishing light green, Woolworth rust).

| Feature | Value | Source |
| --- | --- | --- |
| Rules of play | see above | inside-cover transcription |
| Price table | ALC 30–230 / AMO 10–110 / JIC 15–75 / GMI 18–42 rising with the indicator; ISH, MAY, WPC, WLW mirror them falling; 51 rows; START row 130-60-45-30 / 30-45-60-130 | board photo |
| Square order, dividends, moves, arrows, floors | all 48 squares; PAY corners ±20 | board photos |
| Meeting tracks | bottom WLW↔ALC 1·2·1·2·3·2·1·2·1 · left GMI↔ISH 1·3·2·3·2·3·2·3·1 · top AMO↔WPC 1·2·3·2·1·2·3·2·1 · right JIC↔MAY 1·2·3·2·3·2·3·2·1 | board photos |
| Occupation panels (inner corners) | Prospector 2/12 $400 (bottom-right) · Deep Sea Diver 3/11 $300 (bottom-left) · Doctor 4/10 $200 (top-left) · Policeman 5/9 $100 (top-right) | board photos |
| Win target | $100,000 printed; $50,000 / $25,000 / timed offered | transcription (other terms by agreement) |
| Notch count | 51 (values printed every row) | board photo |

## Verification

A 30-test Playwright suite (`regress6.js` in the build session) checks one transcribed rule
per test — salary-on-anyone's-throw, the $1,000 threshold, free entry, landing-only fees,
arrow-following and odd/even branching, indicator bounce, landing-only buying with limits,
pre-throw-only selling, floor-price forced sales, the 5-on-3-FOR-1→15 meeting example,
exit-to-paired-entrance, no-buy-at-meetings, pre-held-only cash dividends, going broke, and
win-at-your-own-throw — plus a scripted click-through walkthrough of a full game and a
two-phone online simulation. Headless AI-vs-AI simulation (`window.__sim`) finishes ~150
median table turns at the $50,000 target.

## Online play

Two transports sit behind one `NET` interface.

**Over the relay (the installed app, v13).** On any host that ships the manifest (the static
deploy at `/market/`, an app shell, a dev server) the page talks to the Tiny Conquerors relay
over a WebSocket: Host a Table gets a four-letter code, Join with a Code (or an invite link,
`?table=CODE`) seats a friend, and after each turn the acting phone posts the whole table
state, which the relay fans out live — no reloads, no edit access. Chat is its own stream.
Every phone keeps a copy of the latest table; after a relay restart the first phone back
re-seeds it under the same code. Seats are claimed by name and pawn as before; presence dots
show who is connected. "Notify me on my turn" subscribes the phone to web push through the
relay (Android and installed-to-Home-Screen iPhone), and the phone that ends a turn tells the
relay whom to wake. Protocol and push setup: `relay/README.md`.

**Over the artifact (the claude.ai page).** The published artifact of this page supports online
multiplayer over the artifact runtime's self-publish capability: the page embeds the table state in a
`#netState` JSON block, and after each human turn the acting phone publishes a new version
of the page — every open view reloads to it. A lobby lets each device claim a seat (name
and pawn color) identified by a per-device token in localStorage; computer turns are
played by the next human's device and batched into that one publish; players need edit
access to the shared page (read-only viewers get a watch-only seat). On any host without
the artifact runtime (the static-site deploy, a local file), the online card hides itself
and the game is pass-and-play + computer opponents as before.

A **Table Talk** chat sits under the Ticker Wire: on an online table each message
publishes immediately (seated players only) and pops up as a toast on every other phone;
a message typed mid-move on your own device rides along with your turn's publish instead,
so your own dice are never reloaded out from under you. In local games the chat is a
saved table-notes strip. A **Holdings** breakdown (cash plus shares and value in every
issue, tap-through to the company card or Ledger) sits beside the board on desktop and as
a scrollable pill strip under the price chips on phones.

`app/market/index.html` is a verbatim copy for the static-site deploy; regenerate it by
copying `stock-market.html` after any change.

## Installable app

`/market/` ships as a PWA: `manifest.webmanifest`, original icons (the red slider on its
quotation track), and a service worker (`sw.js`, cache `sm68-v15` — bump per release) that
serves the whole game offline, network-first for the page itself so updates land, and handles
push (`push` shows the notification, `notificationclick` focuses or opens the table). The
splash shows an Install button when the browser offers the prompt (Android/desktop Chrome)
and an Add-to-Home-Screen hint on iPhone. The claude.ai artifact variant is body-only, so
it carries no manifest and none of the install UI — guarded by a `HAS_MANIFEST` check.

## Store packaging

`app-shell/` scaffolds real store apps around the hosted PWA: a Bubblewrap `twa-manifest.json`
for an Android Trusted Web Activity (with `app/.well-known/assetlinks.json` awaiting the signing
fingerprint) and a Capacitor project for an iOS shell (`npm run sync` bundles `app/market`).
`app-shell/README.md` walks through both builds and the store listings. Known limit: WKWebView
has no Web Push, so the iOS shell would need APNs for turn notifications — the installed PWA
and the Android TWA have them.

## Verification (v13)

Beyond the earlier suites: `test/tables.mjs` (12 relay checks, `npm run test:tables`), a
two-phone relay simulation (12 checks: host/join by code, seats, a turn crossing the wire
without a reload, chat, presence, invite link, return-to-table, relay restart healed by
re-seeding, play continuing, host reset), and a 16-check feature suite (settings persistence,
setup variants, partner play, the coach, the square sheet, the wire's `?`, autoplay, the recap
and records, certificates, patterned pawns, spoken labels, landscape layout, table talk, the
variant helpers, v7 saves resuming as v8, the desktop board with its corner figures).

## Keeping a table alive (v15)

- **Takeovers.** The host can hand any absent player's seat to the computer from *Seats &
  Takeovers* (menu); the seat keeps its name, holdings and pawn, plays with a random
  personality on whichever phone drives the computers, and its player takes it back from
  their own phone at any time ("Take my seat back" on the hint line). A host may set a
  **turn limit** in the lobby (a day, three days); once a human is overdue the host's phone
  offers to hand that turn over. The hint line shows how long the table has been waiting.
- **Seat PINs.** Every seat gets a four-digit PIN, shown to its owner in the lobby and under
  Seats. Typing it on another phone at the same table moves the seat there — a reinstall or a
  new phone no longer loses a seat.
- **Table records** live inside the shared table state (`records`), folded in once per game
  by the phone that publishes the final state, so every phone shows the same board and a
  host reset keeps them. Local games keep the per-device household records.
- **Relay keep-warm.** `.github/workflows/relay-warm.yml` pings the relay every ten minutes so
  the free tier never sleeps between evenings.

## Saved games, replay, sound (v15)

- **Save slots.** Local games save into up to eight slots (`sm68-saves`); the splash's Resume
  button counts them and a *Saved Games* sheet lists, resumes and deletes them. The earlier
  single-slot save migrates at boot.
- **Replay.** The engine keeps one compact record per turn (`st.hist`: who threw what, the
  indicator, every piece, every worth, the headline — about 80 bytes a turn). *Replay the
  Game* on the win card scrubs the finished game on the real board, playing or by slider.
- **Sound.** An exchange-floor ambience (soft ticker chatter and the odd bell, a setting,
  on by default) while the market is open; a heavier gavel; a longer dice rattle; a two-phrase
  win fanfare. Everything is still synthesized.
- **The meeting signs** now read as printed: each company's name over STOCK DIVIDENDS with an
  arrow toward the blue STOCKHOLDERS MEETING title.

Verification adds a 5-check local suite (slots, migration, replay, records merge, up-next)
and an 8-check two-phone suite (PINs, turn limit, takeover played by the host's phone,
reclaim, seat moved by PIN and back, table records on both phones, records surviving a reset).
