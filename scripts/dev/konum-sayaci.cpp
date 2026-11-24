// ── Konum olayı sayacı (0.14 T28b; yalnız ölçüm, kuruluma girmez) ────────────────────────────────────────────────────────────────────
// scripts/dev/olay-islemci.mjs derler ve açar. T28'e dek fuber-olay'ın yaptığını yalnız SAYAR: ön pencerenin iş parçacığına bağlı
// EVENT_OBJECT_LOCATIONCHANGE kancası (ön pencere değişince taşınır; süreç dışı, WINEVENT_OUTOFCONTEXT). Ölçüm penceresinde eski yardımcının kaç kez
// uyanacağını gösterir. Girdi göndermez, pencere açmaz, tuş okumaz; pencere başlığı okumaz. stdin kapanınca tek JSON satırı yazar ve çıkar:
// {"konum":<bütün konum olayları>,"konumPencere":<ön pencerenin kendisi (eski süzgeçten geçen)>,"on":<ön pencere değişimi>}.
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdio>

namespace {
HWINEVENTHOOK g_konum = nullptr;
DWORD g_konumIs = 0;
HWND g_on = nullptr;
DWORD g_anaIs = 0;
unsigned long long g_say = 0, g_sayPencere = 0, g_sayOn = 0;

void CALLBACK Olay(HWINEVENTHOOK, DWORD olay, HWND h, LONG nesne, LONG cocuk, DWORD, DWORD);

void tasi() {
  g_on = GetForegroundWindow();
  DWORD surec = 0;
  const DWORD is = g_on ? GetWindowThreadProcessId(g_on, &surec) : 0;
  if (is && is == g_konumIs && g_konum) return;
  if (g_konum) UnhookWinEvent(g_konum);
  g_konum = nullptr;
  g_konumIs = 0;
  if (!is || surec == GetCurrentProcessId()) return;
  g_konum = SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, nullptr, Olay, surec, is, WINEVENT_OUTOFCONTEXT);
  if (g_konum) g_konumIs = is;
}

void CALLBACK Olay(HWINEVENTHOOK, DWORD olay, HWND h, LONG nesne, LONG cocuk, DWORD, DWORD) {
  if (olay == EVENT_OBJECT_LOCATIONCHANGE) {
    g_say++;
    if (h && h == g_on && nesne == OBJID_WINDOW && cocuk == CHILDID_SELF) g_sayPencere++;
    return;
  }
  g_sayOn++;
  tasi();
}

DWORD WINAPI Okuyucu(LPVOID) {
  char b[256];
  DWORD n = 0;
  const HANDLE g = GetStdHandle(STD_INPUT_HANDLE);
  while (ReadFile(g, b, sizeof b, &n, nullptr) && n > 0) {
  }
  PostThreadMessageW(g_anaIs, WM_QUIT, 0, 0);
  return 0;
}
}  // namespace

int wmain() {
  g_anaIs = GetCurrentThreadId();
  MSG m;
  PeekMessageW(&m, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  const HWINEVENTHOOK on = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nullptr, Olay, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
  tasi();
  if (const HANDLE o = CreateThread(nullptr, 0, Okuyucu, nullptr, 0, nullptr)) CloseHandle(o);
  std::printf("{\"hazir\":true}\n");
  std::fflush(stdout);
  while (GetMessageW(&m, nullptr, 0, 0) > 0) DispatchMessageW(&m);
  if (g_konum) UnhookWinEvent(g_konum);
  if (on) UnhookWinEvent(on);
  std::printf("{\"konum\":%llu,\"konumPencere\":%llu,\"on\":%llu}\n", g_say, g_sayPencere, g_sayOn);
  std::fflush(stdout);
  return 0;
}
