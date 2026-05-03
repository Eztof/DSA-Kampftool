/**
 * DSA 4.1 SL-Tool – Heimserver
 * Keine npm-Installation nötig! Nur Node.js muss installiert sein.
 * Starten: node server.js
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const os   = require('os');

const PORT     = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PUB_DIR  = path.join(__dirname, 'public');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PUB_DIR))  fs.mkdirSync(PUB_DIR,  { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch(e) { reject(e); } });
    req.on('error', reject);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sanitize(name) {
  return (name || '').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80);
}

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method   = req.method.toUpperCase();

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    // Liste aller Saves
    if (method === 'GET' && pathname === '/api/saves') {
      const files = fs.readdirSync(DATA_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const stat = fs.statSync(path.join(DATA_DIR, f));
          let data = {};
          try { data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); } catch {}
          return { name: f.replace('.json', ''), modified: stat.mtime, round: data.round || '?', combatants: (data.combatants||[]).length };
        })
        .sort((a, b) => new Date(b.modified) - new Date(a.modified));
      return json(res, files);
    }

    // Einen Save laden
    if (method === 'GET' && pathname.startsWith('/api/saves/')) {
      const name = sanitize(decodeURIComponent(pathname.replace('/api/saves/', '')));
      const file = path.join(DATA_DIR, name + '.json');
      if (!fs.existsSync(file)) return json(res, { error: 'Nicht gefunden' }, 404);
      return json(res, JSON.parse(fs.readFileSync(file, 'utf8')));
    }

    // Kampf speichern
    if (method === 'POST' && pathname.startsWith('/api/saves/')) {
      const name = sanitize(decodeURIComponent(pathname.replace('/api/saves/', '')));
      if (!name) return json(res, { error: 'Kein Name' }, 400);
      const body = await readBody(req);
      const file = path.join(DATA_DIR, name + '.json');
      fs.writeFileSync(file, JSON.stringify(body, null, 2), 'utf8');
      console.log('[SAVE] ' + name + '  (' + (body.combatants||[]).length + ' Kaempfer, Runde ' + body.round + ')');
      return json(res, { ok: true, name });
    }

    // Save löschen
    if (method === 'DELETE' && pathname.startsWith('/api/saves/')) {
      const name = sanitize(decodeURIComponent(pathname.replace('/api/saves/', '')));
      const file = path.join(DATA_DIR, name + '.json');
      if (fs.existsSync(file)) { fs.unlinkSync(file); console.log('[DEL] ' + name); }
      return json(res, { ok: true });
    }

    // Statische Dateien ausliefern
    if (method === 'GET') {
      let filePath;
      if (pathname === '/' || pathname === '/index.html') {
        filePath = fs.existsSync(path.join(PUB_DIR, 'index.html'))
          ? path.join(PUB_DIR, 'index.html')
          : path.join(PUB_DIR, 'kampf.html');
      } else {
        filePath = path.join(PUB_DIR, pathname);
      }
      return serveStatic(res, filePath);
    }

    res.writeHead(404); res.end('Not found');

  } catch (err) {
    console.error('[FEHLER]', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
});

function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of (ifaces || [])) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '(unbekannt)';
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n====================================================');
  console.log('    DSA 4.1 Kampfverwaltung - Heimserver');
  console.log('====================================================');
  console.log('  Lokal:     http://localhost:' + PORT);
  console.log('  Heimnetz:  http://' + ip + ':' + PORT);
  console.log('  Dateien:   .\\public\\kampf.html');
  console.log('  Saves:     .\\data\\*.json');
  console.log('====================================================');
  console.log('  Strg+C zum Beenden.\n');
});
