// Özel klasörlere (yonetim/, sunucu/) kısmen bağlı testler için (açık kaynak hazırlığı, 11 Kas): genel depoda bu klasörler yoktur, testin o kısmı
// node:test'in skip'iyle sessizce atlanır. Tamamen özel test dosyaları ise ilk satırlarında işaret yorumu taşır (scripts/ozel-klasor.mjs ISARET;
// koşucu scripts/testleri-kos.mjs). Bu yardımcı dosya işaret TAŞIMAZ: genel ağaçta da bulunur.
import { ozelModulGirisleri, ozelVarMi } from '../../scripts/ozel-klasor.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const YONETIM_VAR: boolean = ozelVarMi('yonetim');
export const SUNUCU_VAR: boolean = ozelVarMi('sunucu');
export const LANDING_VAR: boolean = ozelVarMi('landing');
export const MOBIL_VAR: boolean = ozelVarMi('mobil');
export const E2E_VAR: boolean = ozelVarMi('e2e');
/** İsteğe bağlı WhatsApp modülü (ozel/whatsapp/; bu depoda yok). */
export const WHATSAPP_VAR: boolean = ozelVarMi('whatsapp');
type OzelAd = 'yonetim' | 'sunucu' | 'acik-kaynak' | 'landing' | 'mobil' | 'e2e' | 'whatsapp';

/**
 * İsteğe bağlı modülleri (ozel/<modül>/kayit.ts) yükler — uygulamada scripts/build-main.mjs'in yaptığının aynısı: her modül kendini genel kodun
 * kapısına kaydeder (ör. main/entegrasyon/whatsapp-kapisi.ts). Bu depoda `ozel/` yoktur: hiçbir şey yüklenmez, boş liste döner. Ana süreç sahnesi
 * (tests/yardimci/ana-surec.ts) kurulduktan ve esbuild hazır olduktan sonra çağrılır. Testler özel klasörü adıyla içe aktarmaz; bu genel yükleyiciyi kullanır.
 */
export async function ozelModulleriYukle(): Promise<string[]> {
  const kok = path.resolve(import.meta.dirname, '..', '..');
  const girisler = ozelModulGirisleri(kok);
  for (const g of girisler) await import(pathToFileURL(path.join(kok, g)).href);
  return girisler;
}

/** node:test seçeneği: klasörlerden biri yoksa `{ skip: neden }`, hepsi varsa `{}`. */
export function ozelGerekli(...adlar: OzelAd[]): { skip?: string } {
  const eksik = adlar.filter((a) => !ozelVarMi(a));
  return eksik.length ? { skip: `${eksik.map((a) => `${a}/`).join(', ')} bu depoda yok` } : {};
}
