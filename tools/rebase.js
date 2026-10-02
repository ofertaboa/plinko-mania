/* Reescreve todos os caminhos absolutos do app para dentro do base path.
   Uso:  node tools\rebase.js            (aplica o base de tools\base.js)
         node tools\rebase.js --root     (remove o base -> hospedagem na raiz)
         node tools\rebase.js /outra     (troca o base)
         node tools\rebase.js --dry      (so mostra, nao grava)
   Idempotente: sempre remove o base atual e reaplica o desejado.
   O payload RSC dos .html e desembrulhado (JSON.parse) antes de reescrever, para
   que strings escapadas (\"href\":\"/\", \"\\/salas\") tambem peguem o base. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const EX = new Set(['tools', '.git', 'node_modules']);
const EXT = ['.html', '.js', '.css', '.webmanifest', '.json'];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const AHEAD = '[\\/\\\\\\x27"?#),;\\s\\]}\\x60]';

// segmentos que sao caminhos do APP (assets e rotas) - nunca URLs externas
const T = ['_next', 'images', 'videos', 'icons', 'brand', 'api',
  'cadastrar', 'depositar', 'entrar', 'extrato', 'indique', 'jogar', 'jogo-responsavel',
  'missoes', 'perfil', 'premios', 'privacidade', 'sacar', 'salas', 'seguranca',
  'sobre', 'suporte', 'termos',
  'favicon\\.ico', 'manifest\\.webmanifest', 'sw\\.js', '404\\.html', 'robots\\.txt', 'sitemap\\.xml'];

// home "/" - literais exatos, so em posicao de rota.
// nao casa com .split("/") nem com .join("/") (o caractere anterior e letra)
const HOME = [
  ['href:"/"', 'href:"{B}/"'],
  ['href="/"', 'href="{B}/"'],
  ['scope:"/"', 'scope:"{B}/"'],
  ['scope="/"', 'scope="{B}/"'],
  ['start_url":"/"', 'start_url":"{B}/"'],
  ['.replace("/")', '.replace("{B}/")'],
  ['push("/")', 'push("{B}/"'],
  ['path:"/"', 'path:"{B}/"'],
];
const withB = (s, B) => s.replace(/\{B\}/g, B);

function walk(d, out = []) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (EX.has(f.name)) continue; walk(p, out); }
    // stubs da API nao tem extensao (api/v1/platform/config)
    else if (EXT.includes(path.extname(f.name)) ||
      (path.extname(f.name) === '' && /[\\/]api[\\/]/.test(p))) out.push(p);
  }
  return out;
}

const ALL = process.argv.slice(2);
const args = ALL.filter(a => !a.startsWith('--'));
const dry = ALL.includes('--dry');
const OLD_RAW = require('./base');
const OLD = OLD_RAW ? (String(OLD_RAW).startsWith('/') ? String(OLD_RAW) : '/' + String(OLD_RAW)).replace(/\/+$/g, '') : '';
let NEW;
if (ALL.includes('--root')) NEW = '';
else NEW = (args.length ? String(args[0]) : String(OLD)).replace(/\/+$/g, '');
if (NEW && !NEW.startsWith('/')) NEW = '/' + NEW;

function segRe(mode) {
  const seg = '((?:' + T.join('|') + '))';
  if (mode === 'strip') return new RegExp('(?<![\\w.])' + esc(OLD) + '\\/' + seg + '(?=' + AHEAD + ')', 'g');
  return new RegExp('(?<![\\w./])\\/' + seg + '(?=' + AHEAD + ')', 'g');
}

// --- payload RSC: desembrulha, reescreve, reembrulha -----------------------
const PAY = /self\.__next_f\.push\(\[\s*1\s*,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g;
function payload(html, fn) {
  return html.replace(PAY, (m, lit) => {
    let plain;
    try { plain = JSON.parse(lit); } catch (e) { hits['PAYLOAD-NODECODE'] = (hits['PAYLOAD-NODECODE'] || 0) + 1; return m; }
    const out = fn(plain);
    if (out === plain) return m;
    hits['PAYLOAD'] = (hits['PAYLOAD'] || 0) + 1;
    const json = JSON.stringify(out).replace(/</g, '\\u003C').replace(/>/g, '\\u003E');
    return 'self.__next_f.push([1,' + json + '])';
  });
}

function apply(s) {
  s = s.replace(segRe('apply'), m => { hits[m] = (hits[m] || 0) + 1; return NEW + m; });
  for (const [plain, tpl] of HOME) {
    const w = withB(tpl, NEW), n = s.split(plain).length - 1;
    if (n > 0) { s = s.split(plain).join(w); hits[plain + '   (home)'] = (hits[plain + '   (home)'] || 0) + n; }
  }
  return s;
}
function strip(s) {
  for (const [plain, tpl] of HOME) s = s.split(withB(tpl, OLD)).join(plain);
  return s.replace(segRe('strip'), (m, p1) => '/' + p1);
}

let changed = 0; const hits = {};
for (const p of walk(ROOT)) {
  const before = fs.readFileSync(p, 'utf8');
  let s = before;
  if (OLD) {
    s = payload(s, plain => strip(plain));
    s = strip(s);
    s = s.split('%2F' + encodeURIComponent(OLD.slice(1)) + '%2F').join('%2F');   // forma percent-encoded
  }
  if (NEW) {
    s = payload(s, plain => apply(plain));
    s = apply(s);
  }
  if (s !== before) {
    changed++;
    if (!dry) fs.writeFileSync(p, s);
    console.log((dry ? 'DRY  ' : 'WROTE ') + path.relative(ROOT, p));
  }
}
console.log('\nbase: ' + JSON.stringify(OLD) + '  ->  ' + JSON.stringify(NEW));
console.log('arquivos alterados: ' + changed);
const k = Object.keys(hits).sort((a, b) => hits[b] - hits[a]);
if (k.length) {
  console.log('\ncaminhos com base aplicado:');
  k.forEach(x => console.log('  ' + String(hits[x]).padStart(4) + '  ' + (x[0] === '/' ? NEW + x : x)));
}
if (dry) console.log('\n(dry run - nada foi gravado)');
