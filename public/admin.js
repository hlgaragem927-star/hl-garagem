'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const dateBR = (iso) => iso ? iso.split('-').reverse().join('/') : '-';
  const dtBR = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const durText = (min) => { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`; };
  const STATUS = { pending: 'Pendente', confirmed: 'Confirmado', completed: 'Concluído', cancelled: 'Cancelado' };
  const VEHICLE = { hatch: 'Hatch', sedan: 'Sedã', suv: 'SUV', picape: 'Picape', esportivo: 'Esportivo', moto: 'Moto', outro: 'Outro' };
  const KIND_LABEL = { wash: 'Lavagem', polish: 'Polimento', ceramic: 'Vitrificação', interior: 'Interior', seat: 'Bancos', headlight: 'Faróis', ppf: 'Película de proteção', revive: 'Revitalização' };
  const TITLES = { overview: 'Visão geral', leads: 'Leads', bookings: 'Agendamentos', clients: 'Clientes', services: 'Serviços', messages: 'Mensagens', settings: 'Configurações' };

  const VIEWS = {};
  let csrf = '';
  let current = 'overview';
  let settingsCache = null;

  /* ---------- utilidades ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const field = (label, input, cls) => h('label', { class: 'field ' + (cls || '') }, h('span', { text: label }), input);
  const num = (txt, cls) => h('td', { class: 'num ' + (cls || ''), text: txt });

  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; opts = { ...opts, body: JSON.stringify(opts.json) }; }
    if (opts.method && opts.method !== 'GET') headers['X-CSRF-Token'] = csrf;
    const res = await fetch(path, { ...opts, headers, credentials: 'same-origin' });
    let body = null;
    try { body = await res.json(); } catch { /* sem corpo */ }
    if (res.status === 401 && path !== '/api/admin/login') { showLogin(); throw new Error('Sessão encerrada. Entre novamente.'); }
    if (!res.ok) throw new Error((body && body.error) || 'Não foi possível concluir.');
    return body;
  }
  let toastTimer;
  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 6000 : 3200);
  }
  const fail = (e) => toast(e.message || 'Algo deu errado.', true);

  /* janela de confirmação / detalhes */
  function modal(title, bodyNode, actions) {
    $('modal-title').textContent = title;
    const body = $('modal-body');
    body.textContent = '';
    body.append(bodyNode);
    const act = $('modal-actions');
    act.textContent = '';
    for (const a of actions) act.append(h('button', { type: 'button', class: 'btn ' + (a.cls || 'btn-ghost') + ' btn-sm', text: a.label, onclick: async () => { if (!a.keep) closeModal(); if (a.run) await a.run(); } }));
    const m = $('modal');
    m.hidden = false;
    const first = act.querySelector('button:last-child');
    if (first) first.focus();
  }
  function closeModal() { $('modal').hidden = true; }
  const confirmBox = (title, text, label, run) => modal(title, h('p', { text }), [{ label: 'Voltar', cls: 'btn-ghost' }, { label, cls: 'btn-danger', run }]);
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });

  const waNumber = (phone) => { const d = String(phone).replace(/\D/g, ''); return d.startsWith('55') && d.length > 11 ? d : '55' + d; };
  function leadMessage(b, kind) {
    const when = `${dateBR(b.date)} às ${hhmm(b.start_min)}`;
    const first = b.client_name.split(' ')[0];
    if (kind === 'confirm') return `Olá, ${first}! Aqui é da HL GARAGEM. Seu agendamento de ${b.service_name} está confirmado para ${when}, para o ${b.vehicle_brand} ${b.vehicle_model}. Valor: a partir de ${brl(b.price_cents)}. Qualquer dúvida, é só responder esta mensagem.`;
    return `Olá, ${first}! Aqui é da HL GARAGEM, sobre seu agendamento de ${b.service_name} em ${when} (${b.vehicle_brand} ${b.vehicle_model}).`;
  }
  const waHref = (b, kind) => `https://wa.me/${waNumber(b.whatsapp || b.phone)}?text=${encodeURIComponent(leadMessage(b, kind))}`;

  /* ---------- login ---------- */
  function showLogin() {
    csrf = '';
    $('app').hidden = true;
    $('login-view').hidden = false;
    $('l-pass').value = '';
    $('l-user').focus();
  }
  async function enter(info) {
    csrf = info.csrf;
    $('who').textContent = 'Conectado como ' + info.username;
    $('login-view').hidden = true;
    $('app').hidden = false;
    settingsCache = null;
    go(current);
  }
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('login-error');
    err.hidden = true;
    const btn = $('login-btn');
    btn.disabled = true;
    try {
      const info = await api('/api/admin/login', { method: 'POST', json: { username: $('l-user').value, password: $('l-pass').value } });
      await enter(info);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; }
  });
  $('logout').addEventListener('click', async () => { try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* já saiu */ } showLogin(); });

  /* ---------- navegação ---------- */
  function go(view) {
    current = view;
    $('side-nav').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    $('view-title').textContent = TITLES[view];
    $('side').classList.remove('open');
    $('adm-menu').setAttribute('aria-expanded', 'false');
    $('view').textContent = '';
    $('view').append(h('p', { class: 'hint', text: 'Carregando...' }));
    (VIEWS[view] || VIEWS.overview)().catch((e) => { $('view').textContent = ''; $('view').append(h('p', { class: 'form-error', text: e.message })); });
    refreshBadges();
  }
  $('side-nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) go(b.dataset.view); });
  $('refresh').addEventListener('click', () => go(current));
  $('adm-menu').addEventListener('click', () => { const o = $('side').classList.toggle('open'); $('adm-menu').setAttribute('aria-expanded', String(o)); });

  async function refreshBadges() {
    try {
      const [st, pend] = await Promise.all([api('/api/admin/stats'), api('/api/admin/bookings?status=pending')]);
      const set = (id, n) => { $(id).hidden = !n; $(id).textContent = n; };
      set('b-leads', pend.bookings.length);
      set('b-msgs', st.unread_messages);
    } catch { /* sem badge */ }
  }

  /* ---------- visão geral ---------- */
  function lineChart(series) {
    const W = 640, H = 220, L = 34, R = 10, T = 14, B = 28;
    const max = Math.max(4, ...series.map((s) => s.views));
    const nice = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
    const x = (i) => L + 16 + (i * (W - L - R - 32)) / (series.length - 1);
    const y = (v) => T + (H - T - B) * (1 - v / nice);
    const ns = 'http://www.w3.org/2000/svg';
    const el = (t, a, txt) => { const n = document.createElementNS(ns, t); for (const [k, v] of Object.entries(a || {})) n.setAttribute(k, v); if (txt !== undefined) n.textContent = txt; return n; };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Visitantes e visualizações dos últimos 14 dias' });
    for (let i = 0; i <= 4; i++) {
      const v = (nice / 4) * i;
      svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: '#2a2a31', 'stroke-width': 1 }), el('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, String(Math.round(v))));
    }
    const bw = ((W - L - R) / series.length) * 0.5;
    series.forEach((s, i) => {
      const top = y(s.visitors);
      svg.append(el('rect', { x: x(i) - bw / 2, y: top, width: bw, height: Math.max(0, H - B - top), rx: 3, fill: '#ff6b1a' }, undefined));
      const t = el('title'); t.textContent = `${dateBR(s.day)}: ${s.visitors} visitantes, ${s.views} visualizações`; svg.lastChild.append(t);
      if (i % 2 === 0 || series.length < 8) svg.append(el('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }, s.day.slice(8) + '/' + s.day.slice(5, 7)));
    });
    svg.append(el('polyline', { points: series.map((s, i) => `${x(i)},${y(s.views)}`).join(' '), fill: 'none', stroke: '#f3f1ee', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    series.forEach((s, i) => svg.append(el('circle', { cx: x(i), cy: y(s.views), r: 3, fill: '#f3f1ee' })));
    return svg;
  }

  VIEWS.overview = async function () {
    const st = await api('/api/admin/stats');
    const v = $('view');
    v.textContent = '';
    if (!st.prices_reviewed) {
      v.append(h('div', { class: 'notice' },
        h('p', { text: 'Os preços dos serviços foram colocados só como ponto de partida. Revise cada valor em Serviços antes de divulgar o link, porque os clientes veem esses preços.' }),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Revisar preços', onclick: () => go('services') }),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Já revisei', onclick: async () => { try { await api('/api/admin/settings', { method: 'PUT', json: { prices_reviewed: true } }); go('overview'); } catch (e) { fail(e); } } }))));
    }
    const kpi = (label, value, note, hot) => h('div', { class: 'kpi' + (hot ? ' hot' : '') }, h('small', { text: label }), h('strong', { text: value }), note ? h('em', { text: note }) : null);
    v.append(h('section', { 'aria-label': 'Acessos ao site' }, h('div', { class: 'kpis' },
      kpi('Pessoas hoje', String(st.visitors.today), `${st.views.today} visualizações`, true),
      kpi('Pessoas nos últimos 7 dias', String(st.visitors.last7), `${st.views.last7} visualizações`),
      kpi('Pessoas nos últimos 30 dias', String(st.visitors.last30), `${st.views.last30} visualizações`),
      kpi('Pessoas desde o início', String(st.visitors.total), 'Cada pessoa conta uma vez por dia'))));
    v.append(h('section', { 'aria-label': 'Agendamentos' }, h('div', { class: 'kpis' },
      kpi('Total de agendamentos', String(st.bookings.total)),
      kpi('Pendentes', String(st.bookings.pending), 'Esperando sua confirmação'),
      kpi('Confirmados', String(st.bookings.confirmed)),
      kpi('Faturamento', brl(st.revenue_cents), `${st.bookings.completed} serviços concluídos`, true),
      kpi('Previsto', brl(st.forecast_cents), 'Pendentes e confirmados'),
      kpi('Novos clientes (30 dias)', String(st.new_clients_30d)),
      kpi('Taxa de conversão', st.conversion_pct === null ? 'Sem dados' : st.conversion_pct.toLocaleString('pt-BR') + '%', 'Agendamentos por visitante, 30 dias'))));
    const chart = h('div', { class: 'panel' }, h('h2', { text: 'Acessos nos últimos 14 dias' }), lineChart(st.series),
      h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:#ff6b1a' }), 'Pessoas diferentes'), h('span', {}, h('i', { style: 'background:#f3f1ee' }), 'Visualizações da página')));
    const maxN = Math.max(1, ...st.top_services.map((s) => s.n));
    const top = h('div', { class: 'panel' }, h('h2', { text: 'Serviços mais procurados' }),
      st.top_services.length ? h('ul', { class: 'bars' }, st.top_services.map((s) => h('li', {}, h('div', { class: 'row' }, h('span', { text: s.name }), h('span', { text: `${s.n} · ${brl(s.cents)}` })), h('div', { class: 'track' }, h('b', { style: `width:${(s.n / maxN) * 100}%` })))))
        : h('p', { class: 'hint', text: 'Os serviços mais pedidos aparecem aqui quando chegarem os primeiros agendamentos.' }));
    v.append(h('div', { class: 'cols' }, chart, top));
    if (st.visitors.total === 0) v.append(h('p', { class: 'hint', text: 'Ainda não há acessos. Quando alguém abrir o link do site, a contagem aparece aqui. Suas próprias visitas, quando você está logado, não são contadas.' }));
  };

  /* ---------- leads e agendamentos ---------- */
  async function bookingsView(mode) {
    const v = $('view');
    const f = { q: '', status: mode === 'leads' ? 'pending' : '', from: '', to: '' };
    const holder = h('div');
    const tools = h('div', { class: 'toolbar' });
    const qIn = h('input', { type: 'text', placeholder: 'Nome, telefone, carro ou serviço', maxlength: '60', id: 'f-q' });
    const stSel = h('select', { id: 'f-st' }, h('option', { value: '', text: 'Todos' }), Object.entries(STATUS).map(([k, t]) => h('option', { value: k, text: t })));
    stSel.value = f.status;
    const fromIn = h('input', { type: 'date', id: 'f-from' }), toIn = h('input', { type: 'date', id: 'f-to' });
    tools.append(field('Buscar', qIn, 'grow'), mode === 'leads' ? null : field('Status', stSel), field('De', fromIn), field('Até', toIn));
    const load = async () => {
      const p = new URLSearchParams();
      if (f.q) p.set('q', f.q);
      if (f.status) p.set('status', f.status);
      if (f.from) p.set('from', f.from);
      if (f.to) p.set('to', f.to);
      const { bookings } = await api('/api/admin/bookings?' + p);
      holder.textContent = '';
      holder.append(bookingsTable(bookings, mode, load));
    };
    let t;
    qIn.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { f.q = qIn.value.trim(); load().catch(fail); }, 250); });
    stSel.addEventListener('change', () => { f.status = stSel.value; load().catch(fail); });
    fromIn.addEventListener('change', () => { f.from = fromIn.value; load().catch(fail); });
    toIn.addEventListener('change', () => { f.to = toIn.value; load().catch(fail); });
    v.textContent = '';
    v.append(mode === 'leads' ? h('p', { class: 'hint', text: 'Pedidos novos que ainda esperam sua resposta. Confirme ou cancele; depois de confirmar, avise o cliente pelo botão do WhatsApp.' }) : null, tools, holder);
    await load();
  }
  function bookingsTable(rows, mode, reload) {
    const act = async (id, status, msg) => { try { await api('/api/admin/bookings/' + id, { method: 'PATCH', json: { status } }); toast(msg); await reload(); refreshBadges(); } catch (e) { fail(e); } };
    const head = ['Cliente', 'Serviço e veículo', 'Quando', 'Valor', 'Status', 'Ações'];
    const body = rows.length ? rows.map((b) => {
      const buttons = [];
      if (b.status === 'pending') buttons.push(h('button', { type: 'button', class: 'mini ok', text: 'Confirmar', onclick: () => act(b.id, 'confirmed', 'Agendamento confirmado.') }));
      if (b.status === 'confirmed') buttons.push(h('button', { type: 'button', class: 'mini ok', text: 'Concluir', onclick: () => act(b.id, 'completed', 'Serviço marcado como concluído.') }));
      if (b.status === 'pending' || b.status === 'confirmed') buttons.push(h('button', { type: 'button', class: 'mini warn', text: 'Cancelar', onclick: () => confirmBox('Cancelar agendamento', `Cancelar o agendamento de ${b.client_name} em ${dateBR(b.date)}? O horário volta a ficar livre.`, 'Cancelar agendamento', () => act(b.id, 'cancelled', 'Agendamento cancelado.')) }));
      if (b.status === 'cancelled') buttons.push(h('button', { type: 'button', class: 'mini', text: 'Reabrir', onclick: () => act(b.id, 'pending', 'Agendamento reaberto.').catch(fail) }));
      buttons.push(h('a', { class: 'mini wa', href: waHref(b, b.status === 'pending' || b.status === 'confirmed' ? 'confirm' : 'plain'), target: '_blank', rel: 'noopener', text: b.status === 'pending' ? 'Confirmar no WhatsApp' : 'WhatsApp' }));
      buttons.push(h('button', { type: 'button', class: 'mini', text: 'Detalhes', onclick: () => bookingDetails(b) }));
      buttons.push(h('button', { type: 'button', class: 'mini danger', text: 'Excluir', onclick: () => confirmBox('Excluir registro', `Excluir de vez o agendamento de ${b.client_name} (${b.service_name}, ${dateBR(b.date)})? Isso não pode ser desfeito.`, 'Excluir', async () => { try { await api('/api/admin/bookings/' + b.id, { method: 'DELETE' }); toast('Registro excluído.'); await reload(); refreshBadges(); } catch (e) { fail(e); } }) }));
      return h('tr', {},
        h('td', {}, h('strong', { text: b.client_name }), h('span', { class: 'sub', text: b.phone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') })),
        h('td', {}, b.service_name, h('span', { class: 'sub', text: `${VEHICLE[b.vehicle_kind] || ''} ${b.vehicle_brand} ${b.vehicle_model}` })),
        h('td', {}, dateBR(b.date), h('span', { class: 'sub', text: `${hhmm(b.start_min)} às ${hhmm(b.end_min)}` })),
        num(brl(b.price_cents)),
        h('td', {}, h('span', { class: 'pill ' + b.status, text: STATUS[b.status] })),
        h('td', {}, h('div', { class: 'row-actions' }, buttons)));
    }) : [h('tr', { class: 'empty-row' }, h('td', { colspan: String(head.length), text: mode === 'leads' ? 'Nenhum pedido novo esperando resposta.' : 'Nenhum agendamento encontrado.' }))];
    return h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, head.map((t) => h('th', { class: t === 'Valor' ? 'num' : '', text: t })))), h('tbody', {}, body)));
  }
  function bookingDetails(b) {
    const dl = h('dl', { class: 'detail' });
    const row = (k, val) => dl.append(h('div', {}, h('dt', { text: k }), h('dd', { text: val })));
    row('Cliente', b.client_name); row('Telefone', b.phone); row('WhatsApp', b.whatsapp);
    row('Serviço', b.service_name); row('Veículo', `${VEHICLE[b.vehicle_kind] || ''} ${b.vehicle_brand} ${b.vehicle_model}`);
    row('Data', `${dateBR(b.date)}, ${hhmm(b.start_min)} às ${hhmm(b.end_min)}`); row('Duração', durText(b.duration_min));
    row('Valor', brl(b.price_cents)); row('Status', STATUS[b.status]); row('Observações', b.notes || '-'); row('Pedido feito em', dtBR(b.created_at));
    modal('Agendamento #' + b.id, dl, [{ label: 'Fechar' }]);
  }
  VIEWS.leads = () => bookingsView('leads');
  VIEWS.bookings = () => bookingsView('bookings');

  /* ---------- clientes ---------- */
  VIEWS.clients = async function () {
    const { clients } = await api('/api/admin/clients');
    const v = $('view');
    let term = '';
    const holder = h('div');
    const draw = () => {
      const t = term.toLowerCase();
      const rows = clients.filter((c) => !t || c.name.toLowerCase().includes(t) || c.phone.includes(t.replace(/\D/g, '') || '§'));
      holder.textContent = '';
      holder.append(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Cliente', 'Telefone', 'Agendamentos', 'Gasto', 'Último atendimento', ''].map((x) => h('th', { class: x === 'Gasto' || x === 'Agendamentos' ? 'num' : '', text: x })))),
        h('tbody', {}, rows.length ? rows.map((c) => h('tr', {},
          h('td', {}, h('strong', { text: c.name }), h('span', { class: 'sub', text: 'Cliente desde ' + dateBR(c.created_at.slice(0, 10)) })),
          h('td', { text: c.phone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') }),
          num(String(c.bookings)), num(brl(c.spent_cents)), h('td', { text: c.last_service ? dateBR(c.last_service) : 'Nenhum ainda' }),
          h('td', {}, h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'mini', text: 'Histórico', onclick: () => clientDetails(c, draw, () => go('clients')) }), h('a', { class: 'mini wa', href: `https://wa.me/${waNumber(c.whatsapp)}`, target: '_blank', rel: 'noopener', text: 'WhatsApp' })))))
          : [h('tr', { class: 'empty-row' }, h('td', { colspan: '6', text: 'Os clientes aparecem aqui depois do primeiro agendamento.' }))]))));
    };
    const q = h('input', { type: 'text', placeholder: 'Nome ou telefone', maxlength: '60', id: 'c-q' });
    q.addEventListener('input', () => { term = q.value.trim(); draw(); });
    v.textContent = '';
    v.append(h('div', { class: 'toolbar' }, field('Buscar cliente', q, 'grow')), holder);
    draw();
  };
  async function clientDetails(c, _draw, reload) {
    try {
      const { bookings } = await api('/api/admin/clients/' + c.id);
      const box = h('div', { style: 'display:grid;gap:14px' },
        h('p', { class: 'hint', text: `${c.name} · ${c.phone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')} · gasto em serviços concluídos: ${brl(c.spent_cents)}` }),
        h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Data', 'Serviço', 'Veículo', 'Valor', 'Status'].map((x) => h('th', { text: x })))),
          h('tbody', {}, bookings.map((b) => h('tr', {}, h('td', { text: dateBR(b.date) }), h('td', { text: b.service_name }), h('td', { text: `${b.vehicle_brand} ${b.vehicle_model}` }), h('td', { text: brl(b.price_cents) }), h('td', {}, h('span', { class: 'pill ' + b.status, text: STATUS[b.status] }))))))));
      modal('Histórico de ' + c.name, box, [
        { label: 'Fechar' },
        { label: 'Baixar dados (LGPD)', keep: true, run: async () => { try { const d = await api(`/api/admin/clients/${c.id}/export`); const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); const a = h('a', { href: url, download: `cliente-${c.id}.json` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); } catch (e) { fail(e); } } },
        { label: 'Excluir cliente', cls: 'btn-danger', run: () => confirmBox('Excluir cliente', `Excluir ${c.name} e todo o histórico de agendamentos? Use isso quando o cliente pedir a exclusão dos dados. Não dá para desfazer.`, 'Excluir cliente e histórico', async () => { try { await api('/api/admin/clients/' + c.id, { method: 'DELETE' }); toast('Cliente excluído.'); reload(); } catch (e) { fail(e); } }) },
      ]);
    } catch (e) { fail(e); }
  }

  /* ---------- serviços ---------- */
  VIEWS.services = async function () {
    const { services, kinds } = await api('/api/admin/services');
    const v = $('view');
    v.textContent = '';
    const addBtn = h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Adicionar serviço', onclick: () => serviceModal(kinds) });
    v.append(h('div', { class: 'panel-head' }, h('p', { class: 'hint', text: 'Mudou o preço, a duração ou ativou/desativou? O site público atualiza na hora.' }), addBtn));
    const grid = h('div', { class: 'svc-grid' });
    for (const s of services) grid.append(serviceCard(s, kinds));
    v.append(grid);
  };

  function serviceCard(s, kinds) {
    const cmp = h('div');
    window.HLArt.mountCompare(cmp, s);
    const name = h('input', { type: 'text', value: s.name, maxlength: '60', required: true, id: `sn-${s.id}` });
    const desc = h('textarea', { rows: '3', maxlength: '400', id: `sd-${s.id}`, text: s.description });
    const price = h('input', { type: 'number', min: '0', max: '200000', step: '0.01', inputmode: 'decimal', value: (s.price_cents / 100).toFixed(2), id: `sp-${s.id}`, required: true });
    const dur = h('input', { type: 'number', min: '15', step: '15', inputmode: 'numeric', value: String(s.duration_min), id: `su-${s.id}`, required: true });
    const kind = h('select', { id: `sk-${s.id}` }, kinds.map((k) => h('option', { value: k, text: KIND_LABEL[k] || k })));
    kind.value = s.kind;
    const active = h('input', { type: 'checkbox', id: `sa-${s.id}` });
    active.checked = s.active;
    const save = h('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'Salvar alterações' });
    const form = h('form', { novalidate: true },
      field('Nome', name), field('Descrição', desc),
      h('div', { class: 'grid-3' }, field('Preço (R$)', price), field('Duração (minutos)', dur), field('Ilustração padrão', kind)),
      h('label', { class: 'switch' }, active, 'Mostrar este serviço no site'),
      save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        await api('/api/admin/services/' + s.id, { method: 'PUT', json: { name: name.value, description: desc.value, price: Number(String(price.value).replace(',', '.')), duration_min: Number(dur.value), kind: kind.value, active: active.checked } });
        toast('Serviço salvo. O site já mostra o novo valor.');
        go('services');
      } catch (ex) { fail(ex); } finally { save.disabled = false; }
    });
    const photo = (which, label) => {
      const has = which === 'before' ? s.before_image : s.after_image;
      const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': `Enviar foto ${label.toLowerCase()} de ${s.name}` });
      file.addEventListener('change', async () => {
        const f = file.files[0];
        if (!f) return;
        if (f.size > 6 * 1024 * 1024) return toast('A foto passa de 6 MB. Reduza e tente de novo.', true);
        try { await api(`/api/admin/services/${s.id}/image?kind=${which}`, { method: 'POST', body: f, headers: { 'Content-Type': 'application/octet-stream' } }); toast('Foto enviada.'); go('services'); } catch (ex) { fail(ex); }
      });
      return h('div', { class: 'photo' }, h('strong', { text: label }), h('span', { text: has ? 'Foto enviada' : 'Usando a ilustração' }),
        h('div', { class: 'photo-actions' }, h('span', { class: 'mini file-btn' }, has ? 'Trocar' : 'Enviar foto', file),
          has ? h('button', { type: 'button', class: 'mini danger', text: 'Remover', onclick: async () => { try { await api(`/api/admin/services/${s.id}/image?kind=${which}`, { method: 'DELETE' }); toast('Foto removida.'); go('services'); } catch (ex) { fail(ex); } } }) : null));
    };
    const del = h('button', { type: 'button', class: 'mini danger', text: 'Excluir serviço', onclick: () => confirmBox('Excluir serviço', `Excluir "${s.name}"? Os agendamentos antigos continuam no histórico. Se só quiser tirar do site, desmarque "Mostrar este serviço no site".`, 'Excluir serviço', async () => { try { await api('/api/admin/services/' + s.id, { method: 'DELETE' }); toast('Serviço excluído.'); go('services'); } catch (ex) { fail(ex); } }) });
    return h('article', { class: 'svc-card' + (s.active ? '' : ' off') }, cmp,
      h('div', { class: 'svc-body' }, form, h('div', { class: 'photos' }, photo('before', 'Foto do antes'), photo('after', 'Foto do depois')), h('div', {}, del)));
  }
  function serviceModal(kinds) {
    const name = h('input', { type: 'text', maxlength: '60', id: 'ns-name' }), desc = h('textarea', { rows: '3', maxlength: '400', id: 'ns-desc' });
    const price = h('input', { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', id: 'ns-price' }), dur = h('input', { type: 'number', min: '15', step: '15', value: '60', id: 'ns-dur' });
    const kind = h('select', { id: 'ns-kind' }, kinds.map((k) => h('option', { value: k, text: KIND_LABEL[k] || k })));
    const box = h('div', { style: 'display:grid;gap:12px' }, field('Nome', name), field('Descrição', desc), h('div', { class: 'grid-3' }, field('Preço (R$)', price), field('Duração (minutos)', dur), field('Ilustração padrão', kind)));
    modal('Novo serviço', box, [{ label: 'Cancelar' }, { label: 'Criar serviço', cls: 'btn-primary', keep: true, run: async () => {
      try { await api('/api/admin/services', { method: 'POST', json: { name: name.value, description: desc.value, price: Number(String(price.value).replace(',', '.')), duration_min: Number(dur.value), kind: kind.value } }); closeModal(); toast('Serviço criado. Envie as fotos do antes e do depois.'); go('services'); } catch (e) { fail(e); } } }]);
    name.focus();
  }

  /* ---------- mensagens e depoimentos ---------- */
  VIEWS.messages = async function () {
    const [{ messages }, { testimonials }] = await Promise.all([api('/api/admin/messages'), api('/api/admin/testimonials')]);
    const v = $('view');
    v.textContent = '';
    const list = h('div', { style: 'display:grid;gap:12px' });
    if (!messages.length) list.append(h('p', { class: 'hint', text: 'As mensagens enviadas pelo formulário de contato aparecem aqui.' }));
    for (const m of messages) {
      const digits = m.phone;
      list.append(h('article', { class: 'msg' + (m.is_read ? '' : ' unread') },
        h('header', {}, h('strong', { text: m.name }), h('span', { text: `${dtBR(m.created_at)}${digits ? ' · ' + digits.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : ''}` })),
        h('p', { text: m.text }),
        h('div', { class: 'row-actions' },
          digits ? h('a', { class: 'mini wa', href: `https://wa.me/${waNumber(digits)}?text=${encodeURIComponent('Olá, ' + m.name.split(' ')[0] + '! Aqui é da HL GARAGEM, recebemos sua mensagem.')}`, target: '_blank', rel: 'noopener', text: 'Responder no WhatsApp' }) : null,
          m.is_read ? null : h('button', { type: 'button', class: 'mini', text: 'Marcar como lida', onclick: async () => { try { await api('/api/admin/messages/' + m.id, { method: 'PATCH', json: {} }); go('messages'); } catch (e) { fail(e); } } }),
          h('button', { type: 'button', class: 'mini danger', text: 'Excluir', onclick: () => confirmBox('Excluir mensagem', 'Excluir esta mensagem? Não dá para desfazer.', 'Excluir', async () => { try { await api('/api/admin/messages/' + m.id, { method: 'DELETE' }); go('messages'); } catch (e) { fail(e); } }) }))));
    }
    const tn = h('input', { type: 'text', maxlength: '60', id: 't-name' }), tv = h('input', { type: 'text', maxlength: '60', id: 't-veh', placeholder: 'Ex.: Honda Civic' }), tt = h('textarea', { rows: '3', maxlength: '400', id: 't-text' });
    const add = h('form', { style: 'display:grid;gap:12px', novalidate: true }, field('Nome do cliente', tn), field('Carro (opcional)', tv), field('Depoimento', tt), h('button', { class: 'btn btn-primary btn-sm', type: 'submit', text: 'Publicar no site' }));
    add.addEventListener('submit', async (e) => { e.preventDefault(); try { await api('/api/admin/testimonials', { method: 'POST', json: { name: tn.value, vehicle: tv.value, text: tt.value } }); toast('Depoimento publicado.'); go('messages'); } catch (ex) { fail(ex); } });
    const tl = h('div', { style: 'display:grid;gap:10px' }, testimonials.map((t) => h('div', { class: 'msg' }, h('header', {}, h('strong', { text: t.name }), h('span', { text: t.vehicle })), h('p', { text: t.text }),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'mini', text: t.active ? 'Ocultar do site' : 'Mostrar no site', onclick: async () => { try { await api('/api/admin/testimonials/' + t.id, { method: 'PATCH', json: { active: !t.active } }); go('messages'); } catch (e) { fail(e); } } }),
        h('button', { type: 'button', class: 'mini danger', text: 'Excluir', onclick: () => confirmBox('Excluir depoimento', 'Excluir este depoimento?', 'Excluir', async () => { try { await api('/api/admin/testimonials/' + t.id, { method: 'DELETE' }); go('messages'); } catch (e) { fail(e); } }) })))));
    v.append(h('div', { class: 'panel' }, h('h2', { text: 'Mensagens recebidas' }), list),
      h('div', { class: 'panel' }, h('h2', { text: 'Depoimentos no site' }), h('p', { class: 'hint', text: 'Só publique depoimentos reais, com autorização do cliente. A seção só aparece no site quando houver pelo menos um.' }), testimonials.length ? tl : null, add));
  };

  /* ---------- configurações ---------- */
  VIEWS.settings = async function () {
    const [{ settings: S }, { backups }, { log }] = await Promise.all([api('/api/admin/settings'), api('/api/admin/backups'), api('/api/admin/log')]);
    settingsCache = S;
    const v = $('view');
    v.textContent = '';
    const I = (id, val, o) => h('input', { type: 'text', id, value: val || '', ...(o || {}) });
    const biz = I('s-name', S.business_name, { maxlength: '60' }), wa = I('s-wa', S.whatsapp.replace(/^55/, ''), { inputmode: 'tel', maxlength: '16' }), phone = I('s-phone', S.phone_display, { maxlength: '30' });
    const mail = h('input', { type: 'email', id: 's-mail', value: S.email || '', maxlength: '120' }), addr = I('s-addr', S.address, { maxlength: '160' }), ig = I('s-ig', S.instagram, { maxlength: '60' });
    const open = h('input', { type: 'time', id: 's-open', value: S.open_time }), close = h('input', { type: 'time', id: 's-close', value: S.close_time });
    const step = h('select', { id: 's-step' }, ['15', '30', '60'].map((x) => h('option', { value: x, text: x + ' minutos' }))); step.value = S.slot_step;
    const cap = h('input', { type: 'number', id: 's-cap', min: '1', max: '5', value: S.capacity });
    const notice = h('input', { type: 'number', id: 's-notice', min: '0', max: '1440', step: '15', value: S.min_notice_min });
    const adv = h('input', { type: 'number', id: 's-adv', min: '1', max: '365', value: S.max_advance_days });
    const blocked = h('textarea', { id: 's-blocked', rows: '2', placeholder: '2026-12-25, 2027-01-01', text: S.blocked_dates.split(',').join(', ') });
    const days = h('div', { class: 'days' }, ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d, i) => h('label', {}, h('input', { type: 'checkbox', value: String(i), checked: S.open_days.split(',').includes(String(i)) }), d)));
    const save = h('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'Salvar configurações' });
    const form = h('form', { class: 'panel', style: 'display:grid;gap:16px', novalidate: true },
      h('h2', { text: 'Dados da empresa' }),
      h('div', { class: 'grid-3' }, field('Nome da empresa', biz), field('WhatsApp do atendimento (com DDD)', wa), field('Telefone exibido no site', phone), field('E-mail de contato', mail), field('Endereço', addr), field('Instagram (sem @)', ig)),
      h('h2', { text: 'Horários de atendimento' }),
      h('div', {}, h('span', { class: 'hint', text: 'Dias em que você atende' }), days),
      h('div', { class: 'grid-3' }, field('Abre às', open), field('Fecha às', close), field('Intervalo entre horários', step), field('Carros ao mesmo tempo', cap), field('Antecedência mínima (min)', notice), field('Agendar com até (dias)', adv)),
      field('Datas sem atendimento (feriados, folgas)', blocked),
      save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        await api('/api/admin/settings', { method: 'PUT', json: {
          business_name: biz.value, whatsapp: wa.value, phone_display: phone.value, email: mail.value, address: addr.value, instagram: ig.value,
          open_days: [...days.querySelectorAll('input:checked')].map((i) => i.value).join(','), open_time: open.value, close_time: close.value, slot_step: step.value,
          capacity: Number(cap.value), min_notice_min: Number(notice.value), max_advance_days: Number(adv.value), blocked_dates: blocked.value } });
        toast('Configurações salvas.');
      } catch (ex) { fail(ex); } finally { save.disabled = false; }
    });
    const heroFile = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': 'Enviar foto principal do site' });
    heroFile.addEventListener('change', async () => {
      const f = heroFile.files[0];
      if (!f) return;
      if (f.size > 6 * 1024 * 1024) return toast('A foto passa de 6 MB. Reduza e tente de novo.', true);
      try { await api('/api/admin/hero-image', { method: 'POST', body: f, headers: { 'Content-Type': 'application/octet-stream' } }); toast('Foto principal atualizada. Já aparece no site.'); go('settings'); } catch (ex) { fail(ex); }
    });
    const hero = h('div', { class: 'panel' }, h('h2', { text: 'Foto principal do site' }),
      h('p', { class: 'hint', text: 'É a foto do carro que aparece no topo da página inicial. Use uma foto sua, na horizontal, de preferência de um carro seu depois do serviço (JPG, PNG ou WEBP, até 6 MB). Sem foto, o site mostra uma ilustração.' }),
      S.hero_image ? h('img', { src: '/uploads/' + S.hero_image, alt: 'Foto principal atual', style: 'width:min(420px,100%);border-radius:12px;margin-top:12px;display:block' }) : null,
      h('div', { class: 'row-actions', style: 'margin-top:14px' }, h('span', { class: 'btn btn-primary btn-sm file-btn' }, S.hero_image ? 'Trocar foto' : 'Enviar foto', heroFile),
        S.hero_image ? h('button', { type: 'button', class: 'mini danger', text: 'Remover foto', onclick: async () => { try { await api('/api/admin/hero-image', { method: 'DELETE' }); toast('Foto removida.'); go('settings'); } catch (ex) { fail(ex); } } }) : null));
    const cur = h('input', { type: 'password', id: 'pw-cur', autocomplete: 'current-password' }), nxt = h('input', { type: 'password', id: 'pw-new', autocomplete: 'new-password', minlength: '10' });
    const pwBtn = h('button', { type: 'submit', class: 'btn btn-ghost btn-sm', text: 'Trocar senha' });
    const pw = h('form', { class: 'panel', style: 'display:grid;gap:14px;max-width:520px', novalidate: true }, h('h2', { text: 'Senha do administrador' }), field('Senha atual', cur), field('Nova senha (mínimo 10 caracteres)', nxt), pwBtn);
    pw.addEventListener('submit', async (e) => { e.preventDefault(); try { await api('/api/admin/password', { method: 'POST', json: { current: cur.value, next: nxt.value } }); cur.value = ''; nxt.value = ''; toast('Senha alterada. Outros acessos foram encerrados.'); } catch (ex) { fail(ex); } });
    const bk = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Backups do banco de dados' }),
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Fazer backup agora', onclick: async () => { try { await api('/api/admin/backups', { method: 'POST' }); toast('Backup criado.'); go('settings'); } catch (e) { fail(e); } } })),
      h('p', { class: 'hint', text: 'O sistema faz um backup por dia e guarda os 14 mais recentes. Baixe de vez em quando e guarde fora do servidor.' }),
      backups.length ? h('ul', { class: 'bars', style: 'margin-top:12px' }, backups.slice(0, 8).map((b) => h('li', {}, h('div', { class: 'row' }, h('a', { href: '/api/admin/backups/' + encodeURIComponent(b.name), text: b.name }), h('span', { text: Math.max(1, Math.round(b.size / 1024)) + ' KB' }))))) : h('p', { class: 'hint', text: 'Nenhum backup ainda.' }));
    const lg = h('div', { class: 'panel' }, h('h2', { text: 'Registro de atividades' }), h('div', { class: 'table-wrap log' }, h('table', {}, h('thead', {}, h('tr', {}, ['Quando', 'Quem', 'O que', 'Detalhe', 'IP'].map((x) => h('th', { text: x })))),
      h('tbody', {}, log.map((l) => h('tr', {}, h('td', { text: dtBR(l.at) }), h('td', { text: l.admin }), h('td', { text: l.action.replace(/_/g, ' ') }), h('td', { text: l.detail }), h('td', { text: l.ip })))))));
    v.append(form, hero, pw, bk, lg);
  };

  /* ---------- início ---------- */
  (async function boot() {
    try { await enter(await api('/api/admin/me')); } catch { showLogin(); }
  })();
})();
