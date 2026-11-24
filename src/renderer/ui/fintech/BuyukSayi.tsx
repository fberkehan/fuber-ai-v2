// Büyük sayı (fintech): kredi, süre, sayaç gibi değerler büyük ve net — tabular rakam, yanında küçük birim, altında tek satır etiket.
// Düz renk (0.12 H3a düzeltme turu 1: sayıdaki gümüş geçiş ilk sayıyı "devre dışı" gibi gösteriyordu; geçiş YALNIZ Fuber işaretinde).
export function BuyukSayi({ deger, birim, etiket }: { deger: string | number; birim?: string; etiket?: string }) {
  const metin = typeof deger === 'number' ? deger.toLocaleString('tr-TR') : deger;
  return (
    <div className="ft-buyuk-sayi">
      <span className="ft-buyuk-sayi__deger"><span className="ft-buyuk-sayi__sayi">{metin}</span>{birim && <span className="ft-buyuk-sayi__birim">{birim}</span>}</span>
      {etiket && <span className="ft-buyuk-sayi__etiket">{etiket}</span>}
    </div>
  );
}
