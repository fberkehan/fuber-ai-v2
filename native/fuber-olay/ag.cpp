// ── fuber-olay: internet bağlantısı (0.14 T20) ───────────────────────────────────────────────────────────────────────────────────
// Ağ Listesi Yöneticisi (INetworkListManager) bağlantı noktasına INetworkListManagerEvents alıcısı bağlanır; ConnectivityChanged
// geldikçe {"t":"ag","bagli":…} yalnız değer değişince yazılır. `bagli`: IPv4 ya da IPv6 internet bağlanırlığı (Windows'un görev
// çubuğundaki ağ simgesiyle aynı ölçü). Yardımcı hiçbir ağ isteği yapmaz; yalnız Windows'un kendi bağlanırlık bildirimini dinler.
#include "cikti.h"
#include <objbase.h>
#include <ocidl.h>
#include <netlistmgr.h>

namespace {

INetworkListManager* g_nlm = nullptr;
IConnectionPoint* g_nokta = nullptr;
DWORD g_cerez = 0;
int g_bagli = -1;  // -1: bilinmiyor

bool internetVar(NLM_CONNECTIVITY c) { return (c & (NLM_CONNECTIVITY_IPV4_INTERNET | NLM_CONNECTIVITY_IPV6_INTERNET)) != 0; }

/** STA'da bildirim zaten ana iş parçacığında gelir; yine de yalnız iletiye çevrilir (tek hâl güncelleme yolu). */
class AgAlicisi final : public INetworkListManagerEvents {
 public:
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&m_ref); }
  ULONG STDMETHODCALLTYPE Release() override {
    const ULONG r = InterlockedDecrement(&m_ref);
    if (r == 0) delete this;
    return r;
  }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** p) override {
    if (!p) return E_POINTER;
    if (iid == __uuidof(IUnknown) || iid == __uuidof(INetworkListManagerEvents)) {
      *p = static_cast<INetworkListManagerEvents*>(this);
      AddRef();
      return S_OK;
    }
    *p = nullptr;
    return E_NOINTERFACE;
  }
  HRESULT STDMETHODCALLTYPE ConnectivityChanged(NLM_CONNECTIVITY c) override {
    PostMessageW(g_pencere, WM_OLAY_AG, static_cast<WPARAM>(c), 0);
    return S_OK;
  }

 private:
  LONG m_ref = 1;
};

}  // namespace

std::wstring agKur() {
  if (FAILED(CoCreateInstance(__uuidof(NetworkListManager), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&g_nlm)))) {
    g_nlm = nullptr;
    return L"Ağ olayları alınamadı";
  }
  NLM_CONNECTIVITY c = NLM_CONNECTIVITY_DISCONNECTED;
  if (SUCCEEDED(g_nlm->GetConnectivity(&c))) g_bagli = internetVar(c) ? 1 : 0;
  IConnectionPointContainer* kap = nullptr;
  if (SUCCEEDED(g_nlm->QueryInterface(IID_PPV_ARGS(&kap)))) {
    if (SUCCEEDED(kap->FindConnectionPoint(__uuidof(INetworkListManagerEvents), &g_nokta))) {
      AgAlicisi* alici = new AgAlicisi();
      if (FAILED(g_nokta->Advise(alici, &g_cerez))) g_cerez = 0;
      alici->Release();  // bağlantı noktası kendi başvurusunu tutar
    }
    kap->Release();
  }
  return g_cerez ? std::wstring() : L"Ağ olayları alınamadı";
}

void agIleti(WPARAM baglanirlik) {
  const int b = internetVar(static_cast<NLM_CONNECTIVITY>(baglanirlik)) ? 1 : 0;
  if (b == g_bagli) return;
  g_bagli = b;
  Olay o("ag");
  o.mantik("bagli", b == 1);
  o.yaz();
}

std::string agJson() { return g_bagli < 0 ? "null" : (g_bagli ? "true" : "false"); }

void agKapat() {
  if (g_nokta && g_cerez) g_nokta->Unadvise(g_cerez);
  if (g_nokta) g_nokta->Release();
  if (g_nlm) g_nlm->Release();
  g_nokta = nullptr;
  g_nlm = nullptr;
  g_cerez = 0;
}
