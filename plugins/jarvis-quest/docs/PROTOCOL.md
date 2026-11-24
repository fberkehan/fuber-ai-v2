# Fuber XR bridge protocol, version 1

The bridge connects the desktop app (Fuber AI v2 with the `jarvis-quest` plugin, `desktop/modules/xr`) to the device
apps on the local network: the Meta Quest 3 headset app (`device/quest-unity`, Unity C#) and the Galaxy Watch app
(`plugins/jarvis-watch/device/watch-android`, Kotlin). This document is the single contract between them.

Rules for changes:

- Fields and message types may be added. Existing fields are never renamed or removed, and receivers ignore what they
  do not know.
- An incompatible change raises the version `v` and is made on every side together.
- `docs/protokol-test-vektoru.json` is a known-answer test vector for the key exchange and the encryption (§2, §3). The
  TypeScript, C# and Kotlin implementations all verify against it; regenerate it with `testvector.ts` only when §2–§4
  change on purpose.

## 1. Transport

- Local network, **raw TCP**, default port **47852**. The PC listens on `0.0.0.0` only while the `xr` module is enabled.
- Frame: `u32 big-endian length` + body. A body is at most 4 MiB; a larger frame closes the connection.
- Handshake frames (§3) are plain UTF-8 JSON. Every later frame is encrypted.
- Liveness: both sides send `ping` about every 5 seconds; a side that receives no frame for 15 seconds closes the
  connection.
- Discovery fallback: UDP broadcasts on port **47853** (§5).

## 2. Keys

- **PC static key** `S` (X25519): created on first start and kept in `xr/pairing.json` in the app data folder, together
  with the paired devices. In this release that file is not encrypted; it is protected only by the file permissions of
  the user profile. Its fingerprint is `fp = SHA-256(S_pub_raw32)`, 32 bytes, base64url without padding.
- **Device static key** `D` (X25519): created by the device when it pairs and kept in the app's private storage. The PC
  stores only `D_pub` and the `deviceId` it assigned.
- Each connection uses fresh ephemeral keys: `Ce` on the device, `Se` on the PC.

## 3. Handshake

1. Device to PC: `{"t":"hello","v":1,"mode":"pair"|"resume","eph":"<Ce_pub b64url>","deviceId":"<resume only>"}`
2. PC to device, one of:
   - Rejection, then the PC closes: `{"t":"reject","code":"bad_version"|"bad_hello"|"unknown_device"|"not_pairing"|"busy"}`.
     `pair` is accepted only while a pairing window is open (`not_pairing`).
   - `{"t":"hello","v":1,"eph":"<Se_pub>","static":"<S_pub>","name":"<PC name>"}`
3. The device checks `SHA-256(static) == fp` (the fingerprint comes from the QR code or the discovery broadcast when
   pairing, from the stored pairing when resuming) and closes the connection on a mismatch.
4. Key derivation:
   - `dh1 = X25519(Ce, Se)`, `dh2 = X25519(Ce, S)` (the PC computes `X25519(S, Ce)`)
   - in `resume` mode also `dh3 = X25519(D, Se)` (the PC computes `X25519(Se, D_pub)`); `pair` mode has no `dh3`
   - `th = SHA-256(utf8(hello1_json) || utf8(hello2_json))`, over the exact bytes sent on the wire
   - `okm = HKDF-SHA256(ikm = dh1 || dh2 [|| dh3], salt = th, info = "fuber-xr-v1", L = 64)`
   - `k_c2s = okm[0..32]`, `k_s2c = okm[32..64]`
5. Encrypted channel: **AES-256-GCM** with a 16-byte tag. Nonce = 4 zero bytes || `u64 big-endian counter`; each
   direction keeps its own counter, starting at 0 and incremented for every frame. A frame that fails to decrypt closes
   the connection, which also rejects replayed and reordered frames. There is no additional authenticated data.
6. The first encrypted message comes from the device:
   - `pair`: `{"t":"pair","code":"<QR secret>"}` or `{"t":"pair","pin":"123456"}`, together with
     `"kind":"quest"|"watch"` and `"device":{"name":"…","pub":"<D_pub>","model":"Quest 3","app":"0.1.0","kind":"quest"}`.
     The PC compares the code in constant time. On success it stores the device, burns the code, closes the pairing
     window and sends `{"t":"paired","deviceId":"…","name":"<PC name>"}`. A wrong code gets `{"t":"error","code":"bad_code"}`
     and the connection closes; a window allows at most 5 PIN attempts and then closes. A pairing window opened for one
     device kind rejects the other kind with `{"t":"error","code":"wrong_kind"}` and stores nothing (the client should
     tell the user to open the matching page: VR for the headset, Watch for the watch).
   - `resume`: `{"t":"auth"}`, optionally with `"kind"`, `"model"` and `"app"`. The keys already prove the device: if the
     PC can decrypt the frame, the device is the paired one.
7. The PC sends `{"t":"welcome","deviceId":"…","pcName":"…","appVersion":"…","features":[…],"authority":"ask"|"smart"|"full"}`.
   From then on messages flow freely in both directions.

When a paired device is removed on the PC, its open connection is closed with `{"t":"bye","reason":"forgotten"}`; its
next `resume` gets `reject unknown_device`, and the device deletes its stored pairing and offers to pair again.

## 4. Encrypted messages

The decrypted plaintext is one type byte followed by the payload:

- `0x01` JSON: a UTF-8 JSON object with a mandatory `t` field.
- `0x02` binary: `u8 channel` + `u32 big-endian sequence` + data. Channels: `1` microphone (device to PC, PCM16 LE mono
  16 kHz), `2` speech (PC to device, PCM16 LE mono, sample rate given in `tts.start`), `3` screen frame (PC to device,
  JPEG).

### 4.1 Messages every peer handles

| t | direction | fields | meaning |
| --- | --- | --- | --- |
| `ping` | both | `ts` | liveness; the receiver answers with `pong` echoing `ts` |
| `pong` | both | `ts` | the echoed `ts`; the PC uses it to show the link latency |
| `bye` | PC to device | `reason` (`replaced`, `forgotten`, `server_closing`) | the PC is closing this session |
| `error` | PC to device | `code`, optional `message` | `bad_code`, `not_pairing`, `wrong_kind` |

### 4.2 Device kinds and sessions

Every session is either a `quest` (headset) or a `watch`. The kind comes from `pair.kind` / `pair.device.kind`, then from
the model prefix (`Quest…` is a headset, `Galaxy Watch…` / `Wear…` is a watch, anything else counts as a headset). On
`resume` it comes from `auth.kind` / `auth.model`, then from the stored device record. Clients send both `kind` and
`model`.

The PC keeps **one session per kind**: one headset and one watch can be connected at the same time. When a second
device of the same kind finishes its handshake, the older one gets `bye: replaced`; a device of the other kind is not
affected. The discovery broadcast (§5) stops only while a headset is connected, so a headset can still find the PC while
the watch is connected.

### 4.3 Reserved version 1 messages

Protocol version 1 also defines the messages below for a voice, approval and screen-sharing client. The headset app may
send them, but the desktop plugin in this repository does not implement them yet: a PC that does not handle a message
ignores it. They are listed so that implementations stay compatible.

Device to PC: `snapshot` (request full state), `voice.start` (`sr`, followed by channel 1 frames), `voice.end`,
`voice.cancel`, `chat.text` (`text`), `speech.stop`, `approval.answer` (`id`, `approve`), `stop` (emergency stop),
`screen.start` (`maxW` up to 1920, `fps` up to 10), `screen.stop`, `screen.click` (`x`, `y` in 0..1 of the frame,
`button` `left`/`right`, `double`), `pairing.forget`.

PC to device: `state` (`voice`, `authority`, `stopped`, `muted`), `level` (`v` 0..1, at most 15 per second),
`transcript` (`turnId`, `role`, `text`, `final`; the full text is resent each time), `tts.start` (`turnId`, `sr`, followed
by channel 2 frames), `tts.end`, `dashboard` (`cards`), `notify` (`id`, `title`, `body`, `level`), `approval`
(`id`, `title`, `detail`, `tool`, `kind`), `approval.closed` (`id`, `outcome`), `memory` (`items`), `claude`
(`sessions`), `screen.info` (`w`, `h`, `display`, followed by channel 3 frames), `screen.denied` (`reason`), `stopped`
(`reason`).

Any implementation of these must keep the rules of §6: device requests go through the same approval gate as every other
request, and `approval.answer` is accepted only from an authenticated session and only for an approval that is open.

## 5. Pairing

- On the PC, the **VR** page (headset) or the **Watch** page (watch) opens a pairing window for 5 minutes and shows a QR
  code and a 6-digit PIN. The window accepts only the device kind of the page that opened it.
- QR content (byte mode, error correction M, version 10 at most, so at most 213 bytes):
  `fuberxr:1?h=<ip1>,<ip2>&p=47852&f=<fp>&c=<secret: 16 bytes base64url>&n=<PC name, URL-encoded>`. At most 4 addresses;
  if the content is too long the PC drops addresses first (keeping at least one), then shortens the name.
- The device reads the QR code, tries the addresses in order (2 seconds each) and runs the `pair` handshake.
- **Fallback when the QR code cannot be read:** the PC broadcasts `{"fuberxr":1,"name":"…","p":47852,"f":"<fp>","pairing":true|false}`
  on UDP 47853, every 2 seconds while a pairing window is open and every 5 seconds otherwise, only on private IPv4
  interfaces and only while no headset is connected. The device lists the PCs it hears; the user picks one and types the
  PIN. The fingerprint then comes from the broadcast: someone else on the same network could broadcast a fake one. They
  cannot pair with the real PC without the PIN, but they could make the user connect to them, so the device shows the PC
  name and the first 4 characters of the fingerprint, and the pairing window on the PC shows the same 4 characters.

## 6. Security rules (PC side)

- The bridge never bypasses the approval gate. Whatever a device asks for goes through the same tools and authority
  checks as a spoken or typed request. In this release a device can only change the HUD view (§7.3) and trigger the
  emergency stop.
- Only paired, authenticated sessions can send messages; `pair` is rejected while no pairing window is open.
- Screen streaming, once implemented, must not show content-protected windows; Private mode and the emergency stop end
  it.
- The `xr` module opens its ports only while it is enabled. It is enabled by default once the plugin is installed and
  can be turned off in the management app (Modules).

## 7. JARVIS HUD

The core app (`apps/desktop/src/main/modules/jarvis`) does not know about devices. It publishes a `HudSnapshot` every
second on the `jarvis.snapshot` bus event and device messages on `jarvis.device`, and accepts `jarvis.deviceMessage`.
The plugin (`desktop/modules/xr/hud-forward.ts`) translates between those events and the bridge.

### 7.1 PC to headset (only to `quest` sessions)

- `{"t":"hud.snapshot","seq":n,"data":HudSnapshot}`: right after the headset connects, immediately when the snapshot
  changes, and at least every 5 seconds when it does not.
- `{"t":"hud.voice","state":"idle"|"listening"|"thinking"|"speaking","level":0..1}`: while listening or speaking, about
  15 times a second, with `level` derived from the real RMS of the microphone or of the speech output (never invented);
  once with `level: 0` when the state becomes `thinking` or `idle`.
- `{"t":"hud.log","entry":LogEntry}`: a new real event for the assistant log (§7.5).

### 7.2 Headset behaviour

- A section whose `status` is `off` (or that is missing) is shown as "not connected" and never with invented numbers.
- If the last snapshot is older than 12 seconds or the bridge is down, every panel is shown as stale (dimmed, with the
  last real values).
- When `hud.voice` is missing for 2 seconds the headset follows `snapshot.voice.state`; on disconnect it returns to idle.
- Palette changes are animated (about 1.5 seconds), so the PC does not change the palette more often than every few
  seconds (it applies hysteresis, see `paletteMode`).

### 7.3 Headset to PC

| message | effect on the PC |
| --- | --- |
| `{"t":"hud.action","action":"tab","tab":"overview"\|"workshop"\|"comms"}` | switches the HUD tab; other tab names are ignored |
| `{"t":"hud.action","action":"palette","palette":"cyan"\|"blue"\|"ember"\|"ice"\|"auto"}` | a colour sets `paletteMode: "manual"`; `auto` returns to the automatic palette |
| `{"t":"hud.action","action":"focus","sym":"BTC"}` | focuses a market symbol that is in the watch list |
| `{"t":"hud.action","action":"open","ref":"…"}` | `cal:<id>` opens the planner, `notice:<id>` opens Today, `job:<id>` opens Jobs; only items with a `ref` have an active button |
| `{"t":"hud.action","action":"stop"}` | emergency stop, the same as the app's own |

Palette and tab are stored on the PC, so a change made on the headset also shows on the desktop and the other way
round.

### 7.4 Watch to PC (only from `watch` sessions; handled by the `jarvis-watch` plugin)

- `{"t":"bio.sample","ts":<ms epoch of the measurement>,"hr":73,"hrAcc":"high"|"medium"|"low","steps":5421,"kcal":312}`.
  Every field except `t` is optional and absent when not measured; `spo2`, `skinTemp`, `ibi` (array of ms) and
  `sleepMin` are also accepted. `steps` and `kcal` are daily totals. The watch measures passively, so samples arrive
  minutes apart and may come in batches (oldest first, at most 30).
- `{"t":"bio.status","worn":true|false,"battery":0..100,"measuring":true|false}`: when something changes and at least
  every 15 seconds while connected. Without `worn` or `measuring` no heart rate is sent.

The Watch page shows the last real heart rate with its age: `live` up to 20 minutes after the last real sample, `stale`
up to 2 hours, then `off`. Connecting or disconnecting the watch never produces a notification or a sound.

### 7.5 HudSnapshot

The type lives in `apps/desktop/src/main/modules/jarvis/types.ts`; all fields marked optional may be absent.

```ts
type Status = 'ok' | 'stale' | 'off'; // off: the source is unavailable; the client shows "not connected"

interface HudSnapshot {
  ts: number;                                   // ms epoch
  seq?: number;                                 // increasing; lets the client notice a missed frame
  node?: string;                                // computer name
  greeting: string;                             // "Günaydın, efendim."
  summary: string;                              // one sentence, Turkish
  attention?: number;                           // number of items waiting for the user
  palette: 'cyan' | 'blue' | 'ember' | 'ice';   // always the palette in effect
  paletteMode?: 'auto' | 'manual';              // auto: calm=ice, normal=cyan, busy=blue, critical=ember
  load?: { score: number; level: 'calm' | 'normal' | 'busy' | 'critical'; reasons: string[] }; // score 0..100
  tab: 'overview' | 'workshop' | 'comms';
  voice?: { state: 'idle' | 'listening' | 'thinking' | 'speaking'; text?: string }; // text: last spoken sentence, at most 160 characters
  clock: { time: string; date: string; tz: string; place: string };
  env: {
    status: Status; place: string; lat: number; lon: number; tempC: number; condition: string; windKmh: number;
    windDir: string; humidity: number; visibilityKm: number; uv?: number; hourly: { time: string; tempC: number }[];
    source?: 'settings' | 'ip' | 'timezone' | 'none'; feelsC?: number; rainPct?: number; fetchedAt?: number;
  };
  cal: {                                        // planner reminders and today's or overdue todos
    status: Status; nextInSec: number | null;
    items: { ref: string; time: string; title: string; place: string; current: boolean; at?: number; kind?: 'event' | 'todo' }[];
    hint?: string;                              // shown when there is no timed event today
    eventCount?: number;
  };
  core: {                                       // this computer's load
    label: string; value: string; unit: string; sub: string; // value is always a string ("37")
    cpu: number; gpu: number | null; ram: number; vram: number | null; tempC: number | null; // percent; null = not readable
    tempSource?: 'gpu' | 'cpu' | null; gpuName?: string | null;
    cpuSeries?: number[]; gpuSeries?: number[]; ramSeries?: number[]; // up to 60 samples
    ramUsedGb?: number; ramTotalGb?: number; vramUsedGb?: number | null; vramTotalGb?: number | null;
    cores?: number[]; uptimeSec?: number;
  };
  fin: {
    status: Status; marketOpen: boolean; focus: string; fetchedAt?: number;
    items: { sym: string; name: string; price: number; currency: string; changePct: number; series: number[]; open?: boolean; source?: 'binance' | 'yahoo' }[];
  };
  links: {                                      // TCP latency to public endpoints and to the management service
    status: 'ok'; linked: number; total: number;
    items: { id: string; name: string; kind: 'server' | 'service'; detail: string; latencyMs: number | null; quality: number; up: boolean }[]; // quality 0..1
  };
  log: LogEntry[];                              // newest first, at most 20
  jobs?: { id: string; title: string; moduleId: string; status: 'queued' | 'running'; startedAt: string | null }[]; // ref for "open": job:<id>
  notices?: { ref: string; ts: string; title: string; body: string; moduleId: string; pending: boolean; priority?: 'low' | 'normal' | 'high' | 'urgent' }[];
  // Added by the plugin so that the headset app can parse every section it knows; always "off" in this release:
  bio: { status: 'off'; source: 'none'; worn: false; battery: null; hr: null; hrSeries: []; spo2: null; steps: null;
         kcal: null; skinTemp: null; stress: null; sleepMin: null; lastSampleAgoSec: null };
}

interface LogEntry {
  ts: string;                                   // local time, HH:MM:SS
  tag: string;                                  // ENV, MSG, FIN, CAL, SYS; plugins may add their own
  text: string;
  ref?: string;                                 // set only for entries that come from a notice or a job
}
```

Notes for client authors:

- The core has three tabs (`overview`, `workshop`, `comms`). Tab actions with other names are ignored.
- `bio` is a placeholder: the core does not fill it. Heart rate is shown on the Watch page of the `jarvis-watch`
  plugin, not in the HUD.
- `links.items` contains no device entries.
- `hud-snapshot-ornek.json` is a fictional sample message used by the Unity parser tests. It fills every section the
  client can draw, including `bio`, which the core leaves `off`.
