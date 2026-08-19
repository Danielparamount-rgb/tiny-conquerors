# Mobile RTS Design Research Report

## 1. Why traditional RTS has historically struggled on mobile

**Input/precision friction**
- Touchscreens break the three core RTS input primitives: precise single-unit selection, box/drag multi-select, rapid context switching between map regions. Fingers occlude the battlefield, mis-taps frequent, no hover state. (Josh Bycer, "Has Mobile Ruined Strategy Games?" — https://medium.com/super-jump/has-mobile-ruined-strategy-games-ab6255476869)
- APM ceiling: competitive desktop RTS players run 200–350 APM (600 burst). Touch physically caps effective APM far lower. Games that removed APM as a skill axis (Clash Royale) thrived. (https://medium.com/@mihkeltrei/an-rts-where-apm-doesnt-matter-b18d9d1e264)
- Mobile Free To Play "Less (Control) Is More" (https://mobilefreetoplay.com/touch-control-design-less-is-more/): (a) most common failure is too many concurrent mechanics; (b) no tactile feedback means players lose track of on-screen controls; (c) never port mouse/kb UIs directly; (d) what works: tap-to-place, mode-switching (hold-to-reveal menus that slow/blur gameplay for cognitive space), intermittent secondary mechanics. Strategy suits "layered" control schemes across separate menu contexts.

**Screen size**
- UI density is the recurring port-killer: Northgard mobile's top complaint "UI feels cluttered on a small screen, gets in the way of touch-based map controls". Kingdom Two Crowns: UI "doesn't give the player enough unit information" (https://noisypixel.net/kingdom-two-crowns-ios-review/). Rome: Total War iPad: touch works but "gets busy with all the pinching, zooming, rotating" (https://toucharcade.com/2019/05/27/rome-total-war-collection-review/). Tablets consistently review better than phones.

**Session length / attention model**
- Average mobile session 5–8 min; median 5–6; top-quartile ~8–9; 4–6 sessions/day. (https://www.blog.udonis.co/mobile-marketing/mobile-games/session-length)
- Desktop RTS matches (AoE2 ~40–60 min, SC2 ~15–25 min) don't fit. Mobile RTS successes converged on 2–10 minute engagements (Rumble ~2 min, Clash Royale 3–4, Art of War 3 ~5, Bad North 5–6/island, Mushroom Wars 2 <10).
- Mobile play is interruptible by design — the deepest mismatch, more than input. Hence async (CoC) or ultra-short sync (CR) dominating.

**Design-drift critique**
- Bycer: mobile strategy "failed" via abstraction — base management, resources, unit control simplified away, replaced by RPG progression (unit levels, gacha) where account stats beat in-match decisions. The genre didn't die on mobile from touch, it dissolved into metagame-progression games.

**Console-RTS precedent**
- Halo Wars (Ensemble): prototyped Age of Mythology on a controller, found economy/villager management untenable, rebuilt from scratch. Concessions: locked building slots; no control groups/hold-position; auto-attack in range; one ability per unit; global "select all units" button. (https://www.gamedeveloper.com/game-platforms/e3-i-halo-wars-i-rouse; https://waywardstrategy.com/2020/03/23/halo-wars-the-ultimate-design-for-console-rts/)

## 2. Case studies

**Clash of Clans (2012)** — deploy-and-watch combat, fully async multiplayer (defender offline, defense = base layout). Zero simultaneous-online requirement, 1–3 min sessions. Proves base-building/economy loop is hugely popular on mobile — it's the real-time synchronous battle that was cut.

**Clash Royale (2016)** — most successful real-time synchronous strategy on mobile. Whole battlefield on one static screen (no camera control); 8-card deck replaces build orders; elixir replaces economy; fire-and-forget units (positioning = the control verb); 3-min matches; 2 lanes give constant unambiguous spatial goals. Unit readability: movement/size/swarm behavior visually encodes function (no tooltips possible). Known dark pattern: reportedly seeds bots into ladder. (https://toucharcade.com/2016/03/02/clash-royale-review/; https://mobilefreetoplay.com/deconstructing-clash-royale/; https://www.gameeconomistconsulting.com/pvp-bots-are-unethical/)

**Warcraft Rumble (Nov 2023 → maintenance mode Jul 2025)** — CR-like tower offense, ~2-min battles, PvE-first. Soft-launch RPD $3.17. DoF pre-launch predicted the failure: "disastrous" first 2 hours (5+ new mechanics per battle in battles 2–5), extreme grind after ~10h, complexity limiting casual audience. 9 years in dev; Jul 2 2025 Blizzard ended content dev. Takeaways: even AAA IP + competent mechanics fails if onboarding overloaded and meta grindy; complexity beyond CR baseline measurably shrank funnel. (https://www.deconstructoroffun.com/blog/2023/10/29/deconstructing-warcraft-rumble)

**Company of Heroes mobile (Feral, 2020)** — full premium port. Tap-select, drag-move, "Command Wheel" radial on press-hold; command panel alternative; reworked tactical map. Pacing deliberately slowed slightly. 4.6/5 on ~21k Play Store ratings. Feral refused controller support — UI designed exclusively for touch. Squad granularity inherently touch-compatible. Takeaway: premium full-RTS ports can review excellently; squad + radial + slight pace cut is a proven kit; design for one input modality.

**Northgard mobile (Playdigious, 2021)** — near-content-parity, rebuilt UI, touch-only, later cross-play MP. PC design already mobile-friendly: zone-based map (claim tiles, not free placement), small unit counts, capped economy, low APM. Complaints: cluttered UI on phones, crashes. Takeaway: zone/tile territory model is the most credible full-RTS-on-mobile template.

**Bad North (2018/2019)** — minimal real-time tactics roguelite: 5–6 min procedural islands, permadeath commanders. No in-battle economy; command verb = "send squad to tile". Time slows while commanding. Roguelite chunking = perfect mobile session structure + replayability from small content budget.

**Rusted Warfare (solo dev)** — existence proof that classic unconcessioned RTS (TA-like, hundreds of units, base-building) has a real mobile audience. Premium, no IAP/P2W; cross-platform mobile↔PC MP; huge modding. Ugly but functional UI; audience tolerates jank, doesn't forgive monetization.

**Mindustry** — automation TD/RTS hybrid; build-queue-driven play (place blueprints, game executes); no twitch micro. Players accept heavy automation when automation IS the strategy layer.

**Art of War 3** — closest to classic C&C-style sync PvP RTS at scale: direct control, base building, ~5-min PvP duels. Praised as "the only real RTS on mobile"; poisoned by suspected AI bots in "PvP" + P2W unit levels. Takeaways: 5-min direct-control RTS PvP works on a phone; unit-level progression + fake PvP poisons trust, not controls.

**Iron Marines (2017)** — "StarCraft for mobile": squad-based small armies (handful + hero), fixed build nodes, tap-structure-to-build, hold-and-swipe move, mission campaign with star ratings. Fixed build slots repeatedly validated as mobile answer to base-building precision.

**Rome: Total War ports (Feral)** — premium full ports, "almost perfect touch controls"; turn-based campaign layer + pausable real-time battles vs AI; $10–17 accepted.

**Age of Empires Mobile (TiMi, Oct 2024)** — cautionary tale: not an RTS — Rise-of-Kingdoms-style 4X gacha, idle/timer building, auto-resolve battles. "The worst kind of mobile spinoff" (Digital Trends). Prior AoE mobile attempts (Castle Siege, World Domination) also shut down. Three consecutive AoE mobile products failed by NOT being RTS. Unserved demand IS the actual game.

**Mushroom Wars 2** — node-capture RTS (bases auto-generate troops, swipe % between nodes). <10 min matches. Accessible/deep MP, monotonous solo — low verb variety exhausts solo content.

**Rymdkapsel (2013)** — minimalist RTS distillation: tetromino base-building, worker-assignment sliders. Depth from simplicity; worker-assignment-as-slider preserved economy tradeoffs at near-zero input cost.

**Thronefall (mobile May 2025)** — best-in-class minimalist base-builder: fixed upgrade slots, day (build) / night (defend) cycle. 92 Metacritic. Phase-separated pacing extremely mobile-friendly.

**Hades' Star** — extreme async: persistent slow-RTS MMO "for players with pockets of free time"; White Stars = 5-day battles at x600 dilation with command scheduling. Session problem also solvable by slowing the clock.

**Browser RTS** — Littlewargame: free HTML5 MP RTS, guest accounts, playable in seconds; small persistent community. No browser RTS has broken out commercially; web strategy successes are .io territory games. "Zero-install, playing in <30s" is the web's killer advantage.

## 3. Match length and session design
- Successful targets: 2 min (Rumble), 3–4 (CR), ~5 (AoW3), 5–6 (Bad North), <10 (MW2), 10–20 slowed (CoH, Northgard vs AI). Beyond ~15 min sync PvP effectively absent from mobile successes.
- Design for 5–8 min median session, 4–6 sessions/day; match must fit one session incl. matchmaking + post-match.
- Pause/resume: single-player real-time expected to pause instantly and losslessly on backgrounding; save-anywhere. A skirmish losing progress to a phone call gets review-bombed.
- MP pause norms: WC3/SC2 limited pauses; CR never pauses (towers act autonomously, 3-min cap bounds damage).

## 4. Pacing and automation — what players accept
- Accepted: auto-queue villagers, idle-worker button, global queue, rally points, auto-gather on drop-off, villager-priority economy sliders (AoE2:DE console shipped exactly this; slightly suboptimal vs manual so pros still micro; negligible competitive damage). (https://ageofempires.fandom.com/wiki/Villager_Priority)
- Contested: auto-queue military in ranked (AoM: Retold disables it in ranked). Compromise: automate economy chores, keep military production/spending active decisions.
- Rejected: auto-battle/auto-resolve of combat itself; account level deciding outcomes. Rule: players accept automation of EXECUTION, reject automation of DECISION.
- Control-group alternatives that shipped: select-all-army button, tap type-icons/portraits to select classes, radial wheel on press-hold, drag-from-card deployment, swipe-percent-of-garrison, squad granularity. Fixed building slots (Halo Wars → Iron Marines → Thronefall); free placement with grid-snap + big footprints is the AoE2-flavored middle ground.
- CoH mobile globally slowed pacing slightly — reviewers didn't notice or approved. Slower speeds/longer TTK/fewer simultaneous fronts are invisible concessions; removing direct control is a visible one.

## 5. Single-player structure, AI, difficulty
- Validated structures: mission campaign with 3-star ratings (Iron Marines — high production cost); roguelite procedural campaign (Bad North — replayability from small budget); skirmish vs AI with map variety (cheapest depth per authoring hour, what AoE2 players actually do); wave-survival/phase games (Thronefall, Mindustry).
- MW2's 100+ levels judged monotonous — verb variety > level count. Rumble gating single-player behind meta progression bred resentment.
- Rumble onboarding autopsy: 5+ mechanics per battle in first session "disastrous"; graduated onboarding (one concept per match, early wins) is the benchmark.
- Mobile difficulty skews forgiving; skirmish AI with named difficulty levels the norm.

## 6. Multiplayer design for mobile RTS
- Lockstep pitfalls documented: stall on slowest peer, reconnect via re-sim or snapshot, P2P disconnect handling very complicated; server-relayed lockstep with authoritative order log + periodic checksums is the practical pattern. (https://medium.com/@treeform/dont-use-lockstep-in-rts-games-b40f3dd6fddb)
- Mobile networks make disconnects first-class: heartbeat + timeout; short grace-period pause with visible "player reconnecting…"; auto-reconnect; AI takeover or unit self-defense during absence; bounded pause then forfeit.
- iOS/browser: Safari suspends JS in background tabs immediately, can kill WebSockets after ~30s inactivity; Page Visibility events can fire after socket is dead. Client must assume background = disconnected, reconnect optimistically on foreground; server holds session state 30–120s.
- CR: matches short enough no pause exists; disconnected player's towers keep fighting; reconnect drops back in live. 2v2 leaver exploits required patching — abandonment penalties matter even at 3 min.
- Matchmaking: trophy MMR; bot backfill for <10s queues is effective for retention but a trust liability (70%+ of US gamers say bots ruin MP). If bots, disclose or make opt-in practice.
- Cross-platform mobile↔PC consistently praised — solves small-population matchmaking, otherwise fatal for niche RTS.

## 7. State of the genre 2024–2026
- Desktop RTS modest revival (Tempest Rising, AoM Retold, Stormgate) but Stormgate lukewarm — competitive-1v1-first has a ceiling; energy in coop/PvE and accessible hybrids.
- Mobile: the two big-budget swings failed (Rumble maintenance mode; AoE Mobile rejected). Survivors: premium ports (Feral Total War, CoH), indie authenticity (Rusted Warfare, Mindustry evergreen), minimalist newcomers (Thronefall).
- Web/PWA unusually favorable: browser games ~$11.8B 2025 → $16.3B by 2034; Poki 10M→100M+ MAU (2020→2026); instant no-install access top driver. (https://poki.com/blog/state-of-web-gaming-report-2026)
- Net: demonstrated unserved demand for "a real AoE-like on the phone" — every abstraction-based AoE mobile product failed; every faithful-but-adapted port over-performed. Browser is the fastest-growing channel for exactly this niche.

## Extracted design principles
1. Automate execution, never decision.
2. Squadify: command groups, not individuals; portraits/type-icons replace box-select.
3. Fixed or snapped build slots beat free placement on touch.
4. One mechanic demanding attention at a time; hold-to-open radials + time-slow for cognitive space.
5. Match budget: 5–10 min PvP ceiling; single-player chunks ~5 min chain well.
6. Slow the sim ~10–25% vs desktop; players notice control cuts, not pace cuts.
7. Readability over density: silhouettes/motion must encode role; no hover = no tooltips at decision time.
8. Interruption is a feature spec: instant lossless pause solo; grace-period reconnect (30–120s) MP; units self-defend; background = dead socket.
9. Abandonment/AFK rules needed even for short matches.
10. Small-population survival kit: cross-play with desktop, honest bots (labeled), async/co-op pressure valves.
11. Trust is the moat: no P2W, no fake PvP — monetization integrity decides this audience's loyalty.
12. Roguelite/procedural campaign = mobile-sized sessions at indie budgets; graduated onboarding non-negotiable.
13. Territory/zone-control maps reduce camera/micro burden — proven shape for full RTS with economy on phones.
14. Web's superpower is instant access — guest-playable, sub-30-second-to-first-match.
