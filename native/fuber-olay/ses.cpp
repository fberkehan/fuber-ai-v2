// ── fuber-olay: ses çıkış aygıtı, ses düzeyi ve Bluetooth pil yüzdesi (0.14 T20) ──────────────────────────────────────────────────
// IMMNotificationClient: bir ses ÇIKIŞ aygıtı etkinleşince (bağlandı) ya da etkinlikten çıkınca (ayrıldı) {"t":"ses-aygiti"}. `tur`
// aygıtın biçim etkeninden: kulaklik (Headphones, Headset, Handset), hoparlor (Speakers), ekran (HDMI/DisplayPort sesi), diger.
// `ad` kısa addır: ekran sesinde ekranın adı, öbürlerinde aygıtın adı ("WH-1000XM4"); yoksa Windows'un tam adı.
// IAudioEndpointVolumeCallback: varsayılan çıkış aygıtının düzeyi ya da sessizliği değişince {"t":"ses"}; varsayılan aygıt değişince
// geri çağırma yeni aygıta taşınır (eski aygıttan geç gelen bildirim kuşak numarasıyla atılır).
// Bu geri çağırmalar ses hizmetinin iş parçacıklarında gelir: yalnız PostMessageW ile ana iş parçacığına bildirilir (ses hizmeti
// bekletilmez). Bağlanan aygıtın pil yüzdesi, aynı fiziksel aygıtın (kapsayıcı kimliği) Bluetooth düğümündeki pil özelliğinden
// DeviceInformation ile bağlanırken BİR KEZ okunur; WinRT tamamlanma işleyicisi sonucu yine ileti olarak döndürür (ana iş parçacığı
// beklemez) ve bağlanma olayı pille birlikte yazılır. {"k":"ses","duzey":x} varsayılan aygıtın ana düzeyini ayarlar.
#include "cikti.h"
#include <initguid.h>  // PKEY_* ve aygıt özellik anahtarları bu birimde tanımlansın
#include <objbase.h>
#include <mmdeviceapi.h>
#include <endpointvolume.h>
#include <functiondiscoverykeys_devpkey.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Devices.Enumeration.h>
#include <cmath>
#include <cstring>
#include <iterator>
#include <map>
#include <memory>
#include <vector>

namespace {

// Bluetooth pil özelliği: Bluetooth el serbest (HFP) aygıt düğümünde 0..100 (bayt).
constexpr wchar_t PIL_OZELLIGI[] = L"{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2";
constexpr wchar_t KAPSAYICI_OZELLIGI[] = L"System.Devices.ContainerId";
// Bilgisayarın kendi kapsayıcısı (dahili aygıtlar): pil sorulmaz.
constexpr GUID BILGISAYAR_KAPSAYICISI = {0x00000000, 0x0000, 0x0000, {0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}};

struct Aygit {
  std::wstring kimlik, ad, tur;
  bool bagli = false;
  int pil = -1;  // -1: bilinmiyor
};

IMMDeviceEnumerator* g_sirala = nullptr;
IAudioEndpointVolume* g_duzey = nullptr;
IAudioEndpointVolumeCallback* g_duzeyAlicisi = nullptr;
IMMNotificationClient* g_aygitAlicisi = nullptr;
UINT g_kusak = 0;  // düzey geri çağırmasının kuşağı

bool g_aygitVar = false;
Aygit g_aygit;                      // durum.sesAygiti: son değişen aygıt (açılışta varsayılan çıkış)
std::map<UINT, Aygit> g_bekleyen;   // pil sorgusu süren bağlanma olayları
UINT g_istekNo = 0;

bool g_sesVar = false;
int g_sesYuzde = 0;  // düzey × 100 (yazılan çözünürlük)
bool g_sessiz = false;

// ── COM alıcıları (ses hizmetinin iş parçacığında çağrılır; yalnız ileti bırakır) ───────────────────────────────────────────────
class DuzeyAlicisi final : public IAudioEndpointVolumeCallback {
 public:
  explicit DuzeyAlicisi(UINT kusak) : m_kusak(kusak) {}
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&m_ref); }
  ULONG STDMETHODCALLTYPE Release() override {
    const ULONG r = InterlockedDecrement(&m_ref);
    if (r == 0) delete this;
    return r;
  }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** p) override {
    if (!p) return E_POINTER;
    if (iid == __uuidof(IUnknown) || iid == __uuidof(IAudioEndpointVolumeCallback)) {
      *p = static_cast<IAudioEndpointVolumeCallback*>(this);
      AddRef();
      return S_OK;
    }
    *p = nullptr;
    return E_NOINTERFACE;
  }
  HRESULT STDMETHODCALLTYPE OnNotify(PAUDIO_VOLUME_NOTIFICATION_DATA v) override {
    if (v) {
      const auto duzey = static_cast<WPARAM>(std::lround(std::fmin(1.0f, std::fmax(0.0f, v->fMasterVolume)) * 10000.0f));
      PostMessageW(g_pencere, WM_OLAY_SES, duzey, static_cast<LPARAM>((m_kusak << 1) | (v->bMuted ? 1u : 0u)));
    }
    return S_OK;
  }

 private:
  LONG m_ref = 1;
  const UINT m_kusak;
};

class AygitAlicisi final : public IMMNotificationClient {
 public:
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&m_ref); }
  ULONG STDMETHODCALLTYPE Release() override {
    const ULONG r = InterlockedDecrement(&m_ref);
    if (r == 0) delete this;
    return r;
  }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** p) override {
    if (!p) return E_POINTER;
    if (iid == __uuidof(IUnknown) || iid == __uuidof(IMMNotificationClient)) {
      *p = static_cast<IMMNotificationClient*>(this);
      AddRef();
      return S_OK;
    }
    *p = nullptr;
    return E_NOINTERFACE;
  }
  HRESULT STDMETHODCALLTYPE OnDeviceStateChanged(LPCWSTR kimlik, DWORD durum) override {
    if (kimlik) {
      auto* k = new (std::nothrow) std::wstring(kimlik);
      if (k && !PostMessageW(g_pencere, WM_OLAY_AYGIT, durum, reinterpret_cast<LPARAM>(k))) delete k;
    }
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnDeviceAdded(LPCWSTR) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnDeviceRemoved(LPCWSTR) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE OnDefaultDeviceChanged(EDataFlow akis, ERole rol, LPCWSTR) override {
    if (akis == eRender && rol == eConsole) PostMessageW(g_pencere, WM_OLAY_VARSAYILAN, 0, 0);
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE OnPropertyValueChanged(LPCWSTR, const PROPERTYKEY) override { return S_OK; }

 private:
  LONG m_ref = 1;
};

// ── Aygıt bilgisi ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const wchar_t* turAdi(UINT bicim) {
  switch (bicim) {
    case Headphones:
    case Headset:
    case Handset:
      return L"kulaklik";
    case Speakers:
      return L"hoparlor";
    case DigitalAudioDisplayDevice:
      return L"ekran";
    default:
      return L"diger";
  }
}

std::wstring ozellikMetni(IPropertyStore* o, const PROPERTYKEY& anahtar) {
  PROPVARIANT v;
  PropVariantInit(&v);
  std::wstring r;
  if (SUCCEEDED(o->GetValue(anahtar, &v)) && v.vt == VT_LPWSTR && v.pwszVal) r = v.pwszVal;
  PropVariantClear(&v);
  return r;
}

/** Çıkış (render) aygıtıysa kimliği, adı ve türü; giriş aygıtı ya da okunamazsa false. */
bool aygitBilgisi(IMMDevice* a, Aygit& b) {
  IMMEndpoint* uc = nullptr;
  EDataFlow akis = eCapture;
  if (FAILED(a->QueryInterface(IID_PPV_ARGS(&uc)))) return false;
  const bool cikis = SUCCEEDED(uc->GetDataFlow(&akis)) && akis == eRender;
  uc->Release();
  if (!cikis) return false;
  IPropertyStore* o = nullptr;
  if (FAILED(a->OpenPropertyStore(STGM_READ, &o))) return false;
  PROPVARIANT v;
  PropVariantInit(&v);
  UINT bicim = UnknownFormFactor;
  if (SUCCEEDED(o->GetValue(PKEY_AudioEndpoint_FormFactor, &v)) && v.vt == VT_UI4) bicim = v.ulVal;
  PropVariantClear(&v);
  b.tur = turAdi(bicim);
  b.ad = ozellikMetni(o, bicim == DigitalAudioDisplayDevice ? PKEY_Device_DeviceDesc : PKEY_DeviceInterface_FriendlyName);
  if (b.ad.empty()) b.ad = ozellikMetni(o, PKEY_Device_FriendlyName);
  o->Release();
  LPWSTR kimlik = nullptr;
  if (SUCCEEDED(a->GetId(&kimlik)) && kimlik) {
    b.kimlik = kimlik;
    CoTaskMemFree(kimlik);
  }
  return !b.ad.empty() && !b.kimlik.empty();
}

/**
 * Bağlanan aygıtın pil yüzdesi, bir kez: ses arayüzünün kapsayıcı kimliği → aynı kapsayıcıdaki aygıt düğümlerinde Bluetooth pil özelliği.
 * İki WinRT işlemi zincirlenir; tamamlanma işleyicileri iş parçacığı havuzunda çalışır ve sonucu (0..100 ya da -1) iletiyle döndürür.
 */
void pilSor(const std::wstring& kimlik, UINT istek) {
  namespace E = winrt::Windows::Devices::Enumeration;
  using winrt::Windows::Foundation::AsyncStatus;
  const HWND hedef = g_pencere;
  const auto bitir = [hedef, istek](int pil) { PostMessageW(hedef, WM_OLAY_PIL, istek, static_cast<LPARAM>(pil)); };
  try {
    // MMDevice kimliği → ses çıkışı aygıt arayüzü yolu (KSCATEGORY_AUDIO render arayüz sınıfı).
    const std::wstring arayuz = L"\\\\?\\SWD#MMDEVAPI#" + kimlik + L"#{e6327cad-dcec-4949-ae8a-991e976a79d2}";
    E::DeviceInformation::CreateFromIdAsync(arayuz, std::vector<winrt::hstring>{KAPSAYICI_OZELLIGI})
        .Completed([bitir](auto const& islem, AsyncStatus durum) {
          try {
            if (durum != AsyncStatus::Completed) return bitir(-1);
            const winrt::guid g = winrt::unbox_value_or<winrt::guid>(islem.GetResults().Properties().TryLookup(KAPSAYICI_OZELLIGI), winrt::guid{});
            GUID kap{};
            static_assert(sizeof kap == sizeof g, "GUID boyutu");
            std::memcpy(&kap, &g, sizeof kap);
            wchar_t metin[40]{};
            if (IsEqualGUID(kap, GUID{}) || IsEqualGUID(kap, BILGISAYAR_KAPSAYICISI) || !StringFromGUID2(kap, metin, 40)) return bitir(-1);
            const std::wstring sorgu = std::wstring(L"System.Devices.ContainerId:=\"") + metin + L"\"";
            E::DeviceInformation::FindAllAsync(sorgu, std::vector<winrt::hstring>{PIL_OZELLIGI}, E::DeviceInformationKind::Device)
                .Completed([bitir](auto const& liste, AsyncStatus durum2) {
                  int pil = -1;
                  try {
                    if (durum2 == AsyncStatus::Completed) {
                      for (auto const& d : liste.GetResults()) {
                        const int p = winrt::unbox_value_or<uint8_t>(d.Properties().TryLookup(PIL_OZELLIGI), uint8_t{255});
                        if (p <= 100) {
                          pil = p;
                          break;
                        }
                      }
                    }
                  } catch (...) {
                    pil = -1;
                  }
                  bitir(pil);
                });
          } catch (...) {
            bitir(-1);
          }
        });
  } catch (...) {
    bitir(-1);
  }
}

// ── Ana iş parçacığı ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
void aygitYaz(const Aygit& a) {
  Olay o("ses-aygiti");
  o.metin("ad", a.ad);
  o.metin("tur", a.tur);
  o.mantik("bagli", a.bagli);
  if (a.pil >= 0) o.tamsayi("pil", a.pil);
  else o.bos("pil");
  o.yaz();
}

void sesGuncelle(double duzey, bool sessiz, bool yaz) {
  const int y = static_cast<int>(std::lround(std::fmin(1.0, std::fmax(0.0, duzey)) * 100.0));
  if (g_sesVar && y == g_sesYuzde && sessiz == g_sessiz) return;
  g_sesVar = true;
  g_sesYuzde = y;
  g_sessiz = sessiz;
  if (!yaz) return;
  Olay o("ses");
  o.sayi("duzey", y / 100.0, 2);
  o.mantik("sessiz", sessiz);
  o.yaz();
}

/** Düzey geri çağırmasını `a` aygıtına taşır (a null: aygıt yok, ses bilinmiyor). */
void duzeyBagla(IMMDevice* a, bool yaz) {
  if (g_duzey) {
    if (g_duzeyAlicisi) g_duzey->UnregisterControlChangeNotify(g_duzeyAlicisi);
    g_duzey->Release();
    g_duzey = nullptr;
  }
  if (g_duzeyAlicisi) {
    g_duzeyAlicisi->Release();
    g_duzeyAlicisi = nullptr;
  }
  ++g_kusak;
  if (!a || FAILED(a->Activate(__uuidof(IAudioEndpointVolume), CLSCTX_INPROC_SERVER, nullptr, reinterpret_cast<void**>(&g_duzey)))) {
    g_duzey = nullptr;
    g_sesVar = false;
    return;
  }
  g_duzeyAlicisi = new DuzeyAlicisi(g_kusak);
  if (FAILED(g_duzey->RegisterControlChangeNotify(g_duzeyAlicisi))) {
    g_duzeyAlicisi->Release();
    g_duzeyAlicisi = nullptr;
  }
  float d = 0;
  BOOL s = FALSE;
  if (SUCCEEDED(g_duzey->GetMasterVolumeLevelScalar(&d)) && SUCCEEDED(g_duzey->GetMute(&s))) sesGuncelle(d, s != FALSE, yaz);
}

void varsayilanaBagla(bool yaz) {
  IMMDevice* a = nullptr;
  if (g_sirala && SUCCEEDED(g_sirala->GetDefaultAudioEndpoint(eRender, eConsole, &a))) {
    duzeyBagla(a, yaz);
    a->Release();
  } else {
    duzeyBagla(nullptr, yaz);
  }
}

void aygitDegisti(const std::wstring& kimlik, DWORD durum) {
  IMMDevice* a = nullptr;
  if (!g_sirala || FAILED(g_sirala->GetDevice(kimlik.c_str(), &a))) return;
  Aygit b;
  const bool cikis = aygitBilgisi(a, b);
  a->Release();
  if (!cikis) return;
  b.bagli = durum == DEVICE_STATE_ACTIVE;
  // Ayrılan aygıtın süren pil sorgusu düşer (geç gelen "bağlandı" ayrıldıktan sonra yazılmaz).
  if (!b.bagli)
    for (auto i = g_bekleyen.begin(); i != g_bekleyen.end();) i = i->second.kimlik == b.kimlik ? g_bekleyen.erase(i) : std::next(i);
  // Aynı hâl tekrar yazılmaz (ör. bir Bluetooth kulaklığın iki çıkış uç noktası ya da yinelenen bildirim).
  if (g_aygitVar && g_aygit.ad == b.ad && g_aygit.tur == b.tur && g_aygit.bagli == b.bagli) return;
  g_aygit = b;
  g_aygitVar = true;
  if (b.bagli) {
    const UINT n = ++g_istekNo;
    g_bekleyen[n] = b;
    pilSor(b.kimlik, n);  // olay pil sonucu gelince yazılır
  } else {
    aygitYaz(b);
  }
}

void pilSonucu(UINT istek, int pil) {
  const auto i = g_bekleyen.find(istek);
  if (i == g_bekleyen.end()) return;
  Aygit b = i->second;
  g_bekleyen.erase(i);
  b.pil = pil >= 0 && pil <= 100 ? pil : -1;
  if (g_aygitVar && g_aygit.kimlik == b.kimlik) g_aygit.pil = b.pil;
  aygitYaz(b);
}

}  // namespace

std::wstring sesKur() {
  if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&g_sirala)))) {
    g_sirala = nullptr;
    return L"Ses olayları alınamadı";
  }
  g_aygitAlicisi = new AygitAlicisi();
  if (FAILED(g_sirala->RegisterEndpointNotificationCallback(g_aygitAlicisi))) {
    g_aygitAlicisi->Release();
    g_aygitAlicisi = nullptr;
  }
  IMMDevice* a = nullptr;
  if (SUCCEEDED(g_sirala->GetDefaultAudioEndpoint(eRender, eConsole, &a))) {
    Aygit b;
    if (aygitBilgisi(a, b)) {
      b.bagli = true;
      g_aygit = b;
      g_aygitVar = true;
    }
    duzeyBagla(a, false);
    a->Release();
  }
  return g_aygitAlicisi ? std::wstring() : L"Ses aygıtı olayları alınamadı";
}

void sesIleti(UINT ileti, WPARAM w, LPARAM l) {
  switch (ileti) {
    case WM_OLAY_SES:
      if (static_cast<UINT>(static_cast<ULONG_PTR>(l) >> 1) == g_kusak) sesGuncelle(static_cast<double>(w) / 10000.0, (l & 1) != 0, true);
      break;
    case WM_OLAY_AYGIT: {
      std::unique_ptr<std::wstring> kimlik(reinterpret_cast<std::wstring*>(l));
      if (kimlik) aygitDegisti(*kimlik, static_cast<DWORD>(w));
      break;
    }
    case WM_OLAY_VARSAYILAN:
      varsayilanaBagla(true);
      break;
    case WM_OLAY_PIL:
      pilSonucu(static_cast<UINT>(w), static_cast<int>(l));
      break;
    default:
      break;
  }
}

void sesAyarla(double duzey) {
  if (!g_duzey) {
    hataYaz(L"Ses çıkış aygıtı yok");
    return;
  }
  const float d = static_cast<float>(std::fmin(1.0, std::fmax(0.0, duzey)));
  if (FAILED(g_duzey->SetMasterVolumeLevelScalar(d, nullptr))) hataYaz(L"Ses düzeyi ayarlanamadı");
}

std::string sesJson() {
  if (!g_sesVar) return "null";
  JsonNesne j;
  j.sayi("duzey", g_sesYuzde / 100.0, 2);
  j.mantik("sessiz", g_sessiz);
  return j.bitir();
}

std::string sesAygitiJson() {
  if (!g_aygitVar) return "null";
  JsonNesne j;
  j.metin("ad", g_aygit.ad);
  j.metin("tur", g_aygit.tur);
  j.mantik("bagli", g_aygit.bagli);
  if (g_aygit.pil >= 0) j.tamsayi("pil", g_aygit.pil);
  else j.bos("pil");
  return j.bitir();
}

void sesKapat() {
  duzeyBagla(nullptr, false);
  if (g_sirala && g_aygitAlicisi) g_sirala->UnregisterEndpointNotificationCallback(g_aygitAlicisi);
  if (g_aygitAlicisi) g_aygitAlicisi->Release();
  if (g_sirala) g_sirala->Release();
  g_aygitAlicisi = nullptr;
  g_sirala = nullptr;
}
