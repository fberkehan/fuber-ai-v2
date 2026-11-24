// ── fuber-olay: ortak bildirimler ve tek çıktı yolu (0.14 T20, Ruling R1) ───────────────────────────────────────────────────────────
// Olay güdümlü sistem olayları yardımcısı (C++17 + C++/WinRT; derleme: node native/derle.mjs olay). Ana iş parçacığı COM STA'dır;
// gizli bir ileti penceresi ve GetMessageW döngüsüyle bekler. Her kaynak yalnız değişince uyandırır: yoklama, uyku ve zamanlayıcı yok.
// Başka iş parçacıklarında gelen geri çağırmalar (ses aygıtı ve düzeyi, klavye kancası, WinRT pil sorgusu, stdin okuyucu) yalnız
// PostMessageW ile ana iş parçacığına haber verir; hâl ve stdout yalnız ana iş parçacığındadır (kilit yok, yarış yok).
// Çıktı: satır başına bir JSON (UTF-8). Her satır `Olay` ile kurulur; "t" anahtarını yalnız `Olay` yazar ve türü hep dize sabitidir
// (kaynak taraması: tests/olay-yardimcisi-kaynak.test.ts). Protokolün TS tarafı: src/shared/sistem-olay.ts.
#pragma once
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <cstdio>
#include <string>

// ── Ana iş parçacığının ileti penceresine bırakılan iletiler ─────────────────────────────────────────────────────────────────────────
enum : UINT {
  WM_OLAY_KOMUT = WM_APP + 1,  // stdin satırı; lParam: std::string* (alan siler)
  WM_OLAY_CIKIS,               // stdin kapandı ya da stdout'u okuyan kalmadı: çık
  WM_OLAY_KLAVYE,              // kanca: wParam 1 = Caps Lock bırakıldı, 0 = dil tuşu bırakıldı (tuş kodu taşınmaz)
  WM_OLAY_AG,                  // ağ bağlanırlığı; wParam: NLM_CONNECTIVITY
  WM_OLAY_SES,                 // ses düzeyi; wParam: düzey × 10000, lParam: (kuşak << 1) | sessiz
  WM_OLAY_AYGIT,               // ses aygıtı durumu; wParam: DEVICE_STATE_*, lParam: std::wstring* aygıt kimliği (alan siler)
  WM_OLAY_VARSAYILAN,          // varsayılan ses çıkışı değişti
  WM_OLAY_PIL,                 // pil sorgusu bitti; wParam: istek no, lParam: 0..100 ya da -1 (bilinmiyor)
  WM_OLAY_PARLAKLIK,           // parlaklık olayı; wParam: 0..100
  WM_OLAY_MEDYA,               // medya oturumu (T21); wParam: medya.cpp ileti türü, lParam: oturum kuşağı ya da sonuç (alan siler)
  WM_OLAY_APPBAR,              // kabuk → tamekran.cpp'nin gizli appbar pencereleri (T28b); wParam: ABN_*, yalnız ABN_FULLSCREENAPP işlenir
};

extern HWND g_pencere;                    // ana iş parçacığının ileti penceresi (HWND_MESSAGE)
void satirYaz(const std::string& satir);  // yalnız ana iş parçacığı; olay.cpp

// ── JSON yardımcıları ────────────────────────────────────────────────────────────────────────────────────────────────────────────
inline std::string utf8(const std::wstring& s) {
  if (s.empty()) return {};
  const int n = WideCharToMultiByte(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0, nullptr, nullptr);
  std::string r(n > 0 ? n : 0, '\0');
  if (n > 0) WideCharToMultiByte(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), &r[0], n, nullptr, nullptr);
  return r;
}

/** Tırnaklı, kaçışlı JSON dizesi; denetim karakterleri \u00XX. En çok 256 karakter (aygıt ve dil adları kısa). */
inline std::string jsonDize(const std::wstring& s) {
  const std::string u = utf8(s.size() > 256 ? s.substr(0, 256) : s);
  std::string r = "\"";
  for (const char c : u) {
    const unsigned char b = static_cast<unsigned char>(c);
    if (c == '"' || c == '\\') { r += '\\'; r += c; }
    else if (b < 0x20) { char k[8]; std::snprintf(k, sizeof k, "\\u%04x", b); r += k; }
    else r += c;
  }
  return r + "\"";
}

/** En çok `basamak` ondalıklı sayı; sondaki sıfırlar atılır ("0.42", "1", "0.5"). */
inline std::string jsonSayi(double d, int basamak) {
  char k[64];
  std::snprintf(k, sizeof k, "%.*f", basamak, d);
  std::string r = k;
  if (r.find('.') != std::string::npos) {
    while (!r.empty() && r.back() == '0') r.pop_back();
    if (!r.empty() && r.back() == '.') r.pop_back();
  }
  return r == "-0" ? "0" : r;
}

/** Tek düzey JSON nesnesi kurucusu (iç içe değerler `ham` ile). */
class JsonNesne {
 public:
  void mantik(const char* ad, bool d) { anahtar(ad); m_metin += d ? "true" : "false"; }
  void tamsayi(const char* ad, long long d) { anahtar(ad); m_metin += std::to_string(d); }
  void sayi(const char* ad, double d, int basamak) { anahtar(ad); m_metin += jsonSayi(d, basamak); }
  void metin(const char* ad, const std::wstring& d) { anahtar(ad); m_metin += jsonDize(d); }
  void bos(const char* ad) { anahtar(ad); m_metin += "null"; }
  void ham(const char* ad, const std::string& json) { anahtar(ad); m_metin += json; }
  std::string bitir() const { return m_metin + "}"; }

 protected:
  void anahtar(const char* ad) {
    if (m_metin.size() > 1) m_metin += ',';
    m_metin += '"';
    m_metin += ad;
    m_metin += "\":";
  }
  std::string m_metin = "{";
};

/** Çıktı satırı: {"t":"<tur>", …}. `tur` her çağrıda dize sabiti ve protokol listesinde (kaynak taraması). */
class Olay : public JsonNesne {
 public:
  explicit Olay(const char* tur) {
    anahtar("t");
    m_metin += '"';
    m_metin += tur;
    m_metin += '"';
  }
  void yaz() const { satirYaz(bitir()); }
};

inline void hataYaz(const std::wstring& mesaj) {
  Olay o("hata");
  o.metin("mesaj", mesaj);
  o.yaz();
}

// ── Kaynaklar ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Her `…Kur` ana iş parçacığında, `hazir`dan önce çağrılır; boş dize = tamam, değilse `hata` olayının metni. `…Json` o kaynağın
// `durum` gövdesindeki değeridir (bilinmiyorsa "null"). `…Kapat` çıkışta kaydı bırakır.

// guc.cpp — şarj ve pil
std::wstring gucKur();
void gucBildirimi(const POWERBROADCAST_SETTING* ayar);
std::string gucJson();
void gucKapat();

// ag.cpp — internet bağlantısı
std::wstring agKur();
void agIleti(WPARAM baglanirlik);
std::string agJson();
void agKapat();

// ses.cpp — ses çıkış aygıtı, ses düzeyi, Bluetooth pil yüzdesi
std::wstring sesKur();
void sesIleti(UINT ileti, WPARAM w, LPARAM l);
void sesAyarla(double duzey);
std::string sesJson();
std::string sesAygitiJson();
void sesKapat();

// parlaklik.cpp — dahili ekran parlaklığı (WMI olayı)
std::wstring parlaklikKur();
void parlaklikIleti(WPARAM duzey);
std::string parlaklikJson();
void parlaklikKapat();

// tamekran.cpp — ön pencere kendi ekranını tam kaplıyor mu (ön pencere, küçültme ve kabuğun ABN_FULLSCREENAPP bildirimi; T28b)
std::wstring tamEkranKur();
std::string tamEkranJson();
void tamEkranKapat();
void tamEkranAcilKapat();                 // takılma/istisna yolu: yalnız appbar kayıtlarını bırakır (her iş parçacığından)
void tamEkranSayaclari(JsonNesne& j);     // `sayac` satırı: on, kucultme, appbar, ekran

// medya.cpp — medya oturumu (GSMTC): ne çalıyor; oynat, duraklat, ileri, geri, konum (T21)
std::wstring medyaKur();
void medyaIleti(WPARAM tur, LPARAM veri);
void medyaKomutu(const std::string& eylem, bool snVar, double sn);
std::string medyaJson();
void medyaKapat();

// klavye.cpp — Caps Lock ve klavye dili (kanca yalnız komutla; tam ekranda kaldırılır, T28b)
void klavyeAyarla(bool acik);
void klavyeTamEkran(bool tamEkran);       // tamekran.cpp: kanca yalnız istenmişse ve tam ekran yoksa kurulu
void klavyeTusu(bool caps);
void klavyeOnPencereDegisti();
void klavyeSayaclari(JsonNesne& j);       // `sayac` satırı: klavyeKurulum, klavyeKaldirma, klavyeAcikMs, klavyeIsMs
std::string capsJson();
std::string dilJson();
