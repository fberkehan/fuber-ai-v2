// ── Toplantı: yapay zekâ çağrısı ve seçimin isteğe yansıması (13 Kas 2026, 0.17.3; Electron'suz — tests/toplanti.test.ts) ──────────────────────────
// Her istek (çeviri, soru denetimi, öneri, özet) seçimi O AN okur: kullanıcı toplantı sürerken modeli değiştirirse değişiklik bir sonraki istekte devreye girer.
// Karar (shared/toplanti-model.ts yzKarari): Gizli / "Yalnız bu bilgisayar" → her zaman yerel (seçim ne olursa olsun, P14); 'yerel' → yerel; Claude model → o model;
// aksi → uygulamanın bugünkü yolu. Gerçek çağrılar enjekte edilir (main/toplanti.ts bağlar; testte sahte).
import { yzKarari, type YzBaglami } from '../../shared/toplanti-model.ts';
import type { YzIstegi, YzYolu } from './oturum.ts';

export interface YzBagi {
  tercihYz(): string;
  baglam(): YzBaglami;
  /** Bu bilgisayardaki yapay zekâ (sabit yol; buluta düşmez). */
  yerel(i: YzIstegi): Promise<string>;
  /** Seçilen Claude modeliyle (kullanıcının kendi anahtarı). */
  model(i: YzIstegi, model: string): Promise<string>;
  /** Uygulamanın bugünkü seçimi (Fuber hesabı ya da Ayarlar'daki sağlayıcı). */
  varsayilan(i: YzIstegi): Promise<string>;
}

export function yzCagrisiKur(b: YzBagi): (i: YzIstegi, yol: YzYolu) => Promise<string> {
  return (i, yol) => {
    if (yol === 'yerel') return b.yerel(i); // oturum Gizli'yi gördü: seçim bakılmaz
    const k = yzKarari(b.tercihYz(), b.baglam());
    if (k.tur === 'yerel') return b.yerel(i);
    if (k.tur === 'model') return b.model(i, k.model);
    return b.varsayilan(i);
  };
}
