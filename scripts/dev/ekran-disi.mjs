// Ekran dışı gerçek pencere düzeneği (0.14 T28 düzeltme turu 1; ada-gercek-pencere.mjs, centik-videolari.mjs): ana süreçte `electronApp.evaluate` ile koşar.
// İmleç noktası koşu başında BİR KEZ okunur ve `screen.getCursorScreenPoint` o noktaya sabitlenir (yalnız bu test sürecinde; uygulama kodu değişmez):
// gerçek imleç koşu sırasında ekran değiştirse de uygulama çentiği hep aynı ekrana (D) ve aynı ölçekle kurar. Çentik o ekrana yeniden kurulsun diye bir ekran
// olayı yayılır. Ekran dışı nokta D'ye göre seçilir: D'nin bir kenarının ötesinde, hiçbir ekranın içinde olmayan ve en yakın ekranı D olan nokta — pencerenin
// DPI'ı uygulamanın kullandığı ölçekle aynı olur (sabit -6000,-3000 ölçeği karışık bilgisayarda başka ekrana düşüyordu: kol (a) kararsızlığının nedeni).
// Kullanım: const D = await u.evaluate(imleciSabitleVeEkranDisiSec);
export function imleciSabitleVeEkranDisiSec({ screen }, ekranSirasi = null) {
  // `ekranSirasi` (tanı ve sabit koşu: ADA_GERCEK_EKRAN): imleç o ekranın üst ortasına sabitlenir; verilmezse gerçek imlecin o anki noktası.
  const liste = screen.getAllDisplays();
  const secilen = ekranSirasi == null || ekranSirasi === '' ? null : liste[Number(ekranSirasi)];
  const p = secilen ? { x: secilen.bounds.x + Math.round(secilen.bounds.width / 2), y: secilen.bounds.y + 200 } : screen.getCursorScreenPoint();
  screen.getCursorScreenPoint = () => ({ ...p });
  const hepsi = screen.getAllDisplays();
  // Ekran, uygulamanın kuralıyla seçilir (main/ada-konum.ts centikYerlesimi: imlecin dikdörtgene uzaklığı, eşitlikte listedeki ilk). Electron'un
  // getDisplayNearestPoint'i --force-device-scale-factor altında başka ekranı verebiliyor (DIP'i ikinci kez bölünmüş ekranlar; T28 düzeltme turu 1).
  const uzaklik = (r, q) => {
    const dx = q.x < r.x ? r.x - q.x : q.x >= r.x + r.width ? q.x - (r.x + r.width - 1) : 0;
    const dy = q.y < r.y ? r.y - q.y : q.y >= r.y + r.height ? q.y - (r.y + r.height - 1) : 0;
    return Math.hypot(dx, dy);
  };
  const d = hepsi.reduce((en, e) => (uzaklik(e.bounds, p) < uzaklik(en.bounds, p) ? e : en), hepsi[0]);
  screen.emit('display-metrics-changed', {}, d, []);
  const icinde = (q) => hepsi.some((e) => q.x >= e.bounds.x && q.x < e.bounds.x + e.bounds.width && q.y >= e.bounds.y && q.y < e.bounds.y + e.bounds.height);
  const uygun = (q) => !icinde(q) && !icinde({ x: q.x + 1300, y: q.y + 900 }) && screen.getDisplayNearestPoint(q).id === d.id && screen.getDisplayNearestPoint({ x: q.x + 1300, y: q.y + 900 }).id === d.id;
  const b = d.bounds;
  const adaylar = [{ x: b.x + b.width + 3000, y: b.y }, { x: b.x - 4000, y: b.y }, { x: b.x, y: b.y + b.height + 3000 }, { x: b.x, y: b.y - 4000 }];
  const nokta = adaylar.find(uygun) ?? { x: -6000, y: -3000 };
  return { id: d.id, bounds: d.bounds, olcek: d.scaleFactor, imlec: p, ekranDisi: nokta, fizikselEkranlar: hepsi.map((e) => screen.dipToScreenRect(null, e.bounds)) };
}
