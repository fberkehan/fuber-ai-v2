// ── fuber-olay: tam ekran (0.14 T20; Review Focus 2; T28b) ─────────────────────────────────────────────────────────────────────────
// Ön pencere kendi ekranını tam kaplıyorsa (masaüstü ve kabuk pencereleri hariç; başlıklı büyütülmüş pencere tam ekran sayılmaz)
// {"t":"tam-ekran","acik":true,"ekran":{x,y,en,boy}}; bitince acik:false ve tam ekranın olduğu ekran. Ayrıca Windows'un bildirim
// durumu Direct3D tam ekran (3) ya da sunu modu (4) ise açık sayılır (SHQueryUserNotificationState). Değerlendirme yalnız olayla:
//  · EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZESTART/END (genel WinEvent kancaları; süreç dışı, WINEVENT_OUTOFCONTEXT, DLL enjeksiyonu yok);
//  · kabuğun tam ekran bildirimi ABN_FULLSCREENAPP (0.14 T28b): her ekrana bir gizli, hiç gösterilmeyen üst düzey pencere appbar olarak kayıtlıdır
//    (ABM_NEW + geri çağırma iletisi). Görev çubuğunun kendini gizlerken kullandığı olaydır: F11, kenarlıksız ve Direct3D tam ekran, Alt+Enter ile
//    pencereye dönüş, ön pencere değişmeden büyüme ya da küçülme. Bildirim YALNIZ appbar'ın kendi ekranındaki tam ekran için gelir (T28b deneyi: tek
//    appbar ikinci ekrandaki tam ekranı duymaz); bu yüzden ekran başına bir appbar. Appbar ekranda yer AYIRMAZ: konum ve boyut bildiren appbar iletisi
//    hiç gönderilmez, pencere 1×1 ve görünmezdir. Çıkışta ABM_REMOVE; görev çubuğu yeniden açılınca (TaskbarCreated) ve ekran düzeni değişince
//    (WM_DISPLAYCHANGE) yeniden kurulur. Bildirimin lParam'ına güvenilmez (ön planda olmayan bir pencere de tetikleyebilir): yalnız değerlendirmeyi
//    başlatır, karar ön pencereden verilir.
//  · Önceki sürümdeki, ön pencerenin iş parçacığına bağlı konum değişimi kancası KALDIRILDI (T28 incelemesi Important 3): imleç, düzeltme imi ve alt
//    pencerelerin her hareketi süreçler arası bir çağrıyla yardımcıyı uyandırıyordu (T28b: Chrome önde, kullanıcı boştayken bile ~300/sn ölçüldü).
// Geri çağırmalar ana iş parçacığının ileti döngüsünde gelir. Ekran kutuları fiziksel piksel (süreç DPI farkında). Ön pencere değişince klavye dili de
// yeniden okunur (klavye.cpp; yalnız klavye istenmişken yazar). Tam ekran açılınca alçak düzey klavye kancası kaldırılır, bitince yeniden kurulur
// (klavyeTamEkran; R25 tam ekranda uyarı göstermez).
// Bildirim durumu her olayda sorulur. Sınır: sunu modunun açılıp kapanmasının olay kaynağı yok; bir sonraki ön pencere, küçültme ya da appbar olayında
// algılanır. Sayaçlar (tamEkranSayaclari): ön pencere, küçültme, appbar ve ekran düzeni olaylarının sayısı (temiz çıkıştaki `sayac` satırı).
#include "cikti.h"
#include <shellapi.h>
#include <cwchar>
#include <vector>

namespace {

HWINEVENTHOOK g_onKancasi = nullptr;
HWINEVENTHOOK g_kucultmeKancasi = nullptr;
HWND g_yonetici = nullptr;     // gizli üst düzey pencere (appbar değil): WM_DISPLAYCHANGE ve TaskbarCreated yayınlarını alır
std::vector<HWND> g_barlar;    // ekran başına bir gizli appbar penceresi
UINT g_gorevCubuguAcildi = 0;  // RegisterWindowMessageW(L"TaskbarCreated")
unsigned long long g_sayOn = 0, g_sayKucultme = 0, g_sayAppbar = 0, g_sayEkran = 0;
constexpr wchar_t BAR_SINIFI[] = L"FuberOlayTamEkranBar";
constexpr wchar_t YONETICI_SINIFI[] = L"FuberOlayTamEkranYonetici";
bool g_acik = false;
RECT g_ekran{};
bool g_ekranVar = false;
QUERY_USER_NOTIFICATION_STATE g_bildirim = QUNS_ACCEPTS_NOTIFICATIONS;

/** Windows'un bildirim durumu tek başına tam ekran demek mi: Direct3D tam ekran (3) ya da sunu modu (4). */
bool bildirimTamEkranMi(QUERY_USER_NOTIFICATION_STATE d) { return d == QUNS_RUNNING_D3D_FULL_SCREEN || d == QUNS_PRESENTATION_MODE; }

/** Masaüstü ve kabuk: görev çubuğu, masaüstü, görev geçişi, Başlat/Arama/bildirim panelleri, kilit ekranı. */
bool kabukMu(HWND h) {
  if (!h || h == GetDesktopWindow() || h == GetShellWindow()) return true;
  wchar_t sinif[96]{};
  if (!GetClassNameW(h, sinif, 96)) return false;
  static const wchar_t* const KABUK[] = {
      L"Progman", L"WorkerW", L"Shell_TrayWnd", L"Shell_SecondaryTrayWnd", L"XamlExplorerHostIslandWindow",
      L"MultitaskingViewFrame", L"ForegroundStaging", L"TaskSwitcherWnd", L"TaskSwitcherOverlayWnd", L"Windows.UI.Core.CoreWindow",
  };
  for (const wchar_t* k : KABUK)
    if (std::wcscmp(sinif, k) == 0) return true;
  return false;
}

RECT ekranKutusu(HWND h) {
  const HMONITOR m = h ? MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST) : MonitorFromPoint(POINT{0, 0}, MONITOR_DEFAULTTOPRIMARY);
  MONITORINFO b{};
  b.cbSize = sizeof b;
  if (!GetMonitorInfoW(m, &b)) return RECT{0, 0, 0, 0};
  return b.rcMonitor;
}

std::string ekranJson(const RECT& r) {
  JsonNesne j;
  j.tamsayi("x", r.left);
  j.tamsayi("y", r.top);
  j.tamsayi("en", r.right - r.left);
  j.tamsayi("boy", r.bottom - r.top);
  return j.bitir();
}

void yaz() {
  Olay o("tam-ekran");
  o.mantik("acik", g_acik);
  o.ham("ekran", ekranJson(g_ekran));
  o.yaz();
}

/** Ön pencereyi değerlendirir; `bildirimSor`: Windows bildirim durumu da okunur (değilse son değer kullanılır). */
void degerlendir(bool bildirimSor, bool yazilsin) {
  const HWND on = GetForegroundWindow();
  const RECT ekran = ekranKutusu(on);
  bool acik = false;
  if (on && !kabukMu(on) && IsWindowVisible(on) && !IsIconic(on)) {
    const LONG stil = GetWindowLongW(on, GWL_STYLE);
    const bool baslikliBuyuk = IsZoomed(on) && (stil & WS_CAPTION) == WS_CAPTION;
    RECT p{};
    acik = !baslikliBuyuk && GetWindowRect(on, &p) && p.left <= ekran.left && p.top <= ekran.top && p.right >= ekran.right &&
           p.bottom >= ekran.bottom && ekran.right > ekran.left;
  }
  if (bildirimSor) {
    QUERY_USER_NOTIFICATION_STATE d = QUNS_ACCEPTS_NOTIFICATIONS;
    if (SUCCEEDED(SHQueryUserNotificationState(&d))) g_bildirim = d;
  }
  if (bildirimTamEkranMi(g_bildirim)) acik = true;
  const bool degisti = acik != g_acik || (acik && !EqualRect(&ekran, &g_ekran));
  // Kapanışta tam ekranın olduğu ekran bildirilir; öbür durumlarda ön pencerenin ekranı.
  if (acik || !g_acik) g_ekran = ekran;
  const bool oncekiAcik = g_acik;
  g_acik = acik;
  g_ekranVar = true;
  if (degisti && yazilsin) yaz();
  if (acik != oncekiAcik) klavyeTamEkran(acik);  // tam ekranda alçak düzey klavye kancası kaldırılır (R25: uyarı yok)
}

void CALLBACK PencereOlayi(HWINEVENTHOOK, DWORD olay, HWND, LONG, LONG, DWORD, DWORD) {
  if (olay == EVENT_SYSTEM_FOREGROUND) {
    g_sayOn++;
    degerlendir(true, true);
    klavyeOnPencereDegisti();
    return;
  }
  g_sayKucultme++;
  degerlendir(true, true);  // küçültme başladı ya da bitti
}

// ── Appbar: kabuğun tam ekran bildirimi (ABN_FULLSCREENAPP) ─────────────────────────────────────────────────────────────────────────
/** Yalnız kayıt: geri çağırma iletisi verilir, konum ve boyut HİÇ bildirilmez (ekranda yer ayrılmaz). */
bool appbarKaydet(HWND h) {
  APPBARDATA a{};
  a.cbSize = sizeof a;
  a.hWnd = h;
  a.uCallbackMessage = WM_OLAY_APPBAR;
  return SHAppBarMessage(ABM_NEW, &a) != 0;
}

void appbarBirak(HWND h) {
  APPBARDATA a{};
  a.cbSize = sizeof a;
  a.hWnd = h;
  SHAppBarMessage(ABM_REMOVE, &a);
}

BOOL CALLBACK EkranTopla(HMONITOR m, HDC, LPRECT, LPARAM l) {
  MONITORINFO b{};
  b.cbSize = sizeof b;
  if (GetMonitorInfoW(m, &b)) reinterpret_cast<std::vector<RECT>*>(l)->push_back(b.rcMonitor);
  return TRUE;
}

void barlariBirak() {
  for (const HWND h : g_barlar) {
    appbarBirak(h);
    DestroyWindow(h);
  }
  g_barlar.clear();
}

/** Ekran başına bir gizli appbar (pencere o ekranın sol üst köşesinde, 1×1, hiç gösterilmez): bildirim yalnız appbar'ın ekranı için gelir. */
void barlariKur() {
  barlariBirak();
  std::vector<RECT> ekranlar;
  EnumDisplayMonitors(nullptr, nullptr, EkranTopla, reinterpret_cast<LPARAM>(&ekranlar));
  for (const RECT& r : ekranlar) {
    const HWND h = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, BAR_SINIFI, L"", WS_POPUP, r.left, r.top, 1, 1, nullptr, nullptr,
                                   GetModuleHandleW(nullptr), nullptr);
    if (!h) continue;
    if (appbarKaydet(h)) g_barlar.push_back(h);
    else DestroyWindow(h);
  }
}

LRESULT CALLBACK BarIslevi(HWND h, UINT ileti, WPARAM w, LPARAM l) {
  if (ileti == WM_OLAY_APPBAR) {
    // ABN_FULLSCREENAPP: bu ekranda bir tam ekran pencere açıldı ya da kapandı. Karar ön pencereden; bildirim durumu da sorulur (Direct3D
    // tam ekrandan Alt+Enter ile pencereye dönen oyunda bayat "3" yüzünden "açık"ta takılı kalınmaz).
    if (w == ABN_FULLSCREENAPP) {
      g_sayAppbar++;
      degerlendir(true, true);
    }
    return 0;
  }
  return DefWindowProcW(h, ileti, w, l);
}

LRESULT CALLBACK YoneticiIslevi(HWND h, UINT ileti, WPARAM w, LPARAM l) {
  if (ileti == WM_DISPLAYCHANGE) {  // ekran eklendi, çıkarıldı ya da çözünürlük değişti: appbar'lar yeni ekranlara
    g_sayEkran++;
    barlariKur();
    degerlendir(true, true);
    return 0;
  }
  if (g_gorevCubuguAcildi && ileti == g_gorevCubuguAcildi) {  // Explorer yeniden açıldı: appbar kayıtları düştü
    barlariKur();
    degerlendir(true, true);
    return 0;
  }
  return DefWindowProcW(h, ileti, w, l);
}

bool sinifKaydet(const wchar_t* ad, WNDPROC islev) {
  WNDCLASSEXW s{};
  s.cbSize = sizeof s;
  s.lpfnWndProc = islev;
  s.hInstance = GetModuleHandleW(nullptr);
  s.lpszClassName = ad;
  return RegisterClassExW(&s) != 0;
}

}  // namespace

std::wstring tamEkranKur() {
  g_onKancasi = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nullptr, PencereOlayi, 0, 0,
                                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
  g_kucultmeKancasi = SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND, nullptr, PencereOlayi, 0, 0,
                                      WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
  g_gorevCubuguAcildi = RegisterWindowMessageW(L"TaskbarCreated");
  if (sinifKaydet(BAR_SINIFI, BarIslevi) && sinifKaydet(YONETICI_SINIFI, YoneticiIslevi)) {
    g_yonetici = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, YONETICI_SINIFI, L"", WS_POPUP, 0, 0, 1, 1, nullptr, nullptr,
                                 GetModuleHandleW(nullptr), nullptr);
    barlariKur();
  }
  degerlendir(true, false);
  if (!g_onKancasi || !g_kucultmeKancasi) return L"Tam ekran olayları alınamadı";
  return g_barlar.empty() ? L"Tam ekran bildirimi alınamadı" : std::wstring();
}

std::string tamEkranJson() {
  if (!g_ekranVar) return "null";
  JsonNesne j;
  j.mantik("acik", g_acik);
  j.ham("ekran", ekranJson(g_ekran));
  return j.bitir();
}

void tamEkranKapat() {
  for (HWINEVENTHOOK* k : {&g_onKancasi, &g_kucultmeKancasi}) {
    if (*k) UnhookWinEvent(*k);
    *k = nullptr;
  }
  barlariBirak();
  if (g_yonetici) DestroyWindow(g_yonetici);
  g_yonetici = nullptr;
}

void tamEkranAcilKapat() {
  // Ana iş parçacığı takıldı ya da işlenmeyen bir istisna: yalnız appbar kayıtları bırakılır (SHAppBarMessage her iş parçacığından çağrılabilir;
  // pencereler süreçle birlikte yok olur). Appbar yer ayırmadığı için bırakılamasa da ekran düzeni bozulmaz; Explorer ölü kaydı kendisi temizler.
  for (const HWND h : g_barlar) appbarBirak(h);
}

void tamEkranSayaclari(JsonNesne& j) {
  j.tamsayi("on", static_cast<long long>(g_sayOn));
  j.tamsayi("kucultme", static_cast<long long>(g_sayKucultme));
  j.tamsayi("appbar", static_cast<long long>(g_sayAppbar));
  j.tamsayi("ekran", static_cast<long long>(g_sayEkran));
}
