// Gömülü tarayıcının araç çubuğu: uygulamanın IPC köprüsü OLMADAN çalışır. Ayrı bir görünümde, ayrı ve ağsız bir oturum
// bölümünde (`data:` sayfa) durur; düğmeler `jbctl:` adreslerine gider, ana süreç bu gezinimi `will-navigate` ile yakalayıp
// iptal eder ve eylemi uygular. Durum ana süreçten `render(...)` çağrısıyla gelir; sayfadan gelen başlık ve adres yalnız
// `textContent`/`value` ile yazılır (HTML olarak yorumlanmaz). Saf parçalar birim testli (`toolbar.test.ts`).

export const TOOLBAR_HEIGHT = 44;
export const CONTROL_SCHEME = 'jbctl:';

export type ToolbarAction =
  | { kind: 'back' | 'forward' | 'reload' | 'stop' | 'hide' | 'new_tab' }
  | { kind: 'go'; input: string }
  | { kind: 'tab'; no: number }
  | { kind: 'close_tab'; no: number };

/** `jbctl:` adresini eyleme çevirir; tanınmazsa `null`. */
export function parseToolbarUrl(raw: string): ToolbarAction | null {
  if (!raw.toLowerCase().startsWith(CONTROL_SCHEME)) return null;
  const rest = raw.slice(CONTROL_SCHEME.length).replace(/^\/\//, '');
  const [verb = '', query = ''] = rest.split('?');
  const params = new URLSearchParams(query);
  const no = Number.parseInt(params.get('no') ?? '', 10);
  switch (verb.replace(/\/$/, '')) {
    case 'back':
    case 'forward':
    case 'reload':
    case 'stop':
    case 'hide':
    case 'new_tab':
      return { kind: verb.replace(/\/$/, '') as 'back' };
    case 'go': {
      const input = (params.get('u') ?? '').slice(0, 2000);
      return input.trim() ? { kind: 'go', input } : null;
    }
    case 'tab':
      return Number.isInteger(no) && no > 0 ? { kind: 'tab', no } : null;
    case 'close_tab':
      return Number.isInteger(no) && no > 0 ? { kind: 'close_tab', no } : null;
    default:
      return null;
  }
}

export interface ToolbarState {
  url: string;
  canBack: boolean;
  canForward: boolean;
  loading: boolean;
  /** Jarvis bu tarayıcıyı şu an kullanıyor. */
  busy: boolean;
  step: string;
  tabs: Array<{ no: number; title: string; active: boolean }>;
  /** Sekme sınırı doldu ("+" kapalı). */
  full: boolean;
  labels: Record<'back' | 'forward' | 'reload' | 'hide' | 'newTab' | 'closeTab' | 'stop' | 'busy' | 'address', string>;
}

/** Araç çubuğunun sayfası (Canlı Siyah renkleri; dış kaynak yok). */
export function toolbarHtml(): string {
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0}
body{background:#0A0A0B;color:#F2F2F3;font:13px/1 "Segoe UI",system-ui,sans-serif;height:${TOOLBAR_HEIGHT}px;display:flex;align-items:center;gap:6px;padding:0 8px;border-bottom:1px solid rgba(255,255,255,.08);user-select:none;overflow:hidden}
a.b{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;padding:0 8px;border-radius:9px;color:#C9C9CE;text-decoration:none;background:transparent}
a.b:hover{background:#1D1D20;color:#fff}
a.b[aria-disabled=true]{opacity:.35;pointer-events:none}
input{flex:1 1 auto;min-width:120px;height:30px;border-radius:15px;border:1px solid rgba(255,255,255,.1);background:#111113;color:#F2F2F3;padding:0 12px;font:inherit;outline:none}
input:focus{border-color:#5B9BFF}
#tabs{display:flex;gap:4px;max-width:46%;overflow:hidden}
.t{display:inline-flex;align-items:center;gap:6px;max-width:170px;height:28px;padding:0 4px 0 10px;border-radius:9px;background:#111113;color:#A1A1A8}
.t.on{background:#1D1D20;color:#fff}
.t a{color:inherit;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t a.x{width:20px;text-align:center;border-radius:6px}
.t a.x:hover{background:#2A2A2E}
#busy{display:none;align-items:center;gap:8px;height:28px;padding:0 4px 0 12px;border-radius:14px;background:rgba(14,89,239,.18);color:#BFD5FF;white-space:nowrap;max-width:280px}
#busy.on{display:inline-flex}
#busy span{overflow:hidden;text-overflow:ellipsis}
#busy a{color:#fff;background:#0E59EF;border-radius:11px;padding:4px 10px;text-decoration:none}
</style></head><body>
<a class="b" id="back" href="jbctl:back">&#8592;</a>
<a class="b" id="forward" href="jbctl:forward">&#8594;</a>
<a class="b" id="reload" href="jbctl:reload">&#8635;</a>
<input id="addr" spellcheck="false" autocomplete="off">
<div id="tabs"></div>
<a class="b" id="newtab" href="jbctl:new_tab">+</a>
<div id="busy"><span id="step"></span><a id="stop" href="jbctl:stop"></a></div>
<a class="b" id="hide" href="jbctl:hide"></a>
<script>
const $ = (id) => document.getElementById(id);
$('addr').addEventListener('keydown', (e) => { if (e.key === 'Enter' && $('addr').value.trim()) location.href = 'jbctl:go?u=' + encodeURIComponent($('addr').value.trim()); });
let editing = false;
$('addr').addEventListener('focus', () => { editing = true; $('addr').select(); });
$('addr').addEventListener('blur', () => { editing = false; });
window.render = (s) => {
  const L = s.labels;
  $('back').title = L.back; $('forward').title = L.forward; $('reload').title = L.reload; $('newtab').title = L.newTab;
  $('hide').textContent = L.hide; $('stop').textContent = L.stop; $('addr').placeholder = L.address;
  $('back').setAttribute('aria-disabled', String(!s.canBack));
  $('forward').setAttribute('aria-disabled', String(!s.canForward));
  $('newtab').setAttribute('aria-disabled', String(s.full));
  if (!editing) $('addr').value = s.url;
  $('busy').className = s.busy ? 'on' : '';
  $('step').textContent = s.step ? L.busy + ': ' + s.step : L.busy;
  const tabs = $('tabs');
  tabs.textContent = '';
  for (const t of s.tabs) {
    const box = document.createElement('div'); box.className = 't' + (t.active ? ' on' : '');
    const a = document.createElement('a'); a.href = 'jbctl:tab?no=' + t.no; a.textContent = t.title || '…'; a.title = t.title;
    const x = document.createElement('a'); x.className = 'x'; x.href = 'jbctl:close_tab?no=' + t.no; x.textContent = '×'; x.title = L.closeTab;
    box.append(a, x); tabs.append(box);
  }
  return true;
};
</script></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
