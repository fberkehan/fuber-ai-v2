# Fuber AI for JARVIS: Galaxy Watch

Shows heart rate, battery and wear state from a Galaxy Watch (Wear OS 3+) in a **Watch** page of Fuber AI v2.
The watch app samples through Health Services and sends each measurement to the PC over the same encrypted local
bridge as the Quest app. Nothing is stored or sent anywhere else.

## What is in this folder

| Path | Purpose |
| --- | --- |
| `desktop/modules/jarvis-watch` | Desktop module: collects `bio.sample` / `bio.status` from the bridge, derives live / stale / off state from the age of the last real sample, unit tests |
| `desktop/pages/saat`, `desktop/i18n/saat.ts` | The "Watch" page (pairing window, last heart rate, battery, wear state) and its Turkish dictionary |
| `device/watch-android` | Kotlin / Jetpack Compose for Wear OS project (Gradle wrapper included; no keystore, no `local.properties`) |
| `device/watch-android/tools` | Optional test server that runs the desktop bridge code against the watch app |
| `install.mjs`, `uninstall.mjs`, `plugin.json` | Installer into the desktop core |

## Requirements

- The `jarvis-quest` plugin installed (it ships the bridge); `install.mjs --with-requires` installs it for you.
- Android Studio (or JDK 17 + Android SDK 34) to build the watch app; a Galaxy Watch on the same network as the PC
  (Wi-Fi), with developer mode and ADB debugging enabled for sideloading.

## Install the desktop side

```
node plugins/jarvis-watch/install.mjs --with-requires
npm run typecheck && npm test
```

## Build and install the watch app

```
cd plugins/jarvis-watch/device/watch-android
./gradlew assembleDebug          # Android Studio creates local.properties with your SDK path
adb connect <watch-ip>:<port>    # shown in the watch's developer options
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Grant the body-sensor and notification permissions on the watch when asked. The app is debug-signed; sign your own
release build with your own keystore if you need one.

## Pair

1. Desktop: **Watch > Pair watch**. A QR code and a 6 digit PIN appear.
2. Watch: open the Fuber app, choose "Connect to computer", enter the PIN.

The Watch page then shows the last heart rate and how old it is. The watch does not measure continuously: the state
is `live` for 20 minutes after the last real sample, `stale` up to 2 hours, then `off`. No value is ever invented.

## Uninstall

```
node plugins/jarvis-watch/uninstall.mjs
```

The Quest plugin stays installed until you uninstall it too.
