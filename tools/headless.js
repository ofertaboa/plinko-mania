/* Smoke test com Chrome headless: DOM visivel + erros de console/404 em cada rota.
   Uso: node tools\headless.js            (todas as rotas de tools/routes.json)
        node tools\headless.js / /jogar   (rotas especificas)                      */
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');

const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
  .find(p => fs.existsSync(p));
const PORT = process.env.PORT || 8080;
const SITE = process.env.SITE || ('http://localhost:' + PORT);

const routes = process.argv.slice(2).filter(a => !a.startsWith('--'));
const list = routes.length ? routes : JSON.parse(fs.readFileSync(path.join(__dirname, 'routes.json'), 'utf8'));

const noise = /AudioContext|beforeinstallprompt|preloaded using link|Download the React DevTools|favicon|manifest\.webmanifest.*Fail|third-party|err_blocked|service worker|Web Push|Notification/;

let fails = 0;
for (const r of list) {
  const url = SITE + (r === '/' ? '/' : r);
  const tag = (r.replace(/[^a-z0-9]/gi, '') || 'home');
  const res = spawnSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--virtual-time-budget=15000', '--timeout=25000',
    '--user-data-dir=' + path.join(os.tmpdir(), 'pm_' + tag),
    '--enable-logging=stderr', '--v=0', '--dump-dom', url
  ], { encoding: 'utf8', timeout: 90000, maxBuffer: 64 * 1024 * 1024 });

  const html = res.stdout || '';
  const log = res.stderr || '';
  const errs = log.split(/\r?\n/)
    .filter(l => /CONSOLE|ERROR:CONSOLE|Failed to load resource/.test(l))
    .filter(l => !noise.test(l))
    .map(l => l.replace(/^.*?(CONSOLE|Failed to load resource)\s*/, '').trim());

  const visible = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
  const blank = visible < 60;
  const bad = errs.length > 0 || blank || !html;
  if (bad) fails++;
  console.log((bad ? 'FALHA ' : 'OK    ') + String(r).padEnd(22) +
    ' dom=' + String(html.length).padStart(6) + ' texto=' + String(visible).padStart(5) +
    (blank ? '  [BRANCO]' : '') + (errs.length ? '  erros=' + errs.length : ''));
  errs.slice(0, 5).forEach(e => console.log('        ' + e.slice(0, 300)));
}
console.log('\nfalhas: ' + fails + ' / ' + list.length);
process.exit(fails ? 1 : 0);
