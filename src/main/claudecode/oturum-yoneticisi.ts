// ── Claude Code oturum yöneticisi (Görev 27, K17): uygulama içi oturumlar, terminal gerekmez ─────────────────────────────────────
// Resmi Agent SDK (@anthropic-ai/claude-agent-sdk) `query({ prompt: AsyncIterable<SDKUserMessage>, options })` AKIŞ GİRDİSİ kipinde;
// yürütülebilir dosya kullanıcının KURULU claude.exe'si (pathToClaudeCodeExecutable + kendi spawnClaudeCodeProcess kancamız: PID
// izlenir, kapanışta süreç ağacıyla öldürülür). Ham control_request protokolü elle YAZILMAZ: hepsi SDK'nın genel yöntemleri
// (interrupt, setPermissionMode, setModel, supportedCommands, supportedModels) ve canUseTool geri çağrısıyla.
//  • Eşzamanlılık: aynı anda en çok 4 ÇALIŞAN tur; fazlası sırada (görünür, sıra numarasıyla). Bir oturumun turu sürerken yazılan
//    mesaj o oturumun kuyruğuna girer (görünür, sınırlı), tur bitince sıraya gider. Boştaki süreçler sayılmaz; 8'i aşınca en eskisi
//    kapatılır (sonraki mesajda `resume` ile açılır; o an başka yerde açıksa sürdürülmez).
//  • İzin: canUseTool → bekleyen izin kaydı + 'izin-istegi' olayı; yanıt gelene dek SÜRESİZ bekler (SDK'nın sözleşmesi). "Bu oturumda
//    hep izin ver" yalnız oturum kapsamında (updatedPermissions → destination 'session'). AskUserQuestion: updatedInput {questions,
//    answers}; yanıtlar sorulan sorulara uymalı.
//  • Telefon (Ruling CA): telefondan başlatılan/sürdürülen oturum en çok "Düzenlemelere izin ver" (Tam yetki asla; süreç Tam yetki
//    izniyle açılmaz), açık oturuma telefondan mesaj gitmez. Son dalga B (I1): kullanıcının ~/.claude allow kuralları (ör. `Bash(*)`)
//    telefon oturumunda komutu masada onaysız çalıştırmasın diye süreç SDK'nın `managedSettings` politika katmanıyla açılır
//    (CC_UZAK_POLITIKA: allowManagedPermissionRulesOnly + `ask: Bash, PowerShell` → her komut canUseTool'a, masadaki izin kartına gelir;
//    gerçek ikiliyle doğrulandı: scripts/dev/cc-gercek-duman.mjs). Politikanın bu makinede etkin olduğu SDK'nın kendi birleştirme
//    motoruyla (resolveSettings) önceden denetlenir; yöneticinin kendi politika katmanı onu düşürüyorsa ya da denetlenemiyorsa
//    oturumda Bash/PowerShell KAPALI (kapalı başarısızlık).
//  • Sohbet aracı (I2): sohbetin claude_code_gorev'inden başlayan oturum da en çok "Düzenlemelere izin ver" (mod tavanı); tavan yalnız
//    kullanıcı o oturumda masada açıkça Tam yetki seçince kalkar.
//  • Klasör güveni (I1, klasor-guveni.ts): klasörün kendi .claude/settings*.json / .mcp.json / komut-beceri-ajanı varsa ve kullanıcı ona
//    masada güvenmediyse (ya da henüz karar vermediyse) settingSources ['user'] — kancaları, izin kuralları, MCP sunucuları, CLAUDE.md'si
//    yüklenmez. Sayfadan (kaynak 'sayfa') ilk oturum karar verilmeden açılmaz ('klasor-guveni'); telefon ve sohbet aracı kartı
//    yanıtlayamaz: güvenilmemiş sayılır.
//  • Çökme: süreç beklenmedik biçimde biterse oturum "hata" hâline geçer; sonraki mesaj `resume` ile sürdürür.
//  • Kapanış: önce interrupt(), en çok 5 sn turların bitmesi beklenir, sonra close(); kalan süreç ağacıyla öldürülür — yetim kalmaz.
//    Yalnız bizim ve yaşayan süreçler öldürülür (çıkışta PID unutulur; yeniden kullanılan PID'ye dokunulmaz).
//  • Akış parçaları dökümde blok başına TEK birikimli kayıt (tam metin gelince onunla değişir); yayın oturum başına ~50 ms'de bir.
// Electron'a bağlı DEĞİL: yayın, bildirim, ayar ve "başka yerde açık" kancaları dışarıdan verilir (main/claudecode/yonetim.ts).
import { randomUUID } from 'node:crypto';
import { chromeBayraklari } from '../../shared/chrome-baglanti.ts';
import fs from 'node:fs';
import path from 'node:path';
import type { Query, SDKUserMessage, PermissionResult, PermissionUpdate, CanUseTool, SpawnedProcess, Settings, SettingSource, HookCallback, ResolvedSettings } from '@anthropic-ai/claude-agent-sdk';
import { ccNormallestir, yeniBaglam, izinIstegiOlayi, soruCevaplariniDogrula, ccModMu, kisalt, CC_KIMLIK_RE, CC_MODEL_RE, CC_MASADA_ACIK, CC_VARSAYILAN_MODELLER, arkaPlanSifirla, ccParaGosterilir, ccEforMu,
  type CcEfor, type CcMod, type CcDurum, type CcKaynak, type CcArkaIs,
  type CcOlay, type CcOlayZarfi, type CcOturumOzeti, type CcOturumAyrintisi, type CcIzinIstegi, type CcSonuc, type CcYapilacak, type CcBelirtec,
  type CcNormalBaglam } from '../../shared/cc-olay.ts';
import { ccModSecilebilir, ccBaslangicModu, ccTavanliMod } from '../../shared/cc-ayar.ts';
import { ccHataAciklamasi, ccCokusAciklamasi } from '../../shared/cc-hata.ts';
import { surecBaslat, guvenliOldur, izlenenMi, bizimPidler, type CcKomut } from './yurutucu.ts';
import type { BizimIzler } from './dokum.ts';
import { claudeDizini } from './indeks.ts';
import { klasorGuvenDurumu, klasorAyarlariYuklenir, guvenAnahtari, iceride, korunanKlasorDenetimi, varsayilanKlasorSinirlari, gercekYolBilgisi, sinirGercek, surucuHarfi, agYoluMu, supheliYazim, type GuvenKaydi, type GercekYolBilgisi,
  type KlasorGuvenDurumu, type KlasorSinirlari } from './klasor-guveni.ts';

export interface CcGorsel { medya: string; veri: string }
export interface CcBaslatIstegi {
  cwd: string; istem?: string; gorseller?: CcGorsel[];
  /** Sürdürülecek Claude Code oturum kimliği (`resume`). */
  surdur?: string;
  /** `surdur` ile: yeni kimlikle çatalla (`forkSession`). */
  catalla?: boolean;
  mod?: CcMod; model?: string | null; baslik?: string; kaynak?: CcKaynak; sohbetId?: number;
  /** Düşünme gücü (SDK Options.effort; low … max). Açılışta `effort`; canlı oturumda eforDegistir (applyFlagSettings). Verilmezse varsayılan. */
  efor?: string | null;
  /** Telefondan geldi (telefonun sohbet turu dahil): mod en çok acceptEdits; açık oturuma mesaj gitmez. kaynak 'telefon' da öyle. */
  uzak?: boolean;
  /** "Başka yerde açık" denetimini atla (kullanıcı uyarıyı gördü ve yine de istedi). */
  zorla?: boolean;
}
export interface CcIzinYaniti {
  karar: 'izin' | 'hep' | 'ret'; neden?: string;
  /** AskUserQuestion: soru metni → seçenek etiketi (çoklu seçimde dizi ya da virgüllü) ya da serbest metin. */
  cevaplar?: Record<string, string | string[]>;
  /** "Diğer" ile serbest metin yanıtlanan sorular. */
  serbest?: string[];
}
export interface CcIslemSonucu { tamam: boolean; hata?: string; kod?: string }
/** Bir işin (Bash arka plan) çıktı kuyruğu: son satırlar; dosya yok/okunamıyorsa `hata`. */
export interface CcIsCiktisi { satirlar: string[]; boyut: number; hata?: string }
export interface CcKomutBilgisi { ad: string; aciklama: string; ipucu: string; yerlesik: boolean; takmaAdlar: string[] }
export interface CcModelBilgisi { deger: string; ad: string; aciklama: string }
/** Hesap satırı (SDK accountInfo): YALNIZ e-posta ve plan; kuruluş adı, belirteç kaynağı ve API anahtarı kaynağı ana süreçten çıkmaz. */
export interface CcHesapBilgisi { eposta?: string; plan?: string }
/** `sohbetId` yalnız sohbetten verilen İŞİN bitişinde (bir kez) gelir: sohbete özet yazılır. */
export interface CcTurBilgisi { sonuc: CcSonuc; sonMetin: string; degisenDosyalar: string[]; kaynak: CcKaynak; sohbetId?: number }

export interface CcYoneticiSecenekleri {
  /** Çalıştırılacak claude (testte sahte zorunlu: yurutucu.ts ccKomutu). Atarsa oturum "hata" olur. */
  komut: () => CcKomut;
  ayar: () => { tamYetki: boolean; varsayilanMod: CcMod; chrome?: boolean };
  /** 13 Kas: Claude eklentisi kullanıcının Chrome'unda kurulu mu (eşzamanlı, yalnız okur). Ayar açık VE kuruluysa süreç `--chrome` ile açılır. */
  chromeKurulu?: () => boolean;
  olay?: (z: CcOlayZarfi) => void;
  izinBekliyor?: (o: CcOturumOzeti, istek: CcIzinIstegi) => void;
  /** Bir tur bitti (zorla durdurma dahil) ve oturumun kuyruğu boş: ada bildirimi; `sohbetId` varsa sohbete özet. */
  turBitti?: (o: CcOturumOzeti, b: CcTurBilgisi) => void;
  /** Çökme; `sohbetId` sohbetten verilen iş sürüyorduysa (sohbete yazılır). */
  hataOldu?: (o: CcOturumOzeti, hata: string, sohbetId?: number) => void;
  baskaYerdeMi?: (kimlik: string, bizim: BizimIzler) => Promise<{ acik: boolean; neden?: string }>;
  /** CLAUDE_AGENT_SDK_CLIENT_APP (User-Agent). */
  istemci?: string;
  azamiEsZamanli?: number;
  azamiCanliSurec?: number;
  /** Kapalı oturum kaydı sınırı (fazlası unutulur; döküm JSONL'den okunabilir). */
  azamiKapali?: number;
  kapanisSuresiMs?: number;
  kesmeBeklemeMs?: number;
  kapatmaBeklemeMs?: number;
  /** Akış parçası yayın aralığı (ms). */
  parcaAraligiMs?: number;
  /** Klasör güveni (I1): masada verilmiş karar (N3: kararın parmak iziyle; yoksa karar verilmemiş = güvenilmemiş). */
  klasorGuveni?: (cwd: string) => GuvenKaydi | undefined;
  /** Kullanıcının ~/.claude'u (klasör taramasında "klasörün ayarı" sayılmaz). Varsayılan indeks.ts claudeDizini. */
  kullaniciDizini?: () => string;
  /** Telefon politikası (CC_UZAK_POLITIKA) bu makinede etkin mi. Varsayılan ccUzakPolitikaEtkinMi (SDK resolveSettings). */
  uzakPolitikaDenetimi?: (cwd: string) => Promise<boolean>;
  /** Düzeltme turu (N2): telefondan/sohbetten açılamayan klasörler ve düzenleme koruması. Varsayılan varsayilanKlasorSinirlari(). */
  klasorSinirlari?: () => KlasorSinirlari;
  /** Model listesinin kalıcı kaydı (0.13 T12): oturum açılmadan önce (taslakta) son bilinen liste gösterilsin. Yoksa yalnız bellek. */
  modellerOku?: () => unknown; // dosyadan okunan ham veri; geçerli model adlarına süzülür
  modellerYaz?: (liste: CcModelBilgisi[]) => void;
}

/**
 * Ruling CA + son dalga B (I1): telefondan başlayan/sürdürülen oturumun süreci bu politika katmanıyla açılır (SDK `managedSettings`; CLI
 * `--managed-settings`). SDK bunu yalnız kısıtlayıcı anahtarlarla geçirir (resolveSettings belgesi: allowManaged*Only kilitleri,
 * permissions.deny/ask): kullanıcı/proje/yerel ayarlardaki ALLOW kuralları yok sayılır, Bash ve PowerShell HER çağrıda sorulur
 * (ask kuralı allow kuralını da yerleşik "salt okur komut" onayını da yener) → canUseTool → masadaki izin kartı. Tam yetki kapalı.
 * Düzeltme turu: `allowManagedHooksOnly` — kullanıcının, projenin ve kullanıcının kurduğu eklentilerin kancaları telefon oturumunda
 * çalışmaz (Fuber'in kendi SDK kancası ayrı: süreç seçeneği, ayar dosyası değil — gerçek ikiliyle doğrulandı).
 */
export const CC_UZAK_POLITIKA: Settings = {
  allowManagedPermissionRulesOnly: true,
  allowManagedHooksOnly: true,
  permissions: { ask: ['Bash', 'PowerShell'], disableBypassPermissionsMode: 'disable' },
};
const UZAK_KOMUT_ARACLARI = ['Bash', 'PowerShell'];
/** Komut çalıştıran araçlar (telefon oturumunda SDK kancası her çağrıda masaya sorar; politika katmanından bağımsız). */
export const CC_KOMUT_ARACLARI = new Set(['Bash', 'PowerShell', 'Monitor']);
const DUZENLEME_ARACLARI = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const nesneMi = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

/**
 * Düzeltme turu (CA kemer-askı + N2): her sürece kayıtlı SDK PreToolUse kancasının kararı (saf; birim testli). Masaya sorulacaksa
 * nedeni, değilse null. Kanca 'ask' döner → Claude Code canUseTool'a (masadaki izin karta) sorar; mod ve izin kurallarından bağımsız.
 *  • Telefon oturumu (uzak): Bash, PowerShell, Monitor ve MCP araçları HER çağrıda (politika katmanı düşse bile).
 *  • Telefon ya da sohbet aracı oturumu (tavan): Edit/Write/MultiEdit/NotebookEdit hedefi oturum klasörünün DIŞINDAYSA (AppData dahil),
 *    korunan bir klasördeyse (Fuber'in verisi, ~/.claude, Başlangıç, PowerShell profili) ya da klasörün kendi `.claude/`, `.mcp.json`,
 *    `.git/` dosyalarıysa — "Düzenlemelere izin ver" (ya da --add-dir / additionalDirectories) bunları sormadan onaylardı.
 *    Gerçek ikiliyle doğrulandı: kancanın 'ask'i canUseTool'a `decisionReason` = bu metinle gelir; allowManagedHooksOnly onu durdurmaz.
 */
export function ccOnKancaKarari(o: { uzak: boolean; tavan: boolean; cwd: string; sinirlar: KlasorSinirlari; arac: string; girdi: unknown; coz?: (p: string) => GercekYolBilgisi }): string | null {
  if (o.uzak && (CC_KOMUT_ARACLARI.has(o.arac) || o.arac.startsWith('mcp__'))) return 'Telefondan açılan oturumda komutlar ve dış araçlar masada onaylanır.';
  if (!(o.uzak || o.tavan) || !DUZENLEME_ARACLARI.has(o.arac)) return null;
  const g = nesneMi(o.girdi) ? o.girdi : {};
  const hedef = typeof g.file_path === 'string' && g.file_path ? g.file_path : typeof g.notebook_path === 'string' && g.notebook_path ? g.notebook_path : '';
  if (!hedef) return 'Düzenleme hedefi belirsiz; masada onaylanır.';
  // Düzeltme turu 2: şüpheli yazım (ağ/aygıt yolu, alternatif veri akışı, 8.3 kısa ad, sonu nokta/boşluk) her zaman sorulur; sonra hem
  // hedef hem cwd GERÇEK hâline çevrilir (en derin var olan ata realpath.native: bağlantı/junction ve kısa adlar çözülür).
  const supheli = supheliYazim(hedef);
  if (supheli) return `Hedefin yazımı şüpheli (${supheli}); masada onaylanır.`;
  // Düzeltme turu 3 (C): `cwd` oturum kaydına SABİTLENMİŞ gerçek klasördür (açılışta ve sürdürmede çözülür); burada yeniden çözülmez —
  // klasör sonradan bağlantıyla değiştirilirse (TOCTOU) karşılaştırma yine sabit yolla yapılır.
  const kok = o.cwd;
  const ham = path.resolve(kok, hedef);
  // E: başka sürücüdeki hedef çözülmeye çalışılmaz (kopuk ağ sürücüsü kancayı bekletirdi); oturum klasörünün dışıdır.
  if (surucuHarfi(ham) !== surucuHarfi(kok)) return 'Oturum klasörünün dışına yazım masada onaylanır.';
  const r = (o.coz ?? gercekYolBilgisi)(ham);
  // A: yolda hedefi olmayan bağlantı (ör. proje\fl.txt → var olmayan dışarı\yeni.txt) ya da erişilemeyen öğe: yazım bağlantının hedefine düşer.
  if (r.cozulemeyen) return 'Hedefin yolunda çözülemeyen bir bağlantı var; masada onaylanır.';
  // B: gerçek hâli ağ yolu (eşlenmiş sürücü, ağa giden bağlantı).
  if (agYoluMu(r.yol)) return 'Hedefin gerçek yolu bir ağ yolu; masada onaylanır.';
  const tam = r.yol;
  if (!iceride(kok, tam)) return 'Oturum klasörünün dışına yazım masada onaylanır.';
  // Klasör içindeki hedef: yalnız HASSAS klasörler (Fuber'in verisi, ~/.claude, Başlangıç, PowerShell profili). AppData (`ust`) burada
  // sayılmaz: cwd AppData'yı içeremez (N2), ama AppData'nın İÇİNDE olabilir (ör. Temp) — gerçek ikili koşusunda (D) klasör içi sıradan
  // yazım bu yüzden yanlışlıkla soruluyordu. E: sınırların gerçek hâlleri önbellekten.
  for (const h of o.sinirlar.hassas) if (iceride(sinirGercek(h), tam)) return 'Korunan bir klasöre yazım masada onaylanır.';
  const goreli = path.relative(kok, tam).split(path.sep).join('/').toLowerCase();
  // D: `.git/` klasörünün TAMAMI (kancalar, config, config.worktree, modules/*/hooks|config, worktrees/*) ve `.git` dosyası (gitdir
  // yönlendirmesi); `.claude/` ve `.mcp.json` alt klasörlerde de (iç içe depo, iç içe beceri klasörü).
  if (/(^|\/)(\.claude(\/|$)|\.mcp\.json$|\.git(\/|$))/.test(goreli)) return 'Claude Code ayarlarına, MCP yapılandırmasına ya da git klasörüne (kancalar, ayarlar) yazım masada onaylanır.';
  return null;
}
/** Klasörün ayarları yüklenmezken açılan süreçte yalnız kullanıcı kaynağı (proje ve yerel YOK). */
const GUVENSIZ_KAYNAKLAR: SettingSource[] = ['user'];
export const CC_GUVEN_GEREKLI = 'Bu klasörün kendi Claude Code ayarları var (kancalar, izin kuralları, MCP sunucuları). Önce güvenip güvenmediğini seç.';

/** Tek tüketicili, sonu kapatılabilir akış (SDK'nın `prompt` girdisi). */
class AkisKuyrugu<T> implements AsyncIterable<T> {
  private ogeler: T[] = [];
  private bekleyen: ((r: IteratorResult<T>) => void) | null = null;
  private bitti = false;
  it(x: T): void {
    if (this.bitti) return;
    if (this.bekleyen) { const b = this.bekleyen; this.bekleyen = null; b({ value: x, done: false }); } else this.ogeler.push(x);
  }
  bitir(): void {
    this.bitti = true;
    if (this.bekleyen) { const b = this.bekleyen; this.bekleyen = null; b({ value: undefined as never, done: true }); }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.ogeler.length) return Promise.resolve({ value: this.ogeler.shift()!, done: false });
        if (this.bitti) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((r) => { this.bekleyen = r; });
      },
      return: () => { this.bitir(); return Promise.resolve({ value: undefined as never, done: true }); },
    };
  }
}

interface BekleyenIzin { olay: CcIzinIstegi; girdi: Record<string, unknown>; oneriler: PermissionUpdate[]; coz: (r: PermissionResult) => void }
interface GidenMesaj { id: string; metin: string; gorseller?: CcGorsel[] }

interface Kayit {
  id: string; kimlik?: string; cwd: string; proje: string; baslik: string; kaynak: CcKaynak; sohbetId?: number;
  /** Sohbetten verilen iş sürüyor: bitince/çökünce sohbete BİR KEZ özet yazılır. */
  sohbetIsi: boolean;
  /** Telefondan başlatıldı/sürdürüldü: Tam yetki yok, süreç CC_UZAK_POLITIKA ile (masadan açıkça Tam yetki seçilince kalkar). */
  uzak: boolean;
  /** Mod tavanı (I2): telefondan ya da sohbet aracından başladı → en çok acceptEdits; masada açıkça Tam yetki seçilince kalkar. */
  tavan: boolean;
  /** Düzeltme turu 3 (C): tavan konduğunda (açılış, sürdürme, açık oturuma sohbetten iş) denetlenip SABİTLENEN gerçek klasör. Kanca
   *  hedefleri bununla karşılaştırır (k.cwd her çağrıda yeniden çözülmez); süreç açılmadan önce yeniden denetlenir. */
  kok?: string;
  /** uzak: CC_UZAK_POLITIKA bu makinede etkin mi (değilse süreçte Bash/PowerShell kapalı). */
  uzakPolitika?: boolean;
  /** Klasör ayarlarının yüklenmediği notu bu durum için dökümde bir kez. */
  guvenNotu?: string;
  mod: CcMod;
  /** Kullanıcının seçimi (takma ad ya da kimlik). Analiz 11 Kas bulgu 2: system/init bunu EZMEZ; init'in tam kimliği `etkinModel`de. */
  model?: string;
  etkinModel?: string;
  /** Düşünme gücü: her yeni süreç bu değerle açılır; canlı süreçte applyFlagSettings ile değişir (bulgu 1). */
  efor?: CcEfor;
  /** Canlı süreç düşünme gücünü uygulayamadı: tur bitince süreç kapatılır, sonraki mesaj yeni değerle açar. */
  eforSonraki?: boolean;
  /** Claude Code'un işleri (arka plan / ön plan): ad, hâl, süre, çıktı dosyası (bulgu 5). */
  arkaIsler: CcArkaIs[];
  /** Arka planda süren iş sayısı (CcOturumOzeti.arkaPlan) ve tahmini dolar gösterilsin mi (init apiKeySource; bilinmiyorsa false). */
  arkaPlan: number; paraGoster: boolean;
  /** Bu süreç için accountInfo() sorgusu yapıldı mı (süreç başına bir kez). */
  hesapSorgulandi?: boolean;
  /** Yalnız ilk süreç için: sürdür / çatalla. Sonraki süreçler `kimlik`i sürdürür. */
  ilk: { surdur?: string; catalla?: boolean };
  q?: Query; girdi?: AkisKuyrugu<SDKUserMessage>; pid?: number; stderr: string;
  canli: boolean; turAktif: boolean; sirada: boolean; kapatildi: boolean; kapatiliyor: boolean; kesmeIstendi: boolean;
  /** Süreç açıldığında verilen Tam yetki izni (allowDangerouslySkipPermissions). */
  tamYetkiIzni: boolean;
  hata?: string;
  kuyruk: GidenMesaj[];
  izinler: Map<string, BekleyenIzin>;
  olaylar: CcOlayZarfi[]; sira: number; baglam: CcNormalBaglam;
  /** Akış: blok → yayınlanmayı bekleyen parça; blok → dökümdeki birikimli kayıt. */
  parcaBekleyen: Map<string, { metin: string; ust: string | null }>; parcaZaman?: ReturnType<typeof setTimeout>; parcaGirdi: Map<string, CcOlayZarfi>;
  maliyet?: number; belirtec?: CcBelirtec; sureMs: number; turSayisi: number;
  /** Değişen dosyalar YALNIZ başarıyla biten düzenlemelerden (reddedilen sayılmaz). */
  degisen: Set<string>; bekleyenDuzenleme: Map<string, string>;
  yapilacaklar: CcYapilacak[]; sonMetin: string; sonSonuc?: CcSonuc;
  surum?: string; yetenekler: string[];
  sonBaslangic?: string; sonImza?: string;
  kesmeZamanlayici?: ReturnType<typeof setTimeout>;
  cikis?: Promise<void>;
  olusturma: number; sonEtkinlik: number;
}

// SDK (~1,3 MB ESM, ~60 ms) uygulama açılışında değil, ilk oturumda yüklenir (İş modunda hiç yüklenmez).
type SdkModulu = typeof import('@anthropic-ai/claude-agent-sdk');
let sdk: SdkModulu | null = null;
let sdkSozu: Promise<SdkModulu> | null = null;
const sdkYukle = () => (sdkSozu ??= import('@anthropic-ai/claude-agent-sdk').then((m) => (sdk = m), (e) => { sdkSozu = null; throw e; }));

const OLAY_SINIRI = 2000;
const KAPALI_OLAY_SINIRI = 200;
const GORSEL_SINIRI = 6 * 1024 * 1024;
const KUYRUK_SINIRI = 50;
const KUYRUK_GORSEL_SINIRI = 20;
const KUYRUK_GORSEL_BAYT = 32 * 1024 * 1024;
const MEDYA = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const bekle = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hataMetni = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ''));
/** Telefondan bilgisayarda açık oturuma komut verilemez (Ruling CA). */
export const MASADA_ACIK = CC_MASADA_ACIK;
const kesikSonuc = (): CcSonuc => ({ tur: 'sonuc', basarili: false, kesildi: true, sureMs: 0, turSayisi: 0, maliyetUsd: 0, belirtec: { girdi: 0, cikti: 0, onbellekOkuma: 0, onbellekYazma: 0 } });

/**
 * CC_UZAK_POLITIKA bu makinede GERÇEKTEN etkin mi: SDK'nın CLI ile aynı birleştirme motoru (resolveSettings; süreç başlatmaz). Makinede
 * yöneticinin kendi politika katmanı (sunucu / MDM / managed-settings.json) varsa SDK'nın verdiği katman varsayılan olarak DÜŞER — o
 * zaman ask kuralı yoktur ve telefon oturumunda komutlar kapatılır. Denetim yapılamazsa (SDK sürümünde yok, hata, 5 sn) da false.
 */
export async function ccUzakPolitikaEtkinMi(cwd: string, coz?: (o: { cwd: string; managedSettings: Settings }) => Promise<ResolvedSettings>, sureMs = 5000): Promise<boolean> {
  try {
    let f = coz;
    if (!f) {
      const m = await sdkYukle();
      if (typeof m.resolveSettings !== 'function') return false;
      f = m.resolveSettings;
    }
    const r = await Promise.race([f({ cwd, managedSettings: CC_UZAK_POLITIKA }), bekle(sureMs).then(() => null)]);
    return ccUzakPolitikaSonucu(r);
  } catch { return false; }
}

/** resolveSettings sonucundan karar (saf; birim testli): kilit + iki ask kuralı + kanca kilidi etkin değilse false. */
export function ccUzakPolitikaSonucu(r: Pick<ResolvedSettings, 'effective'> | null | undefined): boolean {
  const e = r?.effective;
  if (!e || typeof e !== 'object') return false;
  const ask = Array.isArray(e.permissions?.ask) ? e.permissions.ask : [];
  return e.allowManagedPermissionRulesOnly === true && e.allowManagedHooksOnly === true && UZAK_KOMUT_ARACLARI.every((a) => ask.includes(a));
}

/** Varsayılan politika denetimi. SDK yapılandırma dizinini ana süreçte ilk çağrıda belleğe alır: çocuk sürece başka bir CLAUDE_CONFIG_DIR
 *  verilmişse (testte FUBER_CLAUDE_DIZIN) iki taraf ancak ortam aynıysa tutarlıdır; değilse denetlenemez → kapalı. */
async function varsayilanUzakPolitika(cwd: string): Promise<boolean> {
  const f = process.env.FUBER_CLAUDE_DIZIN;
  if (f && path.resolve(process.env.CLAUDE_CONFIG_DIR || '.') !== path.resolve(f)) return false;
  return ccUzakPolitikaEtkinMi(cwd);
}

/** Süreç çıkış hatasını kullanıcıya gösterilecek kısa metne çevirir (stderr'in yalnız sonu; kısaltılır). */
function cokusMetni(e: unknown, stderr: string): string {
  const m = hataMetni(e);
  const kod = /exited with code (\d+)/.exec(m)?.[1];
  const sinyal = /terminated by signal (\w+)/.exec(m)?.[1];
  // 13 Kas: ham stderr/yığın izi/İngilizce SDK iletisi kullanıcıya gitmez; sınıflanır (giriş yok, ağ yok, Claude Code yok …) ya da arındırılıp kısaltılır.
  return ccCokusAciklamasi({ kod, sinyal, ileti: m }, stderr).metin;
}

export class CcYonetici {
  private kayitlar = new Map<string, Kayit>();
  private sira: string[] = [];
  private kapaniyor = false;
  /** Claude Code oturum kimliği → bizim sürecimizin o oturumda son kapandığı an ("başka yerde" için). */
  private kapanislar = new Map<string, number>();
  private readonly azami: number;
  private readonly azamiCanli: number;
  private readonly s: CcYoneticiSecenekleri;

  constructor(s: CcYoneticiSecenekleri) {
    this.s = s;
    this.azami = Math.max(1, s.azamiEsZamanli ?? 4);
    this.azamiCanli = Math.max(this.azami, s.azamiCanliSurec ?? 8);
  }

  // ── Okuma ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  oturumlar(): CcOturumOzeti[] {
    return [...this.kayitlar.values()].sort((a, b) => b.sonEtkinlik - a.sonEtkinlik).map((k) => this.ozet(k));
  }

  ozetAl(id: string): CcOturumOzeti | null {
    const k = this.kayitlar.get(id);
    return k ? this.ozet(k) : null;
  }

  oturum(id: string): CcOturumAyrintisi | null {
    const k = this.kayitlar.get(id);
    if (!k) return null;
    return {
      ...this.ozet(k),
      olaylar: k.olaylar.map((z) => ({ ...z })),
      bekleyenIzinler: [...k.izinler.values()].map((i) => i.olay),
      kuyrukMesajlari: k.kuyruk.map((m) => ({ id: m.id, metin: m.metin, gorselSayisi: m.gorseller?.length ?? 0 })),
      degisenDosyalar: [...k.degisen],
      yapilacaklar: k.yapilacaklar.slice(),
      arkaIsler: k.arkaIsler.map((i) => ({ ...i })),
    };
  }

  /** Süreci ŞU AN yaşayan oturumların kimlikleri (çatalda kaynak değil, çatalın kendi kimliği). */
  kimlikler(): Set<string> {
    const s = new Set<string>();
    for (const k of this.kayitlar.values()) if (k.canli && k.kimlik) s.add(k.kimlik);
    return s;
  }

  /** "Başka yerde açık" denetimi için: canlı kimlikler, son kapanışlarımız, bizim PID'lerimiz. */
  bizimIzler(): BizimIzler {
    return { canli: this.kimlikler(), kapanislar: new Map(this.kapanislar), pidler: new Set([...this.surecler(), ...bizimPidler()]) };
  }

  /** Yaşayan ve BİZİM Claude Code süreçlerimizin PID'leri (kapanış ve testler). */
  surecler(): number[] {
    return [...this.kayitlar.values()].map((k) => k.pid).filter((p): p is number => izlenenMi(p));
  }

  /** Tanılama/test: oturumun yaşayan sürecinin PID'i (çıkınca unutulur). */
  pid(id: string): number | undefined { return this.kayitlar.get(id)?.pid; }

  cwdler(): string[] { return [...new Set([...this.kayitlar.values()].map((k) => k.cwd))]; }

  // ── Başlat ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Klasörün güven durumu (kendi ayarı var mı, kayıtlı karar). Her süreç açılışında yeniden okunur (karar sonradan değişebilir). */
  guvenDurumu(cwd: string): KlasorGuvenDurumu {
    let kayit: GuvenKaydi | undefined;
    try { kayit = this.s.klasorGuveni?.(cwd); } catch { kayit = undefined; }
    let kullanici: string | undefined;
    try { kullanici = (this.s.kullaniciDizini ?? claudeDizini)(); } catch { kullanici = undefined; }
    return klasorGuvenDurumu(cwd, kayit, kullanici);
  }

  /** N2: telefondan/sohbetten açılamayan klasörler ve düzenleme koruması (Fuber'in verisi, ~/.claude, AppData, sistem). */
  private sinirlar(): KlasorSinirlari {
    try { if (this.s.klasorSinirlari) return this.s.klasorSinirlari(); } catch { /* varsayılan */ }
    let claude: string | undefined;
    try { claude = (this.s.kullaniciDizini ?? claudeDizini)(); } catch { claude = undefined; }
    return varsayilanKlasorSinirlari({ claudeDizini: claude });
  }

  /**
   * N1: sohbet aracının onay kartı için — bu iş hangi modda çalışacak. `kimlik` verilirse (sürdürülen oturum) oturumun ŞU ANKİ modu ve
   * tavanlı modu; yoksa yeni oturumun (kayıtlı varsayılan, tavanlı) modu.
   */
  sohbetModu(kimlik?: string): { simdiki?: CcMod; olacak: CcMod } {
    const k = kimlik ? [...this.kayitlar.values()].filter((x) => x.kimlik === kimlik).sort((x, y) => Number(y.canli) - Number(x.canli) || y.sonEtkinlik - x.sonEtkinlik)[0] : undefined;
    if (k) return { simdiki: k.mod, olacak: ccTavanliMod(k.mod) };
    return { olacak: ccTavanliMod(ccBaslangicModu(this.s.ayar())) };
  }

  /**
   * N1: telefondan/sohbetten gelen iş, masada açık bir oturuma gidecekse önce mod tavanı: Tam yetkideyse süreç setPermissionMode ile
   * "Düzenlemelere izin ver"e indirilir (indirilemezse iş GİTMEZ), oturum tavan işareti alır (Tam yetkiye yalnız masada açıkça dönülür;
   * "hep izin ver"deki Tam yetki önerisi süzülür; SDK kancasının düzenleme koruması hemen devreye girer).
   */
  private async tavanaAl(k: Kayit): Promise<CcIslemSonucu> {
    // Düzeltme turu 3 (C): masada açılmış oturumun klasörü de N2 denetiminden geçer (ev klasöründe açık oturuma sohbetten iş gitmez) ve
    // gerçek yolu sabitlenir; kanca bundan sonra bu sabit yolla karşılaştırır.
    const d = this.tavanKlasoru(k.cwd, k.kok);
    if ('tamam' in d) return d;
    if (k.mod === 'bypassPermissions') {
      if (k.q && k.canli) {
        try { await k.q.setPermissionMode('acceptEdits'); } catch (e) {
          return { tamam: false, kod: 'mod-dusurulemedi', hata: `Oturum Tam yetkide ve “Düzenlemelere izin ver”e indirilemedi; komut iletilmedi (${kisalt(hataMetni(e), 160)}).` };
        }
      }
      k.mod = 'acceptEdits';
      this.yay(k, { tur: 'mod', mod: 'acceptEdits' });
      this.yay(k, { tur: 'sistem', seviye: 'bilgi', metin: 'Sohbetten gelen iş için oturum “Düzenlemelere izin ver”e indirildi; Tam yetkiye yalnız bilgisayardan, bu oturumun içinden geçilir.' });
    }
    k.kok = d.yol;
    k.tavan = true;
    this.durumYay(k);
    return { tamam: true };
  }

  /**
   * Düzeltme turu 3: tavanlı oturumun klasörü — N2 denetimi gerçek yolla (çözülemeyen bağlantı, ağ yolu, geniş/korunan klasör reddedilir)
   * ve sabitlenecek gerçek yol. `sabit` verilirse (önceden sabitlenmiş) gerçek yol onunla aynı olmalı: klasör sonradan bağlantıyla
   * değiştirildiyse oturum telefondan/sohbetten sürdürülmez.
   */
  private tavanKlasoru(cwd: string, sabit?: string): { yol: string } | CcIslemSonucu {
    const d = korunanKlasorDenetimi(cwd, this.sinirlar());
    if (d.neden) return { tamam: false, kod: 'genis-klasor', hata: `Telefondan ya da sohbetten bu klasörde Claude Code oturumu açılmaz (${d.neden}); bir proje klasörü seç.` };
    if (sabit && guvenAnahtari(sabit) !== guvenAnahtari(d.yol)) {
      return { tamam: false, kod: 'genis-klasor', hata: 'Oturumun klasörü açıldığından beri değişti (gerçek yolu farklı: bağlantı ya da yeniden adlandırma); telefondan ya da sohbetten sürdürülmez.' };
    }
    return { yol: d.yol };
  }

  /** Kullanıcı masada bir klasörün güven kararını değiştirdi: o klasörün BOŞTAKİ süreçleri kapatılır (sonraki mesaj yeni kararla resume
   *  eder; tur süren süreç tur bitince değil, bir sonraki açılışında yeni kararı alır). Kapatılan süreç sayısı döner. */
  async klasorGuveniDegisti(cwd: string): Promise<number> {
    const a = guvenAnahtari(cwd);
    const hedef = [...this.kayitlar.values()].filter((k) => guvenAnahtari(k.cwd) === a);
    for (const k of hedef) k.guvenNotu = undefined;
    const bos = hedef.filter((k) => k.canli && k.q && !k.turAktif && !k.izinler.size && !k.sirada && !k.kuyruk.length);
    await Promise.all(bos.map((k) => this.surecKapat(k)));
    return bos.length;
  }

  async baslat(i: CcBaslatIstegi): Promise<CcIslemSonucu & { oturum?: CcOturumOzeti; guven?: KlasorGuvenDurumu }> {
    if (this.kapaniyor) return { tamam: false, kod: 'kapaniyor', hata: 'Uygulama kapanıyor.' };
    let cwd = typeof i.cwd === 'string' ? i.cwd.trim() : '';
    if (!cwd || !path.isAbsolute(cwd)) return { tamam: false, kod: 'klasor-yok', hata: 'Proje klasörü verilmedi.' };
    try { if (!fs.statSync(cwd).isDirectory()) throw new Error(); } catch { return { tamam: false, kod: 'klasor-yok', hata: `Klasör bulunamadı: ${cwd}` }; }
    const model = typeof i.model === 'string' ? i.model.trim() : '';
    if ((i.model !== undefined && i.model !== null && typeof i.model !== 'string') || (model && !CC_MODEL_RE.test(model))) return { tamam: false, kod: 'gecersiz', hata: 'Geçersiz model adı.' };
    const efor = i.efor === undefined || i.efor === null || i.efor === '' ? undefined : i.efor;
    if (efor !== undefined && !ccEforMu(efor)) return { tamam: false, kod: 'gecersiz', hata: 'Geçersiz düşünme gücü.' };
    const surdur = typeof i.surdur === 'string' && i.surdur.trim() ? i.surdur.trim() : undefined;
    if ((i.surdur !== undefined && i.surdur !== null && typeof i.surdur !== 'string') || (surdur && !CC_KIMLIK_RE.test(surdur))) return { tamam: false, kod: 'gecersiz', hata: 'Geçersiz oturum kimliği.' };
    try { await sdkYukle(); } catch (e) { return { tamam: false, kod: 'sdk', hata: `Claude Code bileşeni yüklenemedi: ${kisalt(hataMetni(e), 200)}` }; }
    const catalla = Boolean(surdur && i.catalla);
    const uzak = i.kaynak === 'telefon' || i.uzak === true;
    // I2: sohbet aracından (masada ya da telefonda) başlayan oturumun modu da tavanlı.
    const tavan = uzak || i.kaynak === 'sohbet';
    // N2: telefondan/sohbetten ev klasörü, sürücü kökü, AppData, Fuber'in verisi, ~/.claude, sistem klasörleri ve bunları içeren klasörler
    // AÇILMAZ ("Düzenlemelere izin ver" oradaki her yazımı sormadan onaylardı). Masadan kullanıcı istediği klasörü açar.
    // Düzeltme turu 2: denetim ve oturum klasörün GERÇEK yoluyla (bağlantı/junction, 8.3 kısa ad çözülür; ağ/aygıt yolu reddedilir).
    // Düzeltme turu 3: denetlenen gerçek yol kayda sabitlenir (C); çözülemeyen bağlantı (A) ve gerçek hâli ağ yolu olan sürücü (B) reddedilir.
    if (tavan) {
      const d = this.tavanKlasoru(cwd);
      if ('tamam' in d) return d;
      cwd = d.yol;
    }
    const a = this.s.ayar();
    const istem = typeof i.istem === 'string' ? i.istem : '';
    const gonderilecek = Boolean(istem.trim() || i.gorseller?.length);
    const sohbettenIs = (k: Kayit) => {
      if (i.kaynak === 'sohbet' && typeof i.sohbetId === 'number' && gonderilecek) { k.sohbetId = i.sohbetId; k.sohbetIsi = true; }
    };
    let k: Kayit | undefined;
    let ayni: Kayit | undefined;
    if (surdur && !catalla) {
      ayni = [...this.kayitlar.values()].filter((x) => x.kimlik === surdur).sort((x, y) => Number(y.canli) - Number(x.canli) || y.sonEtkinlik - x.sonEtkinlik)[0];
      if (ayni?.canli && !ayni.kapatildi) {
        // Açık oturum: yenisi açılmaz. Telefondan mesaj GİTMEZ (Ruling CA düzeltme 2); komut varsa sessizce düşürülmez, açıkça
        // 'masada-acik' döner (düzeltme A: telefon ekranı ve sohbet aracı "komutu bilgisayardan ver" der, sonuç sözü vermez).
        if (uzak) return gonderilecek ? { tamam: false, kod: 'masada-acik', hata: MASADA_ACIK, oturum: this.ozet(ayni) } : { tamam: true, oturum: this.ozet(ayni) };
        if (gonderilecek) {
          const d = this.mesajDogrula(ayni, istem, i.gorseller);
          if (!('mesaj' in d)) return d;
          // N1: sohbet aracının işi masadaki açık oturuma gitmeden önce mod tavanı (Tam yetkiyse indirilir; indirilemezse iş gitmez).
          if (tavan) { const t = await this.tavanaAl(ayni); if (!t.tamam) return { ...t, oturum: this.ozet(ayni) }; }
          sohbettenIs(ayni);
          this.kuyrugaEkle(ayni, d.mesaj);
        }
        return { tamam: true, oturum: this.ozet(ayni) };
      }
    }
    // Klasör güveni (I1): kendi Claude Code ayarları olan klasörde sayfadan İLK süreç, kullanıcı masada karar vermeden açılmaz (kart:
    // claudecode/KlasorGuveni.tsx). Telefon ve sohbet aracı kartı yanıtlayamaz → güvenilmemiş sayılır (surecHazirla ayarları yüklemez).
    // Düzeltme turu 3 (C): kapanmış/boştaki kayıt telefondan/sohbetten yeniden açılacaksa KAYDIN klasörü (istekteki değil) denetlenir ve
    // gerçek yolu sabitlenir (masada açılmış kayıtların klasörü çözülmemiş hâliyle duruyordu).
    let ayniKok: string | undefined;
    if (ayni && tavan) {
      const d = this.tavanKlasoru(ayni.cwd, ayni.tavan ? ayni.kok : undefined);
      if ('tamam' in d) return { ...d, oturum: this.ozet(ayni) };
      ayniKok = d.yol;
    }
    const guven = this.guvenDurumu(cwd);
    if (guven.gerekli && !guven.karar && !tavan) return { tamam: false, kod: 'klasor-guveni', hata: CC_GUVEN_GEREKLI, guven };
    if (surdur && !catalla) {
      if (!i.zorla && this.s.baskaYerdeMi) {
        const b = await this.s.baskaYerdeMi(surdur, this.bizimIzler()).catch(() => ({ acik: false }));
        if (b.acik) return { tamam: false, kod: 'baska-yerde', hata: 'Bu oturum başka bir yerde (terminal ya da başka bir uygulama) açık görünüyor; doğrudan sürdürülmez. Çatallayarak devam edebilirsin.' };
      }
    }
    // Telefon oturumunun politikası bu makinede etkin mi (süreç açılmadan, bir kez; sonuç kayda yazılır).
    const uzakPolitika = uzak ? await (this.s.uzakPolitikaDenetimi ?? varsayilanUzakPolitika)(cwd).catch(() => false) : undefined;
    if (ayni) { // uygulamada kapanmış/boşta oturum: aynı kayıt yeniden açılır (çift kayıt yok; açık olan yukarıda döndü)
      k = ayni;
      k.kapatildi = false;
      k.hata = undefined;
      if (uzak) { k.uzak = true; k.uzakPolitika = uzakPolitika; }
      if (tavan) { k.tavan = true; k.kok = ayniKok; k.mod = ccTavanliMod(k.mod); }
    }
    const yeni = !k;
    if (!k) {
      const simdi = Date.now();
      const mod = tavan ? ccTavanliMod(ccBaslangicModu(a, i.mod)) : ccBaslangicModu(a, i.mod);
      k = {
        id: randomUUID(), kimlik: surdur && !catalla ? surdur : undefined, cwd, proje: path.basename(cwd) || cwd,
        baslik: kisalt((i.baslik?.trim() || istem.trim().replace(/\s+/g, ' ') || (catalla ? 'Çatallanan oturum' : surdur ? 'Sürdürülen oturum' : 'Yeni oturum')), 120),
        kaynak: i.kaynak ?? 'sayfa', sohbetIsi: false, uzak, tavan, ...(tavan ? { kok: cwd } : {}), ...(uzak ? { uzakPolitika } : {}), mod, ...(model ? { model } : {}), ...(efor ? { efor } : {}),
        arkaPlan: 0, paraGoster: false, arkaIsler: [],
        ilk: { surdur, catalla }, stderr: '',
        canli: false, turAktif: false, sirada: false, kapatildi: false, kapatiliyor: false, kesmeIstendi: false, tamYetkiIzni: false,
        kuyruk: [], izinler: new Map(), olaylar: [], sira: 0, baglam: yeniBaglam(), parcaBekleyen: new Map(), parcaGirdi: new Map(),
        sureMs: 0, turSayisi: 0, degisen: new Set(), bekleyenDuzenleme: new Map(), yapilacaklar: [], sonMetin: '', yetenekler: [],
        olusturma: simdi, sonEtkinlik: simdi,
      };
      this.kayitlar.set(k.id, k);
    }
    if (gonderilecek) {
      const d = this.mesajDogrula(k, istem, i.gorseller);
      if (!('mesaj' in d)) { if (yeni) this.kayitlar.delete(k.id); return d; }
      sohbettenIs(k);
      this.kuyrugaEkle(k, d.mesaj);
    } else this.durumYay(k);
    return { tamam: true, oturum: this.ozet(k) };
  }

  // ── Mesaj gönder (kuyruk + eşzamanlı sınır) ────────────────────────────────────────────────────────────────────────────
  /** Kapanmış/boştaki oturuma yazmak onu `resume` ile yeniden açar — o an başka yerde (terminalde) açıksa sürdürülmez. */
  async gonder(id: string, m: { metin: string; gorseller?: CcGorsel[] }): Promise<CcIslemSonucu> {
    const k = this.kayitlar.get(id);
    if (!k) return { tamam: false, kod: 'yok', hata: 'Oturum bulunamadı.' };
    const d = this.mesajDogrula(k, m?.metin, m?.gorseller);
    if (!('mesaj' in d)) return d;
    if (!k.canli && !k.turAktif && !k.sirada && k.kimlik && this.s.baskaYerdeMi) {
      const b = await this.s.baskaYerdeMi(k.kimlik, this.bizimIzler()).catch(() => ({ acik: false }));
      if (b.acik) return { tamam: false, kod: 'baska-yerde', hata: 'Bu oturum şu an başka bir yerde (terminal ya da başka bir uygulama) açık; uygulamada sürdürülmez. Çatallayarak devam edebilirsin.' };
    }
    if (this.kapaniyor) return { tamam: false, kod: 'kapaniyor', hata: 'Uygulama kapanıyor.' };
    // İnceleme M5: bekleyen düşünme gücü (canlıda uygulanamadı) — boştaki süreç bu mesajdan önce kapanır, mesaj yeni değerle açılan süreçte gider.
    if (k.eforSonraki && k.canli && !k.turAktif && !k.izinler.size && !k.sirada && !k.kuyruk.length && k.arkaPlan === 0) { k.eforSonraki = false; await this.surecKapat(k); }
    k.kapatildi = false;
    k.hata = undefined;
    this.kuyrugaEkle(k, d.mesaj);
    return { tamam: true };
  }

  private mesajDogrula(k: Kayit, metinHam: unknown, gorsellerHam: unknown): CcIslemSonucu | { mesaj: GidenMesaj } {
    if (this.kapaniyor) return { tamam: false, kod: 'kapaniyor', hata: 'Uygulama kapanıyor.' };
    const metin = typeof metinHam === 'string' ? metinHam : '';
    const gorseller = Array.isArray(gorsellerHam)
      ? (gorsellerHam as CcGorsel[]).filter((g) => g && MEDYA.has(g.medya) && typeof g.veri === 'string' && g.veri.length <= GORSEL_SINIRI).slice(0, 10) : [];
    if (!metin.trim() && !gorseller.length) return { tamam: false, kod: 'bos', hata: 'Boş mesaj gönderilmez.' };
    if (metin.length > 200_000) return { tamam: false, kod: 'buyuk', hata: 'Mesaj çok uzun.' };
    if (k.kuyruk.length >= KUYRUK_SINIRI) return { tamam: false, kod: 'kuyruk-dolu', hata: 'Bu oturumda bekleyen mesaj çok; önce sıradakiler gitsin.' };
    const kuyrukGorsel = k.kuyruk.reduce((t, x) => t + (x.gorseller?.length ?? 0), 0);
    const kuyrukBayt = k.kuyruk.reduce((t, x) => t + (x.gorseller ?? []).reduce((u, g) => u + g.veri.length, 0), 0);
    if (kuyrukGorsel + gorseller.length > KUYRUK_GORSEL_SINIRI || kuyrukBayt + gorseller.reduce((u, g) => u + g.veri.length, 0) > KUYRUK_GORSEL_BAYT) {
      return { tamam: false, kod: 'buyuk', hata: 'Bekleyen mesajlardaki görseller sınırı aştı; önce sıradakiler gitsin.' };
    }
    return { mesaj: { id: randomUUID(), metin, ...(gorseller.length ? { gorseller } : {}) } };
  }

  private kuyrugaEkle(k: Kayit, m: GidenMesaj): void {
    k.kuyruk.push(m);
    if (!k.turAktif) this.sirayaEkle(k);
    this.pompala();
    this.durumYay(k);
  }

  private sirayaEkle(k: Kayit): void {
    if (k.sirada || k.turAktif || !k.kuyruk.length) return;
    k.sirada = true;
    this.sira.push(k.id);
  }

  private aktifSayisi(): number { let n = 0; for (const k of this.kayitlar.values()) if (k.turAktif) n++; return n; }

  private pompala(): void {
    if (this.kapaniyor) return;
    while (this.sira.length && this.aktifSayisi() < this.azami) {
      const k = this.kayitlar.get(this.sira.shift()!);
      if (!k) continue;
      k.sirada = false;
      // Süreci kapanmakta olan oturum (boşta budama / kapat) atlanır: çıkışı işlenince (surecBitti) kuyruğu yeniden sıraya girer.
      if (k.kapatildi || k.turAktif || !k.kuyruk.length || k.kapatiliyor) { this.durumYay(k); continue; }
      this.turBaslat(k);
    }
    for (const id of this.sira) { const k = this.kayitlar.get(id); if (k) this.durumYay(k); } // sıra numaraları
  }

  private turBaslat(k: Kayit): void {
    const m = k.kuyruk.shift()!;
    k.turAktif = true;
    k.kesmeIstendi = false;
    k.sonMetin = '';
    try {
      this.surecHazirla(k);
    } catch (e) {
      k.turAktif = false;
      k.kuyruk.unshift(m);
      const ham = hataMetni(e);
      const a = ccHataAciklamasi(ham);
      this.hataya(k, a.sinif === 'genel' ? ham : a.metin);
      this.pompala();
      return;
    }
    const icerik: Exclude<SDKUserMessage['message']['content'], string> = [];
    if (m.metin.trim()) icerik.push({ type: 'text', text: m.metin });
    for (const g of m.gorseller ?? []) icerik.push({ type: 'image', source: { type: 'base64', media_type: g.medya as 'image/png', data: g.veri } });
    k.girdi!.it({ type: 'user', message: { role: 'user', content: icerik }, parent_tool_use_id: null, uuid: m.id as SDKUserMessage['uuid'] });
    this.yay(k, { tur: 'kullanici', id: m.id, metin: m.metin, gorselSayisi: m.gorseller?.length ?? 0 });
    this.durumYay(k);
  }

  // ── Süreç ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private ortam(): Record<string, string | undefined> {
    const e: Record<string, string | undefined> = {};
    // Fuber'in kendi sırları (FUBER_SIR_*) Claude Code'a geçmez.
    for (const [ad, deger] of Object.entries(process.env)) if (!/^FUBER_SIR_/i.test(ad)) e[ad] = deger;
    if (this.s.istemci) e.CLAUDE_AGENT_SDK_CLIENT_APP = this.s.istemci;
    if (process.env.FUBER_CLAUDE_DIZIN) e.CLAUDE_CONFIG_DIR = process.env.FUBER_CLAUDE_DIZIN;
    return e;
  }

  /** Boştaki fazla süreçleri kapatır (en eski etkinlik önce); sonraki mesajda `resume` ile açılırlar. */
  private boslariBuda(): void {
    const canlilar = [...this.kayitlar.values()].filter((k) => k.canli);
    if (canlilar.length < this.azamiCanli) return;
    // Arka planda iş süren oturumun süreci kapatılmaz: ajan onunla ölür (31 Eki).
    const bos = canlilar.filter((k) => !k.turAktif && !k.izinler.size && !k.sirada && k.arkaPlan === 0).sort((a, b) => a.sonEtkinlik - b.sonEtkinlik);
    for (const k of bos.slice(0, canlilar.length - this.azamiCanli + 1)) void this.surecKapat(k);
  }

  private surecHazirla(k: Kayit): void {
    if (k.canli && k.q) return;
    if (!sdk) throw new Error('Claude Code bileşeni yüklenmedi.'); // baslat() yükler; oturum ondan önce var olamaz
    const { query } = sdk;
    // Düzeltme turu 3 (C): tavanlı oturumun klasörü süreç açılmadan HEMEN önce yeniden denetlenir; sabitlenen gerçek yoldan ayrıldıysa
    // (ör. klasör bir bağlantıyla değiştirildi) ya da artık açılamıyorsa süreç açılmaz.
    if (k.tavan) {
      const d = this.tavanKlasoru(k.cwd, k.kok);
      if ('tamam' in d) throw new Error(d.hata ?? 'Oturum klasörü denetlenemedi.');
      k.kok = d.yol;
    }
    this.boslariBuda();
    const komut = this.s.komut(); // testte sahte yoksa burada YÜKSEK SESLE atar
    const a = this.s.ayar();
    if (k.mod === 'bypassPermissions' && (!a.tamYetki || k.tavan)) k.mod = k.tavan ? ccTavanliMod(k.mod) : ccBaslangicModu(a);
    const resume = k.kimlik ?? k.ilk.surdur;
    const catal = !k.kimlik && Boolean(k.ilk.catalla);
    const girdi = new AkisKuyrugu<SDKUserMessage>();
    k.stderr = '';
    k.tamYetkiIzni = a.tamYetki && !k.tavan; // telefondan / sohbet aracından açılan süreç Tam yetkiye geçemez (masada seçilene dek)
    // Klasör güveni (I1): kendi ayarı olan ve masada güvenilmemiş klasörde proje + yerel kaynak yok; .mcp.json varsa klasörün MCP'si de.
    const g = this.guvenDurumu(k.cwd);
    const klasorAyarlari = klasorAyarlariYuklenir(g);
    const komutYasak = k.uzak && k.uzakPolitika !== true; // politika etkin değil → telefon oturumunda komut YOK (kapalı başarısızlık)
    if (!klasorAyarlari) {
      const not = g.karar === 'guvenme' ? 'guvenme' : 'karar-yok';
      if (k.guvenNotu !== not) {
        k.guvenNotu = not;
        this.yay(k, { tur: 'sistem', seviye: 'bilgi', metin: not === 'guvenme'
          ? 'Bu klasörün kendi Claude Code ayarları yüklenmedi (güvenmedin): kancaları, izin kuralları, MCP sunucuları ve CLAUDE.md’si devre dışı.'
          : 'Bu klasörün kendi Claude Code ayarları yüklenmedi: güven kararı bilgisayarda, Claude Code sayfasında verilir. Kancaları, izin kuralları, MCP sunucuları ve CLAUDE.md’si devre dışı.' });
      }
    }
    if (komutYasak) this.yay(k, { tur: 'sistem', seviye: 'uyari', metin: 'Telefondan açılan bu oturumda komutlar (Bash, PowerShell) kapalı: bu bilgisayarın Claude Code politikası, komutların masada onaylanmasını sağlayan kuralı almadı.' });
    const canUseTool: CanUseTool = (arac, ham, o) => this.izinIste(k, arac, ham, o);
    // Düzeltme turu (CA kemer-askı + N2): HER sürece kayıtlı PreToolUse kancası; karar çağrı anında kayıttan okunur (masadaki açık oturum
    // sonradan sohbetten iş alınca — tavan — koruma hemen geçerli olur). Masa oturumunda (uzak/tavan yok) hiçbir şey yapmaz. Kanca kendi
    // içinde hata verirse telefon/sohbet oturumunda masaya sorulur (kapalı başarısızlık).
    const sor = (neden: string) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'ask' as const, permissionDecisionReason: neden } });
    const onKanca: HookCallback = async (girdi) => {
      if (girdi.hook_event_name !== 'PreToolUse') return {};
      try {
        // Düzeltme turu 3 (C): karşılaştırma kayda sabitlenen gerçek klasörle; tavanlı oturumda sabit yol yoksa (olmamalı) masaya sorulur.
        if ((k.uzak || k.tavan) && !k.kok && DUZENLEME_ARACLARI.has(girdi.tool_name)) return sor('Oturum klasörü sabitlenmedi; masada onaylanır.');
        const neden = ccOnKancaKarari({ uzak: k.uzak, tavan: k.tavan, cwd: k.kok ?? k.cwd, sinirlar: this.sinirlar(), arac: girdi.tool_name, girdi: girdi.tool_input });
        return neden ? sor(neden) : {};
      } catch { return k.uzak || k.tavan ? sor('Araç denetlenemedi; masada onaylanır.') : {}; }
    };
    // 13 Kas: Cowork, Chrome'daki eklentileri kullanamıyordu — kök neden: bayrak hiç geçirilmiyordu. Ayar açık + eklenti kurulu → --chrome.
    let chromeAcik = false;
    try { chromeAcik = a.chrome !== false && Boolean(this.s.chromeKurulu?.()); } catch { /* denetlenemedi: Chrome'suz aç */ }
    const chromeEkArgumanlari = chromeAcik ? { extraArgs: chromeBayraklari(true, 'hazir') } : {};
    const q = query({
      prompt: girdi,
      options: {
        pathToClaudeCodeExecutable: komut.exe,
        spawnClaudeCodeProcess: (so) => {
          const c = surecBaslat(komut, { args: so.args, cwd: so.cwd, env: so.env, signal: so.signal }, (p) => { k.stderr = (k.stderr + p).slice(-4096); });
          k.pid = c.pid;
          // Çıkışta PID unutulur: işletim sistemi aynı numarayı başka bir programa verebilir (düzeltme 3).
          c.once('exit', () => { if (k.pid === c.pid) k.pid = undefined; });
          return c as unknown as SpawnedProcess; // stdio: 'pipe' → akışlar boş değil
        },
        cwd: k.cwd,
        ...(resume ? { resume } : {}),
        ...(catal ? { forkSession: true } : {}),
        ...(k.model ? { model: k.model } : {}),
        ...(k.efor ? { effort: k.efor } : {}),
        permissionMode: k.mod,
        allowDangerouslySkipPermissions: k.tamYetkiIzni,
        canUseTool,
        includePartialMessages: true,
        hooks: { PreToolUse: [{ hooks: [onKanca] }] },
        ...(klasorAyarlari ? {} : { settingSources: GUVENSIZ_KAYNAKLAR, ...(g.mcp ? { strictMcpConfig: true } : {}) }),
        ...(k.uzak ? { managedSettings: CC_UZAK_POLITIKA } : {}),
        ...(komutYasak ? { disallowedTools: UZAK_KOMUT_ARACLARI } : {}),
        ...chromeEkArgumanlari,
        env: this.ortam(),
      },
    });
    k.q = q;
    k.girdi = girdi;
    k.canli = true;
    k.cikis = (async () => {
      let hata: unknown = null;
      try { for await (const m of q) this.mesajIsle(k, q, m); } catch (e) { hata = e; }
      this.surecBitti(k, q, hata);
    })();
  }

  private mesajIsle(k: Kayit, q: Query, m: unknown): void {
    if (k.q !== q) return; // eski süreçten geç gelen ileti
    for (const olay of ccNormallestir(m, k.baglam, { kesmeIstendi: k.kesmeIstendi })) this.olayIsle(k, olay);
  }

  private olayIsle(k: Kayit, olay: CcOlay): void {
    switch (olay.tur) {
      case 'baslangic': {
        if (olay.kimlik) k.kimlik = olay.kimlik;
        // Bulgu 2: init her turda çözülmüş tam kimliği getirir (claude-sonnet-4-5-…); kullanıcının seçimi (k.model) ezilmez.
        if (olay.model) k.etkinModel = olay.model;
        if (ccModMu(olay.mod)) k.mod = olay.mod;
        if (olay.surum) k.surum = olay.surum;
        k.yetenekler = olay.yetenekler;
        k.paraGoster = ccParaGosterilir(olay.apiKaynak); // tahmini dolar yalnız API anahtarıyla çalışana gösterilir (üyelik / bilinmiyor: hayır)
        if (!k.hesapSorgulandi) { k.hesapSorgulandi = true; void this.hesapTazele(k); }
        const imza = JSON.stringify([olay.kimlik, olay.model, olay.mod, olay.surum]);
        if (imza === k.sonBaslangic) { this.durumYay(k); return; }
        k.sonBaslangic = imza;
        break;
      }
      case 'mod': if (ccModMu(olay.mod)) { if (olay.mod === k.mod) return; k.mod = olay.mod; } break;
      case 'arka-plan':
        k.arkaPlan = olay.sayi;
        // İnceleme M5: canlıda uygulanamayan düşünme gücü, son arka plan işi bitip oturum boşa düşünce süreci yeniden açtırır.
        if (olay.sayi === 0 && k.eforSonraki && !k.turAktif && !k.kuyruk.length && !k.izinler.size && !k.sirada) { k.eforSonraki = false; void this.surecKapat(k); }
        break;
      case 'arka-isler': k.arkaIsler = olay.isler; break;
      case 'arac-basladi':
        if (olay.tip === 'duzenleme') { const d = olay.girdi.file_path ?? olay.girdi.notebook_path; if (typeof d === 'string' && d) k.bekleyenDuzenleme.set(olay.id, d); }
        break;
      case 'arac-bitti': {
        const d = k.bekleyenDuzenleme.get(olay.id);
        if (d !== undefined) { k.bekleyenDuzenleme.delete(olay.id); if (!olay.hata) k.degisen.add(d); }
        break;
      }
      case 'yapilacaklar': if (olay.ust === null) k.yapilacaklar = olay.maddeler; break;
      case 'metin': if (olay.ust === null) k.sonMetin = olay.metin; break;
      case 'sonuc':
        this.yay(k, olay);
        this.turBitti(k, olay);
        return;
      default: break;
    }
    this.yay(k, olay);
    if (olay.tur === 'baslangic' || olay.tur === 'mod' || olay.tur === 'arac-bitti' || olay.tur === 'arka-plan') this.durumYay(k);
  }

  private turBitti(k: Kayit, sonuc: CcSonuc): void {
    if (k.kesmeZamanlayici) { clearTimeout(k.kesmeZamanlayici); k.kesmeZamanlayici = undefined; }
    if (sonuc.maliyetUsd > 0) k.maliyet = sonuc.maliyetUsd; // birikimli (query başına)
    const b = k.belirtec ?? { girdi: 0, cikti: 0, onbellekOkuma: 0, onbellekYazma: 0 };
    k.belirtec = { girdi: b.girdi + sonuc.belirtec.girdi, cikti: b.cikti + sonuc.belirtec.cikti, onbellekOkuma: b.onbellekOkuma + sonuc.belirtec.onbellekOkuma, onbellekYazma: b.onbellekYazma + sonuc.belirtec.onbellekYazma };
    k.sureMs += sonuc.sureMs;
    k.turSayisi += sonuc.turSayisi;
    k.sonSonuc = sonuc;
    if (!k.turAktif) { this.durumYay(k); return; }
    k.turAktif = false;
    k.kesmeIstendi = false;
    this.izinleriIptal(k, 'Tur bitti.');
    if (k.kuyruk.length) this.sirayaEkle(k);
    else this.isBildir(k, sonuc);
    // Düşünme gücü canlı süreçte uygulanamadıysa (eski Claude Code): boşta ve arkada iş yokken süreç kapanır; sonraki mesaj yeni değerle açar.
    if (k.eforSonraki && !k.kuyruk.length && k.arkaPlan === 0) { k.eforSonraki = false; void this.surecKapat(k); }
    this.durumYay(k);
    this.pompala();
  }

  /** Bitiş (ya da zorla durdurma) bildirimi; sohbetten verilen iş için `sohbetId` YALNIZ bir kez. */
  private isBildir(k: Kayit, sonuc: CcSonuc): void {
    if (this.kapaniyor) return;
    const sohbetId = k.sohbetIsi ? k.sohbetId : undefined;
    k.sohbetIsi = false;
    this.kanca(() => this.s.turBitti?.(this.ozet(k), { sonuc, sonMetin: k.sonMetin, degisenDosyalar: [...k.degisen], kaynak: k.kaynak, ...(sohbetId !== undefined ? { sohbetId } : {}) }));
  }

  private surecBitti(k: Kayit, q: Query, hata: unknown): void {
    if (k.q !== q) return;
    if (k.kesmeZamanlayici) { clearTimeout(k.kesmeZamanlayici); k.kesmeZamanlayici = undefined; }
    const aktifti = k.turAktif;
    k.q = undefined;
    k.girdi = undefined;
    k.canli = false;
    k.turAktif = false;
    k.kesmeIstendi = false;
    k.bekleyenDuzenleme.clear();
    // Süreç öldü: arka plan işleri de onunla gitti (seviye sinyali yeni süreçte hiç gelmez); hesap sorgusu yeni süreçte yenilenir.
    k.hesapSorgulandi = false;
    for (const o of arkaPlanSifirla(k.baglam)) this.olayIsle(k, o);
    if (k.kimlik) {
      this.kapanislar.set(k.kimlik, Date.now());
      if (this.kapanislar.size > 500) this.kapanislar.delete(this.kapanislar.keys().next().value as string);
    }
    this.izinleriIptal(k, 'Claude Code kapandı.');
    if (k.kapatiliyor) {
      k.kapatiliyor = false;
      if (aktifti) { // zorla durdurma (Kapat, Durdur bekçisi): tur kesildi sayılır; sohbetten verilen işe yazılır
        const s = kesikSonuc();
        this.yay(k, s);
        this.yay(k, { tur: 'sistem', seviye: 'bilgi', metin: 'Oturum durduruldu.' });
        this.isBildir(k, s);
      }
    } else if (hata || aktifti) {
      this.hataya(k, cokusMetni(hata, k.stderr));
    }
    // Bekçinin kapattığı turdan sonra bırakılan mesajlar sıraya döner (yeni süreç resume ile açılır).
    if (!k.hata && !k.kapatildi && k.kuyruk.length) this.sirayaEkle(k);
    this.durumYay(k);
    this.pompala();
  }

  private hataya(k: Kayit, metin: string): void {
    k.hata = metin;
    if (k.sirada) { k.sirada = false; this.sira = this.sira.filter((x) => x !== k.id); }
    this.yay(k, { tur: 'sistem', seviye: 'hata', metin });
    this.durumYay(k);
    const sohbetId = k.sohbetIsi ? k.sohbetId : undefined;
    k.sohbetIsi = false;
    if (!this.kapaniyor) this.kanca(() => this.s.hataOldu?.(this.ozet(k), metin, sohbetId));
  }

  /** Süreci nazikçe kapatır (stdin kapanır), süre dolarsa ağacıyla öldürür. Oturum kaydı kalır. */
  private async surecKapat(k: Kayit, sureMs = this.s.kapatmaBeklemeMs ?? 2500): Promise<void> {
    const q = k.q;
    if (!q) return;
    k.kapatiliyor = true;
    k.girdi?.bitir();
    try { q.close(); } catch { /* zaten kapalı */ }
    const son = Date.now() + sureMs;
    while (izlenenMi(k.pid) && Date.now() < son) await bekle(50);
    guvenliOldur(k.pid);
    await Promise.race([k.cikis, bekle(1500)]);
  }

  // ── İzinler ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private izinIste(k: Kayit, arac: string, ham: Record<string, unknown>, o: Parameters<CanUseTool>[2]): Promise<PermissionResult> {
    return new Promise<PermissionResult>((coz) => {
      const istekId = typeof o.requestId === 'string' && o.requestId ? o.requestId : randomUUID();
      const ham0 = izinIstegiOlayi(istekId, arac, ham, o);
      // Telefon oturumunda komut her seferinde sorulur (CC_UZAK_POLITIKA ask kuralı oturum kuralını da yener): "hep izin ver" sunulmaz.
      const olay = k.uzak && UZAK_KOMUT_ARACLARI.includes(arac) ? { ...ham0, herZamanSunulur: false } : ham0;
      let bitti = false;
      const bitir = (r: PermissionResult) => { if (bitti) return; bitti = true; coz(r); };
      k.izinler.set(istekId, { olay, girdi: ham, oneriler: Array.isArray(o.suggestions) ? o.suggestions : [], coz: bitir });
      o.signal?.addEventListener('abort', () => {
        if (!k.izinler.delete(istekId)) return;
        this.yay(k, { tur: 'izin-yanitlandi', istekId, karar: 'iptal' });
        bitir({ behavior: 'deny', message: 'İzin isteği iptal edildi.' });
        this.durumYay(k);
      }, { once: true });
      this.yay(k, olay);
      this.durumYay(k);
      this.kanca(() => this.s.izinBekliyor?.(this.ozet(k), olay));
    });
  }

  izinYanitla(id: string, istekId: string, y: CcIzinYaniti): CcIslemSonucu {
    const k = this.kayitlar.get(id);
    const b = k?.izinler.get(istekId);
    if (!k || !b) return { tamam: false, kod: 'yok', hata: 'Bekleyen izin bulunamadı (yanıtlanmış ya da iptal edilmiş olabilir).' };
    const karar = y?.karar;
    if (karar !== 'izin' && karar !== 'hep' && karar !== 'ret') return { tamam: false, kod: 'gecersiz', hata: 'Geçersiz karar.' };
    let sonuc: PermissionResult;
    let verilen: 'izin' | 'hep' | 'ret' = karar;
    if (karar === 'ret') {
      sonuc = { behavior: 'deny', message: typeof y.neden === 'string' && y.neden.trim() ? kisalt(y.neden.trim(), 2000) : 'Kullanıcı reddetti.' };
    } else if (b.olay.tip === 'soru') {
      // Yanıtlar sorulan sorulara uymalı (düzeltme 9); uymazsa istek BEKLEMEYE devam eder.
      const d = soruCevaplariniDogrula(b.olay.sorular ?? [], y.cevaplar, y.serbest);
      if (!d.tamam) return { tamam: false, kod: 'gecersiz-cevap', hata: d.hata };
      sonuc = { behavior: 'allow', updatedInput: { questions: b.girdi.questions, answers: d.answers } };
      verilen = 'izin';
    } else if (karar === 'hep' && b.olay.herZamanSunulur) {
      const tamYetki = this.s.ayar().tamYetki && k.tamYetkiIzni && !k.tavan; // N1: tavanlı oturumda Tam yetki önerisi süzülür
      // Yalnız bu oturum: öneriler kalıcı ayar dosyalarına değil oturuma yazılır; Tam yetkiye geçiş önerisi yalnız izin varken.
      const guncellemeler = b.oneriler
        .filter((u) => !(u.type === 'setMode' && u.mode === 'bypassPermissions' && !tamYetki))
        .map((u) => ({ ...u, destination: 'session' as const }));
      sonuc = { behavior: 'allow', updatedInput: b.girdi, updatedPermissions: guncellemeler };
    } else {
      sonuc = { behavior: 'allow', updatedInput: b.girdi };
      verilen = 'izin';
    }
    k.izinler.delete(istekId);
    b.coz(sonuc);
    this.yay(k, { tur: 'izin-yanitlandi', istekId, karar: verilen });
    this.durumYay(k);
    return { tamam: true };
  }

  private izinleriIptal(k: Kayit, neden: string, kes = false): void {
    for (const [istekId, b] of k.izinler) {
      k.izinler.delete(istekId);
      b.coz({ behavior: 'deny', message: neden, ...(kes ? { interrupt: true } : {}) });
      this.yay(k, { tur: 'izin-yanitlandi', istekId, karar: 'iptal' });
    }
  }

  // ── Kes, mod, model, kapat, unut ───────────────────────────────────────────────────────────────────────────────────────
  /** Durdur (Esc): süren turu interrupt() ile keser. `kuyruk: 'sil'` (varsayılan) bekleyen mesajları da atar. */
  async kes(id: string, o: { kuyruk?: 'sil' | 'birak' } = {}): Promise<CcIslemSonucu> {
    const k = this.kayitlar.get(id);
    if (!k) return { tamam: false, kod: 'yok', hata: 'Oturum bulunamadı.' };
    if (o.kuyruk !== 'birak') k.kuyruk = [];
    if (k.sirada && !k.kuyruk.length) { k.sirada = false; this.sira = this.sira.filter((x) => x !== k.id); }
    if (!k.turAktif || !k.q) {
      // Kuyruktaki (henüz başlamamış) sohbet işi durduruldu: o sohbete BİR KEZ "durduruldu" (sonraki masa turu eski sohbete yazmasın).
      if (k.sohbetIsi && !k.kuyruk.length) this.isBildir(k, kesikSonuc());
      this.durumYay(k); this.pompala(); return { tamam: true };
    }
    const q = k.q;
    k.kesmeIstendi = true;
    this.izinleriIptal(k, 'Kullanıcı durdurdu.', true);
    this.durumYay(k);
    try { await Promise.race([q.interrupt(), bekle(5000)]); } catch (e) { this.yay(k, { tur: 'sistem', seviye: 'uyari', metin: `Durdurma isteği iletilemedi: ${kisalt(hataMetni(e), 200)}` }); }
    // Bekçi: Claude Code turu kapatmazsa süreç kapatılır (tur "kesildi"; oturum boşta kalır, sonraki mesajda resume ile sürer).
    if (k.turAktif && k.q === q && !k.kesmeZamanlayici) {
      k.kesmeZamanlayici = setTimeout(() => {
        k.kesmeZamanlayici = undefined;
        if (k.turAktif && k.q === q) void this.surecKapat(k);
      }, this.s.kesmeBeklemeMs ?? 8000);
    }
    return { tamam: true };
  }

  async modDegistir(id: string, mod: unknown): Promise<CcIslemSonucu> {
    const k = this.kayitlar.get(id);
    if (!k) return { tamam: false, kod: 'yok', hata: 'Oturum bulunamadı.' };
    if (!ccModMu(mod)) return { tamam: false, kod: 'gecersiz', hata: 'Geçersiz mod.' };
    if (!ccModSecilebilir(mod, this.s.ayar().tamYetki)) return { tamam: false, kod: 'tam-yetki-kapali', hata: 'Tam yetki, Ayarlar → Claude Code’da “Tam yetki” açılmadan seçilemez.' };
    if (k.q && k.canli) {
      if (mod === 'bypassPermissions' && !k.tamYetkiIzni) {
        // Süreç Tam yetki izni olmadan açılmış: boştaysa kapatılır, sonraki mesaj Tam yetki izniyle resume eder. Mod ve "telefondan"
        // işareti KAPATMADAN ÖNCE değişir (düzeltme D): kapanış sürerken gelen mesaj yeni süreci eski modda açmasın.
        if (k.turAktif || k.izinler.size || k.kuyruk.length || k.sirada) return { tamam: false, kod: 'yeniden-baslat', hata: 'Oturum çalışırken Tam yetkiye geçilemez; tur bitince yeniden dene.' };
        k.uzak = false;
        k.tavan = false;
        if (k.mod !== mod) { k.mod = mod; this.yay(k, { tur: 'mod', mod }); }
        await this.surecKapat(k);
      } else {
        try { await k.q.setPermissionMode(mod); } catch (e) { return { tamam: false, kod: 'desteklenmiyor', hata: `Mod değiştirilemedi: ${kisalt(hataMetni(e), 200)}` }; }
      }
    }
    // Masada açıkça Tam yetki seçildi (bu kanal telefondan KAPALI — kopru-protokol.ts): telefon işareti ve mod tavanı kalkar.
    if (mod === 'bypassPermissions') { k.uzak = false; k.tavan = false; }
    if (k.mod !== mod) { k.mod = mod; this.yay(k, { tur: 'mod', mod }); }
    this.durumYay(k);
    return { tamam: true };
  }

  async modelDegistir(id: string, model: unknown): Promise<CcIslemSonucu> {
    const k = this.kayitlar.get(id);
    if (!k) return { tamam: false, kod: 'yok', hata: 'Oturum bulunamadı.' };
    if (model !== null && model !== undefined && (typeof model !== 'string' || !CC_MODEL_RE.test(model))) return { tamam: false, kod: 'gecersiz', hata: 'Geçersiz model adı.' };
    const yeni = typeof model === 'string' && model ? model : undefined;
    if (k.q && k.canli) {
      try { await k.q.setModel(yeni); } catch (e) { return { tamam: false, kod: 'desteklenmiyor', hata: `Model değiştirilemedi: ${kisalt(hataMetni(e), 200)}` }; }
    }
    k.model = yeni;
    this.yay(k, { tur: 'model', model: yeni ?? 'default' });
    this.durumYay(k);
    return { tamam: true };
  }

  /**
   * Analiz 11 Kas bulgu 1: düşünme gücü canlı oturumda da değişir. SDK `Query.applyFlagSettings({ effortLevel })` ("applied mid-session";
   * null → modelin varsayılanı). Süreç yoksa yalnız kayda yazılır (sonraki süreç `effort` ile açılır). Claude Code bu isteği tanımıyorsa
   * (eski sürüm) değer kayda yazılır ve `kod: 'sonraki'` döner: boştaysa süreç hemen, tur sürüyorsa tur bitince kapatılır; sonraki mesaj
   * yeni değerle açılır (arayüz bunu tek satırla söyler).
   */
  async eforDegistir(id: string, efor: unknown): Promise<CcIslemSonucu> {
    const k = this.kayitlar.get(id);
    if (!k) return { tamam: false, kod: 'yok', hata: 'Oturum bulunamadı.' };
    const yeni = efor === null || efor === undefined || efor === '' ? undefined : efor;
    if (yeni !== undefined && !ccEforMu(yeni)) return { tamam: false, kod: 'gecersiz', hata: 'Geçersiz düşünme gücü.' };
    k.efor = yeni;
    let sonraki = false;
    if (k.q && k.canli) {
      try {
        await Promise.race([k.q.applyFlagSettings({ effortLevel: yeni ?? null }), bekle(10_000).then(() => { throw new Error('Claude Code yanıt vermedi.'); })]);
        k.eforSonraki = false;
      } catch {
        sonraki = true;
        if (k.turAktif || k.izinler.size || k.sirada || k.kuyruk.length || k.arkaPlan > 0) k.eforSonraki = true;
        else await this.surecKapat(k);
      }
    }
    this.durumYay(k);
    return sonraki ? { tamam: true, kod: 'sonraki' } : { tamam: true };
  }

  // ── İşler (bulgu 5): Durdur (stopTask), Arka plana al (backgroundTasks), çıktı kuyruğu ───────────────────────────────────
  private isAl(id: string, isId: unknown): { k: Kayit; is: CcArkaIs } | CcIslemSonucu {
    const k = this.kayitlar.get(id);
    if (!k) return { tamam: false, kod: 'yok', hata: 'Oturum bulunamadı.' };
    const is = typeof isId === 'string' ? k.arkaIsler.find((x) => x.id === isId) : undefined;
    if (!is) return { tamam: false, kod: 'yok', hata: 'İş bulunamadı (bitmiş olabilir).' };
    return { k, is };
  }

  /** İşi durdurur (SDK Query.stopTask → task_notification 'stopped'). Süreç yoksa iş de yoktur. */
  async isDurdur(id: string, isId: unknown): Promise<CcIslemSonucu> {
    const r = this.isAl(id, isId);
    if (!('k' in r)) return r;
    if (r.is.durum !== 'suruyor') return { tamam: true };
    if (!r.k.q || !r.k.canli) return { tamam: false, kod: 'yok', hata: 'Claude Code kapalı; iş zaten durdu.' };
    try { await Promise.race([r.k.q.stopTask(r.is.id), bekle(10_000).then(() => { throw new Error('Claude Code yanıt vermedi.'); })]); } catch (e) {
      return { tamam: false, kod: 'desteklenmiyor', hata: `İş durdurulamadı: ${kisalt(hataMetni(e), 200)}` };
    }
    return { tamam: true };
  }

  /** Ön plandaki işi arka plana alır (CLI'deki Ctrl+B; SDK Query.backgroundTasks(toolUseId)). Tur sürer, iş arkada devam eder. */
  async arkaPlanaAl(id: string, isId: unknown): Promise<CcIslemSonucu> {
    const r = this.isAl(id, isId);
    if (!('k' in r)) return r;
    if (r.is.arkaPlanda || r.is.durum !== 'suruyor') return { tamam: true };
    if (!r.k.q || !r.k.canli) return { tamam: false, kod: 'yok', hata: 'Claude Code kapalı.' };
    // İnceleme M3: araç kimliği olmadan backgroundTasks() BÜTÜN ön plan işlerini arkaya alır — yalnız bu iş hedeflenir.
    if (!r.is.aracId) return { tamam: false, kod: 'desteklenmiyor', hata: 'Bu iş tek başına arka plana alınamıyor.' };
    try {
      const oldu = await Promise.race([r.k.q.backgroundTasks(r.is.aracId), bekle(10_000).then(() => { throw new Error('Claude Code yanıt vermedi.'); })]);
      if (oldu === false) return { tamam: false, kod: 'yok', hata: 'Bu iş artık ön planda değil.' };
    } catch (e) { return { tamam: false, kod: 'desteklenmiyor', hata: `Arka plana alınamadı: ${kisalt(hataMetni(e), 200)}` }; }
    return { tamam: true };
  }

  /**
   * İşin canlı çıktısının son satırları (Claude Code'un çıktı dosyasından; yalnız okunur). Dosya yolu Claude Code'un kendi iletisinden gelir:
   * yalnız mutlak, `.output`/`.log`/`.txt` uzantılı, normal dosya; en çok son 64 KB okunur, en çok `satir` satır döner.
   */
  isCiktisi(id: string, isId: unknown, satir = 40): CcIsCiktisi {
    const r = this.isAl(id, isId);
    if (!('k' in r)) return { satirlar: [], boyut: 0, hata: r.hata };
    const d = r.is.ciktiDosyasi;
    if (!d) return { satirlar: [], boyut: 0, hata: r.is.tip === 'ajan' ? 'Alt ajanın ara çıktısı yok; özeti yukarıda.' : 'Bu işin çıktı dosyası henüz yok.' };
    if (!path.isAbsolute(d) || /^[\\/]{2}/.test(d) || !/\.(output|log|txt)$/i.test(d)) return { satirlar: [], boyut: 0, hata: 'Çıktı dosyası okunmadı (beklenmeyen yol).' };
    try {
      const st = fs.statSync(d);
      if (!st.isFile()) return { satirlar: [], boyut: 0, hata: 'Çıktı dosyası okunamadı.' };
      const n = Math.min(st.size, 64 * 1024);
      const fd = fs.openSync(d, 'r');
      try {
        const b = Buffer.alloc(n);
        fs.readSync(fd, b, 0, n, st.size - n);
        // eslint-disable-next-line no-control-regex
        const metin = b.toString('utf8').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
        const satirlar = metin.split(/\r?\n/).map((s) => s.replace(/\r/g, '')).filter((s, i, l) => s || i < l.length - 1);
        return { satirlar: satirlar.slice(-Math.max(1, Math.min(200, satir))).map((s) => kisalt(s, 400)), boyut: st.size };
      } finally { fs.closeSync(fd); }
    } catch { return { satirlar: [], boyut: 0, hata: 'Çıktı dosyası okunamadı.' }; }
  }

  /** "Tam yetki" ayarı kapandı: Tam yetki modundaki oturumlar Düzenlemelere izin ver'e iner; mod değiştirilemeyen süreç KAPATILIR. */
  async tamYetkiKapandi(): Promise<void> {
    for (const k of this.kayitlar.values()) {
      if (k.mod !== 'bypassPermissions') continue;
      k.mod = 'acceptEdits';
      if (k.q && k.canli) {
        try { await k.q.setPermissionMode('acceptEdits'); } catch { await this.surecKapat(k); } // Tam yetkide sürmesin
      }
      this.yay(k, { tur: 'mod', mod: 'acceptEdits' });
      this.durumYay(k);
    }
  }

  /** Oturumu kapatır (süreç biter; kayıt "kapandı" olarak kalır, yeni mesaj resume ile yeniden açar). */
  async kapat(id: string): Promise<CcIslemSonucu> {
    const k = this.kayitlar.get(id);
    if (!k) return { tamam: false, kod: 'yok', hata: 'Oturum bulunamadı.' };
    k.kapatildi = true;
    k.kuyruk = [];
    if (k.sirada) { k.sirada = false; this.sira = this.sira.filter((x) => x !== k.id); }
    this.izinleriIptal(k, 'Oturum kapatıldı.', true);
    await this.surecKapat(k);
    if (k.sohbetIsi) this.isBildir(k, kesikSonuc()); // kuyruktaki sohbet işi (süren tur zaten surecBitti'de bildirildi)
    if (k.olaylar.length > KAPALI_OLAY_SINIRI) k.olaylar.splice(0, k.olaylar.length - KAPALI_OLAY_SINIRI);
    this.durumYay(k);
    this.kapalilariBuda();
    return { tamam: true };
  }

  /** "Oturumu unut": süreç kapanır ve kayıt silinir (Claude Code'un kendi dökümüne dokunulmaz). */
  async unut(id: string): Promise<CcIslemSonucu> {
    const k = this.kayitlar.get(id);
    if (!k) return { tamam: false, kod: 'yok', hata: 'Oturum bulunamadı.' };
    k.kapatildi = true;
    k.kuyruk = [];
    if (k.sirada) { k.sirada = false; this.sira = this.sira.filter((x) => x !== k.id); }
    this.izinleriIptal(k, 'Oturum kapatıldı.', true);
    await this.surecKapat(k);
    if (k.sohbetIsi) this.isBildir(k, kesikSonuc());
    this.sil(k);
    return { tamam: true };
  }

  private sil(k: Kayit): void {
    if (k.parcaZaman) { clearTimeout(k.parcaZaman); k.parcaZaman = undefined; }
    this.kayitlar.delete(k.id);
    this.kanca(() => this.s.olay?.({ oturum: k.id, sira: ++k.sira, zaman: Date.now(), olay: { tur: 'unutuldu' } }));
  }

  /** Kapalı oturum kaydı sınırı: en eskiler unutulur. */
  private kapalilariBuda(): void {
    const sinir = Math.max(0, this.s.azamiKapali ?? 20);
    const kapali = [...this.kayitlar.values()].filter((k) => k.kapatildi && !k.canli).sort((a, b) => b.sonEtkinlik - a.sonEtkinlik);
    for (const k of kapali.slice(sinir)) this.sil(k);
  }

  /** Süreç yoksa açar (tur başlatmadan) ve komut/model listesini sorar. Sürüm farkı: desteklenmezse boş liste. */
  async komutlar(id: string): Promise<{ canli: boolean; komutlar: CcKomutBilgisi[]; modeller: CcModelBilgisi[]; hata?: string }> {
    const k = this.kayitlar.get(id);
    if (!k) return { canli: false, komutlar: [], modeller: [], hata: 'Oturum bulunamadı.' };
    if (k.kapatildi || this.kapaniyor) return { canli: false, komutlar: [], modeller: [] };
    try { this.surecHazirla(k); } catch (e) { return { canli: false, komutlar: [], modeller: [], hata: hataMetni(e) }; }
    const q = k.q!;
    const zaman = <T>(p: Promise<T>) => Promise.race([p, bekle(20_000).then(() => { throw new Error('Claude Code yanıt vermedi.'); })]);
    try {
      const [komutlar, modeller] = await Promise.all([zaman(q.supportedCommands()), zaman(q.supportedModels()).catch(() => [])]);
      const liste = (modeller ?? []).map((m) => ({ deger: String(m.value), ad: String(m.displayName ?? m.value), aciklama: String(m.description ?? '') }));
      this.modelleriSakla(liste);
      return {
        canli: true,
        komutlar: (komutlar ?? []).map((c) => ({ ad: String(c.name), aciklama: String(c.description ?? ''), ipucu: String(c.argumentHint ?? ''), yerlesik: c.builtin === true, takmaAdlar: Array.isArray(c.aliases) ? c.aliases.map(String) : [] })),
        modeller: liste,
      };
    } catch (e) {
      return { canli: k.canli, komutlar: [], modeller: [], hata: kisalt(hataMetni(e), 300) };
    }
  }

  // ── Model listesi ve hesap (0.13 T12) ──────────────────────────────────────────────────────────────────────────────────
  private modelListesi: CcModelBilgisi[] | null = null;
  private sonHesap: CcHesapBilgisi | null = null;

  /** Dışarıdan gelen (saklı ya da SDK'dan) liste: yalnız geçerli model adları, sınırlı sayıda ve uzunlukta; hiçbiri geçerli değilse boş. */
  private modelleriTemizle(ham: unknown): CcModelBilgisi[] {
    if (!Array.isArray(ham)) return [];
    const out: CcModelBilgisi[] = [];
    for (const m of ham) {
      if (!nesneMi(m) || typeof m.deger !== 'string' || !CC_MODEL_RE.test(m.deger) || out.some((x) => x.deger === m.deger)) continue;
      out.push({ deger: m.deger, ad: kisalt(typeof m.ad === 'string' && m.ad.trim() ? m.ad.trim() : m.deger, 80), aciklama: kisalt(typeof m.aciklama === 'string' ? m.aciklama : '', 300) });
      if (out.length >= 40) break;
    }
    return out;
  }

  /** Oturumdan gelen model listesi kalıcı kayda yazılır (boş liste saklıyı EZMEZ). */
  private modelleriSakla(liste: CcModelBilgisi[]): void {
    const temiz = this.modelleriTemizle(liste);
    if (!temiz.length || JSON.stringify(temiz) === JSON.stringify(this.modelListesi)) return;
    this.modelListesi = temiz;
    try { this.s.modellerYaz?.(temiz.map((m) => ({ ...m }))); } catch { /* kayıt en iyi çaba */ }
  }

  /** Taslakta (oturum yokken) model seçicisinin listesi: bu çalıştırmada oturumdan gelen, yoksa saklı, o da yoksa opus / sonnet / haiku. */
  modeller(): CcModelBilgisi[] {
    if (!this.modelListesi?.length) {
      let saklı: CcModelBilgisi[] = [];
      try { saklı = this.modelleriTemizle(this.s.modellerOku?.()); } catch { /* bozuk kayıt: varsayılan */ }
      if (saklı.length) this.modelListesi = saklı;
    }
    return (this.modelListesi?.length ? this.modelListesi : CC_VARSAYILAN_MODELLER).map((m) => ({ ...m }));
  }

  /** SDK accountInfo → yalnız e-posta ve plan. Oturum yoksa bilinen son değer (hiç yoksa null); hesap sorgulamak için süreç AÇILMAZ. */
  async hesap(): Promise<CcHesapBilgisi | null> {
    const canli = [...this.kayitlar.values()].find((k) => k.q && k.canli && !k.kapatildi);
    if (canli) await this.hesapTazele(canli);
    return this.sonHesap ? { ...this.sonHesap } : null;
  }

  private async hesapTazele(k: Kayit): Promise<void> {
    const q = k.q;
    if (!q) return;
    try {
      const b = await Promise.race([q.accountInfo(), bekle(5000).then(() => null)]);
      if (!b || k.q !== q) return;
      const eposta = typeof b.email === 'string' && b.email.trim() ? kisalt(b.email.trim(), 200) : undefined;
      const plan = typeof b.subscriptionType === 'string' && b.subscriptionType.trim() ? kisalt(b.subscriptionType.trim(), 40) : undefined;
      this.sonHesap = eposta || plan ? { ...(eposta ? { eposta } : {}), ...(plan ? { plan } : {}) } : null;
    } catch { /* süreç kapandı ya da sürüm desteklemiyor: bilinen son değer kalır */ }
  }

  // ── Kapanış ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Uygulama kapanıyor: interrupt() → en çok `kapanisSuresiMs` (5 sn) bekle → close() → kalan süreçleri ağacıyla öldür. */
  async hepsiniKapat(): Promise<void> {
    this.kapaniyor = true;
    for (const id of this.sira) { const k = this.kayitlar.get(id); if (k) k.sirada = false; }
    this.sira = [];
    const canlilar = [...this.kayitlar.values()].filter((k) => k.q);
    const sure = this.s.kapanisSuresiMs ?? 5000;
    const son = Date.now() + sure;
    for (const k of canlilar) { k.kuyruk = []; this.izinleriIptal(k, 'Uygulama kapanıyor.', true); }
    await Promise.all(canlilar.filter((k) => k.turAktif && k.q).map(async (k) => {
      k.kesmeIstendi = true;
      try { await Promise.race([k.q!.interrupt(), bekle(sure)]); } catch { /* süreç çoktan bitti */ }
    }));
    while (Date.now() < son && canlilar.some((k) => k.turAktif && k.q)) await bekle(50);
    await Promise.all(canlilar.map((k) => this.surecKapat(k, 1500)));
    for (const k of this.kayitlar.values()) guvenliOldur(k.pid); // yalnız bizim ve yaşayan süreçler
    const bitis = Date.now() + 3000;
    while (Date.now() < bitis && this.surecler().length) await bekle(50);
    for (const k of this.kayitlar.values()) if (k.parcaZaman) { clearTimeout(k.parcaZaman); k.parcaZaman = undefined; }
  }

  // ── Yardımcılar ────────────────────────────────────────────────────────────────────────────────────────────────────────
  private durumu(k: Kayit): CcDurum {
    if (k.kapatildi) return 'kapandi';
    if (k.izinler.size) return 'izin';
    if (k.turAktif) return 'calisiyor';
    if (k.hata) return 'hata';
    if (k.sirada) return 'sirada';
    return 'bosta';
  }

  private ozet(k: Kayit): CcOturumOzeti {
    const siraNo = k.sirada ? this.sira.indexOf(k.id) + 1 : 0;
    return {
      id: k.id, ...(k.kimlik ? { kimlik: k.kimlik } : {}), cwd: k.cwd, proje: k.proje, baslik: k.baslik,
      durum: this.durumu(k), mod: k.mod, ...(k.model ? { model: k.model } : {}), ...(k.etkinModel ? { etkinModel: k.etkinModel } : {}), ...(k.efor ? { efor: k.efor } : {}), kaynak: k.kaynak,
      ...(typeof k.sohbetId === 'number' ? { sohbetId: k.sohbetId } : {}),
      bekleyenIzin: k.izinler.size, kuyruk: k.kuyruk.length, ...(siraNo > 0 ? { siraNo } : {}), arkaPlan: k.arkaPlan,
      // Üyelikte tahmini dolar özete hiç girmez (paraGoster).
      ...(k.maliyet !== undefined && k.paraGoster ? { maliyetUsd: k.maliyet } : {}), ...(k.belirtec ? { belirtec: { ...k.belirtec } } : {}),
      ...(k.sureMs ? { sureMs: k.sureMs } : {}), ...(k.turSayisi ? { turSayisi: k.turSayisi } : {}),
      degisenDosyaSayisi: k.degisen.size, ...(k.surum ? { surum: k.surum } : {}), yetenekler: k.yetenekler.slice(),
      ...(k.hata ? { hata: k.hata } : {}), olusturma: k.olusturma, sonEtkinlik: k.sonEtkinlik,
    };
  }

  private durumYay(k: Kayit): void {
    const o = this.ozet(k);
    const imza = JSON.stringify([o.durum, o.kuyruk, o.bekleyenIzin, o.siraNo, o.mod, o.model, o.etkinModel, o.efor, o.hata, o.maliyetUsd, o.kimlik, o.baslik, o.degisenDosyaSayisi, o.surum, o.turSayisi, o.arkaPlan]);
    if (imza === k.sonImza) return;
    k.sonImza = imza;
    this.yay(k, { tur: 'durum', ozet: o });
  }

  /** Bekleyen akış parçalarını yayınlar; dökümdeki blok başına birikimli kayıt aynı anda (aynı sıra numarasıyla) güncellenir. */
  private parcalariBosalt(k: Kayit): void {
    if (k.parcaZaman) { clearTimeout(k.parcaZaman); k.parcaZaman = undefined; }
    if (!k.parcaBekleyen.size) return;
    const bekleyen = [...k.parcaBekleyen];
    k.parcaBekleyen.clear();
    for (const [blok, p] of bekleyen) {
      const z: CcOlayZarfi = { oturum: k.id, sira: ++k.sira, zaman: Date.now(), olay: { tur: 'metin-parca', blok, metin: p.metin, ust: p.ust } };
      const birikim = k.parcaGirdi.get(blok);
      if (birikim && birikim.olay.tur === 'metin-parca') { birikim.olay = { ...birikim.olay, metin: birikim.olay.metin + p.metin }; birikim.sira = z.sira; birikim.zaman = z.zaman; }
      else { const kayit = { ...z, olay: { ...z.olay } }; k.parcaGirdi.set(blok, kayit); this.dokumeEkle(k, kayit); }
      k.sonEtkinlik = z.zaman;
      this.kanca(() => this.s.olay?.(z));
    }
  }

  private dokumeEkle(k: Kayit, z: CcOlayZarfi): void {
    k.olaylar.push(z);
    if (k.olaylar.length > OLAY_SINIRI) {
      for (const atilan of k.olaylar.splice(0, k.olaylar.length - OLAY_SINIRI)) {
        if (atilan.olay.tur === 'metin-parca' && k.parcaGirdi.get(atilan.olay.blok) === atilan) k.parcaGirdi.delete(atilan.olay.blok);
      }
    }
  }

  private yay(k: Kayit, olay: CcOlay): void {
    if (olay.tur === 'metin-parca') {
      // Parçalar ~50 ms'de bir toplu yayınlanır (IPC seli yok) ve dökümde tek kayıtta birikir (geçmişi itmez).
      const p = k.parcaBekleyen.get(olay.blok);
      if (p) p.metin += olay.metin; else k.parcaBekleyen.set(olay.blok, { metin: olay.metin, ust: olay.ust });
      if (!k.parcaZaman) k.parcaZaman = setTimeout(() => this.parcalariBosalt(k), this.s.parcaAraligiMs ?? 50);
      return;
    }
    this.parcalariBosalt(k); // sıra korunur: bekleyen parçalar her öteki olaydan önce
    const z: CcOlayZarfi = { oturum: k.id, sira: ++k.sira, zaman: Date.now(), olay };
    // 'durum' ve 'arka-isler' anlık hâldir: dökümde tutulmaz (ayrıntı ve özet son hâli taşır).
    if (olay.tur !== 'durum' && olay.tur !== 'arka-isler') {
      k.sonEtkinlik = z.zaman;
      const birikim = olay.tur === 'metin' ? k.parcaGirdi.get(olay.blok) : undefined;
      if (birikim && olay.tur === 'metin') { // tam metin birikimli parçanın YERİNE (konumu korunur)
        birikim.olay = olay; birikim.sira = z.sira; birikim.zaman = z.zaman;
        k.parcaGirdi.delete(olay.blok);
      } else this.dokumeEkle(k, { ...z });
    }
    this.kanca(() => this.s.olay?.(z));
  }

  private kanca(f: () => void): void {
    try { f(); } catch (e) { console.warn('[claude-code] kanca hata verdi:', hataMetni(e)); }
  }
}
