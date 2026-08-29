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

## Documented vs. reconstructed

| Feature | Value | Source |
| --- | --- | --- |
| Rules of play | all of the above | inside-cover transcription |
| Price table | ALC 30–230 / AMO 10–110 / JIC 15–75 / GMI 18–42 rising with the indicator; ISH, MAY, WPC, WLW mirror them falling | board photo |
| Indicator | vertical track marked UP / START / DOWN; START row reads 130-60-45-30 / 30-45-60-130; 51 notches | board photo (notch count approximated) |
| Company cells | printed dividend $1–$4 + printed indicator move + buying window; some "PURCHASE LIMIT ONE SHARE" | board photo |
| Job corners | four occupations with printed numbers and salaries | board photo + transcription |
| START cells | 4 mid-edge, "PAY $100 FEE", ODD/EVEN arrows | board photo + transcription |
| SELL ALL cells | forced sale at the printed floor (e.g. Maytag $15, Alcoa $30) | board photo |
| PAY cells | $10 per share held, then indicator swings ±20 | board photo |
| Meeting rows | one per side between a mirror pair's entrances; 1/2/3 FOR 1 cells | photo + transcription (row values reconstructed) |
| Track | 56 squares — 13 a side + 4 job corners | board photo (cell order per side reconstructed) |
| Square arrows | per-square direction arrows | reconstructed (photos unreadable at that size) |
| Win target | $100,000 printed; $50,000 / $25,000 offered | transcription (other amounts by agreement) |

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

The published claude.ai artifact of this page supports true online multiplayer over the
artifact runtime's self-publish capability: the page embeds the table state in a
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
