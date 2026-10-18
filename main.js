// Красильня — оболочка для Windows.
// Сама Красильня живёт в одном файле krasilnya.html. Приложение показывает его в окне,
// раздаёт библиотеки (three.js, JSZip) из своей папки, чтобы всё работало без интернета,
// и при запуске проверяет на GitHub, не вышла ли новая версия файла.

const { app, BrowserWindow, protocol, net, session, dialog, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const CFG = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); }
  catch (e) { return {}; }
})();

const DEV = !app.isPackaged;
const BUNDLED = DEV ? path.join(__dirname, 'krasilnya.html') : path.join(process.resourcesPath, 'krasilnya.html');
const PAGE_DIR = path.join(app.getPath('userData'), 'page');
const PAGE = path.join(PAGE_DIR, 'krasilnya.html');
const META = path.join(PAGE_DIR, 'meta.json');
const MARKER = '<title>Красильня</title>';

// CDN-адреса из krasilnya.html → файлы из node_modules внутри приложения
const NM = path.join(__dirname, 'node_modules');
const VENDOR = [
  ['https://cdn.jsdelivr.net/npm/three@0.147.0/', path.join(NM, 'three')],
  ['https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/', path.join(NM, 'jszip', 'dist')],
];

let win = null;
let pendingFile = null;
let pageReady = false;
let lastDir = null;

const sha = (txt) => crypto.createHash('sha1').update(txt).digest('hex');
const readMeta = () => { try { return JSON.parse(fs.readFileSync(META, 'utf8')); } catch (e) { return {}; } };
const writeMeta = (m) => { try { fs.writeFileSync(META, JSON.stringify(m, null, 2)); } catch (e) {} };

// Какой файл показывать: в режиме разработки — прямо из папки проекта,
// в установленной программе — копию в профиле пользователя (её и обновляем).
function pagePath() {
  if (DEV) return BUNDLED;
  try {
    fs.mkdirSync(PAGE_DIR, { recursive: true });
    const bundled = fs.readFileSync(BUNDLED, 'utf8');
    const meta = readMeta();
    const bSha = sha(bundled);
    // новая установка (или первый запуск) приносит свою версию — она главнее старого кэша
    if (!fs.existsSync(PAGE) || meta.bundledSha !== bSha) {
      fs.writeFileSync(PAGE, bundled);
      writeMeta({ bundledSha: bSha, sha: bSha, source: 'bundled', at: new Date().toISOString() });
    }
    return PAGE;
  } catch (e) {
    return BUNDLED;
  }
}

async function checkUpdate(manual) {
  const url = CFG.updateUrl;
  if (!url || (DEV && !CFG.updateInDev)) {
    if (manual) dialog.showMessageBox(win, { type: 'info', message: 'В режиме разработки обновления не проверяются', detail: 'Здесь открывается krasilnya.html прямо из папки проекта.' });
    return;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await net.fetch(url + '?t=' + Date.now(), { bypassCustomProtocolHandlers: true, signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) throw new Error('GitHub ответил ' + res.status);
    const txt = await res.text();
    if (!txt.includes(MARKER) || txt.length < 5000) throw new Error('файл на GitHub не похож на Красильню');
    const cur = fs.existsSync(PAGE) ? fs.readFileSync(PAGE, 'utf8') : '';
    if (sha(txt) === sha(cur)) {
      if (manual) dialog.showMessageBox(win, { type: 'info', message: 'У тебя последняя версия Красильни' });
      return;
    }
    fs.writeFileSync(PAGE + '.new', txt);
    fs.renameSync(PAGE + '.new', PAGE);
    writeMeta({ ...readMeta(), sha: sha(txt), source: 'github', at: new Date().toISOString() });
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Перезапустить сейчас', 'Позже'],
      defaultId: 0,
      cancelId: 1,
      title: 'Красильня обновилась',
      message: 'Скачана новая версия Красильни',
      detail: 'Перезапустить сейчас? Несохранённая работа на холсте пропадёт. Если выбрать «Позже», новая версия откроется при следующем запуске.',
    });
    if (response === 0 && win) win.loadFile(PAGE);
  } catch (e) {
    if (manual) dialog.showMessageBox(win, { type: 'warning', message: 'Не получилось проверить обновления', detail: String(e && e.message || e) });
  }
}

function sendFile(file) {
  if (!win || !pageReady) { pendingFile = file; return; }
  fs.readFile(file, (err, buf) => {
    if (err) { dialog.showMessageBox(win, { type: 'warning', message: 'Не удалось открыть файл', detail: file }); return; }
    win.webContents.send('open-file', path.basename(file), new Uint8Array(buf));
  });
}

function fileFromArgs(argv) {
  return argv.slice(1).find((a) => /\.(kras|glb|gltf|obj|png|jpe?g|webp)$/i.test(a) && fs.existsSync(a)) || null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#16171c',
    title: 'Красильня',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });

  // внешние ссылки — в обычный браузер
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (/^https?:/.test(url)) { e.preventDefault(); shell.openExternal(url); } });

  // если скачанная версия вдруг сломана — открываем ту, что пришла с установкой
  win.webContents.on('did-fail-load', () => { if (win.webContents.getURL().indexOf(BUNDLED) === -1) win.loadFile(BUNDLED); });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if (input.key === 'F12' || (ctrl && input.shift && input.key.toLowerCase() === 'i')) { win.webContents.toggleDevTools(); e.preventDefault(); }
    else if (input.key === 'F5' || (ctrl && input.key.toLowerCase() === 'r')) { pageReady = false; win.webContents.reload(); e.preventDefault(); }
    else if (ctrl && input.key.toLowerCase() === 'u') { checkUpdate(true); e.preventDefault(); }
  });

  win.webContents.on('did-start-loading', () => { pageReady = false; });
  win.loadFile(pagePath());
}

// «Сохранить как…» для всего, что Красильня отдаёт на скачивание
function setupDownloads() {
  session.defaultSession.on('will-download', (e, item) => {
    const name = item.getFilename();
    const ext = path.extname(name).slice(1).toLowerCase();
    const filters = ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'Все файлы', extensions: ['*'] }] : [];
    const target = dialog.showSaveDialogSync(win, {
      title: 'Сохранить',
      defaultPath: path.join(lastDir || app.getPath('documents'), name),
      filters,
    });
    if (!target) { item.cancel(); return; }
    lastDir = path.dirname(target);
    item.setSavePath(target);
  });
}

// подмена CDN на локальные файлы: three.js и JSZip работают без интернета
function setupVendor() {
  protocol.handle('https', async (req) => {
    const url = req.url.split('?')[0];
    for (const [prefix, dir] of VENDOR) {
      if (url.startsWith(prefix)) {
        const file = path.join(dir, decodeURIComponent(url.slice(prefix.length)));
        if (file.startsWith(dir)) {
          try {
            const buf = await fs.promises.readFile(file);
            return new Response(buf, { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
          } catch (e) { /* нет локально — пробуем сеть */ }
        }
      }
    }
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });
}

ipcMain.on('kr-ready', () => {
  pageReady = true;
  if (pendingFile) { const f = pendingFile; pendingFile = null; sendFile(f); }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    const f = fileFromArgs(argv);
    if (f) sendFile(f);
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    setupVendor();
    setupDownloads();
    pendingFile = fileFromArgs(process.argv);
    createWindow();
    setTimeout(() => checkUpdate(false), 2500);
  });

  app.on('window-all-closed', () => app.quit());
}
