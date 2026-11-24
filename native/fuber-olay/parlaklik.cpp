// ── fuber-olay: dahili ekran parlaklığı (0.14 T20, Ruling R25) ─────────────────────────────────────────────────────────────────────
// WMI root\WMI: ilk değer WmiMonitorBrightness'tan (tek sorgu), sonrası WmiMonitorBrightnessEvent olay sorgusuyla (sağlayıcının kendi
// olayı; WITHIN yoklaması yok). Bu sınıfın örneği yalnız parlaklığı Windows'tan ayarlanan dahili ekranda (dizüstü) olur: örnek yoksa
// (masaüstü, dış ekran) parlaklık null kalır ve olaya hiç abone olunmaz; bu bir hata değildir. Olay alıcısı STA'da ana iş parçacığına
// sıralanır; yine de yalnız iletiye çevrilir (tek hâl güncelleme yolu).
#include "cikti.h"
#include <objbase.h>
#include <wbemidl.h>

namespace {

IWbemServices* g_wmi = nullptr;
IWbemObjectSink* g_alici = nullptr;
int g_parlaklik = -1;  // 0..100; -1: dahili ekran yok ya da bilinmiyor

int yuzdeOku(IWbemClassObject* n, const wchar_t* alan) {
  if (!n) return -1;
  VARIANT v;
  VariantInit(&v);
  int p = -1;
  if (SUCCEEDED(n->Get(alan, 0, &v, nullptr, nullptr)) && SUCCEEDED(VariantChangeType(&v, &v, 0, VT_I4)) && v.lVal >= 0 && v.lVal <= 100) p = v.lVal;
  VariantClear(&v);
  return p;
}

class ParlaklikAlicisi final : public IWbemObjectSink {
 public:
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&m_ref); }
  ULONG STDMETHODCALLTYPE Release() override {
    const ULONG r = InterlockedDecrement(&m_ref);
    if (r == 0) delete this;
    return r;
  }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** p) override {
    if (!p) return E_POINTER;
    if (iid == __uuidof(IUnknown) || iid == IID_IWbemObjectSink) {
      *p = static_cast<IWbemObjectSink*>(this);
      AddRef();
      return S_OK;
    }
    *p = nullptr;
    return E_NOINTERFACE;
  }
  HRESULT STDMETHODCALLTYPE Indicate(long sayi, IWbemClassObject** nesneler) override {
    for (long i = 0; nesneler && i < sayi; i++) {
      const int p = yuzdeOku(nesneler[i], L"Brightness");
      if (p >= 0) PostMessageW(g_pencere, WM_OLAY_PARLAKLIK, static_cast<WPARAM>(p), 0);
    }
    return WBEM_S_NO_ERROR;
  }
  HRESULT STDMETHODCALLTYPE SetStatus(long, HRESULT, BSTR, IWbemClassObject*) override { return WBEM_S_NO_ERROR; }

 private:
  LONG m_ref = 1;
};

void birak() {
  if (g_alici) g_alici->Release();
  if (g_wmi) g_wmi->Release();
  g_alici = nullptr;
  g_wmi = nullptr;
}

}  // namespace

std::wstring parlaklikKur() {
  IWbemLocator* bulucu = nullptr;
  if (FAILED(CoCreateInstance(CLSID_WbemLocator, nullptr, CLSCTX_INPROC_SERVER, IID_IWbemLocator, reinterpret_cast<void**>(&bulucu))))
    return L"Parlaklık olayları alınamadı";
  BSTR ad = SysAllocString(L"ROOT\\WMI");
  HRESULT hr = bulucu->ConnectServer(ad, nullptr, nullptr, nullptr, 0, nullptr, nullptr, &g_wmi);
  SysFreeString(ad);
  bulucu->Release();
  if (FAILED(hr) || !g_wmi) {
    g_wmi = nullptr;
    return L"Parlaklık olayları alınamadı";
  }
  CoSetProxyBlanket(g_wmi, RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE, nullptr, RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE);

  BSTR dil = SysAllocString(L"WQL");
  BSTR sorgu = SysAllocString(L"SELECT CurrentBrightness FROM WmiMonitorBrightness WHERE Active = TRUE");
  IEnumWbemClassObject* liste = nullptr;
  bool ekranVar = false;
  if (SUCCEEDED(g_wmi->ExecQuery(dil, sorgu, WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY, nullptr, &liste)) && liste) {
    IWbemClassObject* n = nullptr;
    ULONG donen = 0;
    if (SUCCEEDED(liste->Next(3000, 1, &n, &donen)) && donen == 1 && n) {
      ekranVar = true;
      g_parlaklik = yuzdeOku(n, L"CurrentBrightness");
      n->Release();
    }
    liste->Release();
  }
  SysFreeString(sorgu);
  if (!ekranVar) {  // dahili ekran yok: kaynak yok, olaya abone olunmaz (hata değil)
    SysFreeString(dil);
    birak();
    return {};
  }
  g_alici = new ParlaklikAlicisi();
  BSTR olay = SysAllocString(L"SELECT * FROM WmiMonitorBrightnessEvent");
  hr = g_wmi->ExecNotificationQueryAsync(dil, olay, 0, nullptr, g_alici);
  SysFreeString(olay);
  SysFreeString(dil);
  if (FAILED(hr)) {
    birak();
    return L"Parlaklık olayları alınamadı";
  }
  return {};
}

void parlaklikIleti(WPARAM duzey) {
  const int p = static_cast<int>(duzey);
  if (p < 0 || p > 100 || p == g_parlaklik) return;
  g_parlaklik = p;
  Olay o("parlaklik");
  o.sayi("duzey", p / 100.0, 2);
  o.yaz();
}

std::string parlaklikJson() { return g_parlaklik < 0 ? "null" : jsonSayi(g_parlaklik / 100.0, 2); }

void parlaklikKapat() {
  if (g_wmi && g_alici) g_wmi->CancelAsyncCall(g_alici);
  birak();
}
