/* Extrai a configuração padrão da plataforma (objeto "l" dentro do MaintenanceGate)
   do bundle do Next e grava em api/v1/platform/config — usado como stub estático
   da API para que o site funcione 100% offline/estático sem erros no console.

   Fluxo: injeta temporariamente `window.__PLINKO_CFG__=l` no chunk, carrega a home
   no Chrome headless, captura o objeto e REESTABELECE o chunk original.

   Uso: node tools\extract-config.js                                                    */
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SITE = process.env.SITE || 'http://localhost:8080';
const CHUNK = path.join(ROOT, '_next', 'static', 'chunks', '1z_0243anyqhu.js');
const OUT = path.join(ROOT, 'api', 'v1', 'platform', 'config');
const CDP = process.env.CDP_DIR || 'C:\\Users\\Oestyx\\AppData\\Local\\Temp\\opencode\\cdp';
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));

const MARK = 'c=new Map;';
const INJECT = 'c=new Map;window.__PLINKO_CFG__=l;';

let puppeteer;
try { puppeteer = require(path.join(CDP, 'node_modules', 'puppeteer-core')); }
catch (e) { console.error('puppeteer-core não encontrado em ' + CDP); process.exit(1); }

(async () => {
  const original = fs.readFileSync(CHUNK, 'utf8');
  if (!original.includes(MARK)) { console.error('marcador não encontrado'); process.exit(1); }
  fs.writeFileSync(CHUNK, original.replace(MARK, INJECT));
  let cfg;
  try {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    await page.goto(SITE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__PLINKO_CFG__ !== undefined', { timeout: 30000 });
    cfg = await page.evaluate(() => window.__PLINKO_CFG__);
    await browser.close();
  } finally {
    fs.writeFileSync(CHUNK, original); // reestabelece o chunk original
  }
  if (!cfg) { console.error('config não capturada'); process.exit(1); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(cfg, null, 2));
  console.log('gravado:', OUT);
  console.log('banners:', Object.keys(cfg.banners || {}).join(', '));
  console.log('rooms:', (cfg.gameCatalog && cfg.gameCatalog.rooms || []).length,
    '| prizes:', (cfg.gameCatalog && cfg.gameCatalog.prizes || []).length,
    '| brandAssets:', Object.keys(cfg.brandAssets || {}).length);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
