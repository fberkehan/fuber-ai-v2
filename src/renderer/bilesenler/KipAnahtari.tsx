// ── Kip anahtarı (0.13 T4): sol rayda iki parçalı küçük anahtar — Business mode / Developer mode ───────────────────────────────
// Ayarlar → Genel → Kullanım'daki mod kartlarıyla AYNI alanı yazar (`mod`, ayarlar:kaydet → 'ayarlar:degisti'); yeni bir kapı yok. Tam ad
// ipucunda (title) ve ekran okuyucu adında; simge parçası: çanta = Business, kod = Developer. Sürmekte olan yanıt kilitli karakterle biter
// (ajan/dongu.ts): anahtar yalnız bir SONRAKİ mesajın karakterini değiştirir.
import { cagir } from '../api';
import { Ikon } from './Ikon';
import { KIP_ADI } from '../../shared/karakterler';
import type { Mod } from '../../shared/tipler';
import './kip-anahtari.css';

const PARCALAR: readonly (readonly [Mod, string])[] = [['is', 'canta'], ['gelistirici', 'kod']];

export function KipAnahtari({ mod }: { mod: Mod }) {
  const sec = (m: Mod) => { if (m !== mod) void cagir('ayarlar:kaydet', { mod: m }); };
  return (
    <div className="kip-anahtari" role="group" aria-label="Mod">
      {PARCALAR.map(([m, ikon]) => (
        <button key={m} type="button" className="kip-anahtari__dgm" data-kip={m} aria-pressed={mod === m} aria-label={KIP_ADI[m]} onClick={() => sec(m)}>
          <Ikon ad={ikon} olcu={16} />
          {/* 11 Kas (bulgu 5): rayın öteki simgeleriyle aynı ipucu (eskiden yalnız tarayıcının title'ı). */}
          <span className="ray__ipucu kip-anahtari__ipucu" aria-hidden="true">{KIP_ADI[m]}</span>
        </button>
      ))}
    </div>
  );
}
