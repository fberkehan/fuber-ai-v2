# Architecture

npm workspaces monorepo: `apps/desktop`, `apps/admin`, `packages/shared`, `packages/control`, `packages/ui`.

## Processes (apps/desktop)

- **Main** (`src/main`): core services (policy, store, bus, scheduler, attention, tools, brain, conversation, voice
  session) and **modules**. Entry: `main.ts` -> `bootstrap.ts`.
- **Renderers** (`src/renderer`): `main` (the app window with pages), `hud` (always-on-top island, stage cards, computer-use
  overlay), `audio` (microphone capture and playback), `setup` (first run).
- **Workers**: `worker` (speech: wake word, VAD, Whisper, TTS), `tts-host` (GPU speech synthesis host), `skill-host`
  (sandbox for Workshop plugins), `doc-worker` (document parsing).

All renderer/main calls go through one typed IPC channel (`packages/shared/src/ipc.ts`); events use `events.ts`.

## Modules

A module is a folder `src/main/modules/<id>/index.ts` exporting `defineModule({ id, tools, ipc, migrations, setup,
teardown, windowEvents, page })`. Tools are the capabilities the brain can call (`defineTool`: zod input, risk
level `read | write | danger`, optional local-model group). Folder discovery generates
`modules/registry.gen.ts`, `ipc/handlers/index.gen.ts` and `i18n/tr/index.gen.ts` (`scripts/gen-index.mjs`); pages are
found with `import.meta.glob`. A module must also be listed in `BUILTIN_MODULE_IDS`
(`packages/shared/src/constants.ts`) so policy can enable it; plugin installers append there.

Built-in modules: voice-control, memory, planner, stage, projects, web, pc (computer use), workshop, ambient,
documents, import-v1, meeting, watch (background watchers), browser, mail, dashboard, news, briefing, selfdev, jarvis.

## Brain

`core/brain.ts` routes each turn to a provider chosen by the policy: Claude Code CLI (`brain/claude-code`), Anthropic API,
OpenAI-compatible endpoints (`brain/providers/openai-compatible.ts`) or a local llama.cpp server (`brain/llm-server.ts`).
Local models see a smaller, intent-routed tool set (`brain/local-tools.ts`); precise spoken commands are matched by
code first (`brain/local-commands.ts`, `brain/jarvis-mode-intent.ts`). Every tool call passes the approval gate
(`core/authority.ts`, `core/tools.ts`).

## Policy and the management app

Behaviour that users configure (keys, models, modules, limits) is a `Policy` document (`packages/shared/src/policy.ts`)
served by the local control service (`packages/control`, Hono on loopback, SQLite via `node:sqlite`). The management app
(`apps/admin`) edits it; the assistant polls it with a device token.

## JARVIS MODE

`modules/jarvis` produces a `HudSnapshot` every second (weather, calendar, system load, markets, link latency, assistant
log) and publishes `jarvis.snapshot` on the bus. The hidden page `renderer/main/pages/jarvis` draws it. The
`jarvis_mode` tool (and `routeJarvisMode` for the fast path) opens and closes it by voice; the page plays an iris
animation in and out. Device plugins listen to `jarvis.snapshot` / `jarvis.device` and send `jarvis.deviceMessage`.

## Plugins

See [`plugins/README.md`](../plugins/README.md). Workshop plugins (assistant-written, sandboxed) are documented in
[`EKLENTI-API.md`](EKLENTI-API.md) (Turkish).

## Tests

Vitest unit tests live next to the code and use fakes for network, Claude CLI (`scripts/e2e/lib/fake-claude.mjs`),
audio and devices. `npm test` needs no keys.
