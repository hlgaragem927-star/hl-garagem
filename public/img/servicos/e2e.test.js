'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../server.js');

const ADMIN = { username: 'dono', password: 'SenhaForte!2026' };
let app, base, tmp;
let ipCounter = 10;
const nextIp = () => `10.0.0.${++ipCounter}`;

function pickDate(offset = 3) {
  const d = new Date(Date.now() + offset * 864e5);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function call(p, { method = 'GET', json, raw, headers = {}, cookie, csrf, ip } = {}) {
  const h = { 'x-forwarded-for': ip || nextIp(), ...headers };
  let body;
  if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
  if (raw !== undefined) { h['content-type'] = 'application/octet-stream'; body = raw; }
  if (cookie) h.cookie = cookie;
  if (csrf) h['x-csrf-token'] = csrf;
  const res = await fetch(base + p, { method, headers: h, body });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, body: data, headers: res.headers };
}

async function login(ip) {
  const r = await call('/api/admin/login', { method: 'POST', json: ADMIN, ip });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return { cookie, csrf: r.body.csrf, setCookie: r.headers.get('set-cookie') };
}

const booking = (over = {}) => ({
  service_id: 1, vehicle_kind: 'sedan', vehicle_brand: 'Honda', vehicle_model: 'Civic',
  date: pickDate(), start_min: 480, name: 'Cliente Teste', phone: '(11) 98888-1111', consent: true, ...over,
});

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hlg-'));
  app = createApp({ dataDir: tmp, trustProxy: true, production: false, adminUser: ADMIN.username, adminPassword: ADMIN.password });
  await app.ensureAdmin();
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
});
after(async () => { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('API pública entrega serviços e contato configurado', async () => {
  const r = await call('/api/public');
  assert.equal(r.status, 200);
  assert.equal(r.body.services.length, 8);
  assert.equal(r.body.settings.whatsapp, '5511998654294');
  assert.equal(r.body.settings.phone_display, '(11) 99865-4294');
  assert.ok(r.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('agendamento salva e impede horário ocupado', async () => {
  const date = pickDate();
  const a = await call('/api/bookings', { method: 'POST', json: booking({ date }) });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.service, 'Lavagem detalhada');
  const same = await call('/api/bookings', { method: 'POST', json: booking({ date, phone: '11977776666', name: 'Outra Pessoa' }) });
  assert.equal(same.status, 409);
  const overlap = await call('/api/bookings', { method: 'POST', json: booking({ date, start_min: 540, phone: '11977776666', name: 'Outra Pessoa' }) });
  assert.equal(overlap.status, 409);
  const after = await call('/api/bookings', { method: 'POST', json: booking({ date, start_min: 600, phone: '11977776666', name: 'Outra Pessoa' }) });
  assert.equal(after.status, 201);
  const av = await call(`/api/availability?service_id=1&date=${date}`);
  assert.equal(av.status, 200);
  assert.ok(!av.body.slots.includes(480) && !av.body.slots.includes(540) && !av.body.slots.includes(660));
  assert.ok(av.body.slots.includes(720));
});

test('validações recusam dados ruins', async () => {
  const bad = async (over, status = 400) => assert.equal((await call('/api/bookings', { method: 'POST', json: booking(over) })).status, status, JSON.stringify(over));
  await bad({ phone: '123' });
  await bad({ consent: false });
  await bad({ date: '2020-01-01' });
  await bad({ date: 'hoje' });
  await bad({ vehicle_kind: 'foguete' });
  await bad({ service_id: 999 });
  await bad({ name: '' });
  await bad({ start_min: 300, date: pickDate(4) }); // antes de abrir
  const sunday = new Date(); while (sunday.getUTCDay() !== 0) sunday.setUTCDate(sunday.getUTCDate() + 1);
  await bad({ date: sunday.toISOString().slice(0, 10) });
  const notJson = await fetch(base + '/api/bookings', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(notJson.status, 415);
});

test('texto malicioso é guardado como texto e o banco continua íntegro', async () => {
  const name = `Robert'); DROP TABLE bookings;-- <script>alert(1)</script>`;
  const r = await call('/api/bookings', { method: 'POST', json: booking({ date: pickDate(5), name, phone: '11966665555' }) });
  assert.equal(r.status, 201);
  const { cookie } = await login();
  const list = await call('/api/admin/bookings', { cookie });
  assert.equal(list.status, 200);
  assert.ok(list.body.bookings.some((b) => b.client_name.startsWith("Robert');")));
  const q = await call('/api/admin/bookings?q=' + encodeURIComponent("' OR 1=1 --"), { cookie });
  assert.equal(q.status, 200);
  assert.equal(q.body.bookings.length, 0);
});

test('painel exige login, sessão segura e proteção CSRF', async () => {
  assert.equal((await call('/api/admin/bookings')).status, 401);
  assert.equal((await call('/api/admin/stats')).status, 401);
  const wrong = await call('/api/admin/login', { method: 'POST', json: { username: ADMIN.username, password: 'errada-errada' } });
  assert.equal(wrong.status, 401);
  const s = await login();
  assert.match(s.setCookie, /HttpOnly/);
  assert.match(s.setCookie, /SameSite=Strict/);
  const noCsrf = await call('/api/admin/services/1', { method: 'PUT', json: { price: 10 }, cookie: s.cookie });
  assert.equal(noCsrf.status, 403);
  const evil = await call('/api/admin/services/1', { method: 'PUT', json: { price: 10 }, cookie: s.cookie, csrf: s.csrf, headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  const out = await call('/api/admin/logout', { method: 'POST', cookie: s.cookie, csrf: s.csrf });
  assert.equal(out.status, 200);
  assert.equal((await call('/api/admin/bookings', { cookie: s.cookie })).status, 401);
});

test('trocar preço no painel muda o site público', async () => {
  const s = await login();
  const put = await call('/api/admin/services/2', { method: 'PUT', json: { price: 777.5, duration_min: 240 }, cookie: s.cookie, csrf: s.csrf });
  assert.equal(put.status, 200);
  const pub = await call('/api/public');
  const svc = pub.body.services.find((x) => x.id === 2);
  assert.equal(svc.price_cents, 77750);
  assert.equal(svc.duration_min, 240);
  const off = await call('/api/admin/services/2', { method: 'PUT', json: { active: false }, cookie: s.cookie, csrf: s.csrf });
  assert.equal(off.status, 200);
  assert.ok(!(await call('/api/public')).body.services.some((x) => x.id === 2));
  await call('/api/admin/services/2', { method: 'PUT', json: { active: true }, cookie: s.cookie, csrf: s.csrf });
  const bad = await call('/api/admin/services/2', { method: 'PUT', json: { price: -5 }, cookie: s.cookie, csrf: s.csrf });
  assert.equal(bad.status, 400);
  const created = await call('/api/admin/services', { method: 'POST', json: { name: 'Cristalização de vidros', description: 'Teste', price: 99, duration_min: 60, kind: 'ceramic' }, cookie: s.cookie, csrf: s.csrf });
  assert.equal(created.status, 201);
  const del = await call('/api/admin/services/' + created.body.id, { method: 'DELETE', cookie: s.cookie, csrf: s.csrf });
  assert.equal(del.status, 200);
});

test('contagem de acessos: um por pessoa por dia, sem robôs e sem o dono', async () => {
  const ua = { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Teste/1.0' };
  const ip = '10.9.9.9';
  const s = await login();
  const before = (await call('/api/admin/stats', { cookie: s.cookie })).body;
  assert.equal((await call('/api/visit', { method: 'POST', headers: ua, ip })).status, 204);
  assert.equal((await call('/api/visit', { method: 'POST', headers: ua, ip })).status, 204);
  await call('/api/visit', { method: 'POST', headers: { 'user-agent': 'Googlebot/2.1' }, ip: '10.9.9.10' });
  await call('/api/visit', { method: 'POST', headers: { ...ua, cookie: s.cookie }, ip: '10.9.9.11' });
  await call('/api/visit', { method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Outro/2.0' }, ip: '10.9.9.12' });
  const afterStats = (await call('/api/admin/stats', { cookie: s.cookie })).body;
  assert.equal(afterStats.visitors.today - before.visitors.today, 2);
  assert.equal(afterStats.views.today - before.views.today, 3);
  assert.equal(afterStats.series.length, 14);
  assert.equal(afterStats.series.at(-1).visitors, afterStats.visitors.today);
});

test('fluxo do administrador: confirmar, concluir, faturamento, clientes e exclusão', async () => {
  const s = await login();
  const date = pickDate(6);
  const made = await call('/api/bookings', { method: 'POST', json: booking({ date, service_id: 1, phone: '11955554444', name: 'Maria Fluxo' }) });
  assert.equal(made.status, 201);
  const id = made.body.id;
  const before = (await call('/api/admin/stats', { cookie: s.cookie })).body;
  for (const st of ['confirmed', 'completed']) {
    assert.equal((await call('/api/admin/bookings/' + id, { method: 'PATCH', json: { status: st }, cookie: s.cookie, csrf: s.csrf })).status, 200);
  }
  assert.equal((await call('/api/admin/bookings/' + id, { method: 'PATCH', json: { status: 'xyz' }, cookie: s.cookie, csrf: s.csrf })).status, 400);
  const st = (await call('/api/admin/stats', { cookie: s.cookie })).body;
  assert.equal(st.revenue_cents - before.revenue_cents, 15000);
  assert.ok(st.top_services.length > 0);
  const clients = (await call('/api/admin/clients', { cookie: s.cookie })).body.clients;
  const maria = clients.find((c) => c.name === 'Maria Fluxo');
  assert.equal(maria.spent_cents, 15000);
  assert.equal(maria.last_service, date);
  const detail = await call('/api/admin/clients/' + maria.id, { cookie: s.cookie });
  assert.equal(detail.body.bookings.length, 1);
  const cancelled = await call('/api/bookings', { method: 'POST', json: booking({ date, start_min: 480, phone: '11944443333', name: 'Outro Teste' }) });
  assert.equal(cancelled.status, 201); // horário da Maria está concluído, não bloqueia mais? (concluído libera)
  assert.equal((await call('/api/admin/clients/' + maria.id, { method: 'DELETE', cookie: s.cookie, csrf: s.csrf })).status, 200);
  const log = (await call('/api/admin/log', { cookie: s.cookie })).body.log;
  assert.ok(log.some((l) => l.action === 'cliente_excluido'));
});

test('upload de foto só aceita imagens reais', async () => {
  const s = await login();
  const bad = await call('/api/admin/services/1/image?kind=after', { method: 'POST', raw: Buffer.from('isto nao e uma imagem, apenas texto'), cookie: s.cookie, csrf: s.csrf });
  assert.equal(bad.status, 400);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const ok = await call('/api/admin/services/1/image?kind=after', { method: 'POST', raw: png, cookie: s.cookie, csrf: s.csrf });
  assert.equal(ok.status, 200);
  const img = await fetch(base + ok.body.url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await call('/api/admin/services/1/image?kind=after', { method: 'DELETE', cookie: s.cookie, csrf: s.csrf })).status, 200);
});

test('capacidade 2 permite dois carros no mesmo horário', async () => {
  const s = await login();
  const date = pickDate(8);
  const set = await call('/api/admin/settings', { method: 'PUT', json: { capacity: 2 }, cookie: s.cookie, csrf: s.csrf });
  assert.equal(set.status, 200);
  const a = await call('/api/bookings', { method: 'POST', json: booking({ date, phone: '11933332222', name: 'Cap Um' }) });
  const b = await call('/api/bookings', { method: 'POST', json: booking({ date, phone: '11922221111', name: 'Cap Dois' }) });
  const c = await call('/api/bookings', { method: 'POST', json: booking({ date, phone: '11911110000', name: 'Cap Tres' }) });
  assert.deepEqual([a.status, b.status, c.status], [201, 201, 409]);
  await call('/api/admin/settings', { method: 'PUT', json: { capacity: 1 }, cookie: s.cookie, csrf: s.csrf });
  const blocked = await call('/api/admin/settings', { method: 'PUT', json: { blocked_dates: pickDate(9) }, cookie: s.cookie, csrf: s.csrf });
  assert.equal(blocked.status, 200);
  const av = await call(`/api/availability?service_id=1&date=${pickDate(9)}`);
  assert.equal(av.body.slots.length, 0);
  assert.ok(av.body.error);
  await call('/api/admin/settings', { method: 'PUT', json: { blocked_dates: '' }, cookie: s.cookie, csrf: s.csrf });
});

test('backup é criado e pode ser aberto', async () => {
  const s = await login();
  const r = await call('/api/admin/backups', { method: 'POST', cookie: s.cookie, csrf: s.csrf });
  assert.equal(r.status, 201);
  const file = path.join(tmp, 'backups', r.body.name);
  assert.ok(fs.existsSync(file));
  const copy = new DatabaseSync(file, { readOnly: true });
  assert.ok(copy.prepare('SELECT COUNT(*) AS n FROM services').get().n >= 8);
  copy.close();
  const dl = await fetch(base + '/api/admin/backups/' + r.body.name, { headers: { cookie: s.cookie } });
  assert.equal(dl.status, 200);
});

test('limite de tentativas de login e troca de senha', async () => {
  const ip = '10.8.8.8';
  let last;
  for (let i = 0; i < 6; i++) last = await call('/api/admin/login', { method: 'POST', json: { username: 'alvo', password: 'x'.repeat(12) }, ip });
  assert.equal(last.status, 429);
  const s = await login();
  const weak = await call('/api/admin/password', { method: 'POST', json: { current: ADMIN.password, next: 'curta' }, cookie: s.cookie, csrf: s.csrf });
  assert.equal(weak.status, 400);
  const wrongCur = await call('/api/admin/password', { method: 'POST', json: { current: 'nao-e-essa', next: 'NovaSenhaForte!99' }, cookie: s.cookie, csrf: s.csrf });
  assert.equal(wrongCur.status, 400);
});

test('arquivos estáticos não vazam o código do servidor', async () => {
  for (const p of ['/..%2fserver.js', '/%2e%2e/server.js', '/server.js', '/data/hlg.db', '/uploads/../server.js']) {
    const r = await fetch(base + p);
    const t = await r.text();
    assert.ok(!t.includes('createApp'), p);
  }
});
