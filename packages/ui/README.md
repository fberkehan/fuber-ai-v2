# @fuber/ui — "Canlı Siyah" tasarım sistemi

İki uygulamanın (Fuber AI 2, Fuber Yönetim 2) bütün ekranları yalnız bu paketten kurulur (KURGU §2.7, §12).
Bileşenler sunum içindir: IPC çağırmaz, `window.fuber`'a dokunmaz; veri ve olaylar prop olarak gelir.
Görünen metin sözlükten gelir; bileşenlerdeki Türkçe varsayılanlar (ör. "Kapat") yalnız erişilebilirlik adıdır, prop ile değiştirilir.

## Kurulum

```css
/* renderer giriş CSS'i */
@import '@fuber/ui/styles.css';
```

Pencereye bir kez `<Toaster />` koyun. Katmanlar (Dialog, Menu, Select, Tooltip, Toast) kendiliğinden `<body>` sonundaki
tek portal köküne (`[data-fuber-layers]`) çizilir; sağlayıcı (provider) gerekmez.

## Örnek

```tsx
import { AppShell, NavRail, PageHeader, Section, List, Row, Button, Core, Badge, toast } from '@fuber/ui';
import { Sun, Receipt } from '@phosphor-icons/react';

<AppShell rail={<NavRail items={[{ value: 'today', label: 'Bugün', icon: <Sun /> }]} value="today" onChange={go} />}>
  <PageHeader leading={<Core state={voice} size={40} />} title="Bugün" actions={<Button variant="primary">Konuş</Button>} />
  <Section title="Yaklaşanlar" className="px-10 pt-8">
    <List><Row icon={<Receipt />} title="KDV beyannamesi" trailing={<Badge tone="warning">10 gün</Badge>} onPress={open} /></List>
  </Section>
</AppShell>;
toast.success('Hatırlatıcı kaydedildi');
```

## Kurallar

- **Sayfalarda `style={{}}` yalnız dinamik değer için** (ölçülen genişlik, sürüklenen konum). Renk, boşluk, yarıçap,
  gölge her zaman jeton sınıfı: `bg-surface-2`, `text-fg-muted`, `border-line`, `rounded-md`, `p-4`, `shadow-float`.
  Tailwind'in hazır paleti kapalıdır (`bg-blue-500` çalışmaz).
- **z-index yazılmaz.** Ölçek: `--z-base · --z-raised · --z-sticky · --z-rail · --z-inspector · --z-layer · --z-tooltip · --z-toast`
  (`z-(--z-sticky)`). Yüzen her şey katman yöneticisinden geçer; iç içe açılan her zaman üstte kalır, Esc ve dış tıklama
  yalnız en üsttekini kapatır.
- Yüzeyler: zemin `bg-stage` (#000) → `surface-1` kart (#0f0f0f) `/2/3` → denetim dolgusu `surface-4/5`. Yüzeyler nötr
  gridir. Gölge yalnız yüzenlerde. Sayfanın zemini görünüme bağlıdır: `bg-page` / `ring-page` (kart rengini zemin
  yerine kullanmayın).
- **İki görünüm:** belge kökündeki `data-appearance` (`takimyildiz` | `centik`; `AppearanceProvider` yazar) kartın
  ışığını, panoyu ve varlığı seçer (`appearance.css`). Yönetim görünüm seçmez: sade kart, düz pano. Elle yazılan
  sınıflar `@layer components` içindedir (Tailwind yardımcı sınıfları ezebilsin).
- Yazı: başlıklar `h1–h4` (640, -0.045em), en küçük `text-xs` (12 px). Rakamlar ve saatler tabular (Inter). `font-mono` yalnız kod, yol, sürüm.
  Devre dışı yazı `text-fg-faint` (saydamlıkla soldurma yok; ≥ 4.5:1).
- Vurgu tek: Fuber mavisi (`bg-accent`, koyu zeminde yazı `text-accent-fg`). Birincil eylem beyaz hap (`variant="primary"`), ekranda bir tane.
- Süs için döngüsel animasyon yok (istisna: `Spinner`). Varlık yalnız bir duruma ya da gerçek sinyale bağlıyken hareket eder.
- İkonlar `@phosphor-icons/react`; boyutu bileşen verir.

## Bileşenler

| Grup | Bileşenler |
|---|---|
| Eylem | `Button` (primary · secondary · ghost · danger; sm/md/lg; `loading`, `icon`, `trailing`), `IconButton` (zorunlu `label`, ipucu kendiliğinden), `KeyHint` |
| Form | `Field` (etiket + yardım + hata; içindeki denetime kimlik ve `aria-*` bağlar), `Input`, `Textarea` (kendiliğinden büyür), `Select`, `Switch`, `Checkbox` (üç hâl) |
| Düzen | `AppShell` (ray · içerik · `inspector`; `frameless`, `notch`, `backdrop`), `NavRail` (daraltılabilir, kayan gösterge, kısayol rozeti), `PageHeader`, `Section`, `Surface`, `Card` (`attention`), `Starfield`, `Segmented` |
| Veri | `List` + `Row` (ikon · başlık · alt metin · sağ yuva; `selected`, `onPress`, oklarla gezinme), `Tabs` + `TabPanel`, `Badge`, `Chip`, `DateStrip`, `StatusPill` |
| Katman | `Dialog` (odak tuzağı, `alertdialog`, `initialFocusRef`), `Menu`, `Tooltip`, `Toaster` + `toast()` |
| Durum | `ProgressBar`, `ProgressRing`, `Spinner`, `Skeleton`, `EmptyState`, `Waveform` (genlik dizisiyle), `Presence`, `IslandShell` |

### Varlık (`Presence`, `IslandShell`)

```tsx
<Presence state="idle | wake | listening | followup | thinking | speaking | muted | error | notice | approval | job | computer | stopped"
          getLevel={() => rms} size={28 | 40 | 112} progress={0..1} />
<Presence state={state} field={{ width, height, anchorX, anchorY }} trackPointer />   // geniş yüzey: gökyüzü + varlık
<IslandShell appearance="takimyildiz | centik" variant="island | window" state={state} getLevel={...}
             contentKey="heard" card={false} retreat={false} onTarget={setSize}>…içerik…</IslandShell>
```

Jarvis'in varlığı iki görünümde aynı aileden. **Takımyıldız:** yıldızlardan toplanan çekirdek (WebGL2, tek çizim
çağrısı); akışın yönü sesin yönüdür (dinlerken içeri ve beyaz, konuşurken dışarı ve mavi), düşünürken sarmal, bekleyen
karar ve süren iş dolan/eriyen halka, bilgisayarı kullanırken ekran çerçevesi. **Çentik:** bakan gözler (v1 "Pamuk";
sakkad, kırpma, imleç, uyku) ve gövdenin alt dudağı (iki ucu sabit tel; ses titretir). `IslandShell` kenara kaynaklı
gövdedir (ada ve ana pencere çentiği): içerik doğal ölçüsünde ölçülür, gövde o ölçüye yayla gelir, eski içerik kısa
bir hayalet olarak söner. `Core` eski addır; `Presence`'ı çizer.

Kare döngüsü ortak ve yalnız hareket sürerken döner (`presence/ticker.ts`): boşta sıfır kare. Azaltılmış harekette
akış, sarmal ve dudak durur; parlaklık sesi izler. Sayfa başına WebGL bağlamı sınırlıdır (~16): aynı sayfada çok
sayıda Takımyıldız varlığı çizmeyin. Sınamalar için elle sürme: `window.__fuberPresence.setManual(true)`, `step(ms)`.

## Hareket ön ayarları (`motion.ts`)

- Yaylar: `spring.snappy` (0.20 sn; düğme, anahtar, gösterge) · `spring.smooth` (0.26; kart, satır, diyalog) · `spring.gentle` (0.32, hafif esnek; toast, ada).
- Giriş/çıkış: `enter.fade` · `enter.fadeUp` · `enter.pop` (menü/açılır; `transformOrigin` tetikleyicide) · `enter.dialog` · `enter.toast`.
- `stagger(i)` (35 ms aralık, 8 öğede tavan) · `fade` (eğri tabanlı saydamlık) · `durations` · `easings`.
- Azaltılmış hareket tek yerden: `useMotionPreset(enter.fadeUp)` ve `useMotionTransition(spring.snappy)` kullanın; ön ayarı doğrudan yaymayın.
- CSS tarafı: `duration-(--duration-fast)` (180 ms), `ease-out` (`--ease-out`). Basma geri bildirimi `active:scale-[0.97]`.
