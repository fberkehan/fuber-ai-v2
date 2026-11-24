> **This branch is O.R.I.O.N. v1, first released as Fuber AI v1 (0.18.2).** It is the archived first generation of the O.R.I.O.N. desktop assistant, licensed under Apache-2.0. The current public line is on the [`v2`](https://github.com/fberkehan/orion/tree/v2) branch (default branch of this repository).

# Fuber AI v1

A local-first personal AI assistant for the Windows desktop. Fuber AI keeps your memory and chats on your own computer, works with your files,
email and documents, listens and talks, and runs on **your own** model: a local model, your own Claude (Anthropic) key, or any OpenAI-compatible
provider (OpenAI, OpenRouter, a local Ollama or LM Studio server).

> **Status: v1 is archived.** This repository is the open-source release of the first generation of Fuber AI (version 0.18.2).
> **Fuber AI v3 is the commercial successor.** v1 receives no new features; security reports are still welcome (see [SECURITY.md](SECURITY.md)).

This release is **fully self-contained**: there is no Fuber server, account system, phone relay, telemetry, update feed or licence check in the
code. The only network traffic is to the provider you configure, the services you connect yourself (IMAP/SMTP, MCP servers, weather and news
feeds) and one-time downloads of local models you ask for.

## What it does

- **Chat with memory.** Conversations, notes and long-term memory live in a local SQLite database under `%APPDATA%\Fuber AI`.
- **Bring your own model.** Claude (Anthropic API key), any OpenAI-compatible API, or a model running on your computer. Keys are stored
  encrypted with Windows DPAPI (Electron `safeStorage`) and are never shown again in the UI.
- **Private mode** (*Gizli*) and **This computer only** (*Yalnız bu bilgisayar*): nothing is sent to any cloud model, not even with your own key.
- **Voice.** Wake word ("Hey Fuber"), dictation and spoken replies; recognition and fallback voice run locally (Vosk, sherpa-onnx, Whisper, Piper).
- **Agent tools** with permission gates: files, documents (read PDF/Word/Excel, write `.docx`, `.xlsx`, `.pptx`), a built-in browser, web search
  and page reading, commands (developer mode), computer control through native Windows helpers.
- **Claude Code page.** Drive your locally installed `claude` CLI sessions from the app.
- **Dashboard** (*Kokpit*): morning summary, reminders, email that needs you (IMAP), weather, news, markets.
- **Meetings.** Local live transcription and summaries (Whisper), optional Gemini transcription with your own key.
- **MCP.** Connect your own MCP servers (stdio or HTTP, including OAuth with dynamic registration).

## Requirements

- Windows 10 or 11, x64
- Node.js 22.18 or newer (24 LTS recommended) and npm
- Optional, to build the native helpers: the .NET Framework 4 C# compiler (ships with Windows) and, for `fuber-olay.exe`,
  Visual Studio Build Tools with the Windows SDK
- Optional: the [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI for the Claude Code page

## Quick start

```powershell
npm ci
node node_modules/electron/install.js   # downloads the Electron binary (about 200 MB)
npm run build                           # main process (esbuild) + renderer (Vite) into dist/
npm run dev                             # build and open the app
```

On first launch the setup wizard asks for your name and preferences. To give the assistant a brain:

1. **Claude:** *Settings → AI provider → Claude*, paste your Anthropic API key and press *Test connection*.
2. **OpenAI-compatible:** *Settings → AI provider → Your own provider (developer mode)*: set the base URL (OpenAI, OpenRouter, or
   `http://127.0.0.1:11434/v1` for Ollama, `http://127.0.0.1:1234/v1` for LM Studio), the model name and, for hosted services, the key.
3. **Local model:** *Settings → Privacy → Where should it run → This computer*. The app downloads a small local model on request.

Keys can also be provided to development builds through `FUBER_SIR_API_ANTHROPIC` / `FUBER_SIR_API_OPENAI` environment variables; these are ignored
by installed builds.

Native helpers (screen capture, input, system events) are not committed. Build them once:

```powershell
node native/derle.mjs        # resources/bin/fuber-girdi.exe
node native/derle.mjs olay   # resources/bin/fuber-olay.exe (needs MSVC)
```

The app starts without them; computer-control and system-event features stay off until they exist.

### Large assets

`resources/vosk/tr.tar.gz` (37 MB, Turkish Vosk model `vosk-model-small-tr-0.3`, Apache-2.0; source in `resources/vosk/README.md`) and
`resources/uyandirma/` (wake-word runtime and model) are committed. Piper voices, Whisper models and local language models are downloaded at
run time on request and are **not** part of this repository; check each model's licence before use. The fallback voice, Piper `tr_TR-dfki-medium`,
is trained on the DFKI OT dataset under **CC BY-NC-SA 4.0 (non-commercial)**; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Development

```powershell
npm run typecheck   # tsc --noEmit
npm test            # node:test suite: pure unit tests, no network, no windows, no sound
```

`npm test` runs every `tests/*.test.ts`. Pass node:test arguments after `--`, for example `npm test -- --test-name-pattern=hafiza`.

Package an installer for your own build:

```powershell
npm run dist        # release/Fuber AI Kurulum <version>.exe (needs the native helpers; unsigned)
```

The build is unsigned; Windows SmartScreen will warn. Sign it with your own certificate if you distribute it.

## Architecture

| Path | Contents |
|---|---|
| `src/main/` | Electron main process: agent loop (`ajan/`), tools, memory, providers (`motor/`), local models (`yerel/`), voice (`ses/`), meetings, integrations |
| `src/renderer/` | React UI: pages (`sayfalar/`), setup wizard (`kurulum2/`), settings (`ayarlar/`), design system (`ui/`) |
| `src/shared/` | Pure, unit-tested rules shared by main and renderer |
| `src/preload/` | Context-isolated preload bridges (an explicit channel allow-list in `src/shared/kanallar.ts`) |
| `tests/` | `node:test` suites |
| `native/` | C# and C++ helpers for input, screen and system events (built locally, not committed as binaries) |
| `resources/` | Wake-word model, Vosk model, fonts, icons and licences packaged next to the app |
| `scripts/` | Build, packaging and preview scripts |

Identifiers and comments are mostly Turkish. A short glossary: *hafıza* memory · *sohbet* chat · *kokpit* dashboard · *motor* model provider ·
*yerel* local · *Gizli* private mode · *ayarlar* settings · *kurulum* setup · *araç* tool · *iş* task / business mode.

Security model in brief: the renderer is sandboxed with context isolation; only channels listed in `src/shared/kanallar.ts` reach the main
process; the installed build ignores environment overrides for service addresses; Electron fuses are set at packaging time; every tool that
changes something asks for approval according to the permission mode you choose.

## What is intentionally not included

Hosted online services (account, hosted models and voice, web-search proxy, OAuth broker, phone relay) and the WhatsApp module are not part of
this release. They are not needed to run this repository.

## Third-party models and licences

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `resources/**/LICENSE*`. Notable: Manrope (SIL OFL 1.1), sherpa-onnx wake-word model
(Apache-2.0), Vosk Turkish model (Apache-2.0). The `@anthropic-ai/claude-agent-sdk` package is distributed under Anthropic's own terms and is
installed from npm, not redistributed here.

## License

Licensed under the [Apache License, Version 2.0](LICENSE). Copyright 2026 Fuber AI. The Fuber name and logo are not covered by the
licence; see [TRADEMARKS.md](TRADEMARKS.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md). Questions and bug reports go
to [GitHub Issues](https://github.com/fberkehan/orion/issues); report vulnerabilities privately through GitHub's private vulnerability
reporting, not in public issues.

---

## Türkçe özet

Fuber AI v1, Windows için yerel öncelikli kişisel bir yapay zekâ asistanıdır. Hafızan ve sohbetlerin bu bilgisayarda durur; kendi modelinle
(yerel model, kendi Claude anahtarın ya da OpenAI uyumlu bir sağlayıcı) çalışır. **v1 arşivlenmiştir; ticari halef Fuber AI v3'tür.**
Kaynaktan derleme: `npm ci`, `node node_modules/electron/install.js`, `npm run build`, `npm run dev`. Lisans: Apache-2.0.
