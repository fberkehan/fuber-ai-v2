// Sahte Claude Code CLI (sınama fikstürü). Gerçek CLI'nin başsız kipini taklit eder: `--version`, `auth status --json`
// ve `-p --input-format stream-json --output-format stream-json`. Çıktı biçimi 2.1.325'in gerçek akışından alındı.
// Ağ kullanmaz, kotadan harcamaz. Davranışı istemdeki yönerge seçer:  [[sahte:<senaryo>|<arg>|<arg>]]
//
//   (yönerge yok)        düz yanıt: "Sahte yanıt: <istemin başı>"; sistem istemi Atölye'nin yapım istemiyse rastgele
//                        kimlikli geçerli bir yetenek yazar (yerel modelin sesle başlattığı yapım için)
//   yankı                bayrakları, sistem istemini, çalışma klasörünü ve ortam değişkeni adlarını JSON olarak döndürür
//   goruntu              aldığı görüntü bloklarını sayar ("Görüntü: image/png, 1234 bayt")
//   yetenek|<id>[|fazla] çalışma klasörüne geçerli, ağsız bir yetenek yazar (zar); `fazla`: ek dosya ve alt klasör de bırakır
//   kur|<id>|<alan adı>  ağ kullanan geçerli bir yetenek yazar (öz-sınaması mockFetch ile)
//   eklenti|<örnek>[|<alan adı>]  belgedeki örnek eklentiyi yazar (`plugin-examples.json`: btc_fiyat = pano kartı,
//                        sabah_doviz = zamanlanmış iş + sesli duyuru, pomodoro = sayfa + sesli kalıp); `alan adı`
//                        verilirse örnekteki ağ adresi onunla değiştirilir (sahte ağ sınaması)
//   guncelle[|izin|<alan adı>]  GÜNCELLEME turu: klasördeki eklentiye `skill_<id>_surum` aracını ekler; `izin` verilirse
//                        ayrıca yeni bir ağ adresi (yeni izin) ister
//   cekirdek-gerek       dosya yazmadan "ÇEKİRDEK GEREKLİ: …" der (eklentiyle yapılamayan istek)
//   bozuk|<id>           ilk çağrıda geçersiz manifest, onarım çağrısında (dosyalar varken) geçerli yetenek
//   hep-bozuk|<id>       her çağrıda geçersiz manifest
//   sinama-kalir|<id>    öz-sınaması hep kalan yetenek
//   kacak|<id>           önce klasör dışına yazmayı dener (izin reddi olayı), sonra geçerli yetenek
//   arastirma            web araması olayları + kaynaklı rapor
//   limit                abonelik sınırı: rate_limit_event (rejected) + hatalı sonuç
//   oturum               oturum hatası sonucu ("Not logged in")
//   cop                  JSON olmayan satırlar, sonuç olayı yok
//   cop-sonuc            JSON olmayan satırlar arasında geçerli sonuç
//   cokme                hata çıktısı yazıp 1 koduyla çıkar
//   asili|<pid dosyası>  bir torun süreç başlatır, pid'leri dosyaya yazar ve hiç bitmez (iptal / zaman aşımı sınaması)
//   yavas|<ms>           verilen süre bekleyip düz yanıt verir (eşzamanlılık sınaması)
//
// Ortam (yalnız birim sınamaları verir): FAKE_CLAUDE_AUTH=out → oturum kapalı · FAKE_CLAUDE_VERSION=2.0.0 → eski sürüm.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const VERSION = process.env.FAKE_CLAUDE_VERSION ?? '2.1.325';

if (argv[0] === '--version') {
  console.log(`${VERSION} (Claude Code)`);
  process.exit(0);
}
if (argv[0] === 'auth' && argv[1] === 'status') {
  const loggedIn = process.env.FAKE_CLAUDE_AUTH !== 'out';
  console.log(JSON.stringify({ loggedIn, authMethod: loggedIn ? 'claude.ai' : 'none', subscriptionType: loggedIn ? 'max' : null }));
  process.exit(loggedIn ? 0 : 1);
}

const flag = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? null : (argv[index + 1] ?? '');
};
const out = (event) => process.stdout.write(`${JSON.stringify({ session_id: 'sahte-oturum', uuid: `u${Math.random().toString(36).slice(2)}`, ...event })}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stdin = await new Promise((resolve) => {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (data += chunk));
  process.stdin.on('end', () => resolve(data));
});
const content = [];
for (const line of stdin.split('\n').filter(Boolean)) {
  try {
    const message = JSON.parse(line);
    if (message.type === 'user') content.push(...(Array.isArray(message.message.content) ? message.message.content : [{ type: 'text', text: String(message.message.content) }]));
  } catch {
    // bozuk girdi: yok sayılır
  }
}
const prompt = content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
const images = content.filter((block) => block.type === 'image');
const directive = /\[\[sahte:([^\]]+)\]\]/.exec(prompt);
const systemFile = (() => {
  const index = process.argv.indexOf('--system-prompt-file');
  return index === -1 ? null : process.argv[index + 1];
})();
const systemText = systemFile && fs.existsSync(systemFile) ? fs.readFileSync(systemFile, 'utf8') : '';
// Yönergesiz yetenek yapımı (yerel modelin sesle başlattığı iş): rastgele kimlikli geçerli bir yetenek yazılır.
const implicitBuild = !directive && systemText.includes('yeni bir YETENEK yazıyorsun') && !/ONARIM TURU/.test(prompt);
const [scenario, ...params] = directive ? directive[1].split('|') : implicitBuild ? ['yetenek', `sesli_${Math.random().toString(36).slice(2, 8)}`] : ['duz'];
const tools = (flag('--tools') ?? '').split(',').filter(Boolean);
const model = flag('--model') ?? 'sonnet';
const cwd = process.cwd();
let turns = 0;
let toolCounter = 0;
const denials = [];

const init = () =>
  out({
    type: 'system',
    subtype: 'init',
    cwd,
    tools,
    mcp_servers: [],
    model: `claude-${model}-sahte`,
    permissionMode: flag('--permission-mode') ?? 'default',
    slash_commands: [],
    apiKeySource: 'none',
    claude_code_version: VERSION,
    agents: [],
    skills: [],
    plugins: [],
  });
const say = (text) => {
  turns++;
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, parent_tool_use_id: null });
};
const result = (text, extra = {}) =>
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    num_turns: turns,
    total_cost_usd: 0,
    stop_reason: 'end_turn',
    api_error_status: null,
    usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    permission_denials: denials,
    ...extra,
  });

/** Araç çağrısı + sonucu. Dosya araçları gerçek CLI gibi çalışma klasörüyle sınırlıdır ve `--tools` listesine bakar. */
function callTool(name, input) {
  turns++;
  const id = `toolu_sahte_${++toolCounter}`;
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }, parent_tool_use_id: null });
  let ok = true;
  let text = 'tamam';
  if (!tools.includes(name)) {
    ok = false;
    text = `No such tool available: ${name}`;
  } else if (name === 'Write') {
    const target = path.resolve(cwd, input.file_path);
    if (!target.startsWith(path.resolve(cwd) + path.sep)) {
      ok = false;
      text = `${target} is outside ${cwd}; --restricted confines the file tools to the working directory.`;
      denials.push({ tool_name: name, tool_use_id: id, tool_input: input });
      out({ type: 'system', subtype: 'permission_denied', tool_name: name, tool_use_id: id, decision_reason: '--restricted: path outside the working directory', message: text });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, input.content, 'utf8');
      text = `File created successfully at: ${target}`;
    }
  }
  out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: !ok, content: text }] }, parent_tool_use_id: null });
  return ok;
}

// ───────────────────────── örnek yetenekler ─────────────────────────

const diceSkill = (id) => ({
  'manifest.json': JSON.stringify(
    {
      id,
      name: id === 'zar_kopru' ? 'Köprü zarı' : `Zar ${id.replace(/_/g, ' ')}`,
      description: 'Zar atar ve sonucu söyler; ağ gerektirmez.',
      version: 1,
      permissions: [],
      tools: [
        {
          name: `skill_${id}_at`,
          description: 'Bir ya da birden çok zar atar. Kullanıcı "zar at" dediğinde kullan.',
          risk: 'read',
          inputSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 10, description: 'Kaç zar' } } },
        },
      ],
    },
    null,
    2,
  ),
  'index.mjs': `export const tools = {
  async skill_${id}_at(input) {
    const count = input.count ?? 1;
    const rolls = [];
    for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(Math.random() * 6));
    return { ok: true, text: 'Zar: ' + rolls.join(', ') + '.', data: { rolls } };
  },
};
`,
  'selftest.mjs': `export default async function ({ tools, assert }) {
  const result = await tools.skill_${id}_at({ count: 3 });
  assert(result.ok, 'zar atılamadı');
  assert.equal(result.data.rolls.length, 3);
  assert(result.data.rolls.every((roll) => roll >= 1 && roll <= 6), 'zar 1–6 arasında olmalı');
}
`,
});

const rateSkill = (id, host) => ({
  'manifest.json': JSON.stringify(
    {
      id,
      name: 'Köprü kuru',
      description: `Döviz kurunu söyler (${host}).`,
      version: 1,
      permissions: ['net'],
      net: { hosts: [host] },
      tools: [
        {
          name: `skill_${id}_sor`,
          description: 'Bir para biriminin lira karşılığını söyler. Kullanıcı "dolar kaç lira" dediğinde kullan.',
          risk: 'read',
          inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'ISO kodu (USD)' } }, required: ['code'] },
        },
      ],
    },
    null,
    2,
  ),
  'index.mjs': `function fetchRate(ctx, code) {
  return ctx.fetch('https://${host}/kur', { query: { code } });
}
export const tools = {
  async skill_${id}_sor(input, ctx) {
    let response;
    try {
      response = await fetchRate(ctx, String(input.code).toUpperCase());
    } catch (error) {
      return { ok: false, text: 'Kur servisine ulaşılamadı: ' + error.message };
    }
    if (!response.ok) return { ok: false, text: 'Kur servisi hata verdi (HTTP ' + response.status + ').' };
    const body = await response.json();
    return { ok: true, text: '1 ' + body.code + ' = ' + body.rate + ' TRY.', data: body };
  },
};
`,
  'selftest.mjs': `export default async function ({ tools, assert, mockFetch }) {
  mockFetch(function (request) {
    if (request.query.code === 'XXX') return { status: 404, body: {} };
    return { status: 200, body: { code: request.query.code, rate: 42.5 } };
  });
  const usd = await tools.skill_${id}_sor({ code: 'usd' });
  assert(usd.ok, 'kur alınamadı: ' + usd.text);
  assert.equal(usd.data.rate, 42.5);
  const bad = await tools.skill_${id}_sor({ code: 'XXX' });
  assert(!bad.ok, 'bilinmeyen kod reddedilmeli');
}
`,
});

function writeSkill(files) {
  for (const [name, text] of Object.entries(files)) callTool('Write', { file_path: path.join(cwd, name), content: text });
}

// ───────────────────────── senaryolar ─────────────────────────

init();
if (scenario === 'cekirdek') {
  // Çekirdek geliştirme (Katman 2) senaryoları ayrı dosyadadır.
  await (await import('../selfdev/fake-scenarios.mjs')).run({ params, prompt, say, result, callTool });
} else switch (scenario) {
  case 'yankı':
  case 'yanki': {
    const systemFile = flag('--system-prompt-file');
    const text = JSON.stringify({
      args: argv,
      system: systemFile ? fs.readFileSync(systemFile, 'utf8') : null,
      systemInsideCwd: systemFile ? path.resolve(systemFile).startsWith(path.resolve(cwd) + path.sep) : null,
      cwd,
      cwdFiles: fs.readdirSync(cwd),
      env: Object.keys(process.env).sort(),
    });
    say(text);
    result(text);
    break;
  }
  case 'goruntu': {
    const text = images.length
      ? `Görüntü: ${images.map((image) => `${image.source.media_type}, ${Buffer.from(image.source.data, 'base64').length} bayt`).join('; ')}`
      : 'Görüntü yok.';
    say(text);
    result(text);
    break;
  }
  case 'yetenek': {
    say('Yeteneği yazıyorum.');
    writeSkill(diceSkill(params[0] ?? 'kopru_zar'));
    // `fazla`: yetenek dosyaları dışında not ve alt klasör bırakır (Atölye bunları süpürmeli).
    if (params[1] === 'fazla') {
      callTool('Write', { file_path: path.join(cwd, 'notlar.txt'), content: 'çalışma notu' });
      callTool('Write', { file_path: path.join(cwd, 'alt', 'ek.mjs'), content: 'export const x = 1;' });
    }
    const text = 'Zar atan, ağ gerektirmeyen bir yetenek yazdım.';
    say(text);
    result(text);
    break;
  }
  case 'eklenti': {
    // Belgedeki örnek eklentiler (`docs/EKLENTI-API.md` ile aynı dosyalar; birim sınaması eşitliği denetler).
    const examples = JSON.parse(fs.readFileSync(new URL('./plugin-examples.json', import.meta.url), 'utf8'));
    const files = examples[params[0] ?? 'btc_fiyat'];
    if (!files) {
      const text = `Bilinmeyen örnek: ${params[0]}`;
      say(text);
      result(text);
      break;
    }
    say('Eklentiyi yazıyorum.');
    const swapped = Object.fromEntries(
      Object.entries(files).map(([name, text]) => [name, params[1] ? text.replaceAll('api.coinbase.com', params[1]) : text]),
    );
    writeSkill(swapped);
    const text = `${JSON.parse(files['manifest.json']).name} eklentisini yazdım.`;
    say(text);
    result(text);
    break;
  }
  case 'guncelle': {
    // Güncelleme turu: kurulu eklentinin dosyaları klasörde durur; yeni bir okuma aracı (ve istenirse yeni izin) eklenir.
    const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'manifest.json'), 'utf8'));
    const name = `skill_${manifest.id}_surum`;
    if (!manifest.tools.some((tool) => tool.name === name)) {
      manifest.tools.push({
        name,
        description: 'Eklentinin güncellendiğini doğrulamak için sürüm bilgisini söyler. Kullanıcı "eklentinin sürümü ne" dediğinde kullan.',
        risk: 'read',
        inputSchema: { type: 'object', properties: {} },
      });
    }
    if (params[0] === 'izin') {
      manifest.permissions = [...new Set([...(manifest.permissions ?? []), 'net'])];
      manifest.net = { hosts: [...new Set([...(manifest.net?.hosts ?? []), params[1] ?? 'api.yeni-e2e.example'])] };
    }
    const index = fs.readFileSync(path.join(cwd, 'index.mjs'), 'utf8');
    const selftest = fs.readFileSync(path.join(cwd, 'selftest.mjs'), 'utf8');
    const close = selftest.lastIndexOf('}');
    writeSkill({
      'manifest.json': JSON.stringify(manifest, null, 2),
      'index.mjs': index.includes(name) ? index : `${index.trimEnd()}\n\ntools.${name} = async function () {\n  return { ok: true, text: 'Sürüm iki.', data: { version: 2 } };\n};\n`,
      'selftest.mjs': selftest.includes(name)
        ? selftest
        : `${selftest.slice(0, close)}  const surum = await tools.${name}({});\n  assert(surum.ok, 'sürüm aracı çalışmalı');\n  assert.includes(surum.text, 'iki');\n}\n`,
    });
    const text = 'Sürüm bilgisini söyleyen bir araç ekledim.';
    say(text);
    result(text);
    break;
  }
  case 'cekirdek-gerek': {
    const text = 'ÇEKİRDEK GEREKLİ: Adanın görünümü uygulamanın kabuğuna aittir; bir eklenti kabuğu değiştiremez. Ada bileşeninin kaynak kodunda değişiklik gerekir.';
    say(text);
    result(text);
    break;
  }
  case 'kur': {
    callTool('WebSearch', { query: 'döviz kuru api' });
    writeSkill(rateSkill(params[0] ?? 'kopru_kur', params[1] ?? 'api.kur-e2e.example'));
    const text = 'Döviz kurunu söyleyen bir yetenek yazdım.';
    say(text);
    result(text);
    break;
  }
  case 'bozuk': {
    const id = params[0] ?? 'kopru_bozuk';
    if (fs.existsSync(path.join(cwd, 'index.mjs'))) {
      // Onarım turu: önceki dosyalar yerinde, sorun bildirildi.
      writeSkill(diceSkill(id));
      const text = 'Manifesti düzelttim.';
      say(text);
      result(text);
    } else {
      const files = diceSkill(id);
      writeSkill({ ...files, 'manifest.json': JSON.stringify({ id, name: 'Eksik', description: 'Araç listesi yok.' }) });
      const text = 'Yeteneği yazdım.';
      say(text);
      result(text);
    }
    break;
  }
  case 'hep-bozuk': {
    const files = diceSkill(params[0] ?? 'kopru_hep_bozuk');
    writeSkill({ ...files, 'manifest.json': '{ "id": "Geçersiz Kimlik" ' });
    const text = 'Yeteneği yazdım.';
    say(text);
    result(text);
    break;
  }
  case 'sinama-kalir': {
    const files = diceSkill(params[0] ?? 'kopru_kalir');
    writeSkill({ ...files, 'selftest.mjs': `export default async function ({ tools, assert }) {\n  await tools.skill_${params[0] ?? 'kopru_kalir'}_at({});\n  assert(false, 'bilerek kalan sınama');\n}\n` });
    const text = 'Yeteneği yazdım.';
    say(text);
    result(text);
    break;
  }
  case 'kacak': {
    callTool('Write', { file_path: path.join(cwd, '..', '..', 'kacak.txt'), content: 'x' });
    writeSkill(diceSkill(params[0] ?? 'kopru_kacak'));
    const text = 'Yeteneği yazdım.';
    say(text);
    result(text);
    break;
  }
  case 'arastirma': {
    callTool('WebSearch', { query: 'sahte araştırma konusu' });
    callTool('WebFetch', { url: 'https://ornek-kaynak.example/rapor' });
    const text =
      'ÖZET: Sahte araştırma iki kaynağa dayanıyor ve sonuç olumlu.\n\n' +
      '## Bulgular\n- Birinci bulgu (https://ornek-kaynak.example/rapor).\n- İkinci bulgu.\n\n' +
      'Kaynaklar:\n- https://ornek-kaynak.example/rapor\n- https://ikinci-kaynak.example/veri';
    say(text);
    result(text);
    break;
  }
  case 'limit': {
    out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1794999600, rateLimitType: 'five_hour', overageStatus: 'rejected' } });
    result("You've hit your limit · resets 3pm (Europe/Istanbul)", { subtype: 'success', is_error: true, api_error_status: 429 });
    process.exitCode = 1;
    break;
  }
  case 'oturum': {
    result('Not logged in · Please run /login', { is_error: true });
    process.exitCode = 1;
    break;
  }
  case 'cop': {
    process.stdout.write('bu bir JSON değil\n{"type": "assistant", "message": {"content": [{"type": "te');
    process.stdout.write('\n\u0000\u0001çöp\n');
    break;
  }
  case 'cop-sonuc': {
    process.stdout.write('uyarı: beklenmeyen satır\n');
    say('Çöpün arasından yanıt.');
    process.stdout.write('{yarım json\n');
    result('Çöpün arasından yanıt.');
    break;
  }
  case 'cokme': {
    process.stderr.write('Error: sahte CLI bilerek çöktü\n');
    process.exit(1);
    break;
  }
  case 'asili': {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    if (params[0]) fs.writeFileSync(params[0], JSON.stringify({ pid: process.pid, child: child.pid }));
    say('Bekliyorum.');
    await new Promise(() => {});
    break;
  }
  case 'yavas': {
    await sleep(Number(params[0] ?? 300));
    say('Yavaş yanıt.');
    result('Yavaş yanıt.');
    break;
  }
  default: {
    const text = `Sahte yanıt: ${prompt.replace(/\s+/g, ' ').slice(0, 60)}`;
    say(text);
    result(text);
  }
}
