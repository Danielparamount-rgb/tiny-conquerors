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

The public record (collector inventories, museum listings) establishes the skeleton:
8 stocks (Woolworth, International Shoe, General Mills, Alcoa, Maytag, American Motors,
Western Publishing, J.I. Case), two dice, 2–8 players, a sliding stock indicator in the
board center, dividends and stockholders meetings, first to $100,000. Share certificates
came in 1/5/10/20/50/100/500/1000-share denominations — trading here uses those same lots,
and the Ledger shows holdings broken into them.

Full-board photographs from the owner then settled nearly everything else. The v5 build
implements the board as photographed; the few remaining gaps (exact cell order per side,
meeting-row values, notch count) are reconstructed in the printed structure and live in
the `CFG`/`BOARD` blocks at the top of the engine script for easy truing-up:

| Feature | Value | Source |
| --- | --- | --- |
| Price table | ALC 30–230 / AMO 10–110 / JIC 15–75 / GMI 18–42 rising with the indicator; ISH, MAY, WPC, WLW mirror them falling | board photo |
| Indicator | vertical white track marked UP / START / DOWN; START row reads 130-60-45-30 / 30-45-60-130 | board photo |
| Notches | 51 positions (values printed every step) | board photo (count approximated) |
| Company cells | printed dividend $1–$4 by company + printed indicator move + buying window; some cells "PURCHASE LIMIT ONE SHARE" | board photo |
| Job corners | Deep Sea Diver 3/11→$300 · Doctor 4/10→$200 · Policeman 5/9→$100 · Prospector 2/12→$400; your throw pays your job | board photo |
| START cells | 4 mid-edge, "PAY $100 FEE", ODD/EVEN direction choice on landing | board photo |
| SELL ALL cells | forced sale at the printed floor (e.g. Maytag $15, Alcoa $30) | board photo |
| PAY cells | $10 per share held, then indicator swings ±20 | board photo |
| Stockholders meetings | black ENTER wedges lead to inner rows of 1/2/3 FOR 1 cells split between a mirror pair | board photo (row values reconstructed) |
| Track | 56 cells — 13 a side + 4 job corners | board photo (cell order per side reconstructed) |
| Starting cash | $5,000 | reconstructed |
| Win target | $100,000 classic (default option $50,000) | documented / pacing choice |

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

`app/market/index.html` is a verbatim copy for the static-site deploy; regenerate it by
copying `stock-market.html` after any change.
