# Fuber AI for JARVIS: Quest 3

Connects a Meta Quest 3 headset to Fuber AI v2. The headset shows the JARVIS HUD (weather, calendar, system load,
markets, links, assistant log) in mixed reality and can switch tabs, change the palette, open an item or trigger the
emergency stop. Everything runs on your local network; nothing goes through any server.

## What is in this folder

| Path | Purpose |
| --- | --- |
| `desktop/modules/xr` | Desktop bridge module: pairing (QR + 6 digit PIN), X25519 + HKDF + AES-256-GCM encrypted TCP on port 47852, UDP 47853 fallback discovery, HUD forwarding (`hud-forward.ts`), unit tests |
| `desktop/pages/xr`, `desktop/i18n/xr.ts` | The "VR" page and its dictionary (Turkish, like the rest of the app) |
| `device/quest-unity` | Unity 6 (6000.3) project of the headset app: `Assets`, `Packages`, `ProjectSettings` |
| `docs/PROTOCOL.md` | Bridge protocol v1 (transport, pairing, encryption) and the JARVIS HUD messages |
| `docs/protokol-test-vektoru.json`, `docs/hud-snapshot-ornek.json` | Shared crypto test vector (TypeScript, C# and Kotlin verify against it) and a sample `hud.snapshot` used by the Unity tests |
| `install.mjs`, `uninstall.mjs`, `plugin.json` | Installer into the desktop core (see [`../README.md`](../README.md)) |

## Requirements

- Fuber AI v2 on Windows 11 (the app is Windows-first) with Node 24+.
- Meta Quest 3 in developer mode, on the same Wi-Fi network as the PC.
- To build the headset app: Unity 6000.3.28f1 (see `ProjectSettings/ProjectVersion.txt`), the Android build module,
  and the Meta XR SDK (resolved from the scoped registry listed in `Packages/manifest.json`).
- Windows Firewall: allow the app on "Private networks" when it asks.

## Install the desktop side

```
node plugins/jarvis-quest/install.mjs
npm run typecheck && npm test
npm run dev:desktop
```

The bridge starts with the app. Open **VR** in the left rail to see the bridge status and the PC's local addresses.

## Build the headset app

1. Download `BouncyCastle.Cryptography` 2.x (MIT) from NuGet (the `netstandard2.0` DLL) and put it at
   `device/quest-unity/Assets/Plugins/BouncyCastle/BouncyCastle.Cryptography.dll`. The binary is not redistributed
   here; its license text is already in that folder.
2. Open `device/quest-unity` with Unity 6000.3, switch to Android, set your own signing keystore in
   *Project Settings > Player > Publishing Settings* (no signing key is included) and build.
3. Sideload the APK (`adb install`).

The Meta developer tooling regenerates a few settings assets on first open (for example the Dev Agent access token);
none of them are committed.

## Pair

1. In the desktop app: **VR > Start pairing**. A QR code and a 6 digit PIN appear (valid a few minutes, 5 PIN attempts).
2. In the headset app: choose "Connect to computer", look at the QR code or type the PIN.
3. Compare the 4 character security code shown in the headset with the one on the VR page.

After pairing, the headset reconnects automatically (`resume`). **Forget** on the VR page removes the pairing.

## Uninstall

```
node plugins/jarvis-quest/uninstall.mjs
```

(Uninstall `jarvis-watch` first if it is installed.)

## Notes

- The headset UI and the desktop dictionaries are Turkish (translations are welcome); the protocol document
  (`docs/PROTOCOL.md`) is in English.
- Fonts: Chakra Petch (SIL Open Font License 1.1) is bundled in `Assets/Fuber/Fonts`.
- The package id `ai.fuber.quest` is the app's identifier, not a server.
