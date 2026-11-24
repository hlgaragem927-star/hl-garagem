'use strict';
/*
 * HL GARAGEM — servidor do site, agendamento e painel administrativo.
 * Sem dependências externas: usa apenas módulos nativos do Node.js (>= 22.13).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const TZ = 'America/Sao_Paulo';
const SESSION_MS = 8 * 60 * 60 * 1000;

const KINDS = ['wash', 'polish', 'ceramic', 'interior', 'seat', 'headlight', 'ppf', 'revive'];
const VEHICLE_KINDS = ['hatch', 'sedan', 'suv', 'picape', 'esportivo', 'moto', 'outro'];
const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

// O e-mail de contato vem da variável CONTACT_EMAIL (arquivo .env) ou do painel, em Configurações.
const DEFAULT_SETTINGS = {
  business_name: 'HL GARAGEM',
  whatsapp: '5511998654294',
  email: '',
  phone_display: '(11) 99865-4294',
  address: '',
  instagram: '',
  open_days: '1,2,3,4,5,6',
  open_time: '08:00',
  close_time: '18:00',
  slot_step: '30',
  capacity: '1',
  min_notice_min: '60',
  max_advance_days: '60',
  blocked_dates: '',
  prices_reviewed: '0',
  hero_image: '',
};
const PUBLIC_SETTINGS = ['hero_image', 'business_name', 'whatsapp', 'email', 'phone_display', 'address', 'instagram', 'open_days', 'open_time', 'close_time', 'max_advance_days'];

const SEED_SERVICES = [
  ['Lavagem simples', 'wash', 'Lavagem externa rápida com shampoo neutro, rodas e secagem, para manter o carro limpo no dia a dia.', 50, 60],
  ['Lavagem detalhada', 'wash', 'Limpeza completa da parte externa, rodas, vãos de portas e acabamento, com secagem cuidadosa para não riscar a pintura.', 150, 120],
  ['Polimento técnico', 'polish', 'Remoção de riscos leves e marcas de lavagem para devolver profundidade e brilho à pintura.', 600, 300],
  ['Vitrificação de pintura', 'ceramic', 'Camada cerâmica que repele água e sujeira e deixa a limpeza do dia a dia mais fácil.', 1200, 480],
  ['Higienização interna', 'interior', 'Limpeza profunda de carpetes, painéis, portas e teto para remover sujeira, odores e manchas.', 350, 180],
  ['Limpeza de bancos', 'seat', 'Higienização de bancos em couro ou tecido, com remoção de manchas e hidratação do material.', 250, 120],
  ['Restauração de faróis', 'headlight', 'Remove o amarelado e a opacidade das lentes e aplica proteção para devolver a luz e o visual.', 200, 90],
  ['Proteção de pintura', 'ppf', 'Película de proteção contra pequenos impactos, riscos e desgaste nas áreas mais expostas.', 2500, 480],
  ['Revitalização automotiva', 'revive', 'Recupera pintura opaca e desbotada, plásticos ressecados e detalhes externos para um visual renovado.', 800, 360],
];

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
  price_cents INTEGER NOT NULL, duration_min INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL DEFAULT 'polish', before_image TEXT, after_image TEXT, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, whatsapp TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL, price_cents INTEGER NOT NULL, duration_min INTEGER NOT NULL,
  vehicle_kind TEXT NOT NULL, vehicle_brand TEXT NOT NULL, vehicle_model TEXT NOT NULL,
  date TEXT NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date, status);
CREATE TABLE IF NOT EXISTS visits (day TEXT NOT NULL, visitor TEXT NOT NULL, first_at TEXT NOT NULL, PRIMARY KEY (day, visitor));
CREATE TABLE IF NOT EXISTS pageviews (day TEXT PRIMARY KEY, views INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', text TEXT NOT NULL,
  created_at TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS testimonials (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, vehicle TEXT NOT NULL DEFAULT '', text TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, admin TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '');
`;

/* ---------- utilidades ---------- */

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function loadEnvFile(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch { /* sem .env */ }
}

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const validTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function spNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  return { date: `${o.year}-${o.month}-${o.day}`, minutes: Number(o.hour) * 60 + Number(o.minute) };
}

function normalizePhone(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  if (Number(d.slice(0, 2)) < 11) return null;
  if (d.length === 11 && d[2] !== '9') return null;
  return d;
}

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const key = await scrypt(pw, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(pw, Buffer.from(salt, 'base64'), 64, { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(hash, 'base64');
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}
const DUMMY_HASH = (() => {
  const salt = Buffer.alloc(16, 7);
  const key = crypto.scryptSync('dummy', salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
})();

function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'servico';
}

function imageType(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/* ---------- aplicação ---------- */

function createApp(opts = {}) {
  const dataDir = path.resolve(opts.dataDir || process.env.DATA_DIR || path.join(ROOT, 'data'));
  const publicDir = path.join(ROOT, 'public');
  const uploadsDir = path.join(dataDir, 'uploads');
  const backupsDir = path.join(dataDir, 'backups');
  const prod = opts.production ?? process.env.NODE_ENV === 'production';
  const trustProxy = opts.trustProxy ?? process.env.TRUST_PROXY === '1';
  const COOKIE = prod ? '__Host-hlg_sid' : 'hlg_sid';

  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(backupsDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'hlg.db'));
  db.exec(SCHEMA);

  const q = (sql) => db.prepare(sql);

  /* configurações */
  function getSettings() {
    const s = { ...DEFAULT_SETTINGS };
    if (process.env.CONTACT_EMAIL) s.email = clean(process.env.CONTACT_EMAIL, 120);
    for (const r of q('SELECT key, value FROM settings').all()) if (r.key in DEFAULT_SETTINGS) s[r.key] = r.value;
    return s;
  }
  function setSetting(key, value) {
    q('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  }
  function getSecret() {
    const row = q("SELECT value FROM settings WHERE key = 'visit_secret'").get();
    if (row) return row.value;
    const v = crypto.randomBytes(32).toString('hex');
    q("INSERT INTO settings(key, value) VALUES('visit_secret', ?)").run(v);
    return v;
  }
  const visitSecret = getSecret();

  /* seed de serviços */
  if (q('SELECT COUNT(*) AS n FROM services').get().n === 0) {
    const ins = q('INSERT INTO services(slug, name, description, price_cents, duration_min, active, kind, before_image, after_image, sort) VALUES(?,?,?,?,?,1,?,?,?,?)');
    SEED_SERVICES.forEach(([name, kind, desc, price, dur], i) => {
      const slug = slugify(name);
      // fotos reais de antes e depois que acompanham o projeto (public/img/servicos)
      ins.run(slug, name, desc, price * 100, dur, kind, `/img/servicos/${slug}-antes.jpg`, `/img/servicos/${slug}-depois.jpg`, i);
    });
  }

  /* bancos já existentes: garante a Lavagem simples (a partir de R$ 50), uma única vez */
  if (!q("SELECT 1 FROM services WHERE slug = 'lavagem-simples'").get()) {
    const [name, kind, desc, price, dur] = SEED_SERVICES[0];
    q('INSERT INTO services(slug, name, description, price_cents, duration_min, active, kind, before_image, after_image, sort) VALUES(?,?,?,?,?,1,?,?,?,?)')
      .run('lavagem-simples', name, desc, price * 100, dur, kind, '/img/servicos/lavagem-simples-antes.jpg', '/img/servicos/lavagem-simples-depois.jpg', -1);
  }

  /* limite de requisições (em memória) */
  const hits = new Map();
  const rlCount = (key, windowMs) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    hits.set(key, arr);
    return arr.length;
  };
  const rlAdd = (key) => { const a = hits.get(key) || []; a.push(Date.now()); hits.set(key, a); };
  const rlCheck = (key, max, windowMs) => {
    if (rlCount(key, windowMs) >= max) throw new HttpError(429, 'Muitas tentativas. Aguarde um pouco e tente de novo.');
    rlAdd(key);
  };
  const cleaner = setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of hits) { const f = arr.filter((t) => now - t < 3600e3); if (f.length) hits.set(k, f); else hits.delete(k); }
    q('DELETE FROM sessions WHERE expires_at < ?').run(now);
  }, 10 * 60e3);
  cleaner.unref();

  const clientIp = (req) => {
    if (trustProxy) {
      const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (xf) return xf;
    }
    return req.socket.remoteAddress || '0.0.0.0';
  };

  /* respostas */
  function baseHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', CSP);
    if (prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  function send(res, status, body) {
    if (status === 204) { res.writeHead(204); return res.end(); }
    const data = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) });
    res.end(data);
  }
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { reject(new HttpError(413, 'Arquivo ou dados grandes demais.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  async function readJson(req) {
    const type = String(req.headers['content-type'] || '');
    if (!type.startsWith('application/json')) throw new HttpError(415, 'Formato de envio inválido.');
    const buf = await readBody(req, 64 * 1024);
    try {
      const v = JSON.parse(buf.toString('utf8') || '{}');
      if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('x');
      return v;
    } catch { throw new HttpError(400, 'Dados inválidos.'); }
  }

  /* sessão do administrador */
  function parseCookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }
  function getSession(req) {
    const token = parseCookies(req)[COOKIE];
    if (!token || token.length > 100) return null;
    const row = q(`SELECT s.csrf, s.expires_at, a.id AS admin_id, a.username FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ?`).get(sha256(token));
    if (!row || row.expires_at < Date.now()) return null;
    return row;
  }
  function requireAdmin(req) {
    const s = getSession(req);
    if (!s) throw new HttpError(401, 'Entre no painel para continuar.');
    if (!['GET', 'HEAD'].includes(req.method)) {
      const sent = String(req.headers['x-csrf-token'] || '');
      const a = Buffer.from(sent), b = Buffer.from(s.csrf);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(403, 'Sessão inválida. Recarregue a página.');
    }
    return s;
  }
  const audit = (admin, action, detail, ip) =>
    q('INSERT INTO audit_log(at, admin, action, detail, ip) VALUES(?,?,?,?,?)').run(new Date().toISOString(), admin, action, String(detail || '').slice(0, 300), ip || '');

  /* disponibilidade */
  function checkDate(date, S) {
    if (!validDate(date)) return 'Data inválida.';
    const now = spNow();
    if (date < now.date) return 'Essa data já passou.';
    if (date > addDays(now.date, Number(S.max_advance_days))) return 'Essa data ainda não está disponível para agendamento.';
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    if (!S.open_days.split(',').map(Number).includes(dow)) return 'Não atendemos neste dia da semana.';
    if (S.blocked_dates.split(',').map((x) => x.trim()).includes(date)) return 'Não há atendimento nesta data.';
    return null;
  }
  function freeSlots(duration, date, S) {
    const err = checkDate(date, S);
    if (err) return { error: err, slots: [] };
    const open = toMin(S.open_time), close = toMin(S.close_time), step = Number(S.slot_step), cap = Number(S.capacity);
    const rows = q("SELECT start_min, end_min FROM bookings WHERE date = ? AND status IN ('pending','confirmed')").all(date);
    const now = spNow();
    const minStart = date === now.date ? now.minutes + Number(S.min_notice_min) : -1;
    const slots = [];
    for (let s = open; s + duration <= close; s += step) {
      if (s < minStart) continue;
      const e = s + duration;
      let n = 0;
      for (const r of rows) if (r.start_min < e && s < r.end_min) n++;
      if (n < cap) slots.push(s);
    }
    return { slots };
  }

  /* serviços */
  function cleanService(b, current) {
    const S = getSettings();
    const windowLen = toMin(S.close_time) - toMin(S.open_time);
    const out = {};
    const name = clean(b.name ?? current?.name, 60);
    if (name.length < 2) throw new HttpError(400, 'Informe o nome do serviço.');
    out.name = name;
    out.description = clean(b.description ?? current?.description ?? '', 400);
    const priceReais = b.price !== undefined ? Number(b.price) : current ? current.price_cents / 100 : NaN;
    if (!Number.isFinite(priceReais) || priceReais < 0 || priceReais > 200000) throw new HttpError(400, 'Preço inválido.');
    out.price_cents = Math.round(priceReais * 100);
    const dur = Number(b.duration_min ?? current?.duration_min);
    if (!Number.isInteger(dur) || dur < 15 || dur > windowLen) throw new HttpError(400, `A duração deve ficar entre 15 minutos e ${windowLen} minutos (o horário de atendimento do dia).`);
    out.duration_min = dur;
    const kind = String(b.kind ?? current?.kind ?? 'polish');
    if (!KINDS.includes(kind)) throw new HttpError(400, 'Tipo de ilustração inválido.');
    out.kind = kind;
    out.active = b.active === undefined ? (current ? current.active : 1) : b.active ? 1 : 0;
    out.sort = Number.isInteger(b.sort) ? b.sort : current?.sort ?? 0;
    return out;
  }
  const imageUrl = (v) => (!v ? null : v.startsWith('/img/') ? v : '/uploads/' + v);
  function publicService(r) {
    return {
      id: r.id, name: r.name, description: r.description, price_cents: r.price_cents, duration_min: r.duration_min, kind: r.kind,
      before_image: imageUrl(r.before_image), after_image: imageUrl(r.after_image),
    };
  }
  function adminService(r) { return { ...publicService(r), active: !!r.active, sort: r.sort }; }

  function removeUpload(file) {
    if (file && /^[a-f0-9]{32}\.(jpg|png|webp)$/.test(file)) fs.rm(path.join(uploadsDir, file), { force: true }, () => {});
  }

  /* backups */
  function listBackups() {
    return fs.readdirSync(backupsDir).filter((n) => /^hlg-\d{8}-\d{6}\.db$/.test(n)).sort().reverse()
      .map((name) => ({ name, size: fs.statSync(path.join(backupsDir, name)).size }));
  }
  function makeBackup() {
    const d = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const name = `hlg-${d}.db`;
    const file = path.join(backupsDir, name);
    if (fs.existsSync(file)) return name;
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    for (const old of listBackups().slice(14)) fs.rmSync(path.join(backupsDir, old.name), { force: true });
    return name;
  }
  function ensureDailyBackup() {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    if (!listBackups().some((b) => b.name.startsWith('hlg-' + today))) {
      try { makeBackup(); } catch (e) { console.error('Falha no backup automático:', e.message); }
    }
  }
  const backupTimer = setInterval(ensureDailyBackup, 6 * 3600e3);
  backupTimer.unref();

  /* ---------- rotas públicas ---------- */
  async function publicRoutes(req, res, p, url) {
    const m = req.method;
    const ip = clientIp(req);

    if (p === '/api/public' && m === 'GET') {
      const S = getSettings();
      const pub = {};
      for (const k of PUBLIC_SETTINGS) pub[k] = S[k];
      pub.hero_image = S.hero_image ? '/uploads/' + S.hero_image : (fs.existsSync(path.join(ROOT, 'public', 'img', 'hero.jpg')) ? '/img/hero.jpg' : '');
      return send(res, 200, {
        settings: pub,
        services: q('SELECT * FROM services WHERE active = 1 ORDER BY sort, id').all().map(publicService),
        testimonials: q('SELECT name, vehicle, text FROM testimonials WHERE active = 1 ORDER BY id DESC LIMIT 12').all(),
        vehicle_kinds: VEHICLE_KINDS,
      });
    }

    if (p === '/api/availability' && m === 'GET') {
      const id = Number(url.searchParams.get('service_id'));
      const date = String(url.searchParams.get('date') || '');
      const svc = q('SELECT duration_min FROM services WHERE id = ? AND active = 1').get(id);
      if (!svc) throw new HttpError(404, 'Serviço não encontrado.');
      const r = freeSlots(svc.duration_min, date, getSettings());
      return send(res, 200, { date, duration_min: svc.duration_min, error: r.error || null, slots: r.slots });
    }

    if (p === '/api/visit' && m === 'POST') {
      if (getSession(req)) return send(res, 204);
      const ua = String(req.headers['user-agent'] || '');
      if (!ua || /bot|crawl|spider|slurp|headless|preview|curl|wget|python|monitor/i.test(ua)) return send(res, 204);
      if (rlCount('visit:' + ip, 3600e3) >= 60) return send(res, 204);
      rlAdd('visit:' + ip);
      const day = spNow().date;
      const visitor = crypto.createHmac('sha256', visitSecret + day).update(ip + '|' + ua).digest('hex').slice(0, 32);
      q('INSERT OR IGNORE INTO visits(day, visitor, first_at) VALUES(?,?,?)').run(day, visitor, new Date().toISOString());
      q('INSERT INTO pageviews(day, views) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET views = views + 1').run(day);
      return send(res, 204);
    }

    if (p === '/api/bookings' && m === 'POST') {
      const b = await readJson(req);
      if (b.website) return send(res, 200, { ok: true }); // campo-isca para robôs
      const S = getSettings();
      const svc = q('SELECT * FROM services WHERE id = ? AND active = 1').get(Number(b.service_id));
      if (!svc) throw new HttpError(400, 'Escolha um serviço.');
      const vehicleKind = String(b.vehicle_kind || '');
      if (!VEHICLE_KINDS.includes(vehicleKind)) throw new HttpError(400, 'Escolha o tipo do veículo.');
      const brand = clean(b.vehicle_brand, 40), model = clean(b.vehicle_model, 40);
      if (!brand || !model) throw new HttpError(400, 'Informe a marca e o modelo do veículo.');
      const name = clean(b.name, 80);
      if (name.length < 2) throw new HttpError(400, 'Informe seu nome.');
      const phone = normalizePhone(b.phone);
      if (!phone) throw new HttpError(400, 'Informe um telefone com DDD, por exemplo (11) 99999-9999.');
      const wa = b.whatsapp ? normalizePhone(b.whatsapp) : phone;
      if (!wa) throw new HttpError(400, 'O WhatsApp informado é inválido.');
      if (b.consent !== true) throw new HttpError(400, 'Aceite o uso dos seus dados para o agendamento.');
      const date = String(b.date || '');
      const start = Number(b.start_min);
      if (!Number.isInteger(start)) throw new HttpError(400, 'Escolha um horário.');
      const notes = clean(b.notes, 300);

      db.exec('BEGIN IMMEDIATE');
      try {
        const free = freeSlots(svc.duration_min, date, S);
        if (free.error) throw new HttpError(400, free.error);
        const openMin = toMin(S.open_time), closeMin = toMin(S.close_time), step = Number(S.slot_step);
        if (start < openMin || start + svc.duration_min > closeMin || (start - openMin) % step !== 0) throw new HttpError(400, 'Horário inválido para este serviço.');
        if (!free.slots.includes(start)) throw new HttpError(409, 'Esse horário não está mais disponível. Escolha outro horário.');
        let client = q('SELECT id FROM clients WHERE phone = ?').get(phone);
        if (client) q('UPDATE clients SET name = ?, whatsapp = ? WHERE id = ?').run(name, wa, client.id);
        else client = { id: q('INSERT INTO clients(name, phone, whatsapp, created_at) VALUES(?,?,?,?)').run(name, phone, wa, new Date().toISOString()).lastInsertRowid };
        const info = q(`INSERT INTO bookings(client_id, service_id, service_name, price_cents, duration_min, vehicle_kind, vehicle_brand, vehicle_model, date, start_min, end_min, status, notes, created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)`)
          .run(client.id, svc.id, svc.name, svc.price_cents, svc.duration_min, vehicleKind, brand, model, date, start, start + svc.duration_min, notes, new Date().toISOString());
        db.exec('COMMIT');
        return send(res, 201, {
          id: Number(info.lastInsertRowid), service: svc.name, price_cents: svc.price_cents, duration_min: svc.duration_min,
          date, start_min: start, whatsapp: S.whatsapp,
        });
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* já finalizado */ }
        throw e;
      }
    }

    if (p === '/api/messages' && m === 'POST') {
      const b = await readJson(req);
      if (b.website) return send(res, 200, { ok: true });
      const name = clean(b.name, 80), text = clean(b.text, 1000);
      if (name.length < 2) throw new HttpError(400, 'Informe seu nome.');
      if (text.length < 5) throw new HttpError(400, 'Escreva sua mensagem.');
      if (b.consent !== true) throw new HttpError(400, 'Aceite o uso dos seus dados para receber a resposta.');
      const phone = b.phone ? normalizePhone(b.phone) : '';
      if (b.phone && !phone) throw new HttpError(400, 'Telefone inválido.');
      q('INSERT INTO messages(name, phone, text, created_at) VALUES(?,?,?,?)').run(name, phone || '', text, new Date().toISOString());
      return send(res, 201, { ok: true });
    }
    return false;
  }

  /* ---------- rotas do administrador ---------- */
  async function adminRoutes(req, res, p, url) {
    const m = req.method;
    const ip = clientIp(req);

    if (p === '/api/admin/login' && m === 'POST') {
      const b = await readJson(req);
      const user = clean(b.username, 60).toLowerCase();
      const pw = String(b.password || '').slice(0, 200);
      if (rlCount('login:' + ip, 15 * 60e3) >= 10 || rlCount('loginu:' + user, 15 * 60e3) >= 5)
        throw new HttpError(429, 'Muitas tentativas de entrada. Aguarde 15 minutos.');
      const admin = q('SELECT * FROM admins WHERE username = ?').get(user);
      const ok = await verifyPassword(pw, admin ? admin.pass_hash : DUMMY_HASH);
      if (!admin || !ok) {
        rlAdd('login:' + ip); rlAdd('loginu:' + user);
        audit(user || '-', 'login_falhou', '', ip);
        throw new HttpError(401, 'Usuário ou senha incorretos.');
      }
      hits.delete('loginu:' + user);
      const token = crypto.randomBytes(32).toString('base64url');
      const csrf = crypto.randomBytes(24).toString('base64url');
      q('INSERT INTO sessions(token_hash, admin_id, csrf, expires_at, created_at) VALUES(?,?,?,?,?)').run(sha256(token), admin.id, csrf, Date.now() + SESSION_MS, Date.now());
      res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${prod ? '; Secure' : ''}`);
      audit(admin.username, 'login', '', ip);
      return send(res, 200, { csrf, username: admin.username });
    }

    const s = requireAdmin(req);
    const who = s.username;

    if (p === '/api/admin/me' && m === 'GET') return send(res, 200, { username: who, csrf: s.csrf });

    if (p === '/api/admin/logout' && m === 'POST') {
      const token = parseCookies(req)[COOKIE];
      q('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
      res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${prod ? '; Secure' : ''}`);
      audit(who, 'logout', '', ip);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/password' && m === 'POST') {
      const b = await readJson(req);
      const cur = String(b.current || ''), next = String(b.next || '');
      if (next.length < 10 || next.length > 200) throw new HttpError(400, 'A nova senha precisa ter pelo menos 10 caracteres.');
      const row = q('SELECT * FROM admins WHERE id = ?').get(s.admin_id);
      if (!(await verifyPassword(cur, row.pass_hash))) throw new HttpError(400, 'A senha atual está incorreta.');
      q('UPDATE admins SET pass_hash = ? WHERE id = ?').run(await hashPassword(next), s.admin_id);
      const token = parseCookies(req)[COOKIE];
      q('DELETE FROM sessions WHERE admin_id = ? AND token_hash != ?').run(s.admin_id, sha256(token));
      audit(who, 'senha_alterada', '', ip);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/admin/stats' && m === 'GET') {
      const today = spNow().date;
      const uniq = (from) => q('SELECT COUNT(*) AS n FROM visits WHERE day >= ?').get(from).n;
      const views = (from) => q('SELECT COALESCE(SUM(views),0) AS n FROM pageviews WHERE day >= ?').get(from).n;
      const from14 = addDays(today, -13);
      const uniqByDay = Object.fromEntries(q('SELECT day, COUNT(*) AS n FROM visits WHERE day >= ? GROUP BY day').all(from14).map((r) => [r.day, r.n]));
      const viewsByDay = Object.fromEntries(q('SELECT day, views FROM pageviews WHERE day >= ?').all(from14).map((r) => [r.day, r.views]));
      const series = [];
      for (let i = 13; i >= 0; i--) { const d = addDays(today, -i); series.push({ day: d, visitors: uniqByDay[d] || 0, views: viewsByDay[d] || 0 }); }
      const byStatus = Object.fromEntries(q('SELECT status, COUNT(*) AS n, COALESCE(SUM(price_cents),0) AS cents FROM bookings GROUP BY status').all().map((r) => [r.status, { n: r.n, cents: r.cents }]));
      const get = (st) => byStatus[st] || { n: 0, cents: 0 };
      const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
      const visitors30 = uniq(addDays(today, -29));
      const bookings30 = q('SELECT COUNT(*) AS n FROM bookings WHERE created_at >= ?').get(since30).n;
      return send(res, 200, {
        today,
        visitors: { today: uniq(today), last7: uniq(addDays(today, -6)), last30: visitors30, total: q('SELECT COUNT(*) AS n FROM visits').get().n },
        views: { today: views(today), last7: views(addDays(today, -6)), last30: views(addDays(today, -29)) },
        series,
        bookings: {
          total: get('pending').n + get('confirmed').n + get('completed').n + get('cancelled').n,
          pending: get('pending').n, confirmed: get('confirmed').n, completed: get('completed').n, cancelled: get('cancelled').n,
        },
        revenue_cents: get('completed').cents,
        forecast_cents: get('pending').cents + get('confirmed').cents,
        new_clients_30d: q('SELECT COUNT(*) AS n FROM clients WHERE created_at >= ?').get(since30).n,
        conversion_pct: visitors30 > 0 ? Math.round((bookings30 / visitors30) * 1000) / 10 : null,
        top_services: q("SELECT service_name AS name, COUNT(*) AS n, COALESCE(SUM(price_cents),0) AS cents FROM bookings WHERE status != 'cancelled' GROUP BY service_name ORDER BY n DESC, cents DESC LIMIT 6").all(),
        unread_messages: q('SELECT COUNT(*) AS n FROM messages WHERE is_read = 0').get().n,
        prices_reviewed: getSettings().prices_reviewed === '1',
      });
    }

    if (p === '/api/admin/bookings' && m === 'GET') {
      let sql = `SELECT b.*, c.name AS client_name, c.phone, c.whatsapp FROM bookings b JOIN clients c ON c.id = b.client_id WHERE 1=1`;
      const params = [];
      const status = url.searchParams.get('status');
      if (status && STATUSES.includes(status)) { sql += ' AND b.status = ?'; params.push(status); }
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      if (from && validDate(from)) { sql += ' AND b.date >= ?'; params.push(from); }
      if (to && validDate(to)) { sql += ' AND b.date <= ?'; params.push(to); }
      const term = clean(url.searchParams.get('q'), 60);
      if (term) {
        const like = '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
        sql += ` AND (c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR b.vehicle_model LIKE ? ESCAPE '\\' OR b.vehicle_brand LIKE ? ESCAPE '\\' OR b.service_name LIKE ? ESCAPE '\\')`;
        params.push(like, like, like, like, like);
      }
      sql += ' ORDER BY b.date DESC, b.start_min DESC LIMIT 500';
      return send(res, 200, { bookings: q(sql).all(...params) });
    }
    let mm;
    if ((mm = p.match(/^\/api\/admin\/bookings\/(\d+)$/))) {
      const id = Number(mm[1]);
      const row = q('SELECT * FROM bookings WHERE id = ?').get(id);
      if (!row) throw new HttpError(404, 'Agendamento não encontrado.');
      if (m === 'PATCH') {
        const b = await readJson(req);
        if (!STATUSES.includes(b.status)) throw new HttpError(400, 'Status inválido.');
        q('UPDATE bookings SET status = ? WHERE id = ?').run(b.status, id);
        audit(who, 'agendamento_status', `#${id} ${row.status} -> ${b.status}`, ip);
        return send(res, 200, { ok: true });
      }
      if (m === 'DELETE') {
        q('DELETE FROM bookings WHERE id = ?').run(id);
        audit(who, 'agendamento_excluido', `#${id} ${row.service_name} ${row.date}`, ip);
        return send(res, 200, { ok: true });
      }
    }

    if (p === '/api/admin/clients' && m === 'GET') {
      const rows = q(`SELECT c.id, c.name, c.phone, c.whatsapp, c.created_at, COUNT(b.id) AS bookings,
        COALESCE(SUM(CASE WHEN b.status = 'completed' THEN b.price_cents END), 0) AS spent_cents,
        MAX(CASE WHEN b.status = 'completed' THEN b.date END) AS last_service
        FROM clients c LEFT JOIN bookings b ON b.client_id = c.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 1000`).all();
      return send(res, 200, { clients: rows });
    }
    if ((mm = p.match(/^\/api\/admin\/clients\/(\d+)(\/export)?$/))) {
      const id = Number(mm[1]);
      const c = q('SELECT * FROM clients WHERE id = ?').get(id);
      if (!c) throw new HttpError(404, 'Cliente não encontrado.');
      if (m === 'GET') {
        const history = q('SELECT * FROM bookings WHERE client_id = ? ORDER BY date DESC, start_min DESC').all(id);
        if (mm[2]) audit(who, 'cliente_exportado', `#${id}`, ip);
        return send(res, 200, { client: c, bookings: history });
      }
      if (m === 'DELETE' && !mm[2]) {
        q('DELETE FROM clients WHERE id = ?').run(id);
        audit(who, 'cliente_excluido', `#${id}`, ip);
        return send(res, 200, { ok: true });
      }
    }

    if (p === '/api/admin/services' && m === 'GET') {
      return send(res, 200, { services: q('SELECT * FROM services ORDER BY sort, id').all().map(adminService), kinds: KINDS });
    }
    if (p === '/api/admin/services' && m === 'POST') {
      const b = await readJson(req);
      const v = cleanService(b, null);
      let slug = slugify(v.name);
      if (q('SELECT 1 FROM services WHERE slug = ?').get(slug)) slug += '-' + crypto.randomBytes(2).toString('hex');
      const max = q('SELECT COALESCE(MAX(sort), 0) AS n FROM services').get().n;
      const info = q('INSERT INTO services(slug, name, description, price_cents, duration_min, active, kind, sort) VALUES(?,?,?,?,?,?,?,?)')
        .run(slug, v.name, v.description, v.price_cents, v.duration_min, v.active, v.kind, max + 1);
      audit(who, 'servico_criado', v.name, ip);
      return send(res, 201, { id: Number(info.lastInsertRowid) });
    }
    if ((mm = p.match(/^\/api\/admin\/services\/(\d+)(?:\/(image))?$/))) {
      const id = Number(mm[1]);
      const row = q('SELECT * FROM services WHERE id = ?').get(id);
      if (!row) throw new HttpError(404, 'Serviço não encontrado.');
      if (!mm[2] && m === 'PUT') {
        const b = await readJson(req);
        const v = cleanService(b, row);
        q('UPDATE services SET name=?, description=?, price_cents=?, duration_min=?, active=?, kind=?, sort=? WHERE id=?')
          .run(v.name, v.description, v.price_cents, v.duration_min, v.active, v.kind, v.sort, id);
        audit(who, 'servico_editado', `${v.name}: R$ ${(v.price_cents / 100).toFixed(2)}, ${v.duration_min} min, ${v.active ? 'ativo' : 'inativo'}`, ip);
        return send(res, 200, { ok: true });
      }
      if (!mm[2] && m === 'DELETE') {
        q('DELETE FROM services WHERE id = ?').run(id);
        removeUpload(row.before_image); removeUpload(row.after_image);
        audit(who, 'servico_excluido', row.name, ip);
        return send(res, 200, { ok: true });
      }
      if (mm[2] === 'image') {
        const kind = url.searchParams.get('kind');
        if (!['before', 'after'].includes(kind)) throw new HttpError(400, 'Informe se a foto é do antes ou do depois.');
        const col = kind === 'before' ? 'before_image' : 'after_image';
        if (m === 'POST') {
          const buf = await readBody(req, 6 * 1024 * 1024);
          const ext = imageType(buf);
          if (!ext) throw new HttpError(400, 'Envie uma imagem JPG, PNG ou WEBP.');
          const file = crypto.randomBytes(16).toString('hex') + '.' + ext;
          fs.writeFileSync(path.join(uploadsDir, file), buf, { mode: 0o640 });
          q(`UPDATE services SET ${col} = ? WHERE id = ?`).run(file, id);
          removeUpload(row[col]);
          audit(who, 'foto_enviada', `${row.name} (${kind})`, ip);
          return send(res, 200, { url: '/uploads/' + file });
        }
        if (m === 'DELETE') {
          q(`UPDATE services SET ${col} = NULL WHERE id = ?`).run(id);
          removeUpload(row[col]);
          audit(who, 'foto_removida', `${row.name} (${kind})`, ip);
          return send(res, 200, { ok: true });
        }
      }
    }

    if (p === '/api/admin/messages' && m === 'GET') {
      return send(res, 200, { messages: q('SELECT * FROM messages ORDER BY id DESC LIMIT 300').all() });
    }
    if ((mm = p.match(/^\/api\/admin\/messages\/(\d+)$/))) {
      const id = Number(mm[1]);
      if (m === 'PATCH') { q('UPDATE messages SET is_read = 1 WHERE id = ?').run(id); return send(res, 200, { ok: true }); }
      if (m === 'DELETE') { q('DELETE FROM messages WHERE id = ?').run(id); audit(who, 'mensagem_excluida', `#${id}`, ip); return send(res, 200, { ok: true }); }
    }

    if (p === '/api/admin/testimonials' && m === 'GET') {
      return send(res, 200, { testimonials: q('SELECT * FROM testimonials ORDER BY id DESC').all() });
    }
    if (p === '/api/admin/testimonials' && m === 'POST') {
      const b = await readJson(req);
      const name = clean(b.name, 60), text = clean(b.text, 400);
      if (name.length < 2 || text.length < 5) throw new HttpError(400, 'Informe o nome do cliente e o depoimento.');
      q('INSERT INTO testimonials(name, vehicle, text, active, created_at) VALUES(?,?,?,?,?)').run(name, clean(b.vehicle, 60), text, b.active === false ? 0 : 1, new Date().toISOString());
      audit(who, 'depoimento_criado', name, ip);
      return send(res, 201, { ok: true });
    }
    if ((mm = p.match(/^\/api\/admin\/testimonials\/(\d+)$/))) {
      const id = Number(mm[1]);
      if (m === 'PATCH') {
        const b = await readJson(req);
        q('UPDATE testimonials SET active = ? WHERE id = ?').run(b.active ? 1 : 0, id);
        return send(res, 200, { ok: true });
      }
      if (m === 'DELETE') { q('DELETE FROM testimonials WHERE id = ?').run(id); audit(who, 'depoimento_excluido', `#${id}`, ip); return send(res, 200, { ok: true }); }
    }

    if (p === '/api/admin/hero-image') {
      const old = getSettings().hero_image;
      if (m === 'POST') {
        const buf = await readBody(req, 6 * 1024 * 1024);
        const ext = imageType(buf);
        if (!ext) throw new HttpError(400, 'Envie uma imagem JPG, PNG ou WEBP.');
        const file = crypto.randomBytes(16).toString('hex') + '.' + ext;
        fs.writeFileSync(path.join(uploadsDir, file), buf, { mode: 0o640 });
        setSetting('hero_image', file);
        removeUpload(old);
        audit(who, 'foto_principal_enviada', '', ip);
        return send(res, 200, { url: '/uploads/' + file });
      }
      if (m === 'DELETE') {
        setSetting('hero_image', '');
        removeUpload(old);
        audit(who, 'foto_principal_removida', '', ip);
        return send(res, 200, { ok: true });
      }
    }

    if (p === '/api/admin/settings' && m === 'GET') return send(res, 200, { settings: getSettings() });
    if (p === '/api/admin/settings' && m === 'PUT') {
      const b = await readJson(req);
      const cur = getSettings();
      const next = {};
      for (const [k, v] of Object.entries(b)) {
        if (!(k in DEFAULT_SETTINGS)) continue;
        switch (k) {
          case 'business_name': next[k] = clean(v, 60) || cur[k]; break;
          case 'phone_display': next[k] = clean(v, 30); break;
          case 'address': next[k] = clean(v, 160); break;
          case 'instagram': next[k] = clean(v, 60).replace(/^@/, ''); break;
          case 'email': {
            const e = clean(v, 120);
            if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'E-mail inválido.');
            next[k] = e; break;
          }
          case 'whatsapp': {
            const ph = normalizePhone(v);
            if (!ph) throw new HttpError(400, 'WhatsApp inválido. Use o DDD e o número.');
            next[k] = '55' + ph; break;
          }
          case 'open_days': {
            const days = [...new Set(String(v).split(',').map((x) => x.trim()).filter((x) => /^[0-6]$/.test(x)))].sort();
            if (!days.length) throw new HttpError(400, 'Escolha pelo menos um dia de atendimento.');
            next[k] = days.join(','); break;
          }
          case 'open_time': case 'close_time':
            if (!validTime(String(v))) throw new HttpError(400, 'Horário inválido.');
            next[k] = String(v); break;
          case 'slot_step':
            if (!['15', '30', '60'].includes(String(v))) throw new HttpError(400, 'Intervalo inválido.');
            next[k] = String(v); break;
          case 'capacity': case 'min_notice_min': case 'max_advance_days': {
            const n = Number(v);
            const lim = { capacity: [1, 5], min_notice_min: [0, 1440], max_advance_days: [1, 365] }[k];
            if (!Number.isInteger(n) || n < lim[0] || n > lim[1]) throw new HttpError(400, 'Número fora do limite permitido.');
            next[k] = String(n); break;
          }
          case 'blocked_dates': {
            const list = String(v).split(/[,\s]+/).filter(Boolean);
            if (list.length > 200 || list.some((d) => !validDate(d))) throw new HttpError(400, 'Use datas no formato AAAA-MM-DD, separadas por vírgula.');
            next[k] = [...new Set(list)].sort().join(','); break;
          }
          case 'prices_reviewed': next[k] = v ? '1' : '0'; break;
        }
      }
      const merged = { ...cur, ...next };
      if (toMin(merged.open_time) >= toMin(merged.close_time)) throw new HttpError(400, 'O horário de abertura deve ser antes do fechamento.');
      for (const [k, v] of Object.entries(next)) setSetting(k, v);
      audit(who, 'configuracoes', Object.keys(next).join(', '), ip);
      return send(res, 200, { settings: getSettings() });
    }

    if (p === '/api/admin/log' && m === 'GET') return send(res, 200, { log: q('SELECT * FROM audit_log ORDER BY id DESC LIMIT 150').all() });

    if (p === '/api/admin/backups' && m === 'GET') return send(res, 200, { backups: listBackups() });
    if (p === '/api/admin/backups' && m === 'POST') {
      const name = makeBackup();
      audit(who, 'backup_criado', name, ip);
      return send(res, 201, { name, backups: listBackups() });
    }
    if ((mm = p.match(/^\/api\/admin\/backups\/(hlg-\d{8}-\d{6}\.db)$/)) && m === 'GET') {
      const file = path.join(backupsDir, mm[1]);
      if (!fs.existsSync(file)) throw new HttpError(404, 'Backup não encontrado.');
      audit(who, 'backup_baixado', mm[1], ip);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${mm[1]}"`, 'Cache-Control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    }
    return false;
  }

  /* ---------- arquivos estáticos ---------- */
  function serveFile(req, res, file, cache) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Página não encontrada.'); }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }
  function serveStatic(req, res, p) {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    let rel;
    try { rel = decodeURIComponent(p); } catch { res.writeHead(400); return res.end(); }
    if (rel.includes('\0')) { res.writeHead(400); return res.end(); }
    if (rel === '/') rel = '/index.html';
    if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
    if (rel === '/privacidade') rel = '/privacidade.html';
    const file = path.join(publicDir, path.normalize(rel));
    if (!file.startsWith(publicDir + path.sep)) { res.writeHead(403); return res.end(); }
    const cache = rel.endsWith('.html') ? 'no-cache' : 'public, max-age=3600';
    serveFile(req, res, file, cache);
  }
  function serveUpload(req, res, p) {
    const name = p.slice('/uploads/'.length);
    if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(name)) { res.writeHead(404); return res.end(); }
    serveFile(req, res, path.join(uploadsDir, name), 'public, max-age=86400');
  }

  /* ---------- servidor ---------- */
  const server = http.createServer(async (req, res) => {
    baseHeaders(res);
    try {
      if (prod && trustProxy && req.headers['x-forwarded-proto'] === 'http') {
        res.writeHead(301, { Location: 'https://' + req.headers.host + req.url });
        return res.end();
      }
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      if (p === '/healthz') return send(res, 200, { ok: true });
      if (p.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) {
          const origin = req.headers.origin;
          if (origin) {
            let host = '';
            try { host = new URL(origin).host; } catch { /* inválido */ }
            if (host !== req.headers.host) throw new HttpError(403, 'Origem não permitida.');
          }
        }
        let done = false;
        if (p.startsWith('/api/admin/')) done = await adminRoutes(req, res, p, url);
        else done = await publicRoutes(req, res, p, url);
        if (done === false && !res.writableEnded) throw new HttpError(404, 'Recurso não encontrado.');
        return;
      }
      if (p.startsWith('/uploads/')) return serveUpload(req, res, p);
      return serveStatic(req, res, p);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error('Erro interno:', e);
      return send(res, 500, { error: 'Algo deu errado. Tente novamente em instantes.' });
    }
  });

  /* administrador inicial */
  async function ensureAdmin() {
    if (q('SELECT COUNT(*) AS n FROM admins').get().n > 0) return null;
    const username = clean(opts.adminUser || process.env.ADMIN_USER || 'admin', 60).toLowerCase();
    let password = opts.adminPassword || process.env.ADMIN_PASSWORD || '';
    let generated = false;
    if (password.length < 10) {
      if (password) console.warn('ADMIN_PASSWORD tem menos de 10 caracteres. Uma senha forte será gerada.');
      password = crypto.randomBytes(12).toString('base64url');
      generated = true;
    }
    q('INSERT INTO admins(username, pass_hash, created_at) VALUES(?,?,?)').run(username, await hashPassword(password), new Date().toISOString());
    return { username, password: generated ? password : null };
  }

  function close() {
    clearInterval(cleaner); clearInterval(backupTimer);
    return new Promise((resolve) => server.close(() => { try { db.close(); } catch { /* ok */ } resolve(); }));
  }

  return { server, db, ensureAdmin, ensureDailyBackup, close, dataDir };
}

module.exports = { createApp };

if (require.main === module) {
  loadEnvFile(path.join(ROOT, '.env'));
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  app.ensureAdmin().then((created) => {
    if (created) {
      console.log('\n=== Administrador criado ===');
      console.log('Usuário:', created.username);
      if (created.password) console.log('Senha gerada (anote agora, ela não será mostrada de novo):', created.password);
      console.log('Troque a senha no painel, em Configurações.\n');
    }
    app.ensureDailyBackup();
    app.server.listen(port, () => console.log(`HL GARAGEM no ar na porta ${port}`));
  });
  const stop = () => app.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
