// Son düzeltme (A8, A9): K3 metinleri ve sürüm (0.9.0; I9).
// A8: önizleme aboneliği motor SAĞLAMAZ (K3) — arayüz metinleri aboneliğin motoru bugün açtığını şimdiki zamanla söylemez.
// A9: sürüm 0.8.0; tanıtım sayfasının indirme bağlantısı dağıtılan kurulum dosyasının adıyla aynı sürümü gösterir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { YONETIM_VAR, LANDING_VAR, E2E_VAR, ozelGerekli } from './yardimci/ozel.ts';

const kok = path.resolve(import.meta.dirname, '..');

function dosyalar(dizin: string, uzanti: RegExp): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dizin, { withFileTypes: true })) {
    const y = path.join(dizin, e.name);
    if (e.isDirectory()) out.push(...dosyalar(y, uzanti));
    else if (uzanti.test(e.name)) out.push(y);
  }
  return out;
}

test('A8: arayüz metinleri aboneliğin motoru bugün açtığını söylemez (K3: önizleme aboneliği motor sağlamaz)', () => {
  const YASAK = /abonelikle açılır|aboneliğiyle hazır motor|motorunu Fuber aboneliğiyle|motor abonelikle gelir|yapay zekâ motoruyla çalışır: /;
  const bulunan: string[] = [];
  for (const d of [...dosyalar(path.join(kok, 'src/renderer'), /\.(tsx?|ts)$/), ...dosyalar(path.join(kok, 'src/shared'), /\.ts$/)]) {
    for (const [i, satir] of fs.readFileSync(d, 'utf8').split('\n').entries()) {
      if (/^\s*(\/\/|\*|\{\/\*)/.test(satir)) continue; // yorum satırları metin değil
      if (YASAK.test(satir)) bulunan.push(`${path.relative(kok, d)}:${i + 1}`);
    }
  }
  assert.deepEqual(bulunan, []);
});

// Son bütün dal incelemesi Ö-3'ün uygulamadaki eşi: Gizli için MUTLAK söz yok (shared/kurulum-yerel.ts gizliKapsami, F1 K1 — Gizli'de bağlı
// e-posta/WhatsApp eşitlenir, telefon köprüsü sürer, Geliştirici'de Claude Code kapsam dışı). "0.12’de yeni" kartı ve hesap akışının Gizli notları
// "bu bilgisayardan hiçbir şey çıkmaz / hiçbir şey ağa çıkmaz" diyordu; doğru söz ürünün kendi cümlesi (shared/nerede.ts; T34b: "Fuber hesabı kapalı").
test('Ö-3 (uygulama): arayüz metinleri Gizli için "hiçbir şey çıkmaz / ağa çıkmaz" gibi mutlak söz vermez', () => {
  const YASAK = /hiçbir şey (?:bu bilgisayardan |bilgisayardan |dışarı |ağa )?(?:çıkmaz|gitmez)|nothing leaves/i;
  const bulunan: string[] = [];
  for (const d of [...dosyalar(path.join(kok, 'src/renderer'), /\.(tsx?|ts)$/), ...dosyalar(path.join(kok, 'src/shared'), /\.ts$/)]) {
    for (const [i, satir] of fs.readFileSync(d, 'utf8').split('\n').entries()) {
      if (/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(satir)) continue; // yorum satırları metin değil
      if (YASAK.test(satir.replace(/\/\/.*$/, ''))) bulunan.push(`${path.relative(kok, d)}:${i + 1}`);
    }
  }
  assert.deepEqual(bulunan, []);
});

// Son bütün dal incelemesi K-9: sohbet yazı alanının yer tutucusu Türkçe kesme işaretiyle (’) — "Fuber’e yaz… (Enter gönderir)". aria-label
// önizleme ve e2e seçicisidir (textarea[aria-label="Fuber'e yaz"]); ekranda görünmez, değişmedi.
test('K-9: sohbet yer tutucusu düz kesme işareti taşımaz', () => {
  const s = fs.readFileSync(path.join(kok, 'src/renderer/bilesenler/Sohbet.tsx'), 'utf8');
  const yer = /placeholder=\{motorDurdu \? yerTutucu : (["'])(.*?)\1\}/.exec(s);
  assert.ok(yer, 'yer tutucu bulunamadı');
  assert.equal(yer[2], 'Fuber’e yaz… (Enter gönderir)');
});

// M1 (son inceleme): three ve tür paketleri üretim bağımlılığıydı → app.asar 124,5 MB (0.8: 97 MB). 0.10 Görev 1 (D1): 3B beyin kalktı,
// three hiçbir bağımlılıkta yok (tests/beyin-kalkti.test.ts); ana süreç, preload ve ortak modüller de onu içe aktarmaz.
test('M1: three ve tür paketleri üretim bağımlılığı değil; ana süreç ve preload three içe aktarmaz', () => {
  const p = JSON.parse(fs.readFileSync(path.join(kok, 'package.json'), 'utf8'));
  for (const ad of ['three', '@types/three', '@types/stats.js', '@types/webxr']) assert.ok(!(ad in p.dependencies), `${ad} üretim bağımlılığında`);
  const ana = [...dosyalar(path.join(kok, 'src/main'), /\.ts$/), ...dosyalar(path.join(kok, 'src/preload'), /\.ts$/), ...dosyalar(path.join(kok, 'src/shared'), /\.ts$/)];
  assert.deepEqual(ana.filter((d) => /from ['"]three/.test(fs.readFileSync(d, 'utf8'))).map((d) => path.relative(kok, d)), []);
});

// I9 (son inceleme): 0.9.0 dalgası (Hakkında ve kurulum dosyasının adı package.json'dan: app.getVersion(), kurulum-paketle.mjs).
// 0.10 Görev 12 (D6): sürüm 0.10.0. Tanıtım sayfası E5'te `landing/kaynak/` → `landing/site/` olarak yeniden yapıldı (kapalı beta:
// indirme bağlantısı yok, kahramanda "Fuber AI 0.10" yazar); `landing/index.html` derlenmeyen eski (0.8 dönemi) sayfadır, denetlenmez.
// 0.11 G12b: sürüm 0.11.0; kahramanda "Fuber AI 0.11"; uygulamada sürüm görünen yerde "0.11.0 beta" (shared/surum.ts, aşağıdaki test).
// 0.12 H6: sürüm 0.12.0; tanıtım sayfasının sürüm etiketleri (kahraman, hap, durum) 0.12 — yalnız etiket, site YAYINLANMADI (spec: ayrı onay).
// 0.13 T16: sürüm 0.13.0; sitenin hapı yalnız etiket (metinler T18, yayın ayrı onay).
// 0.14 T35: sürüm 0.14.0; sitenin hapı "0.14" (yalnız etiket; yayın ayrı onay).
// Site v2 (6aab31b; son bütün dal incelemesi Ö-1): sayfa baştan yazıldı — sürüm artık yalnız kahramanın hapında (`<span class="hap"><b>0.12</b>`);
// "Fuber AI 0.x" diye başka bir yerde anılırsa o da bu sürüm olmalı. Derlenen dört dil (landing/site/{,tr/,fr/,de/}desktop/) de aynı hapı taşır.
test('A9 + I9: sürüm 0.18.2; package-lock kökü ve tanıtım sayfasındaki sürüm aynı', () => {
  const surum = JSON.parse(fs.readFileSync(path.join(kok, 'package.json'), 'utf8')).version;
  assert.equal(surum, '0.18.2');
  const kilit = JSON.parse(fs.readFileSync(path.join(kok, 'package-lock.json'), 'utf8'));
  assert.equal(kilit.version, surum);
  assert.equal(kilit.packages[''].version, surum);
  // 0.18.2: tanıtım sayfası (landing/) bu sürümle güncellenmedi (sayfa çalışması ayrı, yayınlanmadı): hap sayfanın kendi satırında (0.17) kalır; site 0.18'e geçince bunu surum.split ile değiştir.
  const kisa = '0.17';
  if (!LANDING_VAR) return; // açık kaynak hazırlığı: genel depoda yok (tests/yardimci/ozel.ts) — tanıtım sayfasının sürümü yalnız özel depoda denetlenir
  const kaynak = fs.readFileSync(path.join(kok, 'landing/kaynak/sayfa.html'), 'utf8');
  const hap = (m: string) => [...m.matchAll(/class="hap"><b>(\d+\.\d+(?:\.\d+)?)<\/b>/g)].map((x) => x[1]);
  assert.ok(hap(kaynak).length >= 1, 'tanıtım sayfasında sürüm hapı yok');
  assert.deepEqual([...new Set(hap(kaynak))], [kisa]);
  assert.deepEqual([...kaynak.matchAll(/Fuber AI (\d+\.\d+(?:\.\d+)?)\b/g)].map((m) => m[1]).filter((s) => s !== kisa), [], 'sayfada başka bir sürüm anılıyor');
  const siteDiz = path.join(kok, 'landing/site');
  const derlenmis = ['desktop', 'tr/desktop', 'fr/desktop', 'de/desktop'].map((d) => path.join(siteDiz, d, 'index.html'));
  for (const d of derlenmis) assert.deepEqual([...new Set(hap(fs.readFileSync(d, 'utf8')))], [kisa], `${path.relative(kok, d)}: sürüm hapı`);
  for (const d of [path.join(kok, 'landing/kaynak/sayfa.html'), ...derlenmis]) {
    const metin = fs.readFileSync(d, 'utf8');
    const baglantilar = [...metin.matchAll(/Fuber(?:%20| )AI(?:%20| )Kurulum(?:%20| )([\d.]+)\.exe/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(baglantilar)].filter((s) => s !== surum), [], `${path.relative(kok, d)}: eski sürümlü indirme bağlantısı`);
  }
});

// 0.11 G12b: görünen sürüm "0.11.0 beta" (Ayarlar → Genel → Hakkında); beta soneki tek yerde (shared/surum.ts). Kurulum dosyasının adı
// package.json'dan (kurulum-paketle.mjs) gelmeye devam eder — oraya elle "beta" yazılmaz.
test('G12b + H6: görünen sürüm etiketi "0.18.2 beta"; Hakkında bunu kullanır; kurulum dosyasının adına beta girmez', async () => {
  const { surumEtiketi } = await import('../src/shared/surum.ts');
  assert.equal(surumEtiketi('0.18.2'), '0.18.2 beta');
  assert.equal(surumEtiketi(''), '', 'sürüm bilinmiyorsa etiket yok');
  const surum = JSON.parse(fs.readFileSync(path.join(kok, 'package.json'), 'utf8')).version;
  assert.equal(surumEtiketi(surum), '0.18.2 beta');
  const genel = fs.readFileSync(path.join(kok, 'src/renderer/ayarlar/Genel.tsx'), 'utf8');
  assert.match(genel, /surumEtiketi\(surum\)/, 'Hakkında sürümü surumEtiketi ile yazmıyor');
  const paket = fs.readFileSync(path.join(kok, 'scripts/kurulum-paketle.mjs'), 'utf8');
  assert.doesNotMatch(paket, /beta/i, 'kurulum dosyasının adı package.json sürümünden gelir; elle beta yazılmaz');
});

// 0.11 G12b (spec §10) → site v2 (0.12; 6aab31b, ca2faa4; son bütün dal incelemesi Ö-1 ve Ö-3): tanıtım sitesi DÖRT DİLLİ ([[EN||TR||FR||DE]],
// landing/kaynak/derle.mjs). Sözleşme — silinmedi, v2'nin gerçek yapısına çevrildi:
//  · bölümler ve üst şerit bağlantıları (kurulum, kokpit, nerede, ses, gizlilik, ekipler); kokpitte Görevler dilimi ve Alt+Shift+Q dört dilde;
//  · "Nerede çalışsın"ın üç seçeneği ürünün KENDİ cümleleriyle (shared/nerede.ts neredeAciklamasi, İş) — site ayrı bir söz uydurmaz;
//  · GİZLİLİK (Ö-3): mutlak söz yasak (shared/kurulum-yerel.ts gizliKapsami, F1 K1: Gizli'de bağlı e-posta/WhatsApp eşitlemesi, telefon köprüsü
//    sürer; Geliştirici'de Claude Code kapsam dışı) — "hiçbir şey bu bilgisayardan çıkmaz" ve "bir şey çıkmadan önce sorar" (Fuber kipinde her
//    ileti sorulmadan bulut modeline gider) dört dilde YOK; yerine dürüst söz: Gizli'de yapay zekâ bu bilgisayarda çalışır, hesap bile ağa
//    bağlanmaz, bağlanan e-posta/WhatsApp eşitlenmeyi sürdürür; onay yalnız gerçekten sorulan işler için (e-posta/mesaj gönderimi, görev);
//    telefon kartında "yapay zekâ bilgisayarında çalışır" yok (Fuber kipinde bulutta) — "Fuber bilgisayarında çalışmayı sürdürür";
//  · kapalı beta: indirme bağlantısı, fiyat ve sağlayıcı adı yok; beyin sözü yok.
test('Site v2: dört dil — bölümler, Görevler + Alt+Shift+Q, Nerede ürünün cümleleriyle, dürüst gizlilik (mutlak söz yok); indirme/fiyat/sağlayıcı yok', ozelGerekli('landing'), async () => {
  const { neredeAciklamasi } = await import('../src/shared/nerede.ts');
  const kaynak = fs.readFileSync(path.join(kok, 'landing/kaynak/sayfa.html'), 'utf8').replace(/\r\n/g, '\n');
  const govde = kaynak.replace(/<!--KAYNAK[\s\S]*?KAYNAK-->/, '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '');
  const dortluler = [...govde.matchAll(/\[\[([\s\S]*?)\|\|([\s\S]*?)\|\|([\s\S]*?)\|\|([\s\S]*?)\]\]/g)].map((m) => ({ en: m[1], tr: m[2], fr: m[3], de: m[4] }));
  assert.ok(dortluler.length > 100, 'dört dilli metin yok');
  type Dil = 'en' | 'tr' | 'fr' | 'de';
  const dortlu = (k: Record<Dil, RegExp>) => assert.ok(dortluler.some((d) => (Object.keys(k) as Dil[]).every((l) => k[l].test(d[l]))), `dörtlü yok: ${Object.values(k).join(' / ')}`);
  const yok = (k: Record<Dil, RegExp>, neden: string) => {
    for (const d of dortluler) for (const l of Object.keys(k) as Dil[]) assert.doesNotMatch(d[l], k[l], `${neden} (${l})`);
  };
  // Bölümler ve üst şerit.
  for (const b of ['kurulum', 'kokpit', 'nerede', 'ses', 'gizlilik', 'ekipler']) {
    assert.match(govde, new RegExp(`<section[^>]*id="${b}"`), `#${b} bölümü yok`);
    assert.match(govde, new RegExp(`<nav class="ust__sol"[\\s\\S]*?href="#${b}"[\\s\\S]*?</nav>`), `üst şeritte #${b} bağlantısı yok`);
  }
  // Kokpit: Görevler dilimi, onayla başlar, Alt+Shift+Q (dört dilde).
  dortlu({ en: /^Tasks$/, tr: /^Görevler$/, fr: /^Tâches$/, de: /^Aufgaben$/ });
  dortlu({ en: /keeps watch/i, tr: /takip/i, fr: /veille/i, de: /im Blick/i });
  dortlu({ en: /only when you approve[\s\S]*Alt\+Shift\+Q/, tr: /yalnız sen onaylayınca[\s\S]*Alt\+Shift\+Q/, fr: /qu’avec votre accord[\s\S]*Alt\+Maj\+Q/, de: /erst, wenn Sie zustimmen[\s\S]*Alt\+Umschalt\+Q/ });
  // Nerede çalışsın: üç seçenek, Türkçesi ürünün kartlarıyla birebir (shared/nerede.ts).
  for (const n of ['fuber', 'yerel', 'gizli'] as const) {
    const cumle = neredeAciklamasi(n, 'is');
    assert.ok(dortluler.some((d) => d.tr === cumle), `Nerede (${n}) ürünün cümlesi değil: ${cumle}`);
  }
  // Almanca resmi hitap ("Sie"; fuber.ai'nin geri kalanı ve Fransızca da resmi): "du" biçimi yok — kullanıcının Fuber'e söylediği örnek
  // cümleler („Sag mir Bescheid …“, „Erinnere mich …“) asistana hitap olduğu için serbest; onlarda du/dein geçmez.
  yok({ de: /\b(?:du|dich|dir|dein\w*|Dein\w*|euch|euren|euer)\b/ } as Record<Dil, RegExp>, 'Almanca "du" hitabı (resmi "Sie" olmalı)');
  dortlu({ en: /The AI that/, tr: /Seni tanıyan/, fr: /vous connaît/, de: /die Sie kennt/ });
  // Gizlilik — mutlak söz yok (Ö-3), dört dilde.
  yok({
    en: /nothing leaves|before anything leaves/i, tr: /hiçbir şey[^.]*çıkmaz|bir şey çıkmadan/i,
    fr: /rien ne quitte|avant que quoi que ce soit ne quitte/i, de: /verlässt nichts|bevor etwas (?:deinen|Ihren) Computer verlässt/i,
  }, 'mutlak gizlilik sözü');
  // Gizlilik bölümünün onay başlığı yalnız mesajları söyler ("Nothing goes out without you" Fuber kipinde doğru değildi).
  // Son yeniden inceleme Y-1/Y-2: söz yalnız GİDEN gönderimi anlatır ("mesajlarım buluta gitmez" diye okunmaz); Almanca sözcük sırası değişse de yakalanır.
  yok({ en: /Nothing goes out|No message goes/i, tr: /onayın<br \/>olmadan gitmez|mesaj gitmez/i, fr: /Rien ne part|Aucun message/i, de: /Nichts geht[\s\S]{0,20}raus|Keine Nachricht/i }, 'mutlak onay sözü');
  dortlu({ en: /Nothing is sent in your name<br \/>without you/, tr: /Senin adına<br \/>onaysız gönderim yok/, fr: /Rien n’est envoyé en votre nom<br \/>sans vous/, de: /Nichts wird ohne Sie<br \/>in Ihrem Namen gesendet/ });
  // Telefon kartı (K-8): Fuber kipinde yapay zekâ bulutta — "yapay zekâ bilgisayarında çalışır" denmez; bilgisayarda çalışan Fuber'dir.
  yok({ en: /The AI keeps running/i, tr: /Yapay zekâ bilgisayarında çalışmaya/i, fr: /L’IA continue de tourner/i, de: /Die KI läuft weiter/i }, 'telefon kartı: yapay zekâ bilgisayarda');
  dortlu({ en: /Fuber keeps running on your computer/, tr: /Fuber bilgisayarında çalışmayı sürdürür/, fr: /Fuber continue de tourner sur votre ordinateur/, de: /Fuber läuft auf Ihrem Computer weiter/ });
  // Gizli: yapay zekâ bu bilgisayarda; buluttaki yapay zekâ ve Fuber hesabı kapalı (T34b, P14: sonuç sözü yok); bağlanan e-posta/WhatsApp eşitlenmeyi sürdürür (gizliKapsami.dip ile aynı söz).
  const gizlilik = /<section[^>]*id="gizlilik"[\s\S]*?<\/section>/.exec(govde)?.[0] ?? '';
  assert.ok(gizlilik.length > 1000, 'Gizlilik bölümü boş');
  const gDortlu = [...gizlilik.matchAll(/\[\[([\s\S]*?)\|\|([\s\S]*?)\|\|([\s\S]*?)\|\|([\s\S]*?)\]\]/g)].map((m) => ({ en: m[1], tr: m[2], fr: m[3], de: m[4] }));
  const gVar = (k: Record<Dil, RegExp>) => assert.ok(gDortlu.some((d) => (Object.keys(k) as Dil[]).every((l) => k[l].test(d[l]))), `Gizlilik bölümünde yok: ${Object.values(k).join(' / ')}`);
  gVar({ en: /Private mode,[\s\S]*the AI runs on[\s\S]*this computer/, tr: /Gizli modda[\s\S]*yapay zekâ[\s\S]*bilgisayarda çalışır/, fr: /mode Privé,[\s\S]*l’IA tourne sur[\s\S]*cet ordinateur/, de: /Privatmodus[\s\S]*läuft die KI[\s\S]*diesem Computer/ });
  gVar({
    en: /the cloud AI and your Fuber account are off[\s\S]*AI on this computer[\s\S]*Email and WhatsApp[\s\S]*keep syncing/,
    tr: /buluttaki yapay zekâ ve Fuber hesabı kapalı[\s\S]*bu bilgisayardaki yapay zekâyla işlenir[\s\S]*e-posta ve WhatsApp[\s\S]*eşitlenmeyi sürdürür/,
    fr: /l’IA dans le cloud et votre compte Fuber sont désactivés[\s\S]*l’IA de cet ordinateur[\s\S]*e-mail et WhatsApp[\s\S]*se synchroniser/,
    de: /die Cloud-KI und Ihr Fuber-Konto aus[\s\S]*KI auf diesem Computer[\s\S]*E-Mail- und WhatsApp-Konten[\s\S]*synchronisieren weiter/,
  });
  // Onay: yalnız gerçekten sorulan işler (e-posta / mesaj gönderimi, görev başlatma) — meta açıklama ve açılış cümlesi.
  for (const yer of [/<meta name="description" content="(\[\[[\s\S]*?\]\])"/.exec(govde)?.[1] ?? '', /<p data-soz>(\[\[[\s\S]*?\]\])<\/p>/.exec(govde)?.[1] ?? '']) {
    const m = /\[\[([\s\S]*?)\|\|([\s\S]*?)\|\|([\s\S]*?)\|\|([\s\S]*?)\]\]/.exec(yer);
    assert.ok(m, 'meta açıklama ya da açılış cümlesi bulunamadı');
    assert.match(m[1], /asks you before it sends an email or a message or starts a task/);
    assert.match(m[2], /e-posta ya da mesaj göndermeden, bir görev başlatmadan önce sana sorar/);
    assert.match(m[3], /vous demande votre accord avant d’envoyer un e-mail ou un message, ou de lancer une tâche/);
    assert.match(m[4], /fragt Sie, bevor er eine E-Mail oder Nachricht sendet oder eine Aufgabe startet/);
  }
  // Geliştirici kartı: kodlama asistanı Gizli'nin kapsamında değil (shared/kurulum-yerel.ts GIZLI_CLAUDE_CODE; sağlayıcı adı anılmadan).
  // Y-3: Gizli'nin dışında kalan yalnız kodlama asistanı (bütün Geliştirici modu değil) — özne açık.
  dortlu({ en: /Private mode doesn’t cover the coding assistant/, tr: /Kodlama asistanı Gizli modun kapsamı dışındadır/, fr: /Le mode Privé ne couvre pas l’assistant de code/, de: /Der Privatmodus gilt nicht für den Coding-Assistenten/ });
  // Kapalı beta: indirme bağlantısı yok, fiyat yok; sağlayıcı adı ve beyin sözü yok.
  assert.doesNotMatch(govde, /\.exe\b|href="[^"]*(?:download|indir)[^"]*"/i, 'indirme bağlantısı');
  assert.doesNotMatch(govde, /[$€£₺]\s?\d|\d\s?(?:USD|EUR|TL|₺|\$)(?![\w])|per month|\/month|aylık \d|par mois|pro Monat/i, 'fiyat');
  assert.doesNotMatch(govde, /ElevenLabs|Anthropic|OpenAI|OpenRouter|Claude|GPT-|Gemini|Whisper|Piper|Bonsai|Qwen|Llama/i, 'sağlayıcı adı');
  assert.doesNotMatch(govde, /3D brain|3B beyin|\bbeyin\b/i, 'beyin sözü');
});

// Site v3 (30 Eki: ürün odaklı sadelik): yukarıdaki sözleşme aynen geçerli; v3 ek olarak:
//  · telefon kısa bölümü, "Bir bakışta" ve kapanış (davet) var;
//  · bindirme köşeleri derlemede gömülür (%%JSON:kahraman/kokpit/nerede%%); FUƎER yazısı yalnız alt bilgide;
//  · ÖRNEK VERİDE SAYI YOK: ekran görüntülerinin sentetik verisi (landing/uretim/v3/tanitim-veri.mjs) gündelik iştir — kullanıcı/müşteri
//    sayısı, lansman, yatırımcı, beta metriği gibi şirket/çekiş sayısı okunabilecek hiçbir şey yok; ekran-cek.mjs bu veriyi kullanır.
test('Site v3: yeni bölümler, FUƎER yalnız alt bilgide; ekran görüntülerinin örnek verisi gündelik iş (çekiş sayısı yok)', ozelGerekli('landing'), () => {
  const kaynak = fs.readFileSync(path.join(kok, 'landing/kaynak/sayfa.html'), 'utf8').replace(/\r\n/g, '\n');
  const govde = kaynak.replace(/<!--KAYNAK[\s\S]*?KAYNAK-->/, '');
  for (const b of ['telefon', 'bakista', 'davet']) assert.match(govde, new RegExp(`<section[^>]*id="${b}"`), `#${b} bölümü yok`);
  for (const j of ['kahraman', 'kokpit', 'nerede']) assert.ok(govde.includes(`%%JSON:${j}%%`), `${j} köşeleri gömülmüyor`);
  assert.equal((govde.match(/%%FUBER_YOLLARI%%/g) ?? []).length, 1, 'FUƎER yazısı yalnız bir yerde (alt bilgi)');
  assert.match(/<footer[\s\S]*<\/footer>/.exec(govde)?.[0] ?? '', /%%FUBER_YOLLARI%%/, 'FUƎER yazısı alt bilgide değil');
  // (yorum satırları ve özel kartın şema alanı "metrikler:" hariç)
  const veri = fs.readFileSync(path.join(kok, 'landing/uretim/v3/tanitim-veri.mjs'), 'utf8').replace(/^\s*\/\/.*$/gm, '').replaceAll('metrikler:', '');
  assert.doesNotMatch(veri, /kafe|lansman|yatırım|beta|metrik|kullanıcı(?:sı)?\s*\d|\d+\s*kullanıcı|\bAPK\b|Android \d/i, 'örnek veride çekiş/şirket sayısı');
  const cek = fs.readFileSync(path.join(kok, 'landing/uretim/ekran-cek.mjs'), 'utf8');
  assert.match(cek, /from '\.\/v3\/tanitim-veri\.mjs'/, 'ekran-cek.mjs tanıtım verisini kullanmıyor');
  assert.doesNotMatch(cek, /from '[^']*demo-veri\.mjs'/, 'ekran-cek.mjs eski demo verisini (çekiş sayılı) kullanıyor');
});

// Site v3.1 (30 Eki; v3'te animasyonlar ve dizüstü açılma sahnesi çalışmıyordu): sadelik GÖRSEL sadeliktir, durağanlık
// değil. Sözleşme: hareketli düzen yalnız az hareket İSTENMEDİĞİNDE (<html class="hareket">, başta konur); kahramanın zaman çizelgesi ve
// duruş karesi render'dan (kahraman.json zc/tut — sahne3.py ZC ile aynı kaynak); yavaş ağ için önizleme katmanı (kahraman-o/-ko) önce yüklenir;
// her bölümün hareket parçası var (deste, sekme hapı, ses dalgası, Yönetim satır şeritleri, kendiliğinden ilerleyen öne çıkanlar + durdurma
// düğmesi dört dilde); kare başına çalışan çizim işlevleri yalnız transform/opacity yazar (yerleşim özelliği yazmaz).
test('Site v3.1: kaydırmaya bağlı hareket, az hareket eşdeğeri, zaman çizelgesi render JSON\'undan, yavaş ağ önizleme katmanı', ozelGerekli('landing'), () => {
  const kaynak = fs.readFileSync(path.join(kok, 'landing/kaynak/sayfa.html'), 'utf8').replace(/\r\n/g, '\n');
  const govde = kaynak.replace(/<!--KAYNAK[\s\S]*?KAYNAK-->/, '');
  assert.match(govde, /<script>if \(!matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\) document\.documentElement\.classList\.add\('hareket'\);<\/script>/, 'hareket sınıfı az hareket tercihine bağlı değil');
  assert.ok(govde.indexOf("classList.add('hareket')") < govde.indexOf('<body'), 'hareket sınıfı ilk boyamadan önce (head) konmalı');
  const betik = /<script>\n\/\/ ── Ortak[\s\S]*?<\/script>/.exec(govde)?.[0] ?? '';
  assert.ok(betik.length > 10000, 'ana betik bulunamadı');
  for (const k of ['KAHRAMAN.zc', 'KAHRAMAN.tut', 'kahraman-o/', 'kahraman-ko/']) assert.ok(betik.includes(k), `betikte ${k} yok`);
  assert.doesNotMatch(betik, /\[\[|\]\]|\|\|/, 'betikte çift köşeli parantez ya da iki dikey çizgi (dört dil ayırıcısı) var');
  // Hareket yalnız transform/opacity: kare başına çalışan çizim işlevleri yerleşim özelliği yazmaz
  const ciz = [...betik.matchAll(/(?:function \w+Ciz\([\w, ]*\)|\.ciz = \(\w\) =>) \{[\s\S]*?\n(?:\}|  \};)/g)].map((m) => m[0]).join('\n');
  assert.ok(ciz.length > 2000, 'çizim işlevleri bulunamadı');
  assert.doesNotMatch(ciz, /style\.(?:width|height|left|top|margin\w*|padding\w*)\s*=/, 'kare başına yerleşim özelliği yazılıyor');
  for (const parca of ['data-deste', 'data-dalga', 'segment__kayan', 'galeri galeri--oto', 'data-satirlar', 'data-giris']) assert.ok(govde.includes(parca), `${parca} yok`);
  assert.equal((govde.match(/class="serit" style="top:/g) ?? []).length, 10, 'Yönetim: on satır şeridi olmalı');
  // v3.1 denetimi (K1–K4): ekran durumları kaydırmaya ölçeklenmez — histerezisli eşik + zamana bağlı 400 ms ease-out geçiş; karar gerçek
  // kaydırmadan; üst şerit yarı saydam + bulanık (desteklenmezse / saydamlık azaltılmışsa %94 siyah), altında 1 px çizgi
  for (const k of ['class Gecis', 'const SURE = 400', 'const ustte = ', 'const HIST = 0.08', 'mesgulSon']) assert.ok(betik.includes(k), `betikte ${k} yok`);
  assert.doesNotMatch(betik, /durumDegeri|sDegeri/, 'kaydırmaya ölçeklenen (scrub) durum geçişi kalmış');
  // Denetim r2 (ekrana dalış): dizüstü ve pencere birlikte büyür; gövde/çerçeve YALNIZ son evrede (ekran son genişliğin %85'inden sonra)
  // kaydırmaya bağlı söner — ayrı, zamana bağlı bir sönme ya da oturma kayması yok
  assert.ok(betik.includes('K.i85') && betik.includes('0.85 * w'), 'dalışın son evresi (%85) tanımlı değil');
  assert.doesNotMatch(betik, /KG\.tuval|iSonme/, 'dalışta zamana bağlı ayrı sönme kalmış');
  assert.match(govde, /\.ust::before \{[^}]*background: rgb\(0 0 0 \/ \.94\);[^}]*border-bottom: 1px solid rgb\(255 255 255 \/ \.08\)/, 'üst şeridin yedek zemini');
  assert.match(govde, /backdrop-filter: saturate\(180%\) blur\(20px\)/, 'üst şerit bulanık değil');
  assert.match(govde, /prefers-reduced-transparency: reduce/, 'saydamlık azaltma tercihi yok');
  assert.match(govde, /class="oynat"[^>]*data-durdur="\[\[[^|\]]+\|\|[^|\]]+\|\|[^|\]]+\|\|[^|\]]+\]\]"[^>]*data-oynat="\[\[[^|\]]+\|\|[^|\]]+\|\|[^|\]]+\|\|[^|\]]+\]\]"/, 'öne çıkanların durdurma düğmesi dört dilde değil');
});

// 0.13 T18 (Spec I "Sitedeki sözler"; yayınsız): site sözleri 0.13'ün gerçeğine uyar.
//  · "Yanıtlar taslak olarak bekler" yok → "yanıtını senin üslubunla hazırlar, onaylayınca gönderir" (dört dil);
//  · "Gece ne değişti" sözü KORUNUR çünkü kokpit gündemi gece gelen e-posta ve mesaj sayısını gerçekten gösterir (PanoKartlari → geceGelenler);
//  · "Kartlar Gizli mod dışında" yok → kartlar yapay zekâ bu bilgisayarda çalışırken yok (araçsız tur: shared/kokpit-istemleri.ts aracsizMi);
//  · ekran kartı eşiği: büyük sürüm 9 GB (main/yerel/paketler.ts vramGB), 8 GB değil;
//  · ekran ve klavye (ikinci imleç) isteğe bağlı ve varsayılan kapalı (kurulum İzinler adımı);
//  · kurulum on bir adım (KURULUM2_SIRASI) ve galeri de on bir ekran; Business mode ve Developer mode bölümü: adlar her dilde İngilizce biçimiyle,
//    sağlayıcı adı ve karakter adı/görseli yok (Tilki, Bukalemun görselleri henüz verilmedi).
test('Site 0.13 (T18): taslak, gece, kartlar, 9 GB, isteğe bağlı ekran/klavye, 11 adım, Business mode ve Developer mode bölümü', ozelGerekli('landing'), async () => {
  const kaynak = fs.readFileSync(path.join(kok, 'landing/kaynak/sayfa.html'), 'utf8').replace(/\r\n/g, '\n');
  const govde = kaynak.replace(/<!--KAYNAK[\s\S]*?KAYNAK-->/, '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '');
  const dortluler = [...govde.matchAll(/\[\[([\s\S]*?)\|\|([\s\S]*?)\|\|([\s\S]*?)\|\|([\s\S]*?)\]\]/g)].map((m) => ({ en: m[1], tr: m[2], fr: m[3], de: m[4] }));
  type Dil = 'en' | 'tr' | 'fr' | 'de';
  const dortlu = (k: Record<Dil, RegExp>) => assert.ok(dortluler.some((d) => (Object.keys(k) as Dil[]).every((l) => k[l].test(d[l]))), `dörtlü yok: ${Object.values(k).join(' / ')}`);
  const yok = (k: Record<Dil, RegExp>, neden: string) => { for (const d of dortluler) for (const l of Object.keys(k) as Dil[]) assert.doesNotMatch(d[l], k[l], `${neden} (${l})`); };
  // taslak
  yok({ en: /drafted and wait/i, tr: /taslak olarak bekler/i, fr: /rédigés en brouillon/i, de: /als Entwurf vorbereitet/i }, 'eski "taslak olarak bekler" sözü');
  dortlu({ en: /in your tone and sends them only when you approve/, tr: /senin üslubunla hazırlar, yalnız sen onaylayınca gönderir/, fr: /dans votre ton et ne les envoie qu’avec votre accord/, de: /in Ihrem Ton vor und sendet sie erst, wenn Sie zustimmen/ });
  // gece: söz durur, çünkü ürün sayıyı gösterir
  dortlu({ en: /what changed overnight/, tr: /gece ne değişti/, fr: /ce qui a changé pendant la nuit/, de: /was sich über Nacht geändert hat/ });
  const pano = fs.readFileSync(path.join(kok, 'src/renderer/pano/PanoKartlari.tsx'), 'utf8');
  assert.match(pano, /geceGelenler\(/, 'kokpit gündemi gece gelenleri saymıyor: "gece ne değişti" sözü indirilmeli');
  assert.match(pano, /Gece \{gece\} yeni ileti/, 'kokpit gündemi gece notunu yazmıyor (11 Kas: \"yeni ileti\")');
  // kartlar
  yok({ en: /available outside Private mode/i, tr: /Kartlar Gizli mod dışında/, fr: /disponibles hors du mode Privé/i, de: /außerhalb des Privatmodus/i }, 'eski kart sözü');
  dortlu({ en: /not available while the AI runs on this computer/, tr: /yapay zekâ bu bilgisayarda çalışırken kart yok/, fr: /pas disponibles quand l’IA tourne sur cet ordinateur/, de: /solange die KI auf diesem Computer läuft/ });
  const { aracsizMi } = await import('../src/shared/kokpit-istemleri.ts');
  assert.equal(aracsizMi({ yalnizYerel: true }), true, 'yalnız yerel tur araçsız değil: kart sözü yanlış');
  assert.equal(aracsizMi({ gizli: true }), true);
  // 9 GB
  const { YEREL_MODELLER } = await import('../src/main/yerel/paketler.ts');
  const esik = Math.max(...Object.values(YEREL_MODELLER).map((m) => m.vramGB ?? 0));
  assert.equal(esik, 9, 'büyük sürümün ekran kartı eşiği 9 GB değil: sistem gereksinimi sözünü güncelle');
  dortlu({ en: /9 GB or more gets the large version/, tr: /9 GB ve üstü ekran kartında büyük sürüm/, fr: /de 9 Go ou plus reçoit la grande version/, de: /mit 9 GB oder mehr bekommen die große Version/ });
  yok({ en: /8 GB or more gets/, tr: /8 GB ve üstü ekran kartında/, fr: /de 8 Go ou plus reçoit/, de: /mit 8 GB oder mehr bekommen/ }, 'eski 8 GB eşiği');
  // ekran ve klavye isteğe bağlı
  dortlu({ en: /Optional, and off by default[\s\S]*second cursor/, tr: /İsteğe bağlı ve varsayılan kapalı[\s\S]*ikinci bir imleç/, fr: /Facultatif et désactivé par défaut[\s\S]*second curseur/, de: /Optional und standardmäßig aus[\s\S]*zweiter Cursor/ });
  const izin = fs.readFileSync(path.join(kok, 'src/renderer/kurulum2/adimlar/Izinler.tsx'), 'utf8');
  assert.match(izin, /rozet: 'İsteğe bağlı'/);
  assert.match(izin + fs.readFileSync(path.join(kok, 'src/shared/kurulum-metin.ts'), 'utf8'), /Kapalı gelir\./);
  // on bir adım
  const { KURULUM2_SIRASI } = await import('../src/shared/kurulum-taslak.ts');
  assert.equal(KURULUM2_SIRASI.length, 11);
  assert.equal((govde.match(/<li class="adim">/g) ?? []).length, KURULUM2_SIRASI.length, 'kurulum galerisinin ekran sayısı kurulum adımlarıyla aynı değil');
  assert.equal((govde.match(/aria-label="\d+ \/ 11"/g) ?? []).length, 11, 'kurulum noktaları 11 değil');
  dortlu({ en: /Eleven steps/, tr: /On bir adım/, fr: /Onze étapes/, de: /Elf Schritte/ });
  // Business mode / Developer mode bölümü
  const bolum = /<section[^>]*id="modlar"[\s\S]*?<\/section>/.exec(govde)?.[0] ?? '';
  assert.ok(bolum.length > 1500, '#modlar bölümü yok');
  assert.match(bolum, /<h3>Business mode<\/h3>/);
  assert.match(bolum, /<h3>Developer mode<\/h3>/);
  assert.doesNotMatch(bolum, /<img(?![^>]*src="[^"]*\/kip-)[^>]*>/, 'modlar bölümünde kurulumun gerçek ekranı dışında görsel var (karakter görseli yok)');
  assert.doesNotMatch(govde, /Tilki|Bukalemun|\bFox\b|Chameleon|Cam[ée]l[ée]on|Chamäleon|Fuchs|Renard/, 'karakter adı sayfada geçmemeli (adlar Yönetim\'den değişir; görseller henüz yok)');
  assert.doesNotMatch(govde, /Geliştirici modu|Mode développeur|Entwicklermodus|İş modu|Mode professionnel|Geschäftsmodus/, 'mod adları her dilde İngilizce kalır');
  assert.doesNotMatch(bolum, /ElevenLabs|Anthropic|OpenAI|Claude|GPT-|Gemini|Whisper|Piper|Bonsai|Qwen|Llama|Hugging/i, 'sağlayıcı adı');
  assert.doesNotMatch(bolum, /nothing leaves|hiçbir şey[^.]*çıkmaz|rien ne quitte|verlässt nichts/i, 'mutlak gizlilik sözü');
  // Düzeltme turu 1: "tek, doğal bir ses" yok (her modun kendi sesi var); Görevler notu; Fransızca "personnage"; tek satırlık GB sayısı; ses önizlemesi
  yok({ en: /one natural voice/, tr: /tek, doğal/, fr: /seule voix/, de: /einzigen Stimme/ }, 'her modun kendi sesi var: "tek ses" sözü yanlış');
  dortlu({ en: /answers in a natural voice/, tr: /doğal bir sesle yanıtlar/, fr: /répond d’une voix naturelle/, de: /mit einer natürlichen Stimme/ });
  dortlu({ en: /stops every task at once\. Tasks need Fuber’s AI too\./, tr: /anında durdurur\. Görevler için de Fuber’in yapay zekâsı gerekir\./, fr: /d’un coup\. Les tâches nécessitent aussi l’IA de Fuber\./, de: /auf einmal\. Auch Aufgaben brauchen die KI von Fuber\./ });
  for (const d of dortluler) assert.doesNotMatch(d.fr, /caractère/, 'Fransızcada adı olan karakter "personnage" olur');
  dortlu({ en: /Each mode has its own character/, tr: /Her modun kendi karakteri var/, fr: /Chaque mode a son propre personnage/, de: /Jeder Modus hat seinen eigenen Charakter/ });
  dortlu({ en: /Everything in Business mode/, tr: /Business mode’daki her şey/, fr: /Tout ce que contient Business mode[\s\S]*Son personnage est prudent/, de: /^Alles aus Business mode[\s\S]*bleibt dabei angenehm im Umgang/ });
  dortlu({ en: /For running the day/, tr: /Günü yönetmek için/, fr: /Son personnage est vif/, de: /^Für Ihren Arbeitstag:[\s\S]*lacht gern und bleibt dabei professionell/ });
  assert.match(kaynak, /\.kutu \.sayi--uzun \{ white-space: nowrap; font-size: min\(clamp\(38px, 3\.6vw, 52px\), calc\(100cqi \/ 10\.4\)\); \}/, '"1,9 · 3,2 · 7,9 GB" tek satırda kalmıyor');
  assert.match(kaynak, /<b class="sayi sayi--uzun">\[\[1\.9 · 3\.2 · 7\.9 GB/);
  assert.match(kaynak, /\.baslik-o \{[^}]*text-wrap: balance/, 'başlıklar dengeli kırılmıyor (telefonda tek sözcük alt satıra düşer)');
  const ses = fs.readFileSync(path.join(kok, 'src/renderer/kurulum2/adimlar/Ses.tsx'), 'utf8');
  assert.match(ses + fs.readFileSync(path.join(kok, 'src/shared/kurulum-metin.ts'), 'utf8'), /'Bilgisayarlarında aynı ses\.'/);
  assert.doesNotMatch(ses, /Telefonunda ve bilgisayarlarında aynı ses/, 'telefonun sesi ayrı (mobil/web sesi değişmez)');
  // üst menü: Modlar, Kurulum'dan hemen sonra (dört dil)
  assert.match(govde, /<nav class="ust__sol"[\s\S]*?href="#kurulum"[^>]*>[^<]*<\/a><a href="#modlar">\[\[Modes\|\|Modlar\|\|Modes\|\|Modi\]\]<\/a><a href="#kokpit"/, 'üst menüde Kurulum bağlantısından sonra Modlar yok');
  // K4 yatay kayma ölçütü (telefon galerisi) denetimde var
  const k4 = fs.readFileSync(path.join(kok, 'landing/uretim/v3/kontak31.mjs'), 'utf8');
  assert.match(k4, /YATAY KAYMA \(0\.13 T18\)/);
  assert.match(k4, /yan boşluklar sol/);
  assert.match(k4, /\(i\) YAN BOŞLUK, telefon/);
});

// 0.14 T35 (Step 1): sürüm ailesi ve "0.14’te yeni" kartı. Fuber Yönetim 1.2.0 (ayrı uygulama, ayrı sürüm). Kartın konuları (T35 planı): yaşayan
// çentik ve dokuz sayfa, Fuber'in gözleri, internet ve sayfa okuma, bağlı servisler, dosya ve belge üretimi. Ürün metni kuralları:
// Apple tonu (kısa, abartı sıfatı yok), mutlak gizlilik/sonuç sözü yok (tests/sonuc-sozu.test.ts kalıpları), mod adları çevrilmez ("Business mode",
// "Developer mode"), "FİLİNTA" yok, Sade modda kart karakter göstermez (karakter satırı düşer; hayvan adı yok).
test('T35: sürüm 0.18.2, Fuber Yönetim 1.3.0; "0.14’te yeni" kartı — konular, ton, mutlak söz yok, mod adları çevrilmez, Sade’de karakter yok', async () => {
  assert.equal(JSON.parse(fs.readFileSync(path.join(kok, 'package.json'), 'utf8')).version, '0.18.2');
  if (YONETIM_VAR) assert.equal(JSON.parse(fs.readFileSync(path.join(kok, 'yonetim/uygulama.json'), 'utf8')).version, '1.3.0'); // Açık kaynak hazırlığı: genel depoda yonetim/ yok — Yönetim kısmı yalnız özel depoda denetlenir (tests/yardimci/ozel.ts).
  const { YENILIK_BASLIGI, YENILIK_SURUMU, YENILIKLER, yenilikSatirlari } = await import('../src/shared/yenilik.ts');
  assert.equal(YENILIK_SURUMU, '0.14.0');
  assert.equal(YENILIK_BASLIGI, '0.14’te yeni');
  const hepsi = YENILIKLER.map((s) => s.metin);
  const birlesik = hepsi.join('\n');
  // Konular
  assert.match(birlesik, /Çentik[^\n]*dokuz sayfa/, 'yaşayan çentik ve dokuz sayfa');
  assert.match(birlesik, /Fuber’in gözleri/, 'gözler (11 Kas)');
  assert.doesNotMatch(birlesik, /Tilki|Bukalemun/, 'hayvan adı yok');
  assert.match(birlesik, /internette ara[^\n]*sayfayı okuy/, 'internet ve sayfa okuma');
  assert.match(birlesik, /Bağlantılar’dan[^\n]*servis/, 'bağlı servisler');
  assert.match(birlesik, /[Bb]elge[^\n]*tablo[^\n]*sunum[^\n]*PDF/, 'dosya ve belge üretimi');
  // Mod adları çevrilmez (her dilde İngilizce biçim); Türkçe çeviriler ve "kip" yok.
  assert.match(birlesik, /Business mode’da/);
  assert.match(birlesik, /Developer mode’da/);
  assert.doesNotMatch(birlesik, /İş modu|Geliştirici modu|\bkip/i, 'mod adı çevrilmiş ya da "kip"');
  assert.doesNotMatch(birlesik, /FİLİNTA|Filinta/i, 'ürün adı Fuber');
  // Ton: abartı sıfatı ve ünlem yok; her satır tek, kısa cümle.
  assert.doesNotMatch(birlesik, /!|devrim|muhteşem|harika|inanılmaz|mükemmel|en iyi|süper|sihirli|benzersiz|çığır/i, 'pazarlama abartısı');
  for (const m of hepsi) assert.ok(m.length <= 100, `uzun satır (${m.length}): ${m}`);
  // Mutlak gizlilik / sonuç sözü yok (sonuc-sozu.test.ts ile aynı aile; ayrıca "her zaman", "tamamen", "%100").
  const kucuk = birlesik.toLocaleLowerCase('tr');
  assert.doesNotMatch(kucuk, /(?<!\p{L})(asla|hiçbir|hiç|garanti|kesinlikle|her zaman|tamamen|çıkmaz|gitmez|gönderilmez|saklanmaz|göremez|okunamaz)(?!\p{L})|%\s?100|bilgisayar(ın)?da kalır/u, 'mutlak söz');
  // Sade: karakter satırı düşer; kalan satırlarda hayvan adı yok; en az dört satır kalır. Göster'de beş satırın hepsi.
  assert.deepEqual(yenilikSatirlari(true).map((s) => s.metin), hepsi);
  const sade = yenilikSatirlari(false);
  assert.ok(sade.length >= 4 && sade.length === hepsi.length - 1, `Sade'de ${sade.length} satır`);
  assert.doesNotMatch(sade.map((s) => s.metin).join(' '), /Tilki|Bukalemun|karakter/i, 'Sade’de karakter adı');
  // Kart Sade kuralını arayüz kancasından okur (renderer/karakter-gorunum.ts).
  const kart = fs.readFileSync(path.join(kok, 'src/renderer/pano/YenilikKarti.tsx'), 'utf8');
  assert.match(kart, /useKarakterGorunur\(\)/, 'kart Sade ayarını okumuyor');
  assert.match(kart, /yenilikSatirlari\(/, 'kart satırları Sade kuralıyla seçmiyor');
  // Uçtan uca senaryonun başlığı 0.14; paket yapılandırması yeni yardımcıyı anar.
  if (E2E_VAR) assert.match(fs.readFileSync(path.join(kok, 'scripts/e2e/tam-akis.mjs'), 'utf8'), /^\/\/ ═══ Fuber AI 0\.14 — /m); // açık kaynak hazırlığı: genel depoda yok (tests/yardimci/ozel.ts)
  assert.match(fs.readFileSync(path.join(kok, 'electron-builder.yml'), 'utf8'), /fuber-olay\.exe/);
});
