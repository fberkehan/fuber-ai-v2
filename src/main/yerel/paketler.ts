// ── Yerel beyin paketleri: sürümler SABİT, SHA-256 özetleri yayımlanmış kaynaklardan ────────────────────────────
// Çalıştırıcı: PrismML'in llama.cpp çatalı (Bonsai'nin 1,58-bit/2-bit çekirdekleri burada; ana llama.cpp'de henüz hepsi
// yok). Özetler GitHub sürüm varlıklarının `digest` alanından. Modeller: prism-ml/Ternary-Bonsai-2 (Apache-2.0,
// Qwen3.x tabanlı, çok dilli); özetler Hugging Face LFS'ten. Piper: rhasspy/piper 2023.11.14-2 + tr_TR-dfki-medium
// (özet yayımlanmadığı için 19 Eki 2026'da indirilen dosyadan sabitlendi).
// 19 Eki 2026 ölçümü (RTX 4080 SUPER): 27B ilk yanıt ~0,4-0,6 sn, Türkçe doğal; 9B ~0,2 sn ama Türkçe zayıf.
// 0.13 G: YEREL_MODELLER başlangıç listesidir, okuyucular katalogBul'a gider (yerel/katalog.ts). 31 Eki 2026 çalıştırıcı denemesi: bu ikili standart GGUF'ları da açıyor
// (sunucu.ts'in bayraklarıyla Qwen3 0.6B Q8_0 işlemci + CUDA, Qwen3 4B Q4_K_M ve Gemma 3 4B Q4_K_M işlemci); tek ikili kalır, ana llama.cpp'ye geçilmedi.

export interface Varlik { ad: string; url: string; sha256: string; boyut: number }

const LLAMA_SURUM = 'prism-b10777-e3de715';
const gh = (ad: string) => `https://github.com/PrismML-Eng/llama.cpp/releases/download/${LLAMA_SURUM}/${ad}`;

export const LLAMA = {
  surum: LLAMA_SURUM,
  cuda: [
    { ad: `llama-${LLAMA_SURUM}-bin-win-cuda-13.3-x64.zip`, url: gh(`llama-${LLAMA_SURUM}-bin-win-cuda-13.3-x64.zip`), sha256: '071088ef64f2e62dfb488f4d73cc368df945f9c0e8c7019bc94daf9abd0eb4aa', boyut: 179_212_635 },
    { ad: 'cudart-llama-bin-win-cuda-13.3-x64.zip', url: gh('cudart-llama-bin-win-cuda-13.3-x64.zip'), sha256: '1462a050eb4c684921ba51dcc4cc488a036674c3e73e9945ee705b854808d03e', boyut: 390_970_417 },
  ] as Varlik[],
  cpu: [
    { ad: `llama-${LLAMA_SURUM}-bin-win-cpu-x64.zip`, url: gh(`llama-${LLAMA_SURUM}-bin-win-cpu-x64.zip`), sha256: 'cff7eeff19163e6263720618cf98023715b8dac14d0873f5be0918765de323c4', boyut: 19_530_958 },
  ] as Varlik[],
};

export const hfAdresi = (repo: string, dosya: string) => `https://huggingface.co/${repo}/resolve/main/${dosya}`;
const hf = hfAdresi;

/**
 * Gereksinimler (model seçicinin "Rahat çalışır / Zorlanır / Çalışmaz" hesabı: shared/model-bilgisi.ts → yerelUygunluk):
 *  - vramGB: ekran kartında hızlı çalışması için bellek = model dosyası + bağlam önbelleği (sunucu.ts: -c 8192, -np 2) + hesap
 *    tamponları; Windows masaüstünün kartta tuttuğu pay için yuvarlanmıştır (8 GB'lık kart 27B'yi tam taşıyamaz → "Zorlanır").
 *    Yoksa model işlemcide de rahat çalışacak kadar hafiftir.
 *  - ramGB: işlemcide çalışması için toplam bellek = model + çalışma belleği + işletim sistemi ve uygulamanın payı (standart boy).
 * 0.12 H3c (model kataloğu): `ozet` kurulumun "Nerede çalışsın" adımındaki ve Ayarlar → Gizlilik'teki model kartının tek satırı — İş dilinde
 * (model/marka adı yok; tests/yerel-katalog.test.ts). Uygunluk ve neden gerçek donanımdan: shared/yerel-katalog.ts yerelKatalog.
 */
export type BonsaiAdi = 'bonsai2-27b' | 'bonsai2-9b' | 'bonsai2-4b';
export const YEREL_MODELLER: Record<BonsaiAdi, Varlik & { etiket: string; aciklama: string; ozet: string; ramGB: number; vramGB?: number }> = {
  'bonsai2-27b': {
    etiket: 'Bonsai 2 · 27B', aciklama: 'En doğal Türkçe; ilk yanıt ~0,5 sn.', ozet: 'En doğal Türkçe, en iyi yanıtlar',
    ad: 'Ternary-Bonsai-2-27B-PQ2_0.gguf', url: hf('prism-ml/Ternary-Bonsai-2-27B-gguf', 'Ternary-Bonsai-2-27B-PQ2_0.gguf'),
    sha256: '3907dc1658db1f78a9826bf8d5bcb8dc65db0d466388937af57f2294fae62ec1', boyut: 7_206_168_928, ramGB: 16, vramGB: 9,
  },
  'bonsai2-9b': {
    etiket: 'Bonsai 2 · 9B', aciklama: 'Çok hızlı (~0,2 sn), küçük; Türkçe sohbeti zayıf, sınıflandırma için yeterli.', ozet: 'Çok hızlı; kısa ve gündelik işler için',
    ad: 'Ternary-Bonsai-2-9B-Q2_0.gguf', url: hf('prism-ml/Ternary-Bonsai-2-9B-gguf', 'Ternary-Bonsai-2-9B-Q2_0.gguf'),
    sha256: '1f884aa56aacd2bbbb2e4b7abaead2b1102b74a9c75a23fc33dab916813a384d', boyut: 2_556_640_128, ramGB: 8, vramGB: 5, // 4 GB'lık kart masaüstü payıyla yetmez
  },
  'bonsai2-4b': {
    etiket: 'Bonsai 2 · 4B', aciklama: 'En hafif (1,2 GB); ekran kartı yoksa işlemcide de çalışır.', ozet: 'En hafif; ekran kartı gerekmez',
    ad: 'Ternary-Bonsai-2-4B-Q2_0.gguf', url: hf('prism-ml/Ternary-Bonsai-2-4B-gguf', 'Ternary-Bonsai-2-4B-Q2_0.gguf'),
    sha256: '64a5183b44921bdb5ac4a6f5f92007821d6ebe5c66997d3c147fd214ab9433d4', boyut: 1_212_103_520, ramGB: 6,
  },
};

export const PIPER = {
  calistirici: { ad: 'piper_windows_amd64.zip', url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip', sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea', boyut: 22_477_236 } as Varlik,
  ses: { ad: 'tr_TR-dfki-medium.onnx', url: hf('rhasspy/piper-voices', 'tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx'), sha256: '2844717f524ab965d3fe86e60562cbb601d3e456836efcc2196cc3a14112a8fb', boyut: 63_201_294 } as Varlik,
  sesAyari: { ad: 'tr_TR-dfki-medium.onnx.json', url: hf('rhasspy/piper-voices', 'tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx.json'), sha256: '13ebd7810f1b61b5027583cf3131a0a233b6ea81c38f2200ebc4ff41c3cca039', boyut: 4_960 } as Varlik,
};
