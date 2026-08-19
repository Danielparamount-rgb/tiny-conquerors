# Mobile RTS/Strategy UI & HUD Research Report

Dense findings organized by the 10 requested topics. Sources given as URLs inline. All measurements are as stated by sources; pt = iOS points, dp/sp = Android density-independent units, px = CSS pixels unless noted.

---

## 1. HUD Layout Patterns for Mobile RTS/Strategy

**Canonical element set:** minimap, resource counters, command list/card, upgrade menu, unit/building status meters. Constant-monitoring info (health, resources, minimap) belongs at screen **edges** to minimize eye travel; the center stays clear for gameplay. (https://polydin.com/game-hud-design/, https://rocketbrush.com/blog/designing-practical-and-pretty-hud-in-video-games)

**Placement conventions found in the field:**
- Mobile RTS common arrangement: army/health status **upper-left**, resources **upper-right**, abilities/commands along the **bottom** (https://gamedesignskills.com/game-design/real-time-strategy/).
- Rise of Kingdoms: raw resources top-right corner in city view; resource icons on colored background with gold border for instant recognition (https://riseofkingdoms.fandom.com/wiki/Resources).
- Desktop RTS baseline (AoE2/AoE3 DE): resources top-left, minimap bottom-right, command card + selection panel in a bottom bar. AoE3:DE's HUD rework is documented at https://www.ageofempires.com/news/aoe3de-hud-and-ui/; Game UI Database catalogs AoE2:DE (https://www.gameuidatabase.com/gameData.php?id=722) and Clash of Clans / Clash Royale screens for comparison.
- Genre survey (minimap research, applies to whole HUD): MOBAs anchor everything to the bottom; strategy games favor bottom-left; western players attend more to the **left** side of screen, which measurably affects reaction times (https://alejandro61299.github.io/Minimaps_Personal_Research/).

**Screen budget:** the cited rule of thumb is players give ~**80% of visual attention to the gameplay area, ~20% to HUD** — treat 20% as the HUD's attention (and roughly area) budget on phones (https://respawn.outlookindia.com/gaming/gaming-guides/ui-and-ux-in-games-building-menus-huds-and-feedback-systems). No hard pixel-percentage standard exists; guidance is "prioritize and consolidate" rather than a fixed cap (https://sunstrikestudios.com/en/blog/HUD_design_in_games/).

**Consolidation principle (strategy-specific):** put commands + contextual info in **1–2 unified areas maximum**; the classic anti-pattern is building commands at bottom, resources at top, unit orders at right — fragmenting attention. Reserve the bottom strip for a contextual pane (selected unit/building stats + actions). Rise of Nations praised for unified display; Planetary Annihilation criticized for scattered minimalism (https://www.gamedeveloper.com/design/ui-strategy-game-design-dos-and-don-ts).

**Thumb zones (landscape two-handed grip):** bottom-center/bottom corners = "green" easy reach; mid-screen sides reachable with stretch; top corners = red zone requiring grip change. In landscape, key interactions should migrate to the **sides** near where thumbs rest; frequently used functions placed reachable by both thumbs (https://parachutedesign.ca/blog/thumb-zone-ux/, https://www.themeignite.com/blogs/news/thumb-friendly-mobile-interfaces). Clash Royale puts all interactive functions in the **lower 50%** of screen (portrait) — a deliberate one-hand design (https://www.gornicki.me/blog/90l/ux-in-clash-royale-part-1).

**Safe areas (critical for landscape phone web):**
- Landscape on notched iPhones: side insets **44–50pt** (notch) or **59–62pt** (Dynamic Island); bottom home-indicator inset ~**21–34pt**. Don't put interactive elements flush to any edge; ≥20px buffer at top recommended; headers ~48px below top edge with 16px margin (https://blog.felgo.com/cross-platform-app-development/notch-developer-guide-ios-android, https://medium.com/design-bootcamp/mind-the-notch-creating-seamless-ui-across-games-ad5e57616ed5, https://designsystemproblems.com/cross-platform-consistency/safe-area-handling/).
- For browser games use `viewport-fit=cover` + `env(safe-area-inset-*)` CSS; a PWA-specific guide: https://gist.github.com/fozzedout/5e77925381991a9570151550992baf14.

**Collapsible panels:** standard mitigation for RTS density on phones — group complex regions behind expand/collapse triggers to keep the field clear; Northgard mobile was still criticized for residual clutter on small screens despite its UI rework, showing the ceiling of shrinking desktop panels (https://toucharcade.com/2021/04/13/northgard-mobile-out-now-ios-price-free-dlc-roadmap-playdigious-shiro-games/). Northgard's 3-part dev-diary on the mobile adaptation: https://playdigious.com/watch-our-dev-diary-series-on-northgards-mobile-adaptation/.

**Reference archive:** Game UI Database (1,300+ games, 55,000+ screenshots, filterable by "Mobile Controls", "Pre-Game & Lobby", "Results Screen") — https://gameuidatabase.com/ ; also https://interfaceingame.com/games/northgard/ and https://interfaceingame.com/games/clash-of-clans/.

---

## 2. Build/Production Menus on Small Screens

**Grid vs radial:**
- Radial menus: fast, muscle-memory friendly, minimize interruption (open→select→resume in one gesture), natural "under the finger" on touch. Weaknesses on touch: hand/finger occludes segments; handedness issues; capacity limited to ~6–8 items (https://300mind.studio/blog/radial-menus-in-game-design/, http://www.swordandsharpie.com/learn-from-games-the-radial-menu/).
- Grids/categorized menus win when players browse many items, compare stats, or manage queues (https://300mind.studio/blog/radial-menus-in-game-design/).
- **Company of Heroes iPad (Feral Interactive)** shipped BOTH: a "Command Wheel" radial that appears on tap-and-hold, and a traditional "Command Panel" docked bottom-right — letting players choose is itself a pattern (https://toucharcade.com/2020/02/24/company-of-heroes-ipad-review/).

**Bottom sheets:** the dominant modern mobile container for build menus — a panel sliding up from the bottom, easy thumb reach, progressive disclosure without leaving the map. Persistent (co-exists with map, both interactive) vs modal (blocks map) variants; don't use them as long-dwell destinations (https://www.nngroup.com/articles/bottom-sheet/, https://m2.material.io/components/sheets-bottom, https://mobbin.com/glossary/bottom-sheet). Clash of Clans' shop/build UI is effectively a tabbed grid sheet: categories (Buildings/Army/Resources/etc.), cost shown on each tile, color-coded by unlock requirement (https://www.gameuidatabase.com/gameData.php?id=1298, https://clashofclans.fandom.com/wiki/Individual_Costs).

**Conventions extracted:**
- Icon + cost directly on button; costs rendered with the resource's own icon, not text names.
- Tab structure by category (economy/military/defense) with badge counts; CoC/Rise of Kingdoms both use this.
- Clash Royale shop: max **6 items per screen view**, single-line text explanations — an explicit cognitive-load cap (https://www.gornicki.me/blog/90l/ux-in-clash-royale-part-1).
- Unaffordable items: shown but visually muted/red cost rather than hidden (standard across CoC/Royale-family; supports planning).
- **Queue visualization:** show current-item progress bar + row of queued icons (desktop RTS shows up to ~8 queue slots); tap a queued icon to cancel/refund; allow queueing beyond current resources where design permits (https://gamedev.net/forums/topic/698491-rts-unit-production/5388402/, https://discussions.unity.com/t/rts-unit-creation-bar-queue-system/175567). Context-sensitivity: progress shown only when the producing building is selected, plus an always-visible mini indicator over the building itself.

---

## 3. Minimap Design on Phones

From the dedicated minimap survey (https://alejandro61299.github.io/Minimaps_Personal_Research/):
- **Position:** MOBAs = bottom (mobile MOBAs commonly top-left in practice, but the survey's dataset says bottom-anchored); strategy = bottom-left; RTS = top-right in some cases; placement affects reaction time; **configurable position/size is the accessibility recommendation**.
- **Type:** "whole world" miniature (RTS/MOBA norm) vs player-centered viewport (action games). RTS wants whole-world + draggable camera rectangle.
- **Interactions:** tap-to-jump camera, drag-to-pan camera, path drawing, pings (target/retreat), zoom buttons, rotation toggle, tooltips.
- Mobile Legends: minimap scalable to **125%**, repositionable "for easy thumb reach", even placeable near skill buttons (https://news.bittopup.com/news/best-mobile-legends-project-next-settings-2025-high-camera-125-minimap-boost). Mobile MOBA guidance: minimap must be glanceable without losing focus on action; one-tap objective targeting streamlines without removing agency (https://www.designthegame.com/learning/courses/course/exploring-different-mobile-game-genres/the-evolution-moba-designing-mobile-battle-arenas).
- **Mobile simplification vs desktop:** fewer icon classes, larger blips, stronger color coding (owner colors only, not unit types), viewport rectangle thicker; RTS minimap interaction taxonomy at https://rtsclones.fandom.com/wiki/Minimap_Interaction.
- Anti-pattern: minimap so small taps mis-jump; mitigate with tap = jump + brief zoom-lens, or two-stage (tap enlarges, second tap jumps).

---

## 4. Typography & Readability

**Size floors:**
- iOS HIG: **11pt absolute minimum**, 17pt recommended body; Material 3: **14sp minimum body, 16sp preferred**; accessibility experts suggest 16pt baseline; button text 16–18pt (https://fontfyi.com/blog/mobile-typography-accessibility/, https://weareaffective.com/learning-centre/how-do-i-choose-the-right-font-size-for-my-mobile-app, https://www.learnui.design/blog/mobile-desktop-website-font-size-guidelines.html).
- Game Accessibility Guidelines (basic tier): "use an easily readable default font size", "simple clear text formatting" (https://gameaccessibilityguidelines.com/basic/).

**Contrast (WCAG applied to games):**
- ≥**4.5:1** for text <18pt (or <14pt bold); ≥**3:1** for larger text — explicitly endorsed for games by Game Accessibility Guidelines (https://gameaccessibilityguidelines.com/provide-high-contrast-between-text-ui-and-background/).

**Text over live gameplay:** prefer plain high-contrast plates behind text; where impossible, use prominent **outlines and shadows**; semi-opaque backdrop behind text raises contrast while keeping the scene visible (rated more effective than shadow alone); combinations (overlay + blur + shadow) work best (https://gameaccessibilityguidelines.com/provide-high-contrast-between-text-ui-and-background/, https://www.nngroup.com/articles/text-over-images/, https://indieklem.com/13-the-basics-of-typography-in-game-interface/).

**Resource number formatting:** short-scale suffixes are the standard — 1–3 digits before suffix (1.5K, 12K, 1.5M; K/M/B/T ladder); keeps counters fixed-width and glanceable; if a game uses K/M/B anywhere it should use them consistently (https://www.simpleidle.com/learn/big-number-notation-explained, https://gram.gs/gramlog/formatting-big-numbers-aa-notation/). For an AoE2-scale economy (numbers <100K), full digits with a thousands separator or K-above-9999 are the two used conventions; use tabular (monospaced) figures so counters don't jitter.

---

## 5. Iconography

**Touch target floors (distinct from icon art size):** Apple 44×44pt; Material 48×48dp with **≥8dp spacing** between targets; WCAG 2.5.8 legal floor 24×24 CSS px but design systems use 32–48px; fingertip pad ≈ 1.6–2cm, thumb ≈ 2.5cm (https://blog.logrocket.com/ux-design/all-accessible-touch-target-sizes/, https://testparty.ai/blog/wcag-target-size-guide). So a 40–60px icon is fine visually but its hit area must be padded to ≥44pt.

**Silhouette-first design:** icon must read at 32px and scale to 1024; one idea per icon, not five; avoid thin lines, small text, busy textures ("every extra detail adds noise"); high contrast between main shape and background; keep meaningful shapes in an inner safe zone; build on an 8px grid; test in-context at device size, light and dark (https://medium.com/@kevinwolstenholme/our-6-golden-rules-for-effective-game-icon-design-2f89902b32a2, https://www.numberanalytics.com/blog/ultimate-guide-icon-design-game-art, https://uxplanet.org/practical-guide-to-icon-design-794baf5624c8).

**Consistent families:** shared stroke weight, corner radius, palette, and perspective across a set; game convention adds shared frame/rarity border language (CoC's gold-bordered resource icons).

**When labels are required (NN/g):** universal icons are rare — only home, print, magnifying-glass search approach universal recognition; everything else needs a text label to disambiguate; labeled icons navigate faster even for users who recognize the icon (https://www.nngroup.com/articles/icon-usability/, https://www.nngroup.com/videos/icon-text-labels/). Game-specific corollary: in a build grid, label on first exposure / long-press tooltip thereafter; Clash Royale keeps a consistent "info" button style everywhere so players learn one affordance (https://tonyip.com/clashroyale.html).

---

## 6. Meta UI: Start, Settings, Lobby, Post-game

**Start/main menu:** first screen must show game style + immediate access to core actions (play/continue, settings); progressive disclosure — essentials upfront, advanced under expandable groups; secondary options as bottom icon row (also eases localization) (https://indieklem.com/9-creating-an-intuitive-in-game-menu/, https://aaagameartstudio.com/blog/mobile-games-ui-ux).

**Clash Royale navigation model (gold standard for mobile meta UI):** persistent 5-tab bottom bar (Social/Battle/Shop/Cards/Events), battle tab center; UI depth almost never exceeds **one level** — deeper flows disguised as single-level popups; popups are non-fullscreen so background context stays visible; tap-background-to-dismiss; button color grammar: **yellow = primary** (Enter Battle), **green = secondary** (Buy/Upgrade), **red = notifications**, blue = chrome; max one notification popup at session start ("modesty with notifications" for 2–5 minute sessions) (https://www.gornicki.me/blog/90l/ux-in-clash-royale-part-1, https://www.gornicki.me/blog/Woq/ux-in-clash-royale-part-2, https://tonyip.com/clashroyale.html, https://www.therookies.co/blog/education/game-design-ux-best-practices-detailed-breakdown-of-clash-royale).

**Settings screens:** group by function (audio+visual together; account/notifications separate); ≥15 settings → subscreens; surface frequently used settings first; search for deep hierarchies; all settings must persist (GAG basic guideline "ensure all settings are saved/remembered") (https://developer.android.com/design/ui/mobile/guides/patterns/settings, https://www.toptal.com/designers/ux/settings-ux, https://gameaccessibilityguidelines.com/basic/).

**Lobby/matchmaking:** three canonical parts — find session, create session, assemble party; player waits in an out-of-game lobby until start signal; big single "Battle" button with async search (search continues while browsing) is the Royale-family pattern; browsable pattern libraries: https://www.gameuidatabase.com/index.php?scrn=181 (Matchmaking Lobby), https://www.gameuidatabase.com/index.php?scrn=43 (Pre-Game & Lobby).

**Post-game summary (PUBG Mobile user study, Key Lime Interactive):** players split into *Strategists* (experienced, skim) and *Rookies* (use stats to improve) — design for both with a headline layer + drill-down; players **ignore or misread stats they don't understand** (the radial/spider graph was widely not understood — avoid unexplained radar charts); post-match screen is the high-traffic stats moment (7/12 used it frequently vs 2/12 for profile stats screens) (https://info.keylimeinteractive.com/mobile-games-post-match-statistics-ux). AoE-style score/timeline graphs remain the RTS convention; Warcraft Rumble's victory screen is a celebrated example of celebration-first, stats-second (https://alanvitek.com/warcraft-rumble-ui-ux-inspiration/). Pattern gallery: https://www.gameuidatabase.com/index.php?scrn=53 (Results Screen).

**Minimalism counter-model (Polytopia/Midjiwan):** deliberate rejection of multi-currency/multi-timer clutter; principles include Simplicity & Accessibility (streamline interfaces for mobile without sacrificing depth) and Aesthetic/Functional Balance — a strong template for a zero-monetization game (https://mobidictum.com/christian-lovstedt-midjiwan-polytopia-minimalism/).

---

## 7. Game Feel / Juice in UI

- Buttons: squish/scale on press (hover/press scale ~**1.03–1.06**), color shift, audio tick; pressed state must be visually distinct and instant (https://itch.io/blog/1059831/making-a-game-feel-juicy-with-simple-effects, https://resprawn.medium.com/when-you-play-a-great-game-it-feels-good-d23761b6eccf).
- Menu transitions: slide+fade between screens, scale shifts on selection, audio clicks; players feel these even if they don't notice them (https://gamineai.com/blog/game-ui-animation-creating-smooth-engaging-interface-transitions).
- Warcraft Rumble as reference: "slot-machine" layered reward effects on unlock/victory/level-start, "dialed in" — celebrated as exceeding mobile standards; the caution for your context is that this style is engineered for monetized dopamine loops — take the responsiveness, skip the manipulation (https://alanvitek.com/warcraft-rumble-ui-ux-inspiration/).
- Speed rule: juice must never add input latency; transitions should be skippable/interruptible; keep durations short (common guidance ~150–250ms for navigational transitions).
- Haptics: include toggle/slider for any haptics (GAG basic) (https://gameaccessibilityguidelines.com/basic/).
- **Loading states:** patience threshold **3–5s**; progress bars that accelerate toward completion feel faster; skeleton screens reduce perceived wait; use loading moments for lore/tips; good load visualization reduces abandonment **10–15%** (https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/, https://www.cyberbytes-it.co.uk/loading-screens/, https://wpamelia.com/loading-bar/).

---

## 8. Onboarding / FTUE

- **Stakes:** apps lose **77% of users within 3 days** without proper FTUE (https://keewano.com/blog/first-time-user-experience-ftue-mobile-games/).
- **Progressive disclosure is the core mechanism:** introduce mechanics and UI elements one at a time, only when actionable; never front-load (https://nastyrodent.com/onboarding-and-ftue-design/, https://www.appnality.com/blog/guide-to-mobile-game-ui-ux-design/). For a complex RTS this means: first match exposes only move/gather; build menu, minimap, and hotkey-equivalents unlock progressively.
- **Coach marks/spotlights:** one at a time; brief actionable copy; high-contrast dimmed overlay + arrow/highlight; show on first encounter of a feature; always skippable/dismissible; option to disable hints for returning players (https://www.go2blog.com/2026/05/mastering-coach-marks-for-effective-mobile-app-onboarding/, https://www.designstudiouiux.com/blog/mobile-app-onboarding-best-practices/).
- **Teach through action, not text walls:** tutorials as mini-missions with rewards at the end; avoid long text screens (https://adriancrook.com/best-practices-for-mobile-game-onboarding/).
- AoE3's "tiered information revelation" cited as the strategy-genre approach to preventing overload (https://www.gamedeveloper.com/design/ui-strategy-game-design-dos-and-don-ts).
- Clash Royale onboarding relies on contextual tooltips with a single consistent info-button affordance so players "learn through interaction" (https://tonyip.com/clashroyale.html).

---

## 9. Dark Patterns to Avoid / Player-Respect Patterns

Research taxonomy (CHI/MUM papers): dark patterns operate on **temporal** (appointment mechanics, timers, daily-login FOMO), **monetary** (intermediate currencies, pay-to-skip), **social** (guilt/social obligation, fake scarcity), and **psychological** (grinding, variable rewards) axes; present even in games perceived as benign (https://dl.acm.org/doi/10.1145/3701571.3701604, https://dl.acm.org/doi/fullHtml/10.1145/3491101.3519837, https://lost-on-arrival.com/en/ethical-design/).

**What a zero-monetization UI gets to delete** (and thereby signal cleanliness): shop tab, gem/premium currency counters, timer bars, badge-spam, "special offer" popups, battle pass meters, notification begging. The Polytopia critique is the positive model: modern mobile games are "bloated with multiple currencies, menus, tiers and timer bars" — absence of these is itself a trust feature (https://mobidictum.com/christian-lovstedt-midjiwan-polytopia-minimalism/).

**Player-respect patterns:** transparency of costs/consequences; respect for player time (sessions end when the player wants; no appointment mechanics); opt-in everything; max one popup at session start (Royale's own restraint rule); no fake urgency; settings that persist; visible real odds/values where randomness exists (https://www.gamedesignknowledge.com/blog-post/the-ethics-of-dark-patterns-in-game-design, https://www.gornicki.me/blog/90l/ux-in-clash-royale-part-1).

---

## 10. Accessibility in Mobile Game UI

- **Colorblind:** never convey essential info by fixed color alone (player colors need shape/pattern backup or palette remap); support protanopia/deuteranopia/tritanopia palettes. **Okabe-Ito 8-color palette** is the de-facto colorblind-safe categorical set (black #000000, orange #E69F00, sky blue #56B4E9, bluish green #009E73, yellow #F0E442, blue #0072B2, vermillion #D55E00, reddish purple #CC79A7) — ideal for player colors; ~1 in 12 men, 1 in 200 women have CVD (https://gameaccessibilityguidelines.com/basic/, https://scifig.ai/blog/okabe-ito-color-palette-hex-codes, https://caniplaythat.com/2020/01/29/color-blindness-accessibility-guide/).
- **Motion:** avoid flicker/repetitive patterns; camera-shake/motion-blur toggles; respect `prefers-reduced-motion` in browser context (https://gameaccessibilityguidelines.com/basic/, https://accessiblyapp.com/blog/video-game-accessibility/).
- **Text/UI scale:** UI scaling + font-size options are among the **four most-complained-about issues** (remapping, text size, colorblindness, subtitles) (https://gameaccessibilityguidelines.com/full-list/).
- **Motor/touch:** large well-spaced virtual controls "particularly on small or touch screens"; adjustable sensitivity; simple-control alternative; adjustable game speed (directly relevant to RTS — a speed slider is an accessibility feature) (https://gameaccessibilityguidelines.com/basic/).
- **One-handed/reachability:** configurable HUD element position/size (minimap research recommendation); Mobile Legends allows repositioning the minimap next to skills (https://alejandro61299.github.io/Minimaps_Personal_Research/).
- Xbox Accessibility Guidelines as a second checklist: https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/101.

---

## Extracted Principle Summary (for synthesis)

1. Consolidate to ≤2 HUD zones: top edge = passive info (resources, age/pop), bottom edge = interactive (selection panel, command card, build sheet); minimap in one bottom corner, ideally user-swappable.
2. ~20% attention/area HUD budget; center of screen sacred.
3. Every interactive target ≥44pt hit area with ≥8dp gaps, regardless of icon art size (40–60px art is fine).
4. Body text ≥14sp (16sp preferred), never <11pt; 4.5:1 contrast; outline/shadow + semi-opaque plate for text over gameplay; tabular figures + K/M abbreviation for counters.
5. Build menus: tabbed grid in a bottom sheet beats radial for >8 items; radial (tap-hold on unit/ground) excels for ≤6 contextual commands — CoH iPad shipped both.
6. Queue = progress bar + tappable cancelable icon row; allow queue-ahead-of-resources.
7. Minimap: whole-world, tap-to-jump + drag-pan, scalable (ML allows 125%), repositionable, owner-color blips only.
8. Meta UI: one-level depth, persistent bottom/side nav, popup-not-page, tap-outside-dismiss, yellow/green/red button grammar.
9. Juice: 1.03–1.06 press scale, 150–250ms transitions, accelerating progress bars, celebration-first victory screen — never at latency cost.
10. FTUE: one coach mark at a time, teach by doing, progressive UI unlock, always skippable.
11. Zero-monetization = delete shop/timers/currencies/badges entirely; restraint is the feature.
12. Accessibility floor: Okabe-Ito player colors + shape redundancy, reduced-motion toggle, UI scale slider, game-speed option, persistent settings.

Key anti-patterns: scattered command areas; radar charts in post-game stats (users don't understand them); unlabeled novel icons; HUD flush against notch/home-indicator; front-loaded text tutorials; notification/popup stacking; conveying team identity by color alone; minimap too small to tap accurately.
