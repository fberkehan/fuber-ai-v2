// Sahte `claude` (yalnız test/önizleme; gerçek Claude Code ve ağ YOK). Üç kip:
//  1) Terminal yolu (eski): aldığı argümanları ve çalışma klasörünü FUBER_SAHTE_CLAUDE_KAYIT dosyasına yazar, çıkar.
//  2) Kısa alt komutlar: `auth status` (SAHTE_CC_AUTH: acik | kapali | bozuk; JSON'da bilerek fazladan alanlar var — Fuber yalnız
//     loggedIn/authMethod almalı), `auth login` (hemen çıkar), `agents --json` (SAHTE_CC_AJANLAR ya da '[]').
//  3) Agent SDK akış kipi (`--input-format stream-json`): SDK'nın stdio denetim protokolü — kaynağından okundu
//     (@anthropic-ai/claude-agent-sdk 0.3.310 sdk.mjs: ProcessTransport.initialize argümanları `--flag=değer`; Query.request
//     `{type:'control_request',request_id,request:{subtype}}` → `{type:'control_response',response:{subtype:'success'|'error',request_id,…}}`;
//     handleControlRequest: CLI'nin `can_use_tool` isteğine SDK `control_response` ile yanıt verir; `control_cancel_request`;
//     streamInput kullanıcı iletilerini `{type:'user',message,…}` satırları olarak yazar; stdin kapanınca CLI çıkar).
//     Senaryo kullanıcı metnindeki işaretle seçilir:
//       #durum            → "mod=… model=… oturum=…" metni
//       #yavas[:sn]       → sn saniye (varsayılan 30) akan metin; interrupt ile kesilir
//       #izin             → Bash "echo merhaba" (izin ister; oturum kuralı varsa sormaz)
//       #duzenle          → Edit ornek.txt (default modda sorar, acceptEdits/bypass'ta sormaz; dosyaya DOKUNMAZ)
//       #soru             → AskUserQuestion (seçenek kartı), yanıtı metinde yankılar
//       #arac             → Read + Grep (izinsiz)
//       #alt              → Task alt ajanı (iç içe Read, parent_tool_use_id)
//       #yapilacak        → TodoWrite
//       #hata             → hatalı sonuç (is_error)
//       #kredi | #girisyok | #ag | #ham401 | #limit → gerçek Claude Code hata biçimleri (asistan iletisi + is_error sonuç); SAHTE_CC_STDERR #cok'un stderr'i
//       #cok              → yarım metin, stderr'e not, çıkış kodu 3 (çökme)
//       #inat             → interrupt'ı ve stdin kapanmasını YOK SAYAR (kapanışta zorla öldürme sınanır)
//       #cokparca[:n]     → Read kartı + n (varsayılan 5000) parçalı metin + Grep kartı (döküm sınırı ve toplu yayın)
//       #modreddet        → bundan sonra set_permission_mode hata döner (mod düşürme başarısızlığı)
//       #gorev            → TaskCreate ×2 (tool_use_result ile kimlik), TaskUpdate, TaskList
//       #soru2            → iki soru (biri çoklu seçim) — yanıt doğrulaması
//       Görev 28 (arayüz önizlemesi, scripts/dev/claudecode-onizle.mjs):
//       #vitrin           → her araç kartı: TodoWrite, Read (cat -n), Grep, Glob, Edit (cat -n sonuçlu), Write, Bash (uzun çıktı),
//                           Task (iç içe Read + Grep + metin), WebFetch, genel MCP aracı, TaskCreate/TaskUpdate; Markdown yanıt
//       #izinfark         → çok satırlı Edit izni (fark önizlemesi; default modda sorar)
//       #ajanizin[:ms]    → alt ajanın içinde izin isteyen Bash (önünde 3, ardında 6 adım); izin ms sonra sorulur
//       #akis[:sn]        → sn saniye (varsayılan 5) düşünme + gerçekçi hızda akan Markdown (kare süresi ölçümü)
//       #uzun[:n]         → n Read kartı + arada metin (n=2500 → ~5 000 olay; sanallaştırma)
//       0.13 T12:
//       #arkaplan         → arka planda bir görev başlatır (task_started + background_tasks_changed) ve tur BİTER; görev sürer
//       #arkabit          → o görevi bitirir (task_notification + background_tasks_changed []) ve metin yazar
//       #ortam            → "sir=<n>": ortamda kaç FUBER_SIR_* değişkeni var (Fuber'in sırları Claude Code'a geçmemeli)
//       Analiz 11 Kas (bulgu 1, 2, 5):
//       #arkakabuk        → Bash run_in_background: tool_use + task_started (local_bash, arka planda) + "Output is being written to: <dosya>"
//                           sonucu; dosyaya ~300 ms'de bir satır yazar, tool_progress yollar; stop_task ile durur (task_notification stopped)
//       #onplan[:sn]      → ön planda Bash işi (task_started is_backgrounded:false) sn saniye (varsayılan 20) turu bekletir; background_tasks
//                           denetim isteği onu arka plana alır (task_updated + "running in the background" sonucu) ve tur biter
//       apply_flag_settings: { effortLevel } → #durum'daki efor değişir (SAHTE_CC_EFOR_RET=1 → bu istek hata döner: eski CLI)
//       SAHTE_CC_TAM_KIMLIK=1 → init'teki model takma adı gerçek Claude Code gibi TAM kimliğe çevrilir (claude-sonnet-4-5-20250929 …)
//       SAHTE_CC_API_KAYNAK (varsayılan 'none'; '-' = alan hiç yok) init'teki apiKeySource; SAHTE_CC_HESAP (JSON) accountInfo
//       (diğer)           → akışlı "Merhaba! …" yanıtı
//     SAHTE_CC_PID_DOSYASI verilirse PID oraya eklenir (kapanışta süreç kalmadığı denetlenir).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
if (process.env.FUBER_SAHTE_CLAUDE_KAYIT) {
  try { fs.appendFileSync(process.env.FUBER_SAHTE_CLAUDE_KAYIT, `${JSON.stringify({ argv, cwd: process.cwd() })}\n`); } catch { /* kayıt en iyi çaba */ }
}
if (process.env.SAHTE_CC_PID_DOSYASI) {
  try { fs.appendFileSync(process.env.SAHTE_CC_PID_DOSYASI, `${process.pid}\n`); } catch { /* yok */ }
}

if (argv[0] === 'auth' && argv[1] === 'status') {
  // SAHTE_CC_AUTH_YAVAS_MS: durum geç gelir (önizleme: seçim okunana dek sihirbazın "Devam"ı kapalı mı).
  if (process.env.SAHTE_CC_AUTH_YAVAS_MS) await new Promise((r) => setTimeout(r, Number(process.env.SAHTE_CC_AUTH_YAVAS_MS)));
  const d = process.env.SAHTE_CC_AUTH || 'acik';
  if (d === 'bozuk') process.stdout.write('durum okunamadı\n');
  else process.stdout.write(`${JSON.stringify({ loggedIn: d === 'acik', authMethod: d === 'acik' ? 'claude.ai' : 'none', email: 'gizli@ornek.test', orgName: 'Gizli Kuruluş', subscriptionType: 'max', token: 'sk-ant-' + 'SAHTE-ASLA-GORUNMEMELI' }, null, 2)}\n`);
  process.exit(d === 'acik' ? 0 : 1);
}
if (argv[0] === 'auth' && argv[1] === 'login') process.exit(0);
if (argv[0] === 'agents') { process.stdout.write(`${process.env.SAHTE_CC_AJANLAR || '[]'}\n`); process.exit(0); }
// Görev 29: `plugin …` ve `mcp …` (eklenti kurulumu, katalog, MCP listesi) — ayrı dosyada (scripts/dev/sahte-claude-eklenti.mjs).
if (argv[0] === 'plugin' || argv[0] === 'mcp') { const { eklentiKomutu } = await import('./sahte-claude-eklenti.mjs'); process.exit(await eklentiKomutu(argv)); }
if (!argv.includes('--input-format')) process.exit(0); // terminal yolu: yalnız kayıt

// ── Agent SDK akış kipi ─────────────────────────────────────────────────────────────────────────────────────────────────
const bayrak = (ad) => {
  const a = argv.find((x) => x === ad || x.startsWith(`${ad}=`));
  if (!a) return undefined;
  if (a.includes('=')) return a.slice(ad.length + 1);
  const s = argv[argv.indexOf(a) + 1];
  return s && !s.startsWith('--') ? s : true;
};
let model = typeof bayrak('--model') === 'string' ? bayrak('--model') : 'claude-sahte-varsayilan';
let mod = typeof bayrak('--permission-mode') === 'string' ? bayrak('--permission-mode') : 'default';
let efor = typeof bayrak('--effort') === 'string' ? bayrak('--effort') : '-';
// Gerçek Claude Code: supportedModels takma ad döner, her turun init'i ise çözülmüş tam kimliği taşır (analiz 11 Kas bulgu 2).
const TAM_KIMLIK = { opus: 'claude-opus-4-5-20251101', sonnet: 'claude-sonnet-4-5-20250929', haiku: 'claude-haiku-4-5-20251001', default: 'claude-opus-4-5-20251101', 'claude-sahte-varsayilan': 'claude-opus-4-5-20251101' };
const initModeli = () => (process.env.SAHTE_CC_TAM_KIMLIK === '1' ? TAM_KIMLIK[model] ?? model : model);
const kismi = argv.includes('--include-partial-messages');
const resume = bayrak('--resume');
const catal = argv.includes('--fork-session');
const oturum = typeof resume === 'string' && !catal ? resume : randomUUID();
const izinStdio = argv.some((x) => x === '--permission-prompt-tool=stdio');
// oturum kuralları (updatedPermissions, destination 'session'). Son dalga B düzeltme turu: SAHTE_CC_KURALLAR (JSON dizi, ör.
// '[{"toolName":"Bash"}]') kullanıcının ayarlarındaki allow kurallarını taklit eder — kural araç için izni SORMADAN verir.
const kurallar = (() => { try { const k = JSON.parse(process.env.SAHTE_CC_KURALLAR || '[]'); return Array.isArray(k) ? k : []; } catch { return []; } })();
// SDK kancaları (initialize isteğindeki `hooks`: olay → [{ matcher, hookCallbackIds }]); PreToolUse her izinli araçtan ÖNCE sorulur
// (gerçek Claude Code gibi: 'deny' reddeder, 'ask' kurala/moda bakmadan can_use_tool'a sorar, 'allow' sormadan geçer).
let kancalar = {};
let inat = false;
let modReddet = false;
let toplamMaliyet = 0;
const arkaGorevler = new Map(); // #arkaplan / #arkabit: süren arka plan görevleri (görev kimliği → bilgi)
const arkaKabuklar = new Map(); // #arkakabuk / #onplan: görev kimliği → { z: zamanlayıcı, dosya, id }
let onPlandaki = null; // #onplan: ön plandaki iş (background_tasks onu arka plana alır)

const yaz = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const uuid = () => randomUUID();
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const bekleyenYanit = new Map();
let turIptal = null; // { iptal: boolean, uyandir?: () => void }

const KOMUTLAR = [
  { name: 'compact', description: 'Konuşmayı özetleyip bağlamı küçültür', argumentHint: '', builtin: true },
  { name: 'clear', description: 'Konuşmayı temizler', argumentHint: '', builtin: true },
  { name: 'sahte-beceri', description: 'Kullanıcı becerisi (sahte)', argumentHint: '<dosya>' },
];
const hesapBilgisi = () => { try { return JSON.parse(process.env.SAHTE_CC_HESAP || '{}'); } catch { return {}; } };
// SAHTE_CC_MODELLER (JSON): supportedModels listesi (senaryo videosu gerçek adları gösterir).
const MODELLER = process.env.SAHTE_CC_MODELLER ? JSON.parse(process.env.SAHTE_CC_MODELLER) : [
  { value: 'default', displayName: 'Varsayılan', description: 'Sahte varsayılan model' },
  { value: 'claude-sahte-hizli', displayName: 'Hızlı', description: 'Sahte hızlı model' },
];

function denetimYaniti(request_id, response) { yaz({ type: 'control_response', response: { subtype: 'success', request_id, response } }); }
function denetimHatasi(request_id, error) { yaz({ type: 'control_response', response: { subtype: 'error', request_id, error } }); }

/** CLI → SDK denetim isteği (can_use_tool) ve yanıtını bekleme. */
function izinSor(arac, input, tool_use_id, ek = {}) {
  const request_id = uuid();
  return new Promise((coz) => {
    bekleyenYanit.set(request_id, coz);
    if (turIptal) turIptal.uyandir = () => { if (bekleyenYanit.delete(request_id)) coz({ behavior: 'deny', message: 'kesildi' }); };
    yaz({ type: 'system', subtype: 'session_state_changed', state: 'requires_action', uuid: uuid(), session_id: oturum });
    yaz({ type: 'control_request', request_id, request: { subtype: 'can_use_tool', tool_name: arac, input, tool_use_id, ...ek } });
  });
}

const kuralVar = (arac, icerik) => kurallar.some((r) => r.toolName === arac && (r.ruleContent === undefined || r.ruleContent === icerik));
function izinGerekir(arac) {
  if (arac === 'AskUserQuestion') return true;
  if (mod === 'bypassPermissions') return false;
  if (arac === 'Read' || arac === 'Grep' || arac === 'Glob' || arac === 'TodoWrite' || arac === 'Task') return false;
  if ((arac === 'Edit' || arac === 'Write') && mod === 'acceptEdits') return false;
  return true;
}

async function metinAkit(metin, ust = null) {
  const id = `msg_${uuid().replace(/-/g, '').slice(0, 20)}`;
  const parcalar = metin.match(/\S+\s*/g) ?? [metin];
  if (kismi) {
    yaz({ type: 'stream_event', event: { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: 12, output_tokens: 0 } } }, parent_tool_use_id: ust, uuid: uuid(), session_id: oturum });
    yaz({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, parent_tool_use_id: ust, uuid: uuid(), session_id: oturum });
    for (const p of parcalar) {
      if (turIptal?.iptal) break;
      yaz({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } }, parent_tool_use_id: ust, uuid: uuid(), session_id: oturum });
      await bekle(5);
    }
    yaz({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, parent_tool_use_id: ust, uuid: uuid(), session_id: oturum });
    yaz({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: parcalar.length } }, parent_tool_use_id: ust, uuid: uuid(), session_id: oturum });
    yaz({ type: 'stream_event', event: { type: 'message_stop' }, parent_tool_use_id: ust, uuid: uuid(), session_id: oturum });
  }
  yaz({ type: 'assistant', message: { id, type: 'message', role: 'assistant', model, content: [{ type: 'text', text: metin }], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: parcalar.length } }, parent_tool_use_id: ust, uuid: uuid(), session_id: oturum });
}

function aracKullan(ad, input, ust = null) {
  const id = `toolu_${uuid().replace(/-/g, '').slice(0, 20)}`;
  yaz({ type: 'assistant', message: { id: `msg_${uuid().replace(/-/g, '').slice(0, 20)}`, type: 'message', role: 'assistant', model, content: [{ type: 'tool_use', id, name: ad, input }], stop_reason: null, stop_sequence: null, usage: { input_tokens: 8, output_tokens: 4 } }, parent_tool_use_id: ust, uuid: uuid(), session_id: oturum });
  return id;
}
function aracSonucu(id, content, is_error = false, ust = null, tool_use_result = undefined) {
  yaz({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] }, parent_tool_use_id: ust, uuid: uuid(), session_id: oturum, timestamp: new Date().toISOString(), ...(tool_use_result !== undefined ? { tool_use_result } : {}) });
}

/** CLI → SDK kanca geri çağrısı (hook_callback) ve yanıtı. */
function kancaSor(callback_id, input, tool_use_id) {
  const request_id = uuid();
  return new Promise((coz) => {
    bekleyenYanit.set(request_id, coz);
    yaz({ type: 'control_request', request_id, request: { subtype: 'hook_callback', callback_id, input, tool_use_id } });
  });
}
/** PreToolUse kancalarının kararı ('deny' | 'ask' | 'allow' | null). */
async function onKanca(ad, input, tool_use_id) {
  for (const m of kancalar.PreToolUse ?? []) {
    if (m.matcher && !new RegExp(`^(?:${m.matcher})$`).test(ad)) continue;
    for (const cb of m.hookCallbackIds ?? []) {
      const y = await kancaSor(cb, { hook_event_name: 'PreToolUse', session_id: oturum, cwd: process.cwd(), permission_mode: mod, tool_name: ad, tool_input: input, tool_use_id }, tool_use_id);
      const k = y?.hookSpecificOutput?.permissionDecision;
      if (k) return { karar: k, neden: y.hookSpecificOutput.permissionDecisionReason ?? '' };
    }
  }
  return null;
}

/** İzinli araç akışı: önce PreToolUse kancası, sonra gerekirse sorar; izinde oturum kuralı (destination 'session') öğrenilir. */
async function izinliArac(ad, input, kuralIcerigi, ust = null) {
  const id = aracKullan(ad, input, ust);
  const kanca = await onKanca(ad, input, id);
  if (kanca?.karar === 'deny') { aracSonucu(id, `Kanca reddetti: ${kanca.neden}`, true, ust); return { izin: false, id }; }
  const sor = kanca?.karar === 'ask' || (kanca?.karar !== 'allow' && izinGerekir(ad) && !kuralVar(ad, kuralIcerigi));
  if (sor) {
    if (!izinStdio) { aracSonucu(id, 'İzin yüzeyi yok', true, ust); return { izin: false, id }; }
    const oneri = [{ type: 'addRules', rules: [{ toolName: ad, ruleContent: kuralIcerigi }], behavior: 'allow', destination: 'localSettings' }];
    const r = await izinSor(ad, input, id, { permission_suggestions: oneri, title: `Claude ${ad} kullanmak istiyor`, display_name: ad, description: 'Sahte izin isteği' });
    if (turIptal?.iptal) { aracSonucu(id, 'Kullanıcı durdurdu', true, ust); return { izin: false, id }; }
    if (r?.behavior !== 'allow') { aracSonucu(id, `İzin verilmedi: ${r?.message ?? ''}`, true, ust); return { izin: false, id, yanit: r }; }
    for (const u of r.updatedPermissions ?? []) if (u.type === 'addRules' && u.destination === 'session') kurallar.push(...u.rules);
    return { izin: true, id, yanit: r };
  }
  return { izin: true, id };
}

// ── Görev 28 vitrin senaryoları ──────────────────────────────────────────────────────────────────────────────────────────
const yol = (...p) => [process.cwd(), ...p].join('\\');
const catN = (satirlar, bas = 1) => satirlar.map((s, i) => `${String(bas + i).padStart(6)}→${s}`).join('\n');
async function dusunmeAkit(sn = 0.6) {
  if (!kismi) return;
  const id = `msg_dus_${uuid().slice(0, 8)}`;
  yaz({ type: 'stream_event', event: { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [] } }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
  yaz({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
  await bekle(sn * 1000);
  yaz({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
  yaz({ type: 'stream_event', event: { type: 'message_stop' }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
}
/**
 * İş izi (11 Kas) — #ucajan[:sn]: üç PARALEL Task alt ajanı (parent_tool_use_id ile iç içe Read/Grep/Glob; izin istemez), adımlar gerçekçi aralıklarla iç içe
 * geçer, ajanlar farklı anlarda biter (≈ sn × 0,55 / 0,75 / 1,0), sonunda kısa özet. interrupt ile kesilir.
 */
async function ucAjanAkit(sn) {
  await metinAkit('İşi üç yardımcıya bölüyorum: kayıt ekranı, şifre ekranı ve testler.');
  const ajanlar = [
    { ad: 'Kayıt ekranını tara', tip: 'general-purpose', adimlar: [['Read', { file_path: yol('src', 'eski', 'kayit.css') }], ['Grep', { pattern: 'width: 1200px', path: yol('src', 'eski') }], ['Read', { file_path: yol('src', 'eski', 'kayit.tsx') }], ['Glob', { pattern: 'src/eski/**/*.css' }]], bitis: 0.55 },
    { ad: 'Şifre ekranını tara', tip: 'Explore', adimlar: [['Glob', { pattern: 'src/eski/sifre*' }], ['Read', { file_path: yol('src', 'eski', 'sifre.css') }], ['Grep', { pattern: 'max-width', path: yol('src', 'eski') }], ['Read', { file_path: yol('src', 'eski', 'sifre.tsx') }], ['Grep', { pattern: 'min-width', path: yol('src') }]], bitis: 0.75 },
    { ad: 'Etkilenen testleri bul', tip: 'general-purpose', adimlar: [['Glob', { pattern: 'src/**/*.test.ts' }], ['Read', { file_path: yol('src', 'giris.test.ts') }], ['Grep', { pattern: 'kayit|sifre', path: yol('src') }], ['Read', { file_path: yol('src', 'odeme.test.ts') }], ['Read', { file_path: yol('src', 'kullanici', 'profil.test.ts') }], ['Grep', { pattern: 'toMatchSnapshot', path: yol('src') }]], bitis: 1 },
  ];
  const t0 = Date.now();
  const kimlik = ajanlar.map((a) => aracKullan('Task', { description: a.ad, prompt: `${a.ad}; bulduklarını kısa raporla.`, subagent_type: a.tip }));
  // Her ajanın adımları kendi bitişine dek eşit aralıklarla; zaman çizelgesi tek döngüde (adımlar iç içe geçer).
  const olaylar = [];
  ajanlar.forEach((a, i) => {
    const son = sn * 1000 * a.bitis;
    a.adimlar.forEach((ad, j) => olaylar.push({ t: 400 + ((son - 900) * (j + 0.15 * i)) / a.adimlar.length, i, ad }));
    olaylar.push({ t: son, i, bitti: true });
  });
  olaylar.sort((x, y) => x.t - y.t);
  const suren = new Map();
  for (const o of olaylar) {
    const kalan = o.t - (Date.now() - t0);
    if (kalan > 0) await bekle(kalan);
    if (turIptal?.iptal) return { sonuc: 'kesildi' };
    const ust = kimlik[o.i];
    const onceki = suren.get(o.i);
    if (onceki) { aracSonucu(onceki, 'tamam', false, ust); suren.delete(o.i); }
    if (o.bitti) { aracSonucu(ust, [{ type: 'text', text: `${ajanlar[o.i].ad}: 2 sabit genişlik buldum, düzeltme önerisi hazır.` }]); continue; }
    suren.set(o.i, aracKullan(o.ad[0], o.ad[1], ust));
  }
  await metinAkit('Üç yardımcı da bitirdi: eski ekranlarda 4 sabit genişlik ve onlara dokunan 3 test var. İstersen düzeltmeye geçeyim.');
  return { sonuc: 'tamam' };
}

async function vitrin() {
  const t0 = aracKullan('TodoWrite', { todos: [
    { content: 'Giriş ekranındaki taşmayı bul', status: 'in_progress', activeForm: 'Taşma aranıyor' },
    { content: 'CSS düzeltmesini yap', status: 'pending', activeForm: 'CSS düzeltiliyor' },
    { content: 'Testleri çalıştır', status: 'pending', activeForm: 'Testler çalışıyor' },
    { content: 'Belgeyi güncelle', status: 'pending', activeForm: 'Belge güncelleniyor' },
  ] });
  aracSonucu(t0, 'Todos have been modified successfully.');
  await metinAkit('Önce giriş ekranının stilini ve bileşenini okuyorum; taşmanın nereden geldiğini bulacağım.');
  const r1 = aracKullan('Read', { file_path: yol('src', 'giris.css') });
  aracSonucu(r1, catN(['.giris {', '  display: grid;', '  grid-template-columns: 1fr 1fr;', '  gap: 24px;', '  width: 1200px;', '}', '', '.giris__kart {', '  padding: 32px;', '  border-radius: 22px;', '}', '', '.giris__baslik { font-size: 44px; }', '.giris__alt { color: var(--ink-3); }']));
  const g1 = aracKullan('Grep', { pattern: 'width: 1200px', path: process.cwd(), output_mode: 'files_with_matches' });
  aracSonucu(g1, 'src\\giris.css\nsrc\\eski\\kayit.css\nsrc\\eski\\sifre.css');
  const gl = aracKullan('Glob', { pattern: 'src/**/*.test.ts' });
  aracSonucu(gl, `${yol('src', 'giris.test.ts')}\n${yol('src', 'odeme.test.ts')}\n${yol('src', 'kullanici', 'profil.test.ts')}`);
  const ta = aracKullan('Task', { description: 'Eski ekranlarda aynı sorunu tara', prompt: 'src/eski altındaki CSS dosyalarında sabit genişlik (width: 1200px) kullanan seçicileri bul ve hangi ekranları etkilediğini raporla.', subagent_type: 'Explore' });
  const ic1 = aracKullan('Read', { file_path: yol('src', 'eski', 'kayit.css') }, ta);
  aracSonucu(ic1, catN(['.kayit { width: 1200px; margin: 0 auto; }', '.kayit__form { display: grid; gap: 16px; }']), false, ta);
  const ic2 = aracKullan('Grep', { pattern: '\\.kayit|\\.sifre', path: yol('src', 'eski') }, ta);
  aracSonucu(ic2, 'src\\eski\\kayit.css:1\nsrc\\eski\\sifre.css:3', false, ta);
  await metinAkit('İki eski ekranda da aynı sabit genişlik var; ikisi de dar pencerede taşıyor.', ta);
  aracSonucu(ta, [{ type: 'text', text: '**Rapor:** `kayit.css` ve `sifre.css` aynı `width: 1200px` kuralını kullanıyor. İkisi de 1080 px altında yatay kaydırma çıkarıyor; `max-width` + `width: 100%` yeterli.' }]);
  const e1 = aracKullan('Edit', { file_path: yol('src', 'giris.css'), old_string: '  gap: 24px;\n  width: 1200px;\n}', new_string: '  gap: clamp(16px, 2vw, 24px);\n  width: 100%;\n  max-width: 1200px;\n}' });
  aracSonucu(e1, `The file ${yol('src', 'giris.css')} has been updated. Here's the result of running \`cat -n\` on a snippet of the edited file:\n${catN(['.giris {', '  display: grid;', '  grid-template-columns: 1fr 1fr;', '  gap: clamp(16px, 2vw, 24px);', '  width: 100%;', '  max-width: 1200px;', '}'])}`);
  const w1 = aracKullan('Write', { file_path: yol('src', 'giris.test.ts'), content: "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { girisGenisligi } from './giris.ts';\n\ntest('giriş ekranı dar pencerede taşmaz', () => {\n  assert.equal(girisGenisligi(1080), 1080);\n  assert.equal(girisGenisligi(1600), 1200);\n});\n" });
  aracSonucu(w1, `File created successfully at: ${yol('src', 'giris.test.ts')}`);
  const b1 = aracKullan('Bash', { command: 'npm test -- --reporter=spec', description: 'Birim testlerini çalıştır' });
  const cikti = ['> mavi-kus@1.4.0 test', '> node --test "src/**/*.test.ts"', '', ...Array.from({ length: 46 }, (_, i) => `✔ ${['giriş', 'ödeme', 'profil', 'kayıt', 'şifre', 'sepet'][i % 6]} senaryosu ${i + 1} (${(Math.random() * 3 + 0.2).toFixed(2)}ms)`), 'ℹ tests 46', 'ℹ suites 0', 'ℹ pass 46', 'ℹ fail 0', 'ℹ duration_ms 812.4'];
  aracSonucu(b1, cikti.join('\n'));
  const wf = aracKullan('WebFetch', { url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/clamp', prompt: 'clamp() tarayıcı desteği' });
  aracSonucu(wf, 'clamp() bütün güncel tarayıcılarda destekleniyor (Chrome 79+, Firefox 75+, Safari 13.1+). Üç değer alır: en küçük, tercih edilen ve en büyük.');
  const m1 = aracKullan('mcp__github__search_issues', { repo: 'fuber/mavi-kus', query: 'giriş ekranı taşma', state: 'open' });
  aracSonucu(m1, '[{"number":184,"title":"Giriş ekranı 1080 px\'te yatay kayıyor","state":"open"},{"number":191,"title":"Kayıt formu dar ekranda kesiliyor","state":"open"}]');
  const c1 = aracKullan('TaskCreate', { subject: 'Eski ekranları düzelt', description: 'kayit.css ve sifre.css', activeForm: 'Eski ekranlar düzeltiliyor' });
  aracSonucu(c1, 'Task #1 created successfully: Eski ekranları düzelt', false, null, { task: { id: '1', subject: 'Eski ekranları düzelt' } });
  const t1 = aracKullan('TodoWrite', { todos: [
    { content: 'Giriş ekranındaki taşmayı bul', status: 'completed', activeForm: 'Taşma aranıyor' },
    { content: 'CSS düzeltmesini yap', status: 'completed', activeForm: 'CSS düzeltiliyor' },
    { content: 'Testleri çalıştır', status: 'completed', activeForm: 'Testler çalışıyor' },
    { content: 'Belgeyi güncelle', status: 'in_progress', activeForm: 'Belge güncelleniyor' },
  ] });
  aracSonucu(t1, 'Todos have been modified successfully.');
  await metinAkit([
    '## Ne değişti', '',
    '- `src/giris.css`: sabit `width: 1200px` yerine `width: 100%` + `max-width: 1200px`; aralık `clamp()` ile.',
    '- `src/giris.test.ts`: dar ve geniş pencere için **iki yeni test**.',
    '- Testlerin hepsi geçti (46/46).', '',
    'Eski ekranlar (`kayit.css`, `sifre.css`) aynı sorunu taşıyor; GitHub’da **#184** ve **#191** açık. İstersen onları da düzeltirim:', '',
    '```css', '.kayit { width: 100%; max-width: 1200px; }', '```',
  ].join('\n'));
  return { sonuc: 'vitrin' };
}

async function senaryo(metin) {
  const k = metin.toLowerCase();
  const ucAjan = /#ucajan(?::(\d+(?:\.\d+)?))?/.exec(k);
  if (ucAjan) return ucAjanAkit(Number(ucAjan[1] ?? 14));
  if (k.includes('#vitrin')) return vitrin();
  // Görev 28 düzeltme 2 (N1): alt ajanın içinde izin isteyen araç; önünde 3, ardında 6 adım (koşut araçlar gibi) → bekleyen kart
  // "Önceki N adımı göster"in arkasında kalır. İzin `sn` saniye sonra sorulur (önizleme o arada ajanı elle kapatır).
  const ajanIzin = /#ajanizin(?::(\d+))?/.exec(k);
  if (ajanIzin) {
    const ta = aracKullan('Task', { description: 'Eski ekranları tara, sunucuyu dene', prompt: 'src/eski altındaki ekranları tara; geliştirme sunucusunda dene.', subagent_type: 'general-purpose' });
    const oku = (i) => { const r = aracKullan('Read', { file_path: yol('src', `modul-${i % 6}`, `bilesen-${i}.tsx`) }, ta); aracSonucu(r, catN([`export const B${i} = ${i};`]), false, ta); };
    for (let i = 0; i < 3; i++) oku(i);
    const komut = { command: 'npm run dev -- --port 5173', description: 'Geliştirme sunucusunu başlat' };
    const b = aracKullan('Bash', komut, ta);
    for (let i = 3; i < 9; i++) oku(i);
    await bekle(Number(ajanIzin[1] ?? 2500));
    let izin = true;
    if (izinGerekir('Bash') && !kuralVar('Bash', komut.command)) {
      const r = await izinSor('Bash', komut, b, { title: 'Claude wants to run npm run dev', display_name: 'Bash' });
      izin = !turIptal?.iptal && r?.behavior === 'allow';
    }
    aracSonucu(b, izin ? 'VITE hazır: http://localhost:5173/' : 'İzin verilmedi', !izin, ta);
    aracSonucu(ta, [{ type: 'text', text: izin ? 'Alt ajan raporu: sunucu açıldı, eski ekranlar 1080 px’te taşıyor.' : 'Alt ajan raporu: sunucu açılamadı (izin yok).' }]);
    if (!turIptal?.iptal) await metinAkit(izin ? 'Alt ajan sunucuyu açtı.' : 'Sunucu açılmadı.');
    return { sonuc: 'ajanizin' };
  }
  if (k.includes('#izinfark')) {
    const r = await izinliArac('Edit', { file_path: yol('src', 'odeme.ts'), old_string: "export function toplam(sepet) {\n  return sepet.reduce((t, u) => t + u.fiyat, 0);\n}", new_string: "export function toplam(sepet: Urun[]): number {\n  const ara = sepet.reduce((t, u) => t + u.fiyat * u.adet, 0);\n  return Math.round(ara * 100) / 100;\n}" }, undefined);
    if (r.izin) aracSonucu(r.id, `The file ${yol('src', 'odeme.ts')} has been updated.`);
    if (!turIptal?.iptal) await metinAkit(r.izin ? 'Toplam hesabı adetle çarpılıyor ve kuruşa yuvarlanıyor.' : 'Düzenleme reddedildi; dosyaya dokunmadım.');
    return { sonuc: 'izinfark' };
  }
  const akis = /#akis(?::(\d+(?:\.\d+)?))?/.exec(k);
  if (akis) {
    const sn = akis[1] ? Number(akis[1]) : 5;
    await dusunmeAkit(0.4);
    const id = `msg_akis_${uuid().slice(0, 8)}`;
    const cumleler = ['Bu oturumda **akış** sınanıyor: metin parça parça gelir ve döküm kare başına bir kez çizilir. ', 'Markdown da akarken biçimlenir: `kod`, *vurgu*, listeler. ', '\n\n- Birinci madde: belirteçler toplu gelir.\n- İkinci madde: titreme olmamalı.\n\n', 'Uzun bir paragraf, yeterince uzun ki satır kırılsın ve yükseklik değişsin; sanal liste bunu ölçüp alta yapışık kalmalı. '];
    let tam = '';
    if (kismi) {
      yaz({ type: 'stream_event', event: { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [] } }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
      yaz({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
    }
    const son = Date.now() + sn * 1000;
    let i = 0;
    while (Date.now() < son && !turIptal?.iptal) {
      const parca = (cumleler[i % cumleler.length].match(/\S+\s*/g) ?? []);
      for (const p of parca) {
        tam += p;
        if (kismi) yaz({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
        await bekle(6);
      }
      i++;
    }
    if (kismi) {
      yaz({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
      yaz({ type: 'stream_event', event: { type: 'message_stop' }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
    }
    yaz({ type: 'assistant', message: { id, type: 'message', role: 'assistant', model, content: [{ type: 'text', text: tam }] }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
    return { sonuc: 'akis' };
  }
  const uzun = /#uzun(?::(\d+))?/.exec(k);
  if (uzun) {
    const n = uzun[1] ? Number(uzun[1]) : 2500;
    for (let i = 0; i < n; i++) {
      const r = aracKullan('Read', { file_path: yol('src', `modul-${i % 40}`, `dosya-${i}.ts`) });
      aracSonucu(r, catN([`export const deger${i} = ${i};`, `export default deger${i};`]));
      if (i % 50 === 49) { yaz({ type: 'assistant', message: { id: `msg_uzun_${i}`, type: 'message', role: 'assistant', model, content: [{ type: 'text', text: `${i + 1} dosya okundu; devam ediyorum.` }] }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum }); await bekle(1); }
    }
    await metinAkit(`${n} dosyanın hepsi okundu.`);
    return { sonuc: 'uzun' };
  }
  if (/#cok(?!parca)/.test(k)) {
    yaz({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_cok', type: 'message', role: 'assistant', model, content: [] } }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
    process.stderr.write('sahte çöküş: beklenmedik hata\n');
    await bekle(20);
    process.exit(3);
  }
  if (k.includes('#inat')) inat = true;
  if (k.includes('#modreddet')) { modReddet = true; await metinAkit('Mod değişikliği bundan sonra reddedilecek.'); return { sonuc: 'modreddet' }; }
  const cok = /#cokparca(?::(\d+))?/.exec(k);
  if (cok) {
    const n = cok[1] ? Number(cok[1]) : 5000;
    const r1 = aracKullan('Read', { file_path: `${process.cwd()}\\a.ts` });
    aracSonucu(r1, 'export const a = 1;');
    const id = 'msg_cok_parca';
    let tam = '';
    if (kismi) {
      yaz({ type: 'stream_event', event: { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [] } }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
      yaz({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
    }
    for (let i = 0; i < n; i++) {
      const p = `p${i} `;
      tam += p;
      if (kismi) yaz({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
      if (i % 250 === 249) await bekle(1);
    }
    if (kismi) {
      yaz({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
      yaz({ type: 'stream_event', event: { type: 'message_stop' }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
    }
    yaz({ type: 'assistant', message: { id, type: 'message', role: 'assistant', model, content: [{ type: 'text', text: tam }] }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
    const r2 = aracKullan('Grep', { pattern: 'p1', path: process.cwd() });
    aracSonucu(r2, 'a.ts');
    return { sonuc: 'cokparca' };
  }
  if (k.includes('#gorev')) {
    const c1 = aracKullan('TaskCreate', { subject: 'Testleri yaz', description: 'Birim testleri', activeForm: 'Testler yazılıyor' });
    aracSonucu(c1, 'Task #1 created successfully: Testleri yaz', false, null, { task: { id: '1', subject: 'Testleri yaz' } });
    const c2 = aracKullan('TaskCreate', { subject: 'Belgeyi güncelle', description: 'README' });
    aracSonucu(c2, 'Task #2 created successfully: Belgeyi güncelle', false, null, { task: { id: '2', subject: 'Belgeyi güncelle' } });
    const u1 = aracKullan('TaskUpdate', { taskId: '1', status: 'in_progress' });
    aracSonucu(u1, 'Updated task #1 status', false, null, { success: true, taskId: '1', updatedFields: ['status'] });
    const l1 = aracKullan('TaskList', {});
    aracSonucu(l1, '#1 [in_progress] Testleri yaz\n#2 [completed] Belgeyi güncelle', false, null, { tasks: [{ id: '1', subject: 'Testleri yaz', status: 'in_progress', blockedBy: [] }, { id: '2', subject: 'Belgeyi güncelle', status: 'completed', blockedBy: [] }] });
    await metinAkit('Görevler hazır.');
    return { sonuc: 'gorev' };
  }
  if (k.includes('#soru2')) {
    const questions = [
      { question: 'Hangi dil?', header: 'Dil', options: [{ label: 'TypeScript', description: 'Tipli' }, { label: 'Python', description: 'Kolay' }], multiSelect: false },
      { question: 'Hangi özellikler?', header: 'Özellik', options: [{ label: 'Test', description: '' }, { label: 'Belge', description: '' }, { label: 'CI', description: '' }], multiSelect: true },
    ];
    const id = aracKullan('AskUserQuestion', { questions });
    const r = await izinSor('AskUserQuestion', { questions }, id);
    const a = r?.behavior === 'allow' ? r.updatedInput?.answers ?? {} : {};
    aracSonucu(id, `Yanıtlar: ${JSON.stringify(a)}`, r?.behavior !== 'allow');
    await metinAkit(`Yanıtlar: ${JSON.stringify(a)}`);
    return { sonuc: 'soru2' };
  }
  if (k.includes('#arkaplan')) {
    arkaGorevler.set('gorev-1', { task_id: 'gorev-1', task_type: 'local_agent', description: 'Sahte arka plan ajanı' });
    yaz({ type: 'system', subtype: 'background_tasks_changed', tasks: [...arkaGorevler.values()], uuid: uuid(), session_id: oturum });
    yaz({ type: 'system', subtype: 'task_started', task_id: 'gorev-1', description: 'Sahte arka plan ajanı', is_backgrounded: true, task_type: 'local_agent', uuid: uuid(), session_id: oturum });
    await metinAkit('Arka plan ajanı başlatıldı.');
    return { sonuc: 'arkaplan' };
  }
  if (k.includes('#arkabit')) {
    arkaGorevler.delete('gorev-1');
    yaz({ type: 'system', subtype: 'task_notification', task_id: 'gorev-1', status: 'completed', output_file: '', summary: 'bitti', uuid: uuid(), session_id: oturum });
    yaz({ type: 'system', subtype: 'background_tasks_changed', tasks: [...arkaGorevler.values()], uuid: uuid(), session_id: oturum });
    await metinAkit('Arka plan ajanı bitti.');
    return { sonuc: 'arkabit' };
  }
  if (k.includes('#ortam')) { await metinAkit(`sir=${Object.keys(process.env).filter((a) => /^FUBER_SIR_/i.test(a)).length}`); return { sonuc: 'ortam' }; }
  if (k.includes('#durum')) { await metinAkit(`mod=${mod} model=${model} efor=${efor} oturum=${oturum}`); return { sonuc: 'durum' }; }
  if (k.includes('#arkakabuk')) {
    const id = aracKullan('Bash', { command: 'npm run dev', run_in_background: true, description: 'Geliştirme sunucusu' });
    const gorev = `bash_${uuid().slice(0, 8)}`;
    const dosya = path.join(os.tmpdir(), `sahte-cc-${gorev}.output`);
    fs.writeFileSync(dosya, '> sahte@1.0.0 dev\n> vite\n');
    arkaGorevler.set(gorev, { task_id: gorev, task_type: 'local_bash', description: 'Geliştirme sunucusu' });
    yaz({ type: 'system', subtype: 'background_tasks_changed', tasks: [...arkaGorevler.values()], uuid: uuid(), session_id: oturum });
    yaz({ type: 'system', subtype: 'task_started', task_id: gorev, tool_use_id: id, description: 'Geliştirme sunucusu', is_backgrounded: true, task_type: 'local_bash', uuid: uuid(), session_id: oturum });
    aracSonucu(id, `Command running in background with ID: ${gorev}. Output is being written to: ${dosya}`);
    let n = 0;
    const t0 = Date.now();
    const z = setInterval(() => {
      n++;
      try { fs.appendFileSync(dosya, `  satır ${n}: http://localhost:5173 hazır (${n * 300} ms)\n`); } catch { /* */ }
      yaz({ type: 'tool_progress', tool_use_id: id, tool_name: 'Bash', parent_tool_use_id: null, elapsed_time_seconds: (Date.now() - t0) / 1000, task_id: gorev, uuid: uuid(), session_id: oturum });
    }, 300);
    arkaKabuklar.set(gorev, { z, dosya, id });
    await metinAkit('Geliştirme sunucusu arka planda başladı.');
    return { sonuc: 'arkakabuk' };
  }
  const onplan = /#onplan(?::(\d+(?:\.\d+)?))?/.exec(k);
  if (onplan) {
    const sn = onplan[1] ? Number(onplan[1]) : 20;
    const id = aracKullan('Bash', { command: 'npm test -- --watch', description: 'Testleri izle' });
    const gorev = `bash_${uuid().slice(0, 8)}`;
    yaz({ type: 'system', subtype: 'task_started', task_id: gorev, tool_use_id: id, description: 'Testleri izle', is_backgrounded: false, task_type: 'local_bash', uuid: uuid(), session_id: oturum });
    const t0 = Date.now();
    let arkada = false;
    onPlandaki = { id, gorev, arkayaAl: () => { arkada = true; } };
    while (Date.now() - t0 < sn * 1000 && !turIptal?.iptal && !arkada) {
      yaz({ type: 'tool_progress', tool_use_id: id, tool_name: 'Bash', parent_tool_use_id: null, elapsed_time_seconds: (Date.now() - t0) / 1000, task_id: gorev, uuid: uuid(), session_id: oturum });
      await bekle(250);
    }
    onPlandaki = null;
    if (arkada) {
      const dosya = path.join(os.tmpdir(), `sahte-cc-${gorev}.output`);
      fs.writeFileSync(dosya, 'PASS tests/a.test.ts\nwatching for changes…\n');
      arkaGorevler.set(gorev, { task_id: gorev, task_type: 'local_bash', description: 'Testleri izle' });
      yaz({ type: 'system', subtype: 'task_updated', task_id: gorev, patch: { is_backgrounded: true }, uuid: uuid(), session_id: oturum });
      yaz({ type: 'system', subtype: 'background_tasks_changed', tasks: [...arkaGorevler.values()], uuid: uuid(), session_id: oturum });
      aracSonucu(id, `Command running in background with ID: ${gorev}. Output is being written to: ${dosya}`);
      arkaKabuklar.set(gorev, { z: null, dosya, id });
      await metinAkit('İzleyici arka plana alındı.');
      return { sonuc: 'onplan-arkada' };
    }
    yaz({ type: 'system', subtype: 'task_notification', task_id: gorev, tool_use_id: id, status: 'completed', output_file: '', summary: 'bitti', uuid: uuid(), session_id: oturum });
    aracSonucu(id, 'tamam');
    await metinAkit('İzleyici bitti.');
    return { sonuc: 'onplan' };
  }
  const yavas = /#yavas(?::(\d+(?:\.\d+)?))?/.exec(k);
  if (yavas || inat) {
    const sn = yavas?.[1] ? Number(yavas[1]) : inat ? 60 : 30;
    const id = 'msg_yavas';
    if (kismi) {
      yaz({ type: 'stream_event', event: { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [] } }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
      yaz({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
    }
    let yazilan = '';
    const son = Date.now() + sn * 1000;
    while (Date.now() < son && !(turIptal?.iptal && !inat)) {
      yazilan += '.';
      if (kismi) yaz({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '.' } }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
      await bekle(100);
    }
    yaz({ type: 'assistant', message: { id, type: 'message', role: 'assistant', model, content: [{ type: 'text', text: yazilan || '.' }] }, parent_tool_use_id: null, uuid: uuid(), session_id: oturum, ...(turIptal?.iptal ? { aborted: true } : {}) });
    return { sonuc: 'yavas' };
  }
  if (k.includes('#izin')) {
    const r = await izinliArac('Bash', { command: 'echo merhaba', description: 'Selam yaz' }, 'echo merhaba');
    if (r.izin) aracSonucu(r.id, 'merhaba');
    if (!turIptal?.iptal) await metinAkit(r.izin ? 'Komut çalıştı: merhaba' : 'İzin verilmedi; komutu çalıştırmadım.');
    return { sonuc: 'izin' };
  }
  // Son dalga B düzeltme turu: #yaz:<yol> → Write (göreli ya da mutlak yol; acceptEdits/bypass'ta sormaz — kanca 'ask' derse sorar; dosyaya DOKUNMAZ)
  const yazHedef = /#yaz:(\S+)/i.exec(metin)?.[1];
  if (yazHedef) {
    const r = await izinliArac('Write', { file_path: yazHedef, content: 'x' }, undefined);
    if (r.izin) aracSonucu(r.id, `File created successfully at: ${yazHedef}`);
    if (!turIptal?.iptal) await metinAkit(r.izin ? `Yazıldı: ${yazHedef}` : `Yazılmadı: ${yazHedef}`);
    return { sonuc: 'yaz' };
  }
  if (k.includes('#duzenle')) {
    const r = await izinliArac('Edit', { file_path: `${process.cwd()}\\ornek.txt`, old_string: 'eski satır', new_string: 'yeni satır' }, undefined);
    if (r.izin) aracSonucu(r.id, 'The file ornek.txt has been updated.');
    if (!turIptal?.iptal) await metinAkit(r.izin ? 'Düzenleme yapıldı.' : 'Düzenleme reddedildi.');
    return { sonuc: 'duzenle' };
  }
  if (k.includes('#soru')) {
    const questions = [{ question: 'Hangi renk?', header: 'Renk', options: [{ label: 'Mavi', description: 'Soğuk' }, { label: 'Kırmızı', description: 'Sıcak' }], multiSelect: false }];
    const id = aracKullan('AskUserQuestion', { questions });
    const r = await izinSor('AskUserQuestion', { questions }, id);
    const cevap = r?.behavior === 'allow' ? r.updatedInput?.answers?.['Hangi renk?'] : undefined;
    aracSonucu(id, cevap ? `Kullanıcı yanıtı: ${cevap}` : 'Yanıt yok', !cevap);
    await metinAkit(cevap ? `Seçimin: ${cevap}` : 'Soru yanıtlanmadı.');
    return { sonuc: 'soru' };
  }
  if (k.includes('#arac')) {
    const r1 = aracKullan('Read', { file_path: `${process.cwd()}\\README.md` });
    aracSonucu(r1, '1\t# Sahte proje');
    const r2 = aracKullan('Grep', { pattern: 'TODO', path: process.cwd() });
    aracSonucu(r2, 'Bulunamadı');
    await metinAkit('İki aracı kullandım.');
    return { sonuc: 'arac' };
  }
  if (k.includes('#alt')) {
    const t = aracKullan('Task', { description: 'Dosyaları tara', prompt: 'Projeyi incele', subagent_type: 'general-purpose' });
    const ic = aracKullan('Read', { file_path: `${process.cwd()}\\a.ts` }, t);
    aracSonucu(ic, 'export const a = 1;', false, t);
    aracSonucu(t, [{ type: 'text', text: 'Alt ajan raporu: her şey yolunda.' }]);
    await metinAkit('Alt ajan bitti.');
    return { sonuc: 'alt' };
  }
  if (k.includes('#yapilacak')) {
    const id = aracKullan('TodoWrite', { todos: [{ content: 'Testleri yaz', status: 'completed', activeForm: 'Testler yazılıyor' }, { content: 'Belgeyi güncelle', status: 'in_progress', activeForm: 'Belge güncelleniyor' }] });
    aracSonucu(id, 'Todos have been modified successfully.');
    await metinAkit('Liste güncellendi.');
    return { sonuc: 'yapilacak' };
  }
  // 13 Kas (paketli onarım): gerçek Claude Code'un hata biçimleri — asistan iletisi (error alanı + sentetik metin) ve is_error sonuç; ham JSON/yığın kullanıcıya sızmamalı.
  const gercekHata = (/#(kredi|girisyok|ag|ham401|limit)\b/.exec(k) ?? [])[1];
  if (gercekHata) {
    const H = {
      kredi: { error: 'billing_error', metin: 'Credit balance is too low' },
      girisyok: { error: 'authentication_failed', metin: 'Invalid API key · Please run /login' },
      ag: { error: 'unknown', metin: 'API Error: Unable to connect to API (ConnectionRefused)', yeniden: true },
      ham401: { error: 'authentication_failed', metin: 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CTx9Zk2m1abcDEFghijKL"}' },
      limit: { error: 'rate_limit', metin: "You've hit your limit · resets 5pm (Europe/Istanbul)" },
    }[gercekHata];
    if (H.yeniden) for (let i = 1; i <= 2; i++) yaz({ type: 'system', subtype: 'api_retry', attempt: i, max_retries: 10, retry_delay_ms: 50, error_status: null, error: 'unknown', uuid: uuid(), session_id: oturum });
    yaz({ type: 'assistant', message: { id: `msg_${uuid().replace(/-/g, '').slice(0, 20)}`, type: 'message', role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: H.metin }], stop_reason: 'stop_sequence', usage: { input_tokens: 0, output_tokens: 0 } }, error: H.error, parent_tool_use_id: null, uuid: uuid(), session_id: oturum });
    return { hataMetni: H.metin };
  }
  if (k.includes('#hata')) return { hata: 'Sahte API hatası' };
  await metinAkit(`Merhaba! Sahte Claude Code yanıtı: ${metin.slice(0, 80)}`);
  return { sonuc: 'merhaba' };
}

let zincir = Promise.resolve();
function tur(mesaj) {
  zincir = zincir.then(async () => {
    const c = mesaj?.message?.content;
    const metin = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text).join('\n') : '';
    turIptal = { iptal: false };
    const t0 = Date.now();
    yaz({ type: 'system', subtype: 'init', cwd: process.cwd(), session_id: oturum, tools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Task', 'TodoWrite', 'AskUserQuestion'], mcp_servers: [], model: initModeli(), permissionMode: mod, slash_commands: KOMUTLAR.map((x) => x.name), ...(process.env.SAHTE_CC_API_KAYNAK === '-' ? {} : { apiKeySource: process.env.SAHTE_CC_API_KAYNAK || 'none' }), claude_code_version: '2.1.310-sahte', output_style: 'default', skills: [], plugins: [], capabilities: ['interrupt_receipt_v1'], uuid: uuid() });
    yaz({ type: 'system', subtype: 'session_state_changed', state: 'running', uuid: uuid(), session_id: oturum });
    const r = await senaryo(metin);
    const kesildi = Boolean(turIptal?.iptal);
    toplamMaliyet += 0.0012;
    const ortak = { duration_ms: Date.now() - t0, duration_api_ms: Date.now() - t0, num_turns: 1, stop_reason: kesildi ? null : 'end_turn', total_cost_usd: Number(toplamMaliyet.toFixed(4)), usage: { input_tokens: 120, output_tokens: 34, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 }, modelUsage: {}, permission_denials: [], uuid: uuid(), session_id: oturum };
    if (kesildi) yaz({ type: 'result', subtype: 'error_during_execution', is_error: false, errors: [], terminal_reason: 'aborted_streaming', ...ortak });
    else if (r.hataMetni) yaz({ type: 'result', subtype: 'success', is_error: true, result: r.hataMetni, terminal_reason: 'completed', ...ortak });
    else if (r.hata) yaz({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: [r.hata], terminal_reason: 'api_error', ...ortak });
    else yaz({ type: 'result', subtype: 'success', is_error: false, result: `bitti:${r.sonuc}`, terminal_reason: 'completed', ...ortak });
    yaz({ type: 'system', subtype: 'session_state_changed', state: 'idle', uuid: uuid(), session_id: oturum });
    turIptal = null;
  });
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (satir) => {
  if (!satir.trim()) return;
  let m;
  try { m = JSON.parse(satir); } catch { return; }
  if (m.type === 'control_request') {
    const r = m.request ?? {};
    if (r.subtype === 'initialize') kancalar = r.hooks && typeof r.hooks === 'object' ? r.hooks : {};
    if (r.subtype === 'initialize') return denetimYaniti(m.request_id, { commands: KOMUTLAR, agents: [], output_style: 'default', available_output_styles: ['default'], models: MODELLER, account: hesapBilgisi(), claude_code_version: '2.1.310-sahte' });
    if (r.subtype === 'interrupt') {
      if (turIptal && !inat) { turIptal.iptal = true; turIptal.uyandir?.(); }
      if (!inat) denetimYaniti(m.request_id, { still_queued: [] });
      return undefined;
    }
    if (r.subtype === 'set_permission_mode') {
      if (modReddet) return denetimHatasi(m.request_id, 'sahte: mod değiştirilemedi');
      mod = r.mode;
      denetimYaniti(m.request_id, {});
      return yaz({ type: 'system', subtype: 'status', status: null, permissionMode: mod, uuid: uuid(), session_id: oturum });
    }
    if (r.subtype === 'set_model') { model = r.model && r.model !== 'default' ? r.model : 'claude-sahte-varsayilan'; return denetimYaniti(m.request_id, {}); }
    if (r.subtype === 'apply_flag_settings') {
      if (process.env.SAHTE_CC_EFOR_RET === '1') return denetimHatasi(m.request_id, 'sahte: apply_flag_settings desteklenmiyor');
      const s = r.settings ?? {};
      if ('effortLevel' in s) efor = s.effortLevel ?? '-';
      return denetimYaniti(m.request_id, {});
    }
    if (r.subtype === 'stop_task') {
      const g = arkaKabuklar.get(r.task_id);
      if (!g && !arkaGorevler.has(r.task_id)) return denetimHatasi(m.request_id, `sahte: görev yok ${r.task_id}`);
      if (g?.z) clearInterval(g.z);
      arkaKabuklar.delete(r.task_id);
      arkaGorevler.delete(r.task_id);
      denetimYaniti(m.request_id, {});
      yaz({ type: 'system', subtype: 'task_notification', task_id: r.task_id, ...(g ? { tool_use_id: g.id } : {}), status: 'stopped', output_file: g?.dosya ?? '', summary: 'Kullanıcı durdurdu', uuid: uuid(), session_id: oturum });
      return yaz({ type: 'system', subtype: 'background_tasks_changed', tasks: [...arkaGorevler.values()], uuid: uuid(), session_id: oturum });
    }
    if (r.subtype === 'background_tasks') {
      if (onPlandaki && (!r.tool_use_id || r.tool_use_id === onPlandaki.id)) { onPlandaki.arkayaAl(); return denetimYaniti(m.request_id, { backgrounded: true }); }
      return denetimYaniti(m.request_id, { backgrounded: false });
    }
    return denetimHatasi(m.request_id, `sahte: desteklenmeyen denetim isteği ${r.subtype}`);
  }
  if (m.type === 'control_response') {
    const y = m.response ?? {};
    const coz = bekleyenYanit.get(y.request_id);
    if (coz) { bekleyenYanit.delete(y.request_id); coz(y.subtype === 'success' ? y.response : { behavior: 'deny', message: y.error }); }
    return undefined;
  }
  if (m.type === 'control_cancel_request') return undefined;
  if (m.type === 'user') return tur(m);
  return undefined;
});
// Gerçek Claude Code gibi: stdin kapanınca süren tur bırakılır ve süreç çıkar (inat kipinde yaşamaya devam eder).
rl.on('close', () => {
  if (inat) return;
  if (turIptal) { turIptal.iptal = true; turIptal.uyandir?.(); }
  zincir.finally(() => process.exit(0));
});
// inat kipinde stdin kapansa da süreç yaşar (zorla öldürme sınanır)
setInterval(() => undefined, 1 << 30);
