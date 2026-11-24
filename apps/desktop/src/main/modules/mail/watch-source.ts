// Takip işleri (İşler modülü) için e-posta kaynağı: "Ahmet'ten e-posta gelince söyle", "konusunda fatura geçen ileti gelince
// haber ver". Kaynak e-posta modülünündür; İşler modülüne `watch.sources.collect` olayıyla takılır (`index.ts`). Modüller
// birbirini içe aktarmaz: gözcünün arayüzü yalnız tip olarak alınır. E-posta modülü kapalıyken dinleyici yoktur, kaynak
// listede görünmez; hesap yokken kaynak "kullanılamıyor" der ve modele önerilmez.
//
// Olay kaynağıdır: yalnız iş BAŞLADIKTAN SONRA gelen iletiler sayılır. Dayanak eşitlemenin itme olayıdır (`mail.received`);
// ilk eşitlemenin eski iletileri o olayla gelmez, bu yüzden hesabı yeni eklenen kutunun geçmişi "yeni ileti" sanılmaz.
// Kaynak yapay zekâ çağırmaz ve ileti GÖVDESİNİ okumaz: gönderen ve konu satırıyla çalışır (gövde güvenilmez veridir).
import { foldForSearch, t, type Bus } from '@fuber/shared';
import type { WatchProbe, WatchSourceDef } from '../watch/types';
import type { MailQueryHit, MailQueryResult } from './types';

interface Arrival {
  at: number;
  from: string;
  address: string;
  subject: string;
}

export interface MailWatchDeps {
  bus: Bus;
  /** Hesap var mı, son eşitleme (yalnız kullanılabilirlik için; iletiler itme olayından gelir). */
  status(): Pick<MailQueryResult, 'available' | 'lastSyncAt'>;
  /** Hemen eşitleme iste (e-posta modülü dakikada birle sınırlar). */
  syncSoon(): void;
  now(): number;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
/**
 * Haberde görünen gönderen: yalnız adı. E-posta modülü göndereni başlıktaki haliyle verir ("Ahmet Yılmaz <ahmet@ornek.com>");
 * adres haberde (ve sesli okumada) kalabalıktır. Ad yoksa adres. (Uçtan uca sınamada bulundu; birim sınaması yalın adla yazılmıştı.)
 */
const senderName = (arrival: { from: string; address: string }) => arrival.from.replace(/\s*<[^>]*>\s*$/, '').replace(/^["']+|["']+$/g, '').trim() || arrival.address;
/** Bellekte tutulan en çok varış (eskisi atılır). */
const MAX_ARRIVALS = 300;

export function mailWatchSource(deps: MailWatchDeps): WatchSourceDef & { dispose(): void } {
  const arrivals: Arrival[] = [];
  const pokes = new Set<{ target: string; poke: () => void }>();
  /** Hedef: gönderenin adı ya da adresi, ya da konudan bir sözcük; boş = hangi ileti olursa. */
  const matches = (arrival: Arrival, target: string) => {
    const want = foldForSearch(target.trim());
    if (!want) return true;
    return foldForSearch(arrival.from).includes(want) || foldForSearch(arrival.address).includes(want) || foldForSearch(arrival.subject).includes(want);
  };
  const off = deps.bus.on('mail.received', ({ messages }) => {
    const fresh = (messages as MailQueryHit[]).map((message) => ({ at: deps.now(), from: message.from, address: message.fromAddress, subject: message.subject }));
    if (fresh.length === 0) return;
    arrivals.push(...fresh);
    if (arrivals.length > MAX_ARRIVALS) arrivals.splice(0, arrivals.length - MAX_ARRIVALS);
    for (const entry of pokes) if (fresh.some((arrival) => matches(arrival, entry.target))) entry.poke();
  });
  return {
    kind: 'mail',
    moduleId: 'mail',
    label: t('mail.watch.label'),
    targetHint: t('mail.watch.targetHint'),
    mode: 'events',
    // Eşitleme e-posta modülünün kendi aralığındadır; denetim yalnız "hemen eşitle" ister ve gelenlere bakar.
    minIntervalSec: 60,
    maxIntervalSec: 600,
    available: () => (deps.status().available ? null : t('mail.watch.unavailable')),
    normalize: (target) => ({ target: target.trim().replace(/^["“”']+|["“”']+$/g, '').slice(0, 120) }),
    describe: (target) => (target.trim() ? t('mail.watch.describe', { target: clip(target.trim(), 60) }) : t('mail.watch.describeAny')),
    async check({ target, previous, since }): Promise<WatchProbe> {
      if (!deps.status().available) throw new Error(t('mail.watch.unavailable'));
      // Bir sonraki denetime kadar kutuya yeniden bakılsın (itme olayı gelirse iş beklemeden dürtülür).
      deps.syncSoon();
      const after = Math.max(since, Number(previous) || 0);
      const fresh = arrivals.filter((arrival) => arrival.at > after && matches(arrival, target));
      if (fresh.length === 0) return { signature: previous ?? String(since), text: '' };
      // Yalnız gönderen ve konu: koşullar (appears, matches, ask) bu satırlara bakar.
      const text = fresh.map((arrival) => `${senderName(arrival)}: ${arrival.subject || t('mail.watch.noSubject')}`).join('\n');
      const finding =
        fresh.length === 1
          ? t('mail.watch.findingOne', { from: senderName(fresh[0]!), subject: clip(fresh[0]!.subject || t('mail.watch.noSubject'), 120) })
          : t('mail.watch.findingMany', { count: fresh.length, from: senderName(fresh[fresh.length - 1]!) });
      return { signature: String(fresh[fresh.length - 1]!.at), text, finding: clip(finding, 300) };
    },
    subscribe(target, poke) {
      const entry = { target, poke };
      pokes.add(entry);
      return () => pokes.delete(entry);
    },
    dispose() {
      off();
      pokes.clear();
    },
  };
}
