"""ESKİ "F + iki nokta" ikon kütüphanesi — 0.12'den beri YALNIZ Fuber Yönetim'in (scripts/yonetim-ikon-uret.py içe aktarır).

Fuber AI'nin ikon ailesi 0.12'de yeni mini logoya geçti ve scripts/ikon-uret.mjs ile üretilir (node scripts/ikon-uret.mjs).
Bu dosya doğrudan çalıştırılınca HİÇBİR ŞEY yazmaz (Fuber AI'nin yeni ikonlarını eski işaretle ezmesin); işlevleri Yönetim için durur.

Eski açıklama (Görev 22, K13) — onaylanan ürün işaretinden: "F + iki nokta".

İşaretin kaynağı: markanın özgün sohbet.svg dosyası (bu depoda yok; SALT OKUNUR — yolları aşağıya
birebir kopyalandı, geometri değiştirilmez). Renk: markanın gümüş geçişi #b9bdcd → #dfe4ee.

Aile (hepsi bu betikten; elle düzenleme bir sonraki üretimde kaybolur):
  build/icon.ico            Windows: exe, kısayol, görev çubuğu, Alt+Tab (16·20·24·32·40·48·64·96·128·256)
  build/kurulum.ico         kurulum başlatıcısı (native/fuber-kurulum): aynı karo + küçük mavi "indir" rozeti
  build/icon.icns           macOS (Big Sur ızgarası: 824/1024 karo + gölge; 16…1024)
  build/icon.png            macOS/Linux kaynağı (1024, aynı ızgara)
  resources/ikon/fuber.ico  pencere ikonu (Windows; icon.ico ile aynı)
  resources/ikon/fuber.png  pencere ikonu (diğer sistemler, 512)
  resources/ikon/tepsi-koyu.ico / tepsi-acik.ico   Windows tepsisi: tek renk işaret, koyu görev çubuğunda beyaz,
                            açıkta mürekkep (16·20·24·32·40·48; main.ts görev çubuğu temasına göre seçer)
  resources/ikon/tepsiTemplate.png (+@2x)          macOS menü çubuğu şablonu (siyah + alfa; sistem boyar)

Küçük boylar (16·20·24·32) vektörden küçültülmez: işaret piksel ızgarasına oturtulmuş ayrı çizimdir (sap, kol, iki nokta
tam piksel sınırlarında; köşe ve noktalar yumuşatılır). 40 ve üstü vektörden, sap ve kolun dış kenarları piksele oturtulur.

Çalıştırma (0.12'den beri): `python scripts/ikon-uret.py` HİÇBİR ŞEY yazmaz (yukarıdaki dosyaları artık scripts/ikon-uret.mjs
üretir; eski aile ve temas sayfası _eski_main'de yalnız başvuru için durur). İşlevleri scripts/yonetim-ikon-uret.py içe aktarır.
"""
from __future__ import annotations

import io
import math
import re
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

KOK = Path(__file__).resolve().parent.parent

# ── Kaynak işaret (sohbet.svg, viewBox 0 0 101.07 123.41): F gövdesi + sağ nokta + sol nokta ─────────────────────────
ISARET_G, ISARET_Y = 101.07, 123.41
ISARET_YOLLARI = (
    "M30.26,36.54l-.07,86.87-30.19-.07V29.77C1.71,13.44,14.07,1.37,30.34,0h70.73s-.02,31.43-.02,31.43H35.75c-2.19.66-4.94,2.61-5.49,5.11Z",
    "M76.5,49.79c5.52-2.1,10.94.78,12.99,5.86,1.95,4.83-.79,11.03-5.85,12.81-5.11,1.79-10.43-.32-12.62-5.45s-.31-11.02,5.48-13.22Z",
    "M57.58,66.66c-4.53,4.25-11.56,2.78-14.68-1.97-3.26-4.94-1.8-11.53,3.72-14.46,4.4-2.34,9.73-.82,12.5,3.11,2.78,3.94,2.63,9.41-1.53,13.31Z",
)
GUMUS_1, GUMUS_2 = (0xB9, 0xBD, 0xCD), (0xDF, 0xE4, 0xEE)
MAVI = (0x0E, 0x59, 0xEF)  # tasarim.css --mavi: yalnız küçük rozet

_SAYI = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"


def yol_ayristir(d: str, adim: int = 40) -> list[list[tuple[float, float]]]:
    """SVG yolu → kapalı çokgenler (M/L/H/V/C/S, büyük-küçük; kübik eğriler `adim` parçaya bölünür)."""
    jet = re.findall(r"[MmLlHhVvCcSsZz]|" + _SAYI, d)
    i, x, y, sx, sy = 0, 0.0, 0.0, 0.0, 0.0
    kom, kontrol = "", None
    altlar: list[list[tuple[float, float]]] = []
    cizgi: list[tuple[float, float]] = []

    def sayi() -> float:
        nonlocal i
        v = float(jet[i])
        i += 1
        return v

    def kubik(p0, p1, p2, p3) -> None:
        for k in range(1, adim + 1):
            t = k / adim
            u = 1 - t
            cizgi.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                          u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))

    while i < len(jet):
        t = jet[i]
        if re.match(r"[A-Za-z]", t):
            kom = t
            i += 1
            if kom in "Zz":
                if cizgi:
                    altlar.append(cizgi)
                cizgi, x, y, kontrol = [], sx, sy, None
                continue
        if kom in "Mm":
            nx, ny = sayi(), sayi()
            if kom == "m":
                nx, ny = nx + x, ny + y
            if cizgi:
                altlar.append(cizgi)
            cizgi, x, y, sx, sy = [(nx, ny)], nx, ny, nx, ny
            kom, kontrol = ("L" if kom == "M" else "l"), None
        elif kom in "Ll":
            nx, ny = sayi(), sayi()
            if kom == "l":
                nx, ny = nx + x, ny + y
            cizgi.append((nx, ny))
            x, y, kontrol = nx, ny, None
        elif kom in "Hh":
            nx = sayi()
            x = nx + x if kom == "h" else nx
            cizgi.append((x, y))
            kontrol = None
        elif kom in "Vv":
            ny = sayi()
            y = ny + y if kom == "v" else ny
            cizgi.append((x, y))
            kontrol = None
        elif kom in "Cc":
            a = [sayi() for _ in range(6)]
            if kom == "c":
                a = [a[0] + x, a[1] + y, a[2] + x, a[3] + y, a[4] + x, a[5] + y]
            kubik((x, y), (a[0], a[1]), (a[2], a[3]), (a[4], a[5]))
            kontrol, x, y = (a[2], a[3]), a[4], a[5]
        elif kom in "Ss":
            a = [sayi() for _ in range(4)]
            if kom == "s":
                a = [a[0] + x, a[1] + y, a[2] + x, a[3] + y]
            k1 = (2 * x - kontrol[0], 2 * y - kontrol[1]) if kontrol else (x, y)
            kubik((x, y), k1, (a[0], a[1]), (a[2], a[3]))
            kontrol, x, y = (a[0], a[1]), a[2], a[3]
        else:
            raise ValueError(f"desteklenmeyen yol komutu: {kom}")
    if cizgi:
        altlar.append(cizgi)
    return altlar


ISARET = [p for d in ISARET_YOLLARI for p in yol_ayristir(d)]


# ── Yardımcılar (numpy; değerler 0..1, renkler önçarpılmış RGBA) ─────────────────────────────────────────────────────

def kucult(a: np.ndarray, ss: int) -> np.ndarray:
    """ss×ss blok ortalaması (alan örneklemesi): kenar yumuşatması tam kapsama oranıdır, halka yapmaz."""
    if ss == 1:
        return a
    h, w = a.shape[0] // ss, a.shape[1] // ss
    return a.reshape(h, ss, w, ss, *a.shape[2:]).mean(axis=(1, 3))


def cokgen_maskesi(R: int, cokgenler, donustur) -> np.ndarray:
    im = Image.new("L", (R, R), 0)
    ciz = ImageDraw.Draw(im)
    for p in cokgenler:
        ciz.polygon([donustur(x, y) for x, y in p], fill=255)
    return np.asarray(im, dtype=np.float32) / 255.0


def bulanik(m: np.ndarray, yaricap: float) -> np.ndarray:
    if yaricap <= 0:
        return m
    im = Image.fromarray(np.clip(m * 255, 0, 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(yaricap))
    return np.asarray(im, dtype=np.float32) / 255.0


def kaydir(m: np.ndarray, dx: int, dy: int) -> np.ndarray:
    o = np.zeros_like(m)
    h, w = m.shape[:2]
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    o[yd, xd] = m[ys, xs]
    return o


def ustune(alt: np.ndarray, ust: np.ndarray) -> np.ndarray:
    """Önçarpılmış RGBA 'over'."""
    return ust + alt * (1 - ust[..., 3:4])


def katman(renk, alfa: np.ndarray) -> np.ndarray:
    """Düz renk (0..1 RGB ya da HxWx3) + alfa → önçarpılmış RGBA."""
    r = np.broadcast_to(np.asarray(renk, dtype=np.float32), alfa.shape + (3,))
    return np.concatenate([r * alfa[..., None], alfa[..., None]], axis=-1)


def resim(rgba: np.ndarray) -> Image.Image:
    a = rgba[..., 3:4]
    rgb = np.where(a > 1e-6, rgba[..., :3] / np.maximum(a, 1e-6), 0)
    out = np.concatenate([rgb, a], axis=-1)
    return Image.fromarray(np.clip(np.round(out * 255), 0, 255).astype(np.uint8), "RGBA")


def kare_izgara(R: int):
    y, x = np.mgrid[0:R, 0:R].astype(np.float32)
    return (x + 0.5) / R, (y + 0.5) / R  # 0..1 piksel merkezleri


def superelips(R: int, x0: float, y0: float, x1: float, y1: float, n: float = 5.0) -> np.ndarray:
    """Sürekli eğrili karo (Apple "squircle" yaklaşımı); sınırlar 0..1 tuval biriminde."""
    u, v = kare_izgara(R)
    cx, cy, a, b = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    d = np.abs((u - cx) / a) ** n + np.abs((v - cy) / b) ** n
    return (d <= 1).astype(np.float32)


def yuvarlak_kare(R: int, x0: float, y0: float, x1: float, y1: float, r: float) -> np.ndarray:
    """Yuvarlak köşeli dikdörtgen (küçük boylar: piksel sınırına oturan düz kenarlar); birimler 0..1."""
    u, v = kare_izgara(R)
    qx = np.maximum(np.maximum(x0 + r - u, u - (x1 - r)), 0)
    qy = np.maximum(np.maximum(y0 + r - v, v - (y1 - r)), 0)
    ic = (u >= x0) & (u <= x1) & (v >= y0) & (v <= y1)
    return (ic & (qx * qx + qy * qy <= r * r)).astype(np.float32)


def renk(c) -> np.ndarray:
    return np.asarray(c, dtype=np.float32) / 255.0


# ── İşaretin maskesi ────────────────────────────────────────────────────────────────────────────────────────────────

def isaret_vektor_parcalar(R: int, kutu: tuple[float, float, float]) -> list[np.ndarray]:
    """Vektör işaret, kaynak sırasıyla üç parça [F gövdesi, sağ nokta, sol nokta]: `kutu` = (sol, üst, yükseklik) tuval birimi."""
    sol, ust, boy = kutu
    k = boy / ISARET_Y * R
    return [cokgen_maskesi(R, [p], lambda x, y: (sol * R + x * k, ust * R + y * k)) for p in ISARET]


def isaret_vektor(R: int, kutu: tuple[float, float, float]) -> np.ndarray:
    return np.maximum.reduce(isaret_vektor_parcalar(R, kutu))


# Küçük boylar için ızgaraya oturtulmuş çizim (piksel cinsinden; N = tuvalin piksel boyu). Alanlar:
#  sap: (x0, x1) sapın sol/sağ kenarı · kol: (y0, y1) kolun üst/alt kenarı · sag: kolun sağ ucu · alt: sapın alt ucu
#  dis: kolun sol üst dış köşesinin yarıçapı · ic: iç köşe yarıçapı · noktalar: [(cx, cy) sol, sağ] · cap: nokta çapı
#  nokta_n: noktanın biçimi (süper elips üssü; 2 = daire). 2-3 px'lik noktada daire köşe piksellerini söndürür (nokta soluk ve "+"
#  gibi okunur): 2 px'te 4, 3 px'te 3,4 — köşesi yumuşak dolgun nokta
# Oranlar işaretten (genişlik G, yükseklik Y): sap 0,30G · kol 0,255Y · nokta çapı 0,20G · sap→nokta 0,11G · noktalar arası
# 0,09G · sağ pay 0,11G · nokta merkezi 0,48Y. Her boyda tam piksele yuvarlanır. KURAL (nokta_araligi_denetle): iki nokta
# arasında, nokta satırlarında, işaretin HİÇ değmediği en az bir piksel sütunu vardır — noktalar asla birleşmez.
KUCUK_KARO = {
    16: dict(sap=(4, 6), kol=(3, 5), sag=12, alt=13, dis=2.2, ic=0.0, noktalar=[(8.0, 8.0), (11.0, 8.0)], cap=2.0, nokta_n=4.0),
    20: dict(sap=(5, 8), kol=(4, 7), sag=15, alt=16, dis=3.0, ic=0.5, noktalar=[(10.0, 10.0), (13.0, 10.0)], cap=2.0, nokta_n=4.0),
    24: dict(sap=(6, 9), kol=(5, 8), sag=18, alt=19, dis=3.6, ic=0.7, noktalar=[(11.5, 11.5), (15.5, 11.5)], cap=3.0, nokta_n=3.4),
    32: dict(sap=(9, 14), kol=(7, 12), sag=24, alt=25, dis=4.5, ic=1.0, noktalar=[(17.5, 16.5), (21.5, 16.5)], cap=3.0, nokta_n=3.4),
}
KUCUK_TEPSI = {
    16: dict(sap=(2, 5), kol=(1, 4), sag=14, alt=15, dis=3.0, ic=0.5, noktalar=[(7.5, 7.5), (11.5, 7.5)], cap=3.0, nokta_n=3.4),
    20: dict(sap=(3, 7), kol=(2, 6), sag=17, alt=19, dis=3.8, ic=0.7, noktalar=[(10.5, 10.5), (14.5, 10.5)], cap=3.0, nokta_n=3.4),
    24: dict(sap=(4, 9), kol=(2, 7), sag=20, alt=22, dis=4.8, ic=0.9, noktalar=[(12.5, 11.5), (16.5, 11.5)], cap=3.0, nokta_n=3.4),
    32: dict(sap=(4, 11), kol=(2, 9), sag=27, alt=30, dis=7.0, ic=1.4, noktalar=[(15.5, 15.5), (22.5, 15.5)], cap=5.0, nokta_n=2.3),
}


def isaret_izgara_parcalar(N: int, p: dict, ss: int = 16) -> list[np.ndarray]:
    """Izgaraya oturtulmuş işaret, kaynakla aynı sırada [F gövdesi, sağ nokta, sol nokta] (N*ss boyunda maskeler)."""
    R = N * ss
    u, v = kare_izgara(R)
    X, Y = u * N, v * N  # piksel birimi
    sx0, sx1 = p["sap"]
    ky0, ky1 = p["kol"]
    sag, alt, dis, ic = p["sag"], p["alt"], p["dis"], p["ic"]
    sap = (X >= sx0) & (X <= sx1) & (Y >= ky0) & (Y <= alt)
    kol = (X >= sx0) & (X <= sag) & (Y >= ky0) & (Y <= ky1)
    govde = sap | kol
    # Sol üst dış köşe: yarıçap `dis`.
    kx, ky = sx0 + dis, ky0 + dis
    disari = (X < kx) & (Y < ky) & ((X - kx) ** 2 + (Y - ky) ** 2 > dis * dis)
    govde &= ~disari
    # İç köşe (sapın sağı, kolun altı): küçük dolgu yarıçapı.
    if ic > 0:
        ix, iy = sx1 + ic, ky1 + ic
        dolgu = (X >= sx1) & (X < ix) & (Y >= ky1) & (Y < iy) & ((X - ix) ** 2 + (Y - iy) ** 2 > ic * ic)
        govde |= dolgu
    r, n = p["cap"] / 2, p.get("nokta_n", 2.0)
    nokta = lambda cx, cy: ((np.abs(X - cx) / r) ** n + (np.abs(Y - cy) / r) ** n <= 1).astype(np.float32)
    (solx, soly), (sagx, sagy) = p["noktalar"]
    return [govde.astype(np.float32), nokta(sagx, sagy), nokta(solx, soly)]


def isaret_izgara(N: int, p: dict, ss: int = 16) -> np.ndarray:
    """Izgaraya oturtulmuş işaret (N×N, ss kat örneklemeli; döndürülen dizi N*ss boyunda)."""
    return np.maximum.reduce(isaret_izgara_parcalar(N, p, ss))


def nokta_araligi_denetle(N: int, p: dict, ad: str) -> None:
    """İki nokta arasında, nokta satırlarında işaretin HİÇ değmediği en az bir piksel sütunu olmalı (24/32 px'te görülen
    "birleşik nokta" kusuru bir daha üretilmesin). Bozuksa üretim durur."""
    m = kucult(isaret_izgara(N, p, 16), 16)
    (x1, cy), (x2, _) = p["noktalar"]
    r = p["cap"] / 2
    sutunlar = list(range(math.ceil(x1 + r), math.floor(x2 - r)))
    satirlar = list(range(math.floor(cy - r), math.ceil(cy + r)))
    temiz = [c for c in sutunlar if np.all(m[satirlar, c] == 0)]
    if not temiz:
        raise AssertionError(f"{ad} {N} px: noktalar arasında boş sütun yok (sütunlar {sutunlar}, satırlar {satirlar}; "
                             f"kapsama {[[round(float(m[s, c]), 2) for c in range(math.floor(x1), math.ceil(x2))] for s in satirlar]})")


# ── Karo ve ışık ────────────────────────────────────────────────────────────────────────────────────────────────────

def karo_katmani(R: int, maske: np.ndarray, kucuk: bool) -> np.ndarray:
    """Siyah cam/seramik karo: dikey geçiş, üstten süzülen soğuk beyaz ışık, üst kenarda ince parlaklık, altta koyulaşma."""
    u, v = kare_izgara(R)
    ys = np.where(maske.any(axis=1))[0]
    ust, alt = (ys[0] + 0.5) / R, (ys[-1] + 0.5) / R
    t = np.clip((v - ust) / max(alt - ust, 1e-6), 0, 1)
    zemin = renk((24, 25, 30)) * (1 - t[..., None]) + renk((5, 5, 7)) * t[..., None]
    # Üstten süzülen ışık (tasarım dili: "üstten süzülen soğuk beyaz ışık").
    d = np.sqrt(((u - 0.5) / 0.62) ** 2 + ((v - (ust - 0.18)) / 0.62) ** 2)
    isik = np.clip(1 - d, 0, 1) ** 1.6 * (0.10 if kucuk else 0.17)
    zemin = zemin + renk((210, 220, 250)) * isik[..., None]
    k = katman(np.clip(zemin, 0, 1), maske)
    if kucuk:
        return k
    # Kenar ışığı: karonun içine 1 birimlik halka; üstte parlak, aşağı söner (cam kenarı).
    kalinlik = max(1, R // 170)
    ic = bulanik(maske, kalinlik * 0.8)
    halka = np.clip(maske - np.clip((ic - 0.5) * 6, 0, 1), 0, 1) * maske
    parlak = np.clip(1 - (v - ust) / max(alt - ust, 1e-6) * 1.6, 0.06, 1) * 0.30
    k = ustune(k, katman(renk((235, 240, 255)), halka * parlak))
    return k


# Kaynaktaki üç geçiş (sohbet.svg, userSpaceOnUse; işaret birimi): F gövdesi, sağ nokta, sol nokta — her parça KENDİ geçişiyle.
GECISLER = (((-6.24, 191.16), (61.09, -1.01)), ((29.43, 203.67), (96.77, 11.49)), ((3.6, 194.61), (70.94, 2.44)))


def gumus_dolgu(R: int, parcalar: list[np.ndarray], eslem) -> np.ndarray:
    """Markanın gümüş geçişi kaynaktaki gibi parça parça: `eslem(u, v)` tuval biriminden işaret birimine (101,07 × 123,41)."""
    u, v = kare_izgara(R)
    mx, my = eslem(u, v)
    toplam = np.zeros((R, R), dtype=np.float32)
    renkler = np.zeros((R, R, 3), dtype=np.float32)
    for m, ((x1, y1), (x2, y2)) in zip(parcalar, GECISLER):
        dx, dy = x2 - x1, y2 - y1
        t = np.clip(((mx - x1) * dx + (my - y1) * dy) / (dx * dx + dy * dy), 0, 1)
        renkler += (renk(GUMUS_1) * (1 - t[..., None]) + renk(GUMUS_2) * t[..., None]) * m[..., None]
        toplam += m
    return renkler / np.maximum(toplam, 1e-6)[..., None]


def isaret_katmani(R: int, parcalar: list[np.ndarray], eslem, kucuk: bool) -> np.ndarray:
    """Gümüş işaret (kaynağın parça parça geçişi), büyük boylarda üst kenarda ince ışık, alt kenarda gölge, üstte metal parıltısı."""
    u, v = kare_izgara(R)
    m = np.maximum.reduce(parcalar)
    ys = np.where(m.any(axis=1))[0]
    y0, y1 = ys[0] / R, ys[-1] / R
    gumus = gumus_dolgu(R, parcalar, eslem)
    if not kucuk:
        # Metal parıltısı: üst üçte bir hafifçe aydınlanır.
        parilti = np.clip(1 - (v - y0) / max(y1 - y0, 1e-6) / 0.45, 0, 1) ** 2 * 0.10
        gumus = np.clip(gumus + parilti[..., None], 0, 1)
    k = katman(gumus, m)
    if not kucuk:
        e = max(1, R // 300)
        ust_kenar = np.clip(m - kaydir(m, 0, e), 0, 1)
        alt_kenar = np.clip(m - kaydir(m, 0, -e), 0, 1)
        k = ustune(k, katman(renk((255, 255, 255)), ust_kenar * 0.55))
        k = ustune(k, katman(renk((70, 74, 88)), alt_kenar * 0.45))
    return k


def golge(R: int, m: np.ndarray, dy: float, yaricap: float, alfa: float) -> np.ndarray:
    g = kaydir(bulanik(m, yaricap), 0, int(round(dy)))
    return katman(renk((0, 0, 0)), g * alfa)


# ── Ürünler ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def uygulama_ikonu(N: int, izgara: str = "win") -> Image.Image:
    """Uygulama ikonu. izgara='win': karo tuvali doldurur (küçük boylarda tam piksel); 'mac': Big Sur ızgarası (824/1024)."""
    if izgara == "win" and N in KUCUK_KARO:
        return kucuk_uygulama_ikonu(N)
    ss = 8 if N <= 256 else 2
    R = N * ss
    if izgara == "mac":
        pay = 100 / 1024
        karo_m = superelips(R, pay, pay * 0.92, 1 - pay, 1 - pay * 1.08, n=5.0)
    else:
        pay = (1 if N <= 48 else 0.045 * N) / N
        karo_m = superelips(R, pay, pay * 0.8, 1 - pay, 1 - pay * 1.2, n=5.0)
    tuval = np.zeros((R, R, 4), dtype=np.float32)
    if N >= 64:
        # Karonun yere bastığı yumuşak gölge (tuval payının içinde kalır).
        tuval = ustune(tuval, golge(R, karo_m, dy=R * 0.012, yaricap=R * 0.016, alfa=0.38))
        tuval = ustune(tuval, golge(R, karo_m, dy=R * 0.004, yaricap=R * 0.004, alfa=0.30))
    tuval = ustune(tuval, karo_katmani(R, karo_m, kucuk=N < 64))
    # İşaret: karonun yüksekliğinin ~%54'ü; optik merkez (kütle sol üstte) için hafif sağa ve aşağı.
    ys = np.where(karo_m.any(axis=1))[0]
    k0, k1 = ys[0] / R, (ys[-1] + 1) / R
    kh = k1 - k0
    boy = kh * 0.54
    gen = boy * ISARET_G / ISARET_Y
    sol = 0.5 - gen / 2 + kh * 0.012
    ust = (k0 + k1) / 2 - boy / 2 + kh * 0.008
    if izgara == "win" and N <= 64:
        # Sapın sol ve kolun üst kenarı piksele otursun.
        sol = math.floor(sol * N) / N
        ust = math.floor(ust * N + 0.5) / N
    parcalar = isaret_vektor_parcalar(R, (sol, ust, boy))
    m = np.maximum.reduce(parcalar)
    olcek = boy / ISARET_Y
    tuval = ustune(tuval, golge(R, m, dy=R * 0.010, yaricap=R * 0.010, alfa=0.55))
    tuval = ustune(tuval, isaret_katmani(R, parcalar, lambda u, v: ((u - sol) / olcek, (v - ust) / olcek), kucuk=N < 64))
    return resim(kucult(tuval, ss))


def kucuk_uygulama_ikonu(N: int) -> Image.Image:
    ss = 16
    R = N * ss
    p = KUCUK_KARO[N]
    yari = {16: 3.2, 20: 4.0, 24: 4.8, 32: 6.4}[N] / N
    pay = 0 if N == 16 else 1 / N
    karo_m = yuvarlak_kare(R, pay, pay, 1 - pay, 1 - pay, yari)
    tuval = karo_katmani(R, karo_m, kucuk=True)
    # Üst kenarda tek piksellik ışık ve karo kenarında ince çizgi: koyu görev çubuğunda karo seçilsin.
    u, v = kare_izgara(R)
    ic = yuvarlak_kare(R, pay + 1 / N, pay + 1 / N, 1 - pay - 1 / N, 1 - pay - 1 / N, max(yari - 1 / N, 0.5 / N))
    kenar = np.clip(karo_m - ic, 0, 1)
    ust_isik = kenar * np.clip(1 - (v - pay) * N / 2.2, 0, 1)
    tuval = ustune(tuval, katman(renk((255, 255, 255)), kenar * 0.10 + ust_isik * 0.16))
    parcalar = isaret_izgara_parcalar(N, p, ss)
    m = np.maximum.reduce(parcalar)
    tuval = ustune(tuval, katman(renk((0, 0, 0)), kaydir(m, 0, ss // 2) * 0.45 * karo_m))
    # İşaret kutusu (sapın solu → kolun ucu, kolun üstü → sapın altı) işaretin kendi birimine eşlenir: geçiş kaynaktaki gibi.
    gx = (p["sap"][0], p["sag"])
    gy = (p["kol"][0], p["alt"])
    eslem = lambda u, v: ((u * N - gx[0]) / (gx[1] - gx[0]) * ISARET_G, (v * N - gy[0]) / (gy[1] - gy[0]) * ISARET_Y)
    tuval = ustune(tuval, isaret_katmani(R, parcalar, eslem, kucuk=True))
    return resim(kucult(tuval, ss))


def tepsi_ikonu(N: int, renk_: tuple[int, int, int]) -> Image.Image:
    """Tek renk işaret (karosuz): görev çubuğu tepsisi / menü çubuğu."""
    if N in KUCUK_TEPSI:
        ss = 16
        m = isaret_izgara(N, KUCUK_TEPSI[N], ss)
    else:
        ss = 8
        R = N * ss
        boy = 1 - 2 / N if N <= 48 else 0.92
        gen = boy * ISARET_G / ISARET_Y
        m = isaret_vektor(R, (math.floor((0.5 - gen / 2) * N) / N, (1 - boy) / 2, boy))
    return resim(kucult(katman(renk(renk_), m), ss))


def rozet_capi(N: int, taban: np.ndarray, kaydir: float) -> float:
    """Kurulum rozetinin çapı (piksel): varsayılandan başlar, işaretin (gümüş, parlak) hiçbir pikseline değmeyene dek küçülür — en az
    yarım piksel boşluk. Görev 23 (G22 küçüğü): 16 px'te 9 px'lik rozet sağ noktayı örtüyordu; 20–32 px'te de noktaya değiyordu."""
    parlak = (0.2126 * taban[..., 0] + 0.7152 * taban[..., 1] + 0.0722 * taban[..., 2]) > 0.32
    ys, xs = np.nonzero(parlak)
    cap = float({16: 9, 20: 10, 24: 12, 32: 15, 40: 18, 48: 21}.get(N, round(N * 0.42)))
    while cap > 5:
        r = cap / 2
        c = N - r - kaydir * N
        if np.all(np.sqrt((xs + 0.5 - c) ** 2 + (ys + 0.5 - c) ** 2) > r + 1.0):
            break
        cap -= 1
    return cap


def kurulum_ikonu(N: int) -> Image.Image:
    """Uygulama ikonu + sağ altta küçük mavi "indir" rozeti (mavi yalnız rozette). Rozet işarete (noktalara) hiç değmez (rozet_capi)."""
    taban = np.asarray(uygulama_ikonu(N, "win"), dtype=np.float32) / 255.0
    taban = np.concatenate([taban[..., :3] * taban[..., 3:4], taban[..., 3:4]], axis=-1)
    ss = 16 if N <= 48 else 8
    R = N * ss
    buyuk = np.repeat(np.repeat(taban, ss, axis=0), ss, axis=1)
    u, v = kare_izgara(R)
    kay = 0 if N <= 24 else 0.01
    cap = rozet_capi(N, taban, kay) / N
    cx, cy = 1 - cap / 2 - kay, 1 - cap / 2 - kay
    d = np.sqrt((u - cx) ** 2 + (v - cy) ** 2)
    halka = (d <= cap / 2).astype(np.float32)
    dolu = (d <= cap / 2 - max(1 / N, cap * 0.09)).astype(np.float32)
    rozet = ustune(katman(renk((8, 8, 10)), halka), katman(renk(MAVI), dolu))
    # Aşağı ok: dikey çizgi + iki kol (beyaz).
    k = cap * (0.11 if N >= 32 else 0.14)
    ok_y0, ok_y1 = cy - cap * 0.24, cy + cap * 0.20
    cizgi = (np.abs(u - cx) <= k / 2) & (v >= ok_y0) & (v <= ok_y1 - k * 0.3)
    kol = (np.abs((v - ok_y1) + np.abs(u - cx)) <= k * 0.75) & (np.abs(u - cx) <= cap * 0.22) & (v <= ok_y1 + k * 0.2)
    ok = (cizgi | kol).astype(np.float32) * dolu
    rozet = ustune(rozet, katman(renk((255, 255, 255)), ok))
    return resim(kucult(ustune(buyuk, rozet), ss))


# ── Dosya biçimleri ─────────────────────────────────────────────────────────────────────────────────────────────────

def ico_yaz(yol: Path, resimler: list[Image.Image]) -> None:
    """Çok boylu ICO: 256 PNG, altı 32 bit BMP (eski kabuk/derleyici araçlarıyla en uyumlu biçim)."""
    girdiler = []
    for im in sorted(resimler, key=lambda r: r.width):
        n = im.width
        if n >= 256:
            b = io.BytesIO()
            im.save(b, "PNG", optimize=True)
            veri = b.getvalue()
        else:
            a = np.asarray(im.convert("RGBA"), dtype=np.uint8)
            bgra = a[::-1, :, [2, 1, 0, 3]].tobytes()  # aşağıdan yukarı satırlar
            satir = ((n + 31) // 32) * 4
            maske = bytearray(satir * n)
            for yy in range(n):
                for xx in range(n):
                    if a[n - 1 - yy, xx, 3] == 0:
                        maske[yy * satir + xx // 8] |= 0x80 >> (xx % 8)
            baslik = struct.pack("<IiiHHIIiiII", 40, n, n * 2, 1, 32, 0, len(bgra) + len(maske), 0, 0, 0, 0)
            veri = baslik + bgra + bytes(maske)
        girdiler.append((n, veri))
    ofs = 6 + 16 * len(girdiler)
    dizin, govde = b"", b""
    for n, veri in girdiler:
        dizin += struct.pack("<BBBBHHII", 0 if n >= 256 else n, 0 if n >= 256 else n, 0, 0, 1, 32, len(veri), ofs + len(govde))
        govde += veri
    yol.write_bytes(struct.pack("<HHH", 0, 1, len(girdiler)) + dizin + govde)


def icns_yaz(yol: Path, boylar: dict[int, Image.Image]) -> None:
    """macOS .icns (PNG girdileri; 10.7+)."""
    turler = [("icp4", 16), ("icp5", 32), ("icp6", 64), ("ic07", 128), ("ic08", 256), ("ic09", 512), ("ic10", 1024),
              ("ic11", 32), ("ic12", 64), ("ic13", 256), ("ic14", 512)]
    govde = b""
    for tur, n in turler:
        b = io.BytesIO()
        boylar[n].save(b, "PNG", optimize=True)
        v = b.getvalue()
        govde += tur.encode("ascii") + struct.pack(">I", len(v) + 8) + v
    yol.write_bytes(b"icns" + struct.pack(">I", len(govde) + 8) + govde)


# ── Temas sayfası ───────────────────────────────────────────────────────────────────────────────────────────────────

def yazi_tipi(px: int):
    for ad in ("segoeuisb.ttf", "segoeui.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(ad, px)
        except OSError:
            continue
    return ImageFont.load_default()


def temas_sayfasi(yol: Path) -> None:
    """Her boy koyu (#202020) ve açık (#f3f3f3) görev çubuğunda: 1:1 ve 6× büyütülmüş (en yakın komşu)."""
    BOYLAR = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
    KOYU, ACIK = (32, 32, 32), (243, 243, 243)
    f, fk = yazi_tipi(22), yazi_tipi(15)
    tepsi = (16, 20, 24, 32, 40, 48)
    satirlar = [
        ("Uygulama ikonu (görev çubuğu, kısayol, Alt+Tab)", [uygulama_ikonu(n) for n in BOYLAR], (KOYU, ACIK)),
        ("Kurulum ikonu", [kurulum_ikonu(n) for n in BOYLAR[:7]], (KOYU, ACIK)),
        ("Tepsi — koyu görev çubuğu (beyaz) · açık görev çubuğu (mürekkep)", [tepsi_ikonu(n, (255, 255, 255)) for n in tepsi]
         + [tepsi_ikonu(n, (26, 26, 28)) for n in tepsi], None),
    ]
    G, Y = 2240, 2400
    s = Image.new("RGB", (G, Y), (14, 15, 18))
    c = ImageDraw.Draw(s)
    c.text((40, 28), "Fuber AI ikon ailesi — temas sayfası (scripts/ikon-uret.py)", fill=(236, 238, 243), font=f)
    y = 84
    for baslik, tum, zeminler in satirlar:
        c.text((40, y), baslik + "  ·  " + " ".join(str(i.width) for i in tum), fill=(190, 196, 208), font=fk)
        y += 28
        # Tepsi satırı: beyaz işaret yalnız koyu, mürekkep yalnız açık görev çubuğunda kullanılır.
        gruplar = [(z, tum) for z in zeminler] if zeminler else [(KOYU, tum[: len(tum) // 2]), (ACIK, tum[len(tum) // 2:])]
        # 1:1 — koyu ve açık görev çubuğu şeritleri yan yana (256'ya kadar gerçek boy).
        satir_boy = max(i.height for i in tum) + 24
        x = 40
        for zemin, ims in gruplar:
            gen = sum(i.width + 22 for i in ims) + 22
            c.rectangle([x, y, x + gen, y + satir_boy], fill=zemin)
            xx = x + 22
            for im in ims:
                s.paste(im, (xx, y + (satir_boy - im.height) // 2), im)
                xx += im.width + 22
            x += gen + 30
        y += satir_boy + 14
        # Büyütülmüş (≤ 48): 6× (≤ 24), 4× (32), 3× (40, 48) — en yakın komşu: her piksel görünür.
        x = 40
        bh = 0
        for zemin, ims in gruplar:
            for im in ims:
                if im.width > 48:
                    continue
                kat = 6 if im.width <= 24 else 4 if im.width <= 32 else 3
                b = im.resize((im.width * kat, im.height * kat), Image.NEAREST)
                c.rectangle([x, y, x + b.width + 16, y + b.height + 16], fill=zemin)
                s.paste(b, (x + 8, y + 8), b)
                x += b.width + 22
                bh = max(bh, b.height + 16)
            x += 30
        y += bh + 34
    # Büyük boylar ve macOS ızgarası
    c.text((40, y), "Büyük boylar (Windows 256 · macOS 1024 → 512 ölçekli) koyu ve açık masaüstünde", fill=(190, 196, 208), font=fk)
    y += 28
    win256 = uygulama_ikonu(256)
    mac = uygulama_ikonu(1024, "mac").resize((512, 512), Image.LANCZOS)
    x = 40
    for zemin in ((24, 26, 32), (236, 238, 243)):
        c.rectangle([x, y, x + 560 + 296, y + 552], fill=zemin)
        s.paste(win256, (x + 20, y + 20), win256)
        s.paste(mac, (x + 296, y + 20), mac)
        x += 560 + 296 + 40
    s.save(yol)


# ── Ana ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

def main() -> int:
    # 0.12: Fuber AI'nin ailesi scripts/ikon-uret.mjs'ten (mini logo). Bu betik yalnız Fuber Yönetim'in kütüphanesi; doğrudan
    # çalıştırılınca build/ ve resources/ikon/'a eski işareti YAZMAZ (eski aileye dönüş gerekirse git'ten).
    print("Fuber AI ikon ailesi artık: node scripts/ikon-uret.mjs  (bu dosya yalnız Fuber Yönetim'in kütüphanesi: "
          "scripts/yonetim-ikon-uret.py)", file=sys.stderr)
    return 2


def _eski_main() -> int:
    if len(sys.argv) >= 3 and sys.argv[1] == "--temas":
        temas_sayfasi(Path(sys.argv[2]))
        print("temas sayfası:", sys.argv[2])
        return 0
    # Önce kural: elle çizilmiş küçük boylarda iki nokta birleşmez (bozuksa hiçbir dosya yazılmaz).
    for ad, tablo in (("uygulama", KUCUK_KARO), ("tepsi", KUCUK_TEPSI)):
        for n, p in tablo.items():
            nokta_araligi_denetle(n, p, ad)
    ikon = KOK / "resources" / "ikon"
    build = KOK / "build"
    ikon.mkdir(parents=True, exist_ok=True)
    build.mkdir(exist_ok=True)
    WIN = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
    uyg = [uygulama_ikonu(n) for n in WIN]
    ico_yaz(build / "icon.ico", uyg)
    ico_yaz(ikon / "fuber.ico", uyg)
    ico_yaz(build / "kurulum.ico", [kurulum_ikonu(n) for n in WIN])
    uygulama_ikonu(512).save(ikon / "fuber.png")
    mac = {n: uygulama_ikonu(n, "mac") for n in (16, 32, 64, 128, 256, 512, 1024)}
    icns_yaz(build / "icon.icns", mac)
    mac[1024].save(build / "icon.png")
    TEPSI = [16, 20, 24, 32, 40, 48]
    ico_yaz(ikon / "tepsi-koyu.ico", [tepsi_ikonu(n, (255, 255, 255)) for n in TEPSI])
    ico_yaz(ikon / "tepsi-acik.ico", [tepsi_ikonu(n, (26, 26, 28)) for n in TEPSI])
    tepsi_ikonu(16, (0, 0, 0)).save(ikon / "tepsiTemplate.png")
    tepsi_ikonu(32, (0, 0, 0)).save(ikon / "tepsiTemplate@2x.png")
    print("ikon ailesi yazıldı:", build, ikon)
    return 0


if __name__ == "__main__":
    sys.exit(main())
