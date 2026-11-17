# Packaging Fairway Next for the App Store

The game is a web app. For iOS it is wrapped in a native shell with Capacitor, which loads
the built `dist/` folder from inside the app bundle (no server needed). `capacitor.config.json`
is ready. **This cannot be built from the machine that wrote it**: an iOS build needs a Mac
with Xcode and an Apple Developer Program membership. Nothing below has been run.

## You need

- A Mac with a current Xcode from the Mac App Store, and Xcode's command line tools.
- An Apple Developer Program membership (paid, yearly) for device testing beyond your own
  phone, TestFlight, and the App Store.
- Node 20 or newer.
- Your own bundle identifier. `app.fairwaynext.game` in `capacitor.config.json` is a
  placeholder; change `appId` to a reverse-DNS name you control before the first build.

## Build

```
npm ci
npm run assets            # once: downloads and processes the CC0 assets into public/assets
npm run verify            # tests, production build, headless smoke
npm install @capacitor/core @capacitor/ios
npm install -D @capacitor/cli
npx cap add ios           # creates ios/ (Xcode project)
npx cap sync ios          # copies dist/ into the app and installs native dependencies
npx cap open ios          # opens Xcode
```

After any change to the game: `npm run build && npx cap sync ios`.

## In Xcode

1. Select the App target, Signing and Capabilities: choose your Team. Xcode creates the
   provisioning profile.
2. General: set Display Name, Version, and Build. Minimum deployment iOS 15 or later (WebGL 2
   in WKWebView needs iOS 15).
3. Device orientation: allow portrait and both landscape orientations (the game supports
   both). Check "Requires full screen".
4. App icon: `ios-assets/AppIcon-1024.png` (1024 px, opaque, written by `npm run icons`).
   Drag it into Assets, AppIcon in Xcode.
5. Launch screen: the default storyboard with background `#0f1a14` matches the boot screen.
6. Run on a real iPhone (Product, Run). Use Safari, Develop menu, your device, to inspect the
   web view: check the quality tier the game picked (`?debug` overlay is not available
   in the app, but `window.__fw.info()` works in the console) and the frame rate.

## Behavior inside the app

- The service worker is skipped (WKWebView does not run service workers for the app's own
  scheme); the files are already local, so the game works offline anyway.
- `navigator.vibrate` does not exist on iOS, so there is no haptic feedback in Safari or the
  app as built. Adding `@capacitor/haptics` and calling it from `ui/ui.js` where `haptic()`
  is defined would add it.
- Saves live in the web view's local storage, inside the app's container. Deleting the app
  deletes them.
- Audio starts on the first touch, as iOS requires.

## Submit

1. Product, Archive. In the Organizer, Distribute App, App Store Connect, Upload.
2. In App Store Connect: create the app record with the same bundle identifier, add
   screenshots (6.9 inch and 6.5 inch iPhone sizes at minimum; the contact sheets in
   `qa/contact` are framing references, not store screenshots), description, keywords,
   category (Games, Sports), and age rating.
3. App Privacy: the game collects no data and has no network calls besides loading its own
   files; challenge links carry scores inside the link and are shared only by the player.
   "Data Not Collected" is the honest answer for this build.
4. Privacy manifest: Capacitor 6 and newer include one for the shell. If Xcode reports
   required-reason APIs during upload, add them to `ios/App/App/PrivacyInfo.xcprivacy`.
5. TestFlight first, then submit for review.

## What a person must check on a real device

- Frame rate and heat on an older iPhone at the low and medium tiers.
- That the swing stick is comfortable for a thumb at the default size, in both orientations.
- Audio balance through the phone speaker.
- Safe-area insets on phones with a notch or Dynamic Island (the HUD uses `env(safe-area-*)`,
  untested on hardware).
