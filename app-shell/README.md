# Stock Market 1968 — store shells

`app/market/` is the whole game: one HTML page, a web manifest, a service worker and
three icons. GitHub Pages publishes it at

    https://danielparamount-rgb.github.io/tiny-conquerors/market/

(`.github/workflows/pages.yml` pushes the `app/` folder to the `gh-pages` branch on every
push to `main`; `app/` is the site root, so `app/market/` is `/tiny-conquerors/market/`).

This folder packages that page as store apps without changing it:

| store | approach | what is checked in |
| --- | --- | --- |
| Google Play | Trusted Web Activity built with Bubblewrap — Chrome shows the hosted site full screen, no URL bar | `app-shell/twa-manifest.json`, `app/.well-known/assetlinks.json` |
| App Store | Capacitor shell — the game is copied into the app bundle and shown in a WKWebView | `app-shell/capacitor/` |

Nothing here is needed by the web app; the PWA keeps working on its own.

**Application id.** Both shells use `com.paramountoutdoorliving.stockmarket1968`. It has to
be an id you control (the reverse of a domain you own) and it can be changed freely
*before the first build*; after the first upload to either store it is permanent. If you
change it, change it in all three places together: `twa-manifest.json` (`packageId`),
`capacitor/capacitor.config.json` (`appId`) and `app/.well-known/assetlinks.json`
(`package_name`).

---

## 1. Android — Trusted Web Activity via Bubblewrap

A TWA is a small native app that opens the hosted site in Chrome, full screen, with no
browser UI. Game updates go out with the next push to `main`; the store app itself only
needs a new build when the name, icon or version number changes.

### Prerequisites

- Node 18 or newer.
- JDK 17 and the Android SDK. Bubblewrap offers to download both the first time it runs;
  say yes, or point it at existing installs when it asks. `bubblewrap doctor` checks the
  result (the paths are kept in `~/.bubblewrap/config.json`).
- A Google Play developer account. Registration is a one-time fee. Newly created personal
  accounts must run a closed test with a group of testers for a period before Play lets
  them publish to production — check the current Play Console requirements when you start.

### Where to run it

Always run Bubblewrap **inside `app-shell/`**, never from the repository root. The Android
project it generates has its own `app/` module folder, and `bubblewrap update` deletes and
recreates that folder — from the repo root it would wipe the deployable site in `app/`.

### Build

```sh
cd app-shell
npm install -g @bubblewrap/cli        # or prefix every command below with: npx @bubblewrap/cli
```

Either start from the live web manifest:

```sh
bubblewrap init --manifest https://danielparamount-rgb.github.io/tiny-conquerors/market/manifest.webmanifest
```

`init` reads the manifest, asks a series of questions (name, colours, id, key store — the
answers it proposes come from the manifest and match the checked-in file) and generates
the Android project. It rewrites `twa-manifest.json` with your answers.

Or skip the questions and use the checked-in `twa-manifest.json` as-is:

```sh
bubblewrap update --skipVersionUpgrade   # generates the Android project from twa-manifest.json
```

(`--skipVersionUpgrade` keeps the version at 1.0.0 / code 1; leave it off later and
`update` bumps the version code and asks for a new version name.)

Then build:

```sh
bubblewrap build
```

`build` produces two files next to the manifest:

- `app-release-bundle.aab` — this is what you upload to Play;
- `app-release-signed.apk` — for sideloading onto a phone with `adb install`, or
  `bubblewrap install`.

Keep the CLI current (`npm install -g @bubblewrap/cli@latest`) so its Android template
meets whatever target SDK level Play currently requires.

The generated project (`app/`, `build.gradle`, `gradle*`, `manifest-checksum.txt`,
`store_icon.png`, the `.aab`/`.apk`) can be regenerated at any time from
`twa-manifest.json`; there is no need to commit it. The key store, below, must never be
committed.

### The signing key

The first `build` (or `init`) notices there is no `android.keystore` and offers to create
one. Say yes, use the alias `stockmarket1968` (it must match `signingKey.alias` in the
manifest), fill in the certificate details it asks for, and choose two passwords: one for
the key store and one for the key. Bubblewrap asks for both on every build (or reads them
from `BUBBLEWRAP_KEYSTORE_PASSWORD` and `BUBBLEWRAP_KEY_PASSWORD`).

**Back up `android.keystore` and both passwords somewhere safe.** Every future update
must be signed with the same key. If it is lost the app cannot be updated; the only way
forward is a new listing under a new application id. Do not add the key store to git.

### Let Chrome hide the URL bar (Digital Asset Links)

Until this is done the app works but shows a Chrome URL bar at the top. Chrome hides it
only when the site publicly declares that this app — identified by its package name and
the SHA-256 fingerprint of its signing certificate — is allowed to handle it. That
declaration is `app/.well-known/assetlinks.json`, which currently contains the placeholder
`REPLACE_WITH_THE_SHA256_FINGERPRINT_FROM_KEYTOOL` and **must be replaced** before the
app is any use.

1. Read the fingerprint of the key you just created:

   ```sh
   keytool -list -v -keystore android.keystore -alias stockmarket1968
   ```

   Copy the `SHA256:` line — colon-separated hex, like `A1:B2:C3:...` (64 hex digits in
   32 pairs). If `keytool` is not on your `PATH`, it lives in the JDK Bubblewrap installed:
   see `jdkPath` in `~/.bubblewrap/config.json`, then `<jdkPath>/bin/keytool`.
   (`bubblewrap fingerprint add <SHA256>` followed by
   `bubblewrap fingerprint generateAssetLinks` prints the same JSON if you prefer.)

2. Open `app/.well-known/assetlinks.json` and put that value in place of the placeholder.

3. Commit and push to `main`. The file only goes live when Pages redeploys, which happens
   on the next push to `main`. It is then served at

       https://danielparamount-rgb.github.io/tiny-conquerors/.well-known/assetlinks.json

   Open that URL and check you get the JSON back (not a 404). `app/.nojekyll` is what
   makes Pages serve a dot-directory like `.well-known`; the Pages workflow already
   disables Jekyll, so the file is a belt-and-braces guard.

4. **Play App Signing.** When you upload to Play, Google re-signs the app with a key it
   holds, so the certificate on installed copies is *not* your local one. After the first
   upload, open Play Console → your app → *Setup* → *App signing* (it sits under "App
   integrity" in some Console versions) and copy the **App signing key certificate**
   SHA-256. Add it to `assetlinks.json` as a second string in
   `sha256_cert_fingerprints`, keep the local one too, and push again. With both listed,
   sideloaded test builds and store builds both verify.

Reinstall the app after the file is live. Chrome checks the statement at launch; the URL
bar is gone when it verifies. If it is still there, the usual causes are a fingerprint
typo, the wrong package name, the file not being served as JSON, or the Play signing key
missing from the list. Google's Statement List tester at
https://developers.google.com/digital-asset-links/tools/generator checks a live URL
against a package name and fingerprint.

### Upload to Play

1. Play Console → *Create app*: name "Stock Market 1968", type Game, Free.
2. Work through the setup checklist — store listing, content rating, data safety, target
   audience, privacy policy. See section 3.
3. *Release* → *Testing* → *Internal testing* → *Create new release* → upload
   `app-release-bundle.aab`. Add your own Google account as a tester, install from the
   opt-in link, and confirm the URL bar is gone (step 4 above needs the Play fingerprint
   first).
4. Promote the same build to closed/open testing and then production. For each new upload
   raise `appVersionCode` (and `appVersionName`) in `twa-manifest.json` — running
   `bubblewrap update` without `--skipVersionUpgrade` does it for you — and run
   `bubblewrap build` again. Play refuses a bundle whose version code it has already seen.

### What works inside the TWA

- Online play over the game's WebSocket relay (`wss://tiny-conquerors-relay.onrender.com`)
  works exactly as in Chrome; it is Chrome.
- "Your turn" web-push notifications work. `enableNotifications: true` in the manifest
  turns on notification delegation, so pushes are shown as coming from the app.
- Offline play works through the game's own service worker.

### Android via Capacitor instead

`app-shell/capacitor/` can also produce an Android app (`npx cap add android`,
`npm run android`) that bundles a copy of the game. The TWA is the better fit for Play —
real Chrome, web push, and no bundled copy going stale — so use Capacitor for Android
only if you need a single toolchain for both stores. Do not ship both under the same
application id.

---

## 2. iOS — Capacitor shell

Capacitor wraps a folder of web files in a native Xcode project and shows it in a
WKWebView. `sync.mjs` copies `app/market/` into `www/`, so the game ships inside the app
bundle and starts with no network at all.

### Prerequisites

- A Mac with Xcode 15 or newer (App Store submissions must come from Xcode).
- CocoaPods (`brew install cocoapods`) — Capacitor 6 uses it to build the iOS project.
- An Apple Developer Program membership (annual fee) for device installs, TestFlight and
  the App Store.
- Node 18 or newer.

### First run

```sh
cd app-shell/capacitor
npm install               # @capacitor/core, cli, ios, android — nothing else
npm run sync              # copies ../../app/market into ./www (recreated every time)
npx cap add ios           # creates ios/ from capacitor.config.json (once)
npx cap open ios          # opens ios/App/App.xcworkspace in Xcode
```

`www/`, `ios/` and `android/` are generated and ignored by git; `capacitor.config.json`
and `sync.mjs` are the source of truth. `npx cap add ios` needs `www/` to exist, which is
why `npm run sync` comes first.

In Xcode:

1. Select the *App* project → *App* target → *Signing & Capabilities*. Pick your *Team*.
   The *Bundle Identifier* is prefilled from `appId`; change it here and in
   `capacitor.config.json` together if you need a different one.
2. *General* → *Identity*: Display Name "Stock Market 1968" (from `appName`), Version
   `1.0.0`, Build `1`. Every TestFlight upload needs a higher Build number.
3. Replace the placeholder app icon: *App* → `Assets.xcassets` → *AppIcon* takes a single
   1024×1024 PNG with no transparency (see section 3 for making one). The launch screen
   (`Splash.imageset` / `LaunchScreen.storyboard`) can stay the plain `#0f2b21` background.
4. Optional but saves a prompt on every upload: in *Info* add
   `ITSAppUsesNonExemptEncryption` = `NO`. The app only uses standard HTTPS/WSS.
5. Plug in an iPhone, choose it as the run destination, press Run. The first device
   install asks you to trust the developer certificate on the phone
   (Settings → General → VPN & Device Management).

### Updating the bundled game

After any change to `app/market/`:

```sh
npm run sync && npx cap sync ios
```

then build again in Xcode. A new App Store version is needed for players to receive it
(unlike the TWA, where the hosted page updates itself).

### Thin-shell alternative (load the hosted site instead of bundling)

Add a `server` block to `capacitor.config.json`:

```json
"server": { "url": "https://danielparamount-rgb.github.io/tiny-conquerors/market/" }
```

The WebView then loads the live site and the bundled `www/` is ignored (it still has to
exist). Game updates reach players without a store release, at the cost of needing a
network connection at launch, and Apple's review is less forgiving of an app that is only
a website in a frame (guideline 4.2, minimum functionality). The bundled copy is the
safer shape for review; keep the thin shell for your own testing.

### Two things to check in the game itself before shipping the bundled shell

- **`localhost` is not a dev machine here.** The bundled page runs at
  `capacitor://localhost` on iOS (and `https://localhost` on Android). Any logic that
  treats hostname `localhost` as "running locally" — for instance choosing
  `ws://localhost:8080` for the relay, the way `netUrl()` does in Tiny Conquerors — will
  misfire inside the shell. Key such checks on `location.protocol === 'http:'` (or on
  `file:`), or make the relay address explicit.
- The service-worker registration is guarded by the same `localhost` test; under
  `capacitor://` it fails quietly, which is harmless because the files are already local.

### Known limitation: push notifications

WKWebView does not implement the Web Push API. So:

- "Your turn" web-push works in the installed PWA (Safari → Share → Add to Home Screen,
  iOS 16.4 or newer) and in the Android TWA.
- In the Capacitor iOS shell it does not. Adding it means `@capacitor/push-notifications`,
  an APNs key from the Apple Developer account, the Push Notifications capability in
  Xcode, and a server-side change so the relay can send to APNs as well as to web-push
  endpoints. That is a follow-up; nothing here does it.

Everything else works: the game's WebSocket play through
`wss://tiny-conquerors-relay.onrender.com` runs fine in WKWebView (the relay accepts any
origin; the free Render tier may take a minute to wake after idling, which the game
already reports in its own words), Table Talk, the Ledger, saved games in `localStorage`,
and offline play from the bundle.

### To TestFlight and the App Store

1. Xcode → *Product* → *Archive* (with *Any iOS Device* as the destination).
2. In the Organizer window: *Distribute App* → *App Store Connect* → *Upload*. Let Xcode
   manage signing.
3. https://appstoreconnect.apple.com → *My Apps* → *+* → New App: platform iOS, name
   "Stock Market 1968", the bundle id from Xcode, SKU anything (e.g. `stockmarket1968`).
4. *TestFlight* tab: the uploaded build appears after processing (usually within an hour).
   Add internal testers (your own Apple ID) and install through the TestFlight app.
5. *App Store* tab → *+ Version* → fill in the listing (section 3), attach the build,
   answer the export-compliance and content-rights questions, *Add for Review* →
   *Submit*. Review typically takes a day or two; a rejection comes with the guideline
   number and a note about what to change.

---

## 3. Store listing checklist

**Name.** "Stock Market 1968" (fits the 30-character limit on both stores). Launcher name
on Android is "Stock Market", matching the web manifest's `short_name`.

**Short description (Play, 80 characters max) / subtitle (App Store, 30 max).**

- Play: "The classic 1968 see-saw money game: work your stake, play the market."
- App Store subtitle: "The 1968 see-saw money game"

**Full description (draft; edit freely, keep it in your own words).**

> Start out working one of four jobs, bank your first $1,000, then step onto the board.
> Every square you land on tips the market indicator: four stocks rise while their mirror
> partners fall, and dividends, stockholders' meetings, forced sales and the odd bad throw
> decide who reaches $100,000 first.
>
> - 2 to 8 investors: pass-and-play on one phone, computer opponents, or online with
>   friends
> - The complete printed rules, plus a house-rules opening and timed sittings
> - Holdings at a glance, a full Ledger of every trade, and Table Talk at an online table
> - Works offline. No account, no ads, no tracking.

**Category.** Games → Board on both stores.

**Icons.**

- Play: 512×512 PNG, 32-bit with alpha, under 1 MB — `app/market/icon-512.png` as it is.
- App Store: 1024×1024 PNG, **no transparency**, square corners (Apple rounds them).
  Make it from the 512 by upscaling and flattening onto the background colour; any image
  tool works, for example:

  ```sh
  # macOS, built in:
  sips -z 1024 1024 app/market/icon-512.png --out icon-1024.png
  # ImageMagick, and flattens any alpha onto the felt green:
  magick app/market/icon-512.png -resize 1024x1024 -background "#0f2b21" -alpha remove icon-1024.png
  ```

  A 2× upscale of flat artwork looks fine; re-export from the original artwork at 1024 if
  the source is to hand. Check the corners are opaque before uploading.
- Play also wants a *feature graphic*, 1024×500 JPG/PNG — the icon centred on `#0f2b21`
  with the name beside it is enough.

**Screenshots.** Take them from the real app (simulator/emulator is fine:
`xcrun simctl io booted screenshot shot.png` on iOS; the emulator's camera button, or
`adb exec-out screencap -p > shot.png`, on Android).

- Phone, portrait: the splash/title screen; the board mid-game with pieces out and the
  indicator away from centre; the Ledger.
- Tablet, landscape: the board with the Holdings panel beside it.
- Play accepts 2–8 per device type, 16:9 or 9:16, 320–3840 px on each side.
- App Store needs 6.7" iPhone shots (1290×2796). Capacitor's Xcode template targets
  iPhone and iPad, so either add 12.9" iPad shots (2048×2732) or set the target's
  *Deployment Info* → *Devices* to iPhone only.

**Privacy.** The honest answers, the same on both forms: no accounts, no analytics, no
ads, no third-party SDKs, nothing stored on a server. Saved games live in the phone's
local storage. Online play sends only the table state, the names players choose in the
lobby (and Table Talk lines) through the relay so the other phones can see them; the
relay holds rooms in memory and stores nothing.

- Play *Data safety*: "No data collected" — the relay's in-memory forwarding is the
  ephemeral-processing case the form describes; say so in the notes if asked.
- App Store *App Privacy*: "Data Not Collected".
- Both stores require a privacy-policy URL even so. Add a short page saying the above
  (for example `app/market/privacy.html`, which Pages will serve at
  `/tiny-conquerors/market/privacy.html`) and link it in both consoles. Not created here.

**Content rating.** Everyone / 4+. It is a dice-and-move board game with play money — no
real-money or casino-style gambling, no violence, no unrestricted web access. Answer
"yes" to users being able to interact, because of the Table Talk chat at an online table;
the rating is unaffected. On Play, set the *target audience* to 13 and over — choosing an
under-13 audience pulls the app into the families programme with extra requirements,
without changing the Everyone rating.

**Originality.** All artwork, text and sound in the game are original, and the game is an
unaffiliated homage to the 1968 board game. Do not use Whitman branding — the publisher's
name as a brand, its logo, box art or photographs of the original — anywhere in the
listing, screenshots or icon. Describe it as "inspired by the 1968 board game" in your own
words.

---

## Follow-ups (not done here)

- A privacy page at `app/market/privacy.html`, linked from both store consoles.
- Native push on iOS (`@capacitor/push-notifications` + APNs + relay change) if the
  Capacitor shell ships.
- Root `.gitignore` entries for Bubblewrap's output inside `app-shell/`
  (`app-shell/app/`, `app-shell/build.gradle`, `app-shell/gradle*`,
  `app-shell/*.aab`, `app-shell/*.apk`, `app-shell/android.keystore`,
  `app-shell/manifest-checksum.txt`, `app-shell/store_icon.png`).
