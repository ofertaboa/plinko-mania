/* Verificação estática do espelho:
   1. todas as referências de assets (HTML/JS/CSS) existem no disco?
   2. todas as rotas respondem 200 no servidor local?
   3. alguma URL externa sobrou (quebraria offline)?
   Uso: node tools\check.js   (servidor local precisa estar rodando)            */
const fs = require('fs'), path = require('path'), http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 8080;
// base path do deploy (GitHub Pages de projeto) - ver tools/base.js
const RAW = require('./base');
const BASE = RAW ? (String(RAW).startsWith('/') ? String(RAW) : '/' + String(RAW)).replace(/\/+$/g, '') : '';
const SKIP_DIRS = new Set(['tools', 'node_modules', '.git']);
const TEXT = /\.(html|js|css|json|webmanifest|svg|txt|xml|m3u8)$/i;

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (f.isDirectory()) { if (SKIP_DIRS.has(f.name)) continue; walk(path.join(d, f.name)); }
    else files.push(path.join(d, f.name));
  }
})(ROOT);

const refs = new Map();   // caminho local -> arquivo que referenciou
const external = new Map();
let checked = 0, missing = 0;

function addRef(u, from) {
  if (!u) return;
  u = u.trim().replace(/\\\//g, '/');
  if (!u || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('#') ||
    u.startsWith('mailto:') || u.startsWith('javascript:') || u.startsWith('void(')) return;
  if (/^https?:\/\//i.test(u)) {
    if (!/plinkopremiado\.online|^https?:\/\/localhost/i.test(u)) {
      if (!external.has(u)) external.set(u, from);
    }
    return;
  }
  if (u.startsWith('//')) return;
  if (u.includes('${')) return;   // template literal dinâmico (ex.: /images/avatars/${a}.svg)
  let p = u.split('?')[0].split('#')[0];
  if (!p) return;
  if (!p.startsWith('/')) return; // as relativas ja foram resolvidas no crawl
  try { p = decodeURIComponent(p); } catch (e) { }
  if (p.endsWith('/')) p += 'index.html';
  // no disco os arquivos ficam SEM o base path (o base so existe no texto)
  if (BASE && (p === BASE || p.startsWith(BASE + '/'))) p = p.slice(BASE.length) || '/';
  if (p === '/') p = '/index.html';
  if (!refs.has(p)) refs.set(p, from);
}

for (const f of files) {
  if (!TEXT.test(f)) continue;
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const s = fs.readFileSync(f, 'utf8');
  const re = /(?:src|href|srcSet|poster|content)\s*[:=]\s*["'`]([^"'`]+)["'`]|url\(\s*["']?([^"')\s]+)["']?\s*\)|["'`](\/[^"'`\s]*\.(?:png|jpe?g|webp|gif|svg|ico|mp3|m4a|wav|ogg|mp4|webm|m3u8|mpd|ts|woff2?|ttf|css|js|json|webmanifest|txt|xml)(?:\?[^"'`\s]*)?)["'`]/gi;
  let m;
  while ((m = re.exec(s))) addRef(m[1] || m[2] || m[3], rel);
}

console.log('=== 1. referências de assets ===');
for (const [p, from] of [...refs].sort()) {
  checked++;
  if (!fs.existsSync(path.join(ROOT, p))) { missing++; console.log('  FALTA ' + p + '   <- ' + from); }
}
console.log('  verificadas: ' + checked + ' | faltando: ' + missing);

console.log('\n=== 2. rotas respondendo no servidor local ===');
const routes = JSON.parse(fs.readFileSync(path.join(__dirname, 'routes.json'), 'utf8'));
const probe = p => new Promise(res => {
  const r = http.get({ host: 'localhost', port: PORT, path: p, timeout: 8000 }, s => {
    s.resume(); res({ code: s.statusCode, type: s.headers['content-type'] || '' });
  });
  r.on('error', () => res({ code: 0, type: '' }));
  r.on('timeout', () => { r.destroy(); res({ code: 0, type: '' }); });
});
(async () => {
  let bad = 0;
  for (const r of routes) {
    const res = await probe(BASE + (r === '/' ? '/' : r + '/'));
    const ok = res.code === 200 && /text\/html/.test(res.type);
    if (!ok) bad++;
    console.log('  ' + (ok ? 'OK   ' : 'FALHA') + ' ' + String(res.code).padEnd(4) + ' ' + r);
  }
  // rota inexistente deve cair no 404.html
  const nf = await probe(BASE + '/rota-que-nao-existe');
  const nfOk = nf.code === 404;
  console.log('  ' + (nfOk ? 'OK   ' : 'FALHA') + ' ' + String(nf.code).padEnd(4) + ' (404.html)');

  // botão "Acessar agora"
  const html = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
  const btn = /href="\/"[^>]*>Acessar agora/.test(html) || />Acessar agora<\/a>/.test(html);
  console.log('  ' + (btn ? 'OK   ' : 'FALHA') + ' 404.html com botão "Acessar agora" -> /');

  console.log('\n=== 3. URLs externas restantes ===');
  if (external.size === 0) console.log('  nenhuma');
  for (const [u, from] of [...external].sort()) console.log('  ' + u + '   <- ' + from);

  const fails = missing + bad + (nfOk ? 0 : 1) + (btn ? 0 : 1);
  console.log('\nFALHAS: ' + fails);
  process.exit(fails ? 1 : 0);
})();
