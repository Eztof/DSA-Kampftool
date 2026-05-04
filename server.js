/**
 * DSA 4.1 SL-Tool Server v2.0
 * Starten: node server.js
 * Kein npm install nötig - nur Node.js built-ins
 *
 * API Übersicht:
 *   GET    /api/helden                  -> Liste aller Helden (Name + GUID)
 *   GET    /api/helden/:guid            -> Held laden
 *   POST   /api/helden/:guid            -> Held speichern
 *   DELETE /api/helden/:guid            -> Held löschen
 *
 *   GET    /api/db/:tabelle             -> MG-Daten (zauber, talente, gegner, ...)
 *   GET    /api/db/:tabelle/:id         -> Einzelner Eintrag (id = GUID oder Name)
 *   GET    /api/db/:tabelle?q=suchtext  -> Suche in Tabelle
 *
 *   GET    /api/saves                   -> Kampfsaves
 *   GET    /api/saves/:name             -> Kampfsave laden
 *   POST   /api/saves/:name             -> Kampfsave speichern
 *   DELETE /api/saves/:name             -> Kampfsave löschen
 *
 *   GET    /api/campaign                -> Kampagnendaten (Datum, Notizen)
 *   POST   /api/campaign                -> Kampagnendaten speichern
 *
 *   GET    /api/config                  -> Konfiguration lesen
 *   POST   /api/config                  -> Konfiguration speichern
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const os   = require('os');

const PORT    = 3000;
const PUBLIC  = path.join(__dirname, 'public');
const DATA    = path.join(__dirname, 'data');
const HELDEN  = path.join(DATA, 'helden');
const SAVES   = path.join(DATA, 'saves');
const MG_DB   = path.join(__dirname, 'mg_export', 'roh');

// Ordner anlegen falls nicht vorhanden
[DATA, HELDEN, SAVES].forEach(d => fs.mkdirSync(d, { recursive: true }));

// Config-Datei - Pfade zu Regelwerk-PDFs etc.
const CONFIG_FILE = path.join(DATA, '_config.json');
function loadConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
    catch { return { pdfs: {}, serverVersion: '2.0' }; }
}
function saveConfig(cfg) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

// Kampagnendaten
const CAMPAIGN_FILE = path.join(DATA, '_campaign.json');
function loadCampaign() {
    try { return JSON.parse(fs.readFileSync(CAMPAIGN_FILE, 'utf8')); }
    catch { return { datum: { tag: 1, monat: 1, jahr: 1000, wochentag: 0 }, notizen: '' }; }
}

// MIME Types
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.svg':  'image/svg+xml',
    '.pdf':  'application/pdf',
    '.ico':  'image/x-icon',
};

// ── Hilfsfunktionen ─────────────────────────────────────────────────────────

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch { resolve(body); }
        });
        req.on('error', reject);
    });
}

function send(res, status, data) {
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    const type = typeof data === 'string' ? 'text/plain' : 'application/json; charset=utf-8';
    res.writeHead(status, {
        'Content-Type': type,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(body);
}

function loadJson(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return null; }
}

function saveJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// MG-DB Tabelle laden (gecacht im Speicher)
const dbCache = {};
function loadDbTable(tabelle) {
    if (dbCache[tabelle]) return dbCache[tabelle];
    const file = path.join(MG_DB, `${tabelle}.json`);
    if (!fs.existsSync(file)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        dbCache[tabelle] = Array.isArray(data) ? data : [data];
        return dbCache[tabelle];
    } catch { return null; }
}

// Suche in einem Array von Objekten (case-insensitive, alle Felder)
function searchArray(arr, query) {
    const q = query.toLowerCase();
    return arr.filter(item =>
        Object.values(item).some(v =>
            v !== null && v !== undefined && String(v).toLowerCase().includes(q)
        )
    );
}

// ── Router ───────────────────────────────────────────────────────────────────

async function handleRequest(req, res) {
    const parsed  = url.parse(req.url, true);
    const urlPath = parsed.pathname;
    const query   = parsed.query;
    const method  = req.method.toUpperCase();

    // CORS preflight
    if (method === 'OPTIONS') return send(res, 204, '');

    // ── API ────────────────────────────────────────────────────────────────

    if (urlPath.startsWith('/api/')) {
        const parts = urlPath.replace('/api/', '').split('/').filter(Boolean);

        // ── HELDEN ──────────────────────────────────────────────────────────

        if (parts[0] === 'helden') {
            const guid = parts[1];

            if (method === 'GET' && !guid) {
                // Liste aller Helden
                const files = fs.readdirSync(HELDEN).filter(f => f.endsWith('.json'));
                const liste = files.map(f => {
                    const held = loadJson(path.join(HELDEN, f));
                    return { guid: held?.HeldGUID, name: held?.Name, spieler: held?.Spieler };
                }).filter(h => h.guid);
                return send(res, 200, liste);
            }

            if (method === 'GET' && guid) {
                const held = loadJson(path.join(HELDEN, `${guid}.json`));
                if (!held) return send(res, 404, { error: 'Held nicht gefunden' });
                return send(res, 200, held);
            }

            if (method === 'POST' && guid) {
                const body = await readBody(req);
                if (!body.HeldGUID) body.HeldGUID = guid;
                saveJson(path.join(HELDEN, `${guid}.json`), body);
                return send(res, 200, { ok: true });
            }

            if (method === 'DELETE' && guid) {
                const file = path.join(HELDEN, `${guid}.json`);
                if (fs.existsSync(file)) fs.unlinkSync(file);
                return send(res, 200, { ok: true });
            }
        }

        // ── MG-DATENBANK ─────────────────────────────────────────────────────

        if (parts[0] === 'db') {
            const tabelle = parts[1];
            const id      = parts[2];

            if (!tabelle) {
                // Liste verfügbarer Tabellen
                const files = fs.existsSync(MG_DB)
                    ? fs.readdirSync(MG_DB).filter(f => f.endsWith('.json')).map(f => f.replace('.json',''))
                    : [];
                return send(res, 200, files);
            }

            const data = loadDbTable(tabelle);
            if (!data) return send(res, 404, { error: `Tabelle '${tabelle}' nicht gefunden` });

            if (id) {
                // Einzelner Eintrag per GUID oder Name
                const item = data.find(d =>
                    Object.values(d).some(v => String(v).toLowerCase() === id.toLowerCase())
                );
                if (!item) return send(res, 404, { error: 'Eintrag nicht gefunden' });
                return send(res, 200, item);
            }

            // Suche oder alle
            if (query.q) {
                const result = searchArray(data, query.q);
                const limit  = parseInt(query.limit) || 50;
                return send(res, 200, result.slice(0, limit));
            }

            // Paginierung
            const limit  = parseInt(query.limit)  || 100;
            const offset = parseInt(query.offset) || 0;
            return send(res, 200, {
                total: data.length,
                offset, limit,
                data: data.slice(offset, offset + limit)
            });
        }

        // ── KAMPFSAVES ────────────────────────────────────────────────────────

        if (parts[0] === 'saves') {
            const name = parts[1];

            if (method === 'GET' && !name) {
                const files = fs.existsSync(SAVES)
                    ? fs.readdirSync(SAVES).filter(f => f.endsWith('.json'))
                        .map(f => ({ name: f.replace('.json',''), mtime: fs.statSync(path.join(SAVES, f)).mtime }))
                        .sort((a,b) => new Date(b.mtime) - new Date(a.mtime))
                    : [];
                return send(res, 200, files);
            }
            if (method === 'GET' && name) {
                const data = loadJson(path.join(SAVES, `${name}.json`));
                if (!data) return send(res, 404, { error: 'Save nicht gefunden' });
                return send(res, 200, data);
            }
            if (method === 'POST' && name) {
                const body = await readBody(req);
                saveJson(path.join(SAVES, `${name}.json`), body);
                return send(res, 200, { ok: true });
            }
            if (method === 'DELETE' && name) {
                const file = path.join(SAVES, `${name}.json`);
                if (fs.existsSync(file)) fs.unlinkSync(file);
                return send(res, 200, { ok: true });
            }
        }

        // ── KAMPAGNE ──────────────────────────────────────────────────────────

        if (parts[0] === 'campaign') {
            if (method === 'GET') return send(res, 200, loadCampaign());
            if (method === 'POST') {
                const body = await readBody(req);
                saveJson(CAMPAIGN_FILE, body);
                return send(res, 200, { ok: true });
            }
        }

        // ── KONFIGURATION ──────────────────────────────────────────────────────

        if (parts[0] === 'config') {
            if (method === 'GET') return send(res, 200, loadConfig());
            if (method === 'POST') {
                const body = await readBody(req);
                saveConfig(body);
                return send(res, 200, { ok: true });
            }
        }

        return send(res, 404, { error: 'API-Endpunkt nicht gefunden' });
    }

    // ── STATISCHE DATEIEN ─────────────────────────────────────────────────────

    let filePath = path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath);
    if (!filePath.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');

    if (!fs.existsSync(filePath)) return send(res, 404, 'Not Found');

    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
}

// ── Server starten ────────────────────────────────────────────────────────────

const server = http.createServer(handleRequest);
server.listen(PORT, () => {
    const ip = Object.values(os.networkInterfaces())
        .flat().find(i => i.family === 'IPv4' && !i.internal)?.address || 'localhost';
    console.log('╔══════════════════════════════════════╗');
    console.log('║   DSA 4.1 SL-Tool Server v2.0        ║');
    console.log('╠══════════════════════════════════════╣');
    console.log(`║   Lokal:    http://localhost:${PORT}    ║`);
    console.log(`║   Netzwerk: http://${ip}:${PORT}   ║`);
    console.log('╠══════════════════════════════════════╣');
    console.log('║   API: /api/helden  /api/db/:tabelle ║');
    console.log('║        /api/saves   /api/campaign    ║');
    console.log('╚══════════════════════════════════════╝');
});
