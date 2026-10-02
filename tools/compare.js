/* Compara o texto renderizado de cada rota: origem (plinkopremiado.online) x espelho local.
   node compare.js
   Diferenças esperadas: lista de ganhadores (API real x snapshot) e configuração de casa. */
const fs = require('fs'), path = require('path');
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) {
  // dependência opcional (apenas para este script de comparação)
  puppeteer = require(path.join(process.env.TEMP || '', 'opencode', 'cdp', 'node_modules', 'puppeteer-core'));
}
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
const ORIGIN = 'https://plinkopremiado.online';
const LOCAL = process.argv[2] || 'http://localhost:8080';
// base path do deploy (GitHub Pages de projeto) - ver tools/base.js
const BASE = (() => { try { const b = require('./base'); return b ? (String(b).startsWith('/') ? String(b) : '/' + String(b)).replace(/\/+$/g, '') : ''; } catch (e) { return ''; } })();
const ROUTES = JSON.parse(fs.readFileSync('C:\\Users\\Oestyx\\Downloads\\7\\tools\\routes.json', 'utf8'));

const norm = t => t.replace(/\s+/g, ' ').trim();

async function waitForOrigin(maxTries = 40) {
  for (let i = 0; i < maxTries; i++) {
    const st = await new Promise(res => {
      const https = require('https');
      const r = https.get(ORIGIN + '/', { timeout: 20000 }, s => { s.resume(); res(s.statusCode); });
      r.on('error', () => res(0));
      r.on('timeout', () => { r.destroy(); res(0); });
    });
    if (st === 200) { console.log('origem OK (' + (i + 1) + 'ª tentativa)'); return true; }
    console.log('aguardando origem: HTTP ' + st + ' (tentativa ' + (i + 1) + '/' + maxTries + ')');
    await new Promise(r => setTimeout(r, 15000));
  }
  return false;
}

async function render(page, url, tries = 3) {
  let resp;
  for (let i = 0; i < tries; i++) {
    try { resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); }
    catch (e) { if (i === tries - 1) return { err: 'goto: ' + e.message }; await new Promise(r => setTimeout(r, 10000)); continue; }
    if (resp && resp.status() >= 500 && i < tries - 1) { await new Promise(r => setTimeout(r, 15000)); continue; }
    break;
  }
  if (resp && resp.status() >= 500) return { err: 'HTTP ' + resp.status() };
  await new Promise(r => setTimeout(r, 3500));
  return page.evaluate(() => ({
    text: document.body.innerText.replace(/\s+/g, ' ').trim(),
    path: location.pathname,
    title: document.title,
    imgs: [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.currentSrc || i.src),
  }));
}

function words(s) { return new Set(s.split(' ').filter(Boolean)); }

(async () => {
  if (!(await waitForOrigin())) { console.log('ORIGEM INDISPONIVEL — rode compare.js mais tarde'); process.exit(2); }
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const a = await browser.newPage(), b = await browser.newPage();
  await a.setViewport({ width: 1280, height: 900 }); await b.setViewport({ width: 1280, height: 900 });
  let bad = 0;
  for (const r of ROUTES) {
    const url = r === '/' ? '/' : r + '/';
    const A = await render(a, ORIGIN + url), B = await render(b, LOCAL + url);
    if (A.err || B.err) { console.log('ERRO  ' + r.padEnd(22) + (A.err || B.err)); bad++; continue; }
    const ta = words(A.text), tb = words(B.text);
    const sóOrigem = [...ta].filter(w => !tb.has(w));
    const sóLocal = [...tb].filter(w => !ta.has(w));
    const ratio = ta.size ? 1 - sóOrigem.length / ta.size : 1;
    const localPath = (B.path || '').slice(BASE.length) || '/';
    const ok = ratio > 0.97 && sóLocal.length < 12 && A.path === localPath;
    if (!ok) bad++;
    console.log((ok ? 'OK    ' : 'DIF   ') + r.padEnd(22) +
      'origem=' + String(ta.size).padStart(4) + ' local=' + String(tb.size).padStart(4) +
      ' cobertura=' + (ratio * 100).toFixed(1) + '%' +
      ' sóLocal=' + sóLocal.length + (A.path !== localPath ? ' PATH ' + A.path + ' vs ' + B.path : ''));
    if (!ok) {
      if (sóOrigem.length) console.log('        só na origem: ' + sóOrigem.slice(0, 25).join(' | '));
      if (sóLocal.length) console.log('        só no local : ' + sóLocal.slice(0, 25).join(' | '));
    }
    if (B.imgs.length) console.log('        imgs quebradas no local: ' + B.imgs.join(', '));
  }
  await browser.close();
  console.log('\ndiferenças relevantes: ' + bad);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
