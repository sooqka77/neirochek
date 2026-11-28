/* UI-контроллер NeiroScan v3 — чистый 1-кнопочный поток без демо-шума */
(function () {
  'use strict';

  const STORAGE_KEY = 'neiroscan_state_v3';
  const QUICK_CHECK_KEYS = [
    { key: 'hasYandexStrong', short: 'Яндекс Карты 4.7+' },
    { key: 'has2gisFull', short: '2ГИС заполнен' },
    { key: 'hasZoonOtzovik', short: 'Есть Zoon / Отзовик' },
    { key: 'reviewsHaveScenarios', short: 'Отзывы со сценариями' },
    { key: 'hasFaqOnSite', short: 'Есть FAQ на сайте' },
    { key: 'hasSchemaLocal', short: 'Schema.org разметка' }
  ];
  const QUICK_KEY_SET = new Set(QUICK_CHECK_KEYS.map(x => x.key));

  const $ = (id) => document.getElementById(id);

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  async function copyText(text, successMsg) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showToast(successMsg || 'Скопировано в буфер');
    } catch (_) {
      showToast('Не удалось скопировать — выделите текст вручную');
    }
  }

  function createBlankPoint() {
    return {
      id: 'geo-' + Date.now(),
      isDemo: false,
      name: '',
      aliases: '',
      niche: 'kids',
      city: '',
      district: '',
      address: '',
      usp: '',
      competitor: '',
      siteUrl: '',
      phone: '',
      hours: 'Пн–Вс 10:00–20:00',
      yandexUrl: '',
      gisUrl: '',
      vkUrl: '',
      tgUrl: '',
      readiness: { botsAllowed: true },
      checkedSources: [],
      promptResults: {},
      history: [],
      siteSummary: ''
    };
  }

  function defaultState() {
    return {
      hasRunCheck: false,
      point: createBlankPoint(),
      findingFilter: 'all',
      activeProTab: 'sources',
      showAllPrompts: false
    };
  }

  function loadState() {
    let st = defaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.point && !parsed.point.isDemo && parsed.point.name) {
          st = Object.assign(st, parsed);
          st.point = Object.assign(createBlankPoint(), parsed.point);
        }
      }
    } catch (_) {}

    if (window.location.hash && window.location.hash.startsWith('#share=')) {
      const payload = NeiroEngine.decodePayload(window.location.hash.slice(7));
      if (payload && payload.name) {
        st.point = Object.assign(createBlankPoint(), payload, { isDemo: false });
        st.hasRunCheck = true;
        history.replaceState(null, '', window.location.pathname + window.location.search);
        setTimeout(() => showToast(`Открыт отчёт по точке «${payload.name}»`), 300);
      }
    }
    return st;
  }

  let state = loadState();
  let customFaq = null;
  let isScanning = false;

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function getPoint() {
    if (!state.point) state.point = createBlankPoint();
    const pt = state.point;
    pt.readiness = pt.readiness || {};
    pt.promptResults = pt.promptResults || {};
    pt.checkedSources = pt.checkedSources || [];
    pt.history = pt.history || [];
    return pt;
  }

  function getBackendUrl() {
    return (window.NEIRO_CONFIG && window.NEIRO_CONFIG.backendUrl)
      ? window.NEIRO_CONFIG.backendUrl.replace(/\/+$/, '')
      : '';
  }

  function trackEvent(event, meta) {
    const api = getBackendUrl();
    if (!api) return;
    try {
      fetch(`${api}/api/telemetry/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: 'neirochek', event, meta: meta || {} }),
        keepalive: true
      }).catch(() => {});
    } catch (_) {}
  }

  function syncTapChipsVisual() {
    document.querySelectorAll('.tap-chip').forEach(lbl => {
      const cb = lbl.querySelector('input[type="checkbox"]');
      if (cb) lbl.classList.toggle('checked', cb.checked);
    });
  }

  function initStaticControls() {
    $('g-niche').innerHTML = Object.values(NeiroData.NICHES)
      .map(n => `<option value="${esc(n.id)}">${esc(n.label)}</option>`)
      .join('');

    $('quick-readiness-chips').innerHTML = QUICK_CHECK_KEYS.map(item => `
      <label class="tap-chip">
        <input type="checkbox" data-readiness="${esc(item.key)}">
        <span class="dot">✓</span>
        <span>${esc(item.short)}</span>
      </label>
    `).join('');

    $('adv-readiness-checks').innerHTML = NeiroEngine.READINESS_CHECKS
      .filter(chk => !QUICK_KEY_SET.has(chk.key))
      .map(chk => `
        <label class="check-item">
          <input type="checkbox" data-readiness="${esc(chk.key)}">
          <span>${esc(chk.label)}</span>
        </label>
      `).join('');
  }

  function populateFormFromPoint(pt) {
    $('g-name').value = pt.name || '';
    $('g-niche').value = pt.niche || 'kids';
    $('g-district').value = pt.district || pt.city || '';
    $('g-site').value = pt.siteUrl || '';
    $('g-usp').value = pt.usp || '';

    $('g-city').value = pt.city || '';
    $('g-address').value = pt.address || '';
    $('g-comp').value = pt.competitor || '';
    $('g-aliases').value = pt.aliases || '';
    $('g-phone').value = pt.phone || '';
    $('g-hours').value = pt.hours || '';
    $('g-yandex').value = pt.yandexUrl || '';
    $('g-gis').value = pt.gisUrl || '';
    $('g-vk').value = pt.vkUrl || '';
    $('g-tg').value = pt.tgUrl || '';

    document.querySelectorAll('[data-readiness]').forEach(cb => {
      cb.checked = !!pt.readiness[cb.getAttribute('data-readiness')];
    });
    syncTapChipsVisual();
  }

  function parseCityFromDistrict(districtText, explicitCity) {
    if (explicitCity) return explicitCity;
    const raw = String(districtText || '').trim();
    if (!raw) return 'Москва';
    const first = raw.split(/[,/]+/)[0].trim();
    return first || 'Москва';
  }

  function syncPointFromForm() {
    const pt = getPoint();
    pt.isDemo = false;
    pt.name = $('g-name').value.trim();
    pt.niche = $('g-niche').value || 'kids';
    pt.district = $('g-district').value.trim();
    const explicitCity = $('g-city').value.trim();
    pt.city = parseCityFromDistrict(pt.district, explicitCity);
    pt.siteUrl = $('g-site').value.trim();
    pt.usp = $('g-usp').value.trim();
    pt.address = $('g-address').value.trim();
    pt.competitor = $('g-comp').value.trim();
    pt.aliases = $('g-aliases').value.trim();
    pt.phone = $('g-phone').value.trim();
    pt.hours = $('g-hours').value.trim();
    pt.yandexUrl = $('g-yandex').value.trim();
    pt.gisUrl = $('g-gis').value.trim();
    pt.vkUrl = $('g-vk').value.trim();
    pt.tgUrl = $('g-tg').value.trim();

    document.querySelectorAll('[data-readiness]').forEach(cb => {
      pt.readiness[cb.getAttribute('data-readiness')] = cb.checked;
    });
    syncTapChipsVisual();
    customFaq = null;
    saveState();
    return pt;
  }

  function setProgress(visible, pct, statusText, noteText) {
    const box = $('scan-progress');
    box.classList.toggle('hidden', !visible);
    if (!visible) return;
    $('scan-pct').textContent = Math.round(pct) + '%';
    $('scan-fill').style.width = Math.max(4, Math.min(100, pct)) + '%';
    if (statusText) $('scan-status').textContent = statusText;
    if (noteText) $('scan-note').textContent = noteText;
  }

  async function runAutomatedCheck() {
    if (isScanning) return;
    const errEl = $('form-error');
    errEl.classList.add('hidden');
    const pt = syncPointFromForm();

    // Нормализуем сайт и ссылку на Яндекс Карты
    let cleanSite = (pt.siteUrl || '').trim();
    if (cleanSite && !/^https?:\/\//i.test(cleanSite)) {
      cleanSite = 'https://' + cleanSite;
      pt.siteUrl = cleanSite;
      $('g-site').value = cleanSite;
    }
    let cleanYandex = (pt.yandexUrl || '').trim();
    if (cleanYandex && !/^https?:\/\//i.test(cleanYandex)) {
      cleanYandex = 'https://' + cleanYandex;
      pt.yandexUrl = cleanYandex;
      $('g-yandex').value = cleanYandex;
    }

    if (!pt.name && !cleanYandex) {
      errEl.textContent = 'Введите название вашего бизнеса или вставьте ссылку на Яндекс Карты.';
      errEl.classList.remove('hidden');
      $('g-name').focus();
      return;
    }

    isScanning = true;
    const btn = $('btn-run-full-check');
    btn.disabled = true;
    btn.textContent = 'Проверяем бизнес в ИИ...';

    // Сбрасываем прошлые ответы при новом прогоне
    pt.promptResults = {};
    pt.siteSummary = '';
    saveState();

    const api = getBackendUrl();
    const hasGeoOrSite = !!(cleanSite || cleanYandex);
    const totalSteps = (hasGeoOrSite ? 1 : 0) + 5;
    let doneSteps = 0;

    setProgress(true, 6, 'Запускаем проверку...', hasGeoOrSite ? 'Сначала проверим карточку Яндекса и сайт, затем зададим 5 вопросов нейросетям.' : 'Задаём 5 реальных покупательских запросов по вашему району.');

    // Шаг 1 (автоматически): параллельный рентген карточки Яндекса + 2ГИС + сайта через /api/geo/lookup
    if (api && hasGeoOrSite) {
      setProgress(true, 10, cleanYandex && cleanSite ? 'Проверяем карточку Яндекса и сайт...' : (cleanYandex ? 'Читаем карточку на Яндекс Картах...' : 'Проверяем сайт (Schema.org, FAQ, robots.txt)...'), cleanYandex || cleanSite);
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 16000);
        const r = await fetch(`${api}/api/geo/lookup`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            yandexUrl: cleanYandex,
            query: pt.name,
            city: pt.city,
            district: pt.district,
            niche: pt.niche,
            siteUrl: cleanSite
          })
        });
        clearTimeout(t);
        const data = await r.json();
        const summaryParts = [];
        if (r.ok && data.ok) {
          if (data.yandexCard && data.yandexCard.ok) {
            const m = data.yandexCard.meta || {};
            const sem = data.yandexCard.semantics || {};
            if (m.title && !pt.name) pt.name = m.title;
            if (m.address && !pt.district) pt.district = m.address;
            if (m.address && !pt.address) pt.address = m.address;
            if (Array.isArray(m.phones) && m.phones[0] && !pt.phone) pt.phone = m.phones[0];
            if (Array.isArray(m.urls) && m.urls[0] && !pt.siteUrl) pt.siteUrl = m.urls[0];
            if (Array.isArray(m.socialLinks)) {
              const tg = m.socialLinks.find(s => /telegram/i.test(s.type || '') && s.href);
              const vk = m.socialLinks.find(s => /vk/i.test(s.type || '') && s.href);
              if (tg && !pt.tgUrl) pt.tgUrl = tg.href;
              if (vk && !pt.vkUrl) pt.vkUrl = vk.href;
            }
            if ((m.rating || 0) >= 4.7 && (m.reviewCount || 0) >= 20) pt.readiness.hasYandexStrong = true;
            if ((sem.recent30d || 0) >= 2) pt.readiness.reviewsFresh = true;
            if ((sem.replyRate || 0) >= 70) pt.readiness.ownerRepliesFacts = true;
            if ((sem.strongThemes || []).length >= 2) pt.readiness.reviewsHaveScenarios = true;
            const unansNote = sem.unansweredRecent30d >= 2 ? ` (⚠ ${sem.unansweredRecent30d} свежих без ответа)` : '';
            summaryParts.push(`Я.Карты: ${m.rating || '—'} ★ · ${m.reviewCount || 0} отз.${unansNote}`);
          }
          if (data.twogis) {
            pt.readiness.has2gisFull = true;
            if (data.twogis.gisUrl && !pt.gisUrl) pt.gisUrl = data.twogis.gisUrl;
            summaryParts.push(`2ГИС: ${data.twogis.rating || '—'} ★`);
          }
          if (data.siteReport) {
            const rep = data.siteReport;
            pt.readiness.hasSchemaLocal = !!rep.schema?.hasLocalBusiness;
            pt.readiness.hasFaqOnSite = !!rep.hasFaq;
            pt.readiness.botsAllowed = !!rep.robots?.allAllowed;
            pt.readiness.hasLlmsTxt = !!rep.hasLlmsTxt;
            pt.readiness.hasLocalPage = !!(rep.https && rep.hasViewport);
            if (rep.links?.yandexUrl && !pt.yandexUrl) pt.yandexUrl = rep.links.yandexUrl;
            if (rep.links?.gisUrl && !pt.gisUrl) { pt.gisUrl = rep.links.gisUrl; pt.readiness.has2gisFull = true; }
            if (rep.links?.vkUrl && !pt.vkUrl) pt.vkUrl = rep.links.vkUrl;
            if (rep.links?.tgUrl && !pt.tgUrl) pt.tgUrl = rep.links.tgUrl;
            if (rep.links?.zoonUrl || rep.links?.otzovikUrl || rep.links?.irecommendUrl) {
              pt.readiness.hasZoonOtzovik = true;
            }
            const h1Note = rep.h1 ? '' : ' · нет H1';
            summaryParts.push(`Сайт: Schema ${rep.schema?.hasLocalBusiness ? 'есть' : 'нет'} · FAQ ${rep.hasFaq ? 'есть' : 'нет'}${h1Note}`);
            // Проверка NAP-конфликта телефонов
            const yPh = String(data.yandexCard?.meta?.phones?.[0] || '').replace(/\D/g, '').slice(-10);
            const sPhList = (rep.phones || []).map(x => String(x).replace(/\D/g, '').slice(-10)).filter(Boolean);
            if (yPh.length === 10 && sPhList.length && !sPhList.includes(yPh)) {
              pt.readiness.napConsistent = false;
              summaryParts.push(`⚠ Разные телефоны: Я.Карты (${data.yandexCard.meta.phones[0]}) vs сайт (${rep.phones[0]})`);
            } else if (yPh.length === 10 && sPhList.includes(yPh)) {
              pt.readiness.napConsistent = true;
            }
          }
          if (summaryParts.length) pt.siteSummary = summaryParts.join(' · ');
        }
      } catch (_) {
        pt.siteSummary = `Не удалось прочитать карточку/сайт автоматически — показали разбор по ответам ИИ.`;
      }
      doneSteps++;
      setProgress(true, (doneSteps / totalSteps) * 100, 'Карточка и сайт проверены · переходим к нейросетям...', '');
    }

    if (!pt.name) pt.name = 'Ваш бизнес';
    const prompts = NeiroEngine.buildPromptMatrix(pt).slice(0, 5);

    // Шаг 2 (автоматически): 5 живых запросов в ИИ
    let aiErrors = 0;
    if (api) {
      for (let i = 0; i < prompts.length; i++) {
        setProgress(
          true,
          Math.max(15, (doneSteps / totalSteps) * 100),
          `Опрашиваем ИИ: запрос ${i + 1} из ${prompts.length}...`,
          `«${prompts[i].text.slice(0, 95)}...»`
        );
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 20000);
          const r = await fetch(`${api}/api/ai/check`, {
            method: 'POST',
            signal: ctrl.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: prompts[i].text, businessName: pt.name })
          });
          clearTimeout(t);
          const data = await r.json();
          if (!r.ok || !data.ok) throw new Error(data.message || data.error || 'server_error');
          pt.promptResults[prompts[i].id] = {
            model: data.model || 'ИИ-сервер',
            responseText: data.responseText || '',
            quickStatus: ''
          };
        } catch (err) {
          aiErrors++;
          if (aiErrors >= 2) break; // Не мучаем пользователя, если сеть недоступна
        }
        doneSteps++;
      }
    }

    state.hasRunCheck = true;
    saveState();
    populateFormFromPoint(pt);
    renderAll();

    setProgress(true, 100, 'Готово! Результаты собраны ниже.', '');
    setTimeout(() => setProgress(false, 0), 900);

    btn.disabled = false;
    btn.textContent = 'Проверить бизнес в ИИ бесплатно →';
    isScanning = false;

    if (aiErrors >= 2) {
      $('prompts-drawer').open = true;
      showToast('Автопроверка ИИ временно недоступна — открыли 1-клик кнопки Алисы и GigaChat');
    } else {
      showToast('Проверка завершена!');
    }
    $('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderFindingsList(items) {
    if (!items.length) return '<p class="hint">В этой категории пунктов нет.</p>';
    return items.map(f => {
      const tag = f.level === 'red' ? 'Критично' : f.level === 'yellow' ? 'Улучшить' : 'Готово';
      return `
        <div class="finding ${f.level}">
          <span class="f-tag ${f.level}">${tag}</span>
          <div>
            <h4>${esc(f.title)}</h4>
            <p class="f-why">${esc(f.why)}</p>
            <div class="f-fix"><b>Что сделать:</b> ${esc(f.fix)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderPrompts(pt, audit) {
    const visiblePrompts = state.showAllPrompts ? audit.prompts : audit.prompts.slice(0, 5);
    const models = ['Алиса / Яндекс AI', 'GigaChat', 'ChatGPT Search', 'Perplexity', 'DeepSeek'];

    const html = visiblePrompts.map((p, idx) => {
      const saved = pt.promptResults[p.id] || { model: models[0], responseText: '', quickStatus: '' };
      const an = audit.live.perPromptAnalysis[p.id];
      const isBrand = p.id === 'p4';
      let cardCls = '';
      let badgeHtml = `<span class="res-badge idle">Не проверено</span>`;

      if (an) {
        if (an.hallucinationFlags.length) {
          cardCls = 'warn';
          badgeHtml = `<span class="res-badge warn">⚠ Мало данных</span>`;
        } else if (an.isDirectBrandCheck) {
          cardCls = an.sentiment === 'negative' ? 'miss' : 'hit';
          badgeHtml = an.sentiment === 'negative'
            ? `<span class="res-badge bad">Есть негатив</span>`
            : `<span class="res-badge good">✓ ИИ знает бренд</span>`;
        } else if (an.mentioned) {
          cardCls = 'hit';
          badgeHtml = `<span class="res-badge good">✓ Упомянуты · #${an.position || 1}</span>`;
        } else {
          cardCls = 'miss';
          badgeHtml = `<span class="res-badge bad">✕ Нет в ответе</span>`;
        }
      }

      const qs = saved.quickStatus || '';
      const quickButtonsHtml = isBrand ? `
        <div class="quick-verdict-row">
          <span class="hint">Отметить вручную:</span>
          <button type="button" class="qv-btn ${qs === 'brand_ok' ? 'active-good' : ''}" data-qv="${esc(p.id)}" data-val="brand_ok">✓ Знает хорошо</button>
          <button type="button" class="qv-btn ${qs === 'brand_vacuum' ? 'active-warn' : ''}" data-qv="${esc(p.id)}" data-val="brand_vacuum">~ Мало данных</button>
          <button type="button" class="qv-btn ${qs === 'brand_bad' ? 'active-bad' : ''}" data-qv="${esc(p.id)}" data-val="brand_bad">⚠ Ошибка / негатив</button>
        </div>
      ` : `
        <div class="quick-verdict-row">
          <span class="hint">Отметить вручную:</span>
          <button type="button" class="qv-btn ${qs === 'top3' ? 'active-good' : ''}" data-qv="${esc(p.id)}" data-val="top3">✓ В топ-3</button>
          <button type="button" class="qv-btn ${qs === 'low' ? 'active-warn' : ''}" data-qv="${esc(p.id)}" data-val="low">~ В конце</button>
          <button type="button" class="qv-btn ${qs === 'miss' ? 'active-bad' : ''}" data-qv="${esc(p.id)}" data-val="miss">✕ Нас нет</button>
        </div>
      `;

      const hasText = !!(saved.responseText && saved.responseText.trim());
      return `
        <div class="prompt-card ${cardCls}" data-pid="${esc(p.id)}">
          <div class="prompt-top">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span class="intent-tag">#${idx + 1} · ${esc(p.intent)}</span>
              <strong style="font-size:14.5px;">${esc(p.title)}</strong>
            </div>
            ${badgeHtml}
          </div>
          <div class="prompt-q">${esc(p.text)}</div>
          <div class="ai-btn-row">
            <button type="button" class="ai-chip ru-main" data-launch-url="${esc(p.links.yandexAi)}" data-copy-q="${esc(p.text)}">Яндекс AI (Алиса) ↗</button>
            <button type="button" class="ai-chip ru-giga" data-launch-url="${esc(p.links.gigachat)}" data-copy-q="${esc(p.text)}">GigaChat ↗</button>
            <button type="button" class="ai-chip" data-launch-url="${esc(p.links.chatgpt)}" data-copy-q="${esc(p.text)}">ChatGPT ↗</button>
            <button type="button" class="ai-chip" data-launch-url="${esc(p.links.perplexity)}" data-copy-q="${esc(p.text)}">Perplexity ↗</button>
            <button type="button" class="ai-chip" data-copy-only="${esc(p.text)}">Копировать</button>
          </div>
          ${quickButtonsHtml}
          <details class="paste-toggle" ${hasText ? 'open' : ''}>
            <summary>${hasText ? 'Текст ответа ИИ (нажмите, чтобы скрыть)' : '+ Вставить ответ из Алисы / ChatGPT вручную'}</summary>
            <div style="margin-top:8px;">
              <div class="field">
                <textarea rows="3" data-resp-for="${esc(p.id)}" placeholder="Вставьте ответ нейросети...">${esc(saved.responseText || '')}</textarea>
              </div>
            </div>
          </details>
        </div>
      `;
    }).join('');

    $('prompts-list').innerHTML = html;

    $('prompts-list').querySelectorAll('[data-launch-url]').forEach(btn => {
      btn.addEventListener('click', () => {
        copyText(btn.getAttribute('data-copy-q'), 'Запрос скопирован — открываем нейросеть!');
        window.open(btn.getAttribute('data-launch-url'), '_blank', 'noopener');
      });
    });
    $('prompts-list').querySelectorAll('[data-copy-only]').forEach(btn => {
      btn.addEventListener('click', () => copyText(btn.getAttribute('data-copy-only'), 'Запрос скопирован!'));
    });
    $('prompts-list').querySelectorAll('[data-qv]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.getAttribute('data-qv');
        const val = btn.getAttribute('data-val');
        const prev = pt.promptResults[pid] || { model: models[0], responseText: '', quickStatus: '' };
        pt.promptResults[pid] = {
          model: prev.model,
          responseText: prev.responseText,
          quickStatus: prev.quickStatus === val ? '' : val
        };
        saveState();
        renderAll();
      });
    });
    $('prompts-list').querySelectorAll('[data-resp-for]').forEach(ta => {
      ta.addEventListener('input', () => {
        const pid = ta.getAttribute('data-resp-for');
        const prev = pt.promptResults[pid] || { model: models[0], responseText: '', quickStatus: '' };
        pt.promptResults[pid] = { model: prev.model, responseText: ta.value, quickStatus: prev.quickStatus };
        saveState();
        renderDashboardOnly();
      });
    });
  }

  function renderProArtifacts(pt, audit) {
    const checked = new Set(pt.checkedSources || []);
    $('sources-checklist').innerHTML = audit.niche.sources.map(src => {
      const done = checked.has(src.name);
      const pCls = src.priority === 'Критично' ? 'crit' : src.priority === 'Важно' ? 'imp' : 'opt';
      return `
        <div class="src-item ${done ? 'done' : ''}">
          <label class="src-left" style="cursor:pointer;">
            <input type="checkbox" data-src-name="${esc(src.name)}" ${done ? 'checked' : ''}>
            <div>
              <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
                <strong style="font-size:14.5px;">${esc(src.name)}</strong>
                <span class="prio-tag ${pCls}">${esc(src.priority)}</span>
              </div>
              <p class="hint" style="margin-top:3px;">${esc(src.why)}</p>
            </div>
          </label>
          <a class="btn btn-outline btn-xs" href="${esc(src.url)}" target="_blank" rel="noopener">Открыть ↗</a>
        </div>
      `;
    }).join('');

    $('sources-checklist').querySelectorAll('[data-src-name]').forEach(cb => {
      cb.addEventListener('change', () => {
        const name = cb.getAttribute('data-src-name');
        const set = new Set(pt.checkedSources || []);
        if (cb.checked) set.add(name);
        else set.delete(name);
        pt.checkedSources = Array.from(set);
        saveState();
        renderDashboardOnly();
      });
    });

    $('schema-code').textContent = NeiroEngine.generateSchemaJsonLd(pt);
    $('llms-code').textContent = NeiroEngine.generateLlmsTxt(pt);
    $('robots-code').textContent = NeiroEngine.generateRobotsSnippet();

    if (!customFaq) customFaq = NeiroEngine.generateFaqItems(pt);
    $('faq-editor').innerHTML = customFaq.map((it, i) => `
      <div style="border:1px solid var(--line);border-radius:10px;padding:11px;margin-bottom:8px;background:#FAFAF8;">
        <div class="field" style="margin-bottom:6px;">
          <label>Вопрос ${i + 1}</label>
          <input type="text" data-faq-q="${i}" value="${esc(it.q)}">
        </div>
        <div class="field">
          <label>Прямой ответ</label>
          <textarea rows="2" data-faq-a="${i}">${esc(it.a)}</textarea>
        </div>
      </div>
    `).join('');
    $('faq-code').textContent = NeiroEngine.buildFaqCode(customFaq);

    $('faq-editor').querySelectorAll('[data-faq-q]').forEach(inp => {
      inp.addEventListener('input', () => {
        customFaq[Number(inp.getAttribute('data-faq-q'))].q = inp.value;
        $('faq-code').textContent = NeiroEngine.buildFaqCode(customFaq);
      });
    });
    $('faq-editor').querySelectorAll('[data-faq-a]').forEach(ta => {
      ta.addEventListener('input', () => {
        customFaq[Number(ta.getAttribute('data-faq-a'))].a = ta.value;
        $('faq-code').textContent = NeiroEngine.buildFaqCode(customFaq);
      });
    });

    $('semantics-list').innerHTML = audit.niche.semanticAnchors
      .map((a, idx) => `<div class="anchor-chip"><b>${idx + 1}.</b> ${esc(a)}</div>`)
      .join('');

    renderHistoryChart(pt);
  }

  function renderHistoryChart(pt) {
    const hist = pt.history || [];
    const wrap = $('history-chart-wrap');
    if (!hist.length) {
      wrap.innerHTML = `<p class="hint" style="padding:12px;background:#FAFAF8;border-radius:10px;border:1px solid var(--line);">Пока нет сохранённых замеров. Нажмите «Сохранить замер», чтобы отслеживать рост видимости.</p>`;
      return;
    }
    const W = 440, H = 155, padL = 34, padR = 16, padT = 18, padB = 28;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const step = hist.length > 1 ? innerW / (hist.length - 1) : 0;
    const ptX = (i) => hist.length === 1 ? padL + innerW / 2 : padL + i * step;
    const ptY = (val) => padT + innerH * (1 - Math.max(0, Math.min(100, val)) / 100);
    const lineMent = hist.map((h, i) => `${ptX(i).toFixed(1)},${ptY(h.mentionRate).toFixed(1)}`).join(' ');

    wrap.innerHTML = `
      <svg class="history-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Динамика видимости в ИИ">
        <line x1="${padL}" y1="${ptY(0)}" x2="${W - padR}" y2="${ptY(0)}" stroke="#CBD5E1" stroke-width="1"/>
        <line x1="${padL}" y1="${ptY(50)}" x2="${W - padR}" y2="${ptY(50)}" stroke="#E2E8F0" stroke-dasharray="3 3"/>
        <line x1="${padL}" y1="${ptY(100)}" x2="${W - padR}" y2="${ptY(100)}" stroke="#E2E8F0" stroke-dasharray="3 3"/>
        ${hist.length > 1 ? `<polyline fill="none" stroke="#1D4ED8" stroke-width="2.5" points="${lineMent}"/>` : ''}
        ${hist.map((h, i) => `<circle cx="${ptX(i)}" cy="${ptY(h.mentionRate)}" r="5" fill="#1D4ED8"/><text x="${ptX(i)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="#475569" font-family="monospace">${esc(h.date)}</text>`).join('')}
      </svg>
    `;
  }

  function renderDashboardOnly() {
    const ws = $('results-workspace');
    ws.classList.toggle('hidden', !state.hasRunCheck);
    if (!state.hasRunCheck) return;

    const pt = getPoint();
    const safePt = Object.assign({}, pt, { name: pt.name || 'Ваш бизнес', city: pt.city || 'Москва' });
    const audit = NeiroEngine.runGeoAudit(safePt);

    $('res-title').textContent = safePt.name + (safePt.district ? ` · ${safePt.district}` : '');
    $('res-score').textContent = audit.totalScore;
    const stBadge = $('res-status');
    stBadge.textContent = audit.status.label;
    stBadge.className = 'status-badge ' + audit.status.code;
    $('res-summary').textContent = audit.status.summary;

    const arc = $('gauge-arc');
    arc.style.strokeDashoffset = (314.16 * (1 - audit.totalScore / 100)).toFixed(1);
    arc.style.stroke = audit.status.code === 'good' ? '#15803D' : audit.status.code === 'mid' ? '#D97706' : '#B91C1C';

    const l = audit.live;
    const brandText = l.brandCheckStatus === 'vacuum' ? 'Мало данных'
      : l.brandCheckStatus === 'positive' ? 'Знает (+)'
      : l.brandCheckStatus === 'negative' ? 'Негатив'
      : l.brandCheckStatus === 'neutral' ? 'Нейтрально'
      : '—';

    $('res-kpis').innerHTML = `
      <div class="kpi-box accent"><span class="k">Видимость в ИИ</span><span class="v">${l.mentionRate !== null ? l.mentionRate + '%' : '—'}</span></div>
      <div class="kpi-box"><span class="k">В топ-3 ИИ</span><span class="v">${l.top3Rate !== null ? l.top3Rate + '%' : '—'}</span></div>
      <div class="kpi-box"><span class="k">Готовность к ИИ</span><span class="v">${audit.readinessScore}/100</span></div>
      <div class="kpi-box"><span class="k">Прямой бренд-чек</span><span class="v" style="font-size:15px;padding-top:4px;">${brandText}</span></div>
    `;

    $('res-pillars').innerHTML = audit.pillars.map(pl => {
      const pct = Math.round((pl.score / pl.max) * 100);
      const cls = pct >= 70 ? 'good' : pct >= 40 ? 'mid' : 'bad';
      return `
        <div class="pillar-row">
          <span>${esc(pl.label)}</span>
          <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
          <span class="mono" style="text-align:right;font-weight:700;">${pl.score}/${pl.max}</span>
        </div>
      `;
    }).join('');

    const sb = $('site-audit-banner');
    if (pt.siteSummary) {
      sb.textContent = '✓ ' + pt.siteSummary;
      sb.classList.remove('hidden');
    } else {
      sb.classList.add('hidden');
    }

    $('hallucination-slot').innerHTML = l.hallucinations.length
      ? `<div class="alert-box"><b>Обнаружены риски в ответах ИИ:</b><ul style="margin:6px 0 0;padding-left:18px;">${l.hallucinations.map(h => `<li><b>${esc(h.promptTitle)}:</b> ${esc(h.flag)}</li>`).join('')}</ul></div>`
      : '';

    $('comp-rank-list').innerHTML = l.topCompetitors.length
      ? l.topCompetitors.map((c, i) => `<div class="rank-row"><span><b>#${i + 1}</b> ${esc(c.name)}</span><span class="mono" style="font-weight:700;">${c.hits} упом.</span></div>`).join('')
      : `<p class="hint" style="margin-top:8px;">Конкуренты в ответах ИИ пока не определены — откройте блок «5 ответов ИИ» ниже, чтобы посмотреть полные тексты.</p>`;

    $('domain-rank-list').innerHTML = l.topDomains.length
      ? l.topDomains.map(d => `
          <div class="rank-row">
            <div><span class="mono" style="font-weight:700;">${esc(d.domain)}</span> <span class="hint">(${d.hits})</span></div>
            <span class="gap-pill ${d.present ? 'ok' : 'miss'}">${d.present ? '✓ Вы есть' : '✕ Пробел'}</span>
          </div>
        `).join('')
      : `<p class="hint" style="margin-top:8px;">Источники цитирования появятся после проверки ответов ИИ.</p>`;

    const topIssues = audit.findings.filter(f => f.level !== 'green').slice(0, 3);
    $('top-findings').innerHTML = renderFindingsList(topIssues.length ? topIssues : audit.findings.slice(0, 3));
    $('all-findings-label').textContent = `Показать все ${audit.findings.length} факторов GEO (критично: ${audit.counts.red}, улучшить: ${audit.counts.yellow})`;

    const filtered = state.findingFilter === 'all'
      ? audit.findings
      : audit.findings.filter(f => f.level === state.findingFilter);
    $('res-findings').innerHTML = renderFindingsList(filtered);

    renderProArtifacts(safePt, audit);
  }

  function renderAll() {
    renderDashboardOnly();
    if (state.hasRunCheck) {
      const pt = getPoint();
      const safePt = Object.assign({}, pt, { name: pt.name || 'Ваш бизнес', city: pt.city || 'Москва' });
      const audit = NeiroEngine.runGeoAudit(safePt);
      renderPrompts(pt, audit);
    }
  }

  function bindEvents() {
    $('geo-form').addEventListener('submit', (e) => {
      e.preventDefault();
      runAutomatedCheck();
    });

    // Синхронизация полей уточнения внутри tune-drawer
    $('tune-drawer').addEventListener('input', () => { syncPointFromForm(); renderDashboardOnly(); });
    $('tune-drawer').addEventListener('change', () => { syncPointFromForm(); renderDashboardOnly(); });

    $('btn-new-check').addEventListener('click', () => {
      state.point = createBlankPoint();
      state.hasRunCheck = false;
      customFaq = null;
      saveState();
      populateFormFromPoint(state.point);
      renderAll();
      $('g-name').focus();
      $('check-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    $('btn-rerun-ai').addEventListener('click', () => runAutomatedCheck());

    $('findings-filters').querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.findingFilter = btn.getAttribute('data-filter');
        $('findings-filters').querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === btn));
        renderDashboardOnly();
      });
    });

    $('pro-tabs').querySelectorAll('[data-pro-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-pro-tab');
        state.activeProTab = tab;
        $('pro-tabs').querySelectorAll('[data-pro-tab]').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.pro-pane').forEach(p => p.classList.toggle('hidden', p.id !== 'pro-pane-' + tab));
      });
    });

    $('btn-copy-schema').addEventListener('click', () => copyText($('schema-code').textContent, 'Schema.org JSON-LD скопирован!'));
    $('btn-copy-llms').addEventListener('click', () => copyText($('llms-code').textContent, 'Текст llms.txt скопирован!'));
    $('btn-copy-robots').addEventListener('click', () => copyText($('robots-code').textContent, 'Блок robots.txt скопирован!'));
    $('btn-copy-faq').addEventListener('click', () => copyText($('faq-code').textContent, 'HTML + FAQPage JSON-LD скопирован!'));

    $('btn-download-llms').addEventListener('click', () => {
      const blob = new Blob([$('llms-code').textContent], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'llms.txt';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      showToast('Файл llms.txt скачан');
    });

    $('btn-export-csv').addEventListener('click', () => {
      const pt = getPoint();
      const audit = NeiroEngine.runGeoAudit(Object.assign({}, pt, { name: pt.name || 'Точка' }));
      const csv = NeiroEngine.exportMatrixCsv(pt, audit);
      const lines = csv.split(/\r?\n/).filter(Boolean);
      if (lines.length <= 1) {
        showToast('Сначала выполните проверку — и матрица выгрузится в CSV');
        return;
      }
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const slug = (pt.name || 'llm-matrix').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').slice(0, 32);
      a.download = `neiroscan-matrix-${slug}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      trackEvent('export_csv', { rows: lines.length - 1 });
      showToast(`Матрица LLM (${lines.length - 1} строк) скачана`);
    });

    $('btn-save-snapshot').addEventListener('click', () => {
      const pt = getPoint();
      const audit = NeiroEngine.runGeoAudit(Object.assign({}, pt, { name: pt.name || 'Точка' }));
      const now = new Date();
      const d = String(now.getDate()).padStart(2, '0') + '.' + String(now.getMonth() + 1).padStart(2, '0');
      pt.history.push({ date: d, mentionRate: audit.live.mentionRate !== null ? audit.live.mentionRate : 0, readiness: audit.readinessScore });
      if (pt.history.length > 12) pt.history = pt.history.slice(-12);
      saveState();
      renderHistoryChart(pt);
      showToast(`Замер за ${d} сохранён`);
    });

    $('btn-clear-history').addEventListener('click', () => {
      getPoint().history = [];
      saveState();
      renderHistoryChart(getPoint());
      showToast('История очищена');
    });

    $('btn-share-report').addEventListener('click', () => {
      const pt = Object.assign({}, getPoint());
      delete pt.id;
      const base = window.location.origin + window.location.pathname;
      copyText(`${base}#share=${NeiroEngine.encodePayload(pt)}`, 'Ссылка на отчёт скопирована!');
    });
    $('btn-print-report').addEventListener('click', () => window.print());

    // Order / pricing modal
    const ordBack = $('order-backdrop');
    let selectedPlan = '';
    document.querySelectorAll('[data-order-plan]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedPlan = btn.getAttribute('data-order-plan') || '';
        const pt = getPoint();
        $('order-plan-label').textContent = selectedPlan;
        $('ord-point').value = [pt.name, pt.district || pt.city, pt.yandexUrl || pt.siteUrl].filter(Boolean).join(' · ');
        $('order-status').textContent = '';
        ordBack.classList.remove('hidden');
        trackEvent('order_open', { plan: selectedPlan });
      });
    });
    $('btn-close-order').addEventListener('click', () => ordBack.classList.add('hidden'));
    ordBack.addEventListener('click', (e) => { if (e.target === ordBack) ordBack.classList.add('hidden'); });
    $('order-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pointName = ($('ord-point').value || '').trim();
      const contact = ($('ord-contact').value || '').trim();
      const pt = getPoint();
      const planLow = selectedPlan.toLowerCase();
      const tariffId = planLow.includes('250') ? 'recs_250'
        : planLow.includes('3 карточ') ? 'pack_3'
        : planLow.includes('10 карточ') ? 'pack_10'
        : planLow.includes('vip') || planLow.includes('5 000') ? 'vip_5000'
        : 'pro_950';
      const api = getBackendUrl();
      const stEl = $('order-status');
      stEl.textContent = 'Сохраняем заявку...';
      if (api) {
        try {
          const r = await fetch(`${api}/api/orders/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              app: 'neiroscan',
              tariffId,
              contact,
              input: {
                name: pt.name || pointName,
                city: pt.city || '',
                district: pt.district || '',
                niche: pt.niche || 'other',
                usp: pt.usp || '',
                yandexUrl: pt.yandexUrl || (/yandex\./i.test(pointName) ? pointName : ''),
                gisUrl: pt.gisUrl || '',
                siteUrl: pt.siteUrl || '',
                phone: pt.phone || ''
              }
            })
          });
          const d = await r.json();
          if (r.ok && d.ok && d.mode === 'payment' && d.paymentUrl) {
            stEl.textContent = 'Переходим к оплате...';
            window.location.href = d.paymentUrl;
            return;
          }
        } catch (_) {}
      }
      const txt = `Заявка NeiroScan (${selectedPlan}): ${pointName} | Контакт: ${contact}`;
      copyText(txt, 'Заявка отправлена и скопирована!');
      stEl.textContent = '✓ Заявка принята! Мы свяжемся по указанному контакту.';
      setTimeout(() => ordBack.classList.add('hidden'), 1800);
    });

    trackEvent('page_view');
  }

  initStaticControls();
  populateFormFromPoint(getPoint());
  bindEvents();
  renderAll();
})();
