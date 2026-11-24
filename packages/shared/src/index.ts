/**
 * `@fuber/shared`: iki uygulamanın ve bütün modüllerin ortak sözleşmeleri.
 * Ortama bağlı (Electron, DOM, Node'a özgü) hiçbir şey içermez; her süreçten içe aktarılabilir.
 */

export * from './constants';
export * from './entities';
export * from './module';
export * from './services';
export * from './events';
export * from './ipc';
export * from './ipc-admin';
export * from './ipc-dispatch';
export * from './local-models';
export * from './tts-engines';
export * from './policy';
export * from './cloud-providers';
export * from './settings';
export * from './control-api';
export * from './i18n/index';
export * from './sentence-splitter';
export * from './search';
export * from './similarity';
export * from './time';
export * from './tr-time';
export * from './ids';
export * from './dashboard';
export * from './lifecycle';
