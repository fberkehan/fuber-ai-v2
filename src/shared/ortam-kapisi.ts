// ── Kurulu (paketli) uygulamada test geçersiz kılmalarının kapısı (0.12 H6, Ruling P12; saf, Electron'a bağlı değil → birim testli:
//    tests/ortam-kapisi.test.ts; uygulaması main/ortam-kapisi.ts, main.ts'in İLK içe aktarımı; Fuber Yönetim de bayrak/profil kararını kullanır) ──
// Testler ve önizlemeler uygulamayı ortam değişkenleriyle sahte sunuculara ve sahte komutlara yönlendirir. KURULU uygulamada (app.isPackaged)
// bunlar da okunuyordu: ortamına yazılabilen biri ses ya da servis çağrılarını (belirteç ve anahtarlarla) başka bir sunucuya, Gizli'nin
// "bu bilgisayarda" kalan yerel yapay zekâ ve konuşma çağrılarını ağdaki bir adrese çevirebilir; tek bir ortam yazımını kalıcı, gizli bir komut
// çalıştırma noktasına dönüştürebilirdi. Kural (paketli):
//   · SUNUCU adresleri (ses): YALNIZ bu bilgisayarın kendi adresi (loopback: localhost, 127.0.0.1, [::1]; testin yerel sahte sunucusu).
//     Başka değer → değişken ortamdan silinir (kod varsayılana döner) + uyarı; çökme yok.
//   · YEREL hizmet ve test sahteleri (yerel yapay zekâ ve konuşma sunucusu, arama, kokpit verisi, uv indirme): YALNIZ loopback
//     (Gizli'nin sözü: hiçbir şey ağa çıkmaz).
//   · YALITILMIŞ PROFİL kuralı: sahte komutlar (FUBER_*_KOMUT), ortamdan sırlar (FUBER_SIR_*), sahte klasörler
//     (FUBER_CLAUDE_DIZIN, FUBER_MODEL_DIZINI, FUBER_WHISPER_DIZINI, FUBER_BELGELER) ve arka plan test kipi (FUBER_DEMO, FUBER_GORUNUR) YALNIZ
//     yalıtılmış profilde geçerli. Düzeltme turu 2 (N-1): karar yolların METNİNE değil KİMLİĞİNE bakar (kanonikYol): sürücü harfli mutlak yol,
//     UNC / \\.\ / \\?\UNC / sürücüye göreli / sürücüden sonra ':' (ADS, ::$INDEX_ALLOCATION) → reddedilir; . ve .., sondaki nokta/boşluk ve
//     büyük/küçük harf Win32 gibi çözülür; var olan en yakın üst klasör dosya sisteminden gerçek yoluna çevrilir (8.3 kısa ad, junction, harf)
//     ve kalan parça eklenir. Varsayılan veri klasörü (appData + ürün adı; --user-data-dir'den bağımsız) çözülemezse KAPALI kalınır.
//     Aksi hâlde silinir + uyarı — kullanıcının gerçek profili test kancalarına kapalı. (FUBER_DEMO'ya bağlanmadı: gercek-*-testi betikleri paketli
//     exe'yi FUBER_DEMO'suz, FUBER_VERI + FUBER_SIR_* ile açar.)
//   · FUBER_VERI verilmiş ama yalıtılmış DEĞİLSE (geçersiz, UNC, varsayılan klasörün kendisi ya da takma adı) kurulu uygulama AÇILMAZ (veriGecersiz):
//     sessizce sürmek gerçek veriyi testin ya da yabancı bir yolun eline verirdi.
//   · FUBER_TEST_PIPER (sahte Piper test kancası; ayrı bir Node süreciyle çalışır — H3c) kurulu uygulamada silinir.
//   · 0.14 T16: FUBER_TEST_OAUTH_OTOMATIK (MCP OAuth izin adımını atlayan test kancası) kurulu uygulamada her profilde silinir (KURULUDA_SILINEN_KANCALAR).
//   · Güvenlik geçersiz kılmaları silinir: NODE_TLS_REJECT_UNAUTHORIZED (Node TLS doğrulaması), SSLKEYLOGFILE (TLS oturum anahtarlarını dosyaya
//     yazdırır). Kurumsal ağ değişkenleri (HTTPS_PROXY, NO_PROXY, NODE_USE_ENV_PROXY, NODE_EXTRA_CA_CERTS) meşrudur, dokunulmaz.
//   · ANTHROPIC_BASE_URL process.env'de KALIR (Claude Code'a olduğu gibi geçer — kullanıcının kendi ayarı); Fuber'in kendi Claude çağrıları
//     kurulu uygulamada adresi açıkça verir: yalnız loopback ise ortamdaki, değilse https://api.anthropic.com (anthropicTabani; motor/anthropic.ts).
//   · Komut satırı: kurulu uygulamada ağ/TLS/uzaktan hata ayıklama/sandbox/alt süreç başlatıcı bayrakları (YASAK_BAYRAKLAR) ve Fuber AI'de
//     --user-data-dir açılışı durdurur; yalnız yalıtılmış profilde Playwright'ın --remote-debugging-port'una izin var. Kullanıcıya kısa, sakin
//     bir kutu gösterilir (teknik ayrıntı yok) — arka plan test kipinde ve yalıtılmış profilde kutu yok (testler takılmasın), yalnız günlük.
// Paketsiz (geliştirme/test) çalıştırmada hiçbir şey değişmez. Uyarılar değeri YAZMAZ (adreste belirteç olabilir), yalnız değişkenin adını.

/** Fuber AI v1 has no server of its own: only loopback addresses are accepted for overridable service addresses in the installed app. */
/** Fuber'in kendi Claude çağrılarının kurulu uygulamadaki adresi (ANTHROPIC_BASE_URL loopback değilse). */
export const ANTHROPIC_SUNUCUSU = 'https://api.anthropic.com';
/** Loopback ana bilgisayar adları (URL ayrıştırıcısının kanonik biçimi: büyük harf küçülür, 0x7f.1 gibi IPv4 biçimleri 127.0.0.1 olur). */
export const LOOPBACK_ADLARI: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

export type AdresSinifi = 'sunucu' | 'yerel';
/** Paketli uygulamada adresi denetlenen ortam değişkenleri ve sınıfları. */
export const ADRES_DEGISKENLERI: Readonly<Record<string, AdresSinifi>> = {
  FUBER_SES_TABAN_ELEVENLABS: 'sunucu', // main/ses.ts scribeTaban (canlı dikte; tek kullanımlık belirteç adreste gider)
  FUBER_YEREL_TABAN: 'yerel', // main/yerel/sunucu.ts, main/motor/yerel.ts (bu bilgisayardaki yapay zekâ)
  FUBER_WHISPER_TABAN: 'yerel', // main/gunkaydi/whisper.ts (konuşma tanıma; modül yüklenirken okunur)
  FUBER_TEST_ARAMA: 'yerel', // main/tarayici.ts (FUBER_DEMO ile)
  FUBER_TEST_WEB_ARAMA: 'yerel', // main/yerel-arama.ts (web_ara'nın DuckDuckGo/Bing tabanı; FUBER_DEMO ile)
  FUBER_PANO_SAHTE: 'yerel', // main/pano/pano.ts (FUBER_DEMO ile)
  FUBER_TEST_UV_URL: 'yerel', // main/claudecode/eklenti-kurucu.ts (FUBER_DEMO ile)
  FUBER_TEST_LRCLIB: 'yerel', // main/soz.ts (0.14 T25; şarkı sözü kaynağının sahtesi, önizlemeler; FUBER_DEMO ile)
  FUBER_TEST_MCP_TABAN: 'yerel', // main/entegrasyon/mcp-oauth.ts testHedefi (0.14 T16; .example adreslerini sahte MCP/OAuth servisine çevirir; FUBER_DEMO ile)
};
/** RunAsNode sigortası kapalıyken kurulu uygulamada çalışamayan test kancaları. */
export const RUN_AS_NODE_KANCALARI: readonly string[] = ['FUBER_TEST_PIPER'];
/** Kurulu uygulamada (yalıtılmış profilde bile) HER ZAMAN silinen test kancaları (0.14 T16): FUBER_TEST_OAUTH_OTOMATIK tarayıcıdaki izin adımını atlar
 *  (yetki adresi doğrudan getirilir) — kullanıcının uygulamasında hiçbir koşulda geçerli olmamalı. */
export const KURULUDA_SILINEN_KANCALAR: readonly string[] = [
  'FUBER_TEST_OAUTH_OTOMATIK',
  // 11 Kas: WhatsApp kapısında "paket var" sayan test kancası (yalnız FUBER_DEMO ile; main/entegrasyon/whatsapp-kapisi.ts) — kurulu uygulamada asla.
  'FUBER_TEST_WHATSAPP_PAKET',
];
/** Kurulu uygulamada YALNIZ yalıtılmış profilde geçerli test kancaları (komut çalıştırır, sır verir, klasör değiştirir). */
export const PROFIL_KANCALARI: readonly string[] = [
  'FUBER_CLAUDE_KOMUT', 'FUBER_UV_KOMUT', 'FUBER_GRAPHIFY_KOMUT', 'FUBER_CC_YUKLEYICI_KOMUT', 'FUBER_GIRDI_KOMUT', 'FUBER_OLAY_KOMUT',
  'FUBER_KOPRU_KAYIT', 'FUBER_CLAUDE_DIZIN', 'FUBER_MODEL_DIZINI', 'FUBER_WHISPER_DIZINI', 'FUBER_BELGELER',
  'FUBER_TEST_SAYFA_IZIN', // main/sayfa-okuyucu.ts: sayfa_oku'nun özel adres kapısına "bu sunucu genel sayılsın" istisnası (FUBER_DEMO ile; yalıtılmış profil)
  // 12 Kas Toplantı modu önizlemesi (FUBER_DEMO ile): sahte yazıya çevirme/yapay zekâ ve Chromium'un sahte ses aygıtına verilen WAV dosyası (main/toplanti.ts, main.ts).
  'FUBER_TOPLANTI_DENEME', 'FUBER_TOPLANTI_DENEME_SESI', 'FUBER_TOPLANTI_DENEME_SENARYO', 'FUBER_TOPLANTI_DENEME_ZAMAN',
];
/** Ön ekiyle yalnız yalıtılmış profilde geçerli değişkenler (ortamdan sırlar; main/ayarlar.ts sirOku). */
export const PROFIL_KANCASI_ONEKLERI: readonly string[] = ['FUBER_SIR_'];
/** Arka plan test kipi: kurulu uygulamada yalnız yalıtılmış profilde. */
export const ARKA_PLAN_DEGISKENLERI: readonly string[] = ['FUBER_DEMO', 'FUBER_GORUNUR'];
/** Kurulu uygulamada silinen güvenlik geçersiz kılmaları (Node TLS doğrulaması; Chromium/Node TLS anahtar günlüğü). */
export const GUVENLIK_DEGISKENLERI: readonly string[] = ['NODE_TLS_REJECT_UNAUTHORIZED', 'SSLKEYLOGFILE'];
/** Eski ad (Yönetim ve testler): güvenlik değişkenleri. */
export const NODE_GUVENLIK_DEGISKENLERI = GUVENLIK_DEGISKENLERI;
/** Kurulu uygulamada açılışı durduran komut satırı bayrakları: uzaktan hata ayıklama, ağ yönlendirme ve TLS doğrulamasını kapatma, ağ/TLS
 *  günlükleri (başlık, çerez, oturum anahtarı dosyaya), web güvenliği ve sandbox'ı kapatma, alt süreçleri başka bir programla başlatma
 *  (Chromium content anahtarları: browser-subprocess-path, renderer/utility-cmd-prefix, gpu-launcher — Windows'ta da komut satırının önüne
 *  sarmalayıcı koyar), V8 bayrakları, kimlik doğrulama izin listeleri. */
export const YASAK_BAYRAKLAR: readonly string[] = [
  'remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address', 'remote-allow-origins',
  'ignore-certificate-errors', 'ignore-certificate-errors-spki-list', 'host-resolver-rules', 'host-rules', 'proxy-server', 'proxy-pac-url',
  'log-net-log', 'net-log-capture-mode', 'ssl-key-log-file',
  'disable-web-security', 'no-sandbox', 'disable-gpu-sandbox',
  'browser-subprocess-path', 'renderer-cmd-prefix', 'utility-cmd-prefix', 'gpu-launcher',
  'js-flags', 'auth-server-whitelist', 'auth-server-allowlist', 'auth-negotiate-delegate-whitelist', 'auth-negotiate-delegate-allowlist',
];
/** Yalnız Fuber AI'de yasak (Fuber Yönetim yalıtılmış test profilini bununla verir): profil klasörünü çevirir; Fuber AI'nin test yalıtımı FUBER_VERI. */
export const MASAUSTU_EK_YASAK: readonly string[] = ['user-data-dir'];
/** Yalıtılmış profilde serbest bayraklar: Playwright arayüze CDP ile bağlanır (kurulu-duman, uçtan uca test ve FUBER_DEMO'suz gercek-*-testi).
 *  Yalıtılmış profilde kullanıcının verisi, sırları ve oturumu yoktur; CDP oraya bağlanınca kullanıcıya ait hiçbir şeye erişemez. */
export const YALITILMIS_PROFILDE_SERBEST: readonly string[] = ['remote-debugging-port', 'remote-debugging-pipe'];

/** Açılmama kutusunun metinleri (kısa, sakin, teknik ayrıntısız; İş dili). */
export const ACILMADI_KUTUSU = {
  masaustuBaslik: 'Fuber AI açılamadı',
  yonetimBaslik: 'Fuber Yönetim açılamadı',
  bayrak: 'Bu şekilde başlatılamıyor. Başlat menüsünden ya da masaüstündeki simgeden yeniden aç.',
  veri: 'Bu bilgisayardaki bir ayar Fuber’in verilerini geçersiz bir yere yönlendiriyor. Fuber bu yüzden açılmadı; verilerin yerinde duruyor.',
} as const;

const PROTOKOLLER = new Set(['http:', 'https:', 'ws:', 'wss:']);

/** Adres bu bilgisayarın kendisi mi (http/https/ws/wss; kullanıcı adı/parola yok; kapı ve yol serbest). */
export function loopbackMi(deger: string): boolean {
  let u: URL;
  try { u = new URL(deger.trim()); } catch { return false; }
  return PROTOKOLLER.has(u.protocol) && !u.username && !u.password && LOOPBACK_ADLARI.includes(u.hostname);
}

/** Bu sınıftaki değişken için değer kurulu uygulamada kabul edilir mi. */
export function adresKabulMu(deger: string, sinif: AdresSinifi): boolean {
  void sinif;
  return loopbackMi(deger);
}

// ── Yol kimliği (N-1) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Var olan bir yolun dosya sistemindeki gerçek yolu (Windows: fs.realpathSync.native — 8.3 kısa adı, junction'ı ve harfi çözer); yoksa ya da
 *  okunamıyorsa null. Ana süreç verir (main/ortam-kapisi.ts); testler gerçeğini ya da sahtesini verir. */
export type GercekYol = (p: string) => string | null;

/** Windows yolunu parçalarına ayırır ve Win32 gibi düzler; güvenilir biçimde yorumlanamıyorsa null (KAPALI kal). Kabul: yalnız `X:\…`
 *  (ve `\\?\X:\…`). Ret: UNC (`\\sunucu\pay`, `\\?\UNC\…`), aygıt (`\\.\…`), sürücüye göreli (`\x`, `/x`), göreli, `X:yol`, sürücüden sonra ':'
 *  (ADS, `::$INDEX_ALLOCATION`), NUL, yalnız noktalardan oluşan parça. `.`/`..` çözülür; parçaların sonundaki nokta ve boşluk atılır (Win32). */
export function yolParcalari(ham: string | undefined | null): { surucu: string; parcalar: string[] } | null {
  let s = String(ham ?? '').trim();
  if (!s || s.includes('\0')) return null;
  s = s.replace(/\//g, '\\');
  if (/^\\\\\?\\[A-Za-z]:\\/.test(s)) s = s.slice(4);
  if (s.startsWith('\\')) return null;
  if (!/^[A-Za-z]:\\/.test(s)) return null;
  if (s.slice(2).includes(':')) return null;
  const parcalar: string[] = [];
  for (const x of s.slice(3).split('\\')) {
    if (x === '' || x === '.') continue;
    if (x === '..') { parcalar.pop(); continue; }
    const d = x.replace(/[. ]+$/, '');
    if (!d) return null;
    parcalar.push(d);
  }
  return { surucu: s.slice(0, 2).toUpperCase(), parcalar };
}

/** Karşılaştırma anahtarı: Windows büyük/küçük harf duyarsız (tek kod birimli büyük harfe çevirerek; ß→SS gibi genişlemeler yapılmaz). */
const anahtar = (s: string): string => [...s].map((c) => { const u = c.toUpperCase(); return u.length === c.length ? u : c; }).join('');

/** Yolun kimliği: var olan en yakın üst klasör gerçek yoluna çevrilir (`gercekYol`), kalan parçalar eklenir. Çözülemezse null. Gerçek yol UNC
 *  çıkarsa (ağ sürücüsü) null. Dönen: `X:\A\B` (anahtar biçiminde, karşılaştırmaya hazır). */
export function kanonikYol(ham: string | undefined | null, gercekYol: GercekYol): string | null {
  const y = yolParcalari(ham);
  if (!y) return null;
  for (let i = y.parcalar.length; i >= 0; i--) {
    const aday = `${y.surucu}\\${y.parcalar.slice(0, i).join('\\')}`;
    let g: string | null = null;
    try { g = gercekYol(aday); } catch { g = null; }
    if (g === null) continue;
    const gy = yolParcalari(g);
    if (!gy) return null;
    return anahtar([gy.surucu, ...gy.parcalar, ...y.parcalar.slice(i)].join('\\'));
  }
  return null;
}

/** İki kanonik yol aynı mı ya da biri ötekinin içinde mi. */
function ayniYaDaIcIce(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}\\`) || b.startsWith(`${a}\\`);
}

/** Yalıtılmış (test) profil mi: veri klasörü verilmiş, kimliği çözülebiliyor, varsayılan veri klasörü değil — onun içinde ya da üstünde de değil.
 *  Varsayılan klasör çözülemezse KAPALI (false). */
export function yalitilmisProfilMi(veri: string | undefined | null, varsayilanVeri: string, gercekYol: GercekYol): boolean {
  const a = kanonikYol(veri, gercekYol);
  if (!a) return false;
  const b = kanonikYol(varsayilanVeri, gercekYol);
  if (!b) return false;
  return !ayniYaDaIcIce(a, b);
}

export interface OrtamKarari {
  /** Ortamdan silinecek değişkenler (kod varsayılana döner). */
  sil: string[];
  /** Günlüğe yazılacak sakin uyarılar (değer YOK, yalnız ad ve kural). */
  uyarilar: string[];
  /** Yalıtılmış profil (FUBER_VERI kuralı). */
  yalitilmis: boolean;
  /** Test kipi: FUBER_DEMO + yalıtılmış profil (kararın ardından). */
  testKipi: boolean;
  /** Kurulu uygulamada FUBER_VERI verilmiş ama yalıtılmış değil → uygulama açılmaz. */
  veriGecersiz: boolean;
  /** Açılmama durumunda kullanıcıya kutu gösterilsin mi: arka plan test kipinde (özgün FUBER_DEMO) ve yalıtılmış profilde HAYIR (yalnız günlük). */
  kutu: boolean;
}

/** Kurulu uygulamanın ortam kararı. Paketsizde boş (hiçbir şey değişmez). Boş/yalnız boşluk adres değerine dokunulmaz (kod zaten varsayılanı
 *  kullanır). `varsayilanVeri`: uygulamanın varsayılan veri klasörü (appData + ürün adı; --user-data-dir'den bağımsız); `gercekYol`: dosya
 *  sistemi çözücüsü (verilmezse hiçbir yol çözülemez → yalıtılmış değil). */
export function paketliOrtamKarari(env: Record<string, string | undefined>, paketli: boolean, o: { varsayilanVeri?: string; gercekYol?: GercekYol } = {}): OrtamKarari {
  const veriVar = Boolean((env.FUBER_VERI ?? '').trim());
  const yalitilmis = paketli && veriVar ? yalitilmisProfilMi(env.FUBER_VERI, o.varsayilanVeri ?? '', o.gercekYol ?? (() => null)) : false;
  const arkaPlanIstegi = Boolean(env.FUBER_DEMO) && env.FUBER_GORUNUR !== '1';
  const karar: OrtamKarari = { sil: [], uyarilar: [], yalitilmis, testKipi: Boolean(env.FUBER_DEMO), veriGecersiz: false, kutu: !arkaPlanIstegi && !yalitilmis };
  if (!paketli) return karar;
  const sil = (ad: string, uyari: string | null) => { if (!karar.sil.includes(ad)) { karar.sil.push(ad); if (uyari) karar.uyarilar.push(uyari); } };
  for (const [ad, sinif] of Object.entries(ADRES_DEGISKENLERI)) {
    const deger = env[ad];
    if (deger === undefined || !deger.trim() || adresKabulMu(deger, sinif)) continue;
    sil(ad, `${ad} yok sayıldı: kurulu uygulama bu hizmet için yalnız bu bilgisayarın kendi adresini (localhost, 127.0.0.1, [::1]) kabul eder; varsayılan kullanılıyor.`);
  }
  for (const ad of RUN_AS_NODE_KANCALARI) {
    if ((env[ad] ?? '').trim()) sil(ad, `${ad} yok sayıldı: kurulu uygulamada RunAsNode kapalı; sahte betik uygulamanın kendi exe'siyle çalıştırılamaz.`);
  }
  for (const ad of KURULUDA_SILINEN_KANCALAR) {
    if (env[ad] !== undefined) sil(ad, (env[ad] ?? '').trim() ? `${ad} yok sayıldı: kurulu uygulamada bu test kancası hiçbir profilde geçerli değil.` : null);
  }
  for (const ad of GUVENLIK_DEGISKENLERI) {
    const d = env[ad];
    if (d === undefined) continue;
    if (ad === 'NODE_TLS_REJECT_UNAUTHORIZED') sil(ad, d.trim() === '1' ? null : `${ad} yok sayıldı: kurulu uygulamada TLS sertifika doğrulaması kapatılamaz.`);
    else sil(ad, d.trim() ? `${ad} yok sayıldı: kurulu uygulama TLS oturum anahtarlarını dosyaya yazmaz.` : null);
  }
  if (!yalitilmis) {
    const kanca = (ad: string) => `${ad} yok sayıldı: kurulu uygulamada test kancaları yalnız yalıtılmış bir test profilinde (FUBER_VERI) geçerli.`;
    for (const ad of [...PROFIL_KANCALARI, ...ARKA_PLAN_DEGISKENLERI]) if ((env[ad] ?? '').trim()) sil(ad, kanca(ad));
    for (const ad of Object.keys(env).sort()) if (PROFIL_KANCASI_ONEKLERI.some((on) => ad.toUpperCase().startsWith(on)) && (env[ad] ?? '').trim()) sil(ad, kanca(ad));
  }
  if (veriVar && !yalitilmis) {
    karar.veriGecersiz = true;
    karar.uyarilar.push('FUBER_VERI kabul edilmedi: kurulu uygulama yalnız yerel, varsayılan veri klasöründen ayrı bir test klasörüyle açılır; uygulama açılmadı.');
  }
  const ab = env.ANTHROPIC_BASE_URL;
  if (ab !== undefined && ab.trim() && !loopbackMi(ab)) {
    karar.uyarilar.push(`ANTHROPIC_BASE_URL Fuber’in kendi Claude çağrılarında yok sayılıyor (yalnız bu bilgisayarın adresi kabul edilir; Claude Code’a olduğu gibi geçer).`);
  }
  karar.testKipi = yalitilmis && Boolean(env.FUBER_DEMO) && !karar.sil.includes('FUBER_DEMO');
  return karar;
}

/** Kurulu uygulamada açılışı durduracak bayraklar (`varMi`: bayrak komut satırında mı). Yalıtılmış profilde Playwright'ın CDP bayrağı serbest.
 *  `ek`: uygulamaya özgü ek yasaklar (Fuber AI: MASAUSTU_EK_YASAK). */
export function yasakliBayraklar(varMi: (ad: string) => boolean, o: { paketli: boolean; yalitilmis: boolean; ek?: readonly string[] }): string[] {
  if (!o.paketli) return [];
  return [...YASAK_BAYRAKLAR, ...(o.ek ?? [])].filter((b) => varMi(b) && !(o.yalitilmis && YALITILMIS_PROFILDE_SERBEST.includes(b)));
}

/** Fuber'in kendi Claude (Anthropic SDK) çağrılarının adresi: paketsizde undefined (SDK ortamı kendisi okur — testler ve geliştirme);
 *  kurulu uygulamada ANTHROPIC_BASE_URL yalnız loopback ise o, değilse https://api.anthropic.com. process.env'e dokunulmaz. */
export function anthropicTabani(env: Record<string, string | undefined>, paketli: boolean): string | undefined {
  if (!paketli) return undefined;
  const d = (env.ANTHROPIC_BASE_URL ?? '').trim();
  return d && loopbackMi(d) ? d.replace(/\/+$/, '') : ANTHROPIC_SUNUCUSU;
}

/** Son bütün dal incelemesi K-2: Windows `fuberai` protokol kaydı (HKCU; main.ts) yalnız GERÇEK profilde. Arka plan test kipi (FUBER_DEMO) ve
 *  yalıtılmış test profili (FUBER_VERI — gercek-*-testi'nin paketli test kopyası; kurulu uygulamada FUBER_VERI ancak yalıtılmışsa kalır, değilse
 *  kapı uygulamayı durdurur) kurulu uygulamanın kaydını kendi exe'sine çevirmez: Google dönüşü silinmiş ya da başka bir exe'ye gitmesin.
 *  Kurulu uygulamada yalıtılmamış profildeki FUBER_DEMO kapıda silinir — gerçek kullanıcının kaydı yine tazelenir. */
export function protokolKaydiSerbestMi(env: Record<string, string | undefined>): boolean {
  return !env.FUBER_DEMO && !(env.FUBER_VERI ?? '').trim();
}

/** Ayar dosyasından gelen sunucu adresi (ör. kopru.adres): kurulu uygulamada kurala uymuyorsa varsayılan. */
export function kuruluSunucuAdresi(deger: string, varsayilan: string, paketli: boolean, sinif: AdresSinifi = 'sunucu'): string {
  return paketli && !adresKabulMu(deger, sinif) ? varsayilan : deger;
}

// ── Süreç durumu: kapı bir kez kurar (main/ortam-kapisi.ts); adres seçen modüller ve Hakkında okur. Electron'a bağlı olmadan sınanabilsin
//    diye burada (testler `kuruluOrtamiKaydet` ile kurar). Paketsizde ve testte varsayılan: paketli değil, uyarı yok.
let paketliSurec = false;
let sonUyarilar: readonly string[] = [];
export function kuruluOrtamiKaydet(paketli: boolean, uyarilar: readonly string[]): void { paketliSurec = paketli; sonUyarilar = Object.freeze([...uyarilar]); }
export const paketliSurecMi = (): boolean => paketliSurec;
export const kuruluOrtamUyarilari = (): readonly string[] => sonUyarilar;
