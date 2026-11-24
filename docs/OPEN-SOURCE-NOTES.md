# Open-source notes

Fuber AI v1 (0.18.2) is published as a single-commit snapshot; earlier development history is not included.

## What was removed

Everything that depended on hosted online services (account, hosted models and voice, web-search proxy, OAuth broker, phone relay) was removed
together with internal tools and documents, so the app now runs only on the provider the user configures (Claude, any OpenAI-compatible API)
or on local models.

Also not included:

- The WhatsApp module: the WhatsApp connection is not in this release, and its gate stays closed without it.
- The Satoshi font: its licence forbids redistribution. The UI uses Manrope (SIL OFL 1.1).
- Compiled `.exe` helpers, `node_modules`, `dist` and `release`: build output (see `resources/bin/README.md`).
- Wake-word test recordings of unverified origin; the tests that used them were removed.

Telemetry, update checks and licence checks did not exist in the client and were not added. No secrets or personal data are included: test
values are obviously fake, personal names in comments and tests are fictional, local paths were generalised, and the repository was scanned
for key patterns, high-entropy strings, private addresses, user paths and personal names before publishing.

## Tests

Tests for removed features were deleted. Tests that need a fake model provider talk to a small fake OpenAI-compatible server
(`tests/yardimci/sahte-gecit.ts`, `tests/yardimci/openai-sahte.ts`). The suite runs offline and needs no keys.

## Kept on purpose

The Fuber AI name, logo, icons and characters stay (see `TRADEMARKS.md`). The assistant's name in the UI is still "Fuber"; the wake word is
"Hey Fuber". Questions go to GitHub Issues; security reports go through GitHub's private vulnerability reporting (see `SECURITY.md`).

## Known limitations

- Windows only (UI Automation, `SendInput`, Win32 helpers).
- Live streaming transcription for meetings needed a hosted service and is not available; meetings use local Whisper or your own Gemini key.
- Some user-visible texts still say "Fuber" where they mean "the assistant"; a few internal comments still describe the removed hosted features.
- The installer is unsigned.
