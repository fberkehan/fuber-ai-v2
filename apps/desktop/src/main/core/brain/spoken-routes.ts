/**
 * Çalışma anında eklenen sesli komut kalıpları (eklentilerin `voice` katkısı): söz, kayıtlı bir kalıpla KESİN
 * eşleşirse araç modele sorulmadan kodla çağrılır ("pomodoro başlat" → `skill_pomodoro_baslat`). Yerleşik kalıplar
 * (`local-commands.ts`, `local-intents.ts`) sabit koddur ve bunlardan ÖNCE denenir; bu kayıt yalnız onların
 * tanımadığı söze bakar.
 *
 * Eşleşme bilerek dardır: söz, kalıbın kendisi olmalı (baştaki hitap ve sondaki nezaket sözü dışında fazladan sözcük
 * yok). "Pomodoro başlatmayı unutma" gibi bir cümle kalıba uymaz ve modele kalır. Çağrı araç kapısından kullanıcının
 * kökeniyle geçer; `danger` araç kalıpla çağrılsa bile onay ister.
 */
import type { Unsubscribe } from '@fuber/shared';

export interface SpokenRoute {
  /** Kullanıcının söyleyebileceği kalıplar. */
  phrases: readonly string[];
  /** Kayıtlı (beyne görünen) bir aracın adı. */
  tool: string;
  input: Record<string, unknown>;
}

export interface SpokenRouteMatch {
  name: string;
  input: Record<string, unknown>;
}

const MAX_ROUTES_PER_OWNER = 16;
const owners = new Map<string, Array<{ phrases: string[]; tool: string; input: Record<string, unknown> }>>();

/** Karşılaştırma biçimi: küçük harf, Türkçe harfler korunur, noktalama ve fazla boşluk atılır. */
export function foldPhrase(text: string): string {
  return text
    .toLocaleLowerCase('tr-TR')
    .replace(/[^a-z0-9çğıöşüâîû]+/g, ' ')
    .trim();
}

/** Baştaki hitap ("jarvis", "hey jarvis", "ya", "bir") ve sondaki nezaket sözü ("lütfen", "hadi", "bakalım") atılır. */
function core(text: string): string {
  return foldPhrase(text)
    .replace(/^(?:(?:hey|ey|ya|şey|hadi|lütfen|jarvis|cervis|carvis)\s+)+/, '')
    .replace(/(?:\s+(?:lütfen|hadi|bakalım|bakayım|jarvis|ya|artık|şimdi))+$/, '')
    .trim();
}

/** Bir sahibin (eklentinin) kalıplarını kurar; `null` ya da boş liste kaldırır. Dönen işlev de kaldırır. */
export function setSpokenRoutes(owner: string, routes: readonly SpokenRoute[] | null): Unsubscribe {
  if (!routes || routes.length === 0) {
    owners.delete(owner);
  } else {
    owners.set(
      owner,
      routes.slice(0, MAX_ROUTES_PER_OWNER).map((route) => ({
        phrases: route.phrases.map((phrase) => foldPhrase(phrase)).filter((phrase) => phrase.length >= 3),
        tool: route.tool,
        input: route.input,
      })),
    );
  }
  return () => void owners.delete(owner);
}

/** Söz kayıtlı bir kalıpla kesin eşleşiyorsa çağrılacak araç; yoksa `null`. İki sahip aynı kalıbı verdiyse eşleşme yok sayılır. */
export function matchSpokenRoute(text: string): SpokenRouteMatch | null {
  const said = core(text);
  if (said.length < 3) return null;
  const hits: SpokenRouteMatch[] = [];
  for (const routes of owners.values()) {
    for (const route of routes) {
      if (route.phrases.includes(said)) hits.push({ name: route.tool, input: route.input });
    }
  }
  // Belirsizlik (iki eklenti aynı sözü istiyor): kod karar vermez, model sorar.
  return hits.length === 1 ? hits[0]! : null;
}

/** Sınama ve tanı: kayıtlı sahipler. */
export const spokenRouteOwners = (): string[] => [...owners.keys()];
