// Kokpit başlık hapı: yapay zekânın hâli. Hâl TEK kaynaktan (renderer/motor-sinyali.ts gorunum → shared/motor-durumu.ts; etiket
// shared/abonelik.ts motorEtiketi): İş yalnız "Yapay zekâ hazır" / "Yalnız gündelik sohbet" (Gizli modda "Gizli mod"); bildirim gerektiren
// hâllerde hap ÇİZİLMEZ (0.10 Görev 2, A-3; R28b: tek bildirim kokpit kartında ya da dolu sohbette şeritte). Geliştirici "N motor bağlı" /
// "yalnız yerel model" / "motor bağlı değil" (gri) / "motor durdu". Sinyal gelene dek çizilmez (metin titremesin).
import { motorEtiketi } from '../../shared/abonelik';
import { useMotorSinyali } from '../motor-sinyali';
import { yalnizYerelSecili } from '../../shared/motor-durumu';

const NOKTA = { yesil: 'nokta--yesil', turuncu: 'nokta--turuncu', kirmizi: 'nokta--kirmizi', gri: '' } as const;

export function MotorHapi() {
  const m = useMotorSinyali();
  if (!m.hazir || !m.a) return null;
  const e = motorEtiketi(m.gorunum, m.mod, m.motor.bulut, m.gizli, yalnizYerelSecili(m.motor));
  if (!e) return null;
  return (
    <span className="hap" data-motor-hapi="" data-motor-hali={m.gorunum} title={e.ipucu}>
      <span className={`nokta ${NOKTA[e.nokta]}`} />{e.hap}
    </span>
  );
}
