/**
 * Yetenek bağlamının İÇİNDE koşan çalışma zamanı (düz JavaScript metni). Her yetenek için ayrı bir `vm` bağlamında
 * bir kez değerlendirilir; yetenek kodu aynı bağlamda bundan SONRA koşar.
 *
 * Tasarım kuralı: bağlamın içine konak dünyasından tek bir nesne girer (`hostSend` işlevi) ve o da bu dosyadaki
 * kapanışta saklı kalır. Sınırdan yalnız METİN (JSON) geçer. Böylece yetenek kodunun eline konak dünyasına ait bir
 * nesne (ve onun `constructor.constructor` zinciri) geçmez. `hostSend` her zaman mikro görevden, yani sığ bir
 * yığından çağrılır: yığın taşması hatası konak işlevinin içinde doğup bağlama sızamaz.
 *
 * Metin olarak tutulur (işlev `toString()` değil): derleyici ve sınama araçlarının araya soktuğu yardımcı kodlar
 * bağlamın içinde tanımsız kalırdı.
 */
export const RUNTIME_SOURCE = String.raw`(function (hostSend, configText) {
  'use strict';
  const config = JSON.parse(configText);
  const apply = Reflect.apply;
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const promiseThen = Promise.prototype.then;
  const NativePromise = Promise;
  const settled = Promise.resolve();
  const NativeError = Error;
  const NativeTypeError = TypeError;
  const NativeDate = Date;
  const NativeMap = Map;
  const objectKeys = Object.keys;
  const freeze = Object.freeze;
  const hasOwn = Object.prototype.hasOwnProperty;
  const isArray = Array.isArray;
  const selftestMode = config.mode === 'selftest';

  // ── konağa giden iletiler ──
  const outbox = [];
  let scheduled = false;
  function flush() {
    scheduled = false;
    const batch = outbox.splice(0, outbox.length);
    for (let i = 0; i < batch.length; i++) {
      try { hostSend(batch[i]); } catch (ignored) { /* konak hatası bağlama alınmaz */ }
    }
  }
  function post(message) {
    let text;
    try { text = stringify(message); } catch (error) { text = undefined; }
    if (typeof text !== 'string' || text.length > config.maxMessageChars) {
      const reason = typeof text === 'string' ? 'sonuç çok büyük (en çok ' + config.maxMessageChars + ' karakter)' : 'sonuç JSON\'a çevrilemiyor';
      if (message && message.t === 'op') text = stringify({ t: 'op', id: message.id, ok: false, error: { message: reason, stack: '' } });
      else if (message && message.t === 'req') { settle(message.id, false, 'istek gönderilemedi: ' + reason); return; }
      else return;
    }
    outbox.push(text);
    if (!scheduled) { scheduled = true; apply(promiseThen, settled, [flush]); }
  }

  // ── konaktan beklenen yanıtlar ──
  let nextRequest = 1;
  const waiting = new NativeMap();
  function settle(id, ok, value) {
    const entry = waiting.get(id);
    if (!entry) return;
    waiting.delete(id);
    if (ok) entry.resolve(value); else entry.reject(new NativeError(String(value)));
  }
  function request(method, params) {
    return new NativePromise(function (resolve, reject) {
      const id = nextRequest++;
      waiting.set(id, { resolve: resolve, reject: reject });
      post({ t: 'req', id: id, method: method, params: params === undefined ? null : params });
    });
  }

  function describe(error) {
    try {
      if (error && typeof error === 'object' && typeof error.message === 'string') {
        return { message: String(error.message), stack: typeof error.stack === 'string' ? error.stack.slice(0, 4000) : '' };
      }
      return { message: String(error), stack: '' };
    } catch (ignored) {
      return { message: 'bilinmeyen hata', stack: '' };
    }
  }
  function show(value) {
    if (typeof value === 'string') return value;
    if (value instanceof NativeError) return describe(value).message;
    try { const text = stringify(value); return text === undefined ? String(value) : text; } catch (ignored) { return String(value); }
  }
  function logLine(level, args) {
    const parts = [];
    for (let i = 0; i < args.length; i++) parts.push(show(args[i]));
    post({ t: 'log', level: level, text: parts.join(' ').slice(0, 2000) });
  }
  function clone(value) {
    const text = stringify(value === undefined ? null : value);
    return text === undefined ? null : parse(text);
  }

  // ── ctx: yeteneğe açılan tek yüzey ──
  const effects = [];
  const memory = new NativeMap();
  function effect(type, input) {
    effects.push(freeze({ type: type, input: clone(input) }));
    return new NativePromise(function (resolve) { resolve({ ok: true, text: 'Öz-sınamada gerçek etki üretilmez.' }); });
  }
  function makeResponse(raw) {
    const body = String(raw.body);
    return freeze({
      ok: raw.ok === true,
      status: raw.status,
      statusText: raw.statusText,
      url: raw.url,
      headers: freeze(raw.headers || {}),
      truncated: raw.truncated === true,
      text: function () { return new NativePromise(function (resolve) { resolve(body); }); },
      json: function () { return new NativePromise(function (resolve) { resolve(parse(body)); }); },
    });
  }
  function key(value) {
    if (typeof value !== 'string' || value.length === 0) throw new NativeTypeError('depolama anahtarı boş olmayan bir metin olmalı');
    return value;
  }
  const storage = freeze({
    get: function (name) {
      key(name);
      if (selftestMode) return new NativePromise(function (resolve) { resolve(memory.has(name) ? parse(memory.get(name)) : undefined); });
      return apply(promiseThen, request('storage.get', { key: name }), [function (found) { return found.found ? found.value : undefined; }]);
    },
    set: function (name, value) {
      key(name);
      const text = stringify(value === undefined ? null : value);
      if (selftestMode) return new NativePromise(function (resolve) { memory.set(name, text); resolve(undefined); });
      return apply(promiseThen, request('storage.set', { key: name, value: parse(text) }), [function () { return undefined; }]);
    },
    delete: function (name) {
      key(name);
      if (selftestMode) return new NativePromise(function (resolve) { resolve(memory.delete(name)); });
      return apply(promiseThen, request('storage.delete', { key: name }), [function (out) { return out.deleted === true; }]);
    },
    keys: function () {
      if (selftestMode) return new NativePromise(function (resolve) { resolve(Array.from(memory.keys())); });
      return apply(promiseThen, request('storage.keys', null), [function (out) { return out.keys; }]);
    },
  });
  // ── eklenti yüzeyi: ayarlar, dosyalar, Jarvis araçları, sesli duyuru ──
  // Öz-sınamada hiçbiri gerçek etki üretmez: ayarlar manifestteki varsayılanlardır (setSetting ile değişir), dosyalar
  // bellektedir, Jarvis araçları kapalıdır (mockTool ile örnek sonuç verilir), sesli duyuru effects dizisine düşer.
  const settingValues = new NativeMap();
  const fileMemory = new NativeMap();
  let toolMock = null;
  function mockTool(handler) {
    if (handler !== null && typeof handler !== 'function') throw new NativeTypeError('mockTool bir işlev (ya da null) ister');
    toolMock = handler;
  }
  function setSetting(name, value) { settingValues.set(key(name), stringify(value === undefined ? null : value)); }
  function filePath(value) {
    if (typeof value !== 'string' || value.length === 0) throw new NativeTypeError('dosya yolu boş olmayan bir metin olmalı');
    return value;
  }
  const settings = freeze({
    get: function (name) {
      key(name);
      if (selftestMode) return new NativePromise(function (resolve) { resolve(settingValues.has(name) ? parse(settingValues.get(name)) : undefined); });
      return apply(promiseThen, request('settings.get', { key: name }), [function (out) { return out.found ? out.value : undefined; }]);
    },
  });
  const files = freeze({
    read: function (path) {
      filePath(path);
      if (selftestMode) return new NativePromise(function (resolve, reject) {
        if (fileMemory.has(path)) resolve(fileMemory.get(path)); else reject(new NativeError('dosya yok: ' + path));
      });
      return apply(promiseThen, request('files.read', { path: path }), [function (out) { return out.text; }]);
    },
    write: function (path, text) {
      filePath(path);
      const content = String(text === undefined ? '' : text);
      if (selftestMode) return new NativePromise(function (resolve) { fileMemory.set(path, content); resolve(undefined); });
      return apply(promiseThen, request('files.write', { path: path, text: content }), [function () { return undefined; }]);
    },
    exists: function (path) {
      filePath(path);
      if (selftestMode) return new NativePromise(function (resolve) { resolve(fileMemory.has(path)); });
      return apply(promiseThen, request('files.exists', { path: path }), [function (out) { return out.exists === true; }]);
    },
    list: function (path) {
      filePath(path);
      if (selftestMode) return new NativePromise(function (resolve) {
        const prefix = path.charAt(path.length - 1) === '/' ? path : path + '/';
        const names = [];
        fileMemory.forEach(function (unused, name) {
          if (name.indexOf(prefix) === 0 && name.slice(prefix.length).indexOf('/') === -1) names.push({ name: name.slice(prefix.length), dir: false });
        });
        resolve(names);
      });
      return apply(promiseThen, request('files.list', { path: path }), [function (out) { return out.entries; }]);
    },
    remove: function (path) {
      filePath(path);
      if (selftestMode) return new NativePromise(function (resolve) { resolve(fileMemory.delete(path)); });
      return apply(promiseThen, request('files.remove', { path: path }), [function (out) { return out.removed === true; }]);
    },
  });
  const jarvisTools = freeze({
    call: function (name, input) {
      const toolName = String(name);
      const value = clone(input === undefined ? {} : input);
      if (selftestMode) {
        if (!toolMock) return new NativePromise(function (resolve, reject) {
          reject(new NativeError('öz-sınamada Jarvis araçları kapalı; mockTool(function ({ name, input }) { return { ok, text, data } }) ile örnek sonuç ver'));
        });
        const handler = toolMock;
        return apply(promiseThen, new NativePromise(function (resolve) { resolve(handler(freeze({ name: toolName, input: value }))); }), [function (answer) {
          const a = answer && typeof answer === 'object' ? answer : {};
          const out = { ok: a.ok !== false, text: String(a.text === undefined ? '' : a.text) };
          if (a.data !== undefined) out.data = clone(a.data);
          return out;
        }]);
      }
      return request('tools.call', { name: toolName, input: value });
    },
  });

  // Öz-sınamada ağ kapalıdır (ana süreç de reddeder). Sınama, ağ çağrısını mockFetch ile verdiği örnek yanıtla sınar.
  let fetchMock = null;
  function mockFetch(handler) {
    if (handler !== null && typeof handler !== 'function') throw new NativeTypeError('mockFetch bir işlev (ya da null) ister');
    fetchMock = handler;
  }
  function mockedFetch(handler, url, o) {
    const seen = freeze({
      url: String(url),
      method: String(o.method || 'GET').toUpperCase(),
      headers: clone(o.headers || {}),
      body: o.body === undefined ? null : clone(o.body),
      query: clone(o.query || {}),
    });
    return apply(promiseThen, new NativePromise(function (resolve) { resolve(handler(seen)); }), [function (answer) {
      const a = answer && typeof answer === 'object' ? answer : {};
      const status = a.status === undefined ? 200 : Number(a.status);
      const body = typeof a.body === 'string' ? a.body : stringify(a.body === undefined ? null : a.body);
      return makeResponse({
        ok: status >= 200 && status < 300,
        status: status,
        statusText: String(a.statusText || ''),
        url: String(url),
        headers: clone(a.headers || {}),
        body: body,
        truncated: false,
      });
    }]);
  }
  const ctx = freeze({
    fetch: function (url, options) {
      const o = options && typeof options === 'object' ? options : {};
      if (selftestMode && fetchMock) return mockedFetch(fetchMock, url, o);
      return apply(promiseThen, request('fetch', {
        url: String(url),
        method: o.method,
        headers: o.headers,
        body: o.body,
        query: o.query,
        timeoutMs: o.timeoutMs,
      }), [makeResponse]);
    },
    storage: storage,
    log: function () { logLine('info', arguments); },
    now: function () { return new NativeDate(); },
    notify: function (input) { return selftestMode ? effect('notify', input) : request('notify', clone(input)); },
    showCard: function (card) { return selftestMode ? effect('showCard', card) : request('showCard', clone(card)); },
    remind: function (input) { return selftestMode ? effect('remind', input) : request('remind', clone(input)); },
    speak: function (text) { return selftestMode ? effect('speak', { text: String(text) }) : request('speak', { text: String(text) }); },
    settings: settings,
    files: files,
    tools: jarvisTools,
  });

  // Yığın kancası kapatılır: yetenek kodu koşarken yığında konağın çerçeveleri de vardır; yapılandırılmış yığın
  // (CallSite) üzerinden onlara uzanan bir yol bırakılmaz. Node kancayı hatanın kendi dünyasındaki
  // "globalThis.Error.prepareStackTrace" üzerinden okur: yalnız bu özelliği değil, küresel "Error" adını da
  // kilitlemek gerekir (aşağıda lockGlobals); yoksa "Error = { prepareStackTrace }" kilidi atlatır (sınandı).
  Object.defineProperty(NativeError, 'prepareStackTrace', { value: undefined, writable: false, configurable: false });

  // ── bağlamın küresel yardımcıları: zamanlayıcı ve console (ikisi de köprüden geçer) ──
  let nextTimer = 1;
  const timers = new NativeMap();
  function setTimeoutShim(callback, ms) {
    if (typeof callback !== 'function') throw new NativeTypeError('setTimeout bir işlev ister');
    const extra = [];
    for (let i = 2; i < arguments.length; i++) extra.push(arguments[i]);
    const id = nextTimer++;
    timers.set(id, true);
    apply(promiseThen, request('timer', { ms: Number(ms) || 0 }), [
      function () {
        if (!timers.delete(id)) return;
        try { apply(callback, undefined, extra); } catch (error) { logLine('error', ['zamanlayıcı hatası: ' + describe(error).message]); }
      },
      function (error) {
        timers.delete(id);
        logLine('warn', ['zamanlayıcı kurulamadı: ' + describe(error).message]);
      },
    ]);
    return id;
  }
  Object.defineProperty(globalThis, 'setTimeout', { value: setTimeoutShim, writable: false, configurable: false });
  Object.defineProperty(globalThis, 'clearTimeout', { value: function (id) { timers.delete(id); }, writable: false, configurable: false });
  Object.defineProperty(globalThis, 'console', {
    value: freeze({
      log: function () { logLine('info', arguments); },
      info: function () { logLine('info', arguments); },
      debug: function () { logLine('info', arguments); },
      warn: function () { logLine('warn', arguments); },
      error: function () { logLine('error', arguments); },
    }),
    writable: false,
    configurable: false,
  });

  // ── yerleşiklerin kilidi (yetenek kodu bundan SONRA koşar) ──
  // Bağlamın bütün küresel adları (Error, Promise, Reflect, JSON, Object, Function, Symbol, Array, …) yazılamaz ve
  // yeniden tanımlanamaz olur; yapıcıların ve ad alanlarının kendisi dondurulur (Error.prepareStackTrace,
  // Error.captureStackTrace, JSON.parse, Reflect.apply, Promise.resolve … değiştirilemez). Prototipler bilinçli
  // olarak dondurulmaz (sıradan kodu bozar); çalışma zamanı ihtiyaç duyduğu prototip yöntemlerini yukarıda baştan
  // yakaladı. Kilit yalnız yeteneğin KENDİ bağlamını korur: sınırdan yine yalnız metin geçer.
  (function lockGlobals() {
    // Promise.prototype de dondurulur: değiştirilmiş "then", çalışma zamanının bekleyen işlerini (await) kilitlerdi.
    freeze(NativePromise.prototype);
    const names = Object.getOwnPropertyNames(globalThis);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
      if (!descriptor) continue;
      const value = descriptor.value;
      if (name !== 'globalThis' && (typeof value === 'function' || (typeof value === 'object' && value !== null))) {
        try { freeze(value); } catch (ignored) { /* dondurulamayan nesne: yalnız adı kilitlenir */ }
      }
      if (!descriptor.configurable) continue;
      // Tanım her zaman TAM verilir: vm bağlamının küresel nesnesi tanımı arka nesneye aktarır ve eksik alan
      // (ör. value) orada "undefined" olur.
      if ('value' in descriptor) {
        Object.defineProperty(globalThis, name, { value: value, writable: false, enumerable: descriptor.enumerable, configurable: false });
      } else {
        Object.defineProperty(globalThis, name, { get: descriptor.get, set: descriptor.set, enumerable: descriptor.enumerable, configurable: false });
      }
    }
  })();

  // ── araç tablosu ──
  let tools = null;
  function register(exported) {
    const table = exported ? exported.tools : undefined;
    if (!table || typeof table !== 'object' || isArray(table)) {
      throw new NativeError('index.mjs "export const tools = { arac_adi: async (input, ctx) => ({ ok, text }) }" vermeli');
    }
    const names = objectKeys(table);
    for (let i = 0; i < names.length; i++) {
      if (typeof table[names[i]] !== 'function') throw new NativeError('"' + names[i] + '" bir işlev olmalı');
    }
    tools = table;
    return names;
  }
  function normalizeResult(value, name) {
    if (!value || typeof value !== 'object' || typeof value.ok !== 'boolean' || typeof value.text !== 'string') {
      throw new NativeError(name + ': araç { ok: boolean, text: string, data? } döndürmeli; dönen: ' + show(value).slice(0, 200));
    }
    const out = { ok: value.ok, text: value.text };
    if (value.data !== undefined) out.data = value.data;
    return out;
  }
  function invoke(name, input) {
    return new NativePromise(function (resolve) {
      if (!tools || !apply(hasOwn, tools, [name]) || typeof tools[name] !== 'function') throw new NativeError('araç bulunamadı: ' + name);
      resolve(tools[name](input, ctx));
    });
  }
  function run(moduleFn) {
    return new NativePromise(function (resolve) {
      const exported = {};
      resolve(apply(promiseThen, moduleFn(exported), [function () { return exported; }]));
    });
  }
  function finish(opId, promise) {
    apply(promiseThen, promise, [
      function (value) { post({ t: 'op', id: opId, ok: true, value: value === undefined ? null : value }); },
      function (error) { post({ t: 'op', id: opId, ok: false, error: describe(error) }); },
    ]);
  }

  // ── öz-sınama yardımcıları ──
  function fail(message, detail) {
    throw new NativeError('Doğrulama tutmadı: ' + (message ? String(message) : 'koşul yanlış') + (detail ? ' (' + detail + ')' : ''));
  }
  function assert(condition, message) { if (!condition) fail(message); }
  assert.ok = assert;
  assert.equal = function (actual, expected, message) {
    if (actual === expected) return;
    if (stringify(actual) === stringify(expected)) return;
    fail(message || 'değerler eşit değil', 'beklenen ' + show(expected) + ', gelen ' + show(actual));
  };
  assert.match = function (text, pattern, message) {
    if (!pattern || typeof pattern.test !== 'function') fail('assert.match bir düzenli ifade ister');
    if (!pattern.test(String(text))) fail(message || 'metin kalıba uymuyor', 'metin: ' + String(text).slice(0, 200));
  };
  assert.includes = function (text, part, message) {
    if (String(text).indexOf(String(part)) === -1) fail(message || 'metin beklenen parçayı içermiyor', 'aranan: ' + String(part) + ', metin: ' + String(text).slice(0, 200));
  };
  freeze(assert);

  async function selftest(moduleFn, selftestFn, spec) {
    const names = register(await run(moduleFn));
    const missing = spec.declared.filter(function (name) { return names.indexOf(name) === -1; });
    const extra = names.filter(function (name) { return spec.declared.indexOf(name) === -1; });
    if (missing.length) throw new NativeError('manifestte olup index.mjs içinde olmayan araç: ' + missing.join(', '));
    if (extra.length) throw new NativeError('index.mjs içinde olup manifestte olmayan araç: ' + extra.join(', '));

    const suite = await run(selftestFn);
    if (typeof suite.default !== 'function') {
      throw new NativeError('selftest.mjs "export default async function ({ tools, ctx, assert, effects, mockFetch, mockTool, setSetting }) { ... }" vermeli');
    }
    const called = {};
    const wrapped = {};
    names.forEach(function (name) {
      wrapped[name] = async function (input) {
        called[name] = true;
        const value = input === undefined ? {} : input;
        // Girdi, modelin göreceği şemayla aynı şemadan geçer: şema ile kod uyuşmuyorsa burada görünür.
        await request('validate', { tool: name, input: clone(value) });
        return normalizeResult(await invoke(name, value), name);
      };
    });
    fetchMock = null;
    toolMock = null;
    settingValues.clear();
    const defaults = spec.settings && typeof spec.settings === 'object' ? spec.settings : {};
    objectKeys(defaults).forEach(function (name) { settingValues.set(name, stringify(defaults[name])); });
    await suite.default({ tools: freeze(wrapped), ctx: ctx, assert: assert, effects: effects, mockFetch: mockFetch, mockTool: mockTool, setSetting: setSetting });
    const uncalled = spec.mustCall.filter(function (name) { return !called[name]; });
    if (uncalled.length) throw new NativeError('öz-sınama şu araçları hiç çağırmadı: ' + uncalled.join(', '));
    return { called: objectKeys(called), effects: effects.length };
  }

  return freeze({
    deliver: function (text) {
      const message = parse(text);
      settle(message.id, message.ok === true, message.ok === true ? message.value : message.error);
    },
    load: function (opId, moduleFn) {
      finish(opId, apply(promiseThen, run(moduleFn), [function (exported) { return { tools: register(exported) }; }]));
    },
    call: function (opId, name, inputText) {
      finish(opId, apply(promiseThen, invoke(name, parse(inputText)), [function (value) { return normalizeResult(value, name); }]));
    },
    selftest: function (opId, moduleFn, selftestFn, specText) {
      finish(opId, selftest(moduleFn, selftestFn, parse(specText)));
    },
  });
})`;
