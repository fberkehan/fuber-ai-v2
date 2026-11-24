// ── "Önerilen araçlar": Claude Code için küratörlü, sürümü/kaynağı sabit eklenti listesi (Görev 29, K18; adı 0.10'da K8) ──────────────
// 26 Eki: Graphify gibi eklentiler ilk kurulumda hazır yüklenir; kişinin ihtiyaç duyduğu araçlar hazır olur.
// 27 Eki, K8: Graphify sponsorlu öğe gibi sunulmaz; seçilebilir ama öne çıkarılmaz, Apple ürünü gibi
// hissettirir. → arayüzde adı "Önerilen araçlar"; her araç tek satır ad + tek kısa, sade cümle; Graphify sıradan bir öğe (kartta uyarı
// yok; yalnız sorun gerçekten algılanınca hata hâli: graphifySorunu). Kaynak, lisans, nereye yazdığı, ağ, gereksinim, not ve kaldırma
// yalnız "Ayrıntılar"da. Yalnız Geliştirici modunda (İş modunda adım, sekme ve kanal etkisi YOK). Testler: tests/cc-eklentiler.test.ts.
//
// Kurulum (main/claudecode/eklenti-kurucu.ts):
//   · Katalog eklentileri: kullanıcının KENDİ Claude Code'u kendi resmi katalogundan kurar (`claude plugin install <ad>@claude-plugins-official
//     -s user --json`). Fuber hiçbir eklentiyi paketlemez, dağıtmaz, dosyasını yazmaz; Claude Code'un kendi dosyalarına (settings.json,
//     ~/.claude.json) doğrudan dokunulmaz.
//   · Graphify (katalogda yok): sabit sürümlü uv (GitHub sürüm arşivi; SHA-256 tutmadan AÇILMAZ) uygulama veri klasörüne →
//     `uv tool install graphifyy==0.9.95` → `graphify install --platform windows` (Claude Code becerisi + arama araçlarından önce kanca).
//     Paket adı TAM OLARAK `graphifyy` (çift y): PyPI'da benzer adlı sahte paketler var (Ruling CC; test sabitler).
//
// Lisanslar: Graphify'ınki PyPI/depo kaydına göre Apache-2.0 + MIT. Üçüncü taraf eklentilerin lisansı kendi kaynak deposundaki lisanstır;
// Anthropic'in yazdığı katalog eklentilerinin lisansı katalog deposunun koşullarıdır. Fuber eklentileri dağıtmadığı için kurulum kullanıcının
// Claude Code'u ile katalog arasındadır.

/** Resmi katalog: Claude Code'da tanımlı değilse `claude plugin marketplace add anthropics/claude-plugins-official --scope user`. */
export const CC_KATALOG = 'claude-plugins-official';
export const CC_KATALOG_DEPOSU = 'anthropics/claude-plugins-official';

/** Graphify'ın PyPI paketi (çift y) ve sabit sürümü (Ruling CC; denetleyici PyPI'dan doğruladı, 23 Eki: requires_python >= 3.10). */
export const GRAPHIFY_PAKETI = 'graphifyy';
export const GRAPHIFY_SURUMU = '0.9.95';
/** Bilgi için (denetim izi): PyPI tekerleğinin özeti. Geçişli bağımlılıkları uv çözer; araç kurulumunda olağan yol (Ruling CC). */
export const GRAPHIFY_TEKER_SHA256 = 'e067c9256e5e762406816e51039c4e775f8d2f39a893ecc0b7095d594f6c3120';
export const GRAPHIFY_GEREKSINIMI = `${GRAPHIFY_PAKETI}==${GRAPHIFY_SURUMU}`;

/** uv: astral-sh/uv 0.13.5 Windows x64 arşivi (denetleyici GitHub sürüm sayfasından doğruladı, 22 Eki). Özet tutmazsa açılmaz. */
export const UV_SURUMU = '0.13.5';
export const UV_ARSIVI = {
  url: 'https://github.com/astral-sh/uv/releases/download/0.13.5/uv-x86_64-pc-windows-msvc.zip',
  boyut: 15_264_056,
  sha256: 'a38b8d1902b7cfbc76b423ba1bb456f623f42064cdc72628b6075b89afd1019a',
} as const;
/** Arşivden yalnız bunlar çıkarılır (arşivdeki yol hiç kullanılmaz: dosya adıyla hedef klasöre yazılır). */
export const UV_DOSYALARI = ['uv.exe', 'uvx.exe', 'uvw.exe'] as const;

/** Claude Code'un resmi Windows yükleyicisi (kullanıcı tıklayınca, GÖRÜNÜR PowerShell penceresinde). */
export const CC_YUKLEYICI_KOMUTU = 'irm https://claude.ai/install.ps1 | iex';

export type PaketTuru = 'katalog' | 'graphify';

export interface PaketOgesi {
  /** Fuber'in kimliği (katalog eklentisinde katalogdaki ad). */
  id: string;
  /** Görünen ad. */
  ad: string;
  /** Kısa etiket (iki-üç sözcük; sihirbazın sıkı ızgarası). */
  kisa: string;
  /** Ne kazandırır: Türkçe, TEK kısa ve sade cümle (K8: ≤ 80 karakter, övgü yok). */
  kazanc: string;
  tur: PaketTuru;
  /** Kaynak: katalog ve sağlayıcı / paket ve depo. */
  kaynak: string;
  /** Lisans (kaynakta bilindiği gibi; yukarıdaki not). */
  lisans: string;
  /** Nereye yazar (kullanıcıya gösterilir). */
  yazdigiYer: readonly string[];
  /** Ağ davranışı (kurulumda ve kullanırken). */
  ag: string;
  /** Gereksinim (boş değil; yoksa "Yalnız Claude Code"). */
  gereksinim: string;
  /** ★ Sihirbazda ve önerilenlerde varsayılan seçili. */
  varsayilan: boolean;
  /** Ek uyarılar (ayrıntıda "Not"). */
  notlar?: readonly string[];
  /** Nasıl kaldırılır (ayrıntıda "Kaldırma"; elle temizlik dahil). */
  kaldirma?: string;
  /** Sürüm (ayrıntıda "Sürüm"; yalnız sürümü sabit öğede — Graphify). */
  surum?: string;
  /**
   * @deprecated K8 (0.10): kartta öğeye özel not GÖSTERİLMEZ (hiçbir öğede dolu değil; alan eski içe aktarmalar bozulmasın diye durur).
   * Graphify'ın kancası bozulursa ana süreç algılar (EklentiDurumu.graphify) ve kart yalnız o zaman hata hâli gösterir (graphifySorunu).
   */
  kartNotu?: string;
}

/** Graphify'ın Claude Code'a kurduğu beceri klasörü adı/adları (TAM eşleşme: kullanıcının «graphify-notlar» gibi becerisi Graphify'ınki değildir). */
export const GRAPHIFY_BECERILERI: readonly string[] = ['graphify'];

const KATALOGDAN = `Claude Code'un resmi kataloğu (${CC_KATALOG})`;
const EKLENTI_YERI = ['~/.claude/plugins (eklenti dosyaları; Claude Code yazar)', '~/.claude/settings.json → enabledPlugins (Claude Code yazar)'] as const;
const KATALOG_AGI = 'Kurulumda Claude Code eklentiyi GitHub’daki resmi katalogdan indirir.';
const ANTHROPIC_LISANSI = 'Anthropic — katalog deposunun koşulları';

export const GELISTIRICI_PAKETI: readonly PaketOgesi[] = [
  // ── ★ Varsayılan seçili (9) ──
  {
    id: 'superpowers', ad: 'Superpowers', kisa: 'Çalışma disiplini', tur: 'katalog', varsayilan: true,
    kazanc: 'Plan, test ve hata ayıklama için adım adım çalışma becerileri ekler.',
    kaynak: `${KATALOGDAN} · github.com/obra/superpowers`, lisans: 'MIT',
    yazdigiYer: [...EKLENTI_YERI], ag: KATALOG_AGI, gereksinim: 'Yalnız Claude Code',
  },
  {
    id: 'frontend-design', ad: 'Frontend Design', kisa: 'Arayüz tasarımı', tur: 'katalog', varsayilan: true,
    kazanc: 'Özenli, şablon gibi durmayan arayüzler tasarlamaya yardım eder.',
    kaynak: `${KATALOGDAN} · Anthropic`, lisans: ANTHROPIC_LISANSI,
    yazdigiYer: [...EKLENTI_YERI], ag: KATALOG_AGI, gereksinim: 'Yalnız Claude Code',
  },
  {
    id: 'code-review', ad: 'Code Review', kisa: 'Kod incelemesi', tur: 'katalog', varsayilan: true,
    kazanc: 'Değişiklikleri ve PR’ları hata, güvenlik ve kalite açısından inceler.',
    kaynak: `${KATALOGDAN} · Anthropic`, lisans: ANTHROPIC_LISANSI,
    yazdigiYer: [...EKLENTI_YERI], ag: `${KATALOG_AGI} PR incelemesinde GitHub’a gh komutuyla bağlanır.`, gereksinim: 'Claude Code · PR için gh (GitHub CLI)',
  },
  {
    id: 'feature-dev', ad: 'Feature Dev', kisa: 'Özellik geliştirme', tur: 'katalog', varsayilan: true,
    kazanc: 'Yeni bir özelliği keşiften uygulamaya adım adım yürütür.',
    kaynak: `${KATALOGDAN} · Anthropic`, lisans: ANTHROPIC_LISANSI,
    yazdigiYer: [...EKLENTI_YERI], ag: KATALOG_AGI, gereksinim: 'Yalnız Claude Code',
  },
  {
    id: 'context7', ad: 'Context7', kisa: 'Güncel belgeler', tur: 'katalog', varsayilan: true,
    kazanc: 'Kütüphanelerin güncel belgelerini ve örneklerini getirir.',
    kaynak: `${KATALOGDAN} · Upstash (github.com/upstash/context7)`, lisans: 'MIT',
    yazdigiYer: [...EKLENTI_YERI, 'Eklentinin MCP sunucusu (Claude Code başlatır)'],
    ag: `${KATALOG_AGI} Belge sorguları Upstash’in Context7 hizmetine gider.`, gereksinim: 'Claude Code · Node.js (npx)',
  },
  {
    id: 'playwright', ad: 'Playwright', kisa: 'Tarayıcı testi', tur: 'katalog', varsayilan: true,
    kazanc: 'Gerçek bir tarayıcıda sayfaları açıp test eder.',
    kaynak: `${KATALOGDAN} · Microsoft (github.com/microsoft/playwright-mcp)`, lisans: 'Apache-2.0',
    yazdigiYer: [...EKLENTI_YERI, 'Eklentinin MCP sunucusu (Claude Code başlatır)', 'İlk kullanımda npm önbelleği ve tarayıcı dosyaları'],
    ag: `${KATALOG_AGI} İlk kullanımda npm’den @playwright/mcp ve tarayıcı iner; gezilen sitelere bağlanır.`, gereksinim: 'Claude Code · Node.js (npx)',
  },
  {
    id: 'claude-md-management', ad: 'CLAUDE.md Management', kisa: 'CLAUDE.md bakımı', tur: 'katalog', varsayilan: true,
    kazanc: 'Projelerdeki CLAUDE.md dosyalarını denetler ve güncel tutar.',
    kaynak: `${KATALOGDAN} · Anthropic`, lisans: ANTHROPIC_LISANSI,
    yazdigiYer: [...EKLENTI_YERI, 'Senin onayınla projedeki CLAUDE.md'], ag: KATALOG_AGI, gereksinim: 'Yalnız Claude Code',
  },
  {
    id: 'commit-commands', ad: 'Commit Commands', kisa: 'Git kısayolları', tur: 'katalog', varsayilan: true,
    kazanc: 'Commit, push ve PR açmayı tek komuta indirir.',
    kaynak: `${KATALOGDAN} · Anthropic`, lisans: ANTHROPIC_LISANSI,
    yazdigiYer: [...EKLENTI_YERI], ag: `${KATALOG_AGI} Push ve PR’da git ve gh ağa çıkar.`, gereksinim: 'Claude Code · git (PR için gh)',
  },
  // R20 (0.10; K8): Graphify önerilenlerin sonunda ve ötekilerle aynı biçimde/boyda (tek kaynak satırı, sürüm ayrı; not / kaldırma yok).
  {
    id: 'graphify', ad: 'Graphify', kisa: 'Kod grafiği', tur: 'graphify', varsayilan: true,
    kazanc: 'Kod tabanından sorgulanabilir bir bilgi grafiği çıkarır.',
    kaynak: `PyPI (${GRAPHIFY_PAKETI}) · github.com/Graphify-Labs/graphify`, surum: GRAPHIFY_SURUMU,
    lisans: 'Apache-2.0 + MIT',
    yazdigiYer: [
      '~/.claude/skills ve ~/.claude/settings.json (beceri ve aramadan önce çalışan kanca)',
      'Proje klasöründe graphify-out/ (grafik çıktısı)',
      'Uygulama veri klasörü (uv ortamı) ve ~/.local/bin/graphify.exe',
    ],
    ag: 'Kurulumda uv ve PyPI’dan paket iner; telemetri yok. Fuber’in açtığı oturumlarda sorgu günlüğü kapalı (GRAPHIFY_QUERY_LOG_DISABLE=1).',
    gereksinim: 'Windows · Claude Code · Python ≥ 3.10 (yoksa uv indirir)',
  },
  // ── İsteğe bağlı (10) ──
  {
    id: 'security-guidance', ad: 'Security Guidance', kisa: 'Güvenlik uyarıları', tur: 'katalog', varsayilan: false,
    kazanc: 'Dosya düzenlenirken yaygın güvenlik açıklarına karşı uyarır.',
    kaynak: `${KATALOGDAN} · Anthropic`, lisans: ANTHROPIC_LISANSI,
    yazdigiYer: [...EKLENTI_YERI, 'Eklentinin düzenleme kancası (eklentinin içinden)'], ag: KATALOG_AGI, gereksinim: 'Yalnız Claude Code',
  },
  {
    id: 'pr-review-toolkit', ad: 'PR Review Toolkit', kisa: 'PR inceleme ekibi', tur: 'katalog', varsayilan: false,
    kazanc: 'PR’ları uzman ajanlarla birkaç açıdan inceler.',
    kaynak: `${KATALOGDAN} · Anthropic`, lisans: ANTHROPIC_LISANSI,
    yazdigiYer: [...EKLENTI_YERI], ag: KATALOG_AGI, gereksinim: 'Claude Code · gh (GitHub CLI)',
  },
  {
    id: 'typescript-lsp', ad: 'TypeScript LSP', kisa: 'TS/JS dil sunucusu', tur: 'katalog', varsayilan: false,
    kazanc: 'TypeScript ve JavaScript’te tanıma gitme ve anlık hata bilgisi verir.',
    kaynak: `${KATALOGDAN} · Anthropic`, lisans: ANTHROPIC_LISANSI,
    yazdigiYer: [...EKLENTI_YERI, 'Dil sunucusu yapılandırması (eklentinin içinden)'], ag: KATALOG_AGI, gereksinim: 'Claude Code · typescript-language-server (npm)',
  },
  {
    id: 'pyright-lsp', ad: 'Pyright LSP', kisa: 'Python dil sunucusu', tur: 'katalog', varsayilan: false,
    kazanc: 'Python’da tip denetimi ve kod gezintisi sağlar.',
    kaynak: `${KATALOGDAN} · Anthropic`, lisans: ANTHROPIC_LISANSI,
    yazdigiYer: [...EKLENTI_YERI, 'Dil sunucusu yapılandırması (eklentinin içinden)'], ag: KATALOG_AGI, gereksinim: 'Claude Code · pyright (npm ya da pip)',
  },
  {
    id: 'serena', ad: 'Serena', kisa: 'Anlamsal kod araçları', tur: 'katalog', varsayilan: false,
    kazanc: 'Kodu sembol düzeyinde bulma ve düzenleme araçları ekler.',
    kaynak: `${KATALOGDAN} · Oraios (github.com/oraios/serena)`, lisans: 'MIT',
    yazdigiYer: [...EKLENTI_YERI, 'Eklentinin MCP sunucusu (Claude Code başlatır)', '~/.serena (Serena’nın kendi ayarları)'],
    ag: `${KATALOG_AGI} İlk kullanımda uvx Serena’yı GitHub’dan indirir.`, gereksinim: 'Claude Code · uv (uvx)',
  },
  {
    id: 'github', ad: 'GitHub', kisa: 'GitHub bağlantısı', tur: 'katalog', varsayilan: false,
    kazanc: 'Issue, PR ve depo işlerini Claude Code’un içinden yapar.',
    kaynak: `${KATALOGDAN} · GitHub (github.com/github/github-mcp-server)`, lisans: 'MIT',
    yazdigiYer: [...EKLENTI_YERI, 'Eklentinin MCP sunucusu (Claude Code başlatır)'],
    ag: `${KATALOG_AGI} Kullanırken GitHub’ın MCP hizmetine kendi GitHub kimliğinle bağlanır.`, gereksinim: 'Claude Code · GitHub kişisel erişim belirteci',
  },
  {
    id: 'chrome-devtools-mcp', ad: 'Chrome DevTools', kisa: 'Chrome hata ayıklama', tur: 'katalog', varsayilan: false,
    kazanc: 'Chrome’u DevTools ile izleyip performans ve hata ayıklaması yapar.',
    kaynak: `${KATALOGDAN} · Google (github.com/ChromeDevTools/chrome-devtools-mcp)`, lisans: 'Apache-2.0',
    yazdigiYer: [...EKLENTI_YERI, 'Eklentinin MCP sunucusu (Claude Code başlatır)'],
    ag: `${KATALOG_AGI} İlk kullanımda npm’den sunucu iner; açılan sayfalara bağlanır.`, gereksinim: 'Claude Code · Node.js (npx) · Chrome',
  },
  {
    id: 'session-report', ad: 'Session Report', kisa: 'Oturum raporu', tur: 'katalog', varsayilan: false,
    kazanc: 'Claude Code kullanımından okunur bir rapor çıkarır.',
    kaynak: `${KATALOGDAN} · Anthropic`, lisans: ANTHROPIC_LISANSI,
    yazdigiYer: [...EKLENTI_YERI], ag: KATALOG_AGI, gereksinim: 'Yalnız Claude Code',
  },
  {
    id: 'skill-creator', ad: 'Skill Creator', kisa: 'Beceri üretici', tur: 'katalog', varsayilan: false,
    kazanc: 'Kendi becerilerini yazmana ve sınamana yardım eder.',
    kaynak: `${KATALOGDAN} · Anthropic`, lisans: ANTHROPIC_LISANSI,
    yazdigiYer: [...EKLENTI_YERI, 'Senin istediğin yerde yeni beceri klasörleri'], ag: KATALOG_AGI, gereksinim: 'Yalnız Claude Code',
  },
  {
    id: 'code-simplifier', ad: 'Code Simplifier', kisa: 'Kod sadeleştirme', tur: 'katalog', varsayilan: false,
    kazanc: 'Değişen kodu davranışı bozmadan sadeleştirir.',
    kaynak: `${KATALOGDAN} · Anthropic`, lisans: ANTHROPIC_LISANSI,
    yazdigiYer: [...EKLENTI_YERI], ag: KATALOG_AGI, gereksinim: 'Yalnız Claude Code',
  },
];

export const paketOgesi = (id: string): PaketOgesi | undefined => GELISTIRICI_PAKETI.find((o) => o.id === id);
/** Katalog eklentisinin Claude Code kimliği (`ad@claude-plugins-official`). */
export const eklentiKimligi = (o: Pick<PaketOgesi, 'id'>) => `${o.id}@${CC_KATALOG}`;
/** Öğe bu işletim sisteminde Fuber'den kurulabilir mi (Graphify yalnız Windows; platform bilinmiyorsa evet). */
export const ogeDesteklenirMi = (o: Pick<PaketOgesi, 'tur'>, platform?: string) => o.tur !== 'graphify' || !platform || platform === 'win32';
/** Sihirbazın ve önerilenlerin varsayılan seçimi (★; bu işletim sisteminde kurulamayan — Windows dışında Graphify — seçili gelmez). */
export const varsayilanSecim = (platform?: string): string[] => GELISTIRICI_PAKETI.filter((o) => o.varsayilan && ogeDesteklenirMi(o, platform)).map((o) => o.id);
/** Arayüzden/kayıttan gelen seçim: yalnız bilinen kimlikler, tekrar yok, paketin sırasıyla. */
export function secimiSuz(secim: unknown): string[] {
  const l = Array.isArray(secim) ? new Set(secim.filter((x): x is string => typeof x === 'string')) : new Set<string>();
  return GELISTIRICI_PAKETI.filter((o) => l.has(o.id)).map((o) => o.id);
}

// ── Durum (ana süreç → arayüz; 'claudecode:eklenti' olayı ve 'claudecode:eklenti-durum') ──────────────────────────────────────
/**
 * Paketteki bir öğenin hâli: sirada (kuyrukta), bekliyor (Claude Code kurulunca), kuruluyor, kuruldu (bu kez kuruldu), kurulu (zaten
 * kuruluydu: atlandı), onay (kurulum komutu gösterildi, onayın bekleniyor), hata (biri düşse de ötekiler sürer), reddedildi (komutu onaylamadın).
 */
export type OgeHali = 'sirada' | 'bekliyor' | 'kuruluyor' | 'kuruldu' | 'kurulu' | 'onay' | 'hata' | 'reddedildi';
/**
 * Claude Code'un `--json` çıktısındaki `shownCommand` (kurulu 2.1.310 ikilisinden statik okundu): `{kind, pluginId, command, mode |
 * archiveUrl, catalogRevision, sha256}`. sha256 bu beşliyi kapsar (`--accept-command` yalnız TAM bu komutu onaylar). Fuber komutu
 * KISALTMADAN ve görünmeyen karakterleri görünür yaparak gösterir; sığmayacak kadar uzunsa uygulama içi onay hiç sunulmaz.
 * (sha256 yerelde yeniden hesaplanmıyor: ikilinin dizileştiricisi belgesiz — yanlış hesap doğru komutu reddederdi.)
 */
export interface KomutOnayi { komut: string; sha256: string; tur?: string; pluginId?: string; arsivAdresi?: string; mod?: string; katalogSurumu?: string }
/** Onay kartında TAMAMI (kaydırmadan, kartın kendisinde) gösterilebilen en uzun komut (aşarsa onay sunulmaz, kurulmaz). */
export const KOMUT_GOSTERIM_SINIRI = 1000;
/** Komutun en çok satır sayısı (aşarsa onay sunulmaz). */
export const KOMUT_SATIR_SINIRI = 20;
/** Kartta gösterilen öteki alanların (kip, katalog sürümü) sınırı; arşiv adresi komut sınırında. Aşan alan KISALTILMAZ: onay sunulmaz. */
export const ALAN_GOSTERIM_SINIRI = 200;
export const KOMUT_COK_UZUN = 'Bu eklentinin kurulum komutu burada gösterilemeyecek kadar uzun; kurulmadı.';
export const ALAN_COK_UZUN = 'Bu eklentinin kurulum bilgisi burada gösterilemeyecek kadar uzun; kurulmadı.';
export const KOMUT_BICIMI_BILINMIYOR = 'Claude Code bu eklentinin kurulum komutunu tanımadığım bir biçimde bildirdi; kurulmadı.';

// İzin listesi (sertleştirme): yalnız yazdırılabilir ASCII (U+0020–U+007E) ve komutta satır sonu düz gösterilir. Gerisi İŞARETLENİR:
//  · gizli — görünmeyen ya da görünüşü/yönü değiştiren karakter (denetim, biçim [yön, sıfır genişlik, etiket], tanımsız/özel kullanım,
//    ASCII boşluk dışındaki her boşluk [NBSP, U+2000–U+200A], satır/paragraf ayırıcı, birleşen işaret [U+034F, değişken seçiciler
//    U+FE00–FE0F ve U+E0100–E01EF], varsayılan-yok-sayılır harfler [Hangul doldurucuları], Braille boşluğu): yerinde YALNIZ "⟨U+00A0⟩";
//  · işaretli — öteki ASCII dışı (harf, simge; ör. İbranice, Kiril benzeri harfler): okunur kalır ama yanında kodu ve işareti var; yön
//    etkisi kartta yalıtılır (unicode-bidi: isolate).
const GIZLI_SINIF = /^[\p{C}\p{Z}\p{M}\p{Default_Ignorable_Code_Point}]$/u;
const kodu = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
export interface KomutParcasi { metin: string; tur?: 'gizli' | 'isaretli'; kod?: string }
/**
 * Metni gösterim parçalarına böler (KISALTMAZ): ASCII yazdırılabilir dizileri düz; gizli karakter `{tur:'gizli', metin:'U+00A0'}`;
 * öteki ASCII dışı `{tur:'isaretli', metin:<karakter>, kod:'U+05D0'}`. `satirSonu: false` (tek satırlık alanlar) satır sonunu da gizler.
 */
export function komutParcalari(s: string, { satirSonu = true }: { satirSonu?: boolean } = {}): { parcalar: KomutParcasi[]; gizliVar: boolean; isaretliVar: boolean } {
  const parcalar: KomutParcasi[] = [];
  let duz = '';
  const bosalt = () => { if (duz) { parcalar.push({ metin: duz }); duz = ''; } };
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x20 && cp <= 0x7e) || (cp === 0x0a && satirSonu)) { duz += ch; continue; }
    bosalt();
    if (cp < 0x80 || cp === 0x2800 || GIZLI_SINIF.test(ch)) parcalar.push({ metin: kodu(cp), tur: 'gizli', kod: kodu(cp) });
    else parcalar.push({ metin: ch, tur: 'isaretli', kod: kodu(cp) });
  }
  bosalt();
  return { parcalar, gizliVar: parcalar.some((p) => p.tur === 'gizli'), isaretliVar: parcalar.some((p) => p.tur === 'isaretli') };
}
/** Düz metin gösterim (günlük, test): gizli "⟨U+00A0⟩", işaretli "א⟨U+05D0⟩". */
export const komutGorunur = (s: string, o?: { satirSonu?: boolean }) => komutParcalari(s, o).parcalar.map((p) => (p.tur === 'gizli' ? `⟨${p.metin}⟩` : p.tur === 'isaretli' ? `${p.metin}⟨${p.kod}⟩` : p.metin)).join('');
/**
 * Kurulum komutunun türü (shownCommand.kind) Türkçe (B-25: iç değer arayüze sızmasın). Ayrıştırıcı (eklenti-kurucu.ts) yalnız bu iki türü
 * kabul eder; bilinmeyen tür onay kartında hiç gösterilmez.
 */
export const TUR_ADI: Record<string, string> = { entry_helper: 'Kurulum yardımcısı', command_source: 'Komut kaynağı' };
/**
 * Onay kartının satırları (komut dışında): tür, eklenti, indirilecek arşiv, kip, katalog sürümü. `duz`: Fuber'in kendi sözlüğünden gelen
 * metin (tür adı; Türkçe harfleri "ASCII dışı" diye işaretlenmez, ham değer `ham`da ipucunda); öteki alanlar Claude Code'dan gelir ve
 * görünmeyen/yön değiştiren karakter denetiminden geçer.
 */
export function onayAyrintilari(o: KomutOnayi): { etiket: string; deger: string; duz?: true; ham?: string }[] {
  return [
    ...(o.tur && Object.hasOwn(TUR_ADI, o.tur) ? [{ etiket: 'Tür', deger: TUR_ADI[o.tur], duz: true as const, ham: o.tur }] : []),
    ...(o.pluginId ? [{ etiket: 'Eklenti', deger: o.pluginId }] : []),
    ...(o.arsivAdresi ? [{ etiket: 'İndirilecek arşiv', deger: o.arsivAdresi }] : []),
    ...(o.mod ? [{ etiket: 'Mod', deger: o.mod }] : []),
    ...(o.katalogSurumu ? [{ etiket: 'Katalog sürümü', deger: o.katalogSurumu }] : []),
  ];
}
export interface PaketOgeDurumu { id: string; hal: OgeHali; ileti?: string; onay?: KomutOnayi; asama?: string; zaman?: string }
export interface PaketDurumu {
  /** Sihirbazın "Geliştirici araçları" adımı (ya da mod değişince gelen teklif) görüldü mü. */
  adimGoruldu: boolean;
  calisiyor: boolean;
  /** Kuyrukta Claude Code'un kurulmasını bekleyen öğe var. */
  claudeBekleniyor: boolean;
  ogeler: PaketOgeDurumu[];
  /** Kurulum günlüğünün yolu (gösterim; sır yazılmaz). */
  gunluk: string;
}
export interface CcKurulumDurumu { kurulu: boolean; girisYapildi?: boolean; yontem?: string; /** Resmi yükleyici açıldı, kurulum bekleniyor. */ yukleyiciAcik?: boolean; hata?: string }
/**
 * Graphify'ın Claude Code kancasının denetimi (ana süreç; eklenti-kurucu.ts graphifyDenetle; yalnız okur). `kanca`: ~/.claude/settings.json'da
 * graphify'ı çağıran bir kanca var. `calistirilabilir`: kancanın çağıracağı graphify bulunuyor (Fuber'in uv ortamına bağlı bir uv kısayoluysa
 * o ortam da yerinde). Kanca var ama graphify yoksa her Claude Code oturumu bu kancaya takılır (M3) → Eklentiler'de hata hâli.
 */
export interface GraphifyDenetimi { kanca: boolean; calistirilabilir: boolean }
export interface EklentiDurumu { claude: CcKurulumDurumu; paket: PaketDurumu; /** Yalnız ana süreç denetimi verdiyse (eski sürümde yok). */ graphify?: GraphifyDenetimi }

export interface KuruluEklenti { id: string; ad: string; katalog?: string; surum?: string; kapsam?: string; etkin: boolean; yol?: string; hatalar: string[]; mcp: string[]; paketteMi: boolean; aciklama?: string }
export interface Beceri { ad: string; aciklama: string; yol: string; kaynak: 'kullanici' | 'graphify' }
export type McpHali = 'bagli' | 'hata' | 'bekliyor' | 'bilinmiyor';
export interface McpSunucu { ad: string; hedef: string; hal: McpHali; durumMetni: string; kaynak: 'kullanici' | 'eklenti' | 'claude.ai'; kaldirilabilir: boolean }
export interface KatalogOgesi { id: string; ad: string; aciklama: string; katalog: string; kurulu: boolean; surum?: string; kurulumSayisi?: number; /** Eklentinin kaynağı (depo / adres; `source` dize ya da nesne). */ kaynak?: string }
export type ListeTuru = 'eklenti' | 'beceri' | 'mcp' | 'katalog';
export interface ListeSonucu<T> { liste: T[] | null; hata?: string; zaman: number }

/** Bir öğe "tamam" mı (kuruldu ya da zaten kurulu). */
export const tamamMi = (h: OgeHali | undefined) => h === 'kuruldu' || h === 'kurulu';
/** Paket ilerlemesinin kısa özeti ("7 kurulu · 1 kuruluyor · 1 onay bekliyor"). */
export function paketOzeti(p: Pick<PaketDurumu, 'ogeler'>): { tamam: number; suren: number; onay: number; hata: number; bekleyen: number; toplam: number } {
  const say = (f: (h: OgeHali) => boolean) => p.ogeler.filter((o) => f(o.hal)).length;
  return {
    tamam: say(tamamMi), suren: say((h) => h === 'kuruluyor' || h === 'sirada'), onay: say((h) => h === 'onay'), hata: say((h) => h === 'hata'),
    bekleyen: say((h) => h === 'bekliyor'), toplam: p.ogeler.filter((o) => o.hal !== 'reddedildi').length,
  };
}

// ── Görev 7 (0.10; B-7, B-23, B-25, B-32): Eklentiler sekmesinin tek kaynaklı sayaçları ve görünen adları ─────────────────────────────
export interface PaketSayaci { onerilen: number; hazir: number; kurulacak: number; onayBekleyen: number; /** "hata" hâlindeki öğe (kurulamadı; bozuk Graphify kancası dahil). */ sorunlu: number }
/**
 * Önerilen araçların sayacı — menü "8/9", bölüm başlığı "1 kurulacak", sağ üst "1 onay bekliyor" / "1 araçta sorun" HEPSİ bu tanımdan (B-23;
 * düzeltme turu 1: ayrıca "+1" yok). Payda yalnız önerilenler (★; bu işletim sisteminde kurulamayan — Windows dışında Graphify — sayılmaz);
 * isteğe bağlılar paydaya girmez. `onayBekleyen` ve `sorunlu` listedeki her öğeyi sayar. `durum.paket.ogeler` öğelerin GEÇERLİ hâlidir
 * (Eklentiler sekmesi her öğeyi gecerliHal ile çözer: başka yoldan kurulmuş araç hazır, kancası bozuk Graphify "hata").
 */
export function paketSayaci(liste: readonly PaketOgesi[], durum: Pick<EklentiDurumu, 'paket'> | null | undefined, platform?: string): PaketSayaci {
  const hal = (o: PaketOgesi) => durum?.paket.ogeler.find((x) => x.id === o.id)?.hal;
  const onerilenler = liste.filter((o) => o.varsayilan && ogeDesteklenirMi(o, platform));
  const hazir = onerilenler.filter((o) => tamamMi(hal(o))).length;
  return {
    onerilen: onerilenler.length, hazir, kurulacak: onerilenler.length - hazir,
    onayBekleyen: liste.filter((o) => hal(o) === 'onay').length, sorunlu: liste.filter((o) => hal(o) === 'hata').length,
  };
}

/**
 * Bir önerilen aracın GEÇERLİ hâli (satır ve sayaçlar için tek çözücü; düzeltme turu 1): kayıttaki hâl (`x`), Claude Code'daki kurulu
 * listeler (`kurulu`: eklenti / Graphify becerisi listede; `listelerVar`: listeler okundu) ve Graphify kancasının sorunu.
 *   · Graphify'ın kancası bozuk (graphifySorunu) ve onarım sürmüyorsa → TEK hâl: `hata`, ileti sorun metni (onarım düştüyse son nedeni de).
 *   · Kayıtta "kuruldu" ama Claude Code'da artık yok (başka yoldan kaldırıldı) → kurulmamış (undefined).
 *   · Kayıtta yok ama listede var (başka yoldan kurulmuş) → `kurulu`.
 */
export function gecerliHal(o: PaketOgesi, x: PaketOgeDurumu | undefined, b: { kurulu: boolean; listelerVar: boolean; graphifySorunu?: string | null }): PaketOgeDurumu | undefined {
  if (o.tur === 'graphify' && b.graphifySorunu && x?.hal !== 'sirada' && x?.hal !== 'kuruluyor') {
    const neden = x?.hal === 'hata' && x.ileti && x.ileti !== b.graphifySorunu ? ` Son deneme: ${x.ileti}` : '';
    return { id: o.id, hal: 'hata', ileti: `${b.graphifySorunu}${neden}` };
  }
  const silinmis = Boolean(x && tamamMi(x.hal) && !b.kurulu && b.listelerVar);
  if (x && x.hal !== 'reddedildi' && !silinmis) return x;
  if (b.kurulu) return { id: o.id, hal: 'kurulu' };
  return silinmis ? undefined : x;
}

/**
 * Eklentiler sekmesinin TEK çözücüsü (düzeltme turu 2): her öğeyi gecerliHal ile, kendi türünün listesine bakarak çözer — Graphify
 * Beceriler listesine (~/.claude/skills; eşzamanlı okunur), katalog eklentileri Kurulu eklentiler listesine (`claude plugin list`; geç gelebilir,
 * düşebilir). Bir türün listesi henüz okunmadıysa ya da okunamadıysa (`null`) o türde kayıttaki hâl geçerlidir: öğe hiçbir zaman yanlışlıkla
 * "kurulacak" sayılmaz (yalnız beceriler gelmişken "1/9", "8 aracı kur" görünmez).
 */
export function ogeCozucu(
  durum: { paket: Pick<PaketDurumu, 'ogeler'>; graphify?: GraphifyDenetimi } | null | undefined,
  listeler: { eklentiler: readonly { id: string }[] | null | undefined; beceriler: readonly { kaynak: string }[] | null | undefined },
): (o: PaketOgesi) => PaketOgeDurumu | undefined {
  const gs = graphifySorunu(durum ?? null);
  return (o) => {
    const graphifyMi = o.tur === 'graphify';
    const liste = graphifyMi ? listeler.beceriler : listeler.eklentiler;
    const kurulu = graphifyMi ? Boolean(listeler.beceriler?.some((b) => b.kaynak === 'graphify')) : Boolean(listeler.eklentiler?.some((e) => e.id === eklentiKimligi(o)));
    return gecerliHal(o, durum?.paket.ogeler.find((x) => x.id === o.id), { kurulu, listelerVar: Boolean(liste), graphifySorunu: gs });
  };
}

/**
 * "Seçilenleri kur"un göndereceği seçim (düzeltme turu 1, 4e): kurulu öğe YENİDEN kuyruğa girmez (sessiz yeniden kurulum yok); kancası bozuk
 * Graphify de girmez (onun tek eylemi satırındaki "Yeniden kur"); bu bilgisayarda kurulamayan girmez. Süren ya da onay bekleyen seçili öğe
 * gönderilir ki kuyruktan düşmesin (paketBaslat seçimde olmayan bitmemiş öğeyi düşürür). `yeni`: gerçekten kurulacaklar (düğmenin sayısı).
 */
export function kurulumSecimi(secim: readonly string[], hal: (o: PaketOgesi) => PaketOgeDurumu | undefined, b: { platform?: string; graphifySorunu?: string | null } = {}): { gonderilecek: string[]; yeni: string[] } {
  const gonderilecek: string[] = [], yeni: string[] = [];
  for (const id of secimiSuz(secim)) {
    const o = paketOgesi(id)!;
    if (!ogeDesteklenirMi(o, b.platform)) continue;
    const h = hal(o)?.hal;
    if (tamamMi(h) || (o.tur === 'graphify' && b.graphifySorunu)) continue;
    gonderilecek.push(id);
    if (h !== 'sirada' && h !== 'kuruluyor' && h !== 'onay') yeni.push(id);
  }
  return { gonderilecek, yeni };
}

/**
 * MCP sunucusunun hâli Türkçe (B-25): `claude mcp list`in ham metni ("✓ Connected", "Failed to connect") ya da ayrıştırılmış hâl (bagli,
 * hata, bekliyor, bilinmiyor). Ham metin arayüzde yalnız ipucunda kalır.
 */
export function mcpHalAdi(hal: string): 'Bağlı' | 'Bağlanamadı' | 'Bekliyor' {
  const h = String(hal ?? '').trim().toLowerCase();
  if (/✗|fail|error|hata|not connected|disconnected/.test(h)) return 'Bağlanamadı';
  if (h === 'bagli' || /✓|\bconnected\b/.test(h)) return 'Bağlı';
  return 'Bekliyor';
}
/** MCP sunucusunun görünen adı (B-25): eklentinin sunucusu "plugin:playwright:playwright" → "playwright (Playwright eklentisinden)". */
export function mcpGorunenAd(ad: string): string {
  const m = /^plugin:([^:]+):(.+)$/i.exec(ad.trim());
  return m ? `${m[2]} (${paketOgesi(m[1])?.ad ?? m[1]} eklentisinden)` : ad;
}

/** Graphify'ın kancası bozukken (kanca var, graphify yok) Önerilen araçlar'daki Graphify satırının tek hata metni (K8: başka zaman not yok). */
export const GRAPHIFY_SORUNU = 'Graphify bulunamıyor ama Claude Code’daki kancası duruyor; Claude Code oturumları bu kancaya takılabilir.';
/** Graphify'ın kancası kurulu ama çağıracağı `graphify` bulunamıyorsa hata metni; değilse (ya da ana süreç denetim vermediyse) null. */
export function graphifySorunu(d: { graphify?: GraphifyDenetimi } | null | undefined): string | null {
  return d?.graphify?.kanca && !d.graphify.calistirilabilir ? GRAPHIFY_SORUNU : null;
}

/**
 * Gösterilen yol (B-7): tek ayraç (/), "~" korunur; uzun yolun ortası "…" — eklenti klasörü "~/.claude/plugins/…/superpowers" (ad
 * verilirse adın son geçtiği parça, verilmezse son parça). Ayraçlar karışık yazılmaz.
 */
export function ekYolu(yol: string, ad?: string): string {
  const on = (/^[\\/]+/.exec(yol)?.[0] ?? '').replace(/\\/g, '/');
  const p = yol.split(/[\\/]+/).filter(Boolean);
  if (p.length <= 5) return on + p.join('/');
  const i = ad ? p.map((x) => x.toLowerCase()).lastIndexOf(ad.toLowerCase()) : -1;
  return on + [...p.slice(0, 3), '…', i >= 3 ? p[i] : p[p.length - 1]].join('/');
}

/** Katalogdaki sürüm kuruludan YENİ mi (B-32: satırda "Güncelle" yalnız bilinen yeni sürümde). Noktalı sayısal sürümler; biçim tanınmazsa false. */
export function yeniSurumVar(kurulu?: string, katalog?: string): boolean {
  const coz = (s?: string) => { const m = /^v?(\d+(?:\.\d+)*)$/i.exec(String(s ?? '').trim()); return m ? m[1].split('.').map(Number) : null; };
  const a = coz(kurulu), b = coz(katalog);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] ?? 0, y = b[i] ?? 0; if (x !== y) return y > x; }
  return false;
}
