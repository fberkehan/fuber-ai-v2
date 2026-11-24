// Belge modülünün kendi IPC kanalları ve olayları (çekirdek sözleşmeye dokunmadan; TUZAKLAR §1). Sohbet sayfası ve
// Ayarlar bu dosyayı `import type` ile içe aktarır.
import type { ChatAttachment, Id, Ok } from '@fuber/shared';

/** Okumanın serbest olduğu bir klasör. */
export interface FolderEntry {
  path: string;
  /** Görünen ad: "Belgeler", "Masaüstü" ya da klasör adı. */
  label: string;
  /** `default` Belgeler/Masaüstü/İndirilenler · `user` kullanıcı ekledi · `external` başka bir modülün izin verdiği klasör. */
  source: 'default' | 'user' | 'external';
  exists: boolean;
}

export interface FoldersView {
  read: FolderEntry[];
  /** Kapatılmış varsayılan klasörler (yeniden açılabilir). */
  disabledDefaults: FolderEntry[];
  /** Üretilen belgelerin yazıldığı tek klasör. */
  output: string;
  outputIsDefault: boolean;
}

export interface AttachResult {
  attachments: ChatAttachment[];
  /** Kabul edilmeyen dosyalar ve tek satırlık neden. */
  rejected: Array<{ name: string; reason: string }>;
}

/** Sürükle-bırak ya da yapıştırmayla gelen dosya (renderer dosya yolunu bilmez; içerik gönderilir). */
export interface DroppedFile {
  name: string;
  type: string;
  data: Uint8Array;
}

declare module '@fuber/shared' {
  interface Api {
    /** İzinli klasörler ve çıktı klasörü. */
    'documents.folders': { req: void; res: FoldersView };
    /** İzinli klasör ekler. `path` yoksa klasör seçme penceresi açılır (vazgeçilirse liste aynen döner). */
    'documents.addFolder': { req: { path?: string }; res: FoldersView };
    /** İzinli klasörü kaldırır; varsayılan klasörler kapatılır (`restore` ile geri açılır). */
    'documents.removeFolder': { req: { path: string }; res: FoldersView };
    'documents.restoreFolder': { req: { path: string }; res: FoldersView };
    /** Çıktı klasörünü seçer; `path` yoksa seçme penceresi. `reset: true` varsayılana döner. */
    'documents.setOutput': { req: { path?: string; reset?: boolean }; res: FoldersView };
    /** Çıktı klasörünü Dosya Gezgini'nde açar. */
    'documents.openOutput': { req: void; res: Ok };
    /** Dosya seçme penceresiyle ek seçer (çoklu). */
    'documents.pickAttachments': { req: void; res: AttachResult };
    /** Sürüklenen ya da yapıştırılan dosyaları ek yapar. */
    'documents.attachFiles': { req: { files: DroppedFile[] }; res: AttachResult };
    /** Gönderilmemiş eki atar. */
    'documents.discardAttachment': { req: { id: Id }; res: Ok };
  }
  interface BusEvents {
    /**
     * Başka bir modülün okunmasına izin verdiği dosyaların klasörleri. `source` başına son liste geçerlidir.
     * Modüller birbirini içe aktarmaz: izin veren modül bu olayı kendi tip genişletmesinde de bildirir.
     */
    'documents.allowPaths': { source: string; paths: string[] };
    /** Belge modülü açılınca yayınlar: izin veren modüller listelerini yeniden göndersin. */
    'documents.allowPaths.request': Record<string, never>;
  }
}
