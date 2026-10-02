/* Servidor estatico local (raiz = pasta do site, sem base path).
   Uso: node tools\server.js   |   porta: set PORT=3000 antes */
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject',
  '.mp3': 'audio/mpeg', '.MP3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg', '.aac': 'audio/aac',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.m3u8': 'application/vnd.apple.mpegurl', '.mpd': 'application/dash+xml',
  '.ts': 'video/mp2t', '.m4s': 'video/iso.segment',
  '.wasm': 'application/wasm', '.pdf': 'application/pdf',
};

function send(res, code, headers, stream) { res.writeHead(code, headers); if (stream) stream.pipe(res); else res.end(); }

function serveFile(req, res, file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const ext = path.extname(file);
  const type = (rel.startsWith('api/') && !ext) ? 'application/json; charset=utf-8'
    : (MIME[ext] || MIME[ext.toLowerCase()] || 'application/octet-stream');
  const stat = fs.statSync(file);
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' };
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] === '' ? undefined : parseInt(m[1], 10);
      let end = m[2] === '' ? undefined : parseInt(m[2], 10);
      if (start === undefined) { start = Math.max(0, stat.size - (end || 0)); end = stat.size - 1; }
      else if (end === undefined || end >= stat.size) end = stat.size - 1;
      if (start <= end && start < stat.size) {
        res.writeHead(206, Object.assign({}, base, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': end - start + 1,
        }));
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
  }
  base['Content-Length'] = stat.size;
  res.writeHead(200, base);
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(url.parse(req.url).pathname); } catch (e) { p = url.parse(req.url).pathname; }
  p = p.replace(/\\/g, '/');
  if (p.includes('..')) { res.writeHead(400); return res.end('bad request'); }

  const tryPaths = [];
  if (p.endsWith('/')) tryPaths.push(path.join(ROOT, p, 'index.html'));
  else tryPaths.push(path.join(ROOT, p));

  let file = tryPaths.find(f => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } });
  if (!file && !path.extname(p)) {
    const dirIdx = path.join(ROOT, p, 'index.html');
    if (fs.existsSync(dirIdx)) {
      if (req.method === 'HEAD' || req.method === 'GET') {
        res.writeHead(301, { Location: p + '/' + (url.parse(req.url).search || '') });
        return res.end();
      }
    }
  }
  if (!file) {
    const notFound = path.join(ROOT, '404.html');
    if (fs.existsSync(notFound)) {
      const body = fs.readFileSync(notFound);
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
      return res.end(body);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 Not Found');
  }
  try { serveFile(req, res, file); } catch (e) { res.writeHead(500); res.end('500'); }
});

server.listen(PORT, () => {
  console.log('Servidor estatico: http://localhost:' + PORT + '/');
  console.log('Raiz: ' + ROOT);
});
