# Stock Market 1968 — design & provenance notes

`stock-market.html` is an original, self-contained web revival of the 1968 roll-and-move
stock-market board game published by Whitman (Western Publishing Co.) — "the classic money
game" with eight real-company stocks and a red sliding price indicator in the middle of the
board. Playable 2–8 (any mix of humans pass-and-play and computer investors), phone-first,
no build step, no external assets beyond an optional Google Fonts load that degrades to
system faces offline.

All artwork, text, and sound here are original: the board is drawn in SVG, the rules text is
written from scratch, and every sound is synthesized with WebAudio. Company names appear as
historical references to the 1968 game's stock roster. Not affiliated with the original
publishers.

## What is documented vs. reconstructed

The surviving public record of the game (collector inventories, museum listings, database
descriptions) establishes the skeleton implemented here:

- 8 stocks: F.W. Woolworth, International Shoe, General Mills, Alcoa, Maytag,
  American Motors, Western Publishing, J.I. Case
- Share certificates in 1/5/10/20/50/100/500/1000-share denominations — trading in the
  digital version is done in those same lots, and the Ledger shows holdings broken into them
- Players choose a job at setup (the documented earn-a-salary element; all salaries equal
  here as the fair default)
- Two dice, pawns moving around a perimeter track; the center of the board is a
  "quotation board" of 8 price columns with sliding indicators
- Turns bring dividends, stockholders' meetings, and windows to buy and sell shares
- 2–8 players; the first investor to reach **$100,000** wins
- Share certificates in 1/5/10/20/50/100/500/1000-share denominations (digital version
  just tracks share counts)

The market mechanism follows the owner's firsthand description of the physical game:

- **One ticker, a see-saw market.** A single sliding indicator sits in the middle of the
  board. Each company's price ladder is printed in its own direction, so when the ticker
  moves, half the stocks rise and half fall — each by its own printed step per notch.
- **The board plays the ticker.** MARKET UP/DOWN spaces slide the indicator 1–3 notches;
  the BULL MARKET corner jumps it 2. Company spaces are buying windows at posted prices.
- With prices bounded by the printed ladders, there are no splits or bankruptcies — the
  game is swing-trading: buy an issue deep in its ladder, sell it high on the other side.

The complete box-back rules text (the space-by-space board and its dollar amounts) is not
reachable from an archive we could access, so those numbers are **reconstructed** to be
period-consistent and are all collected in the `CFG` block at the top of the engine script,
with `[R]` marks. If you have a physical copy, true them up there:

| Constant | Value | Status |
| --- | --- | --- |
| Starting cash | $5,000 | reconstructed (period standard) |
| Salary per lap (Pay Day) | $1,000 | reconstructed |
| Par value | $100 at ticker mid-scale | documented convention |
| Ticker scale | 21 notches (0–20), starts at 10 | mechanic recalled; scale reconstructed |
| Ladder slopes ($/notch) | ALC +9, GMI +7, WLW +5, WPC +3; AMO −9, ISH −7, MAY −5, JIC −3 | mechanic recalled; values reconstructed |
| Market spaces | ticker ±1/±2/±3 notches; BULL corner +2 | mechanic recalled; amounts reconstructed |
| Dividend space | $5/share on holdings ≥ par | reconstructed |
| Stockholders' meeting | $10/share, one company of your choice | reconstructed |
| Annual meeting corner | $5/share all players, lander ×2 | reconstructed |
| Broker's fee | $200 | reconstructed |
| Win target | $100,000 (options: $50k, $25k) | documented |

Known transcriptions of the original rules, for future truing-up (all were blocked from the
build sandbox): BoardGameGeek threads 275139 and 568490, and
`houseofgames.ca/Rules/Stock Market Game Rules.html`.

## Architecture

One HTML file, two scripts:

- **Engine** — `CFG`, `STOCKS`, `BOARD` (40 spaces), a DOM-free `Game` class with a seeded
  RNG (`mulberry32`; `rngN` counts draws so saves replay identically), the computer-player
  heuristics (`AI`, three personas), and `window.__sim(nGames, nPlayers, target, seed)`
  which runs full AI-only games headlessly for balance testing.
- **UI** — SVG board renderer, quotation-board sliders, turn animation, bottom sheets
  (buying window / Exchange / meeting / Ledger), ticker-tape header, WebAudio sounds,
  localStorage autosave (`sm68` key) with resume, win screen with net-worth chart.

Balance (30-game AI sims, 3 players): median ~265 table turns to $100k (the box listed the
original at 180 minutes — it was a long game), ~185 to $50k, ~130 to $25k.

## Online play

The published claude.ai artifact of this page supports true online multiplayer over the
artifact runtime's self-publish capability: the page embeds the table state in a
`#netState` JSON block, and after each human turn the acting phone publishes a new version
of the page — every open view reloads to it. A lobby lets each device claim a seat (name,
pawn color, job) identified by a per-device token in localStorage; computer turns are
played by the next human's device and batched into that one publish; players need edit
access to the shared page (read-only viewers get a watch-only seat). On any host without
the artifact runtime (the static-site deploy, a local file), the online card hides itself
and the game is pass-and-play + computer opponents as before.

`app/market/index.html` is a verbatim copy for the static-site deploy; regenerate it by
copying `stock-market.html` after any change.
