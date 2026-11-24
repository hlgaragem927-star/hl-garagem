'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const durText = (min) => {
    const h = Math.floor(min / 60), m = min % 60;
    return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
  };
  const VEHICLE_LABEL = { hatch: 'Hatch', sedan: 'Sedã', suv: 'SUV', picape: 'Picape', esportivo: 'Esportivo', moto: 'Moto', outro: 'Outro' };
  const BRANDS = ['Audi', 'BMW', 'BYD', 'Chevrolet', 'Citroën', 'Fiat', 'Ford', 'Honda', 'Hyundai', 'Jeep', 'Kia', 'Land Rover', 'Mercedes-Benz', 'Mitsubishi', 'Nissan', 'Peugeot', 'Porsche', 'Renault', 'Toyota', 'Volkswagen', 'Volvo', 'Yamaha'];

  /* Quando a página abre sem o servidor (prévia), usa dados de exemplo e manda os pedidos pelo WhatsApp. */
  const SLUGS = ["lavagem-simples", "lavagem-detalhada", "polimento-tecnico", "vitrificacao-de-pintura", "higienizacao-interna", "limpeza-de-bancos", "restauracao-de-farois", "protecao-de-pintura", "revitalizacao-automotiva"];
  const SAMPLE = {
    settings: { hero_image: 'img/hero.jpg', business_name: 'HL GARAGEM', whatsapp: '5511998654294', email: '', phone_display: '(11) 99865-4294', address: '', instagram: '', open_days: '1,2,3,4,5,6', open_time: '08:00', close_time: '18:00', max_advance_days: '60' },
    services: [
      ['Lavagem simples', 'wash', 'Lavagem externa rápida com shampoo neutro, rodas e secagem, para manter o carro limpo no dia a dia.', 5000, 60],
      ['Lavagem detalhada', 'wash', 'Limpeza completa da parte externa, rodas, vãos de portas e acabamento, com secagem cuidadosa para não riscar a pintura.', 15000, 120],
      ['Polimento técnico', 'polish', 'Remoção de riscos leves e marcas de lavagem para devolver profundidade e brilho à pintura.', 60000, 300],
      ['Vitrificação de pintura', 'ceramic', 'Camada cerâmica que repele água e sujeira e deixa a limpeza do dia a dia mais fácil.', 120000, 480],
      ['Higienização interna', 'interior', 'Limpeza profunda de carpetes, painéis, portas e teto para remover sujeira, odores e manchas.', 35000, 180],
      ['Limpeza de bancos', 'seat', 'Higienização de bancos em couro ou tecido, com remoção de manchas e hidratação do material.', 25000, 120],
      ['Restauração de faróis', 'headlight', 'Remove o amarelado e a opacidade das lentes e aplica proteção para devolver a luz e o visual.', 20000, 90],
      ['Proteção de pintura', 'ppf', 'Película de proteção contra pequenos impactos, riscos e desgaste nas áreas mais expostas.', 250000, 480],
      ['Revitalização automotiva', 'revive', 'Recupera pintura opaca e desbotada, plásticos ressecados e detalhes externos para um visual renovado.', 80000, 360],
    ].map((s, i) => ({ id: i + 1, name: s[0], kind: s[1], description: s[2], price_cents: s[3], duration_min: s[4], before_image: 'img/servicos/' + SLUGS[i] + '-antes.jpg', after_image: 'img/servicos/' + SLUGS[i] + '-depois.jpg' })),
    testimonials: [],
    vehicle_kinds: Object.keys(VEHICLE_LABEL),
  };

  const state = { data: null, offline: false, service: null, vehicle: null, date: '', slot: null, slots: [] };

  async function api(path, opts) {
    const res = await fetch(path, opts);
    let body = null;
    try { body = await res.json(); } catch { /* sem corpo */ }
    if (!res.ok) throw Object.assign(new Error((body && body.error) || 'Não foi possível concluir. Tente novamente.'), { status: res.status });
    return body;
  }
  const post = (path, json) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });

  const waLink = (number, text) => `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  const fmtDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

  /* máscara simples de telefone */
  function maskPhone(el) {
    el.addEventListener('input', () => {
      let d = el.value.replace(/\D/g, '').slice(0, 11);
      if (d.length > 6) d = `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
      else if (d.length > 2) d = `(${d.slice(0, 2)}) ${d.slice(2)}`;
      el.value = d;
    });
  }
  const phoneOk = (v) => { const d = v.replace(/\D/g, ''); return d.length >= 10 && d.length <= 11 && Number(d.slice(0, 2)) >= 11 && (d.length === 10 || d[2] === '9'); };

  /* ---------- carregamento ---------- */
  async function load() {
    try {
      state.data = await api('/api/public');
    } catch {
      state.data = SAMPLE;
      state.offline = true;
      $('preview-bar').hidden = false;
    }
    render();
    if (!state.offline) fetch('/api/visit', { method: 'POST', keepalive: true }).catch(() => {});
  }

  function render() {
    const { settings: S, services } = state.data;
    document.title = `${S.business_name} | Estética automotiva premium`;
    $('foot-name').textContent = S.business_name;
    $('foot-year').textContent = `© ${new Date().getFullYear()} ${S.business_name}`;
    const wa = waLink(S.whatsapp, `Olá, ${S.business_name}! Quero saber mais sobre os serviços.`);
    for (const id of ['hero-wa', 'wa-float', 'contact-wa']) $(id).href = wa;
    if (S.hero_image) {
      const box = document.querySelector('.hero-car');
      const img = Object.assign(document.createElement('img'), { className: 'hero-photo', src: S.hero_image, alt: 'Carro atendido na ' + S.business_name, decoding: 'async' });
      box.textContent = '';
      box.appendChild(img);
    }
    renderContacts(S);
    renderCards(services);
    renderShowcase(services);
    renderPicker(services);
    renderVehicleKinds();
    renderQuotes();
    const dl = $('brands');
    dl.textContent = '';
    for (const b of BRANDS) dl.appendChild(Object.assign(document.createElement('option'), { value: b }));
    const dateEl = $('f-date');
    const today = new Date();
    const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    dateEl.min = iso(today);
    dateEl.max = iso(new Date(today.getTime() + Number(S.max_advance_days || 60) * 864e5));
  }

  function renderContacts(S) {
    const ul = $('contact-list');
    ul.textContent = '';
    const add = (label, text, href) => {
      const li = document.createElement('li');
      const small = Object.assign(document.createElement('small'), { textContent: label });
      const el = href ? Object.assign(document.createElement('a'), { href, textContent: text }) : Object.assign(document.createElement('span'), { textContent: text });
      if (href && href.startsWith('https')) { el.target = '_blank'; el.rel = 'noopener'; }
      li.append(small, el);
      ul.appendChild(li);
    };
    if (S.phone_display) add('Telefone e WhatsApp', S.phone_display, 'tel:+' + S.whatsapp);
    if (S.email) add('E-mail', S.email, 'mailto:' + S.email);
    if (S.address) add('Endereço', S.address);
    if (S.instagram) add('Instagram', '@' + S.instagram, 'https://instagram.com/' + encodeURIComponent(S.instagram));
    const days = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    const open = String(S.open_days).split(',').map(Number);
    add('Atendimento', `${open.map((d) => days[d]).join(', ')}, das ${S.open_time} às ${S.close_time}`);
  }

  function renderCards(services) {
    const host = $('cards');
    host.textContent = '';
    if (!services.length) { host.appendChild(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'Os serviços estão sendo atualizados. Chame a gente no WhatsApp.' })); return; }
    for (const s of services) {
      const card = document.createElement('article');
      card.className = 'card';
      const cmp = document.createElement('div');
      window.HLArt.mountCompare(cmp, s);
      const body = document.createElement('div');
      body.className = 'card-body';
      const h = Object.assign(document.createElement('h3'), { textContent: s.name });
      const p = Object.assign(document.createElement('p'), { textContent: s.description });
      const meta = document.createElement('div');
      meta.className = 'meta';
      const pb = Object.assign(document.createElement('span'), { className: 'price-box' });
      pb.append(Object.assign(document.createElement('small'), { className: 'from', textContent: 'a partir de' }), Object.assign(document.createElement('span'), { className: 'price', textContent: brl(s.price_cents) }));
      meta.append(pb, Object.assign(document.createElement('span'), { className: 'dur', textContent: 'Duração: ' + durText(s.duration_min) }));
      const btn = Object.assign(document.createElement('a'), { className: 'btn btn-ghost btn-sm', href: '#agendar', textContent: 'Agendar ' + s.name.toLowerCase() });
      btn.addEventListener('click', () => pickService(s.id));
      body.append(h, p, meta, btn);
      card.append(cmp, body);
      host.appendChild(card);
    }
  }

  function renderShowcase(services) {
    const tabs = $('tabs'), show = $('showcase');
    tabs.textContent = '';
    if (!services.length) { show.textContent = ''; return; }
    const select = (s, btn) => {
      tabs.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === btn)));
      window.HLArt.mountCompare(show, s, { intro: true });
      $('showcase-note').textContent = `${s.name}: ${s.description}`;
    };
    services.forEach((s, i) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'tab', textContent: s.name });
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => select(s, b));
      tabs.appendChild(b);
      if (i === 1 || (services.length === 1 && i === 0)) setTimeout(() => select(s, b), 0);
    });
    if (services.length > 1 && !tabs.querySelector('[aria-selected="true"]')) select(services[0], tabs.firstChild);
  }

  function renderQuotes() {
    const list = state.data.testimonials || [];
    const sec = $('depoimentos');
    sec.hidden = !list.length;
    const host = $('quotes');
    host.textContent = '';
    for (const t of list) {
      const fig = document.createElement('figure');
      fig.className = 'quote';
      const bq = Object.assign(document.createElement('p'), { textContent: '“' + t.text + '”' });
      const cap = document.createElement('footer');
      cap.append(Object.assign(document.createElement('strong'), { textContent: t.name }), document.createTextNode(t.vehicle || ''));
      fig.append(bq, cap);
      host.appendChild(fig);
    }
  }

  /* ---------- agendamento ---------- */
  function renderPicker(services) {
    const host = $('svc-pick');
    host.textContent = '';
    for (const s of services) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'svc-opt';
      b.dataset.id = s.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.append(Object.assign(document.createElement('span'), { textContent: s.name }), Object.assign(document.createElement('small'), { textContent: `a partir de ${brl(s.price_cents)} · ${durText(s.duration_min)}` }));
      b.addEventListener('click', () => pickService(s.id));
      host.appendChild(b);
    }
  }
  function pickService(id) {
    state.service = state.data.services.find((s) => s.id === id) || null;
    $('svc-pick').querySelectorAll('.svc-opt').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.id) === id)));
    state.slot = null;
    refreshSlots();
    updateSummary();
  }
  function renderVehicleKinds() {
    const host = $('vehicle-kinds');
    host.textContent = '';
    for (const k of state.data.vehicle_kinds) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip', textContent: VEHICLE_LABEL[k] || k });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.addEventListener('click', () => {
        state.vehicle = k;
        host.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', String(c === b)));
        updateSummary();
      });
      host.appendChild(b);
    }
  }

  async function refreshSlots() {
    const host = $('slots'), hint = $('slots-hint');
    host.textContent = '';
    state.slot = null;
    if (!state.service || !state.date) { hint.textContent = 'Escolha o serviço e o dia para ver os horários livres.'; updateSummary(); return; }
    hint.textContent = 'Buscando horários...';
    let r;
    if (state.offline) {
      r = { slots: [], error: null };
      const open = 480, close = 1080;
      for (let m = open; m + state.service.duration_min <= close; m += 30) r.slots.push(m);
    } else {
      try { r = await api(`/api/availability?service_id=${state.service.id}&date=${state.date}`); }
      catch (e) { hint.textContent = e.message; return; }
    }
    if (r.error) { hint.textContent = r.error; return; }
    if (!r.slots.length) { hint.textContent = 'Não há horários livres neste dia para este serviço. Tente outra data.'; return; }
    hint.textContent = `${r.slots.length} horários livres em ${fmtDate(state.date)}.`;
    for (const m of r.slots) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip', textContent: hhmm(m) });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.addEventListener('click', () => {
        state.slot = m;
        host.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', String(c === b)));
        updateSummary();
      });
      host.appendChild(b);
    }
    updateSummary();
  }

  function updateSummary() {
    const s = state.service;
    $('s-service').textContent = s ? s.name : 'Escolha um serviço';
    const brand = $('f-brand').value.trim(), model = $('f-model').value.trim();
    const v = [state.vehicle ? VEHICLE_LABEL[state.vehicle] : '', [brand, model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    $('s-vehicle').textContent = v || 'Não informado';
    $('s-when').textContent = state.date && state.slot !== null ? `${fmtDate(state.date)}, ${hhmm(state.slot)}` : 'Escolha dia e horário';
    $('s-dur').textContent = s ? durText(s.duration_min) : '-';
    $('s-price').textContent = s ? 'a partir de ' + brl(s.price_cents) : '-';
  }

  function setError(el, msg) { el.hidden = !msg; el.textContent = msg || ''; }

  async function submitBooking(ev) {
    ev.preventDefault();
    const err = $('book-error');
    setError(err, '');
    const name = $('f-name').value.trim(), phone = $('f-phone').value.trim();
    const wa = $('f-same').checked ? phone : $('f-wa').value.trim();
    const brand = $('f-brand').value.trim(), model = $('f-model').value.trim();
    const problems = [
      [!state.service, 'Escolha o serviço.', null],
      [!state.vehicle, 'Escolha o tipo do veículo.', 'vehicle-kinds'],
      [!brand || !model, 'Informe a marca e o modelo do veículo.', brand ? 'f-model' : 'f-brand'],
      [!state.date, 'Escolha o dia.', 'f-date'],
      [state.slot === null, 'Escolha um horário.', 'slots'],
      [name.length < 2, 'Informe seu nome.', 'f-name'],
      [!phoneOk(phone), 'Informe um telefone com DDD, por exemplo (11) 99999-9999.', 'f-phone'],
      [!$('f-same').checked && !phoneOk(wa), 'Informe um WhatsApp válido.', 'f-wa'],
      [!$('f-consent').checked, 'Aceite o uso dos seus dados para continuar.', 'f-consent'],
    ];
    const bad = problems.find((p) => p[0]);
    if (bad) {
      setError(err, bad[1]);
      const t = bad[2] && $(bad[2]);
      if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); if (t.focus && t.tagName === 'INPUT') t.focus({ preventScroll: true }); }
      return;
    }
    const S = state.data.settings;
    const btn = $('book-submit');
    btn.disabled = true;
    btn.textContent = 'Enviando...';
    try {
      let result;
      if (state.offline) {
        result = { service: state.service.name, price_cents: state.service.price_cents, date: state.date, start_min: state.slot, whatsapp: S.whatsapp, preview: true };
      } else {
        result = await post('/api/bookings', {
          service_id: state.service.id, vehicle_kind: state.vehicle, vehicle_brand: brand, vehicle_model: model,
          date: state.date, start_min: state.slot, name, phone, whatsapp: wa, notes: $('f-notes').value.trim(), consent: true, website: $('f-trap').value,
        });
      }
      const msg = [
        `Olá, ${S.business_name}! Acabei de agendar pelo site.`,
        `Nome: ${name}`,
        `Serviço: ${result.service} (a partir de ${brl(result.price_cents)})`,
        `Veículo: ${VEHICLE_LABEL[state.vehicle]} ${brand} ${model}`,
        `Data: ${fmtDate(result.date)}, ${hhmm(result.start_min)}`,
        `Pode confirmar?`,
      ].join('\n');
      $('success-text').textContent = result.preview
        ? 'Esta é uma prévia sem servidor: o pedido não foi salvo. Use o botão abaixo para enviar os dados pelo WhatsApp.'
        : `Recebemos seu pedido para ${fmtDate(result.date)}, às ${hhmm(result.start_min)}. A equipe vai confirmar o horário com você. Se preferir adiantar, confirme pelo WhatsApp.`;
      $('success-wa').href = waLink(result.whatsapp, msg);
      $('book').classList.add('done');
      $('success').hidden = false;
      $('success').focus();
      $('success').scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (e) {
      setError(err, e.message);
      if (e.status === 409) refreshSlots();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirmar agendamento';
    }
  }

  async function submitMessage(ev) {
    ev.preventDefault();
    const err = $('msg-error'), ok = $('msg-ok');
    setError(err, ''); ok.hidden = true;
    const name = $('m-name').value.trim(), text = $('m-text').value.trim(), phone = $('m-phone').value.trim();
    if (name.length < 2) return setError(err, 'Informe seu nome.');
    if (text.length < 5) return setError(err, 'Escreva sua mensagem.');
    if (phone && !phoneOk(phone)) return setError(err, 'Telefone inválido. Use o DDD.');
    if (!$('m-consent').checked) return setError(err, 'Aceite o uso dos seus dados para receber a resposta.');
    if (state.offline) {
      window.open(waLink(state.data.settings.whatsapp, `Olá! Sou ${name}. ${text}`), '_blank', 'noopener');
      return;
    }
    try {
      await post('/api/messages', { name, phone, text, consent: true, website: $('m-trap').value });
      ok.textContent = 'Mensagem enviada. Respondemos assim que possível.';
      ok.hidden = false;
      $('msg-form').reset();
    } catch (e) { setError(err, e.message); }
  }

  /* ---------- eventos ---------- */
  $('book-form').addEventListener('submit', submitBooking);
  $('msg-form').addEventListener('submit', submitMessage);
  $('f-date').addEventListener('change', (e) => { state.date = e.target.value; refreshSlots(); });
  for (const id of ['f-brand', 'f-model']) $(id).addEventListener('input', updateSummary);
  $('f-same').addEventListener('change', (e) => { $('wa-wrap').hidden = e.target.checked; });
  maskPhone($('f-phone')); maskPhone($('f-wa')); maskPhone($('m-phone'));
  $('success-again').addEventListener('click', () => {
    $('book').classList.remove('done');
    $('success').hidden = true;
    $('book-form').reset();
    state.service = null; state.vehicle = null; state.date = ''; state.slot = null;
    $('svc-pick').querySelectorAll('[aria-checked]').forEach((b) => b.setAttribute('aria-checked', 'false'));
    $('vehicle-kinds').querySelectorAll('[aria-checked]').forEach((b) => b.setAttribute('aria-checked', 'false'));
    $('slots').textContent = '';
    $('wa-wrap').hidden = true;
    refreshSlots();
    $('agendar').scrollIntoView({ behavior: 'smooth' });
  });
  const menuBtn = $('menu-btn'), nav = $('nav');
  menuBtn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) { nav.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { nav.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); } });

  load();
})();
