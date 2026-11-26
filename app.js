/* UI-контроллер НейроЧек v2 */
(function () {
  'use strict';

  const STORAGE_KEY = 'neirochek_state_v2';
  const API_KEY_STORAGE = 'neirochek_local_api_key';
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
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
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
      city: 'Москва',
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
      history: []
    };
  }

  function defaultState() {
    const first = JSON.parse(JSON.stringify(NeiroData.DEMO_PRESETS[0].point));
    first.id = 'geo-1';
    first.isDemo = true;
    return {
      activePointId: 'geo-1',
      points: [first],
      findingFilter: 'all',
      activeProTab: 'sources',
      showAllPrompts: false,
      selectedFeedback: ''
    };
  }

  function loadState() {
    let st = defaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('neirochek_state_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.points) && parsed.points.length) {
          st = Object.assign(st, parsed);
        }
      }
    } catch (_) {}

    if (window.location.hash && window.location.hash.startsWith('#share=')) {
      const payload = NeiroEngine.decodePayload(window.location.hash.slice(7));
      if (payload && payload.name) {
        const id = 'geo-shared-' + Date.now();
        payload.id = id;
        payload.isDemo = false;
        payload.readiness = payload.readiness || {};
        payload.promptResults = payload.promptResults || {};
        payload.checkedSources = payload.checkedSources || [];
        payload.history = payload.history || [];
        st.points.unshift(payload);
        st.activePointId = id;
        history.replaceState(null, '', window.location.pathname + window.location.search);
        setTimeout(() => showToast(`Открыт GEO-отчёт по точке «${payload.name}»`), 300);
      }
    }
    return st;
  }

  let state = loadState();
  let customFaqByPoint = {};

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function getActivePoint() {
    let pt = state.points.find(p => p.id === state.activePointId);
    if (!pt) { pt = state.points[0]; state.activePointId = pt.id; }
    pt.readiness = pt.readiness || {};
    pt.promptResults = pt.promptResults || {};
    pt.checkedSources = pt.checkedSources || [];
    pt.history = pt.history || [];
    return pt;
  }

  function syncTapChipsVisual() {
    document.querySelectorAll('.tap-chip').forEach(lbl => {
      const cb = lbl.querySelector('input[type="checkbox"]');
      if (cb) lbl.classList.toggle('checked', cb.checked);
    });
  }

  function startOwnBlankPoint() {
    const active = getActivePoint();
    if (active.isDemo) {
      const fresh = createBlankPoint();
      fresh.id = active.id;
      Object.assign(active, fresh);
    } else {
      const fresh = createBlankPoint();
      state.points.push(fresh);
      state.activePointId = fresh.id;
    }
    delete customFaqByPoint[state.activePointId];
    saveState();
    populateFormFromPoint(getActivePoint());
    renderAll();
    $('g-name').focus();
    $('g-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Форма очищена — введите название и район вашей точки');
  }

  function initStaticControls() {
    $('g-niche').innerHTML = Object.values(NeiroData.NICHES)
      .map(n => `<option value="${esc(n.id)}">${esc(n.label)}</option>`)
      .join('');

    $('demo-buttons').innerHTML = NeiroData.DEMO_PRESETS
      .map(d => `<button type="button" class="demo-btn" data-demo="${esc(d.id)}">${esc(d.label.replace(/^Пример \d+: /, ''))}</button>`)
      .join('');

    $('demo-buttons').querySelectorAll('[data-demo]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = NeiroData.DEMO_PRESETS.find(d => d.id === btn.getAttribute('data-demo'));
        if (!preset) return;
        const pt = getActivePoint();
        Object.assign(pt, JSON.parse(JSON.stringify(preset.point)), { id: pt.id, isDemo: true });
        delete customFaqByPoint[pt.id];
        saveState();
        populateFormFromPoint(pt);
        renderAll();
        showToast(`Загружен пример: ${preset.point.name}`);
      });
    });

    // 6 главных тап-чипсов на 1-м экране
    $('quick-readiness-chips').innerHTML = QUICK_CHECK_KEYS.map(item => `
      <label class="tap-chip">
        <input type="checkbox" data-readiness="${esc(item.key)}">
        <span class="dot">✓</span>
        <span>${esc(item.short)}</span>
      </label>
    `).join('');

    // Остальные 8 факторов GEO в раскрывающемся блоке
    $('adv-readiness-checks').innerHTML = NeiroEngine.READINESS_CHECKS
      .filter(chk => !QUICK_KEY_SET.has(chk.key))
      .map(chk => `
        <label class="check-item">
          <input type="checkbox" data-readiness="${esc(chk.key)}">
          <span>${esc(chk.label)}</span>
        </label>
      `).join('');

    try {
      const savedKey = localStorage.getItem(API_KEY_STORAGE);
      if (savedKey) $('api-key').value = savedKey;
    } catch (_) {}

    if (window.NEIRO_CONFIG && window.NEIRO_CONFIG.backendUrl) {
      $('api-endpoint').value = window.NEIRO_CONFIG.backendUrl;
    }
  }

  function populateFormFromPoint(pt) {
    $('g-name').value = pt.name || '';
    $('g-niche').value = pt.niche || 'other';
    $('g-city').value = pt.city || '';
    $('g-district').value = pt.district || '';
    $('g-address').value = pt.address || '';
    $('g-usp').value = pt.usp || '';
    $('g-comp').value = pt.competitor || '';
    $('g-aliases').value = pt.aliases || '';
    $('g-site').value = pt.siteUrl || '';
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

  function syncPointFromForm() {
    const pt = getActivePoint();
    pt.isDemo = false;
    pt.name = $('g-name').value.trim();
    pt.niche = $('g-niche').value || 'other';
    pt.city = $('g-city').value.trim() || 'Москва';
    pt.district = $('g-district').value.trim();
    pt.address = $('g-address').value.trim();
    pt.usp = $('g-usp').value.trim();
    pt.competitor = $('g-comp').value.trim();
    pt.aliases = $('g-aliases').value.trim();
    pt.siteUrl = $('g-site').value.trim();
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
    delete customFaqByPoint[pt.id];
    saveState();
    return pt;
  }

  function renderPointsBar() {
    const wrap = $('points-bar');
    const chips = state.points.map(pt => {
      const safe = Object.assign({}, pt, { name: pt.name || 'Новая точка' });
      const a = NeiroEngine.runGeoAudit(safe);
      const isAct = pt.id === state.activePointId;
      return `
        <div class="point-chip ${isAct ? 'active' : ''}" data-select-pt="${esc(pt.id)}" role="button" tabindex="0">
          <span>${esc(safe.name)}</span>
          <span class="chip-score">${a.totalScore}</span>
          ${state.points.length > 1 ? `<button type="button" class="chip-del" data-del-pt="${esc(pt.id)}" title="Удалить">×</button>` : ''}
        </div>
      `;
    }).join('');

    const countNote = state.points.length >= 3
      ? `<span class="hint">Бесплатно: 3 точки · доп. точки открыты в PRO-тесте</span>`
      : `<span class="hint">Точек: ${state.points.length} / 3 бесплатно</span>`;

    wrap.innerHTML = `${chips}<button type="button" class="add-point-btn" id="btn-add-point">+ Добавить точку</button>${countNote}`;

    wrap.querySelectorAll('[data-select-pt]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.hasAttribute('data-del-pt')) return;
        state.activePointId = el.getAttribute('data-select-pt');
        saveState();
        populateFormFromPoint(getActivePoint());
        renderAll();
      });
    });

    wrap.querySelectorAll('[data-del-pt]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-del-pt');
        if (state.points.length <= 1) return;
        state.points = state.points.filter(p => p.id !== id);
        if (state.activePointId === id) state.activePointId = state.points[0].id;
        saveState();
        populateFormFromPoint(getActivePoint());
        renderAll();
      });
    });

    $('btn-add-point').addEventListener('click', () => {
      const fresh = createBlankPoint();
      state.points.push(fresh);
      state.activePointId = fresh.id;
      saveState();
      populateFormFromPoint(fresh);
      renderAll();
      $('g-name').focus();
    });
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
          badgeHtml = `<span class="res-badge warn">⚠ Мало данных / риск галлюцинации</span>`;
        } else if (an.isDirectBrandCheck) {
          cardCls = an.sentiment === 'negative' ? 'miss' : 'hit';
          badgeHtml = an.sentiment === 'negative'
            ? `<span class="res-badge bad">Есть негатив / ошибка</span>`
            : `<span class="res-badge good">✓ ИИ знает бренд</span>`;
        } else if (an.mentioned) {
          cardCls = 'hit';
          badgeHtml = `<span class="res-badge good">✓ Упомянуты · #${an.position || 1}</span>`;
        } else {
          cardCls = 'miss';
          badgeHtml = `<span class="res-badge bad">✕ Не упомянуты</span>`;
        }
      }

      const qs = saved.quickStatus || '';
      const quickButtonsHtml = isBrand ? `
        <div class="quick-verdict-row">
          <span class="hint">Быстро (1 тап):</span>
          <button type="button" class="qv-btn ${qs === 'brand_ok' ? 'active-good' : ''}" data-qv="${esc(p.id)}" data-val="brand_ok">✓ Знает хорошо</button>
          <button type="button" class="qv-btn ${qs === 'brand_vacuum' ? 'active-warn' : ''}" data-qv="${esc(p.id)}" data-val="brand_vacuum">~ Мало данных</button>
          <button type="button" class="qv-btn ${qs === 'brand_bad' ? 'active-bad' : ''}" data-qv="${esc(p.id)}" data-val="brand_bad">⚠ Ошибся / негатив</button>
        </div>
      ` : `
        <div class="quick-verdict-row">
          <span class="hint">Быстро (1 тап):</span>
          <button type="button" class="qv-btn ${qs === 'top3' ? 'active-good' : ''}" data-qv="${esc(p.id)}" data-val="top3">✓ Мы в топ-3</button>
          <button type="button" class="qv-btn ${qs === 'low' ? 'active-warn' : ''}" data-qv="${esc(p.id)}" data-val="low">~ В конце списка</button>
          <button type="button" class="qv-btn ${qs === 'miss' ? 'active-bad' : ''}" data-qv="${esc(p.id)}" data-val="miss">✕ Нас нет</button>
        </div>
      `;

      const metaTags = [];
      if (an && an.competitors.length) metaTags.push(`<span class="mini-tag">Конкуренты: ${esc(an.competitors.slice(0, 4).join(', '))}</span>`);
      if (an && an.domains.length) metaTags.push(`<span class="mini-tag">Источники: ${esc(an.domains.slice(0, 4).join(', '))}</span>`);

      const hasText = !!(saved.responseText && saved.responseText.trim());

      return `
        <div class="prompt-card ${cardCls}" data-pid="${esc(p.id)}">
          <div class="prompt-top">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span class="intent-tag ${p.tier === 'pro' ? 'pro' : ''}">${p.tier === 'pro' ? 'PRO · ' : ''}#${idx + 1} · ${esc(p.intent)}</span>
              <strong style="font-size:14px;">${esc(p.title)}</strong>
            </div>
            ${badgeHtml}
          </div>

          <div class="prompt-q">${esc(p.text)}</div>

          <div class="ai-btn-row">
            <button type="button" class="ai-chip ru-main" data-launch-url="${esc(p.links.yandexAi)}" data-copy-q="${esc(p.text)}">Яндекс AI (Алиса) ↗</button>
            <button type="button" class="ai-chip ru-giga" data-launch-url="${esc(p.links.gigachat)}" data-copy-q="${esc(p.text)}">GigaChat ↗</button>
            <button type="button" class="ai-chip" data-launch-url="${esc(p.links.chatgpt)}" data-copy-q="${esc(p.text)}">ChatGPT <span class="vpn-badge">VPN</span> ↗</button>
            <button type="button" class="ai-chip" data-launch-url="${esc(p.links.perplexity)}" data-copy-q="${esc(p.text)}">Perplexity <span class="vpn-badge">VPN</span> ↗</button>
            <button type="button" class="ai-chip" data-launch-url="${esc(p.links.deepseek)}" data-copy-q="${esc(p.text)}">DeepSeek ↗</button>
            <button type="button" class="ai-chip" data-copy-only="${esc(p.text)}">Копировать</button>
          </div>

          ${quickButtonsHtml}

          <details class="paste-toggle" ${hasText ? 'open' : ''}>
            <summary>${hasText ? 'Разобранный ответ ИИ (нажмите, чтобы скрыть)' : '+ Вставить полный текст ответа ИИ (для авторазбора конкурентов и доменов)'}</summary>
            <div style="margin-top:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                <select class="btn-xs" data-model-for="${esc(p.id)}" style="padding:4px 8px;border:1px solid var(--line);border-radius:7px;background:#FFF;">
                  ${models.map(m => `<option value="${esc(m)}" ${saved.model === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
                </select>
                ${(hasText || qs) ? `<button type="button" class="btn btn-outline btn-xs" data-clear-resp="${esc(p.id)}">Сбросить</button>` : ''}
              </div>
              <div class="field">
                <textarea rows="3" data-resp-for="${esc(p.id)}" placeholder="Вставьте сюда ответ из Алисы, GigaChat, ChatGPT или Perplexity...">${esc(saved.responseText || '')}</textarea>
              </div>
            </div>
          </details>

          ${metaTags.length ? `<div class="prompt-meta">${metaTags.join('')}</div>` : ''}
        </div>
      `;
    }).join('');

    const toggleBtn = `
      <div class="btn-row" style="margin-top:10px;">
        <button type="button" class="btn btn-outline btn-sm" id="btn-toggle-more-prompts">
          ${state.showAllPrompts ? 'Свернуть до 5 базовых запросов' : '+ Показать ещё 5 PRO-запросов (открыто на тест)'}
        </button>
      </div>
    `;

    $('prompts-list').innerHTML = html + toggleBtn;

    $('prompts-list').querySelectorAll('[data-launch-url]').forEach(btn => {
      btn.addEventListener('click', () => {
        copyText(btn.getAttribute('data-copy-q'), 'Запрос скопирован — открываем нейросеть!');
        window.open(btn.getAttribute('data-launch-url'), '_blank', 'noopener');
      });
    });
    $('prompts-list').querySelectorAll('[data-copy-only]').forEach(btn => {
      btn.addEventListener('click', () => copyText(btn.getAttribute('data-copy-only'), 'Запрос скопирован!'));
    });

    // 1-тап быстрые вердикты
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
        pt.isDemo = false;
        saveState();
        renderAll();
      });
    });

    $('prompts-list').querySelectorAll('[data-resp-for]').forEach(ta => {
      ta.addEventListener('input', () => {
        const pid = ta.getAttribute('data-resp-for');
        const prev = pt.promptResults[pid] || { model: models[0], responseText: '', quickStatus: '' };
        pt.promptResults[pid] = { model: prev.model, responseText: ta.value, quickStatus: prev.quickStatus };
        pt.isDemo = false;
        saveState();
        renderDashboardOnly();
      });
      ta.addEventListener('blur', () => renderAll());
    });

    $('prompts-list').querySelectorAll('[data-model-for]').forEach(sel => {
      sel.addEventListener('change', () => {
        const pid = sel.getAttribute('data-model-for');
        const prev = pt.promptResults[pid] || { model: sel.value, responseText: '', quickStatus: '' };
        pt.promptResults[pid] = { model: sel.value, responseText: prev.responseText, quickStatus: prev.quickStatus };
        saveState();
        renderDashboardOnly();
      });
    });

    $('prompts-list').querySelectorAll('[data-clear-resp]').forEach(btn => {
      btn.addEventListener('click', () => {
        delete pt.promptResults[btn.getAttribute('data-clear-resp')];
        saveState();
        renderAll();
      });
    });

    $('btn-toggle-more-prompts').addEventListener('click', () => {
      state.showAllPrompts = !state.showAllPrompts;
      renderAll();
    });
  }

  function renderDashboardOnly() {
    const pt = getActivePoint();
    const safePt = Object.assign({}, pt, { name: pt.name || 'Моя компания' });
    const audit = NeiroEngine.runGeoAudit(safePt);

    $('demo-banner').classList.toggle('hidden', !pt.isDemo);
    renderPointsBar();

    $('res-title').textContent = safePt.name + (safePt.district ? ` · ${safePt.district}` : '');
    $('res-score').textContent = audit.totalScore;
    const stBadge = $('res-status');
    stBadge.textContent = audit.status.label;
    stBadge.className = 'status-badge ' + audit.status.code;
    $('res-summary').textContent = audit.status.summary;

    const arc = $('gauge-arc');
    arc.style.strokeDashoffset = (314.16 * (1 - audit.totalScore / 100)).toFixed(1);
    arc.style.stroke = audit.status.code === 'good' ? '#059669' : audit.status.code === 'mid' ? '#D97706' : '#DC2626';

    const l = audit.live;
    const brandText = l.brandCheckStatus === 'vacuum' ? 'Вакуум'
      : l.brandCheckStatus === 'positive' ? 'Знает (+)'
      : l.brandCheckStatus === 'negative' ? 'Негатив'
      : l.brandCheckStatus === 'neutral' ? 'Нейтрально'
      : 'Не проверен';

    $('res-kpis').innerHTML = `
      <div class="kpi-box accent"><span class="k">Видимость в запросах</span><span class="v">${l.mentionRate !== null ? l.mentionRate + '%' : '—'}</span></div>
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

    $('hallucination-slot').innerHTML = l.hallucinations.length
      ? `<div class="alert-box"><b>Обнаружены риски в ответах ИИ:</b><ul style="margin:6px 0 0;padding-left:18px;">${l.hallucinations.map(h => `<li><b>${esc(h.promptTitle)} (${esc(h.model)}):</b> ${esc(h.flag)}</li>`).join('')}</ul></div>`
      : '';

    $('comp-rank-list').innerHTML = l.topCompetitors.length
      ? l.topCompetitors.map((c, i) => `<div class="rank-row"><span><b>#${i + 1}</b> ${esc(c.name)}</span><span class="mono" style="font-weight:700;">${c.hits} упом.</span></div>`).join('')
      : `<p class="hint" style="margin-top:8px;">Вставьте хотя бы 1 полный ответ из Алисы или ChatGPT в Шаге 2 — здесь соберётся рейтинг конкурентов, которые обходят вас в ИИ.</p>`;

    $('domain-rank-list').innerHTML = l.topDomains.length
      ? l.topDomains.map(d => `
          <div class="rank-row">
            <div>
              <span class="mono" style="font-weight:700;">${esc(d.domain)}</span>
              <span class="hint" style="margin-left:6px;">(${d.hits} упом.)</span>
            </div>
            <span class="gap-pill ${d.present ? 'ok' : 'miss'}">${d.present ? '✓ Вы там есть' : '✕ Пробел — вас нет'}</span>
          </div>
        `).join('')
      : `<p class="hint" style="margin-top:8px;">После вставки ответов ИИ здесь появятся сайты, откуда нейросети берут ответы, и сразу подсветится, где вас ещё нет.</p>`;

    const filtered = state.findingFilter === 'all'
      ? audit.findings
      : audit.findings.filter(f => f.level === state.findingFilter);

    $('res-findings').innerHTML = filtered.length
      ? filtered.map(f => {
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
        }).join('')
      : `<p class="hint">В этой категории пунктов нет.</p>`;

    renderProArtifacts(safePt, audit);
  }

  function renderProArtifacts(pt, audit) {
    const activeReal = getActivePoint();
    const checked = new Set(activeReal.checkedSources || []);
    $('sources-checklist').innerHTML = audit.niche.sources.map(src => {
      const done = checked.has(src.name);
      const pCls = src.priority === 'Критично' ? 'crit' : src.priority === 'Важно' ? 'imp' : 'opt';
      return `
        <div class="src-item ${done ? 'done' : ''}">
          <label class="src-left" style="cursor:pointer;">
            <input type="checkbox" data-src-name="${esc(src.name)}" ${done ? 'checked' : ''}>
            <div>
              <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
                <strong style="font-size:14px;">${esc(src.name)}</strong>
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
        const set = new Set(activeReal.checkedSources || []);
        if (cb.checked) set.add(name);
        else set.delete(name);
        activeReal.checkedSources = Array.from(set);
        saveState();
        renderDashboardOnly();
      });
    });

    $('schema-code').textContent = NeiroEngine.generateSchemaJsonLd(pt);
    $('llms-code').textContent = NeiroEngine.generateLlmsTxt(pt);
    $('robots-code').textContent = NeiroEngine.generateRobotsSnippet();

    if (!customFaqByPoint[activeReal.id]) {
      customFaqByPoint[activeReal.id] = NeiroEngine.generateFaqItems(pt);
    }
    const faqItems = customFaqByPoint[activeReal.id];
    $('faq-editor').innerHTML = faqItems.map((it, i) => `
      <div style="border:1px solid var(--line);border-radius:10px;padding:11px;margin-bottom:8px;background:#F9FAFD;">
        <div class="field" style="margin-bottom:6px;">
          <label>Вопрос ${i + 1}</label>
          <input type="text" data-faq-q="${i}" value="${esc(it.q)}">
        </div>
        <div class="field">
          <label>Прямой ответ (подставьте ваши точные цифры/условия)</label>
          <textarea rows="2" data-faq-a="${i}">${esc(it.a)}</textarea>
        </div>
      </div>
    `).join('');
    $('faq-code').textContent = NeiroEngine.buildFaqCode(faqItems);

    $('faq-editor').querySelectorAll('[data-faq-q]').forEach(inp => {
      inp.addEventListener('input', () => {
        faqItems[Number(inp.getAttribute('data-faq-q'))].q = inp.value;
        $('faq-code').textContent = NeiroEngine.buildFaqCode(faqItems);
      });
    });
    $('faq-editor').querySelectorAll('[data-faq-a]').forEach(ta => {
      ta.addEventListener('input', () => {
        faqItems[Number(ta.getAttribute('data-faq-a'))].a = ta.value;
        $('faq-code').textContent = NeiroEngine.buildFaqCode(faqItems);
      });
    });

    $('semantics-list').innerHTML = audit.niche.semanticAnchors
      .map((a, idx) => `<div class="anchor-chip"><b>${idx + 1}.</b> ${esc(a)}</div>`)
      .join('');

    renderHistoryChart(activeReal);
  }

  function renderHistoryChart(pt) {
    const hist = pt.history || [];
    const wrap = $('history-chart-wrap');
    if (!hist.length) {
      wrap.innerHTML = `<p class="hint" style="padding:14px;background:#F9FAFD;border-radius:10px;border:1px solid var(--line);">Пока нет сохранённых замеров. Нажмите «Сохранить текущий замер», чтобы начать отслеживать рост видимости в ИИ.</p>`;
      return;
    }

    const W = 440, H = 160, padL = 34, padR = 16, padT = 18, padB = 28;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const step = hist.length > 1 ? innerW / (hist.length - 1) : 0;

    const ptX = (i) => hist.length === 1 ? padL + innerW / 2 : padL + i * step;
    const ptY = (val) => padT + innerH * (1 - Math.max(0, Math.min(100, val)) / 100);

    const lineReady = hist.map((h, i) => `${ptX(i).toFixed(1)},${ptY(h.readiness).toFixed(1)}`).join(' ');
    const lineMent = hist.map((h, i) => `${ptX(i).toFixed(1)},${ptY(h.mentionRate).toFixed(1)}`).join(' ');

    wrap.innerHTML = `
      <svg class="history-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Динамика видимости в ИИ">
        <line x1="${padL}" y1="${ptY(0)}" x2="${W - padR}" y2="${ptY(0)}" stroke="#CBD5E1" stroke-width="1"/>
        <line x1="${padL}" y1="${ptY(50)}" x2="${W - padR}" y2="${ptY(50)}" stroke="#E2E8F0" stroke-dasharray="3 3"/>
        <line x1="${padL}" y1="${ptY(100)}" x2="${W - padR}" y2="${ptY(100)}" stroke="#E2E8F0" stroke-dasharray="3 3"/>
        <text x="6" y="${ptY(100) + 4}" font-size="10" fill="#64748B" font-family="monospace">100</text>
        <text x="11" y="${ptY(50) + 4}" font-size="10" fill="#64748B" font-family="monospace">50</text>
        <text x="18" y="${ptY(0) + 4}" font-size="10" fill="#64748B" font-family="monospace">0</text>
        ${hist.length > 1 ? `<polyline fill="none" stroke="#94A3B8" stroke-width="2" stroke-dasharray="4 3" points="${lineReady}"/>` : ''}
        ${hist.length > 1 ? `<polyline fill="none" stroke="#4F46E5" stroke-width="2.5" points="${lineMent}"/>` : ''}
        ${hist.map((h, i) => `
          <circle cx="${ptX(i)}" cy="${ptY(h.readiness)}" r="4" fill="#94A3B8"/>
          <circle cx="${ptX(i)}" cy="${ptY(h.mentionRate)}" r="5" fill="#4F46E5"/>
          <text x="${ptX(i)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="#475569" font-family="monospace">${esc(h.date)}</text>
        `).join('')}
      </svg>
      <div class="hint" style="margin-top:6px;">
        <span style="color:#4F46E5;font-weight:700;">● Видимость в ответах ИИ (%)</span> &nbsp;·&nbsp;
        <span style="color:#64748B;font-weight:700;">● Индекс готовности (/100)</span>
      </div>
    `;
  }

  function renderAll() {
    const pt = getActivePoint();
    const safePt = Object.assign({}, pt, { name: pt.name || 'Моя компания' });
    const audit = NeiroEngine.runGeoAudit(safePt);
    renderPrompts(pt, audit);
    renderDashboardOnly();
  }

  function saveSnapshotToday() {
    const pt = getActivePoint();
    const audit = NeiroEngine.runGeoAudit(Object.assign({}, pt, { name: pt.name || 'Моя компания' }));
    const now = new Date();
    const d = String(now.getDate()).padStart(2, '0') + '.' + String(now.getMonth() + 1).padStart(2, '0');
    pt.history = pt.history || [];
    pt.history.push({
      date: d,
      mentionRate: audit.live.mentionRate !== null ? audit.live.mentionRate : 0,
      readiness: audit.readinessScore
    });
    if (pt.history.length > 12) pt.history = pt.history.slice(-12);
    saveState();
    renderHistoryChart(pt);
    showToast(`Замер за ${d} сохранён в историю!`);
  }

  function bindEvents() {
    $('btn-start-own').addEventListener('click', startOwnBlankPoint);
    $('btn-clear-demo').addEventListener('click', startOwnBlankPoint);

    $('geo-form').addEventListener('input', () => { syncPointFromForm(); renderAll(); });
    $('geo-form').addEventListener('change', () => { syncPointFromForm(); renderAll(); });
    $('geo-form').addEventListener('submit', (e) => {
      e.preventDefault();
      syncPointFromForm();
      renderAll();
      $('prompts-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast('Запросы обновлены — проверьте 3–5 штук в Алисе или GigaChat');
    });

    $('btn-run-api-all').addEventListener('click', async () => {
      const apiKey = $('api-key').value.trim();
      const endpoint = $('api-endpoint').value.trim();
      const model = $('api-model').value;
      const statusEl = $('api-status');
      if (!apiKey && endpoint.includes('openrouter.ai')) {
        showToast('Вставьте OpenRouter API Key или используйте кнопки без ключа ниже');
        return;
      }
      try { if (apiKey) localStorage.setItem(API_KEY_STORAGE, apiKey); } catch (_) {}

      const pt = getActivePoint();
      const safePt = Object.assign({}, pt, { name: pt.name || 'Моя компания' });
      const prompts = NeiroEngine.buildPromptMatrix(safePt).slice(0, 5);
      const btn = $('btn-run-api-all');
      btn.disabled = true;

      for (let i = 0; i < prompts.length; i++) {
        statusEl.textContent = `Проверяем запрос ${i + 1} из ${prompts.length} (${model})...`;
        try {
          const answer = await NeiroEngine.runLiveApiPrompt({
            apiKey,
            endpoint,
            model,
            promptText: prompts[i].text
          });
          pt.promptResults[prompts[i].id] = { model, responseText: answer, quickStatus: '' };
          pt.isDemo = false;
          saveState();
          renderAll();
        } catch (err) {
          statusEl.textContent = `Ошибка на запросе #${i + 1}: ${err.message}`;
          btn.disabled = false;
          return;
        }
      }
      statusEl.textContent = `✓ Готово! Проверено ${prompts.length} запросов через ${model}.`;
      btn.disabled = false;
      showToast('Автопроверка ИИ завершена!');
    });

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

    $('paywall-toggle').addEventListener('change', (e) => {
      $('pro-body').classList.toggle('paywall-locked', e.target.checked);
    });
    $('btn-unlock-test').addEventListener('click', () => {
      $('paywall-toggle').checked = false;
      $('pro-body').classList.remove('paywall-locked');
      showToast('PRO GEO-доступ открыт бесплатно на тест');
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

    $('btn-save-snapshot').addEventListener('click', saveSnapshotToday);
    $('btn-save-snapshot-2').addEventListener('click', saveSnapshotToday);
    $('btn-clear-history').addEventListener('click', () => {
      getActivePoint().history = [];
      saveState();
      renderHistoryChart(getActivePoint());
      showToast('История замеров очищена');
    });

    $('btn-share-report').addEventListener('click', () => {
      const pt = Object.assign({}, getActivePoint());
      delete pt.id;
      const base = window.location.origin + window.location.pathname;
      copyText(`${base}#share=${NeiroEngine.encodePayload(pt)}`, 'Ссылка на GEO-отчёт скопирована!');
    });
    $('btn-print-report').addEventListener('click', () => window.print());

    // Feedback decision block
    $('fb-choices').querySelectorAll('[data-fb]').forEach(btn => {
      btn.addEventListener('click', () => {
        $('fb-choices').querySelectorAll('[data-fb]').forEach(b => b.classList.remove('picked'));
        btn.classList.add('picked');
        state.selectedFeedback = btn.getAttribute('data-fb');
      });
    });
    $('btn-copy-feedback').addEventListener('click', () => {
      const pt = Object.assign({}, getActivePoint(), { name: getActivePoint().name || 'Моя компания' });
      const a = NeiroEngine.runGeoAudit(pt);
      const verdict = state.selectedFeedback || 'Протестировал НейроЧек';
      const comment = ($('fb-comment').value || '').trim();
      const msg = `Тест НейроЧек (${pt.name}, GEO ${a.totalScore}/100): ${verdict}${comment ? ' | Комментарий: ' + comment : ''}`;
      copyText(msg, 'Вердикт скопирован — вставьте в Telegram!');
    });
  }

  initStaticControls();
  populateFormFromPoint(getActivePoint());
  bindEvents();
  renderAll();
})();
