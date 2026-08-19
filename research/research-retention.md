# Onboarding, Retention, and Player Experience for Mobile Strategy Games — Research Report

(Filtered for a free, zero-monetization, link-shared, browser-based AoE2-style RTS.)

## 1. First-session experience (FTUE)
- ~20% of players never complete the first tutorial step (DeltaDNA). FTUE completion <70% = losing players before the real game; strong FTUE ≈ 2x higher D1 retention (GameAnalytics 2025).
- Most players who quit do so within the first 10 minutes — causes: cognitive overload, unclear objectives, poor game feel — NOT difficulty.
- Tutorial funnel shape: drop-off front-loaded — past step 2, >90% finish. Successful tutorials complete in under 4 minutes, densest instruction in minute one.
- Zynga GDC (Skaggs): cutting 2 tutorial steps improved completion +25% but sentiment dropped — optimize length against comprehension, not just completion.
- Time-to-value: 2-3 minutes; tutorials 1-3 min, integrated into gameplay. Pre-tutorial drop-off (loads, account walls) — for a PWA: no accounts, no waiting.
- **George Fan GDC 2012 (PvZ) — canonical strategy tutorial talk, 10 tips**: blend tutorial into game; doing over reading; spread mechanics out (PvZ withholds money until level 10); one successful action can teach; **max 8 words per message**; unobtrusive (don't pause); **adaptive messaging — tips only for players who struggle** (veterans never see them = the answer to skip-for-veterans); cut noise; teach with visuals; leverage conventions.
- Interactive > passive text; "tutorial sandboxes" effective for strategy. Hybrid best: brief contextual intro + deeper optional lessons. **Skip options mandatory.** Failure mode: "hide notifications" settings that reset per match.
- **AoE2:DE template pair**: narrative campaign-as-tutorial (William Wallace) + "Art of War" challenge missions — short single-skill drills (economy, rushing, counters) with bronze/silver/gold medals — teaching advanced play without accounts or unlocks.
- Anti-patterns: forced unskippable tutorials; "tap here" rails teaching compliance not mechanics; front-loading all systems; text walls; pausing for every tip.

## 2. Teaching depth over time; unlock pacing vs everything upfront
- FOR unlocks: progression gating "creates anticipation"; dumping everything risks overwhelm. Nuance: evidence is about TEACHING pacing, not content ownership.
- FOR everything-upfront: gating competitive basics behind unlocks widely criticized (new players already skill-disadvantaged); time-gates named retention-padding/dark-pattern-adjacent. Exemplars with zero unlocks retaining for decades: chess, AoE2 (every civ day one), Wordle. AoE2 longevity = "easy basics, endless civ-specific depth" — depth-as-discovery replaces depth-as-unlock.
- **Synthesis: keep content ungated, gate ATTENTION** — sequence what the UI/tutorial/hints surface. Polytopia model: full tech tree visible on one screen, complexity managed by scannability. Optional mastery ladders (medals, stars) give goal-gradient benefits without withholding.
- Coach/hint systems: Civ VII's four advisors give playstyle-flavored advice, not mandates. Contextual trigger-based tips (first time housed / first attacked) beat upfront explanations; combine with adaptive messaging. Research: unsolicited hints suffer "help avoidance" — glanceable/dismissible design improves uptake.

## 3. Session structure and ethical return hooks
- **Daily challenge (Wordle model) — strongest ethical hook found**: one puzzle/day, identical for everyone, no archive to binge. Deliberately caps engagement; scarcity creates anticipation + shared collective experience. Precedents: Slay the Spire Daily Climb (same seed + modifiers for all, own leaderboard, one scored attempt), Spelunky Daily. RTS translation: daily skirmish seed — same map/civ/AI, compare result/time with friends. Capped daily content is itself the ethical safeguard.
- Streaks ethically: streak freezes, earn-back through effort (never payment), grace periods. CHI 2022 "A Game of Dark Patterns" proposes "Radiant Patterns" — replacements for playing-by-appointment, daily login rewards, artificial scarcity, sunk-cost.
- **Leaderboards: small, relative, friend-scoped >> global**: global boards harm lower performers ("accumulated perceived failure"; 31.3% reported negative psychological effects); friend-scoping "converts a discouraging metric into a motivating one".
- "One more match": Sid Meier's "one more turn" — something new starts BEFORE the player's intended stopping point (open loop at every natural exit). Rich post-game stat screens/timelines (AoE2's graphs beloved), instant rematch buttons, "share this result". End sessions with a CHOSEN commitment (visible next mission, unfinished medal), not a timer.
- Unlock-free progression that works: campaign stars/medals (AoE2 Art of War), completion %, personal-best times. All local, no account.

## 4. Social/viral loops for friend-distributed games
- **Wordle**: 90 players (Nov 2021) → 300,000 (Jan 2022) → 2M+ a week later. Single growth driver: **spoiler-free emoji share grid** — one tap, tells a story, doesn't spoil, implicitly invites ("can you do better?").
- **Jackbox**: room code + join in any phone browser "in under a minute"; no app, no account. Jack Principles: pacing (always know your next action), illusion of awareness, minimize friction; audience mode = nobody excluded.
- **.io games**: instant play, no download/tutorial/account, one control — join within seconds of clicking a link. Dramatic deaths/wins = shareable moments.
- **Polytopia**: spread via pass-and-play + async MP with 24h turn timers; strict 30-turn limit guarantees games FINISH — key to friend play.
- **Principles for link-shared onboarding**: (1) the link IS the install — playable in seconds; (2) share artifacts > share buttons: replay links, seed codes, result grids, challenge URLs; (3) room codes/short join links for sync; async challenge links for the rest; (4) name entry only, identity local; (5) guarantee matches end; (6) async prods (friend beat your daily score) = highest-retention social mechanic, deliverable ethically in-game rather than push.

## 5. Difficulty and mixed-skill friends
- **AoE2:DE handicap system**: buffs a weaker player up to ~2x across eco and military stats — "even the odds between friends". SC2 etc. ship % handicap sliders.
- **Co-op vs AI as the social default**: SC2 Co-op Missions became THE most-played mode in the entire game (Blizzard 2019) — low pressure, no ladder anxiety. Strong evidence team-vs-AI is the correct default for mixed-skill friend groups; PvP between unequal friends is miserable for the weaker.
- Asymmetric starts scale challenge without one friend beating the other. Handicaps should be visible and consensual (lobby settings), not hidden rubber-banding.

## 6. Single-player longevity without accounts
- AoE2's 25-year drivers: historical campaigns doubling as teaching; many civs sharing one base formula with layered variations (low floor, high ceiling); map variety; player-paced difficulty; map editor in the box; community content.
- Skirmish variety levers: map scripts/seeds, civ diversity, modes (regicide, wonder race), AI personalities, difficulty tiers.
- Self-set challenges + medals: graded challenges (gold/silver/bronze by time or losses) = replayable mastery goals, zero gating.
- **Achievements without accounts**: Wordle proved localStorage suffices. Known failure: data loss on browser-clear, no cross-device sync (Wordle's biggest pre-NYT complaint). Mitigations: export/import code strings, sync via share-link mechanism.
- Daily seeded skirmish doubles as single-player longevity: infinite content from a seed, socialized by comparison.

## 7. Mobile-specific engagement realities
- **Median mobile game session 5-6 min** (2025); top-quartile 8-9; mid-core 5-6. Frequency compensates: 4-7 sessions/day.
- **Implication: a 25-40 min AoE2 match is 5x the median session.** Options: shorter formats (turn/time caps), robust pause/resume (state must survive backgrounding and tab-kill), async modes.
- Retention benchmarks: D1 ~27% avg, D7 median 3.4-3.9% (top quartile 7-8%), 75% of games <3% D28. Habitual daily-ritual genres have the best long-term curves.
- **PWA install**: 20-30% of users drop during app-store install — friction a link-shared PWA bypasses. A2HS converts best when prompted to RETURNING visitors, not first-timers. Twitter Lite: +65% pages/session; Pinterest PWA: +60% engagement. **iOS: no auto install banner — manual Share → A2HS; custom prompts convert poorly; iOS PWA push opt-in 10-15x lower than native.** Never depend on push or install; treat A2HS as an earned later-session suggestion with illustrated iOS instructions.
- Notification ethics: gaming has lowest push opt-in of any industry (~63.5%); never prompt on load; soft pre-prompt; every notification useful + time-sensitive; for this game the only defensible pushes are user-initiated ("friend played their turn") — arguably none.

## 8. Playtesting and feedback for indie games
- **Think-aloud with first-time players = highest value**: watch silently, never help unless fully stuck, note hesitations.
- ~10 players finds most FTUE problems; unmoderated captures more authentic behavior.
- Define success criteria per test ("new player wins vs easiest AI within 3 matches?"); needing verbal explanation IS the finding.
- Privacy-respecting telemetry: no-PII analytics exist (Game Trace, WASD Metrics, TelemetryDeck); no usernames/emails/IPs/device IDs; collect only what you'll act on. Google Analytics in games = GDPR violation without consent.
- Minimum viable funnel: anonymous event counts at tutorial steps + match starts/completions + opt-in feedback button. Pair funnel data with watching real players.

## Cross-cutting principles
1. Front-load fun: playable inside 2-3 min; the link click lands in-game.
2. Tutorial = training wheels, ≤4 min, ≤8 words/message, adaptive hints instead of skip-or-suffer.
3. Everything unlocked; optional mastery ladders + depth-as-discovery replace unlock dopamine.
4. Daily seeded challenge = strongest ethical retention + viral mechanic evidenced.
5. The share artifact does the marketing: spoiler-free, story-telling, one-tap, implicit challenge.
6. Co-op vs AI = social default for mixed skill; visible consensual handicaps for PvP.
7. Design for the 5-min median session: pause/resume surviving anything; match formats that fit phones; async where possible.
8. Never demand push/accounts/installs; earn A2HS on return visits; localStorage + export/backup path.
9. ~10 think-aloud first-timers + anonymous funnel telemetry finds nearly everything.

Anti-patterns: account walls, forced tutorials, upfront system dumps, unlock-gated competitive content, appointment timers, login rewards, shame streaks, global-stranger leaderboards, permission prompts on load, notification spam, PII telemetry.
