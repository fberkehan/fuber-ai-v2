// Bos (0.11 G3): boş ya da hata hâli — kısa başlık, isteğe bağlı açıklama ve tek eylem ("Yeniden dene", "Hatırlatıcı kur"). Kartın
// gövdesini doldurur ve ortalanır; başlık en çok 2, açıklama en çok 3 satır.
// 0.14 T30 (11 Kas gözler): `karakter` (kip) verilirse başlığın üstünde gözler (siyah sahnede, durağan) ve yalnız tek satır başlık — açıklama çizilmez.
// İsteğe bağlıdır: verilmeyen boş durumlar (kart içleri) değişmez. Sade modda GorunenGoz göz çizmez, nötr işaret çizer (T6b).
import { isValidElement, type ReactElement } from 'react';
import type { KipKimligi } from '../../shared/karakterler';
import { Dugme } from './Dugme';
import { MetinKirp } from './MetinKirp';
import { GorunenGoz } from './goz/GorunenGoz';
import type { Eylem } from './Kart';
import './ui.css';

/** `karakter` ile `metin` birlikte verilemez (karakterli boş durum tek satırdır; açıklama sessizce düşmesin diye türde yasak). */
export type BosOzellikleri = {
  baslik: string;
  eylem?: Eylem | ReactElement;
} & (
  | { metin?: string; karakter?: undefined }
  /** Boş durumda gösterilecek gözlerin kipi (parıltı: Business turuncu, Developer yeşil). */
  | { karakter: KipKimligi; metin?: never }
);

export const BOS_KARAKTER_PX = 72;

export function Bos({ baslik, metin, eylem, karakter }: BosOzellikleri) {
  return (
    <div className="ui-bos" data-karakterli={karakter ? '' : undefined}>
      {karakter && <span className="ui-bos__karakter"><GorunenGoz kip={karakter} boyut={BOS_KARAKTER_PX} /></span>}
      <div className="ui-bos__baslik"><MetinKirp metin={baslik} satir={2} /></div>
      {metin && !karakter && <div className="ui-bos__metin"><MetinKirp metin={metin} satir={3} /></div>}
      {eylem && (
        <div className="ui-bos__eylem">
          {isValidElement(eylem) ? eylem : <Dugme tur="ikincil" boyut="k" onClick={(eylem as Eylem).tikla}>{(eylem as Eylem).etiket}</Dugme>}
        </div>
      )}
    </div>
  );
}
