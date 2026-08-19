# Touch Controls & Input Schemes for Mobile RTS — Research Report

## 1. Unit selection on touch — shipped schemes
- **Company of Heroes (iPad/iPhone, Feral)**: tap squad to select; persistent side-screen squad icons (cards); group organization + criteria highlighting (all vehicles, all in combat). Reviewers: genuinely playable, "fiddly" in busy scenes. (toucharcade.com CoH review; gamezebo.com)
- **ROME: Total War (Feral)**: tap select/deselect; **lasso circle** around units selects all; Imperium update added collapsible left-edge **group grid** for one-tap saved-group selection. Phone-size still "a little fiddly".
- **Autumn Dynasty (iPad, touch-first)**: tap unit or **draw circle around group**; move/attack = draw line from unit to destination; "controls akin to brushing" — the proof RTS can feel native on touch.
- **Rusted Warfare**: multi-touch **drag box selection**, unit groups, rally points, minimap commands; configurable **long-press circular selection**. Dev: mobile's multi-touch interface "really helps make the game playable on touch". Player reviews "10/10 controls".
- **Bad North**: no multi-select; tap commander, tap destination. **Time slows to ~1/5 while a unit is selected** — canonical "bullet-time command" mitigation.
- **Iron Marines**: tap structures/buttons; **hold unit + swipe** toward destination. Capped ~3 units + hero. Mobile version LACKS attack-move, waypoints, build queues, group hotkeys — most-repeated player complaint.
- **Halo Wars (console reference)**: single press = one unit; **double-press = all of type**; **hold = paintbrush selection**; dedicated **select-all-global** and **select-all-local (on-screen)** buttons; radial circle menu. The standard playbook mobile RTS borrow.
- **Northgard mobile**: touch-only, resizable UI scale. Controls "pleasantly surprising", UI "unwieldy on phones" — enlarged UI clutters and blocks map touches; better on tablets.
- **Mushroom Wars 2**: tap/swipe source→target (proportional troop send); Switch port dropped touch and reviewers flagged the loss.
- **Wild Rift (MOBA lessons)**: virtual joystick + tap abilities; **drag attack button toward enemy = target-lock**; Target Lock Filtering (champions only); targeting-priority settings; Riot removed free camera entirely.

**Implementation detail**: resolve input on pointer RELEASE, classify by distance moved — under threshold = tap, over = drag; once threshold exceeded, lock into drag. During drag box mark units "PreSelected" (highlight), commit on release. (gamedev.net RTS devlog 5)

## 2. Issuing orders
- **Tap-to-move with context sensitivity** is the default: tap ground = move, tap enemy = attack. Requires magnet/snap targeting.
- **Drag-to-order/line drawing**: Autumn Dynasty (stroke = move/attack, direction sets facing); Ember Conflict (flicking); Iron Marines (hold+swipe). ROME mobile: draw movement paths; tap-and-hold destination shortcut.
- **Radial/context menus**: CoH **Command Wheel** — select squad, tap-and-hold opens wheel of abilities; drag over ability to read description, release to trigger; sub-wheels (Engineer → building list); release at center = cancel. **Gameplay slows while wheel open.** Targeted abilities: tap-and-hold on target. Command Panel offered as switchable alternative.
- **Long-press semantics**: mobile stand-in for right-click/hover. ROME: tap-and-hold selected unit = Positioning Mode (position, facing, formation depth). Radial-fill progress indicator; typical ~350–500ms hold, ~10px slop.
- **Command slowdown genre-wide**: Bad North ~1/5x, CoH wheel slowdown, ROME "Command Slowdown: default enabled", CoH tactical pause with queued orders. Substitutes for mouse APM.
- **Order feedback**: ROME added **red targeting pins** showing each unit's current order target. Best practice: persistent destination marker + spawn ping at tap point.
- **Attack-move**: largely ABSENT on mobile (Iron Marines backlash). Options: implicit auto-engage, stance toggle (ROME Fire-at-Will 3-state), or mode button ("next tap = attack-move") that visually latches and auto-clears after one use.
- **Waypoint queuing**: rare (no Shift). Solutions: queue-mode toggle; long-press to append; CoH pause-mode queuing.
- **Fat-finger mitigations**: magnet/snap to nearest valid target within tap radius; touch hitboxes LARGER than visuals (visual 60–100% of target per Microsoft; Material allows 24dp icon in 48dp target); finger occludes target — offset ghost/cursor above finger or magnify. Numbers: fingertip 8–10mm, finger pad 10–14mm, index width 16–20mm (MIT Touch Lab); thumb ~2.5cm.

## 3. Camera control
- Dominant convention: one-finger drag on empty ground = pan; pinch = zoom; tap = select. Pan-vs-select ambiguity resolved by:
  1. **Context split**: drag on empty terrain pans; drag starting on unit moves/orders it.
  2. **Finger-count split**: one finger = select/box, two fingers = pan/zoom (canvas-app standard; Apple two-finger-pan multi-select API). Degrades gracefully.
  3. **Long-press to begin selection** while plain drag pans (Rusted Warfare).
- **Edge scrolling does not exist on touch** (edges are OS gesture zones — conflicts with iOS/Android system gestures). Replacements: drag-pan, minimap jump, event-jump buttons ("base under attack"), double-tap-unit-to-center.
- **ROME camera options checklist**: zoom-at-gesture vs zoom-at-center toggle; pan speed slider; smooth zoom with tilt; double-tap snap to selected units; minimap "Reset to Default View"; optional auto-deselect after ordering.
- **Rotation**: two-finger twist where world benefits (Bad North); most 2D/iso mobile RTS omit rotation to keep gestures unambiguous.
- **Wild Rift**: deleted player camera control entirely — every camera control removed frees attention and gesture space.
- **Browser plumbing**: Pointer Events; `touch-action: none` on canvas (kills double-tap-zoom + 300ms delay); expect `pointercancel` when browser claims a gesture; suppress page pinch-zoom.

## 4. Building placement on touch
- **Canonical (Clash of Clans + all mobile builders): spawn ghost → drag to position → grid-snap → validity tint (green/red) → explicit confirm (✓) / cancel (✗).** Two-step exists because touch has no hover — the drag IS the hover.
- Drag UX: visual lift (shadow/semi-transparency); snap guides; live valid-zone highlight; ~100ms settle animation. Keep ghost **offset above the finger**.
- Anti-pattern: place-on-first-tap with no confirm — guarantees misplacement on dense grids. Always cancel affordance + refund-on-cancel.

## 5. Touch target standards & thumb-reach (exact numbers)
- Apple HIG: min **44×44pt** (~9mm). Material/Android: **48×48dp**, ≥8dp spacing (16–24dp generous); visual icon may be 24×24dp inside. Microsoft: recommended 9mm/34px, min 7mm/26px, 2mm/8px spacing; bigger when error cost high or near screen edge. Nokia ≥1×1cm. WCAG 2.5.5 AAA = 44px; 2.5.8 AA = 24px.
- Research: Parhi/Karlson/Bederson one-handed thumb: **≥9.2mm single-target, 9.6mm multi-target**. NN/g baseline 1×1cm.
- **Hoober grip research (1,333 observations)**: 49% one-handed thumb, 36% cradle, 15% two-handed both-thumbs; ~2/3 of one-handed grips right-thumbed. Thumb-zone: green bottom-center arc, yellow stretch, red top corners. Users switch grips constantly.
- **Landscape/games**: nearly always two-handed "gamer stance"; reachable = lower-left and lower-right quadrants; top corners/top-center worst; thumbs occlude lower side regions they rest over. RTS HUD implication: commands in bottom corners within thumb arcs, info-only at top, never require cross-screen reach mid-battle.

## 6. Control groups / multi-unit alternatives
- Squad cards/tabs on screen edge (CoH persistent squad icons; drag into teams; criteria filters).
- Group grid (ROME collapsible left-edge).
- Type-based select-all (Halo Wars double-press; global/local select-all buttons) — "select all military" is the standard mobile surrogate for ctrl-groups.
- Unit-count caps as escape hatch (Iron Marines ~3 squads, Bad North 2–4, AoE Mobile 5 stacks).
- Banners/rally flags redirect production (Iron Marines; Rusted Warfare rally + numbered groups via UI).
- Anti-pattern: Iron Marines shipping without groups/waypoints = most repeated complaint.

## 7. Haptics & feedback
- iOS Taptic/Core Haptics (UIImpactFeedbackGenerator light/medium/heavy); Android Vibrator/HapticFeedbackConstants — big device variance; centralize in one service checking capability + preference (On/Minimal/Off).
- Reserve for meaningful moments: selection confirm, order accepted, building placed, under-attack alert. Light tick UI / stronger pulse events; avoid long/overlapping; pauses between pulses increase perceived strength; pair with sound; always a toggle (GAG basic).
- Visual feedback substituting for hover: highlight on finger-DOWN (not release); pre-selection highlight during drag box; aim arrows during drag-to-order; destination pins after commit; distinct pressed vs activated audio.
- **Web Vibration API works on Android Chrome but NOT iOS Safari** — web RTS can't rely on haptics on iPhone; double down on audio/visual there.

## 8. Accessibility of touch controls
- GAG: large well-spaced virtual controls; remapping; sensitivity options; no essential info by fixed color alone; **resizable and rearrangeable interfaces**; accuracy-demanding elements stationary; **don't require multi-touch gestures** except as optional alternates; haptics toggle; game-speed adjustment.
- Left-handed: mirror/flip HUD (movable command cluster); ~1/3 of one-handed grips are left-thumbed — "swap sides" toggle cheap and high-value.
- UI scale: Northgard ships multi-step resizing (too small = untappable, too big = occludes map — per-element scaling if possible).
- Colorblind-safe feedback: don't encode selection/ownership purely red/green; pair color with outlines/icons/patterns; placement validity tint needs secondary cue (✓/✗ on ghost).
- One-finger-only mode doubles as accessibility + "subway thumb" support.

## Extracted design principles
1. **Redesign, don't port.** Every praised touch RTS rebuilt input around the device; every "fiddly" complaint traces to a PC interaction surviving unchanged.
2. **Trade time for precision.** Slowdown/pause while commanding is the genre's universal compensation — default-on with disable option.
3. **Resolve gestures on release, with thresholds.** Never reinterpret a locked-in drag.
4. **One finger selects, two fingers move the world** — or context-split. Pick one rule, keep it absolute; pinch always zooms.
5. **Snap everything**: magnet targets, grid-snap placement, oversized invisible hitboxes (≥44pt/48dp; visual can be smaller than hitbox, never the reverse).
6. **Two-step for irreversible, one-step for spammy**: placement gets ghost + confirm/cancel; move orders instant single tap + visible pin.
7. **Long-press replaces hover; context replaces right-click.**
8. **"Select all army" macro** (global + on-screen + double-tap type) instead of drag-box micro.
9. **Commands in bottom-corner thumb arcs (landscape), info top; never top-corner taps mid-combat**; left/right mirroring + UI scaling.
10. **Feedback triple-stack**: finger-down highlight + audio tick + light haptic; persistent order pins.

**Anti-patterns**: attack-move/waypoints/groups omitted; UI scaled up until it blocks map; one-finger pan eating selection; place-on-tap; edge controls colliding with OS gestures; hover-tooltip reliance; sub-9mm targets; touch as afterthought.
