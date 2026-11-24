# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Use GitHub's private vulnerability reporting
("Security" tab > "Report a vulnerability") on [the repository](https://github.com/fberkehan/orion/security).
Include the version, steps to reproduce and impact.
We aim to acknowledge reports within a week. There is no bug bounty.

## Supported versions

Only the latest commit on `main` is supported.

## Safety model (what to know before running it)

Fuber AI is an agent with real capabilities. Treat it like software that can act as you.

- **Computer use** (`pc` module): the assistant can read the screen through UI Automation, move the mouse, type,
  open apps, manage files and run commands. It is gated by an authority level, per-action approval cards,
  protected-window and sensitive-path rules, an emergency stop and a kill switch, but a malicious web page or document
  that reaches the model can still try to steer it. Leave computer use off if you do not need it.
- **Prompt injection**: text from web pages, e-mails and documents is wrapped as untrusted data and the dangerous
  tools require approval, but no mitigation is perfect. Do not point the assistant at hostile content with high authority.
- **Keys**: stored in the management app's database encrypted with the OS keystore (Electron `safeStorage`). If
  encryption is unavailable the key is refused, never stored in plain text.
- **Network**: no telemetry. Outbound requests go to the providers and sites you configure. Web fetches block private
  and loopback addresses (SSRF rules in `modules/web/net.ts`). Private mode stops all cloud calls.
- **Local control service**: binds to loopback only and requires a device token.
- **Workshop plugins**: assistant-written JavaScript runs in a separate process with no `require`, no shell and an
  allow-listed network; see `docs/EKLENTI-API.md`. Device plugins in `plugins/` are native code you install deliberately.
- **Self-development** (off by default, needs developer mode): the assistant may modify its own source through Claude
  Code and build an installer; every install needs your confirmation.

Known limits: builds are unsigned (SmartScreen warns), there is no update channel, and the speech models are
downloaded over HTTPS and verified by SHA-256 pinned in the source.
