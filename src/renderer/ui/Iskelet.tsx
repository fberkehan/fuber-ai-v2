// Iskelet (0.11 G3): yükleniyor hâli. Her "satır" yerini tuttuğu Satir'in kutusudur — aynı iç boşluk, en az boy ve satır yükseklikleri
// (ui.css'te tek kaynak: --ui-baslik-*, --ui-alt-*, --ui-satir-*), bu yüzden veri gelince kart zıplamaz. Gelecek satırlara göre seç:
//   <Iskelet satir={3} />                         → başlık tek satır, alt yok          (Satir baslik)
//   <Iskelet satir={3} alt />                     → başlık tek satır + alt satır       (Satir baslik + alt)
//   <Iskelet satir={3} alt baslikSatiri={2} />    → iki satırlık başlık + alt          (Satir satir={2} + alt; başlık gerçekten 2 satırsa)
// (Düzeltme turu 1, inceleme K5: eskiden yalnız altsız tek satır eşitti; alt satırlı listede kart 30–80 px büyüyordu.) Parıltı arka plan
// konumuyla akar (dönüşüm yok: taşma ölçümünü bozmaz); hareketi azaltta durur. Ekran okuyucuya "Yükleniyor" (görsel olarak gizli).
import type { CSSProperties } from 'react';
import './ui.css';

// Satır satır değişen genişlikler (%): [başlık, ikinci başlık satırı, alt] — düzgün bir ızgara gibi değil, gerçek içerik gibi görünsün.
const GENISLIK: readonly (readonly [number, number, number])[] = [[78, 52, 44], [62, 40, 36], [86, 58, 52], [58, 34, 30], [72, 46, 48]];

export interface IskeletOzellikleri {
  /** Kaç satır (1–12). */
  satir: number;
  /** Satırların alt (ikincil) satırı var mı — Satir `alt`. */
  alt?: boolean;
  /** Başlık kaç satır — Satir `satir` (yalnız başlık gerçekten o kadar uzunsa 2). */
  baslikSatiri?: 1 | 2;
}

export function Iskelet({ satir, alt = false, baslikSatiri = 1 }: IskeletOzellikleri) {
  const n = Math.max(1, Math.min(12, Math.floor(satir) || 1));
  const cizgi = (genislik: number, gecikme: number) => (
    <span className="ui-iskelet__cizgi" style={{ width: `${genislik}%`, animationDelay: `${gecikme}ms` } as CSSProperties} />
  );
  return (
    <div className="ui-iskelet" role="status" aria-busy="true">
      <span className="ui-gizli">Yükleniyor</span>
      {Array.from({ length: n }, (_, i) => {
        const [b, b2, a] = GENISLIK[i % GENISLIK.length];
        return (
          <span key={i} className="ui-iskelet__satir" aria-hidden="true">
            <span className="ui-iskelet__bas">
              <span className="ui-iskelet__b">{cizgi(baslikSatiri === 2 ? 94 : b, i * 90)}</span>
              {baslikSatiri === 2 && <span className="ui-iskelet__b">{cizgi(b2, i * 90 + 30)}</span>}
            </span>
            {alt && <span className="ui-iskelet__a">{cizgi(a, i * 90 + 45)}</span>}
          </span>
        );
      })}
    </div>
  );
}
