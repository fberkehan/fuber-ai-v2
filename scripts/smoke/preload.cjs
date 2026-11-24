// Kum havuzlu preload: uygulamadaki port teslim kalıbının aynısı.
// contextBridge MessagePort taşıyamadığı için port sayfaya window.postMessage ile aktarılır.
const { contextBridge, ipcRenderer } = require('electron');

ipcRenderer.on('fuber:port', (event, name) => {
  window.postMessage({ fuberPort: name }, '*', event.ports);
});

contextBridge.exposeInMainWorld('smoke', {
  report: (result) => ipcRenderer.send('smoke:page-result', result),
});
