/**
 * Referanslı yankı giderici ve "kullanıcı konuşuyor" sezicisi. Jarvis'in çaldığı ses elimizdedir (referans);
 * mikrofondaki yankısı uyarlamalı bir süzgeçle (NLMS) kestirilip çıkarılır ve geriye kalan enerji, kestirilen
 * yankıya göre belirgin biçimde fazlaysa kullanıcı konuşuyor demektir.
 *
 * Neden kendi gidericimiz: tarayıcının yankı engellemesi bir Bluetooth hoparlör + USB mikrofon düzeninde
 * Jarvis'in sesini bastırmıyor; söz kesme yalnız uyandırma sözüne iniyordu. İstek: "ben konuştuğumda susup
 * dinlesin". Tarayıcının işlemesi yerinde kalır; bu modül onun çıkışında, kendi referansımızla çalışır.
 *
 * Üç parça:
 * 1. Gecikme kestirimi: referans ile mikrofonun 10 ms'lik enerji zarfları arasındaki çapraz ilinti (0–1000 ms).
 *    Bluetooth çıkışın gecikmesi süzgeç boyuna sığmaz; süzgeç, kestirilen gecikmeye hizalanır. Aralık 450 ms'den
 *    1000 ms'ye çıkarıldı: ölçülen bir Bluetooth hoparlörde giderici 7,7 sn'lik sınamada hiç ilinti
 *    bulamadı (0 dB / 0 ms) ve söz kesme `wake`e indi; bazı Bluetooth hoparlörler 500 ms'nin üstünde gecikir.
 *    Bulunan en iyi ilinti ve yeri tanıya yazılır (`corr`, `corrLagMs`): bir sonraki sınama nedeni kesin gösterir.
 * 2. NLMS süzgeç (64 ms): hizalanmış referanstan yankıyı kestirir. Kullanıcı konuşurken uyarlama dondurulur.
 * 3. Düzey kapısı: kalan enerji > kapı × (yakınsamış süzgecin olağan kalıntısı) ise blok "yakın uç" (kullanıcı) sayılır.
 *    Olağan kalıntı oranı sürekli kestirilir (ses düzeyi ya da aygıt değişince kendini yeniler); sabit sayı yoktur.
 *
 * Saf modül: DOM ve Node içe aktarımı yok. Ses işleyicisi (AudioWorklet), birim testleri ve ölçüm betiği
 * (`scripts/voice/aec-eval.mjs`) aynı kodu çağırır.
 */

export interface EchoCancellerOptions {
  sampleRate?: number;
  /** Süzgeç boyu (örnek). 1024 = 16 kHz'te 64 ms. */
  taps?: number;
  /** Aranan en büyük hoparlör → mikrofon gecikmesi (ms). */
  maxDelayMs?: number;
  /** Düzey kapısı: kalan enerji, olağan kalıntının bu katını (güç oranı) aşarsa kullanıcı konuşuyor sayılır. */
  gate?: number;
  /** Yalnız yankı olan bloklarda çıkışa uygulanan kazanç (kalan yankı VAD'ı tetiklemesin). */
  suppress?: number;
}

/** Bir çerçevenin (20 ms) özeti; ses işçisine sesle birlikte gider. Düzeyler 0–1 RMS. */
export interface EchoFrameInfo {
  /** Hizalanmış referansın (Jarvis'in sesi) düzeyi; 0 = şu an yankı beklenmiyor. */
  ref: number;
  mic: number;
  /** Kestirilen yankının ve yankı çıkarıldıktan sonra kalanın düzeyi. */
  est: number;
  res: number;
  /** Kullanıcı konuşuyor mu: 1 evet, 0 hayır (yalnız yankı), 0,5 bilinmiyor (süzgeç henüz yakınsamadı). */
  near: number;
  /** Referans etkin mi (yankı bekleniyor mu); değilse `near` anlamsızdır. */
  active: boolean;
  converged: boolean;
  /** Süzgeç bu gecikmeyle en az bir kez yakınsadı: `active: false` artık "yankı yok" demektir (gecikme biliniyor). */
  trained: boolean;
  /** Referans en az 1,5 sn etkin kaldı (gecikme kestirimi için yeterli veri var). */
  warm: boolean;
  /** Referans ile mikrofon arasında ilinti bulundu: Jarvis'in sesi mikrofona ulaşıyor (süzgeç öğrenmese de). */
  coupled: boolean;
  delayMs: number;
  /** Yankı bastırma (dB): mikrofon gücü / kalan güç, yalnız yankı varken ölçülür. */
  erleDb: number;
  /** Son gecikme kestiriminde bulunan en iyi zarf ilintisi (0–1; eşik 0,7) ve yeri. Kestirim yapılmadıysa 0. */
  corr: number;
  corrLagMs: number;
  /**
   * `near` kaba kapıdan geldi: süzgeç yakınsamadı ama Jarvis'in sesinin mikrofona ulaştığı (ilinti) ve gecikmesi
   * biliniyor. Karar, zarflardan kestirilen bağlaşım ve gecikme çevresindeki en yüksek referansla verilir.
   */
  coarse: boolean;
}

const BLOCK = 160;
const ENV_BLOCKS = 320;
/** Aranan en büyük hoparlör → mikrofon gecikmesi (ms). */
export const ECHO_MAX_DELAY_MS = 1000;
const DELAY_EVERY_BLOCKS = 25;
const REF_FLOOR = 1e-7;
const MU = 0.5;
const PRE_EMPHASIS = 0.9;
/** Zarf ilintisi bunun üstündeyse mikrofonda Jarvis'in sesi var demektir (gerçek yankıda 0,9'un üstündedir). */
const COUPLE_CORR = 0.7;
/**
 * Kaba kapı (süzgeç yakınsamadan): beklenen yankı, ilintinin gösterdiği gecikmenin ±60 ms çevresindeki EN YÜKSEK
 * referans düzeyiyle hesaplanır (Bluetooth'ta gecikme kayar; tek bir noktaya hizalanmak kendi hecesini "kullanıcı"
 * sandırır) ve kullanıcının sesi bunun en az `COARSE_GATE_MIN` katı (güç; kapı ayarlıysa `2 × kapı`) olmalıdır.
 * Ölçülen bir Bluetooth hoparlörde süzgeç hiç yakınsamadı (0–3 dB) ama ilinti 0,93 @ 390 ms bulundu: bu
 * yol tam o cihaz içindir. Benzetim (doğrusal olmayan, ±12 ms kayan 390 ms yankı; `echo-canceller.test.ts`): ±120 ms
 * ve 8 kat ile yankıdan 2,8 kat yüksek konuşan kullanıcı bile görülmüyordu; ±60 ms ve 8 kat ile yalnız yankıda oran
 * ≤ 0,08, kullanıcıda (yankıyla eşit düzeyde bile) ≥ 0,31, ses kısılınca ≥ 0,38.
 */
const COARSE_WINDOW_BLOCKS = 6;
const COARSE_GATE_MIN = 8;

export class EchoCanceller {
  private readonly rate: number;
  private readonly taps: number;
  private readonly maxLag: number;
  private readonly ringSize: number;
  /** Referans halkası; kesintisiz okunabilsin diye iki kez yazılır (`i` ve `i + ringSize`). */
  private readonly ring: Float32Array;
  private writeAt = 0;
  /** Süzgeç katsayıları, zamanda artan sırayla (son katsayı en yeni örneğe karşılık gelir). */
  private readonly weights: Float32Array;
  private delay = 0;
  private windowPower = 0;
  private gate: number;
  private readonly suppress: number;

  // Blok (10 ms) birikimleri.
  private inBlock = 0;
  private accMic = 0;
  private accRes = 0;
  private accEst = 0;
  private accRef = 0;
  // Yumuşatılmış güçler (yalnız referans etkinken güncellenir).
  private micPower = 0;
  private resPower = 0;
  private estPower = 0;
  private noiseFloor = 1e-8;
  /** Yakınsamış süzgecin olağan kalıntısı: kalan güç / kestirilen yankı gücü (yalnız yankı varken). */
  private residualRatio = 0.25;
  private convergedBlocks = 0;
  private converged = false;
  private trained = false;
  private activeBlocks = 0;
  private nearRun = 0;
  private near = 0.5;
  private refHold = 0;
  private stepSize = 0;
  private outGain = 1;
  private targetGain = 1;
  private lastRef = 0;
  private lastMic = 0;
  private deEmphasis = 0;
  /**
   * Gölge süzgeç: kalan, olağanın üstüne çıkınca asıl süzgecin kopyasından başlar ve öğrenmeyi sürdürür. Kalanı asıl
   * süzgecinkinin yarısına inerse büyüyen kalan kullanıcının sesi değil, DEĞİŞEN YANKI YOLUDUR (hoparlör tamponu
   * kaydı, mikrofonun yeri): asıl süzgeç gölgeyle değiştirilir. Kullanıcının sesi referansla ilintisiz olduğu için
   * gölge onu bastıramaz; böylece dondurulmuş süzgeç yanlış "kullanıcı konuşuyor" kararında kilitli kalmaz.
   */
  private readonly shadow: Float32Array;
  private shadowOn = false;
  private shadowBlocks = 0;
  private shadowWins = 0;
  private accShadow = 0;

  // Gecikme kestirimi: enerji zarfları (10 ms).
  private readonly refEnv = new Float32Array(ENV_BLOCKS);
  private readonly micEnv = new Float32Array(ENV_BLOCKS);
  private envAt = 0;
  private envCount = 0;
  private sinceDelay = 0;
  private candidate = -1;
  private candidateCount = 0;
  private rawRefAcc = 0;
  /** Zarflardan kestirilen bağlaşım (mikrofon gücü / referans gücü); süzgeç yakınsamadan önceki kaba kapı. */
  private coupling = 0;
  private corrHits = 0;
  private corrMisses = 0;
  /** Tanı: son kestirimin en iyi ilintisi ve yeri (blok). */
  private lastCorr = 0;
  private lastCorrLag = 0;
  /** Kaba kapının gecikmesi (blok): ilintinin son güçlü bulduğu yer; yoksa -1. */
  private coarseLag = -1;
  private coarse = false;
  private frameCoarse = false;

  // Çerçeve (20 ms) özeti.
  private frameBlocks = 0;
  private frameNear = 0;
  private frameActive = false;
  private frame = { ref: 0, mic: 0, est: 0, res: 0 };

  constructor(options: EchoCancellerOptions = {}) {
    this.rate = options.sampleRate ?? 16_000;
    this.taps = options.taps ?? 1024;
    this.maxLag = Math.ceil(((options.maxDelayMs ?? ECHO_MAX_DELAY_MS) / 1000) * this.rate / BLOCK);
    let size = 1024;
    while (size < this.maxLag * BLOCK + this.taps + 4 * BLOCK) size *= 2;
    this.ringSize = size;
    this.ring = new Float32Array(size * 2);
    this.weights = new Float32Array(this.taps);
    this.shadow = new Float32Array(this.taps);
    this.gate = options.gate ?? 4;
    this.suppress = options.suppress ?? 0.3;
  }

  setGate(gate: number): void {
    this.gate = Math.min(64, Math.max(1.5, gate));
  }

  get gateValue(): number {
    return this.gate;
  }

  /** Aynı uzunlukta mikrofon ve referans bloğunu işler; yankısı çıkarılmış sesi `out`a yazar. */
  process(mic: Float32Array, ref: Float32Array | null, out: Float32Array): void {
    const { ring, ringSize, weights, taps } = this;
    for (let n = 0; n < mic.length; n++) {
      // Ön vurgu: konuşma alçak frekansta yoğundur ve NLMS böyle "renkli" girdide yavaş yakınsar. İki sinyal aynı
      // süzgeçten geçer (yankı yolu değişmez), süzgeç beyazlatılmış sinyalde öğrenir, çıkış ters süzgeçle geri alınır.
      const rawReference = ref ? (ref[n] ?? 0) : 0;
      const reference = rawReference - PRE_EMPHASIS * this.lastRef;
      this.lastRef = rawReference;
      const at = this.writeAt;
      ring[at] = reference;
      ring[at + ringSize] = reference;
      this.writeAt = at + 1 === ringSize ? 0 : at + 1;
      this.rawRefAcc += reference * reference;

      // Hizalanmış pencere: [newest - taps + 1, newest], newest = yazılan örnek − gecikme.
      let newest = at - this.delay;
      if (newest < 0) newest += ringSize;
      let base = newest - taps + 1;
      if (base < 0) base += ringSize;
      const entering = ring[base + taps - 1] ?? 0;
      const leaving = ring[base === 0 ? ringSize - 1 : base - 1] ?? 0;
      this.windowPower += entering * entering - leaving * leaving;
      if (this.windowPower < 0) this.windowPower = 0;

      const rawMic = mic[n] ?? 0;
      const desired = rawMic - PRE_EMPHASIS * this.lastMic;
      this.lastMic = rawMic;
      let estimate = 0;
      if (this.refHold > 0) {
        for (let j = 0; j < taps; j++) estimate += (weights[j] ?? 0) * (ring[base + j] ?? 0);
      }
      const error = desired - estimate;
      if (this.stepSize > 0 && this.windowPower > taps * REF_FLOOR) {
        const g = (this.stepSize * error) / (this.windowPower + taps * 1e-6);
        for (let j = 0; j < taps; j++) weights[j] = (weights[j] ?? 0) + g * (ring[base + j] ?? 0);
      }
      if (this.shadowOn) {
        // Gölge süzgeç: asıl süzgeç dondurulmuşken (kalan büyüdü) tam adımla öğrenmeyi sürdürür.
        const shadow = this.shadow;
        let shadowEstimate = 0;
        for (let j = 0; j < taps; j++) shadowEstimate += (shadow[j] ?? 0) * (ring[base + j] ?? 0);
        const shadowError = desired - shadowEstimate;
        if (this.windowPower > taps * REF_FLOOR) {
          const g = (MU * shadowError) / (this.windowPower + taps * 1e-6);
          for (let j = 0; j < taps; j++) shadow[j] = (shadow[j] ?? 0) + g * (ring[base + j] ?? 0);
        }
        this.accShadow += shadowError * shadowError;
      }

      this.accMic += desired * desired;
      this.accRes += error * error;
      this.accEst += estimate * estimate;
      this.accRef += entering * entering;
      // Kazanç blok kararını bir blok geriden izler; tıkırtı olmasın diye örnek örnek yaklaşır.
      this.outGain += (this.targetGain - this.outGain) * 0.02;
      this.deEmphasis = error + PRE_EMPHASIS * this.deEmphasis;
      out[n] = this.deEmphasis * this.outGain;

      if (++this.inBlock === BLOCK) this.endBlock();
    }
  }

  private endBlock(): void {
    const mic = this.accMic / BLOCK;
    const res = this.accRes / BLOCK;
    const est = this.accEst / BLOCK;
    const ref = this.accRef / BLOCK;
    const rawRef = this.rawRefAcc / BLOCK;
    const shadowRes = this.accShadow / BLOCK;
    this.accMic = this.accRes = this.accEst = this.accRef = this.rawRefAcc = this.accShadow = 0;
    this.inBlock = 0;

    // Referans etkinliği: hizalanmış pencerede enerji varken ve bittikten 100 ms sonrasına kadar (süzgeç kuyruğu).
    if (this.windowPower > this.taps * REF_FLOOR) this.refHold = 10;
    else if (this.refHold > 0) this.refHold--;
    const active = this.refHold > 0;

    this.refEnv[this.envAt] = Math.sqrt(rawRef);
    this.micEnv[this.envAt] = Math.sqrt(mic);
    this.envAt = (this.envAt + 1) % ENV_BLOCKS;
    if (this.envCount < ENV_BLOCKS) this.envCount++;
    if (++this.sinceDelay >= DELAY_EVERY_BLOCKS) {
      this.sinceDelay = 0;
      this.estimateDelay();
    }

    let near: number;
    this.coarse = false;
    if (!active) {
      // Yankı beklenmiyor: taban gürültüsü öğrenilir (yavaş yükselen en küçük değer izleyicisi).
      this.noiseFloor = Math.min(mic + 1e-10, this.noiseFloor * 1.02 + 1e-10);
      near = 1;
      this.nearRun = 0;
      this.stepSize = 0;
      this.targetGain = 1;
      this.shadowOn = false;
    } else {
      if (this.activeBlocks < 1000) this.activeBlocks++;
      const a = 0.12;
      this.micPower += a * (mic - this.micPower);
      this.resPower += a * (res - this.resPower);
      this.estPower += a * (est - this.estPower);
      const erle = this.micPower / (this.resPower + 1e-12);
      if (erle > 4 && this.estPower > 4 * this.noiseFloor) this.convergedBlocks = Math.min(60, this.convergedBlocks + 1);
      else this.convergedBlocks = Math.max(0, this.convergedBlocks - 2);
      if (!this.converged && this.convergedBlocks >= 30) {
        this.converged = true;
        this.trained = true;
      }
      if (this.converged && this.convergedBlocks === 0) this.converged = false;

      if (this.converged) {
        const expected = this.gate * this.residualRatio * est + 6 * this.noiseFloor + 1e-9;
        near = res > expected ? 1 : 0;
        if (near === 1) {
          if (!this.shadowOn) {
            this.shadow.set(this.weights);
            this.shadowOn = true;
            this.shadowBlocks = 0;
            this.shadowWins = 0;
            // Gölge karar verene dek (30 ms) "bilinmiyor": yankı yolu kaydıysa yanlış "kullanıcı" çerçevesi birikmesin.
            near = 0.5;
          } else {
            this.shadowBlocks++;
            if (shadowRes < 0.5 * res) this.shadowWins++;
            if (this.shadowBlocks <= 3) near = 0.5;
            if (this.shadowWins >= 3 && this.shadowWins * 2 > this.shadowBlocks) {
              // Yankı yolu değişmiş: gölge asıl süzgecin yerine geçer.
              this.weights.set(this.shadow);
              this.shadowOn = false;
              near = 0;
            }
          }
        } else {
          this.shadowOn = false;
        }
        if (est > 8 * this.noiseFloor) {
          // Olağan kalıntı oranı: oranın üst çeyreği (yüzde 80'lik dilim), bütün bloklardan. Yalnız "yankı" sayılan
          // bloklardan öğrenmek oranı aşağı çeker (yalnız iyi bloklar seçilir) ve kapı kendi kendine daralır; kullanıcı
          // seyrek konuştuğu için üst dilim onun sözünden etkilenmez.
          const ratio = res / (est + 1e-12);
          this.residualRatio *= ratio > this.residualRatio ? 1.04 : 0.99;
          // Alt sınır −25 dB: gürültüsüz ortamda (ya da çok iyi yakınsamada) kapı anlamsızca daralmasın.
          this.residualRatio = Math.min(2, Math.max(0.003, this.residualRatio));
        }
      } else if (this.coupling > 0 && this.coarseLag >= 0) {
        // Süzgeç henüz yakınsamadı (ya da hiç yakınsamayacak: doğrusal olmayan Bluetooth hoparlör): kaba kapı. Beklenen
        // yankı gücü = bağlaşım × gecikme çevresindeki en yüksek referans gücü.
        let peak = 0;
        for (let back = Math.max(0, this.coarseLag - COARSE_WINDOW_BLOCKS); back <= this.coarseLag + COARSE_WINDOW_BLOCKS && back < this.envCount; back++) {
          const value = this.refEnv[(this.envAt - 1 - back + 2 * ENV_BLOCKS) % ENV_BLOCKS] ?? 0;
          if (value > peak) peak = value;
        }
        const gate = Math.max(COARSE_GATE_MIN, Math.min(16, this.gate * 2));
        near = mic > gate * this.coupling * peak * peak + 6 * this.noiseFloor ? 1 : 0;
        this.coarse = true;
      } else {
        near = 0.5;
      }
      this.nearRun = near >= 0.5 ? this.nearRun + 1 : 0;
      if (!this.converged) this.shadowOn = false;
      // Yakın uç 1,5 sn kesintisiz sürüyorsa süzgeç artık yolu temsil etmiyordur (mikrofon ya da hoparlör yer değiştirdi):
      // yeniden öğrenilir. Gerçek kullanıcı sözünde oturum bu süreden çok önce çalmayı kesmiş olur.
      if (this.nearRun > 150) {
        this.converged = false;
        this.convergedBlocks = 0;
        this.nearRun = 0;
      }
      // Adım: yakınsamadan önce tam; sonra kalan, olağan kalıntının üstüne çıktıkça küçülür (kullanıcı konuşmaya
      // başladığında kapı karar verene dek süzgeç onun sesine uyarlanıp bozulmasın) ve yakın uçta tümüyle durur.
      if (!this.converged) this.stepSize = this.coupling > 0 ? MU : 0;
      else if (near >= 0.5) this.stepSize = 0;
      else this.stepSize = MU * Math.min(1, (1.5 * this.residualRatio * est + this.noiseFloor) / (res + 1e-12));
      this.targetGain = this.converged && near === 0 ? this.suppress : 1;
    }
    this.near = near;

    this.frame.ref += ref;
    this.frame.mic += mic;
    this.frame.est += est;
    this.frame.res += res;
    this.frameNear += near;
    this.frameActive ||= active;
    this.frameCoarse ||= this.coarse;
    this.frameBlocks++;
  }

  /**
   * Hoparlör → mikrofon gecikmesi: referans ve mikrofon zarflarının (ortalaması çıkarılmış) çapraz ilintisinin tepesi.
   * Yalnız ilinti güçlüyse (mikrofonda Jarvis'in sesi baskınsa) ve iki ardışık kestirim aynı yeri gösteriyorsa uygulanır.
   */
  private estimateDelay(): void {
    const count = this.envCount;
    const span = Math.min(200, count - this.maxLag);
    if (span < 60) return;
    const refAt = (back: number): number => this.refEnv[(this.envAt - 1 - back + 2 * ENV_BLOCKS) % ENV_BLOCKS] ?? 0;
    const micAt = (back: number): number => this.micEnv[(this.envAt - 1 - back + 2 * ENV_BLOCKS) % ENV_BLOCKS] ?? 0;
    let micMean = 0;
    for (let i = 0; i < span; i++) micMean += micAt(i);
    micMean /= span;
    let micVar = 0;
    for (let i = 0; i < span; i++) micVar += (micAt(i) - micMean) ** 2;
    if (micVar < 1e-9) return;

    let best = -1;
    let bestCorr = 0;
    let bestCoupling = 0;
    for (let lag = 0; lag <= this.maxLag; lag++) {
      let refMean = 0;
      for (let i = 0; i < span; i++) refMean += refAt(i + lag);
      refMean /= span;
      let cross = 0;
      let refVar = 0;
      let refSquares = 0;
      let micRef = 0;
      for (let i = 0; i < span; i++) {
        const r = refAt(i + lag);
        const m = micAt(i);
        cross += (r - refMean) * (m - micMean);
        refVar += (r - refMean) ** 2;
        refSquares += r * r * r * r;
        micRef += m * m * r * r;
      }
      if (refVar < 1e-9) continue;
      const corr = cross / Math.sqrt(refVar * micVar);
      if (corr > bestCorr) {
        bestCorr = corr;
        best = lag;
        bestCoupling = refSquares > 0 ? micRef / refSquares : 0;
      }
    }
    // Referans son pencerede sessizse ilinti ölçülemez: ne kanıt ne karşı kanıt.
    if (best < 0) return;
    this.lastCorr = bestCorr;
    this.lastCorrLag = best;
    if (bestCorr < COUPLE_CORR) {
      // Jarvis konuşuyor ama mikrofonda onun zarfı yok. Kullanıcının üste konuşması da böyle görünür; yankının
      // gerçekten kalktığına (kulaklık takıldı) ancak uzun süre (5 sn) hiç ilinti çıkmazsa karar verilir.
      if (++this.corrMisses >= 20 && this.coupling > 0) this.forget();
      return;
    }
    this.corrMisses = 0;
    this.coarseLag = best;
    // Tek bir güçlü ilinti rastlantı olabilir (kullanıcının tek bir sözü Jarvis'in bir hecesine denk gelir): yankı var
    // demek için iki ardışık kestirim gerekir. Yankı yokken süzgeç HİÇ öğrenmez; yoksa kullanıcının sesini bozardı.
    if (++this.corrHits < 2) return;
    this.coupling = bestCoupling;
    // Zarf çözünürlüğü 10 ms: süzgeç, kestirilen gecikmenin 20 ms öncesinden başlar.
    const wanted = Math.max(0, best * BLOCK - 2 * BLOCK);
    if (Math.abs(wanted - this.delay) <= 2 * BLOCK) {
      this.candidateCount = 0;
      return;
    }
    if (Math.abs(wanted - this.candidate) <= BLOCK) this.candidateCount++;
    else {
      this.candidate = wanted;
      this.candidateCount = 1;
    }
    if (this.candidateCount >= 2) this.applyDelay(this.candidate);
  }

  /** Yankı kalktı (ya da hiç yoktu): öğrenilenler bırakılır, mikrofon olduğu gibi geçer. */
  private forget(): void {
    this.coupling = 0;
    this.coarseLag = -1;
    this.corrHits = 0;
    this.corrMisses = 0;
    this.weights.fill(0);
    this.converged = false;
    this.trained = false;
    this.convergedBlocks = 0;
    this.shadowOn = false;
  }

  private applyDelay(delay: number): void {
    this.delay = delay;
    this.candidateCount = 0;
    this.weights.fill(0);
    this.converged = false;
    this.trained = false;
    this.convergedBlocks = 0;
    this.residualRatio = 0.25;
    let newest = this.writeAt - 1 - delay;
    while (newest < 0) newest += this.ringSize;
    let power = 0;
    for (let k = 0; k < this.taps; k++) {
      const value = this.ring[(newest - k + this.ringSize) % this.ringSize] ?? 0;
      power += value * value;
    }
    this.windowPower = power;
  }

  /** Son çağrıdan bu yana geçen blokların özeti (çerçeve başına bir kez çağrılır). */
  takeFrame(): EchoFrameInfo {
    const blocks = Math.max(1, this.frameBlocks);
    const info: EchoFrameInfo = {
      ref: Math.sqrt(this.frame.ref / blocks),
      mic: Math.sqrt(this.frame.mic / blocks),
      est: Math.sqrt(this.frame.est / blocks),
      res: Math.sqrt(this.frame.res / blocks),
      near: this.frameBlocks > 0 ? this.frameNear / this.frameBlocks : this.near,
      active: this.frameActive,
      converged: this.converged,
      trained: this.trained,
      warm: this.activeBlocks >= 150,
      coupled: this.coupling > 0,
      delayMs: Math.round((this.delay * 1000) / this.rate),
      erleDb: this.resPower > 0 ? 10 * Math.log10(this.micPower / this.resPower) : 0,
      corr: Number(this.lastCorr.toFixed(2)),
      corrLagMs: Math.round((this.lastCorrLag * BLOCK * 1000) / this.rate),
      coarse: this.frameCoarse,
    };
    this.frame.ref = this.frame.mic = this.frame.est = this.frame.res = 0;
    this.frameNear = 0;
    this.frameBlocks = 0;
    this.frameActive = false;
    this.frameCoarse = false;
    return info;
  }
}
