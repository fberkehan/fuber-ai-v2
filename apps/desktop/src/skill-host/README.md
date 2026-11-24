# Yetenek konağı (`skill-host`)

Kullanıcı yeteneklerinin (Atölye'nin yazdığı ya da `skills/` altına elle konan kod) koştuğu ayrı süreç.
Ana süreç `runtime.skillHostPath` (`dist/skill-host/index.js`) dosyasını `utilityProcess` ile başlatır;
iki taraf yalnız düz JSON iletileriyle konuşur (`protocol.ts`).

**Bu bir kum havuzu değildir.** Aşağıdaki önlemler saldırı yüzeyini küçültür ve hataları yalıtır; kötü niyetli,
kararlı bir koda karşı güvenlik sınırı sayılmaz. Ticari sürümden önce gerçek kum havuzu gerekir (en altta).

## Nasıl çalışır

```
ana süreç (modules/workshop)                         konak süreci (bu klasör)
  dosyaları okur, manifesti doğrular                   her yetenek için ayrı vm bağlamı (sandbox.ts)
  kaynağı statik denetler (audit.ts)        ──load──►  runtime-source.ts bağlamın içinde koşar: ctx, console, setTimeout
  gövdeye çevirir (export → __exports)      ──call──►  araç işlevini çağırır, sonucu JSON olarak döndürür
  ctx isteklerini karşılar (bridge.ts)      ◄─bridge─  ctx.fetch / storage / notify / showCard / remind
  zaman aşımı, öldür-yeniden başlat (host.ts)
```

- Yetenek kodu konağa **dosya olarak değil metin olarak** gelir: denetlenen bayt ile çalışan bayt aynıdır ve
  konağın dosya sistemine ihtiyacı yoktur.
- İki konak süreci vardır: **canlı** (yalnız onaylı ve etkin yetenekler) ve **geçici** (öz-sınama ve yapım
  sırasındaki taslaklar). Onaylanmamış kod canlı konağa hiç girmez; geçici konak kullanılmadığında kapanır.
- İletiler: `load`, `unload`, `call`, `selftest`, `ping`; konaktan `ready`, `running`, `response`, `bridge`, `log`.

## Önlemler: neyi engeller, neyi engellemez

| Önlem | Engellediği | Engellemediği / sınırı | Kanıt |
|---|---|---|---|
| **Onay kapısı** (içeriğin SHA-256 özetine bağlı; durum veritabanında, klasörün dışında) | Onaylanmamış ya da onaydan sonra değişmiş kodun araç olarak beyne görünmesi ve canlı konağa yüklenmesi | Öz-sınama onaydan **önce** koşar: taslak kod geçici konakta çalışır (elinde kullanıcı verisi yoktur). Ağı kapalıdır (aşağıda); bağlamdan kaçan kod için bu bir sınır değildir | `lifecycle.test.ts`, `workshop.test.ts`, e2e 1 ve 3 |
| **Statik denetim** (`audit.ts`) | Açık yazılmış `import`/`require`/`import()`, `process`, `eval`, `Function`, `globalThis`, doğrudan `fetch`, `.constructor`/`__proto__`, `node:` adları, unicode kaçışlı tanımlayıcı | Metne bakar: hesaplanan erişim (`x['con' + 'structor']`) ve gizlenmiş kod geçer. Güvenlik sınırı değil, ilk süzgeç ve modele geri bildirim | `audit.test.ts` (25 yasak kalıp, masum kod) |
| **Ayrı `vm` bağlamı** (`sandbox.ts`): boş küresel nesne, `codeGeneration.strings: false`, dinamik `import` yükleyicisi yok | Bağlamda `process`, `require`, `fetch`, `Buffer` **yoktur**; `eval`/`new Function` fırlatır; `import('node:fs')` yüklenemez | `node:vm` Node belgelerine göre güvenlik mekanizması değildir. V8/Node açığı ya da gözden kaçan bir sızıntıyla bağlamdan çıkan kod, konak sürecinde **tam Node yetkisiyle** koşar | `host.test.ts` › "bağlamda süreç, modül yükleme ve ağ yoktur" |
| **Sınırdan yalnız metin geçer** (`runtime-source.ts`): bağlama giren tek konak nesnesi (`hostSend`) kapanışta saklı bir işlevdir, mikro görevden çağrılır, fırlatmaz; `ctx`, yanıtlar, hatalar ve Promise'ler bağlamın kendi dünyasında yaratılır | Konak dünyasına ait nesnenin (ve `constructor.constructor` zincirinin) yetenek koduna geçmesi; yığın taşmasıyla konak hatası yakalama | `hostSend` konak dünyasının işlevidir: bir gün sızarsa `constructor.constructor` ile tam kaçış olur; bugün ulaşılan bir yol bulunmadı. Bağımsız inceleme bir kez yapıldı (aşağıda O3) | `sandbox.test.ts` (ctx, ctx.fetch, storage, depodan gelen veri, Promise, köprü hatası, girdi, console, setTimeout, yığın taşması hatası: kurucu zinciri bağlamın `Function`ına çıkar ve kod üretemez) |
| **Yerleşiklerin kilidi** (`runtime-source.ts` › `lockGlobals`): bağlamın bütün küresel adları (`Error`, `Promise`, `Reflect`, `JSON`, `Object`, `Function`, `Symbol`, `Array`, …) yazılamaz ve yeniden tanımlanamaz; yapıcılar ve ad alanları dondurulur (`Error.prepareStackTrace`, `Error.captureStackTrace` dahil); `Promise.prototype` dondurulur | Yığın kancası (CallSite) üzerinden konağın çerçevelerine uzanmak. **Kapatılan açık (O3):** kilit yalnız bağlamın `Error` nesnesindeydi; Node kancayı `globalThis.Error.prepareStackTrace` üzerinden okuduğu için `Error = { prepareStackTrace }` kilidi atlatıyordu. Sınamada kanca kuruldu ve 10 çerçeve alındı (konağın `sandbox.ts` çerçeveleri ve tam dosya yolu dahil). Nesneye kaçış OLMADI: konak kodu katı kipte (ESM) olduğu için `getThis()`/`getFunction()` boş döndü, CallSite nesneleri bağlamın dünyasındaydı (kod üretimi kapalı). Sızan yalnız bilgiydi (dosya yolları, kullanıcı adı) | Prototipler (Error.prototype, Object.prototype, Array.prototype) bilinçli olarak dondurulmaz (sıradan kodu bozar); bir yetenek kendi bağlamındaki prototipleri bozabilir, bu yalnız kendisini etkiler. Konak kodu katı kipten çıkarsa (CJS demet, `'use strict'` yok) kanca açığı kapalı olsa bile başka bir yığın sızıntısı tam kaçışa dönüşebilir | `sandbox.test.ts` (atama, `defineProperty`, `delete`, statik yöntem değiştirme, Error kancası; kilidin sıradan kodu bozmadığı) |
| **Boş ortam** (`env: {}`), çalışma dizini `skills/` | API anahtarlarının, belirteçlerin ve kullanıcı yollarının konağa ortam değişkeni olarak geçmesi | Bağlamdan çıkan kod diskteki dosyaları okuyabilir (veritabanı, politika önbelleği; anahtarlar `safeStorage` ile şifrelidir ama aynı Windows kullanıcısı çözebilir) | `spawn.ts`; `utilityProcess` ile elle ölçüldü (çocukta yalnız verilen değişkenler görünüyor); otomatik sınaması yok |
| **Ağ yalnız `ctx.fetch`** (ana süreçte, `net.ts`): manifest yalnız genel alan adı kabul eder (IP sabiti, ondalık/onaltılık/sekizlik IPv4, `localhost`, `.local`/`.internal` gibi yerel adlar ve port yok); yalnız http/https ve varsayılan port; geri döngü, özel ağ, bağlantı-yerel, CGNAT, çok noktaya yayın ve IPv4 gömen IPv6 biçimleri **her durumda** reddedilir; çözülen adres bağlanmadan önce denetlenir ve bağlantı o IP'ye sabitlenir; yönlendirmelerin her adımı aynı kapıdan (izin listesi + çözüm + adres) geçer; 15 sn, 1 MB | İzin listesi dışındaki adreslere istek; yerel servislere (kontrol servisi `127.0.0.1:47820` dahil) ve yerel ağa istek; izinli alan adının sonradan yerel adrese çözülmesi (DNS rebinding) ya da yerel adrese yönlendirmesi; `file:` ve kimlikli adresler | İzinli adrese **ne gönderildiği** denetlenmez: ağ izni olan yetenek, kendisine girdi olarak verilen bilgiyi o adrese gönderebilir. Konak sürecinin kendisinde ağ işletim sistemi düzeyinde kapalı değildir (`fetch` küreseli silinir; bağlamdan çıkan kod soket açabilir; bu kapılar yalnız `ctx.fetch` yolunu korur) | `net.test.ts`, `manifest.test.ts`, `bridge.test.ts`, e2e 2 (sahte DNS + sahte taşıyıcı) |
| **Öz-sınamada ağ kapalı** (`bridge.ts`): `selftest` kipinde `ctx.fetch` ana süreçte reddedilir ("öz-sınama sırasında ağ kapalı…"); öz-sınama ağ davranışını `mockFetch` ile verilen örnek yanıtla sınar | Onaydan önce (kullanıcı adresleri ve kodu görmeden) taslak kodun ağa çıkması: hem dışarıya veri sızdırma hem yerel servis yoklama | Bağlamdan kaçan kod için sınır değildir (yukarıdaki satır). Gerçek servisin yanıt biçimi öz-sınamada doğrulanmaz; biçim yanlışsa hata ilk canlı çağrıda görünür | `bridge.test.ts`, `host.test.ts`, e2e 2 |
| **`ctx` dar yüzeyi** (`bridge.ts`): depolama yeteneğe özel ve sınırlı; bildirim en çok `normal` öncelik, dakikada 6; kartta dosya yolu taşıyan blok yok; hatırlatıcı çekirdeğin kapısından | Yeteneğin hafızaya, hatırlatıcı listesine, dosyalara, kabuğa, ekrana, mikrofona ulaşması; sesli ve ısrarcı bildirim | Yetenek, araç açıklaması ve sonuç metniyle beyni etkilemeye çalışabilir (istem enjeksiyonu). Açıklamalar onay kartında gösterilir; sonuç metni "bilgi" sayılır ama bu bir güvence değildir | `host.test.ts`, `workshop.test.ts` |
| **Zaman aşımı ve öldür-yeniden başlat** (`host.ts`): çağrı 20 sn, öz-sınama 60 sn; yanıt vermeyen konak öldürülür, etkin yetenekler geri yüklenir; üç kez kilitleyen yetenek kapatılır | Sonsuz döngünün ya da çöken yeteneğin uygulamayı ve diğer yetenekleri düşürmesi | Öldürülen konakta o an süren diğer çağrılar "yeniden başlatıldı" hatası alır. Bellek ve işlemci için kota yok: yetenek zaman aşımına kadar bir çekirdeği doldurabilir | `host.test.ts`, `workshop.test.ts`, e2e 3 |
| **Yapım araçları** (`build.ts`): yalnız dört dosya adı, yalnız taslak klasörü, boyut sınırı, bağlantı (symlink/junction) reddi | Modelin klasör dışına yazması, başka dosya türü bırakması | Model web araması sonuçlarından etkilenebilir; yazdığı kod yine yukarıdaki süzgeçlerden geçer, başka denetimi yok | `paths.test.ts`, `workshop.test.ts` |

## Eklenti yüzeyi (d4-gelistir)

`ctx` yüzeyine dört kapı eklendi; hepsi ana süreçte (`modules/workshop/bridge.ts`), eklentinin manifestine göre karşılanır:

| Kapı | Koşul | Sınırı |
|---|---|---|
| `ctx.settings.get` | manifestte bildirilen ayar | yalnız okur; bilinmeyen anahtar `undefined` |
| `ctx.files.*` | `fs` izni + `fs.roots` | yalnız bildirilen kökün içi (`resolveInside`: `..`, mutlak yol, bağlantı reddedilir); metin, 1 MB; yalnız dosya silinir. Kök kullanıcının Belgeler/Masaüstü/İndirilenler klasörünün ALT klasörüdür: kökün içindeki her şeyi okuyup yazabilir, bu bir sınırdır ama süzgeç değildir |
| `ctx.tools.call` | `uses.tools` listesi | `danger` araçlar ve `skill_*`/`core_*` hiçbir koşulda; `write` araçlardan yalnız `reminder_create`, `todo_add`, `todo_add_many`, `memory_save` (eklenti Jarvis adına bilgisayarı kullanamaz); çağrı araç kapısından `skill` kökeniyle geçer; dakikada 30. Eklenti, izinli bir aracın SONUCUNU (ör. hafıza araması bildirilmişse hafızayı) okuyabilir: `uses.tools` onay kartında bu yüzden ad ad gösterilir |
| `ctx.speak` | `speak: true` | kanalı Dikkat Yöneticisi seçer (sessiz saat, toplantı, tam ekran); dakikada 3, 400 karakter |

Öz-sınamada dördü de gerçek etki üretmez: ayarlar varsayılanlardır (`setSetting`), dosyalar bellektedir, Jarvis araçları
kapalıdır (`mockTool`), sesli duyuru `effects` dizisine düşer. Eklenti sayfası konakta değil, ana pencerede güvenli
kutuda koşar (opak kökenli çerçeve + ağsız içerik politikası); kanıtı e2e senaryo 10 (köken `null`, üst pencereye ve
depolamaya erişim engelli).

## Ticari sürümden önce yapılacaklar

1. Konak sürecini işletim sistemi düzeyinde kısmak: Windows'ta AppContainer ya da düşük bütünlük düzeyi + iş nesnesi
   (dosya sistemi yok, ağ yok, alt süreç yok). Electron `utilityProcess` bunu vermiyor; Node'un izin modeli
   (`--permission`) ve `--experimental-vm-modules` bayrakları `utilityProcess` içinde **etkisiz** (ölçüldü, Electron 45).
2. `vm` yerine gerçek bir yalıtım: ayrı V8 izolatı ya da WebAssembly tabanlı çalışma zamanı; bellek ve işlemci kotası.
3. Onaydan sonra ilk gerçek istekle yanıt biçimini doğrulamak (öz-sınama artık ağa çıkmıyor; biçim hatası ilk canlı çağrıda görünür).
4. İzinli adreslere giden veriyi görünür kılmak (istek günlüğü, yetenek başına ağ dökümü).
5. Yeteneklerin imzalanması ve paylaşım için inceleme süreci; bağımsız güvenlik incelemesi.

## Yetenek sözleşmesi

Yetenek yazan modele verilen tam tarif ve çalışan örnek: `modules/workshop/prompt.ts`.
Öz-sınama, `index.mjs` + `selftest.mjs` dosyalarını geçici bir bağlamda koşturur; `ctx.notify`, `ctx.showCard`,
`ctx.remind` gerçek etki üretmez (`effects` dizisine düşer), `ctx.storage` geçicidir, `ctx.fetch` **kapalıdır**
(ana süreç reddeder); ağ davranışı `mockFetch(handler)` ile verilen örnek yanıtla sınanır.
