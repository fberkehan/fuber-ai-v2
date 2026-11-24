// Tema çözümü (saf mantık): kullanıcının seçtiği tema + işletim sisteminin rengi + Şeffaf (cam) desteği → ekranda geçerli tema. Şeffaf yalnız
// Windows 11 22H2 (derleme ≥ 22621) ve macOS'ta; destek yoksa seçim ne olursa olsun Koyu'ya düşer ve Şeffaf hiç sunulmaz. Ana süreç ve
// arayüz AYNI fonksiyonları kullanır (Electron'a bağlı değil, birim testli: tests/tema-cozum.test.ts, tests/kurulum-v2.test.ts).
// 0.12 H3a — kurulum sihirbazı yarı şeffaf, bozuk bir ekran olarak açılıyordu. Kök neden Şeffaf temanın kendisi değil, kurulumun
// ona açık kalmasıydı; tema topyekûn kaldırıldı. 0.13 T13 — Şeffaf tema geri geldi. Tema Ayarlar → Görünüm'e "Şeffaf"
// olarak döndü; kurulum, Tekrar hoş geldin ve açılış HER durumda opaktır (pencereMalzemesi / pencereZeminiBul: kurulum görünürken sistem
// malzemesi 'none', zemin opak; sayfa tarafı tasarim.css).
import type { Tema } from './tipler.js';

/** Ekranda gerçekten uygulanan tema ('sistem' burada çözülmüş olur). */
export type EtkinTema = 'koyu' | 'acik' | 'cam';

/** Ana pencerenin zemini (tasarim.css'teki --bg ile aynı; camda saydam). Koyu ve açık OPAK: alfa yok (tests/kurulum-v2.test.ts denetler). */
export const PENCERE_ZEMIN: Record<EtkinTema, string> = { koyu: '#000000', acik: '#e9e9ec', cam: '#00000000' };

/** Geçerli tema seçimleri (Ayarlar → Görünüm: Koyu · Açık · Şeffaf · Otomatik). Şeffaf'ı kimin göreceğini `sunulanTemalar` belirler. */
export const TEMALAR: readonly Tema[] = ['koyu', 'acik', 'sistem', 'cam'];

/** Windows 11 22H2'nin ilk derlemesi: `setBackgroundMaterial` (acrylic) buradan itibaren çalışır; altı (21H2 dahil) desteklemez. */
const WIN11_22H2_DERLEME = 22621;

/** Bu bilgisayarda Şeffaf var mı? `surum` = `os.release()` (Windows'ta "10.0.22631" → derleme 22631). */
export function camDestekli(platform: string, surum: string): boolean {
  if (platform === 'darwin') return true;
  if (platform !== 'win32') return false;
  const derleme = Number(surum.split('.')[2]);
  return Number.isInteger(derleme) && derleme >= WIN11_22H2_DERLEME;
}

/** Bu bilgisayarda kullanıcıya sunulan temalar: Şeffaf yalnız `cam` (camDestekli) true ise. Ayarlar ve kurulum aynı listeyi kullanır. */
export const sunulanTemalar = (cam: boolean): readonly Tema[] => TEMALAR.filter((t) => t !== 'cam' || cam);

/** Kayıtlı/gelen tema değerini geçerli seçeneklere çevirir: 'cam' dahil bütün TEMALAR aynen kalır; bilinmeyen → `varsayilan`.
 *  Destek denetimi burada YOK (ayar başka bir bilgisayardan gelmiş olabilir): etkinTemaBul bu bilgisayarda Koyu'ya düşürür, kayıt değişmez. */
export function temaGocu(t: unknown, varsayilan: Tema = 'koyu'): Tema {
  return (TEMALAR as readonly unknown[]).includes(t) ? (t as Tema) : varsayilan;
}

/** Seçimden etkin temayı bulur. `sistemKoyu`: işletim sistemi koyu mu; `cam`: camDestekli() sonucu (telefonda false). */
export function etkinTemaBul(secim: Tema | undefined, sistemKoyu: boolean, cam: boolean): EtkinTema {
  if (secim === 'cam') return cam ? 'cam' : 'koyu';
  if (secim === 'acik') return 'acik';
  if (secim === 'sistem') return sistemKoyu ? 'koyu' : 'acik';
  return 'koyu';
}

/** Ana pencereye uygulanacak sistem malzemesi: yalnız cam temada ve kurulum / Tekrar hoş geldin GÖRÜNMÜYORKEN (`opakSahne` false). Aksi hâlde 'none'
 *  (Windows 11 gizli başlıklı pencereye kendiliğinden Mica verdiği için "yok" açıkça yazılır: main/pencere-kabugu.ts). */
export function pencereMalzemesi(platform: string, etkin: EtkinTema, opakSahne: boolean): 'acrylic' | 'under-window' | 'none' {
  if (etkin !== 'cam' || opakSahne) return 'none';
  return platform === 'win32' ? 'acrylic' : platform === 'darwin' ? 'under-window' : 'none';
}

/** Ana pencerenin zemin rengi: camda saydam, ama opak sahne (kurulum, Tekrar hoş geldin) açıkken cam da opak koyu. */
export function pencereZeminiBul(etkin: EtkinTema, opakSahne: boolean): string {
  return PENCERE_ZEMIN[etkin === 'cam' && opakSahne ? 'koyu' : etkin];
}
