# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

- Report privately through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose
  **Report a vulnerability** (<https://github.com/fberkehan/orion/security/advisories/new>).
- Include the version (Settings → About), Windows version, steps to reproduce, impact and, if you have one, a proof of concept.
- Do not include other people's personal data. Do not test against accounts you do not own.

The project is maintained by a small team, so these are targets, not guarantees: we aim to acknowledge reports within about **5 business days**, to share an
assessment within about **15 business days**, and to fix confirmed issues as soon as we reasonably can, ideally within **90 days**. We coordinate disclosure with you and credit you in the release notes unless you prefer otherwise.

## Scope

In scope: this desktop client — the Electron main process, preload bridges, renderer, local model and voice pipelines, the agent's tools and
their permission gates, the local data store, the build and packaging scripts.

Especially interesting:

- a way for web content, documents, email or tool output to run commands or read files without the user's approval;
- anything that makes *Private mode* send data to a cloud model;
- ways to redirect an installed build to an unintended address, or to load code into the installed app;
- leaks of stored keys or tokens (they are encrypted with Windows DPAPI and must never reach logs or the UI).

Out of scope: third-party services and models; issues that
need an already compromised Windows account or administrator rights; social engineering.

## Supported versions

Fuber AI v1 is archived. Only security fixes are considered, and only for this repository's latest state.

---

**Türkçe:** Güvenlik açığını herkese açık issue olarak açma. GitHub’ın gizli güvenlik bildirimini kullan: deponun **Security** sekmesi →
**Report a vulnerability**. Yaklaşık 5 iş günü içinde dönüş, en geç 90 gün içinde düzeltme hedeflenir (söz değil, hedef); üçüncü taraf hizmetler
kapsam dışıdır; açıklama seninle birlikte planlanır. v1 arşivdedir; yalnız güvenlik düzeltmeleri değerlendirilir.
