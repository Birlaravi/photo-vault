# Photo Vault

A private, encrypted photo vault you own and control — built with Angular + Capacitor.
Every photo is encrypted on-device with AES-256-GCM before it touches storage. Nothing
is ever uploaded anywhere. There is no vendor account system to get locked out of.

## How it's secure

- **Password → encryption key**: your password is run through PBKDF2 (250,000 iterations,
  SHA-256) to derive the actual AES-256 key. The password itself is never stored.
- **A one-time recovery code** is generated when you first set up the vault. It can unlock
  the vault independently of your password. **Save it somewhere safe (password manager or
  written down) the moment it's shown — it is never shown again and is not recoverable
  if you lose it along with your password.**
- **AES-256-GCM** encrypts every photo (and its thumbnail) individually with a fresh
  random IV, so no two encrypted files look alike even if the photos are identical.
- All data lives in the app's local IndexedDB storage (inside the app's private Android
  sandbox once packaged) — other apps on the phone cannot read it.

## Project structure

```
src/app/
  services/
    crypto.service.ts    - all encryption (Web Crypto API / SubtleCrypto)
    storage.service.ts   - IndexedDB persistence
    vault.service.ts      - ties crypto + storage together, app-level vault state
  app.ts / app.html / app.css   - the UI (setup, lock screen, recovery, gallery, viewer)
android/                  - native Android project (Capacitor)
capacitor.config.ts       - Capacitor app config
```

## Running it as a normal web app (fastest way to try it)

```bash
npm install
npm start
```
Then open http://localhost:4200 in a browser.

## Getting an installable APK without installing anything (GitHub Actions)

This project includes `.github/workflows/build-apk.yml`, which builds a debug APK
automatically in the cloud — no Android Studio needed on your machine at all:

1. Create a new (empty) repository on GitHub, e.g. `photo-vault`.
2. Push this project to it:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/photo-vault.git
   git push -u origin main
   ```
3. Go to the repo's **Actions** tab on GitHub. A "Build Android APK" run will already be
   in progress (or click **Run workflow** to start one).
4. When it finishes (~2-3 minutes), open the run and download the **photo-vault-debug-apk**
   artifact from the bottom of the page — that's a zip containing `app-debug.apk`.
5. Transfer `app-debug.apk` to your Reno 12 (email it to yourself, use a USB cable, or
   Google Drive) and tap it to install. You'll need to allow "install from unknown sources"
   the first time for whichever app you use to open it.

## Building the installable Android app locally instead

You'll need **Android Studio** installed (which includes the Android SDK) to build the
final APK. The web code itself needs no further changes — Capacitor just wraps it.

```bash
# 1. Install dependencies (first time only)
npm install

# 2. Build the Angular app for production
npm run build

# 3. Copy the built web app into the native Android project
npx cap sync android

# 4. Open the Android project in Android Studio
npx cap open android
```

In Android Studio:
- Let Gradle finish syncing (first time can take a few minutes).
- Connect your Reno 12 via USB with **USB debugging** enabled (Settings → About phone →
  tap "Version" / "Build number" 7 times to unlock Developer Options → enable USB
  debugging), or use an emulator.
- Click the green **Run ▶** button to install and launch the app on your device.

To build a standalone **APK** you can install without a cable, use
**Build → Build Bundle(s) / APK(s) → Build APK(s)** in Android Studio, then transfer the
resulting `app-debug.apk` from `android/app/build/outputs/apk/debug/` to your phone and
install it (you'll need to allow "install from unknown sources" for the file manager
you use).

## Making future changes

Whenever you change anything under `src/`, rebuild and re-sync before testing on Android:

```bash
npm run build
npx cap sync android
```

## If you ever forget the vault password

Open the app, tap **"Forgot password? Use recovery code"** on the lock screen, and enter
the recovery code you saved at setup. You'll then be asked to set a new password — your
photos stay exactly as they were, since the recovery code unlocks the same underlying key
your password does.

There is deliberately no other way in. If both the password and the recovery code are
lost, the photos cannot be decrypted — that's what makes the encryption real.
