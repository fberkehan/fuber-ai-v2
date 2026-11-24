// Açılış örtüsü: pencere ilk açıldığında FUBER yazısı harf harf gelir, altında ince bir çizgi açılır ve örtü
// uygulamaya erir. Süreç başına bir kez; toplam ~1,1 sn; tıklama ya da tuş atlatır; azaltılmış harekette durağan ve
// kısa. Süreler tek yerde (aşağıdaki SPLASH); CSS yalnız bu değişkenleri okur. Ses çalınmaz.
import { useEffect, useState, type CSSProperties } from 'react';
import { useReducedMotion } from '@fuber/ui';

/** Bütün süreler (ms). */
export const SPLASH = {
  /** Harfler arası gecikme ve bir harfin giriş süresi. */
  letterGap: 55,
  letterIn: 380,
  /** Çizginin açılması. */
  lineAt: 240,
  lineIn: 520,
  /** Örtünün erimeye başladığı an ve erime süresi. */
  leaveAt: 880,
  leave: 220,
  /** Azaltılmış harekette toplam süre. */
  reduced: 300,
} as const;

const WORD = 'FUBER';
let played = false;

export function Splash({ enabled }: { enabled: boolean }) {
  const reduce = useReducedMotion() ?? false;
  const [phase, setPhase] = useState<'show' | 'leave' | 'done'>(() => (enabled && !played ? 'show' : 'done'));

  useEffect(() => {
    if (phase === 'done') return;
    played = true;
    const leaveAt = reduce ? SPLASH.reduced : SPLASH.leaveAt;
    const leave = window.setTimeout(() => setPhase('leave'), leaveAt);
    const done = window.setTimeout(() => setPhase('done'), leaveAt + SPLASH.leave);
    // Tıklama ya da tuş örtüyü atlatır (olay uygulamaya da ulaşır: örtü tıklamayı yutmaz).
    const skip = () => setPhase('done');
    window.addEventListener('pointerdown', skip, { once: true });
    window.addEventListener('keydown', skip, { once: true });
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(done);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
  }, [reduce]);

  if (phase === 'done') return null;
  const vars = {
    '--splash-letter-in': `${SPLASH.letterIn}ms`,
    '--splash-line-at': `${SPLASH.lineAt}ms`,
    '--splash-line-in': `${SPLASH.lineIn}ms`,
    '--splash-leave': `${SPLASH.leave}ms`,
  } as CSSProperties;
  return (
    <div className="splash" data-phase={phase} data-testid="splash" style={vars} aria-hidden>
      <div className="splash-word">
        {[...WORD].map((letter, index) => (
          <span key={index} style={{ animationDelay: `${index * SPLASH.letterGap}ms` }}>
            {letter}
          </span>
        ))}
      </div>
      <i className="splash-line" />
    </div>
  );
}
