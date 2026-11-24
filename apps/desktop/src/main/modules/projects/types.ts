// Projeler modülünün kendi IPC kanalları ve olayları (çekirdek `Api`'ye tip genişletmesiyle eklenir).
// Sayfa da bu dosyayı `import type` ile alır; burada Node'a özgü hiçbir şey olmamalı.
import type { CodeSession, CodeSessionHit, CodeSessionMessage, Project } from '@fuber/shared';

/** Kullanıcının değiştirebildiği modül ayarları (cihazda kalır). */
export interface ProjectsConfig {
  /** `Settings.projectsRoot` dışındaki ek tarama kökleri. */
  extraRoots: string[];
  /** Claude Code oturum klasörü; boş = `~/.claude/projects`. */
  claudeDir: string;
  /** Tarama derinliği (kökten itibaren klasör düzeyi). */
  scanDepth: number;
  /** Oturum bitince bildirim. */
  notifyOnFinish: boolean;
  /** Son yanıttan sonra dosya bu kadar saniye büyümezse oturum "bitti" sayılır. */
  finishIdleSeconds: number;
  /** Yalnız son bu kadar dakikada etkin olmuş oturumlar için bildirim. */
  finishActiveMinutes: number;
  /** Terminalde çalıştırılacak Claude Code komutu (`claude`). Sınamada zararsız bir komutla değiştirilir. */
  claudeCommand: string[];
}

export type ProjectSource = 'scan' | 'claude';

/** Sayfanın gördüğü proje: sözleşmedeki alanlar + takma adlar ve git dalı. */
export interface ProjectDetail extends Project {
  aliases: string[];
  gitBranch: string | null;
  lastOpenedAt: string | null;
  source: ProjectSource;
}

export interface SessionRow extends CodeSession {
  archived: boolean;
  /** İlk kullanıcı isteği (liste satırının ikinci satırı). */
  preview: string | null;
  projectName: string | null;
}

export interface SessionHitDetail extends CodeSessionHit {
  session: SessionRow;
  /** Eşleşen iletinin oturum içindeki sırası (ön izleme buraya kaydırılır); başlık eşleşmesinde `null`. */
  matchSeq: number | null;
}

export interface SessionMessage extends CodeSessionMessage {
  seq: number;
}

export interface SessionQuery {
  query?: string;
  projectId?: string;
  category?: string;
  pinnedOnly?: boolean;
  includeArchived?: boolean;
  /** Bu andan sonra etkin olanlar (ISO). */
  since?: string;
  limit: number;
  offset?: number;
}

export interface IndexStatus {
  state: 'idle' | 'indexing' | 'error';
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  sessions: number;
  messages: number;
  lastIndexedAt: string | null;
  lastDurationMs: number | null;
  error: string | null;
  claudeDir: string;
}

declare module '@fuber/shared' {
  interface Api {
    'projects.config': { req: { patch?: Partial<ProjectsConfig> }; res: ProjectsConfig };
    'projects.indexStatus': { req: void; res: IndexStatus };
    'projects.listDetailed': { req: { query?: string }; res: ProjectDetail[] };
    'projects.setAliases': { req: { id: string; aliases: string[] }; res: ProjectDetail };
    'projects.findSessions': {
      req: SessionQuery;
      res: { items: SessionRow[]; hits: SessionHitDetail[] | null; total: number };
    };
    'projects.sessionMessages': {
      req: { id: string; around?: number; offset?: number; limit: number };
      res: { total: number; offset: number; messages: SessionMessage[] };
    };
    'projects.archiveSession': { req: { id: string; archived: boolean }; res: SessionRow };
  }
  interface BusEvents {
    'projects.indexProgress': IndexStatus;
  }
  interface WindowEvents {
    'projects.indexProgress': IndexStatus;
  }
}
