/**
 * Fare ve klavye sınaması: GERÇEK girdinin kullanıcının başlattığı kanıtı (v1'deki "Dene" düğmesinin karşılığı).
 *
 * Yalnız kullanıcı başlatınca koşar (Ayarlar › Gizlilik › Bilgisayar kullanımı düğmesi ya da `pc_selftest` aracı).
 * Not Defteri'ni KENDİ geçici dosyasıyla açar; dokunduğu tek yer o dosyanın sekmesidir. Bütün girdi, asıl araçların
 * kullandığı motordan (`control.ts`) geçer: sınama geçerse araçların yolu da kanıtlanmış olur.
 *
 * Zararsızlık kuralları:
 *  1. Pencere, başlığındaki rastgele dosya adıyla tanınır; her adımdan önce "önde bizim pencere mi, başlığı hâlâ bizim
 *     dosyamız mı" diye bakılır. Değilse (kullanıcı başka sekmeye/pencereye geçti, bir kutu çıktı) girdi adımları DURUR.
 *  2. Kullanıcı fareye/klavyeye dokunursa motor zaten durur; sınama kalan adımları atlar.
 *  3. Kapanışta belge boşaltılır (kaydedilmiş hali de boştur: kaydetme sorusu çıkmaz); yalnız kendi sekmemiz kapatılır.
 *     Kullanıcının açık Not Defteri sekmelerine ve penceresinin yerine dokunulmaz (taşındıysa eski yerine konur).
 *  4. Hiçbir şey kaydedilmez; geçici dosya silinir.
 */
import { defineTool, foldForSearch, searchTerms, t, type ToolDef } from '@fuber/shared';
import { z } from 'zod';
import type { ControlCall, Failure, PcControl } from './control';
import { describeItems } from './observe';
import type { InputDriver, Rect, SelftestReport, SelftestStatus, SelftestStep, SelftestStepId, UiaProvider, WindowInfo } from './types';

export type { SelftestReport, SelftestStatus, SelftestStep, SelftestStepId } from './types';

/** Sınamanın sırası (arayüz adımları bu sırayla ve bu adlarla gösterir). */
export const SELFTEST_STEPS: readonly SelftestStepId[] = ['prepare', 'open', 'focus', 'survey', 'wait', 'click', 'type', 'select', 'paste', 'uia', 'move', 'close', 'cleanup'];

export interface SelftestDeps {
  control: PcControl;
  uia: UiaProvider;
  input: InputDriver;
  sleep(ms: number): Promise<void>;
  signal: AbortSignal;
  /** Boş bir geçici metin dosyası oluşturur ve tam yolunu döndürür; adı `name` olmalıdır. */
  createFile(name: string): Promise<string>;
  removeFile(file: string): Promise<void>;
  /** Not Defteri'ni bu dosyayla başlatır. */
  launchNotepad(file: string): Promise<{ ok: boolean; error: string | null }>;
  /** Adım bitince (arayüzde adım adım göstermek için). */
  onStep?(step: SelftestStep, index: number): void;
  /** Pencerenin görünmesi için en çok bekleme (varsayılan 10 sn). */
  openTimeoutMs?: number;
  /** Rastgele ad üretici (sınamada sabitlenir). */
  token?(): string;
  /** Metin üretici (dil sınaması için değiştirilebilir). */
  texts?: { typed: string; pasted: string };
}

/** Türkçe'ye özgü bütün harfler, büyük-küçük I/İ ayrımı ve rakamlar. */
export const SELFTEST_TYPED = 'Fuber AI sınaması: çğıöşü ÇĞİÖŞÜ, ılık IŞIK, 123.';
export const SELFTEST_PASTED = 'Yapıştırma sınaması: şemsiye, ağaç, gözlük, çiğ köfte.';

/** Menü çubuğunda aranacak adlar (Türkçe ve İngilizce Not Defteri; eski ve yeni sürümler). */
const MENU_NAMES = ['Görünüm', 'Görüntüle', 'View', 'Düzen', 'Düzenle', 'Edit', 'Dosya', 'File'];
/** Kaydetme sorusunda "kaydetmeden kapat" düğmesi. */
const DONT_SAVE_NAMES = ['Kaydetme', "Don't save", 'Don’t Save', 'Nicht speichern', 'Ne pas enregistrer'];

const REASONS: Record<string, string> = {
  aborted: 'durduruldu',
  panic: 'Durdur’a basıldı',
  user_interrupt: 'fareye ya da klavyeye dokunuldu; kontrol sizde',
  user_busy: 'fare ya da klavye kullanılıyordu; araya girilmedi',
  locked: 'Windows oturumu kilitli',
  uia_down: 'pencere okuyucusu yanıt vermedi',
  no_window: 'sınama penceresi bulunamadı',
  focus_failed: 'pencere öne getirilemedi (Windows izin vermedi)',
  focus_lost: 'odak sınama penceresinden çıktı',
  password: 'alan parola alanı göründü',
  card: 'alan kart alanı göründü',
  unknown_field: 'alanın türü doğrulanamadı',
  no_effect: 'tuşlar gönderildi ama alan değişmedi (girdi pencereye ulaşmıyor)',
  denied: 'onay verilmedi',
  not_found: 'öğe bulunamadı',
  ambiguous: 'aynı türden birden çok öğe var',
  timeout: 'öğe beklenen sürede görünmedi',
  offscreen: 'öğe ekranda görünmüyor',
  covered: 'tıklanacak noktanın üstünde başka bir pencere var',
  outside_window: 'nokta pencerenin dışında',
  no_screen: 'ekran bilgisi okunamadı',
  not_placed: 'pencere yerinden oynamadı',
  no_clipboard: 'pano kullanılamıyor',
  clipboard_busy: 'panoda görüntü ya da dosya var; bozulmadı',
  sensitive: 'pencere hassas sayıldı',
  own_window: 'pencere Fuber AI’nin kendi penceresi sayıldı',
};

const reasonText = (failure: Failure): string => `${REASONS[failure.reason] ?? failure.reason}${failure.detail ? ` (${failure.detail})` : ''}`;
const stopKind = (failure: Failure): SelftestReport['stopped'] =>
  failure.reason === 'panic' ? 'panic' : failure.reason === 'user_interrupt' || failure.reason === 'user_busy' ? 'user' : failure.reason === 'aborted' ? 'aborted' : null;
const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

export async function runSelftest(deps: SelftestDeps): Promise<SelftestReport> {
  const { control, uia, input, sleep } = deps;
  const started = Date.now();
  const steps: SelftestStep[] = [];
  const texts = deps.texts ?? { typed: SELFTEST_TYPED, pasted: SELFTEST_PASTED };
  let stopped: SelftestReport['stopped'] = null;
  let hwnd: number | null = null;
  let file: string | null = null;
  /** Pencere bizim açtığımız yeni bir pencere mi (değilse dosyamız kullanıcının açık Not Defteri'nde sekme oldu). */
  let ownWindow = true;
  let originalRect: Rect | null = null;
  const token = (deps.token ?? (() => Math.random().toString(16).slice(2, 8).padEnd(6, '0')))();
  const marker = `Fuber-sinama-${token}`;
  const foldedMarker = foldForSearch(marker);

  const push = (id: SelftestStepId, status: SelftestStatus, detail: string, since: number) => {
    const step: SelftestStep = { id, status, detail, ms: Math.max(0, Date.now() - since) };
    steps.push(step);
    deps.onStep?.(step, steps.length - 1);
    return step;
  };

  /** Onay isteyen adımlar (silme tuşu, sekme kapatma) yalnız KENDİ sınama penceremizde kendiliğinden onaylanır. */
  const call: ControlCall = {
    signal: deps.signal,
    approve: async (request) => request.window !== null && request.window.hwnd === hwnd,
  };

  const findOurs = async (): Promise<WindowInfo | null> => {
    const list = await uia.windows();
    return list.windows.find((window) => !window.own && foldForSearch(window.title).includes(foldedMarker)) ?? null;
  };

  /**
   * Girdi adımından önce: önde bizim pencere mi ve başlığı hâlâ bizim dosyamız mı. Değilse neden döner ve sınama
   * girdi üretmeyi bırakır (`foreign`).
   */
  const guard = async (): Promise<string | null> => {
    if (deps.signal.aborted) {
      stopped ??= 'aborted';
      return REASONS.aborted!;
    }
    const halted = control.haltedBy();
    if (halted) {
      stopped ??= halted;
      return halted === 'panic' ? REASONS.panic! : REASONS.user_interrupt!;
    }
    if (stopped) return 'sınama durdu';
    if (hwnd === null) return REASONS.no_window!;
    let list;
    try {
      list = await uia.windows();
    } catch {
      stopped = 'foreign';
      return REASONS.uia_down!;
    }
    if (list.locked) {
      stopped = 'foreign';
      return REASONS.locked!;
    }
    const ours = list.windows.find((window) => window.hwnd === hwnd);
    if (!ours || !foldForSearch(ours.title).includes(foldedMarker)) {
      stopped = 'foreign';
      return 'sınama sekmesi artık önde değil (başka sekmeye geçilmiş ya da pencere kapanmış)';
    }
    if (input.foregroundWindow() !== hwnd) {
      stopped = 'foreign';
      return 'önde beklenmedik bir pencere var; yanlış yere girdi göndermemek için durdum';
    }
    return null;
  };

  /** Motorun hata sonucunu adıma çevirir; kesilme ise sınamayı durdurur. */
  const failStep = (id: SelftestStepId, failure: Failure, since: number) => {
    stopped ??= stopKind(failure);
    return push(id, 'fail', reasonText(failure), since);
  };

  const documentText = async (): Promise<string | null> => {
    if (hwnd === null) return null;
    try {
      const focused = await uia.focused();
      if (focused.hwnd === hwnd && !focused.password && focused.value !== null) return focused.value;
    } catch {
      // aşağıda belge yolu denenir
    }
    try {
      const document = await uia.document(hwnd, { maxChars: 2000 });
      if (document.found && document.method === 'text') return document.text;
    } catch {
      // okunamadı
    }
    return null;
  };

  const target = () => String(hwnd);

  // ── 1. hazırlık ──
  let at = Date.now();
  try {
    if (deps.signal.aborted) throw new Error(REASONS.aborted);
    const halted = control.haltedBy();
    if (halted) throw new Error('bilgisayar kullanımı az önce durduruldu; birkaç saniye sonra yeniden deneyin');
    const list = await uia.windows();
    if (list.locked) throw new Error(REASONS.locked);
    file = await deps.createFile(`${marker}.txt`);
    push('prepare', 'ok', `pencere okuyucusu çalışıyor (${list.windows.length} pencere); geçici dosya hazır`, at);
  } catch (error) {
    push('prepare', 'fail', error instanceof Error ? error.message : String(error), at);
  }

  // ── 2. Not Defteri'ni aç ──
  if (file && steps[0]?.status === 'ok') {
    at = Date.now();
    try {
      const before = new Set((await uia.windows()).windows.map((window) => window.hwnd));
      const launched = await deps.launchNotepad(file);
      // Windows 11'de `notepad.exe` yalnız bir başlatıcıdır ve hemen çıkabilir: başlatma "başarısız" görünse de pencere
      // beklenir (daha kısa); pencere gelirse sorun yoktur.
      const deadline = launched.ok ? (deps.openTimeoutMs ?? 10_000) : Math.min(4000, deps.openTimeoutMs ?? 4000);
      let found: WindowInfo | null = null;
      for (let waited = 0; waited < deadline && !found; waited += 250) {
        if (deps.signal.aborted || control.haltedBy()) break;
        await sleep(250);
        found = await findOurs();
      }
      if (!found && !launched.ok) throw new Error(`Not Defteri başlatılamadı: ${launched.error ?? 'bilinmeyen hata'}`);
      if (!found) throw new Error('Not Defteri penceresi görünmedi (başlığında sınama dosyasının adı aranıyor)');
      hwnd = found.hwnd;
      ownWindow = !before.has(found.hwnd);
      originalRect = ownWindow ? null : (input.windowState(found.hwnd).rect ?? null);
      // Pencerenin çizilmesi ve sekmenin yerleşmesi için kısa bir nefes.
      await sleep(600);
      push('open', 'ok', ownWindow ? `açıldı: ${found.app}` : `açıldı: ${found.app} (açık pencerenizde yeni sekme olarak)`, at);
    } catch (error) {
      push('open', 'fail', error instanceof Error ? error.message : String(error), at);
    }
  } else {
    push('open', 'skipped', 'hazırlık başarısız', Date.now());
  }

  const opened = hwnd !== null;

  // ── 3. odak ──
  if (opened) {
    at = Date.now();
    const result = await control.focus({ window: target() }, call);
    if (!result.ok) failStep('focus', result, at);
    else if (input.foregroundWindow() !== hwnd) push('focus', 'fail', REASONS.focus_failed!, at);
    else push('focus', 'ok', 'sınama penceresi önde', at);
  } else {
    push('focus', 'skipped', 'pencere açılmadı', Date.now());
  }
  const focused = steps.at(-1)?.status === 'ok';

  // ── 4. pencerede görünenler (girdi yok): her aracın sonucuna eklenen ekran özeti bu okumadır ──
  let fieldRole: string | null = null;
  if (opened && focused) {
    at = Date.now();
    try {
      const survey = await uia.survey(hwnd!, { budgetMs: 400 });
      const took = Date.now() - at;
      const listed = describeItems(survey.items, survey.more);
      if (survey.items.length > 0) push('survey', 'ok', `${survey.items.length} öğe ${took} ms'de listelendi: ${listed.length > 160 ? `${listed.slice(0, 159)}…` : listed}`, at);
      else push('survey', 'warn', `pencere okundu (${took} ms) ama üzerinde işlem yapılabilecek adlı öğe görünmedi`, at);
    } catch (error) {
      push('survey', 'warn', `pencerenin öğeleri listelenemedi: ${error instanceof Error ? error.message : String(error)}`, at);
    }
    // ── 5. öğe bekleme (girdi yok): yazı alanı türüyle aranır; toplu eylemin "görünene dek bekle" adımı budur ──
    at = Date.now();
    let lastWait: Failure | null = null;
    for (const role of ['Document', 'Edit']) {
      const waited = await control.waitFor({ role, window: target(), timeoutMs: 1500 }, call);
      if (waited.ok) {
        fieldRole = role;
        push('wait', 'ok', `yazı alanı bulundu (${role === 'Document' ? 'belge' : 'alan'}, ${waited.waitedMs} ms)`, at);
        break;
      }
      lastWait = waited;
      if (stopKind(waited)) break;
    }
    if (!fieldRole) {
      if (lastWait && stopKind(lastWait)) failStep('wait', lastWait, at);
      else push('wait', 'warn', 'yazı alanı türüyle bulunamadı; tıklama pencerenin ortasına yapılacak', at);
    }
  } else {
    const why = opened ? 'pencere öne getirilemedi' : 'pencere açılmadı';
    push('survey', 'skipped', why, Date.now());
    push('wait', 'skipped', why, Date.now());
  }

  /** Girdi adımı: önce bekçi, sonra iş. Bekçi durdurursa adım atlanır. */
  const inputStep = async (id: SelftestStepId, work: (since: number) => Promise<void>): Promise<void> => {
    const since = Date.now();
    if (!opened || !focused) {
      push(id, 'skipped', opened ? 'pencere öne getirilemedi' : 'pencere açılmadı', since);
      return;
    }
    const blocked = await guard();
    if (blocked) {
      push(id, 'skipped', blocked, since);
      return;
    }
    try {
      await work(since);
    } catch (error) {
      push(id, 'fail', error instanceof Error ? error.message : String(error), since);
    }
  };

  // ── 6. fare: metin alanına gerçek tıklama (önce türüyle bulunan alana; olmazsa pencerenin ortasına) ──
  await inputStep('click', async (since) => {
    if (fieldRole) {
      const byRole = await control.click({ role: fieldRole, window: target() }, call);
      if (byRole.ok) {
        const how = byRole.method === 'uia' ? 'erişilebilirlik deseniyle' : 'fareyle';
        push('click', 'ok', `yazı alanı erişilebilirlik ağacından bulundu ve ${how} tıklandı`, since);
        return;
      }
      if (stopKind(byRole)) {
        failStep('click', byRole, since);
        return;
      }
      // Belirsiz ya da ekranda değil: koordinatla tıklamaya düşülür.
    }
    const rect = input.windowState(hwnd!).rect;
    if (!rect) throw new Error(REASONS.no_window);
    // Metin alanının ortasına yakın bir nokta (başlık, sekme şeridi ve menünün altında; durum çubuğunun üstünde).
    const point = { x: Math.round((rect.left + rect.right) / 2), y: Math.round(rect.top + (rect.bottom - rect.top) * 0.6) };
    const result = await control.click({ point, window: target() }, call);
    if (!result.ok) {
      failStep('click', result, since);
      return;
    }
    const here = input.cursor();
    const near = Math.abs(here.x - point.x) <= 4 && Math.abs(here.y - point.y) <= 4;
    push('click', near ? 'ok' : 'warn', near ? `imleç (${point.x}, ${point.y}) noktasına gitti ve tıkladı` : `tıklama gönderildi ama imleç beklenen yerde değil (${here.x}, ${here.y})`, since);
  });

  // ── 7. klavye: Türkçe cümle (süre de ölçülür: gerçek gönderim hızının tek gerçek ölçümü budur) ──
  await inputStep('type', async (since) => {
    const typeStarted = Date.now();
    const result = await control.type({ text: texts.typed, window: target(), method: 'keys' }, call);
    if (!result.ok) {
      failStep('type', result, since);
      return;
    }
    const typeMs = Math.max(1, Date.now() - typeStarted);
    const speed = ` (${typeMs} ms; doğrulama dahil ≈ ${Math.round((result.typed / typeMs) * 1000)} karakter/sn)`;
    let verified = result.verified;
    if (verified === null) {
      const text = await documentText();
      if (text !== null) verified = squash(text).includes(squash(texts.typed));
    }
    if (verified === true) push('type', 'ok', `${result.typed} karakter yazıldı; Türkçe harfler alanda birebir göründü${speed}`, since);
    else if (verified === false) push('type', 'fail', 'yazıldı ama alandaki metin birebir aynı değil (Türkçe harfler bozulmuş olabilir)', since);
    else push('type', 'warn', `${result.typed} karakter gönderildi; alan okunamadığı için doğrulanamadı${speed}`, since);
  });

  // ── 6. seçme: hepsini seç ──
  let selected = false;
  await inputStep('select', async (since) => {
    const result = await control.keys({ keys: 'ctrl+a', window: target() }, call);
    if (!result.ok) {
      failStep('select', result, since);
      return;
    }
    selected = true;
    push('select', 'ok', 'ctrl+a gönderildi (seçimin tuttuğu bir sonraki adımda doğrulanır)', since);
  });

  // ── 7. yapıştırma: seçimin üzerine panodan yaz ──
  await inputStep('paste', async (since) => {
    if (!selected) {
      push('paste', 'skipped', 'seçme adımı tamamlanmadı', since);
      return;
    }
    const result = await control.type({ text: texts.pasted, window: target(), method: 'paste' }, call);
    if (!result.ok) {
      if (result.reason === 'no_clipboard' || result.reason === 'clipboard_busy') push('paste', 'skipped', reasonText(result), since);
      else failStep('paste', result, since);
      return;
    }
    const text = await documentText();
    if (text === null) {
      push('paste', 'warn', 'yapıştırma gönderildi; alan okunamadığı için doğrulanamadı', since);
      return;
    }
    const now = squash(text);
    const hasNew = now.includes(squash(texts.pasted));
    const hasOld = now.includes(squash(texts.typed));
    if (hasNew && !hasOld) push('paste', 'ok', 'seçili metnin yerine panodan yapıştırıldı (seçme de doğrulandı); pano eski haline getirildi', since);
    else if (hasNew) push('paste', 'warn', 'yapıştırıldı ama eski metin de duruyor: ctrl+a seçimi tutmamış', since);
    else push('paste', 'fail', 'yapıştırılan metin alanda görünmüyor', since);
  });

  // ── 8. UI Automation: menü düğmesine adıyla tıkla (fare kullanmadan) ──
  await inputStep('uia', async (since) => {
    let lastFailure: Failure | null = null;
    for (const name of MENU_NAMES) {
      const result = await control.click({ name, role: 'MenuItem', window: target() }, call);
      if (!result.ok) {
        lastFailure = result;
        if (stopKind(result)) break;
        continue;
      }
      await sleep(450);
      // Açılan menü aynı yoldan kapatılır (erişilebilirlik deseni aç/kapa değiştirir); fare ve klavye gerekmez.
      const again = await control.click({ name, role: 'MenuItem', window: target() }, call);
      await sleep(250);
      if (input.foregroundWindow() !== hwnd) await control.focus({ window: target() }, call);
      // Menü açık kaldıysa kapansın (Not Defteri'nin metin alanında Esc zararsızdır); gönderilemezse sorun değil.
      await control.keys({ keys: 'esc', window: target() }, call);
      await sleep(150);
      const how = result.method === 'uia' ? 'erişilebilirlik deseniyle (fare oynamadan)' : 'fareyle';
      push('uia', again.ok ? 'ok' : 'warn', `“${result.label}” menüsü adıyla bulundu ve ${how} açıldı${again.ok ? ', sonra kapatıldı' : '; kapatma doğrulanamadı'}`, since);
      return;
    }
    if (lastFailure && stopKind(lastFailure)) failStep('uia', lastFailure, since);
    else push('uia', 'warn', `menü çubuğunda bilinen bir ad bulunamadı (${MENU_NAMES.slice(0, 3).join(', ')}…); Not Defteri sürümü farklı olabilir`, since);
  });

  // ── 9. pencereyi taşı ve boyutlandır ──
  await inputStep('move', async (since) => {
    const result = await control.arrange({ window: target(), box: { x: 120, y: 90, width: 880, height: 560 } }, call);
    if (!result.ok) {
      failStep('move', result, since);
      return;
    }
    const size = `${result.rect.right - result.rect.left}×${result.rect.bottom - result.rect.top}`;
    push('move', result.verified ? 'ok' : 'warn', result.verified ? `pencere taşındı ve boyutlandı (${size})` : `istek gönderildi ama pencere tam oturmadı (${size})`, since);
  });

  // ── 10. kapat (kaydetmeden) ──
  at = Date.now();
  if (opened) {
    try {
      const notes: string[] = [];
      // Kullanıcının kendi penceresine sekme olduysak pencere eski yerine konur.
      if (!ownWindow && originalRect && steps.find((step) => step.id === 'move')?.status === 'ok') {
        try {
          input.setWindowRect(hwnd!, originalRect);
          notes.push('pencereniz eski yerine kondu');
        } catch {
          // yer geri konamadı: zararsız
        }
      }
      // Sekmeli Not Defteri mi (Windows 11): yalnız KENDİ sekmemiz kapatılır.
      let tabbed = false;
      try {
        const tabs = await uia.find(hwnd!, { terms: searchTerms(marker), role: 'TabItem', max: 2 });
        tabbed = tabs.matches.length > 0;
      } catch {
        tabbed = false;
      }
      const blocked = focused ? await guard() : 'pencere öne getirilemedi';
      let closeSent = false;
      if (!blocked) {
        // Belge boşaltılır: dosyanın kaydedilmiş hali de boştur, kaydetme sorusu çıkmasın.
        const cleared = await control.keys({ keys: 'ctrl+a delete', window: target() }, call);
        if (!cleared.ok) stopped ??= stopKind(cleared);
        await sleep(200);
        if (tabbed) {
          const stillOurs = await guard();
          if (!stillOurs) {
            const closed = await control.keys({ keys: 'ctrl+w', window: target() }, call);
            closeSent = closed.ok;
            if (!closed.ok) notes.push(`sekme kapatma tuşu gönderilemedi: ${reasonText(closed)}`);
          }
        }
      }
      if (!tabbed && ownWindow) {
        // Eski (sekmesiz) Not Defteri ve kendi penceremiz: kibar kapatma isteği; girdi gerekmez.
        input.closeWindow(hwnd!);
        closeSent = true;
      }
      const gone = async (): Promise<boolean> => {
        if (!input.windowState(hwnd!).exists) return true;
        const ours = await findOurs().catch(() => null);
        return !ours;
      };
      let closed = false;
      for (let attempt = 0; attempt < 12 && closeSent && !closed; attempt++) {
        await sleep(250);
        closed = await gone();
        if (closed || attempt !== 4) continue;
        // Kaydetme sorusu çıktıysa "Kaydetme" düğmesi erişilebilirlik deseniyle seçilir (fare/klavye yok).
        const candidates = new Set<number>([hwnd!]);
        const front = input.foregroundWindow();
        try {
          const list = await uia.windows();
          const ours = list.windows.find((window) => window.hwnd === hwnd);
          const dialog = front !== null && front !== hwnd ? (list.foreground?.hwnd === front ? list.foreground : list.windows.find((window) => window.hwnd === front)) : null;
          if (dialog && ours && dialog.pid === ours.pid) candidates.add(dialog.hwnd);
        } catch {
          // pencere listesi yok: yalnız kendi penceremizde aranır
        }
        search: for (const candidate of candidates) {
          for (const name of DONT_SAVE_NAMES) {
            try {
              const found = await uia.find(candidate, { terms: searchTerms(name), role: 'Button', max: 2 });
              const button = found.matches.find((item) => item.enabled && item.patterns.length > 0);
              if (!button) continue;
              const invoked = await uia.invoke(button.ref);
              if (invoked.ok) {
                notes.push('kaydetme sorusu “kaydetme” ile yanıtlandı');
                break search;
              }
            } catch {
              // sonraki ad denenir
            }
          }
        }
      }
      if (closed) push('close', 'ok', ['sınama sekmesi kaydedilmeden kapatıldı', ...notes].join('; '), at);
      else if (blocked) push('close', 'warn', [`sınama sekmesi AÇIK KALDI (${blocked}); kendiniz kapatabilirsiniz, kaydetmeniz gerekmez`, ...notes].join('; '), at);
      else push('close', 'warn', ['kapatma isteği gönderildi ama sınama sekmesi hâlâ açık; kendiniz kapatabilirsiniz, kaydetmeniz gerekmez', ...notes].join('; '), at);
    } catch (error) {
      push('close', 'warn', `kapatılamadı: ${error instanceof Error ? error.message : String(error)}; sınama sekmesini kendiniz kapatabilirsiniz`, at);
    }
  } else {
    push('close', 'skipped', 'pencere açılmadı', at);
  }

  // ── 11. temizlik ──
  at = Date.now();
  if (file) {
    try {
      await deps.removeFile(file);
      push('cleanup', 'ok', 'geçici dosya silindi; hiçbir şey kaydedilmedi', at);
    } catch (error) {
      push('cleanup', 'warn', `geçici dosya silinemedi (${error instanceof Error ? error.message : String(error)}): ${file}`, at);
    }
  } else {
    push('cleanup', 'skipped', 'silinecek dosya yok', at);
  }

  const ok = steps.every((step) => step.status === 'ok' || step.status === 'warn') && steps.some((step) => step.id === 'type' && step.status === 'ok');
  return { ok, stopped, steps, ms: Date.now() - started };
}

/** Adım süresi, okunur biçimde ("0,4"). */
export const stepSeconds = (ms: number): string => (ms / 1000).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** `pc_selftest` aracı: sınamayı sesle/yazıyla başlatır. `run` modülün tek sınama koşucusudur (IPC düğmesi de onu çağırır). */
export function selftestTool(run: (signal: AbortSignal) => Promise<SelftestReport>): ToolDef {
  return defineTool({
    name: 'pc_selftest',
    group: 'pc',
    description:
      'Fare ve klavye sınamasını başlatır: Not Defteri’ni kendi geçici dosyasıyla açar, öğelerini listeler, yazı alanını bulup tıklar, Türkçe bir cümle yazar, seçer, yapıştırır, bir menüye adıyla tıklar, ' +
      'pencereyi taşır ve kaydetmeden kapatır (~20 sn; GERÇEK fare ve klavye girdisi üretir). YALNIZ kullanıcı açıkça isterse kullan ' +
      '("fare ve klavyeyi sına", "bilgisayar kullanımını dene"); başka bir işin parçası olarak ya da kendiliğinden ÇAĞIRMA.',
    input: z.object({}),
    risk: 'write',
    async run(_input, ctx) {
      ctx.report(t('pc.status.selftest'));
      const report = await run(ctx.signal);
      if (report.unavailable) return { ok: false, text: report.unavailable };
      const lines = report.steps.map((step) => `${t(`pc.selftest.mark.${step.status}`)} ${t(`pc.selftest.step.${step.id}`)} (${t('pc.selftest.stepTime', { seconds: stepSeconds(step.ms) })}): ${step.detail}`);
      const head = t(report.ok ? 'pc.selftest.passed' : 'pc.selftest.failed', { seconds: Math.round(report.ms / 1000) });
      const stopped = report.stopped ? ` ${t(`pc.selftest.stopped.${report.stopped}`)}` : '';
      return {
        ok: report.ok,
        text: `${head}${stopped}\n${lines.join('\n')}`,
        data: { ok: report.ok, stopped: report.stopped, steps: report.steps.map((step) => ({ id: step.id, status: step.status })), total: SELFTEST_STEPS.length },
      };
    },
  });
}
