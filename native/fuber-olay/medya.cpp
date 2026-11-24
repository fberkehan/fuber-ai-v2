// ── fuber-olay: medya oturumu — ne çalıyor; oynat, duraklat, ileri, geri, konum (0.14 T21) ──────────────────────────────────────────
// Windows'un sistem medya oturumu (GlobalSystemMediaTransportControls; Spotify, tarayıcı, mağaza uygulamaları …). Oturum yöneticisi
// açılışta tamamlanma işleyicisiyle istenir (ana iş parçacığı beklemez); gelince dört olaya abone olunur: CurrentSessionChanged
// (yöneticide), MediaPropertiesChanged, PlaybackInfoChanged, TimelinePropertiesChanged (geçerli oturumda). Olay işleyicileri iş
// parçacığı havuzunda gelir ve yalnız PostMessageW ile ana iş parçacığına haber verir; hâl ve çıktı ana iş parçacığındadır. Oturum
// değişince eski oturumun belirteçleri bırakılır, kuşak numarası artar ve eski oturumdan geç gelen iletiler atılır. Oturum listesi
// taranmaz, yoklama yok.
// Çıktı {"t":"medya","var":true,…} ya da {"t":"medya","var":false}. Konum her saniye yazılmaz: konum, ölçüldüğü anla (`konumZamani`)
// birlikte gider, ana süreç anlık konumu kendisi hesaplar (src/shared/sistem-olay.ts `medyaKonumu`); satır yalnız var/yok, parça,
// uygulama, çalma durumu, hız, süre ya da kapak değişince, ya da konum bu hesaptan 0,5 sn kayınca yazılır.
// Kapak: özelliklerdeki akış tamamlanma işleyicileriyle açılır ve okunur; 256 KB'ı aşan, ya da JPEG/PNG olmayan kapak null.
// Komutlar ({"k":"medya","eylem":…}) yalnız geçerli oturumun beş yöntemine gider: oynat, duraklat, sonraki parça, önceki parça,
// konuma git. Tuş taklidi ya da uygulama komutu yok; sonuç tamamlanma işleyicisiyle döner, reddedilirse `hata` satırı.
#include "cikti.h"
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Media.Control.h>
#include <winrt/Windows.Storage.Streams.h>
#include <cmath>
#include <cstdint>
#include <memory>
#include <vector>

namespace {

namespace MC = winrt::Windows::Media::Control;
namespace SS = winrt::Windows::Storage::Streams;
using winrt::Windows::Foundation::AsyncStatus;
using Yonetici = MC::GlobalSystemMediaTransportControlsSessionManager;
using Oturum = MC::GlobalSystemMediaTransportControlsSession;
using OynatmaDurumu = MC::GlobalSystemMediaTransportControlsSessionPlaybackStatus;

/** Kapağın ham bayt sınırı (protokolde KAPAK_SINIRI, src/shared/sistem-olay.ts). */
constexpr uint64_t KAPAK_SINIRI = 256 * 1024;
/** Protokoldeki eylem listesi (MEDYA_EYLEMLERI) ile aynı sırada. */
constexpr const char* EYLEMLER[] = {"oynat", "duraklat", "ileri", "geri", "konum"};
/** Konum kayması bu eşiği aşınca yeniden yazılır (sn). */
constexpr double KAYMA_ESIGI = 0.5;

// WM_OLAY_MEDYA iletisinin türleri (wParam).
enum : WPARAM {
  M_YONETICI = 1,     // lParam: YoneticiKutusu* (alan siler; boşsa kurulamadı)
  M_OTURUM,           // geçerli oturum değişti
  M_OYNATMA,          // çalma durumu ya da zaman çizelgesi değişti; lParam: kuşak
  M_OZELLIK_DEGISTI,  // parça bilgisi değişti; lParam: kuşak
  M_OZELLIK,          // parça bilgisi okundu; lParam: Ozellikler* (alan siler)
  M_KAPAK,            // kapak okundu; lParam: Kapak* (alan siler)
  M_KOMUT,            // komut sonucu; lParam: 1 uygulandı, 0 uygulanmadı
};

/** WinRT nesnesi doğrudan `new` ile kurulamaz: iletiyle taşımak için kutu. */
struct YoneticiKutusu {
  Yonetici yonetici{nullptr};
};

struct Ozellikler {
  LPARAM kusak = 0;
  bool tamam = false;
  std::wstring baslik, sanatci, album;
  SS::IRandomAccessStreamReference kapak{nullptr};
};

struct Kapak {
  unsigned no = 0;
  std::string url;  // boş: kapak yok
};

struct Hal {
  bool var = false;
  std::wstring uygulama, baslik, sanatci, album;
  double sure = 0, konum = 0, hiz = 1;
  long long konumZamani = 0;
  bool caliyor = false;
  std::string kapak;  // data URL; boş: null
};

Yonetici g_yonetici{nullptr};
Oturum g_oturum{nullptr};
winrt::event_token g_oturumBelirteci{}, g_ozellikBelirteci{}, g_oynatmaBelirteci{}, g_zamanBelirteci{};
LPARAM g_kusak = 0;      // oturum kuşağı: eski oturumdan geç gelen ileti atılır
unsigned g_kapakNo = 0;  // son kapak isteği: eskisi atılır
Hal g_guncel;            // son okunan
Hal g_hal;               // son yazılan (durum.medya)
bool g_bilinen = false;  // en az bir kez yazıldı mı (öncesinde durum.medya null)

bool eylemMi(const std::string& eylem) {
  for (const char* a : EYLEMLER)
    if (eylem == a) return true;
  return false;
}

/** Saniye → zaman çizelgesi adımı (100 ns); NaN ve negatif 0, en çok 10 gün. Yalnız aritmetik. */
int64_t konumAdimi(double sn) {
  if (!(sn > 0)) return 0;
  return std::llround(std::fmin(sn, 864000.0) * 10000000.0);
}

double saniye(winrt::Windows::Foundation::TimeSpan t) { return static_cast<double>(t.count()) / 10000000.0; }

/** WinRT anı (1601'den 100 ns) → Unix ms; uygulama anı vermediyse şimdi. */
long long unixMs(winrt::Windows::Foundation::DateTime t) {
  constexpr long long FARK = 116444736000000000LL;
  long long adim = t.time_since_epoch().count();
  if (adim <= FARK) {
    FILETIME f;
    GetSystemTimeAsFileTime(&f);
    adim = (static_cast<long long>(f.dwHighDateTime) << 32) | f.dwLowDateTime;
  }
  return (adim - FARK) / 10000;
}

/** `medyaKonumu` (sistem-olay.ts) ile aynı hesap: `zaman` anındaki beklenen konum. */
double tahmin(const Hal& h, long long zaman) {
  const double gecen = h.caliyor && zaman > h.konumZamani ? static_cast<double>(zaman - h.konumZamani) / 1000.0 * h.hiz : 0.0;
  return std::fmin(h.sure, std::fmax(0.0, h.konum + gecen));
}

bool onemliFark(const Hal& a, const Hal& b) {
  if (a.var != b.var) return true;
  if (!b.var) return false;
  if (a.uygulama != b.uygulama || a.baslik != b.baslik || a.sanatci != b.sanatci || a.album != b.album) return true;
  if (a.caliyor != b.caliyor || std::fabs(a.hiz - b.hiz) > 1e-6 || std::fabs(a.sure - b.sure) > 0.05) return true;
  if (a.kapak != b.kapak) return true;
  return std::fabs(tahmin(a, b.konumZamani) - b.konum) > KAYMA_ESIGI;
}

/** Olayın ve durum.medya'nın ortak gövdesi. Kullanıcı dizeleri metin() ile (kaçışlı, 256 karakterle sınırlı). */
void alanlar(JsonNesne& j) {
  j.mantik("var", g_hal.var);
  if (!g_hal.var) return;
  j.metin("uygulama", g_hal.uygulama);
  j.metin("baslik", g_hal.baslik);
  j.metin("sanatci", g_hal.sanatci);
  j.metin("album", g_hal.album);
  j.sayi("sure", g_hal.sure, 3);
  j.sayi("konum", g_hal.konum, 3);
  j.tamsayi("konumZamani", g_hal.konumZamani);
  j.mantik("caliyor", g_hal.caliyor);
  j.sayi("hiz", g_hal.hiz, 3);
  // Kapak yalnız bizim kurduğumuz "data:image/…;base64," öneki ve base64 alfabesi: kaçış gerekmez.
  if (g_hal.kapak.empty()) j.bos("kapak");
  else j.ham("kapak", "\"" + g_hal.kapak + "\"");
}

/** Son okunan hâl, yazılandan önemli ölçüde farklıysa (ya da ilk kez) `medya` satırı. */
void yayinla() {
  if (g_bilinen && !onemliFark(g_hal, g_guncel)) return;
  g_hal = g_guncel;
  g_bilinen = true;
  Olay o("medya");
  alanlar(o);
  o.yaz();
}

std::string base64(const std::vector<uint8_t>& b) {
  static const char ALFABE[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string r;
  r.reserve((b.size() + 2) / 3 * 4);
  size_t i = 0;
  for (; i + 2 < b.size(); i += 3) {
    const uint32_t v = (static_cast<uint32_t>(b[i]) << 16) | (static_cast<uint32_t>(b[i + 1]) << 8) | b[i + 2];
    r += ALFABE[(v >> 18) & 63];
    r += ALFABE[(v >> 12) & 63];
    r += ALFABE[(v >> 6) & 63];
    r += ALFABE[v & 63];
  }
  if (i < b.size()) {
    const bool iki = i + 1 < b.size();
    const uint32_t v = (static_cast<uint32_t>(b[i]) << 16) | (iki ? static_cast<uint32_t>(b[i + 1]) << 8 : 0);
    r += ALFABE[(v >> 18) & 63];
    r += ALFABE[(v >> 12) & 63];
    r += iki ? ALFABE[(v >> 6) & 63] : '=';
    r += '=';
  }
  return r;
}

/** Baytların imzasına göre JPEG ya da PNG data URL; başka biçim (ya da boş) için boş dize. */
std::string kapakUrl(const std::vector<uint8_t>& b) {
  if (b.size() >= 8 && b[0] == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return "data:image/png;base64," + base64(b);
  if (b.size() >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "data:image/jpeg;base64," + base64(b);
  return {};
}

void kapakBitir(unsigned no, std::string url) {
  auto* k = new Kapak;
  k->no = no;
  k->url = std::move(url);
  if (!PostMessageW(g_pencere, WM_OLAY_MEDYA, M_KAPAK, reinterpret_cast<LPARAM>(k))) delete k;
}

/** Kapak akışı açılır ve okunur; iki adım da tamamlanma işleyicisiyle (ana iş parçacığı beklemez). */
void kapakOku(const SS::IRandomAccessStreamReference& kaynak) {
  const unsigned no = ++g_kapakNo;
  try {
    kaynak.OpenReadAsync().Completed([no](auto const& acma, AsyncStatus durum) {
      try {
        if (durum != AsyncStatus::Completed) return kapakBitir(no, {});
        const SS::IRandomAccessStreamWithContentType akis = acma.GetResults();
        const uint64_t boy = akis ? akis.Size() : 0;
        if (boy == 0 || boy > KAPAK_SINIRI) return kapakBitir(no, {});  // sınırı aşan kapak okunmaz
        const uint32_t istenen = static_cast<uint32_t>(boy);
        SS::Buffer tampon(istenen);
        akis.ReadAsync(tampon, istenen, SS::InputStreamOptions::None).Completed([no, akis, istenen](auto const& okuma, AsyncStatus durum2) {
          std::string url;
          try {
            if (durum2 == AsyncStatus::Completed) {
              const SS::IBuffer b = okuma.GetResults();
              if (b && b.Length() == istenen) {
                std::vector<uint8_t> bayt(b.Length());
                SS::DataReader::FromBuffer(b).ReadBytes(bayt);
                url = kapakUrl(bayt);
              }
            }
          } catch (...) {
            url.clear();
          }
          kapakBitir(no, std::move(url));
        });
      } catch (...) {
        kapakBitir(no, {});
      }
    });
  } catch (...) {
  }
}

/** Geçerli oturumun parça bilgisi istenir; sonuç M_OZELLIK iletisiyle döner. */
void ozellikIste() {
  if (!g_oturum) return;
  const LPARAM kusak = g_kusak;
  try {
    g_oturum.TryGetMediaPropertiesAsync().Completed([kusak](auto const& islem, AsyncStatus durum) {
      auto* o = new Ozellikler;
      o->kusak = kusak;
      try {
        if (durum == AsyncStatus::Completed) {
          if (const auto p = islem.GetResults()) {
            o->baslik = std::wstring(p.Title());
            o->sanatci = std::wstring(p.Artist());
            o->album = std::wstring(p.AlbumTitle());
            o->kapak = p.Thumbnail();
            o->tamam = true;
          }
        }
      } catch (...) {
        o->tamam = false;
      }
      if (!PostMessageW(g_pencere, WM_OLAY_MEDYA, M_OZELLIK, reinterpret_cast<LPARAM>(o))) delete o;
    });
  } catch (...) {
  }
}

/** Çalma durumu, hız ve zaman çizelgesi (eşzamanlı özellik okumaları) g_guncel'e. */
void oynatmaOku() {
  if (!g_oturum) return;
  try {
    const auto zc = g_oturum.GetTimelineProperties();
    const double bas = saniye(zc.StartTime()), son = saniye(zc.EndTime()), konum = saniye(zc.Position());
    g_guncel.sure = std::isfinite(son - bas) ? std::fmax(0.0, son - bas) : 0.0;
    g_guncel.konum = std::isfinite(konum - bas) ? std::fmax(0.0, konum - bas) : 0.0;
    g_guncel.konumZamani = unixMs(zc.LastUpdatedTime());
  } catch (...) {
    g_guncel.sure = 0;
    g_guncel.konum = 0;
    g_guncel.konumZamani = unixMs({});
  }
  try {
    const auto bilgi = g_oturum.GetPlaybackInfo();
    g_guncel.caliyor = bilgi.PlaybackStatus() == OynatmaDurumu::Playing;
    const auto hiz = bilgi.PlaybackRate();
    const double h = hiz ? hiz.Value() : 1.0;
    g_guncel.hiz = std::isfinite(h) ? h : 1.0;
  } catch (...) {
    g_guncel.caliyor = false;
    g_guncel.hiz = 1;
  }
}

/** Geçerli oturumun üç olay belirteci bırakılır. */
void oturumBirak() {
  if (g_oturum) {
    try { g_oturum.MediaPropertiesChanged(g_ozellikBelirteci); } catch (...) {}
    try { g_oturum.PlaybackInfoChanged(g_oynatmaBelirteci); } catch (...) {}
    try { g_oturum.TimelinePropertiesChanged(g_zamanBelirteci); } catch (...) {}
  }
  g_oturum = nullptr;
  g_ozellikBelirteci = {};
  g_oynatmaBelirteci = {};
  g_zamanBelirteci = {};
}

/** Yeni geçerli oturuma geçilir (boşsa çalan yok); eski belirteçler önce bırakılır. */
void oturumBagla(const Oturum& oturum) {
  oturumBirak();
  ++g_kusak;
  ++g_kapakNo;
  g_guncel = Hal{};
  g_oturum = oturum;
  if (g_oturum) {
    const LPARAM kusak = g_kusak;
    try {
      g_guncel.var = true;
      g_guncel.uygulama = std::wstring(g_oturum.SourceAppUserModelId());
      g_ozellikBelirteci = g_oturum.MediaPropertiesChanged([kusak](auto&&, auto&&) {
        PostMessageW(g_pencere, WM_OLAY_MEDYA, M_OZELLIK_DEGISTI, kusak);
      });
      g_oynatmaBelirteci = g_oturum.PlaybackInfoChanged([kusak](auto&&, auto&&) {
        PostMessageW(g_pencere, WM_OLAY_MEDYA, M_OYNATMA, kusak);
      });
      g_zamanBelirteci = g_oturum.TimelinePropertiesChanged([kusak](auto&&, auto&&) {
        PostMessageW(g_pencere, WM_OLAY_MEDYA, M_OYNATMA, kusak);
      });
      oynatmaOku();
      ozellikIste();
    } catch (...) {
      oturumBirak();  // oturum bu arada kapandı: çalan yok sayılır
      g_guncel = Hal{};
    }
  }
  yayinla();
}

void yoneticiGeldi(std::unique_ptr<YoneticiKutusu> kutu) {
  if (!kutu || !kutu->yonetici) {
    hataYaz(L"Medya oturumu dinlenemiyor");
    return;
  }
  g_yonetici = kutu->yonetici;
  try {
    g_oturumBelirteci = g_yonetici.CurrentSessionChanged([](auto&&, auto&&) {
      PostMessageW(g_pencere, WM_OLAY_MEDYA, M_OTURUM, 0);
    });
    oturumBagla(g_yonetici.GetCurrentSession());
  } catch (...) {
    hataYaz(L"Medya oturumu dinlenemiyor");
  }
}

}  // namespace

std::wstring medyaKur() {
  try {
    Yonetici::RequestAsync().Completed([](auto const& islem, AsyncStatus durum) {
      auto* kutu = new YoneticiKutusu;
      try {
        if (durum == AsyncStatus::Completed) kutu->yonetici = islem.GetResults();
      } catch (...) {
        kutu->yonetici = nullptr;
      }
      if (!PostMessageW(g_pencere, WM_OLAY_MEDYA, M_YONETICI, reinterpret_cast<LPARAM>(kutu))) delete kutu;
    });
  } catch (...) {
    return L"Medya oturumu dinlenemiyor";
  }
  return {};
}

void medyaIleti(WPARAM tur, LPARAM veri) {
  switch (tur) {
    case M_YONETICI:
      yoneticiGeldi(std::unique_ptr<YoneticiKutusu>(reinterpret_cast<YoneticiKutusu*>(veri)));
      return;
    case M_OTURUM:
      if (!g_yonetici) return;
      try {
        oturumBagla(g_yonetici.GetCurrentSession());
      } catch (...) {
        oturumBagla(Oturum{nullptr});
      }
      return;
    case M_OYNATMA:
      if (veri != g_kusak || !g_oturum) return;
      oynatmaOku();
      yayinla();
      return;
    case M_OZELLIK_DEGISTI:
      if (veri == g_kusak) ozellikIste();
      return;
    case M_OZELLIK: {
      std::unique_ptr<Ozellikler> o(reinterpret_cast<Ozellikler*>(veri));
      if (!o || o->kusak != g_kusak || !g_oturum || !o->tamam) return;
      const bool parcaDegisti = o->baslik != g_guncel.baslik || o->sanatci != g_guncel.sanatci || o->album != g_guncel.album;
      g_guncel.baslik = o->baslik;
      g_guncel.sanatci = o->sanatci;
      g_guncel.album = o->album;
      if (parcaDegisti) {
        g_guncel.kapak.clear();  // eski parçanın kapağı yeni parçada görünmez
        ++g_kapakNo;
      }
      // Bazı uygulamalar parça değişince önce eski kapağı verir: her özellik olayında kapak yeniden okunur (aynıysa satır çıkmaz).
      if (o->kapak) kapakOku(o->kapak);
      yayinla();
      return;
    }
    case M_KAPAK: {
      std::unique_ptr<Kapak> k(reinterpret_cast<Kapak*>(veri));
      if (!k || k->no != g_kapakNo || !g_oturum) return;
      g_guncel.kapak = k->url;
      yayinla();
      return;
    }
    case M_KOMUT:
      if (veri == 0) hataYaz(L"Medya uygulaması komutu uygulamadı");
      return;
    default:
      return;
  }
}

/**
 * Stdin komutu: her eylem geçerli oturumun TEK yöntemine gider. Sonuç tamamlanma işleyicisinden iletiyle döner (beklenmez).
 * Kaynak taraması bu gövdedeki çağrıları izin listesiyle denetler (tests/olay-yardimcisi-kaynak.test.ts).
 */
void medyaKomutu(const std::string& eylem, bool snVar, double sn) {
  if (!eylemMi(eylem)) {
    hataYaz(L"Bilinmeyen medya eylemi");
    return;
  }
  if (eylem == "konum" && !snVar) {
    hataYaz(L"konum eyleminde sn sayı olmalı");
    return;
  }
  if (!g_oturum) {
    hataYaz(L"Çalan medya oturumu yok");
    return;
  }
  winrt::Windows::Foundation::IAsyncOperation<bool> islem{nullptr};
  try {
    if (eylem == "oynat") islem = g_oturum.TryPlayAsync();
    else if (eylem == "duraklat") islem = g_oturum.TryPauseAsync();
    else if (eylem == "ileri") islem = g_oturum.TrySkipNextAsync();
    else if (eylem == "geri") islem = g_oturum.TrySkipPreviousAsync();
    else if (eylem == "konum") islem = g_oturum.TryChangePlaybackPositionAsync(konumAdimi(sn));
    if (!islem) return;
    islem.Completed([](auto const& i, AsyncStatus durum) {
      bool tamam = false;
      try {
        tamam = durum == AsyncStatus::Completed && i.GetResults();
      } catch (...) {
        tamam = false;
      }
      PostMessageW(g_pencere, WM_OLAY_MEDYA, M_KOMUT, tamam ? 1 : 0);
    });
  } catch (...) {
    hataYaz(L"Medya komutu gönderilemedi");
  }
}

std::string medyaJson() {
  if (!g_bilinen) return "null";
  JsonNesne j;
  alanlar(j);
  return j.bitir();
}

void medyaKapat() {
  oturumBirak();
  if (g_yonetici) {
    try { g_yonetici.CurrentSessionChanged(g_oturumBelirteci); } catch (...) {}
  }
  g_yonetici = nullptr;
  g_oturumBelirteci = {};
}
