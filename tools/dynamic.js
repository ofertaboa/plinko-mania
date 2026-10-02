/* Captura as requisições reais de cada rota (Chrome netlog) e baixa do origin
   tudo que a página pediu mas não existe localmente (chunks dinâmicos, imagens,
   áudios, vídeos, /_next/image, etc). Rodar com o servidor local ligado.
   Uso: node tools\dynamic.js [/rota ...]                                  */
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path'), os = require('os'),
  https = require('https'), http = require('http');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://plinkopremiado.online';
const PORT = process.env.PORT || 8080;
const SITE = 'http://localhost:' + PORT;
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(p => fs.existsSync(p));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MIME_EXT = { 'text/html': '.html', 'text/css': '.css', 'text/javascript': '.js', 'application/javascript': '.js' };

const routes = process.argv.slice(2).filter(a => !a.startsWith('--'));
const list = routes.length ? routes : JSON.parse(fs.readFileSync(path.join(__dirname, 'routes.json'), 'utf8'));

function get(url, bin) {
  return new Promise((res, rej) => {
    const mod = url.startsWith('https') ? https : http;
    const r = mod.get(url, { headers: { 'user-agent': UA, accept: '*/*' }, timeout: 60000 }, s => {
      if (s.statusCode >= 300 && s.statusCode < 400 && s.headers.location)
        return res(get(new URL(s.headers.location, url).href, bin));
      if (s.statusCode !== 200) { s.resume(); return rej(new Error(url + ' -> ' + s.statusCode)); }
      const c = []; s.on('data', d => c.push(d));
      s.on('end', () => res(bin ? Buffer.concat(c) : Buffer.concat(c).toString('utf8')));
    });
    r.on('error', rej); r.on('timeout', () => r.destroy(new Error('timeout')));
  });
}

function localHas(p) {
  const clean = p.split('?')[0].split('#')[0];
  if (!clean || clean.endsWith('/')) return fs.existsSync(path.join(ROOT, clean, 'index.html'));
  return fs.existsSync(path.join(ROOT, clean));
}

function saveLocal(p, buf) {
  const clean = p.split('?')[0].split('#')[0].replace(/^\/+/, '');
  const dest = path.join(ROOT, clean);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

function capture(route) {
  const netlog = path.join(os.tmpdir(), 'pm_netlog_' + Date.now() + '.json');
  const url = SITE + (route === '/' ? '/' : route);
  spawnSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--virtual-time-budget=20000', '--timeout=30000',
    '--user-data-dir=' + path.join(os.tmpdir(), 'pmnet_' + route.replace(/[^a-z0-9]/gi, '')),
    '--log-net-log=' + netlog, '--net-log-capture-mode=IncludeSensitive',
    '--enable-logging=stderr', '--v=0', '--dump-dom', url
  ], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });

  const urls = new Set();
  try {
    const txt = fs.readFileSync(netlog, 'utf8');
    const re = /"url":"(http:\/\/localhost:[0-9]+[^"]*)"/g;
    let m; while ((m = re.exec(txt))) urls.add(JSON.parse('"' + m[1] + '"'));
    fs.unlinkSync(netlog);
  } catch (e) { console.log('  netlog falhou:', e.message); }
  return [...urls];
}

(async () => {
  const wanted = new Set();
  for (const r of list) {
    console.log('PAGE ', r);
    for (const u of capture(r)) {
      let p;
      try { p = new URL(u).pathname; } catch (e) { continue; }
      if (p.startsWith('/api/') || p === '/' || p.endsWith('/')) continue;
      if (!localHas(p)) wanted.add(p);
    }
  }
  console.log('\nfaltando local:', wanted.size);
  for (const p of [...wanted].sort()) {
    try {
      const buf = await get(ORIGIN + p, true);
      saveLocal(p, buf);
      console.log('BAIXOU', p, buf.length);
    } catch (e) {
      console.log('NAO EXISTE NA ORIGEM', p, '-', e.message.split(' -> ')[1] || e.message);
    }
  }
  // segunda rodada: baixar novos chunks podem referenciar outros
  for (let round = 0; round < 3; round++) {
    const still = new Set();
    for (const r of list) {
      for (const u of capture(r)) {
        let p; try { p = new URL(u).pathname; } catch (e) { continue; }
        if (p.startsWith('/api/') || p === '/' || p.endsWith('/')) continue;
        if (!localHas(p)) still.add(p);
      }
    }
    if (!still.size) break;
    console.log('\nround', round + 1, 'faltando:', still.size);
    for (const p of [...still].sort()) {
      try { const buf = await get(ORIGIN + p, true); saveLocal(p, buf); console.log('BAIXOU', p, buf.length); }
      catch (e) { console.log('NAO EXISTE NA ORIGEM', p); }
    }
  }
  console.log('\nDONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
