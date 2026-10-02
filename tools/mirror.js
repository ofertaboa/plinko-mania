/* Crawler estatico: baixa HTML, JS/CSS, imagens, audios, videos (mp4/hls) do origin */
const fs = require('fs'), path = require('path'), https = require('https'), http = require('http');

const ORIGIN = 'https://plinkopremiado.online';
const OUT = path.resolve(__dirname, '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CONC = Number(process.env.CONC || 8);
const MAX_REQ = Number(process.env.MAX_REQ || 20000);

const ASSET_RE = /\.(png|jpe?g|webp|gif|svg|ico|bmp|avif|mp3|m4a|aac|wav|ogg|opus|mp4|m4v|webm|mov|mkv|m3u8|mpd|ts|m4s|woff2?|ttf|otf|eot|css|js|json|txt|xml|map|webmanifest|pdf|wasm)(\?|$)/i;
const TEXT_RE = /\.(js|css|m3u8|mpd|json|txt|xml|map|webmanifest|svg|html)(\?|$)/i;
const SKIP_PREFIX = /^\/(_next\/|api\/|_vercel\/|_nuxt\/|node_modules\/)/;

const queue = [];
const seen = new Set();
const routes = new Set();       // rotas HTML confirmadas
const candidates = new Set();   // candidatos a rota (a validar)
const externals = new Set();    // URLs fora do origin referenciadas como assets
const missing = new Set();      // refs que deram 404 na origem
const saved = new Set();
let reqCount = 0;
let failCount = 0;

function get(url, opt = {}) {
  return new Promise((resolve, reject) => {
    if (reqCount++ > MAX_REQ) return reject(new Error('MAX_REQ'));
    const mod = url.startsWith('https') ? https : http;
    const headers = { 'user-agent': UA, accept: '*/*', 'accept-language': 'pt-BR,pt;q=0.9' };
    if (opt.rsc) { headers.rsc = '1'; headers['next-router-state-tree'] = '%5B%22%22%2C%7B%7D%5D'; }
    const r = mod.get(url, { headers, timeout: 60000 }, (s) => {
      const st = s.statusCode, hd = s.headers;
      if (st >= 300 && st < 400 && hd.location) {
        s.resume();
        return resolve(get(new URL(hd.location, url).href, opt));
      }
      if (opt.headOnly) { s.resume(); return resolve({ status: st, headers: hd, buf: Buffer.alloc(0) }); }
      const c = [];
      s.on('data', d => c.push(d));
      s.on('end', () => resolve({ status: st, headers: hd, buf: Buffer.concat(c) }));
    });
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('timeout ' + url)));
  });
}

function save(rel, buf) {
  const p = path.join(OUT, rel.replace(/^\/+/, ''));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) { fs.writeFileSync(p, buf); saved.add(rel); }
  return p;
}

function outPathFor(urlPath, isHtml) {
  const clean = urlPath.split('?')[0].split('#')[0];
  if (isHtml) {
    if (clean === '/' || clean === '') return 'index.html';
    return clean.replace(/^\/+/, '').replace(/\/+$/, '') + '/index.html';
  }
  let p = clean.replace(/^\/+/, '');
  if (p === '' || p.endsWith('/')) p += 'index.bin';
  return p;
}

function isHtml(buf, ct) {
  if (ct && /text\/html|\bxhtml/i.test(ct)) return true;
  const head = buf.slice(0, 300).toString('utf8').toLowerCase().trimStart();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

function pushUrl(u) {
  if (!u) return;
  if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('mailto:') || u.startsWith('#') || u.startsWith('javascript:')) return;
  let url;
  try { url = new URL(u, ORIGIN + '/'); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.origin !== ORIGIN) {
    if (ASSET_RE.test(url.pathname) || /\.(m3u8|mpd)/i.test(url.pathname)) externals.add(url.href);
    return;
  }
  url.hash = '';
  const href = url.href;
  if (seen.has(href)) return;
  seen.add(href);
  queue.push(href);
}

function pushRoute(p) {
  if (!p) return;
  if (p.startsWith('//')) return;
  let pathName = p.split('?')[0].split('#')[0];
  if (!pathName.startsWith('/') || pathName.startsWith('//')) return;
  try { pathName = decodeURIComponent(pathName); } catch (e) { }
  if (SKIP_PREFIX.test(pathName)) return;
  if (!/^\/[a-z0-9\-\/]*$/i.test(pathName)) return;
  if (/\.[a-z0-9]+$/i.test(pathName)) return;
  const segs = pathName.split('/').filter(Boolean);
  if (!segs.length || segs.length > 4) return;
  const blocked = ['_next', 'api', 'imagens', 'audio', 'videos', 'video', 'fonts', 'icons', 'static', 'media', 'assets', 'css', 'js', 'img', 'images', 'sw'];
  if (blocked.includes(segs[0].toLowerCase())) return;
  if (segs.some(s => s.length > 40)) return;
  candidates.add('/' + segs.join('/'));
}

function collect(text, base) {
  if (!text) return;
  const t = text
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&');
  const re = /(?:src|href|srcSet|poster|content)\s*[:=]\s*["'`]([^"'`]+)["'`]|url\(\s*["']?([^"')\s]+)["']?\s*\)|["'`](\/[^"'`\s]*\.(?:png|jpe?g|webp|gif|svg|ico|mp3|m4a|wav|ogg|mp4|webm|m3u8|mpd|ts|woff2?|ttf|css|js|json|webmanifest|txt|xml)(\?[^"'`\s]*)?)["'`]|["'`](https?:\/\/[^"'`\s]+)["'`]/gi;
  let m;
  while ((m = re.exec(t))) {
    let u = m[1] || m[2] || m[3] || m[4];
    if (!u) continue;
    u = u.trim();
    if (u.startsWith('//')) u = 'https:' + u;
    if (u.startsWith(ORIGIN)) u = u.slice(ORIGIN.length);
    if (/^https?:\/\//i.test(u)) {
      let abs;
      try { abs = new URL(u, base); } catch (e) { continue; }
      if (abs.origin !== ORIGIN) {
        if (ASSET_RE.test(abs.pathname)) externals.add(abs.href);
        continue;
      }
      if (ASSET_RE.test(abs.pathname)) pushUrl(abs.href);
      continue;
    }
    if (u.startsWith('/')) pushUrl(u);
    else if (ASSET_RE.test(u)) {
      try {
        const abs = new URL(u, base);
        if (abs.origin === ORIGIN) pushUrl(abs.href);
        else externals.add(abs.href);
      } catch (e) { }
    }
  }
  // hrefs de rotas em HTML
  const hr = /href\s*=\s*["']([^"'#]+)["']/gi;
  while ((m = hr.exec(t))) {
    const h = m[1];
    if (/^https?:/i.test(h)) continue;
    if (SKIP_PREFIX.test(h)) continue;
    pushRoute(h);
  }
  // strings que parecem rotas (JS/flight payload)
  const rr = /["'`](\/(?:[a-z0-9][a-z0-9\-]{0,39})(?:\/[a-z0-9][a-z0-9\-]{0,39}){0,3})["'`]/gi;
  while ((m = rr.exec(t))) pushRoute(m[1]);
}

async function handle(url) {
  let res;
  try { res = await get(url); } catch (e) {
    failCount++;
    console.log('FAIL', url, e.message);
    return;
  }
  const { status, headers, buf } = res;
  const pathname = new URL(url).pathname;
  if (status === 404) { missing.add(pathname); return; }
  if (status !== 200) { console.log('HTTP', status, pathname); return; }
  const ct = headers['content-type'] || '';
  if (isHtml(buf, ct)) {
    const rel = outPathFor(pathname, true);
    save(rel, buf);
    console.log('HTML ', pathname.padEnd(34), rel, buf.length);
    collect(buf.toString('utf8'), url);
    return;
  }
  const rel = outPathFor(pathname, false);
  save(rel, buf);
  console.log('FILE ', pathname.padEnd(34), rel, buf.length);
  if (TEXT_RE.test(pathname) && buf.length < 8_000_000) collect(buf.toString('utf8'), url);
}

async function drain() {
  let pass = 0;
  while (queue.length && pass++ < 40) {
    const batch = [];
    while (queue.length) batch.push(queue.shift());
    const workers = [];
    for (let i = 0; i < CONC; i++) {
      workers.push((async () => {
        let u;
        while ((u = batch.shift()) !== undefined) await handle(u);
      })());
    }
    await Promise.all(workers);
  }
}

async function verifyRoutes() {
  const list = [...candidates].filter(c => !routes.has(c)).sort();
  let i = 0;
  const workers = [];
  for (let w = 0; w < CONC; w++) {
    workers.push((async () => {
      while (i < list.length) {
        const c = list[i++];
        const u = ORIGIN + (c === '/' ? '/' : c);
        if (seen.has(u)) { if (!c.startsWith('/imagens') && !c.startsWith('/audio')) routes.add(c); continue; }
        let res;
        try { res = await get(u, { headOnly: true }); } catch (e) { continue; }
        if (res.status === 200 && String(res.headers['content-type'] || '').includes('text/html')) {
          routes.add(c);
          seen.add(u);
          queue.push(u);
          console.log('ROUTE', c);
        } else if (res.status === 404) {
          missing.add(c);
        }
      }
    })());
  }
  await Promise.all(workers);
}

(async () => {
  const t0 = Date.now();
  routes.add('/');
  pushUrl(ORIGIN + '/');
  const probeFile = path.join(__dirname, 'probe.txt');
  if (fs.existsSync(probeFile)) {
    fs.readFileSync(probeFile, 'utf8').split(/\r?\n/)
      .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      .forEach(l => candidates.add(l));
  }
  const passes = Number(process.env.PASSES || 5);
  await drain();
  for (let i = 0; i < passes; i++) {
    await verifyRoutes();
    await drain();
  }

  fs.writeFileSync(path.join(__dirname, 'routes.json'), JSON.stringify([...routes].sort(), null, 2));
  fs.writeFileSync(path.join(__dirname, 'externals.json'), JSON.stringify([...externals].sort(), null, 2));
  fs.writeFileSync(path.join(__dirname, 'missing.json'), JSON.stringify([...missing].sort(), null, 2));
  fs.writeFileSync(path.join(__dirname, 'candidates.json'), JSON.stringify([...candidates].sort(), null, 2));

  console.log('\n=== RESUMO ===');
  console.log('rotas HTML :', routes.size, [...routes].sort().join(' '));
  console.log('candidatos :', candidates.size);
  console.log('externos   :', externals.size);
  [...externals].sort().forEach(e => console.log('   EXT', e));
  console.log('404 origem :', missing.size);
  console.log('arquivos   :', saved.size);
  console.log('requests   :', reqCount, 'falhas:', failCount, 'tempo:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
