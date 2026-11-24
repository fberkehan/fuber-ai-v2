// ── fuber-olay: Caps Lock ve klavye dili (0.14 T20) ──────────────────────────────────────────────────────────────────────────────────
// GİZLİLİK SÖZLEŞMESİ (kaynak taraması: tests/olay-yardimcisi-kaynak.test.ts):
//  - Alçak düzey klavye kancası (WH_KEYBOARD_LL) YALNIZ ana süreç {"k":"klavye","acik":true} gönderince kurulur; açılışta kurulmaz.
//    {"k":"klavye","acik":false} ya da stdin kapanınca kaldırılır ve kanca iş parçacığı beklenerek biter.
//  - Kanca kendi iş parçacığındadır: ana iş parçacığı stdout'a yazarken ya da bir COM çağrısında beklerken bile kanca anında döner
//    (Windows'un kanca zaman aşımına düşüp klavyeyi yavaşlatmaz).
//  - Kanca işlevi yalnız bırakılış iletilerinde (WM_KEYUP, WM_SYSKEYUP) tuşun adına bakar: Caps Lock ya da dil değiştirme tuşlarından
//    biri (Ctrl, Shift, Alt, Win, Boşluk) bırakıldıysa ana iş parçacığına SABİT bir ileti bırakır; tuş kodu taşınmaz, başka tuşa hiç
//    bakılmaz, hiçbir tuş kaydedilmez, tamponlanmaz ya da yazılmaz. Her olay CallNextHookEx ile sıradakine geçer (yutulmaz). Kanca
//    işlevi beklemez: yalnız PostMessageW (kuyruğa bırakır) ve CallNextHookEx çağırır.
//  - Çıktı yalnız {"t":"caps","acik":…} (Caps Lock'un geçiş biti) ve {"t":"dil","kod":…,"ad":…} (ön pencerenin klavye düzeninin
//    dili), yalnız değişince. Dil ayrıca ön pencere değişince okunur (tamekran.cpp'deki EVENT_SYSTEM_FOREGROUND).
// Kanca açılınca o anki Caps Lock ve dil taban alınır, olay yazılmaz (ana süreç tabanı `durum`dan bilir); sonra yalnız değişim yazılır.
// TAM EKRAN KAPISI (0.14 T28b; T28 incelemesi Important 3): alçak düzey kanca sistemdeki HER tuş basışı ve bırakılışında bu sürecin kanca iş parçacığını
// uyandırır (oyunda WASD ile sürekli). R25 gereği tam ekranda Caps Lock ve dil uyarısı zaten gösterilmez; bu yüzden tam ekran açılınca
// (tamekran.cpp → klavyeTamEkran(true)) kanca kaldırılır, bitince yeniden kurulur. Kanca yine YALNIZ ana süreç istemişse kurulur (`g_istendi`):
// tam ekranın bitmesi istenmemiş bir kancayı kurmaz. Yeniden kurulunca taban SIFIRLANMAZ: tam ekranda Caps Lock ya da dil değiştiyse ana sürecin
// bildiği son değerden farkı bir kez yazılır (ana süreç bayat kalmasın). Kanca işlevinin kendisi (KancaIslevi) değişmedi; yalnız kurulma anı değişti.
// Daha ucuz kaynak yok: WM_INPUTLANGCHANGE yalnız odaktaki penceresi olan iş parçacığına gelir (gizli penceremiz hiç odak almaz); Caps Lock'un sistem
// geneli olayı yoktur (ham girdi aboneliği her tuşta uyandırır ve kaynak taramasında yasaktır).
#include "cikti.h"
#include <cwchar>

namespace {

HANDLE g_is = nullptr;       // kanca iş parçacığı
DWORD g_isNo = 0;
bool g_kuruldu = false;      // kanca iş parçacığı kancayı kurabildi mi
HWND g_hedef = nullptr;      // kanca işlevinin iletisini alan pencere (ana iş parçacığı)
bool g_acik = false;         // kanca şu an kurulu
bool g_istendi = false;      // ana süreç {"k":"klavye","acik":true} gönderdi (kapatana dek)
bool g_tamEkran = false;     // tamekran.cpp: ön pencere tam ekran (kanca kaldırılır)
int g_sonCaps = -1;
std::wstring g_sonDil;
// Sayaçlar (`sayac` satırı; tuş verisi YOK): kurulum ve kaldırma sayısı, kancanın kurulu kaldığı süre, kanca iş parçacığının işlemci süresi.
unsigned long long g_sayKurulum = 0, g_sayKaldirma = 0, g_acikMs = 0, g_isMs = 0;
ULONGLONG g_kurulumAni = 0;

LRESULT CALLBACK KancaIslevi(int kod, WPARAM ileti, LPARAM veri) {
  if (kod == HC_ACTION && (ileti == WM_KEYUP || ileti == WM_SYSKEYUP)) {
    const DWORD tus = reinterpret_cast<const KBDLLHOOKSTRUCT*>(veri)->vkCode;
    if (tus == VK_CAPITAL) {
      PostMessageW(g_hedef, WM_OLAY_KLAVYE, 1, 0);
    } else if (tus == VK_SPACE || tus == VK_SHIFT || tus == VK_LSHIFT || tus == VK_RSHIFT || tus == VK_MENU || tus == VK_LMENU ||
               tus == VK_RMENU || tus == VK_CONTROL || tus == VK_LCONTROL || tus == VK_RCONTROL || tus == VK_LWIN || tus == VK_RWIN) {
      PostMessageW(g_hedef, WM_OLAY_KLAVYE, 0, 0);
    }
  }
  return CallNextHookEx(nullptr, kod, ileti, veri);
}

/** Kanca iş parçacığı: kancayı kurar, WM_QUIT gelene dek yalnız kanca çağrıları için bekler, sonra kancayı kaldırır. */
DWORD WINAPI KancaIsParcacigi(LPVOID hazir) {
  // Yoğun işlemci yükünde de kanca zamanında dönsün (Windows zaman aşımında kancayı sessizce kaldırır). Kanca hemen döndüğü için
  // yüksek öncelik işlemci harcamaz.
  SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
  MSG m;
  PeekMessageW(&m, nullptr, WM_USER, WM_USER, PM_NOREMOVE);  // ileti kuyruğu kurulsun (WM_QUIT bekleyebilsin)
  const HHOOK kanca = SetWindowsHookExW(WH_KEYBOARD_LL, KancaIslevi, GetModuleHandleW(nullptr), 0);
  g_kuruldu = kanca != nullptr;
  SetEvent(static_cast<HANDLE>(hazir));
  if (!kanca) return 1;
  while (GetMessageW(&m, nullptr, 0, 0) > 0) {
  }
  UnhookWindowsHookEx(kanca);
  return 0;
}

int capsOku() { return (GetKeyState(VK_CAPITAL) & 1) ? 1 : 0; }

struct Dil {
  std::wstring kod, ad;
};

/** Ön pencerenin (odaktaki denetimin iş parçacığının) klavye düzeninin dili: "tr-TR" ve dilin kendi adı ("Türkçe"). */
bool onDil(Dil& d) {
  GUITHREADINFO b{};
  b.cbSize = sizeof b;
  HWND h = GetGUIThreadInfo(0, &b) && b.hwndFocus ? b.hwndFocus : GetForegroundWindow();
  if (!h) return false;
  const HKL duzen = GetKeyboardLayout(GetWindowThreadProcessId(h, nullptr));
  const LANGID dil = LOWORD(reinterpret_cast<UINT_PTR>(duzen));
  if (!dil) return false;
  wchar_t kod[LOCALE_NAME_MAX_LENGTH]{};
  if (!LCIDToLocaleName(MAKELCID(dil, SORT_DEFAULT), kod, LOCALE_NAME_MAX_LENGTH, 0)) return false;
  wchar_t ad[128]{};
  if (!GetLocaleInfoEx(kod, LOCALE_SNATIVELANGUAGENAME, ad, 128) || !ad[0]) wcsncpy_s(ad, kod, _TRUNCATE);
  // İlk harf dilin kendi büyük harf kuralıyla ("français" → "Français", "italiano" → "Italiano").
  wchar_t ilk[2] = {ad[0], 0}, buyuk[2] = {0, 0};
  if (LCMapStringEx(kod, LCMAP_UPPERCASE | LCMAP_LINGUISTIC_CASING, ilk, 1, buyuk, 1, nullptr, nullptr, 0) == 1) ad[0] = buyuk[0];
  d.kod = kod;
  d.ad = ad;
  return true;
}

void capsBak(bool yaz) {
  const int c = capsOku();
  if (c == g_sonCaps) return;
  g_sonCaps = c;
  if (!yaz) return;
  Olay o("caps");
  o.mantik("acik", c == 1);
  o.yaz();
}

void dilBak(bool yaz) {
  Dil d;
  if (!onDil(d) || d.kod == g_sonDil) return;
  g_sonDil = d.kod;
  if (!yaz) return;
  Olay o("dil");
  o.metin("kod", d.kod);
  o.metin("ad", d.ad);
  o.yaz();
}

}  // namespace

namespace {

/** Kanca iş parçacığını açar ve kancanın kurulmasını bekler. Yalnız klavyeAyarla (istek) ve klavyeTamEkran (istenmişken tam ekran bitti) çağırır. */
bool kancaKur() {
  if (g_is) return true;  // zaten kurulu
  g_hedef = g_pencere;
  g_kuruldu = false;
  const HANDLE hazir = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  g_is = hazir ? CreateThread(nullptr, 0, KancaIsParcacigi, hazir, 0, &g_isNo) : nullptr;
  if (g_is) WaitForSingleObject(hazir, INFINITE);
  if (hazir) CloseHandle(hazir);
  if (!g_is || !g_kuruldu) {
    if (g_is) {
      WaitForSingleObject(g_is, INFINITE);  // kurulamadıysa iş parçacığı zaten bitti
      CloseHandle(g_is);
    }
    g_is = nullptr;
    g_isNo = 0;
    hataYaz(L"Klavye kancası kurulamadı");
    return false;
  }
  g_acik = true;
  g_sayKurulum++;
  g_kurulumAni = GetTickCount64();
  return true;
}

/** Kanca iş parçacığına WM_QUIT bırakır ve bitmesini bekler (kanca orada kaldırılır); süre ve iş parçacığının işlemci süresi sayaca eklenir. */
void kancaKaldir() {
  g_acik = false;
  if (!g_is) return;
  PostThreadMessageW(g_isNo, WM_QUIT, 0, 0);
  WaitForSingleObject(g_is, INFINITE);
  FILETIME olusma{}, bitis{}, cekirdek{}, kullanici{};
  if (GetThreadTimes(g_is, &olusma, &bitis, &cekirdek, &kullanici)) {
    const auto ms = [](const FILETIME& f) { return ((static_cast<unsigned long long>(f.dwHighDateTime) << 32) | f.dwLowDateTime) / 10000; };
    g_isMs += ms(cekirdek) + ms(kullanici);
  }
  CloseHandle(g_is);
  g_is = nullptr;
  g_isNo = 0;
  g_sayKaldirma++;
  g_acikMs += GetTickCount64() - g_kurulumAni;
}

}  // namespace

void klavyeAyarla(bool acik) {
  if (!acik) {
    g_istendi = false;
    kancaKaldir();
    return;
  }
  if (g_istendi) return;  // zaten istendi
  g_istendi = true;
  g_sonCaps = -1;
  g_sonDil.clear();
  capsBak(false);  // taban; olay yazılmaz
  dilBak(false);
  if (g_tamEkran) return;  // tam ekran bitince kurulur
  if (!kancaKur()) g_istendi = false;
}

void klavyeTamEkran(bool tamEkran) {
  if (tamEkran == g_tamEkran) return;
  g_tamEkran = tamEkran;
  if (!g_istendi) return;  // ana süreç istemedi: tam ekranın bitmesi kanca kurmaz
  if (tamEkran) {
    kancaKaldir();
    return;
  }
  // Tam ekran bitti: kanca yeniden kurulur; tam ekranda Caps Lock ya da dil değiştiyse fark bir kez yazılır (taban sıfırlanmaz).
  if (!kancaKur()) return;
  capsBak(true);
  dilBak(true);
}

void klavyeSayaclari(JsonNesne& j) {
  unsigned long long acikMs = g_acikMs;
  if (g_acik) acikMs += GetTickCount64() - g_kurulumAni;
  j.tamsayi("klavyeKurulum", static_cast<long long>(g_sayKurulum));
  j.tamsayi("klavyeKaldirma", static_cast<long long>(g_sayKaldirma));
  j.tamsayi("klavyeAcikMs", static_cast<long long>(acikMs));
  j.tamsayi("klavyeIsMs", static_cast<long long>(g_isMs));
}

void klavyeTusu(bool caps) {
  if (!g_acik) return;
  // Caps Lock'un geçiş biti basışta değişir; bırakılışta okunan değer günceldir. Dil tuşlarından sonra Caps Lock da okunur
  // ("Shift Caps Lock'u kapatır" ayarı), Caps Lock'tan sonra dil de (ucuz; yalnız değişince yazılır).
  (void)caps;
  capsBak(true);
  dilBak(true);
}

void klavyeOnPencereDegisti() {
  if (g_istendi) dilBak(true);  // tam ekranda da (kancasız, ucuz): ön pencerenin dili ön pencere olayında okunur
}

std::string capsJson() { return capsOku() ? "true" : "false"; }

std::string dilJson() {
  Dil d;
  if (!onDil(d)) return "null";
  JsonNesne j;
  j.metin("kod", d.kod);
  j.metin("ad", d.ad);
  return j.bitir();
}
