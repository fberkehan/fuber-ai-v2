// ── fuber-olay: giriş, ileti döngüsü ve stdin komutları (0.14 T20, Ruling R1) ───────────────────────────────────────────────────────
// Açılış: DPI farkındalığı (ekran kutuları fiziksel piksel), COM STA, gizli ileti penceresi, kaynaklar (güç, ağ, ses, parlaklık, tam
// ekran, medya oturumu), sonra {"t":"hazir","surum":1}; açılışta kurulamayan kaynak `hata` satırıyla bildirilir, o alan `durum`da null kalır.
// Klavye kancası açılışta KURULMAZ; yalnız {"k":"klavye","acik":true} komutuyla (klavye.cpp).
// Komutlar (stdin, satır başına bir JSON): {"k":"durum"} → {"t":"durum", …}; {"k":"klavye","acik":bool}; {"k":"ses","duzey":0..1};
// {"k":"medya","eylem":"oynat"|"duraklat"|"ileri"|"geri"|"konum","sn"?:sayı} (T21, medya.cpp).
// stdin ayrı bir iş parçacığında okunur, her satır ana iş parçacığına iletilir. stdin kapanınca (ana süreç çıktı ya da kapattı)
// kaynaklar bırakılır, kanca iş parçacığı beklenerek kapatılır ve süreç çıkar; ana iş parçacığı bir COM çağrısında takılırsa okuyucu
// 700 ms sonra süreci kendisi bitirir (1 sn sözü). Boşta hiçbir iş parçacığı uyanmaz: ana döngü GetMessageW'de, okuyucu ReadFile'da.
// 0.14 T28b: temiz çıkışta son satır {"t":"sayac",…} (geri çağırma sayaçları; yalnız sayılar). Takılma ve işlenmeyen istisna yolunda tam ekranın appbar
// kayıtları bırakılır (tamEkranAcilKapat).
#include "cikti.h"
#include <objbase.h>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <vector>

HWND g_pencere = nullptr;

namespace {

HANDLE g_cikti = INVALID_HANDLE_VALUE;
HANDLE g_bitti = nullptr;  // kapanış tamam (okuyucu en çok 700 ms bekler)
constexpr size_t KOMUT_SINIRI = 4096;
// Açılışta STA'daki süreçler arası COM çağrıları (WMI, ağ) iletileri işler: kayıt anında gelen bildirimler `hazir`dan önce olay
// üretebilir. `hazir` her zaman ilk satırdır; ondan önce oluşan satırlar burada bekler ve hemen ardından sırayla yazılır.
bool g_hazir = false;
std::vector<std::string> g_erkenSatirlar;

// ── Düz JSON nesnesi ayrıştırıcı (komutlar tek düzey: dize, sayı, true/false, null) ──────────────────────────────────────────────
struct Deger {
  enum Tur { Yok, Dize, Sayi, Mantik, Bos } tur = Yok;
  std::string dize;
  double sayi = 0;
  bool mantik = false;
};

class Ayristirici {
 public:
  explicit Ayristirici(const std::string& s) : m_s(s) {}

  bool nesne(std::map<std::string, Deger>& alanlar) {
    bosluk();
    if (!harf('{')) return false;
    bosluk();
    if (harf('}')) return sonMu();
    for (;;) {
      std::string ad;
      Deger d;
      bosluk();
      if (!dize(ad)) return false;
      bosluk();
      if (!harf(':')) return false;
      bosluk();
      if (!deger(d)) return false;
      alanlar[ad] = d;
      bosluk();
      if (harf(',')) continue;
      if (harf('}')) return sonMu();
      return false;
    }
  }

 private:
  void bosluk() { while (m_i < m_s.size() && (m_s[m_i] == ' ' || m_s[m_i] == '\t' || m_s[m_i] == '\r' || m_s[m_i] == '\n')) m_i++; }
  bool harf(char c) {
    if (m_i < m_s.size() && m_s[m_i] == c) { m_i++; return true; }
    return false;
  }
  bool sonMu() { bosluk(); return m_i == m_s.size(); }
  bool kelime(const char* k) {
    const size_t n = std::char_traits<char>::length(k);
    if (m_s.compare(m_i, n, k) != 0) return false;
    m_i += n;
    return true;
  }
  bool dize(std::string& d) {
    if (!harf('"')) return false;
    while (m_i < m_s.size()) {
      const char c = m_s[m_i++];
      if (c == '"') return true;
      if (static_cast<unsigned char>(c) < 0x20) return false;
      if (c != '\\') { d += c; continue; }
      if (m_i >= m_s.size()) return false;
      const char e = m_s[m_i++];
      switch (e) {
        case '"': case '\\': case '/': d += e; break;
        case 'b': d += '\b'; break;
        case 'f': d += '\f'; break;
        case 'n': d += '\n'; break;
        case 'r': d += '\r'; break;
        case 't': d += '\t'; break;
        case 'u':  // komut değerleri ASCII; \uXXXX geçerli sayılır, yerine '?' konur
          if (m_i + 4 > m_s.size()) return false;
          m_i += 4;
          d += '?';
          break;
        default:
          return false;
      }
    }
    return false;
  }
  bool deger(Deger& d) {
    if (m_i >= m_s.size()) return false;
    const char c = m_s[m_i];
    if (c == '"') { d.tur = Deger::Dize; return dize(d.dize); }
    if (kelime("true")) { d.tur = Deger::Mantik; d.mantik = true; return true; }
    if (kelime("false")) { d.tur = Deger::Mantik; d.mantik = false; return true; }
    if (kelime("null")) { d.tur = Deger::Bos; return true; }
    const size_t bas = m_i;
    while (m_i < m_s.size() && std::strchr("+-0123456789.eE", m_s[m_i]) && m_s[m_i] != '\0') m_i++;
    if (m_i == bas) return false;
    const std::string sayi = m_s.substr(bas, m_i - bas);
    char* son = nullptr;
    d.sayi = std::strtod(sayi.c_str(), &son);
    if (son != sayi.c_str() + sayi.size() || !std::isfinite(d.sayi)) return false;
    d.tur = Deger::Sayi;
    return true;
  }

  const std::string& m_s;
  size_t m_i = 0;
};

void durumYaz() {
  Olay o("durum");
  o.ham("guc", gucJson());
  o.ham("ag", agJson());
  o.ham("sesAygiti", sesAygitiJson());
  o.ham("ses", sesJson());
  o.ham("parlaklik", parlaklikJson());
  o.ham("caps", capsJson());
  o.ham("dil", dilJson());
  o.ham("tamEkran", tamEkranJson());
  o.ham("medya", medyaJson());
  o.yaz();
}

void komutIsle(const std::string& satir) {
  std::map<std::string, Deger> k;
  if (!Ayristirici(satir).nesne(k) || k["k"].tur != Deger::Dize) {
    hataYaz(L"Komut okunamadı");
    return;
  }
  const std::string& ad = k["k"].dize;
  if (ad == "durum") {
    durumYaz();
  } else if (ad == "klavye") {
    const Deger& d = k["acik"];
    if (d.tur != Deger::Mantik) {
      hataYaz(L"klavye komutunda acik true ya da false olmalı");
      return;
    }
    const bool ac = d.mantik;
    klavyeAyarla(ac);
  } else if (ad == "ses") {
    const Deger& d = k["duzey"];
    if (d.tur != Deger::Sayi) {
      hataYaz(L"ses komutunda duzey sayı olmalı");
      return;
    }
    sesAyarla(d.sayi);
  } else if (ad == "medya") {
    const Deger& e = k["eylem"];
    const Deger& sn = k["sn"];
    if (e.tur != Deger::Dize) {
      hataYaz(L"medya komutunda eylem dize olmalı");
      return;
    }
    medyaKomutu(e.dize, sn.tur == Deger::Sayi, sn.sayi);
  } else {
    hataYaz(L"Bilinmeyen komut");
  }
}

LRESULT CALLBACK PencereIslevi(HWND h, UINT ileti, WPARAM w, LPARAM l) {
  switch (ileti) {
    case WM_POWERBROADCAST:
      if (w == PBT_POWERSETTINGCHANGE) gucBildirimi(reinterpret_cast<const POWERBROADCAST_SETTING*>(l));
      return TRUE;
    case WM_OLAY_KOMUT: {
      std::unique_ptr<std::string> satir(reinterpret_cast<std::string*>(l));
      if (satir) komutIsle(*satir);
      return 0;
    }
    case WM_OLAY_CIKIS:
      PostQuitMessage(0);
      return 0;
    case WM_OLAY_KLAVYE:
      klavyeTusu(w == 1);
      return 0;
    case WM_OLAY_AG:
      agIleti(w);
      return 0;
    case WM_OLAY_SES:
    case WM_OLAY_AYGIT:
    case WM_OLAY_VARSAYILAN:
    case WM_OLAY_PIL:
      sesIleti(ileti, w, l);
      return 0;
    case WM_OLAY_PARLAKLIK:
      parlaklikIleti(w);
      return 0;
    case WM_OLAY_MEDYA:
      medyaIleti(w, l);
      return 0;
    default:
      return DefWindowProcW(h, ileti, w, l);
  }
}

/** stdin okuyucu: satırları ana iş parçacığına iletir; kapanınca çıkışı başlatır, ana iş parçacığı takılırsa süreci kendisi bitirir. */
DWORD WINAPI StdinOkuyucu(LPVOID) {
  const HANDLE girdi = GetStdHandle(STD_INPUT_HANDLE);
  std::string tampon;
  char parca[4096];
  DWORD okunan = 0;
  bool atla = false;  // sınırı aşan satırın kalanı bir sonraki satır sonuna dek atılır (ayrı komut sayılmaz)
  while (girdi && girdi != INVALID_HANDLE_VALUE && ReadFile(girdi, parca, sizeof parca, &okunan, nullptr) && okunan > 0) {
    tampon.append(parca, okunan);
    size_t son;
    while ((son = tampon.find('\n')) != std::string::npos) {
      std::string satir = tampon.substr(0, son);
      tampon.erase(0, son + 1);
      if (atla) {
        atla = false;
        continue;
      }
      if (!satir.empty() && satir.back() == '\r') satir.pop_back();
      if (satir.empty() || satir.size() > KOMUT_SINIRI) continue;  // aşırı uzun komut atılır
      auto* k = new std::string(std::move(satir));
      if (!PostMessageW(g_pencere, WM_OLAY_KOMUT, 0, reinterpret_cast<LPARAM>(k))) delete k;
    }
    if (tampon.size() > KOMUT_SINIRI) {  // satır sonu gelmeden sınır aşıldı: bu satır bütünüyle atılır
      tampon.clear();
      atla = true;
    }
  }
  PostMessageW(g_pencere, WM_OLAY_CIKIS, 0, 0);
  if (WaitForSingleObject(g_bitti, 700) != WAIT_OBJECT_0) tamEkranAcilKapat();  // ana iş parçacığı takıldı: appbar kayıtları yine bırakılsın
  ExitProcess(0);
}

void dpiFarkindaligi() {
  // Ekran kutuları fiziksel piksel (ana süreç ölçekle DIP'e çevirir). Windows 10 1703 öncesinde sistem DPI'sı.
  using Islev = BOOL(WINAPI*)(DPI_AWARENESS_CONTEXT);
  if (const HMODULE u = GetModuleHandleW(L"user32.dll"))
    if (const auto f = reinterpret_cast<Islev>(GetProcAddress(u, "SetProcessDpiAwarenessContext")))
      if (f(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) return;
  SetProcessDPIAware();
}

/** İşlenmeyen istisna: appbar kayıtları bırakılır, sonra Windows'un olağan çöküş yolu sürer (çökme raporu, çıkış kodu). */
LONG WINAPI IstisnaSuzgeci(EXCEPTION_POINTERS*) {
  tamEkranAcilKapat();
  return EXCEPTION_CONTINUE_SEARCH;
}

/** 0.14 T28b: temiz çıkışta tek satır geri çağırma sayaçları (tanı; ana süreç yalnız FUBER_DEMO'da günlüğe yazar). Tuş verisi ve başlık yok: yalnız sayılar. */
void sayacYaz(ULONGLONG acilis) {
  Olay o("sayac");
  o.tamsayi("sureMs", static_cast<long long>(GetTickCount64() - acilis));
  tamEkranSayaclari(o);
  klavyeSayaclari(o);
  o.yaz();
}

}  // namespace

void satirYaz(const std::string& satir) {
  if (!g_hazir) {
    g_erkenSatirlar.push_back(satir);
    return;
  }
  if (g_cikti == INVALID_HANDLE_VALUE || g_cikti == nullptr) return;
  const std::string s = satir + "\n";
  DWORD yazilan = 0;
  if (!WriteFile(g_cikti, s.data(), static_cast<DWORD>(s.size()), &yazilan, nullptr)) {
    // Okuyan kalmadı (ana süreç gitti): bir daha yazılmaz, çıkılır.
    g_cikti = INVALID_HANDLE_VALUE;
    PostMessageW(g_pencere, WM_OLAY_CIKIS, 0, 0);
  }
}

int wmain() {
  const ULONGLONG acilis = GetTickCount64();
  SetUnhandledExceptionFilter(IstisnaSuzgeci);
  dpiFarkindaligi();
  g_cikti = GetStdHandle(STD_OUTPUT_HANDLE);
  g_bitti = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE))) {
    g_hazir = true;  // yazılabilsin
    hataYaz(L"COM başlatılamadı");
    return 1;
  }
  // Süreç COM güvenliği, WMI olay alıcısına (parlaklık) Windows Yönetim hizmetinin geri çağrısı ulaşsın diye. Yerel sistemde
  // Kerberos dışı eşzamansız WMI geri çağrısı her zaman kimliksiz (RPC_C_AUTHN_LEVEL_NONE) gelir: SYSTEM ve kullanıcıyla sınırlı bir
  // güvenlik tanımlayıcısı onu reddeder ve parlaklık olayı sessizce kesilir. IUnsecuredApartment seçeneği ise ayrı bir süreç
  // (unsecapp.exe) açtırır. Dışarıdan çağrılabilen nesneler yalnız olay alıcılarıdır; çağırmak için tahmin edilemeyen nesne kimliği
  // gerekir ve gelen veri yalnız 0..100 tamsayısı ya da bağlanırlık bayrağı olarak kullanılır.
  CoInitializeSecurity(nullptr, -1, nullptr, nullptr, RPC_C_AUTHN_LEVEL_DEFAULT, RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE, nullptr);

  WNDCLASSEXW sinif{};
  sinif.cbSize = sizeof sinif;
  sinif.lpfnWndProc = PencereIslevi;
  sinif.hInstance = GetModuleHandleW(nullptr);
  sinif.lpszClassName = L"FuberOlayPenceresi";
  RegisterClassExW(&sinif);
  g_pencere = CreateWindowExW(0, sinif.lpszClassName, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, sinif.hInstance, nullptr);
  if (!g_pencere) {
    g_hazir = true;
    hataYaz(L"İleti penceresi açılamadı");
    return 1;
  }

  const std::wstring hatalar[] = {gucKur(), agKur(), sesKur(), parlaklikKur(), tamEkranKur(), medyaKur()};
  g_hazir = true;
  {
    Olay o("hazir");
    o.tamsayi("surum", 1);
    o.yaz();
  }
  for (const auto& s : g_erkenSatirlar) satirYaz(s);
  g_erkenSatirlar.clear();
  g_erkenSatirlar.shrink_to_fit();
  for (const auto& h : hatalar)
    if (!h.empty()) hataYaz(h);

  if (const HANDLE okuyucu = CreateThread(nullptr, 0, StdinOkuyucu, nullptr, 0, nullptr)) CloseHandle(okuyucu);
  else PostQuitMessage(1);

  MSG m;
  while (GetMessageW(&m, nullptr, 0, 0) > 0) DispatchMessageW(&m);

  klavyeAyarla(false);  // kanca iş parçacığı beklenerek kapanır
  medyaKapat();
  tamEkranKapat();
  parlaklikKapat();
  agKapat();
  sesKapat();
  gucKapat();
  sayacYaz(acilis);  // stdout hâlâ açık (stdin kapandı); okuyan yoksa satırYaz sessizce atlar
  SetEvent(g_bitti);
  ExitProcess(0);
}
