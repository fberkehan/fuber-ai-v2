// ── fuber-olay: şarj ve pil (0.14 T20) ───────────────────────────────────────────────────────────────────────────────────────────
// RegisterPowerSettingNotification ile iki ayar: GUID_ACDC_POWER_SOURCE (prize takıldı ya da çıkarıldı) ve
// GUID_BATTERY_PERCENTAGE_REMAINING (pil yüzdesi her değiştiğinde). Bildirim ileti penceresine WM_POWERBROADCAST olarak gelir; Windows
// kayıt anında o anki değeri bir kez yollar, aynı değer tekrar yazılmaz. İlk hâl GetSystemPowerStatus'tan (tek okuma). Pilsiz
// masaüstünde `yuzde` null; `sarj` prize takılı demektir (masaüstünde hep true).
#include <initguid.h>  // winnt.h'deki güç ayarı GUID'leri bu birimde tanımlansın (uuid.lib gerekmez)
#include "cikti.h"

namespace {

HPOWERNOTIFY g_kaynakKaydi = nullptr;
HPOWERNOTIFY g_yuzdeKaydi = nullptr;
bool g_biliniyor = false;  // prize takılı olup olmadığı biliniyor mu
bool g_sarj = false;
bool g_pilVar = false;
int g_yuzde = -1;  // -1: bilinmiyor
// Son bildirilen (ya da açılıştaki) değer: yalnız değişince yazılır.
bool g_sonVar = false;
bool g_sonSarj = false;
int g_sonYuzde = -1;

int bildirilenYuzde() { return g_pilVar ? g_yuzde : -1; }

void degisinceYaz() {
  if (!g_biliniyor) return;
  const int y = bildirilenYuzde();
  if (g_sonVar && g_sonSarj == g_sarj && g_sonYuzde == y) return;
  g_sonVar = true;
  g_sonSarj = g_sarj;
  g_sonYuzde = y;
  Olay o("guc");
  o.mantik("sarj", g_sarj);
  if (y >= 0) o.tamsayi("yuzde", y);
  else o.bos("yuzde");
  o.yaz();
}

}  // namespace

std::wstring gucKur() {
  SYSTEM_POWER_STATUS d{};
  if (GetSystemPowerStatus(&d)) {
    // BatteryFlag 128: sistem pili yok; 255: bilinmiyor.
    g_pilVar = (d.BatteryFlag & 128) == 0 && d.BatteryFlag != 255;
    if (d.ACLineStatus == 0 || d.ACLineStatus == 1) {
      g_sarj = d.ACLineStatus == 1;
      g_biliniyor = true;
    }
    if (g_pilVar && d.BatteryLifePercent <= 100) g_yuzde = d.BatteryLifePercent;
  }
  g_sonVar = g_biliniyor;
  g_sonSarj = g_sarj;
  g_sonYuzde = bildirilenYuzde();
  g_kaynakKaydi = RegisterPowerSettingNotification(g_pencere, &GUID_ACDC_POWER_SOURCE, DEVICE_NOTIFY_WINDOW_HANDLE);
  g_yuzdeKaydi = RegisterPowerSettingNotification(g_pencere, &GUID_BATTERY_PERCENTAGE_REMAINING, DEVICE_NOTIFY_WINDOW_HANDLE);
  return g_kaynakKaydi ? std::wstring() : L"Şarj olayları alınamadı";
}

void gucBildirimi(const POWERBROADCAST_SETTING* ayar) {
  if (!ayar || ayar->DataLength < sizeof(DWORD)) return;
  const DWORD deger = *reinterpret_cast<const DWORD*>(ayar->Data);
  if (IsEqualGUID(ayar->PowerSetting, GUID_ACDC_POWER_SOURCE)) {
    g_sarj = deger == PoAc;  // PoDc: pil, PoHot: kısa süreli kaynak (UPS)
    g_biliniyor = true;
  } else if (IsEqualGUID(ayar->PowerSetting, GUID_BATTERY_PERCENTAGE_REMAINING)) {
    if (deger <= 100) g_yuzde = static_cast<int>(deger);
  } else {
    return;
  }
  degisinceYaz();
}

std::string gucJson() {
  if (!g_biliniyor) return "null";
  JsonNesne j;
  j.mantik("sarj", g_sarj);
  const int y = bildirilenYuzde();
  if (y >= 0) j.tamsayi("yuzde", y);
  else j.bos("yuzde");
  return j.bitir();
}

void gucKapat() {
  if (g_kaynakKaydi) UnregisterPowerSettingNotification(g_kaynakKaydi);
  if (g_yuzdeKaydi) UnregisterPowerSettingNotification(g_yuzdeKaydi);
  g_kaynakKaydi = g_yuzdeKaydi = nullptr;
}
