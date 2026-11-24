// Eşlikçi: konuşmalara yeri gelince ARAYA GİRER; çoğu zaman susar. Fuber AI 1'in `gunkaydi/eslikci.ts` dosyasının v2
// karşılığı. Örnek: kullanıcı arkadaşına "bugün çiğ köfte yesek mi" der; Jarvis "iki gün önce bir daha
// yemeyeceğiz demiştiniz" diye araya girer.
//
// Proje kararı (17 Kasım 2026): sürekli dinleme HER ZAMAN yerel modelde. Yerel model dökümden kısa notlar çıkarır ve
// önemli/önemsiz diye ayırır (`note-taker.ts`); eşlikçi yalnız yerel model bir notu ÖNEMLİ işaretleyince uyanır ve
// konuşan beyne (Claude Code → Anthropic) YALNIZ kısa notları gösterir. Ham döküm buluta hiç gitmez.
//
// Kapılar ucuzdan pahalıya:
//   1) kod kapıları (`gates.ts` › `interjectGate`): politika, toplantı, tam ekran, sessiz saat, saatlik sınır (araya
//      girme VE beyne danışma sayısı), aralık, kullanıcı konuşuyor mu;
//   2) modelsiz ön eleme: yeni önemli notun anahtar sözcükleri eski notlarda, meselelerde, raporlarda ya da hafızada
//      iz bırakıyor mu. İz yoksa model HİÇ çağrılmaz (dayanağı olmayan konuda araya girilmez; KURGU §10.2);
//   3) model kararı (konuşan beyin, `cloudOnly`; kip `on` ise bulut yokken yerel model): { speak, kind, text,
//      confidence, source };
//   4) kod denetimi (`acceptDecision`): güven eşiği, gösterilen kaynağın gerçekten verilenlerden biri olması, aynı
//      konunun yakın zamanda söylenmemiş olması (`repeat-guard.ts`).
//
// ÖLÇÜM (`node scripts/e2e/ambient.mjs --measure`): sonuçlar ve varsayılan karar dosyanın sonundaki `MEASUREMENT` notunda.
import { foldForSearch, type BrainApi, type Logger, type MemoryApi } from '@fuber/shared';
import { z } from 'zod';
import { dayKey, topicSimilarity } from './periods';
import { isRepeat, type ProactiveTrace } from './repeat-guard';
import type { AmbientRepo } from './repo';
import { stemSet } from './stems';
import type { AmbientInterjection, AmbientNote, InterjectionKind } from './types';

/** Model güveni bu eşiğin altındaysa susulur (v1 değerleri: hatırlatma 0,7, espri 0,82). */
export const CONFIDENCE_THRESHOLD: Record<InterjectionKind, number> = { reminder: 0.7, info: 0.7, joke: 0.82 };
/** Aynı kayda dayanarak bu süre içinde ikinci kez araya girilmez. */
export const SAME_SOURCE_SILENCE_MS = 7 * 86_400_000;
/** Bu kadar yeni notlar "aynı konuşmanın kendisi" sayılır; iz olarak kullanılmaz. */
const SAME_CONVERSATION_MS = 5 * 60_000;
const MAX_TRACES = 6;
const MAX_TEXT = 240;

export const DecisionSchema = z.object({
  speak: z.boolean(),
  kind: z.enum(['reminder', 'info', 'joke']),
  text: z.string(),
  confidence: z.number(),
  source: z.number(),
});
export type Decision = z.infer<typeof DecisionSchema>;

/** Modele gösterilen bir dayanak. `ref`: `N-<not>`, `M-<mesele>`, `R-<rapor>`, `H-<hafıza>`. */
export interface Trace {
  ref: string;
  /** Kaydın ne zaman ve nereden olduğu: "not · 2 gün önce 14:05". */
  label: string;
  text: string;
}

export function companionInstructions(assistant: string, address: string): string {
  return `Sen ${assistant} adlı kişisel asistansın. Bu bilgisayardaki yerel model, kullanıcının ve yanındakilerin az önceki konuşmasından kısa notlar çıkardı ("Yeni notlar"); konuşmanın kendisini görmezsin. Çoğu zaman SUSARSIN: speak false.
Yalnız şu iki durumda çok kısa araya girersin:
1) Yeni not "Dayanaklar"daki bir kayıtla ÇELİŞİYOR (daha önce tersine karar verilmiş).
2) Yeni not, unutulmuş bir sözü, açık işi, randevuyu ya da bir şeyin yerini doğrudan ilgilendiriyor ve dayanak bunu açıkça söylüyor.
Susacağın durumlar: konu dayanakla yalnız aynı sözcükleri paylaşıyor; kullanıcı işi zaten hatırlıyor ya da yapıyor; geçmişi anlatıyor; emin değilsin; konu sağlık, para, ilişki gibi başkasının yanında açılmayacak bir şey.
Araya girersen: text bir ya da iki kısa cümle, doğal Türkçe, "${address}" diye hitap et; dayanakta yazmayan hiçbir şey söyleme; kimin söylediğinden emin değilsen "demiştiniz" de; zamanı doğal söyle ("iki gün önce"). kind: reminder (hatırlatma), info (bilgi) ya da joke (yalnız dayanağa bağlı, kırıcı olmayan hafif bir espri).
source: dayandığın kaydın numarası. confidence: 0 ile 1 arası; gerçekten gerekli olduğundan ne kadar eminsin.
Susuyorsan: speak false, text boş, confidence 0, source 0.`;
}

/** Şemasız yoldan (konuşan beyin) yanıt istenirken eklenen biçim kuralı. */
export const DECISION_FORMAT = 'Yanıtın YALNIZ tek satır JSON olsun, başka hiçbir şey yazma: {"speak":false,"kind":"info","text":"","confidence":0,"source":0}';

/** Konuşan beynin metin yanıtından kararı çıkarır (çevreleyen söz ya da kod çiti olabilir). Okunamazsa `null`. */
export function parseDecision(text: string): Decision | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = DecisionSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const relativeDay = (iso: string, now: Date): string => {
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(new Date(iso).toDateString()).getTime()) / 86_400_000);
  return days <= 0 ? 'bugün' : days === 1 ? 'dün' : `${days} gün önce`;
};
const clock = (iso: string) => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

export interface TraceDeps {
  repo: AmbientRepo;
  memory: Pick<MemoryApi, 'search'>;
  log: Logger;
  now(): Date;
}

/**
 * Modelsiz ön eleme: yeni önemli notların konusu kayıtlarda iz bırakıyor mu. Aynı konuşmanın kendi notları ve onların
 * hafızadaki kopyaları iz sayılmaz (yoksa asistan az önce söyleneni "hatırlatır"). Son bir hafta içinde araya
 * girmeye dayanak olmuş kayıt da gösterilmez (`used`): aynı kayda ikinci kez dayanılmaz, beyne boşuna sorulmaz.
 */
export function collectTraces(deps: TraceDeps, fresh: AmbientNote[], used: ReadonlySet<string> = new Set()): Trace[] {
  const now = deps.now();
  const focus = fresh
    .slice(-3)
    .map((note) => note.text)
    .join(' ');
  if (stemSet(focus).size === 0) return [];
  const freshNotes = new Set(fresh.map((note) => note.id));
  const freshSources = new Set(fresh.flatMap((note) => note.sourceIds));
  // Aynı konuşmanın notlarının hafıza kopyaları; gösterilen notların hafıza kopyası da ikinci kez gelmez.
  const ownMemory = new Set(deps.repo.noteMemoryIds(fresh.map((note) => note.id)));
  const traces: Trace[] = [];
  const shownNotes: string[] = [];
  for (const note of deps.repo.searchNotes(focus, 6)) {
    if (freshNotes.has(note.id) || note.sourceIds.some((id) => freshSources.has(id))) continue;
    if (now.getTime() - Date.parse(note.sourceTo) < SAME_CONVERSATION_MS) continue;
    if (used.has(`N-${note.id}`)) continue;
    shownNotes.push(note.id);
    traces.push({ ref: `N-${note.id}`, label: `not · ${relativeDay(note.at, now)} ${clock(note.at)}${note.unsure ? ' · emin değil' : ''}`, text: note.text });
  }
  for (const id of deps.repo.noteMemoryIds(shownNotes)) ownMemory.add(id);
  for (const issue of deps.repo.listIssues('open', 40)) {
    if (issue.sourceIds.some((id) => freshSources.has(id))) continue;
    if (topicSimilarity(focus, `${issue.title} ${issue.person ?? ''}`) < 0.4) continue;
    if (used.has(`M-${issue.id}`)) continue;
    traces.push({ ref: `M-${issue.id}`, label: `açık iş · ${relativeDay(issue.sourceFrom, now)}${issue.dueDay ? ` · hedef ${issue.dueDay}` : ''}`, text: issue.title });
  }
  for (const report of deps.repo.searchReports(focus, 1)) {
    if (report.kind === 'daily' && report.period === dayKey(now)) continue;
    if (used.has(`R-${report.id}`)) continue;
    traces.push({ ref: `R-${report.id}`, label: `rapor · ${report.period}`, text: `${report.title}. ${report.summary}`.slice(0, 240) });
  }
  try {
    for (const hit of deps.memory.search({ text: focus, limit: 3 })) {
      if (ownMemory.has(hit.item.id) || used.has(`H-${hit.item.id}`)) continue;
      // Ortamdan yeni yazılmış hafıza kaydı aynı konuşmanındır.
      if (hit.item.source === 'ambient' && now.getTime() - Date.parse(hit.item.at) < SAME_CONVERSATION_MS) continue;
      traces.push({ ref: `H-${hit.item.id}`, label: `hafıza · ${relativeDay(hit.item.at, now)}`, text: hit.item.text.slice(0, 220) });
    }
  } catch (error) {
    deps.log.debug('eşlikçi hafızada arayamadı', error);
  }
  return traces.slice(0, MAX_TRACES);
}

export interface DecisionInput {
  now: Date;
  /** Yerel modelin az önce önemli işaretlediği notlar, eskiden yeniye (en çok üç). */
  notes: Pick<AmbientNote, 'at' | 'text' | 'unsure'>[];
  /** Son bağlam: aynı saatin öteki kısa notları (yine yerel modelin notları; ham döküm DEĞİL). */
  context: Pick<AmbientNote, 'at' | 'text'>[];
  traces: Trace[];
  /** Asistanın son araya girişi; tekrar etmesin diye gösterilir. */
  last: Pick<AmbientInterjection, 'at' | 'text'> | null;
}

const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** Beyne giden girdi: YALNIZ kısa notlar, dayanaklar ve son araya giriş. Ham döküm satırı buraya hiç girmez. */
export function buildDecisionInput(input: DecisionInput): string {
  return [
    `Şu an: ${WEEKDAYS[input.now.getDay()]} ${clock(input.now.toISOString())}`,
    `Yeni notlar (en yenisi sonda):\n${input.notes.slice(-3).map((note) => `- [${clock(note.at)}${note.unsure ? ' · emin değil' : ''}] ${note.text}`).join('\n')}`,
    input.context.length ? `Son bir saatin öteki notları:\n${input.context.slice(-5).map((note) => `- [${clock(note.at)}] ${note.text}`).join('\n')}` : '',
    `Dayanaklar:\n${input.traces.map((trace, index) => `${index + 1}. [${trace.label}] ${trace.text}`).join('\n')}`,
    input.last ? `Senin son araya girişin (${relativeDay(input.last.at, input.now)}): ${input.last.text}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export type RejectReason = 'silent' | 'empty' | 'low_confidence' | 'no_source' | 'ungrounded' | 'repeat' | 'same_source';

export interface Accepted {
  ok: true;
  text: string;
  kind: InterjectionKind;
  source: Trace;
  confidence: number;
}
export type Verdict = Accepted | { ok: false; reason: RejectReason };

/**
 * Model kararının kod denetimi. Model "konuş" dese de: güven eşiğin altındaysa, gösterdiği kaynak verilenlerden biri
 * değilse, söylediği kaynağıyla ortak tek sözcük taşımıyorsa, aynı şeyi yakın zamanda söylediyse ya da aynı kayda
 * dayanarak son bir hafta içinde araya girdiyse SUSULUR.
 */
export function acceptDecision(
  decision: Decision | null,
  traces: Trace[],
  history: readonly ProactiveTrace[],
  recent: Pick<AmbientInterjection, 'at' | 'sources'>[],
  now: Date,
): Verdict {
  if (!decision || !decision.speak) return { ok: false, reason: 'silent' };
  const text = decision.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (text.length < 6) return { ok: false, reason: 'empty' };
  const confidence = Number.isFinite(decision.confidence) ? decision.confidence : 0;
  if (confidence < CONFIDENCE_THRESHOLD[decision.kind]) return { ok: false, reason: 'low_confidence' };
  const source = Number.isInteger(decision.source) ? traces[decision.source - 1] : undefined;
  if (!source) return { ok: false, reason: 'no_source' };
  const sourceStems = stemSet(source.text);
  let common = 0;
  for (const stem of stemSet(text)) if (sourceStems.has(stem)) common++;
  if (common === 0) return { ok: false, reason: 'ungrounded' };
  if (isRepeat(text, history)) return { ok: false, reason: 'repeat' };
  const cutoff = now.getTime() - SAME_SOURCE_SILENCE_MS;
  if (recent.some((entry) => Date.parse(entry.at) >= cutoff && entry.sources.includes(source.ref))) return { ok: false, reason: 'same_source' };
  return { ok: true, text, kind: decision.kind, source, confidence };
}

export interface DecideDeps {
  brain: Pick<BrainApi, 'extract' | 'respond'>;
  assistant: string;
  address: string;
  /** `policy.ambient.interjections` (`off` buraya hiç gelmez: kapı keser). */
  mode: 'cloud-only' | 'on';
  /** Asistanın o anki beyni (`brain.status().provider`). */
  provider: 'cloud' | 'local' | 'none';
  log?: Logger;
}

/**
 * Model kararı. Model yanıt veremezse `null` (susulur).
 *  - Bulut beyni varsa konuşan beyin yolundan sorulur (`respond`, `voice` rolü: Claude Code → Anthropic;
 *    kişiliksiz, araçsız, `cloudOnly`). `extract` Claude Code'a hiç gitmediği için bu yol şarttır: ana beyni Claude
 *    Code olan kurulumda da araya girme çalışsın.
 *  - Kip `on` ise ve bulut yoksa (ya da bu turda yanıt veremediyse) karar yerel modelde verilir (`localOnly`).
 *  - Kip `cloud-only` iken yerel model karar VERMEZ (ölçüm: dosya sonundaki not).
 */
export async function decide(deps: DecideDeps, input: DecisionInput): Promise<Decision | null> {
  const instructions = companionInstructions(deps.assistant, deps.address);
  const text = buildDecisionInput(input);
  if (deps.provider === 'cloud') {
    const response = await deps.brain.respond({
      role: 'voice',
      origin: { channel: 'voice', speakerVerified: null },
      persona: false,
      tools: 'none',
      cloudOnly: true,
      maxSteps: 1,
      instructions: `${instructions}\n${DECISION_FORMAT}`,
      text,
    });
    if (response.stopReason === 'end' || response.text.trim()) {
      const decision = parseDecision(response.text);
      if (decision) return decision;
      deps.log?.debug('eşlikçi: beynin yanıtı okunamadı, susuldu');
      return null;
    }
    if (deps.mode !== 'on') return null;
  } else if (deps.mode !== 'on') {
    return null;
  }
  return deps.brain.extract({ role: 'memory', localOnly: true, instructions, input: text, schema: DecisionSchema });
}

/** Satır dur-sözü mü ("sus", "yeter"): ses oturumu olayı gelmese de eşlikçi o gün yarı sıklığa iner. */
export function isHushWord(text: string): boolean {
  // Karşılaştırma katlanmış metindedir (ı → i, ş → s).
  return /^(sus|sus artik|yeter|yeter artik|tamam sus|kes sesini|biraz sus|sessiz ol)[.!]?$/.test(foldForSearch(text.trim()).replace(/\s+/g, ' '));
}

/*
 * MEASUREMENT: yerel modelde eşlikçi kararı (16 Kasım 2026).
 * `node scripts/e2e/ambient.mjs --measure --repeat 3`; Qwen3.5-4B Q4_K_M, sıcaklık 0,2; 30 sentetik durum × 3 yineleme
 * (10 durumda araya girmek doğru, 20 durumda susmak doğru). Ölçülen, bu dosyadaki `decide` + `acceptDecision`.
 *
 *   yanlış araya girme (susması gerekirken girdi):  25/60  (%41,7)      kabul eşiği: en çok %5
 *   kaçırılan (girmesi gerekirken sustu):            6/30  (%20)
 *   türe göre doğru: çelişki 10/12 · unutulan söz 5/9 · yer bilgisi 9/9 · yalnız aynı sözcük 7/18 · kullanıcı zaten
 *   biliyor 15/18 · geçmişi anlatıyor 3/9 · özel konu 3/6 · ilgisiz dayanak 7/9.   Karar süresi ortanca ~0,6 sn.
 *
 * Okuma: model dayanağı BULUNCA söylemeye meyilli; "yalnız aynı sözcük geçiyor" ile "çelişiyor" ayrımını yapamıyor
 * ("perşembe pazarı kalabalık" → "perşembe 15:00'te toplantınız var"). Güveni ayarsız: yanlışların ortancası 0,95,
 * doğruların 0,95; eşiği 0,95'e çekmek yanlışı 23/60'a indiriyor, yani eşik kurtarmıyor. Kod denetimi (`acceptDecision`)
 * bu kümede hiçbir yanlışı tutmadı: yanlışların hepsi gerçek bir dayanağa ve yüksek güvene sahipti; kod yalnız uydurma
 * kaynağı, dayanaksız sözü ve tekrarı keser.
 *
 * Karar: `policy.ambient.interjections` varsayılanı `cloud-only`. Yerel modelde not, mesele ve rapor çalışır; araya
 * girme bulut beynini bekler. Bulut beyni ÖLÇÜLMEDİ (hesapta kredi yok; ölçüm betiği şimdilik yalnız yerel modeli
 * sürer): kredi gelince aynı küme bulut modeliyle ölçülmeli ve oran %5'in altında değilse varsayılan `off` yapılmalıdır.
 *
 * 17 Kasım 2026 (demo.7): bu ölçüm satırlı (ham döküm) girdiyle yapıldı. Artık beyin ham dökümü değil, yerel modelin
 * önemli işaretlediği kısa notları görür ve eşlikçi yalnız önemli notta uyanır; ölçüm betiği yeni girdiyle yeniden
 * koşulmadı.
 */
