// Application identity constants (product name, Windows AppUserModelID, public project address). Pure module: no Electron, no I/O.
// Fuber AI v1 is fully local-first: there is no Fuber server, account, bridge, telemetry or update feed. The app talks only to
// the AI provider the user configures with their own key (Claude / OpenAI-compatible) or to a local model.

export interface Dagitim {
  /** Windows AppUserModelID = electron-builder appId (reverse domain name). */
  appId: string;
  /** Product name (window title, tray, data folder, shortcut). */
  urunAdi: string;
  /** Public project address (source, issues, private security reports); also the contact part of outgoing User-Agent strings. */
  depo: string;
}

export const DAGITIM: Readonly<Dagitim> = Object.freeze({
  appId: 'ai.fuber.masaustu',
  urunAdi: 'Fuber AI',
  depo: 'https://github.com/fberkehan/orion/tree/v1',
});
