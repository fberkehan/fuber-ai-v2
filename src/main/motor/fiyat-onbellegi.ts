// Canlı model fiyatları (OpenRouter /models): model-listesi.ts başarılı her canlı listede buraya yazar; kullanım kaydı (secici.ts) ve
// özeti (kullanim.ts) yerleşik tabloda olmayan kimliğin fiyatını buradan okur. Ayrı modül: secici ↔ model-listesi döngüsel içe aktarma
// olmasın. Yalnız bellekte (uygulama kapanınca gider; özet gerekirse listeyi yeniden ister).
import type { ModelBilgisi } from '../../shared/model-bilgisi.js';

const fiyatlar = new Map<string, Pick<ModelBilgisi, 'girisFiyat' | 'cikisFiyat'>>();
const anahtar = (s: string, id: string) => `${s}\n${id}`;

export function canliFiyatlariYaz(s: string, modeller: readonly ModelBilgisi[]): void {
  for (const m of modeller) {
    if (m.girisFiyat !== undefined && m.cikisFiyat !== undefined) fiyatlar.set(anahtar(s, m.id), { girisFiyat: m.girisFiyat, cikisFiyat: m.cikisFiyat });
  }
}

export function canliFiyat(s: string, id: string): Pick<ModelBilgisi, 'girisFiyat' | 'cikisFiyat'> | undefined {
  return fiyatlar.get(anahtar(s, id));
}
