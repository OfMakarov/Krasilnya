// Мостик между окном и программой: страница узнаёт, что запущена как приложение,
// и получает файлы, открытые двойным кликом. Больше страница ничего не может.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('krDesktop', {
  onOpenFile: (cb) => ipcRenderer.on('open-file', (e, name, bytes) => cb(name, bytes)),
  ready: () => ipcRenderer.send('kr-ready'),
  // v2: оболочка сама спрашивает «Уйти/Остаться» и сообщает, сохранился ли файл
  v: 2,
  onDownloadDone: (cb) => ipcRenderer.on('download-done', (e, name, ok) => cb(name, ok)),
});
