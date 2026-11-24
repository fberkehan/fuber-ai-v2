# Plugins ("for JARVIS")

Optional device integrations that are deliberately **not** part of the Fuber AI v2 core. They add native code to the
desktop app (a module, a page and a dictionary) and ship the matching device app as source.

| Plugin | What it adds | Device source |
| --- | --- | --- |
| [`jarvis-quest`](jarvis-quest) | Meta Quest 3 bridge (QR + PIN pairing, end-to-end encrypted TCP), the JARVIS HUD stream to the headset, and the device bridge other plugins use | `device/quest-unity` (Unity 6 project) |
| [`jarvis-watch`](jarvis-watch) | Galaxy Watch heart rate, battery and wear state in a Watch page (requires `jarvis-quest` for the bridge) | `device/watch-android` (Kotlin / Wear OS project) |

These are *not* the Workshop plugins of the app (`docs/EKLENTI-API.md`: sandboxed JavaScript the assistant writes at
runtime). The Workshop sandbox has no network server, no pairing and no native UI, so a headset bridge cannot be one.
Instead each plugin here is a source overlay that an installer script copies into the core tree.

## Install / uninstall

From the repository root, after `npm ci`:

```
node plugins/jarvis-quest/install.mjs            # bridge + Quest HUD stream
node plugins/jarvis-watch/install.mjs            # needs jarvis-quest (add --with-requires to install it first)
node plugins/jarvis-watch/uninstall.mjs
node plugins/jarvis-quest/uninstall.mjs
```

Flags: `--no-npm` (skip `npm install` of the plugin's own dependencies), `--force` (overwrite existing files),
`--with-requires` (install required plugins first).

An install

1. copies the plugin's `desktop/` files into `apps/desktop/src/main/modules`, `apps/desktop/src/renderer/main/pages`
   and `packages/shared/src/i18n/tr` (these folders are auto-discovered, see `scripts/gen-index.mjs`),
2. registers the module id in `packages/shared/src/constants.ts` below the `// PLUGIN-MODULES` marker,
3. installs the plugin's npm dependencies (`qrcode` for `jarvis-quest`) into the desktop workspace,
4. regenerates the discovery indexes and writes a record to `.plugins/installed/<id>.json` (git-ignored).

Uninstall deletes exactly the recorded files, removes the module id and the dependencies, and regenerates the indexes.
After installing, run `npm run typecheck && npm test`; both cover the plugin's own unit tests.

The core stays plugin-agnostic: JARVIS publishes `jarvis.snapshot` and `jarvis.device` events on the app bus and
accepts `jarvis.deviceMessage`; the Quest plugin is the only code that knows about headsets.

## Privacy

No pairing keys, device ids, IP addresses, PINs, logs, build outputs or signing keys are included. Pairing data (the
PC's bridge key and the list of paired devices) is created on your machine on first use, in `xr/pairing.json` in the
app data folder, and never leaves it. In this release that file is not encrypted; it is protected only by the file
permissions of your user profile.
