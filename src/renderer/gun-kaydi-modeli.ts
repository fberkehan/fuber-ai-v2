// ── Gün kaydı modelinin yaşam döngüsü (0.13 T10): Vosk modeli YALNIZ gün kaydı açıkken yüklü durur ─────────────────────────────────────────
// Dikte Vosk kullanmaz; model açılışta koşulsuz yüklenmez. Ayar açılınca yüklenir, kapanınca bırakılır, açılıp kapanıp yeniden açılabilir. Yüklenirken ayar
// değişirse son istek kazanır (kapatıldıysa yüklenen model tutulmaz). Kulak (renderer/kulak.ts) her ayar olayında `ayarla` çağırır: "model yüklü mü" diye bakmaz.
// Saf: Vosk'u bilmez (yükle/bırak dışarıdan gelir), testli (tests/dikte-sirasi.test.ts).
export interface ModelYoneticisi<M> {
  /** İstenen durum: true → model yüklü olsun, false → bırakılsın. Söz, istek uygulanınca (ya da yükleme düşünce) çözülür. */
  ayarla(acik: boolean): Promise<void>;
  /** Yüklü model; yoksa null. */
  al(): M | null;
}

/**
 * Kulağın ayar uygulayıcısı (`gunkaydi:kulak` olayının işleyicisi ve açılıştaki ilk uygulama AYNI işlevdir). Her olayda ayar kaydedilir, model istenen duruma
 * getirilir (gün kaydı açık → yüklenir ve tanıyıcı kurulur; kapalı → tanıyıcı kapanır, model bırakılır), "Hey Fuber" esitlenir. Modelin yüklü olmasına bakılmaz:
 * gün kaydı kapalıyken model yoktur, ayar çalışma anında açılınca da yüklenmelidir (inceleme turu 1).
 */
export function gunKaydiUygulayici<A extends { gunKaydi: boolean }, M>(d: {
  model: ModelYoneticisi<M>;
  ayarYaz(v: A): void;
  gunlukKur(): void;
  gunlukKapat(): void;
  uyandirmaEsitle(): void;
}): (v: A) => void {
  return (v) => {
    d.ayarYaz(v);
    if (v.gunKaydi) void d.model.ayarla(true).then(d.gunlukKur);
    else { d.gunlukKapat(); void d.model.ayarla(false); }
    d.uyandirmaEsitle();
  };
}

export function modelYoneticisi<M>(y: { yukle(): Promise<M>; birak(m: M): void; hata?(e: unknown): void }): ModelYoneticisi<M> {
  let model: M | null = null;
  let istek = false;
  let suren: Promise<void> | null = null;

  const birak = () => { if (model) { const m = model; model = null; try { y.birak(m); } catch { /* kapandı */ } } };

  return {
    al: () => model,
    ayarla(acik) {
      istek = acik;
      if (!acik) { birak(); return Promise.resolve(); }
      if (model) return Promise.resolve();
      suren ??= y.yukle().then(
        (m) => { if (istek) model = m; else { try { y.birak(m); } catch { /* kapandı */ } } },
        (e) => { y.hata?.(e); },
      ).finally(() => { suren = null; });
      return suren;
    },
  };
}
