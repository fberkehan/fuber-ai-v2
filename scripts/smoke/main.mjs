// Electron içinde koşan varsayım doğrulama ana süreci. `scripts/smoke-electron.mjs` başlatır.
// Uygulama kodunu kullanmaz; yalnız KURGU'nun dayandığı platform varsayımlarını sınar.
import { app, BrowserWindow, MessageChannelMain, utilityProcess, ipcMain } from 'electron';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = process.env.FUBER2_SMOKE_OUT;
const userData = process.env.FUBER2_SMOKE_DATA;
if (userData) app.setPath('userData', userData);

const results = {};
const record = (name, ok, detail) => {
  results[name] = { ok, detail };
};

async function check(name, fn) {
  try {
    record(name, true, await fn());
  } catch (error) {
    record(name, false, String(error?.stack ?? error));
  }
}

function sqliteFts() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  const version = db.prepare('select sqlite_version() as v').get().v;
  const docs = [
    'Yarın saat onda KDV beyannamesini hatırlat',
    'İstanbul Şişli ofisinde ışıl ışıl bir toplantı odası var',
    'Çağrı Bey ile öğle yemeği, IŞIK Holding görüşmesi',
    'Isparta gülü ve Iğdır kayısısı siparişi',
  ];
  const queries = [
    'beyannamesini', 'beyan*', 'kdv', 'istanbul', 'İstanbul', 'İSTANBUL', 'şişli', 'sisli', 'ŞİŞLİ',
    'ışıl', 'isil', 'ISIL', 'çağrı', 'cagri', 'ışık', 'IŞIK', 'isparta', 'ısparta', 'ISPARTA', 'ığdır', 'IĞDIR',
  ];
  const tokenizers = {
    'unicode61 remove_diacritics 0': {},
    'unicode61 remove_diacritics 2': {},
    trigram: {},
  };
  for (const tokenizer of Object.keys(tokenizers)) {
    const table = `t_${tokenizer.replace(/\W+/g, '_')}`;
    db.exec(`create virtual table ${table} using fts5(body, tokenize = "${tokenizer}")`);
    const insert = db.prepare(`insert into ${table}(body) values (?)`);
    for (const doc of docs) insert.run(doc);
    const match = db.prepare(`select rowid, bm25(${table}) as score from ${table} where ${table} match ? order by score`);
    for (const query of queries) {
      try {
        tokenizers[tokenizer][query] = match.all(query).map((row) => Number(row.rowid));
      } catch (error) {
        tokenizers[tokenizer][query] = `HATA: ${error.message}`;
      }
    }
  }

  // Önerilen kalıp: metni katlayıp dizinlemek. Katlama packages/shared/src/search.ts içindeki
  // foldForSearch ile aynıdır: Türkçe kurala göre küçük harf + Türkçe harflerin ASCII karşılığı.
  const asciiFold = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
  const fold = (text) =>
    Array.from(text, (ch) => {
      const lower = ch.toLocaleLowerCase('tr');
      const single = lower.length === 1 ? lower : ch;
      return asciiFold[single] ?? single;
    }).join('');
  // FTS5'te sütun adı tablo adıyla aynı olamaz ("vtable constructor failed").
  db.exec('create virtual table notes using fts5(body unindexed, norm, tokenize = "unicode61 remove_diacritics 0")');
  const insertFolded = db.prepare('insert into notes(body, norm) values (?, ?)');
  for (const doc of docs) insertFolded.run(doc, fold(doc));
  const matchFolded = db.prepare('select rowid from notes where notes match ? order by bm25(notes)');
  const foldedResults = {};
  for (const query of queries) {
    const prefix = query.endsWith('*');
    const term = fold(prefix ? query.slice(0, -1) : query).replace(/"/g, '""');
    foldedResults[query] = matchFolded.all(`"${term}"${prefix ? ' *' : ''}`).map((row) => Number(row.rowid));
  }
  const snippet = db
    .prepare("select snippet(notes, 1, '[[', ']]', '…', 6) as snip from notes where notes match ?")
    .get('"kdv"').snip;
  db.close();

  const expectAll = (table, query, rows) => {
    const got = JSON.stringify(table[query]);
    if (got !== JSON.stringify(rows)) throw new Error(`"${query}" için beklenen ${JSON.stringify(rows)}, gelen ${got}`);
  };
  // Önerilen kalıbın kabul ölçütleri: büyük/küçük harf ve Türkçe karakter yazımı fark etmemeli.
  expectAll(foldedResults, 'beyannamesini', [1]);
  expectAll(foldedResults, 'beyan*', [1]);
  for (const query of ['İSTANBUL', 'istanbul', 'ŞİŞLİ', 'şişli', 'sisli', 'ışıl', 'ISIL', 'isil']) {
    expectAll(foldedResults, query, [2]);
  }
  for (const query of ['çağrı', 'cagri', 'IŞIK', 'ışık']) expectAll(foldedResults, query, [3]);
  for (const query of ['ISPARTA', 'isparta', 'ısparta', 'IĞDIR', 'ığdır']) expectAll(foldedResults, query, [4]);
  return { sqliteVersion: version, rawTokenizers: tokenizers, turkishFolded: foldedResults, snippet };
}

function koffiCall() {
  const koffi = require('koffi');
  const shell32 = koffi.load('shell32.dll');
  const query = shell32.func('long __stdcall SHQueryUserNotificationState(_Out_ int *state)');
  const out = [0];
  const hresult = query(out);
  const user32 = koffi.load('user32.dll');
  const getForeground = user32.func('void * __stdcall GetForegroundWindow()');
  const LASTINPUTINFO = koffi.struct('LASTINPUTINFO', { cbSize: 'uint', dwTime: 'uint' });
  const getLastInput = user32.func('bool __stdcall GetLastInputInfo(_Inout_ LASTINPUTINFO *info)');
  const info = { cbSize: koffi.sizeof(LASTINPUTINFO), dwTime: 0 };
  const lastInputOk = getLastInput(info);
  return {
    koffiVersion: koffi.version,
    hresult,
    quns: out[0],
    foregroundWindowIsNull: getForeground() === null,
    lastInputOk,
    lastInputTick: info.dwTime,
  };
}

/** Verilen yükleme sırasını ayrı bir utilityProcess içinde dener. */
function probeAddons(order) {
  return new Promise((resolve) => {
    const child = utilityProcess.fork(path.join(here, 'addon-probe.mjs'), [order.join(',')], {
      serviceName: 'fuber2-smoke-probe',
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ error: 'zaman aşımı' });
    }, 30_000);
    let done = false;
    child.on('message', (message) => {
      if (message?.type !== 'result') return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(message.result);
    });
    child.on('exit', (code) => {
      if (done) return;
      clearTimeout(timer);
      resolve({ error: `süreç sonuç vermeden çıktı (kod ${code})` });
    });
  });
}

// onnxruntime-node bilerek yok: sherpa-onnx-node ile aynı adlı, farklı sürümlü onnxruntime.dll taşır ve
// aynı süreçte sherpa'dan sonra yüklenince "error 182" verir. Ses işçisi yalnız sherpa kullanır.
async function nativeAddonsInUtility() {
  const SHERPA = 'sherpa-onnx-node';
  const detail = await probeAddons([SHERPA, 'koffi', 'node:sqlite']);
  for (const name of [SHERPA, 'koffi', 'node:sqlite']) {
    if (!detail[name]?.ok) throw new Error(`${name} utilityProcess içinde yüklenemedi: ${JSON.stringify(detail)}`);
  }
  return detail;
}

/** Ana süreçte ESM `import()` ile yükleme (asıl uygulamanın ana süreci ESM demetidir). */
async function nativeAddonsInMain() {
  const koffi = await import('koffi');
  const sherpa = await import('sherpa-onnx-node');
  return {
    koffiLoad: typeof (koffi.default ?? koffi).load,
    sherpaVad: typeof (sherpa.default ?? sherpa).Vad,
  };
}

function utilityAndPort() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('zaman aşımı: işçi ya da pencere yanıt vermedi')), 30_000);
    const child = utilityProcess.fork(path.join(here, 'worker.mjs'), [], { serviceName: 'fuber2-smoke-worker' });
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(here, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const state = { worker: null, page: null };
    const finish = () => {
      if (!state.worker || !state.page) return;
      clearTimeout(timer);
      win.destroy();
      child.kill();
      const sent = state.page.sentFramesPerMode;
      for (const mode of ['int16array_clone', 'arraybuffer_clone']) {
        const stat = state.worker.modes[mode];
        if (!stat || stat.frames !== sent || stat.checksum !== state.page.sentChecksum) {
          reject(new Error(`${mode}: çerçeveler eksik ya da bozuk geldi: ${JSON.stringify(state)}`));
          return;
        }
      }
      if (state.page.replySamples !== 320) {
        reject(new Error(`işçiden pencereye PCM ulaşmadı: ${JSON.stringify(state.page)}`));
        return;
      }
      // Aktarılan (transfer) ArrayBuffer renderer → utilityProcess yönünde sessizce düşer; bilgi olarak raporlanır.
      state.transferFromRenderer = state.worker.modes.arraybuffer_transfer
        ? `ulaştı (${state.worker.modes.arraybuffer_transfer.frames}/${sent})`
        : 'ULAŞMADI: aktarılan ArrayBuffer sessizce düşüyor; çerçeveler kopyalanarak gönderilmeli';
      resolve(state);
    };
    child.on('message', (message) => {
      if (message?.type === 'ready') {
        const { port1, port2 } = new MessageChannelMain();
        child.postMessage({ type: 'port' }, [port1]);
        win.loadFile(path.join(here, 'page.html')).then(() => {
          win.webContents.postMessage('fuber:port', 'audio', [port2]);
        }, reject);
      } else if (message?.type === 'result') {
        state.worker = message.result;
        finish();
      } else if (message?.type === 'error') {
        clearTimeout(timer);
        reject(new Error(`işçi: ${message.error}`));
      }
    });
    ipcMain.once('smoke:page-result', (_event, result) => {
      state.page = result;
      finish();
    });
    child.on('exit', (code) => {
      if (!state.worker) {
        clearTimeout(timer);
        reject(new Error(`işçi erken çıktı (kod ${code})`));
      }
    });
  });
}

app.whenReady().then(async () => {
  record('versions', true, {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    modules: process.versions.modules,
    napi: process.versions.napi,
  });
  await check('a_sqlite_fts5', sqliteFts);
  await check('b_koffi_shell32', koffiCall);
  await check('c_native_addons_utility', nativeAddonsInUtility);
  await check('c_native_addons_main_esm', nativeAddonsInMain);
  await check('d_utility_messageport', utilityAndPort);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  app.exit(Object.values(results).every((r) => r.ok) ? 0 : 1);
});
