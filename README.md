# O.R.I.O.N.

**O.R.I.O.N.** (Optimized Reasoning & Intelligent Operations Network) is a personal AI assistant for the Windows desktop: it listens and talks, keeps its memory on your computer, works with your files, email and documents, and runs on the model you choose (local, your own Claude key, or any OpenAI-compatible provider). It is part of [FUBER AI](https://fuber.ai). Earlier generations were published under the name "Fuber AI"; the generations are kept here as branches.

| Generation | Branch | Tag | License | Status |
| --- | --- | --- | --- | --- |
| v1 (published as Fuber AI v1, 0.18.2) | [`v1`](https://github.com/fberkehan/orion/tree/v1) | [`v1-0.18.2`](https://github.com/fberkehan/orion/releases/tag/v1-0.18.2) | Apache-2.0 | archived |
| v2 (published as Fuber AI v2, 2.0.0-demo.16) | [`v2`](https://github.com/fberkehan/orion/tree/v2) (`main` is identical apart from this overview) | [`v2-2.0.0-demo.16`](https://github.com/fberkehan/orion/releases/tag/v2-2.0.0-demo.16) | FSL-1.1-ALv2 (source-available) | current public source |
| v3 | none | none | none | private alpha, not public |

The license of `main` is the one of v2 (FSL-1.1-ALv2); each branch carries its own `LICENSE`.

**Cloning on Windows:** the tree contains deep fixture paths, so enable long paths if checkout fails: `git clone -c core.longpaths=true https://github.com/fberkehan/orion.git`.

---

> **This branch is O.R.I.O.N. v2, first released as Fuber AI v2 (`2.0.0-demo.16`).** O.R.I.O.N. is the desktop assistant formerly published as Fuber AI. This generation is source-available under FSL-1.1-ALv2. The earlier generation is on the [`v1`](https://github.com/fberkehan/orion/tree/v1) branch.

# Fuber AI v2

A personal AI assistant for the Windows desktop, with a voice interface ("Hey Jarvis"), written in TypeScript
(Electron, React, Vite, Tailwind CSS). It ships together with **Fuber Management 2** (`apps/admin`), the small
control app where you enter your API keys and choose models.

> Status: pre-release source drop (version `2.0.0-demo.16`). The app is Windows-first and the user interface is in
> Turkish; there is no English locale yet. Contributions are welcome.

## License

Fuber AI v2 is **source-available** under the [Functional Source License 1.1, ALv2 Future License](LICENSE)
(`FSL-1.1-ALv2`): you may use, copy, modify and redistribute it for any purpose except a *Competing Use* (offering it
as a commercial product or service that substitutes for or replicates it). Each version converts to Apache 2.0 two
years after it is published. This is not an OSI-approved open-source license until that conversion happens.
The "Fuber AI" name and logo are not licensed for use (see the Trademarks clause).
Third-party components keep their own licenses, see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## What it does

- Voice assistant: wake word, local speech-to-text (Whisper), several text-to-speech engines, barge-in, echo handling.
- Brains you choose: Claude Code (your own `claude` CLI session), the Anthropic API, OpenAI-compatible providers
  (OpenAI, OpenRouter, Moonshot, custom endpoints) or a local model (llama.cpp + Qwen). You bring your own keys.
- Chat, a "Today" board, planner (reminders and todos), memory, projects with Claude Code sessions, documents
  (read, search, create), e-mail (IMAP/SMTP), meeting capture, ambient notes, browser and computer use, news and
  briefings, background watchers, self-development, and a Workshop where the assistant writes sandboxed plugins.
- **JARVIS MODE**: a hidden holographic full-screen HUD. There is no button for it: say *"Jarvis moduna geç"* /
  *"Jarvis mode on"* to enter and *"Jarvis modunu kapat"* / *"Jarvis mode off"* (or press Esc) to leave.

Not included on purpose: the hosted Fuber.ai service and its servers, and WhatsApp (its library is GPL-3.0). The
Quest 3 / Galaxy Watch bridges live in [`plugins/`](plugins) as optional "for JARVIS" plugins.

## Requirements

- Windows 11 x64 (PowerShell helpers, UI Automation, native input, NSIS installer). Other platforms may build but the
  runtime features (computer use, audio devices, tray, autostart) are Windows-only.
- Node.js 24 or newer.
- Optional: an NVIDIA GPU for local Whisper / llama.cpp / on-device speech synthesis.

## Quick start

```
npm ci
npm run typecheck
npm test            # unit tests only: no keys, no network, no GPU, no real devices
npm run build
npm run dev:admin   # start the management app and enter an API key (Anthropic, OpenAI, OpenRouter, ...)
npm run dev:desktop # start the assistant
```

`npm ci` downloads the Electron binary (`node node_modules/electron/install.js` runs it again if it was skipped).
Local models (Whisper, Piper, wake-word, VAD, speech synthesis, llama.cpp + Qwen) are not in the repository: the app
downloads them on demand with checksums (`packages/shared/src/local-models.ts`), or run
`node scripts/voice/prepare-models.mjs`.

## Keys and privacy

Keys are entered in the management app and stored encrypted with the operating system keystore. Nothing is sent
to the Fuber AI project: there is no telemetry and no update server. Requests go only to the providers you configure.
Ambient listening is off by default and its raw transcript is only ever processed by the local model. See
[SECURITY.md](SECURITY.md) for the safety model and the warning about computer use.

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/desktop` | The assistant (Electron main, renderer, HUD, voice worker, skill host) |
| `apps/admin` | Fuber Management 2 (keys, models, policy, devices) |
| `packages/shared` | Types, policy schema, i18n dictionary, IPC contracts |
| `packages/control` | Local control service used by the management app |
| `packages/ui` | Design system and components |
| `plugins/` | Optional device plugins ("for JARVIS"): `jarvis-quest`, `jarvis-watch` |
| `docs/` | [Architecture](docs/ARCHITECTURE.md) and the Workshop plugin API (`EKLENTI-API.md`, Turkish) |

Modules, IPC handlers, dictionaries and pages are discovered from folders (`scripts/gen-index.mjs`), so adding a
feature means adding a folder.

## Building an installer

`npm run dist:desktop` and `npm run dist:admin` produce NSIS installers with electron-builder. They are unsigned;
sign them with your own certificate. No release process or update channel is configured.

## Third-party models and services

Piper voices may carry non-commercial licenses (the default Turkish voice is CC BY-NC-SA 4.0), the speech synthesis
model has use restrictions (OpenRAIL-M) and the NVIDIA CUDA runtime has its own EULA. Check
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) before redistributing builds that include downloaded models.
"Jarvis" is the assistant's default persona name only; it is not affiliated with any third-party trademark owner.
Change it in the management app.

## Contributing, questions and security

Bug reports, questions and feature requests go to [GitHub Issues](https://github.com/fberkehan/orion/issues).
Report security problems privately through GitHub's private vulnerability reporting, never in a public issue
(see [SECURITY.md](SECURITY.md)). Contribution guidelines are in [CONTRIBUTING.md](CONTRIBUTING.md).
