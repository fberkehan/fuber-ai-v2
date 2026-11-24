/**
 * Belge işçisinin ileti sözleşmesi. İşçi ana süreçten AYRI süreçte (Electron `utilityProcess`; sınamada
 * `worker_threads`) koşar: belge ayrıştırma ve Word/Excel/PowerPoint üretimi burada yapılır ki bozuk, dev ya da
 * kötü niyetli bir dosya ana süreci dondurmasın, belleğini doldurmasın. Bu dosya yalnız tip tanımlar.
 */

/** Okunabilen biçimler. `text`: düz metin, Markdown ve benzeri. */
export type DocFormat = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'pptx' | 'eml' | 'text';

/** Belgenin bir parçası: PDF'te sayfa, sunumda slayt, Excel'de çalışma sayfası, Word'de başlık altı bölüm. */
export interface DocSection {
  kind: 'page' | 'slide' | 'sheet' | 'part' | 'email';
  /** Kullanıcıya ve modele görünen ad: "Sayfa 3", "Slayt 2", "Sayfa: Ödemeler", "Giriş". */
  label: string;
  /** Sayfa/slayt numarası (1'den); yoksa sıra numarası. */
  index: number;
  text: string;
}

export interface DocMeta {
  /** PDF sayfa sayısı, sunum slayt sayısı ya da Excel çalışma sayfası sayısı. */
  pages?: number;
  author?: string;
  subject?: string;
  /** ISO 8601. */
  created?: string;
  modified?: string;
  /** E-posta: gönderen, alıcı, tarih, ek adları. */
  from?: string;
  to?: string;
  date?: string;
  attachments?: string[];
}

/** Taranmış PDF sayfasının görüntüsü (yalnız istenince; derin beyne görüntü olarak gider). */
export interface PageImage {
  page: number;
  mediaType: 'image/png';
  /** base64 */
  data: string;
}

export interface ParseRequest {
  op: 'parse';
  path: string;
  /** Tutulacak en çok karakter; fazlası sayılır ama tutulmaz (`truncated`). */
  maxChars: number;
  /** ZIP tabanlı biçimlerde (docx, xlsx, pptx) parça sayısı ve açılmış toplam boyut sınırı. */
  zip?: { maxEntries: number; maxInflated: number };
  /** Excel: sayfa başına satır, toplam hücre. */
  xlsx?: { maxRows: number; maxCells: number };
  /** Taranmış PDF için şu sayfaların görüntüsünü de üret (en çok 3). */
  renderPages?: number[];
}

/** Word, Excel ve PowerPoint üretimi; içerik `schema.ts` ile doğrulanmış olmalıdır. */
export interface GenerateRequest {
  op: 'generate';
  format: 'docx' | 'xlsx' | 'pptx';
  content: GenerateContent;
}

export interface TextContent {
  title?: string;
  sections: Array<{ heading?: string; paragraphs?: string[]; table?: string[][] }>;
}
export interface SheetContent {
  sheets: Array<{ name: string; rows: Array<Array<string | number>> }>;
}
export interface SlideContent {
  title?: string;
  slides: Array<{ title: string; bullets: string[] }>;
}
export type GenerateContent = TextContent | SheetContent | SlideContent;

export type ErrorCode = 'limit' | 'corrupt' | 'encrypted' | 'unsupported' | 'legacy';

export type ParseResponse =
  | {
      ok: true;
      format: DocFormat;
      title: string | null;
      sections: DocSection[];
      /** Belgedeki gerçek metin uzunluğu (tutulmayan kısım dahil). */
      totalChars: number;
      truncated: boolean;
      meta: DocMeta;
      /** PDF'te metin katmanı yok (taranmış belge). */
      scanned?: boolean;
      /** Sınıra ulaşılınca okunmayan kısım hakkında not ("son 4 slayt okunmadı"). */
      note?: string;
      images?: PageImage[];
    }
  | { ok: false; code: ErrorCode; error: string };

export type GenerateResponse = { ok: true; data: Uint8Array } | { ok: false; code: 'corrupt'; error: string };

export type WorkerRequest = (ParseRequest | GenerateRequest) & { id: number };
export type WorkerResponse = (ParseResponse | GenerateResponse) & { id: number };
