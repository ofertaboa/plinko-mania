/* Patches do espelho estático (idempotente)

   1. LOADER do next/image: o bundle gera URLs "/_next/image?url=..." que NÃO
      existem em hospedagem estática (Netlify/Pages). O loader é reescrito para
      retornar o src original — mesmo efeito de "unoptimized", porém SEM causar
      erro de hidratação (React #418).
      NUNCA troque "unoptimized:!1" por "unoptimized:!0" (quebra as páginas).

   2. runtimeApiUrl: em localhost o bundle aponta para "http://localhost:16180"
      (backend de dev que não existe) e em qualquer domínio de preview
      (netlify.app / pages.dev) aponta para "api.<dominio>" (DNS inexistente) —
      os dois geram erro de rede no console. O patch faz:
        • localhost / 127.0.0.1  -> mesma origem (stubs estáticos em /api/v1/*)
        • plinkopremiado.online   -> API real https://api.plinkopremiado.online
        • qualquer outro domínio  -> mesma origem (stubs estáticos)

   Uso: node tools\patch.js                                        */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['tools', 'node_modules', '.git']);

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (f.isDirectory()) { if (SKIP.has(f.name)) continue; walk(path.join(d, f.name)); }
    else if (/\.(js|html)$/i.test(f.name)) files.push(path.join(d, f.name));
  }
})(ROOT);

const START = 'let l=(0,t.findClosestQuality)(n,e);return';
const END = 'i.__next_img_default=!0';
const API_OLD1 = 'if("localhost"===t)return{siteUrl:"http://localhost:31415",adminUrl:"http://localhost:27182",apiUrl:"http://localhost:16180"};';
const API_NEW1 = 'if("localhost"===t)return{siteUrl:location.origin,adminUrl:location.origin,apiUrl:""};';
const API_OLD2 = 'apiUrl:`${o}://api.${t}`}';
const API_NEW2 = 'apiUrl:"plinkopremiado.online"===t?`${o}://api.${t}`:""}';
let loaders = 0, htmls = 0, apis = 0;

for (const p of files) {
  const rel = path.relative(ROOT, p).replace(/\\/g, '/');
  const src = fs.readFileSync(p, 'utf8');
  let out = src;

  if (p.endsWith('.js') && out.includes(START)) {
    let i = out.indexOf(START);
    while (i !== -1) {
      const j = out.indexOf(END, i);
      if (j === -1) break;
      const span = out.slice(i, j);
      const m = /encodeURIComponent\(([A-Za-z_$][\w$]*)\)/.exec(span);
      const varName = m ? m[1] : 'r';
      // mantém tudo depois do backtick final (o "}" que fecha a função do loader)
      const bt = span.lastIndexOf('`');
      const keep = bt >= 0 ? span.slice(bt + 1) : '';
      out = out.slice(0, i) + 'return ' + varName + ';' + keep + out.slice(j);
      loaders++;
      i = out.indexOf(START, i + 1);
    }
    if (out !== src) console.log('LOADER  ', rel);
  }

  if (p.endsWith('.js') && (out.includes(API_OLD1) || out.includes(API_OLD2))) {
    const before = out;
    if (out.includes(API_OLD1)) out = out.split(API_OLD1).join(API_NEW1);
    if (out.includes(API_OLD2)) out = out.split(API_OLD2).join(API_NEW2);
    if (out !== before) { apis++; console.log('API-URL ', rel); }
  }

  if (p.endsWith('.html') && out.includes('/_next/image')) {
    const loose = /\/_next\/image\?url=([^&"']+)(?:&amp;|&)w=[^&"' ,]+(?:&amp;|&)q=[^&"' ,]+/g;
    out = out.replace(loose, (_, u) => { try { return decodeURIComponent(u); } catch (e) { return u; } });
    if (out !== src) { htmls++; console.log('HTML    ', rel); }
  }

  if (out !== src) fs.writeFileSync(p, out);
}

// auditoria final
let leftHtml = 0, unpatched = 0, devApi = 0;
for (const p of files) {
  const s = fs.readFileSync(p, 'utf8');
  if (p.endsWith('.html') && s.includes('/_next/image')) { leftHtml++; console.log('SOBROU HTML ->', path.relative(ROOT, p)); }
  if (p.endsWith('.js') && /\?url=\$\{encodeURIComponent/.test(s)) { unpatched++; console.log('LOADER NAO PATCHED ->', path.relative(ROOT, p)); }
  if (p.endsWith('.js') && s.includes('localhost:16180')) { devApi++; console.log('API DEV NAO PATCHADA ->', path.relative(ROOT, p)); }
}
console.log('loaders corrigidos:', loaders, '| api-url corrigida:', apis, '| html corrigidos:', htmls,
  '| html pendente:', leftHtml, '| loaders pendentes:', unpatched, '| api dev pendente:', devApi);

// validação de sintaxe dos arquivos .js alterados
const { spawnSync } = require('child_process');
let syntaxBad = 0;
for (const p of files) {
  if (!p.endsWith('.js')) continue;
  const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
  if (r.status !== 0) { syntaxBad++; console.log('SINTAXE RUIM ->', path.relative(ROOT, p), (r.stderr || '').split('\n')[1] || ''); }
}
console.log('sintaxe inválida:', syntaxBad);
process.exit(unpatched || syntaxBad || devApi ? 1 : 0);
