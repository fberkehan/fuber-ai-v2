/**
 * Eklenti sayfasının güvenli kutuya yüklenecek tam belgesi. Sayfa `iframe sandbox="allow-scripts"` içinde, opak
 * kökenle koşar: uygulamanın IPC'sine, üst pencereye ve depolamaya erişemez. Ağ, belgenin başına yazılan içerik
 * güvenlik politikasıyla kapalıdır. Eklentiyle tek bağı `window.fuber` köprüsüdür: üst pencereye ileti gönderir,
 * kabuk iletileri `plugins.*` kanallarına çevirir ve ana süreç her isteği eklentinin manifestine göre karşılar.
 */

/** Ağ yok; yalnız satır içi betik/stil ve gömülü görsel. Sahne mini uygulamalarıyla aynı politika. */
export const PAGE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; form-action 'none'; base-uri 'none'";

/** Uygulamanın koyu temasına oturan temel stil ve sayfaların kullanabileceği değişkenler. */
export const PAGE_BASE_STYLE =
  ':root{color-scheme:dark;--fg:#f5f5f7;--muted:#a1a1aa;--line:rgba(255,255,255,.1);--surface:rgba(255,255,255,.05);' +
  '--accent:#7c9cff;--good:#4ade80;--warn:#fbbf24;--bad:#f87171;--radius:14px}' +
  'html,body{margin:0;min-height:100%;background:transparent;color:var(--fg);' +
  'font:14px/1.5 "Segoe UI Variable","Segoe UI",system-ui,sans-serif}' +
  'body{padding:24px;box-sizing:border-box}' +
  'button{font:inherit;color:var(--fg);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:8px 14px;cursor:pointer}' +
  'button:hover{background:rgba(255,255,255,.1)}button:active{transform:scale(.98)}' +
  'input,select,textarea{font:inherit;color:var(--fg);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:8px 10px}';

/**
 * Sayfadaki `window.fuber`. İstekler üst pencereye `{ fuberPlugin: 1, id, op, … }` olarak gider; yanıt aynı `id` ile
 * `{ fuberPlugin: 1, id, ok, value | error }` olarak döner (`types.ts` › `PluginFrameRequest`, `PluginFrameReply`).
 *  - fuber.call(araç, girdi)         → { ok, text, data? }   (yalnız bu eklentinin araçları; `danger` araç çağrılamaz)
 *  - fuber.storage.get/set/delete    → eklentinin `ctx.storage` deposu
 *  - fuber.settings.get(anahtar)     → eklenti ayarının değeri
 */
export const PAGE_BRIDGE_SCRIPT = `(function(){
  var seq = 1, waiting = {};
  addEventListener('message', function (event) {
    if (event.source !== parent) return;
    var data = event.data;
    if (!data || data.fuberPlugin !== 1 || typeof data.id !== 'number') return;
    var entry = waiting[data.id];
    if (!entry) return;
    delete waiting[data.id];
    if (data.ok) entry.resolve(data.value); else entry.reject(new Error(String(data.error || 'istek başarısız')));
  });
  function ask(op, extra) {
    return new Promise(function (resolve, reject) {
      var id = seq++;
      waiting[id] = { resolve: resolve, reject: reject };
      var message = { fuberPlugin: 1, id: id, op: op };
      for (var key in extra) message[key] = extra[key];
      try { parent.postMessage(message, '*'); } catch (error) { delete waiting[id]; reject(error); }
    });
  }
  // Kabuğun yanıt biçimi (renderer/main/plugins/frame-protocol.ts): call → { text, data } (araç ok:false ise hata),
  // storage.get → değer ya da null, storage.set/delete → true, settings.get → değer ya da null.
  var api = {
    call: function (tool, input) {
      return ask('call', { tool: String(tool), input: input === undefined ? {} : input }).then(
        function (out) {
          var result = { ok: true, text: String(out && out.text !== undefined ? out.text : '') };
          if (out && out.data !== undefined && out.data !== null) result.data = out.data;
          return result;
        },
        function (error) { return { ok: false, text: String(error && error.message ? error.message : error) }; }
      );
    },
    storage: {
      get: function (key) { return ask('storage.get', { key: String(key) }).then(function (out) { return out === null ? undefined : out; }); },
      set: function (key, value) { return ask('storage.set', { key: String(key), value: value === undefined ? null : value }).then(function () {}); },
      delete: function (key) { return ask('storage.delete', { key: String(key) }).then(function (out) { return out === true; }); }
    },
    settings: { get: function (key) { return ask('settings.get', { key: String(key) }).then(function (out) { return out === null ? undefined : out; }); } }
  };
  Object.freeze(api.storage); Object.freeze(api.settings);
  Object.defineProperty(window, 'fuber', { value: Object.freeze(api), writable: false, configurable: false });
})();`;

const escapeText = (text: string) => text.replace(/[<&>]/g, (char) => (char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&amp;'));

/** Eklentinin HTML'ini politika, temel stil ve köprüyle sarar. Politika ve köprü, eklentinin içeriğinden ÖNCE gelir. */
export function pageDocument(html: string, options: { title: string }): string {
  return (
    `<!doctype html><html lang="tr"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">` +
    `<title>${escapeText(options.title)}</title>` +
    `<style>${PAGE_BASE_STYLE}</style>` +
    `<script>${PAGE_BRIDGE_SCRIPT}</script>` +
    `</head><body>${html}</body></html>`
  );
}
