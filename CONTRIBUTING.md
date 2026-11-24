# Contributing to Fuber AI

Thank you for helping. This document explains how to set up the project, what we expect from a change and how review works.

> **v1 is archived.** This repository is a snapshot of Fuber AI v1 (0.18.2). Bug and security fixes are welcome; new features go to
> Fuber AI v3. By submitting a pull request you agree that your contribution is licensed under the Apache License 2.0 (section 5 of the licence).

## Setup

```powershell
npm ci
npm test
npm run typecheck
npm run build
```

Windows 10/11 x64 and Node.js 22.18+ are required. `npm run dev` builds and opens the app with your real profile; for UI work prefer the
preview scripts in `scripts/dev/` (they run in a throw-away profile, off-screen).

## Rules for tests

- Tests use `node:test` and run TypeScript directly (`node --test`). Put new suites in `tests/<topic>.test.ts`.
- **No network.** Tests talk only to fake servers on `127.0.0.1` (see `tests/yardimci/ana-surec.ts`, `scripts/dev/sahte-*.mjs`).
- **No windows, notifications or sound.** Anything that starts Electron runs in background test mode (`FUBER_DEMO=1`, off-screen window).
- **No real `claude` CLI.** Use `scripts/dev/sahte-claude.mjs`.
- Never print secrets. Test keys must look obviously fake (contain `SAHTE`, `test` or `example`).
- Pure rules belong in `src/shared/` with unit tests; Electron-bound code in `src/main/` stays thin.

## Product rules you will meet in review

- **Private mode never goes to the cloud.** When *Gizli* or "only this computer" is on, no request may reach a cloud model, including the
  user's own key (`src/shared/tek-motor.ts`).
- **No hosted-service logic in the client.** There is no Fuber account, server, relay, telemetry or update feed in this repository; do not add one.
- **No secrets.** Provider keys, OAuth client secrets and personal data never go into this repository.
- **Installed builds ignore environment overrides** for service addresses (`src/shared/ortam-kapisi.ts`). Do not add runtime overrides.
- **Business-mode language.** Business mode (*İş*) avoids technical words (model, token, API…) in visible text
  (`src/shared/is-dili.ts`); developer details go to Developer mode.
- Turkish UI text uses the typographic apostrophe (’). Keep identifiers in the existing Turkish style; English comments are welcome.

## Pull requests

1. Open an issue first for larger changes, so we can agree on the approach.
2. Keep a PR focused: one behaviour change, with tests that fail before and pass after.
3. `npm test`, `npm run typecheck` and `npm run build` must pass.
4. Describe what changed and why, and how you verified it. Screenshots for UI changes.
5. Do not include brand assets you do not own, generated binaries, model files or personal data.

## Forks

You are welcome to build your own product on this code within the Apache-2.0 licence. Change the name, logo and icons (`src/shared/dagitim.ts`,
`electron-builder.yml`, `build/`, `resources/ikon/`). See [TRADEMARKS.md](TRADEMARKS.md).

---

**Türkçe özet:** `npm ci && npm test && npm run typecheck && npm run build`. Testler ağa çıkmaz, pencere açmaz, ses çıkarmaz. Gizli mod
asla buluta gitmez; bu depoda sunucu, hesap ve sır yoktur. Her PR tek bir davranış değişikliği ve onu kanıtlayan testle gelir. v1 arşivlenmiştir;
yeni özellikler Fuber AI v3'e gider.
