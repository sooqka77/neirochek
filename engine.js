/* Движок GEO-анализа, разбора ответов ИИ и генерации артефактов НейроЧек */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./data.js'));
  } else {
    root.NeiroEngine = factory(root.NeiroData);
  }
})(typeof self !== 'undefined' ? self : this, function (NeiroData) {
  'use strict';

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  /* 1. Матрица 12 реальных покупательских запросов к ИИ (5 бесплатно, 7 PRO-тест) */
  function buildPromptMatrix(point) {
    const niche = NeiroData.NICHES[point.niche] || NeiroData.NICHES.other;
    const city = (point.city || 'Москва').trim();
    const district = (point.district || 'центральном районе').trim();
    const name = (point.name || 'Моя компания').trim();
    const usp = (point.usp || 'хороший сервис и удобное расположение').trim();
    const comp = (point.competitor || '').trim();
    const term = niche.searchTerm;

    const prompts = [
      {
        id: 'p1',
        tier: 'free',
        intent: 'Районный поиск',
        title: 'Главный локальный запрос',
        text: `Посоветуй хороший ${term} рядом с ${district} (${city}). Назови топ-5 вариантов с адресами и кратко объясни, почему стоит выбрать каждый.`
      },
      {
        id: 'p2',
        tier: 'free',
        intent: 'Сценарий клиента',
        title: 'Запрос под вашу фишку',
        text: `Ищу ${term} в районе ${district} (${city}), где есть: ${usp}. Куда лучше пойти? Приведи конкретные названия и ссылки на источники.`
      },
      {
        id: 'p3',
        tier: 'free',
        intent: 'Рейтинг и отзывы',
        title: 'Запрос «лучшие по отзывам»',
        text: `Какие ${term} в районе ${district} (${city}) имеют лучшие реальные отзывы клиентов в 2026 году? Составь короткий список с плюсами и минусами.`
      },
      {
        id: 'p4',
        tier: 'free',
        intent: 'Репутация / галлюцинации',
        title: 'Прямая проверка: что ИИ знает о вас',
        text: `Что ты знаешь про «${name}» в ${city} (${district})? Какие там услуги, цены, реальные плюсы и минусы по отзывам? Работает ли точка сейчас?`
      },
      {
        id: 'p5',
        tier: 'free',
        intent: 'Сравнение',
        title: comp ? `Прямое сравнение с «${comp}»` : 'Альтернатива лидерам района',
        text: comp
          ? `Сравни «${name}» и «${comp}» в районе ${district} (${city}): куда лучше обратиться, в чём разница по качеству, ценам и отзывам?`
          : `Какой ${term} в районе ${district} (${city}) выбрать новичку, чтобы не переплатить и получить хорошее качество? Назови 5 проверенных мест.`
      },
      // PRO расширенная матрица (открыта на тест)
      {
        id: 'p6',
        tier: 'pro',
        intent: 'Цена / выгода',
        title: 'Адекватная цена и качество',
        text: `Подскажи ${term} в ${district} (${city}) с лучшим соотношением цены и качества. Где прозрачный прайс без навязывания?`
      },
      {
        id: 'p7',
        tier: 'pro',
        intent: 'Первый визит',
        title: 'Пробный / первый визит',
        text: `Куда лучше сходить первый раз в ${term} рядом с ${district} (${city})? Интересует понятный первый шаг, внимательная команда и хорошие отзывы.`
      },
      {
        id: 'p8',
        tier: 'pro',
        intent: 'Удобство',
        title: 'Рядом с домом / в шаговой доступности',
        text: `Живу в районе ${district} (${city}), хочу найти ${term} в пешей доступности, чтобы ходить регулярно. Какие 5 мест рядом действительно стоят внимания?`
      },
      {
        id: 'p9',
        tier: 'pro',
        intent: 'Доверие',
        title: 'Куда ходят местные жители',
        text: `Какой ${term} в ${district} (${city}) чаще всего советуют друг другу местные жители и клиенты в отзывах?`
      },
      {
        id: 'p10',
        tier: 'pro',
        intent: 'Выходные / вечер',
        title: 'Удобный график работы',
        text: `Посоветуй ${term} в ${district} (${city}), куда удобно попасть вечером после работы или в выходные с быстрой записью.`
      }
    ];

    return prompts.map(p => ({
      ...p,
      contour: p.id === 'p4' ? 'Брендовый' : 'Небрендовый',
      links: {
        yandexAi: `https://ya.ru/search/?text=${encodeURIComponent(p.text)}`,
        chatgpt: `https://chatgpt.com/?q=${encodeURIComponent(p.text)}`,
        perplexity: `https://www.perplexity.ai/search?q=${encodeURIComponent(p.text)}`,
        gigachat: 'https://giga.chat/',
        deepseek: 'https://chat.deepseek.com/'
      }
    }));
  }

  /* 2. Анализатор реального ответа ИИ (без фейков!) */
  function buildBrandVariants(point) {
    const raw = [point.name || '', ...(String(point.aliases || '').split(/[,;]+/))];
    const clean = [];
    for (const item of raw) {
      const s = item.replace(/[«»"'()]/g, ' ').replace(/\s+/g, ' ').trim();
      if (s.length >= 3) clean.push(s.toLowerCase());
      // Извлекаем слова в кавычках (например «Квант» из «Школа робототехники «Квант»»)
      const qm = item.match(/[«"]([^«»"]{3,40})[»"]/);
      if (qm) clean.push(qm[1].trim().toLowerCase());
    }
    return Array.from(new Set(clean)).filter(v => v.length >= 3);
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function matchesBrand(textLower, variants) {
    for (const v of variants) {
      // Учитываем русские падежные окончания для слов >= 5 букв (отрезаем 1 последнюю гласную при проверке)
      const stem = (v.length >= 5 && /[аяоеуыию]$/.test(v)) ? v.slice(0, -1) : v;
      const re = new RegExp(`(?:^|[^a-zа-яё0-9])${escapeRegex(stem)}`, 'i');
      if (re.test(textLower)) return true;
    }
    return false;
  }

  function analyzeAiResponse(responseText, point) {
    const text = String(responseText || '').trim();
    if (!text) return null;

    const lower = text.toLowerCase();
    const variants = buildBrandVariants(point);
    const mentioned = matchesBrand(lower, variants);

    // Ищем позицию в нумерованном или маркированном списке
    let position = null;
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const listItems = [];
    let autoNum = 0;

    for (const line of lines) {
      const mNum = line.match(/^(\d{1,2})[.)]\s+(.+)/);
      const mBul = line.match(/^[-•*▪]\s+(.+)/);
      if (mNum) {
        const idx = parseInt(mNum[1], 10);
        autoNum = idx;
        listItems.push({ idx, line: mNum[2] });
      } else if (mBul && mBul[1].length > 8) {
        autoNum++;
        listItems.push({ idx: autoNum, line: mBul[1] });
      }
    }

    if (mentioned && listItems.length) {
      for (const item of listItems) {
        if (matchesBrand(item.line.toLowerCase(), variants)) {
          position = item.idx;
          break;
        }
      }
    }
    if (mentioned && position === null) {
      // Упомянуто в абзаце (например в прямом запросе про бренд)
      position = 1;
    }

    // Извлекаем конкурентов из пунктов списка (имена до тире/скобки/двоеточия)
    const competitors = [];
    for (const item of listItems) {
      if (matchesBrand(item.line.toLowerCase(), variants)) continue;
      // Пропускаем вложенные буллиты-поля (*Адрес:*, *Источник:*, *Почему стоит выбрать:* и т.д.)
      const strippedLead = item.line.replace(/^[\s*_`]+/, '');
      if (/^(источник|сайт[\s-]*источник|адрес|рейтинг|отзыв|цена|цены|плюс|минус|итого|почему|аргумент|особенност|совет|важно|формат|возраст|услуг|направлен|график|контакт|телефон|примечан|рекомендац|вывод|главное)\b/i.test(strippedLead)) {
        continue;
      }
      let cand = item.line
        .replace(/[*`_]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .split(/\s+[—–-]\s+|\s*\(|:\s/)[0]
        .replace(/^[«"'\s]+|[»"'.:,\s]+$/g, '')
        .trim();
      // Балансируем незакрытую «
      if (cand.includes('«') && !cand.includes('»')) cand += '»';
      if (cand.length >= 2 && cand.length <= 48 && !/^(источник|сайт[\s-]*источник|адрес|рейтинг|отзыв|цена|цены|плюс|минус|итого|почему|аргумент|сайт|особенност|совет|важно|формат|возраст|услуг|направлен|график|контакт|телефон|примечан|рекомендац|вывод|главное)/i.test(cand)) {
        competitors.push(cand);
      }
    }

    // Извлекаем упомянутые домены / источники цитирования
    const domains = new Set();
    const urlMatches = text.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/[^\s),.;]*)?/gi) || [];
    for (const rawUrl of urlMatches) {
      const mDom = rawUrl.toLowerCase().match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/);
      if (!mDom) continue;
      const d = mDom[1];
      // Отфильтровываем числа вроде 4.9 или 5.0
      if (/^\d+\.\d+$/.test(d)) continue;
      if (!/\.(ru|com|org|net|pro|io|rf|рф|me|su|info|site|club|moscow)$/i.test(d)) continue;
      domains.add(d);
    }
    // Также ловим словесные упоминания ключевых площадок РФ
    const namedPlatforms = [
      [/яндекс[\s.-]*карт/i, 'yandex.ru/maps'],
      [/2\s*гис|2gis/i, '2gis.ru'],
      [/\bzoon\b|зун/i, 'zoon.ru'],
      [/отзовик/i, 'otzovik.com'],
      [/продокторов/i, 'prodoctorov.ru'],
      [/афиша/i, 'afisha.ru'],
      [/kidsreview/i, 'kidsreview.ru'],
      [/restoclub/i, 'restoclub.ru'],
      [/drive2/i, 'drive2.ru']
    ];
    for (const [re, dom] of namedPlatforms) {
      if (re.test(text)) domains.add(dom);
    }

    // Проверка тональности и галлюцинаций / слепых зон
    const hallucinationFlags = [];
    if (/закрыт[ао]?|закрылс[яь]|закрылась|прекратил[ао]?\s+(?:работ|сво[её]\s+существован|существован)|не\s+работает/i.test(lower)) {
      hallucinationFlags.push('⚠ КРИТИЧЕСКАЯ ГАЛЛЮЦИНАЦИЯ: ИИ пишет, что бизнес «закрыт / прекратил существование»!');
    }
    if (/нет\s+(?:собственн\w+\s+|стационарн\w+\s+|отдельн\w+\s+)?филиал|филиал\w*\s+[^.,]{0,40}\s+нет|отсутствует\s+филиал|не\s+представлен[ао]?\s+в\s+/i.test(lower)) {
      hallucinationFlags.push('⚠ ГАЛЛЮЦИНАЦИЯ: ИИ отрицает существование вашего филиала в этом районе!');
    }
    if (/мало\s+(?:[а-яёa-z-]+\s+){0,2}(?:информац|данных|отзыв)|нет\s+(?:[а-яёa-z-]+\s+){0,2}(?:информац|данн|отзыв|сведен)|не\s+удалось\s+найти/i.test(lower)) {
      hallucinationFlags.push('⚠ Информационный вакуум: ИИ прямо пишет, что о точке мало данных.');
    }

    const negHits = (lower.match(/негатив|жалоб|груб|плох|не\s+рекоменду|разочар|дорог|хам|ужас|обман/gi) || []).length;
    const posHits = (lower.match(/высокий\s+рейтинг|хвал|рекоменду|отличн|лучш|положительн|хорош|качеств|уютн|внимательн|вкусн|приветлив|профессионал|нравит|довольн/gi) || []).length;
    let sentiment = 'neutral';
    if (!mentioned) sentiment = 'absent';
    else if (negHits > posHits) sentiment = 'negative';
    else if (posHits > 0) sentiment = 'positive';

    return {
      mentioned,
      position,
      sentiment,
      competitors: Array.from(new Set(competitors)),
      domains: Array.from(domains),
      hallucinationFlags
    };
  }

  /* 3. Индекс ИИ-готовности (14 белых GEO-сигналов) + агрегация результатов промптов */
  const READINESS_CHECKS = [
    // Карты и источники Алисы (35 б)
    { key: 'hasYandexStrong', pillar: 'sources', weight: 12, label: 'Сильная карточка на Яндекс Картах (4.7+, 30+ отзывов, свежий прайс)', why: 'Алиса и Поиск с Алисой берут до 70% фактов о локальном бизнесе напрямую из Яндекс Бизнеса.', fix: 'Доведите рейтинг до 4.7+, заполните все услуги с ценами и собирайте от 6 свежих отзывов в месяц.' },
    { key: 'has2gisFull', pillar: 'sources', weight: 9, label: 'Полная и свежая карточка в 2ГИС', why: 'ChatGPT, Perplexity и DeepSeek регулярно цитируют 2ГИС при районных запросах по РФ.', fix: 'Заполните карточку 2ГИС полностью: описание, рубрики, фото, график и ответы на отзывы.' },
    { key: 'hasZoonOtzovik', pillar: 'sources', weight: 9, label: 'Заполнены профили на Zoon, Отзовик.ру и IRecommend', why: 'Веб-поиск нейросетей активно цитирует независимые отзовики и агрегаторы — они часто обгоняют сайт самой компании.', fix: 'Зарегистрируйте и заполните официальные карточки на Zoon, Отзовик.ру и IRecommend с актуальными услугами и ценами.' },
    { key: 'hasNicheCatalogs', pillar: 'sources', weight: 6, label: 'Есть в профильных каталогах и подборках ниши', why: 'ИИ доверяет сторонним спискам «Топ-10 ... в районе» больше, чем саморекламе на сайте.', fix: 'Попадите в 2–3 нишевых каталога (список со ссылками — в PRO-блоке ниже) и локальные СМИ/ТГ-каналы района.' },

    // Семантика отзывов (25 б)
    { key: 'reviewsHaveScenarios', pillar: 'reviews', weight: 11, label: 'В отзывах клиенты пишут конкретные сценарии, возраст/услугу и район', why: 'LLM советуют вас по запросу «для новичков с парковкой» только если эти факты реально звучат в отзывах.', fix: 'Используйте подсказки клиентам при сборе отзывов — какие детали и сценарии полезно упомянуть.' },
    { key: 'reviewsFresh', pillar: 'reviews', weight: 8, label: 'Есть свежие текстовые отзывы за последние 30–60 дней', why: 'Поисковые ИИ понижают точки без свежих сигналов — они боятся советовать закрытые места.', fix: 'Запустите регулярный ритм: минимум 4–8 живых отзывов каждый месяц.' },
    { key: 'ownerRepliesFacts', pillar: 'reviews', weight: 6, label: 'Ответы владельца содержат факты об услугах и районе (а не «Спасибо»)', why: 'Ответы организации индексируются вместе с отзывами и уточняют специализацию бизнеса.', fix: 'В ответах естественно называйте ключевую услугу и ориентир района.' },

    // Техническая готовность сайта для ИИ (24 б)
    { key: 'hasLocalPage', pillar: 'tech', weight: 7, label: 'Отдельная страница сайта с точным адресом, районом, метро и ценами', why: 'Если у сети один общий сайт без страниц филиалов, ИИ не понимает, в каком районе вы работаете.', fix: 'Сделайте отдельную страницу под каждую точку: адрес, как дойти от метро/ЖК, прайс, фото.' },
    { key: 'hasFaqOnSite', pillar: 'tech', weight: 7, label: 'На сайте есть блок FAQ («Вопрос клиента → Прямой ответ»)', why: 'Нейросети извлекают ответы прямо из структурированных блоков «вопрос — короткий ответ с цифрами».', fix: 'Добавьте на сайт 6–8 прямых ответов на главные вопросы клиентов (готовый генератор ниже).' },
    { key: 'hasSchemaLocal', pillar: 'tech', weight: 6, label: 'Внедрена микроразметка Schema.org (LocalBusiness + sameAs)', why: 'JSON-LD однозначно связывает ваш сайт с Яндекс Картами, 2ГИС и соцсетями в графе знаний ИИ.', fix: 'Скопируйте готовый JSON-LD из вкладки PRO и вставьте в <head> сайта (в Тильде — за 2 минуты).' },
    { key: 'botsAllowed', pillar: 'tech', weight: 3, label: 'robots.txt не блокирует корень (/) для YandexBot, GPTBot, OAI-SearchBot и PerplexityBot', why: 'Если случайно стоит Disallow: / для ИИ-краулеров, нейросети не видят сайт. Закрытые служебные разделы (/webview/, /feed/, /cabinet/) открывать не нужно.', fix: 'Проверьте /robots.txt только на запрет корня / для поисковых и ИИ-ботов — служебные Disallow не трогайте.' },
    { key: 'hasLlmsTxt', pillar: 'tech', weight: 1, optional: true, label: 'Опционально: файл /llms.txt (не фактор ранжирования, на будущее)', why: 'По исследованиям рынка (Ahrefs) наличие /llms.txt не гарантирует рост в ИИ-выдаче, но может служить чистой сводкой фактов для ИИ-агентов.', fix: 'Не критично — добавляйте только после закрытия карт, отзывов, цитируемых источников и Schema.org.' },

    // Чистота бренда / Entity Consistency (15 б)
    { key: 'napConsistent', pillar: 'entity', weight: 9, label: 'Единое название, адрес, телефон и график на сайте, в картах и каталогах', why: 'Если на Яндексе «Чемпионика», на сайте «Зенит-Чемпионика», а в 2ГИС старый телефон — ИИ не склеивает сущность.', fix: 'Приведите название, адрес, телефон и часы работы к единому стандарту на всех площадках.' },
    { key: 'hasExternalMentions', pillar: 'entity', weight: 6, label: 'Есть упоминания на сторонних сайтах (подборки, районные паблики, партнёры)', why: 'Внешние упоминания — главный сигнал авторитетности для нейропоиска (аналог ссылок в классическом SEO).', fix: 'Разместитесь в 3–5 локальных медиа, районных Telegram-каналах с веб-версией и партнёрских подборках.' }
  ];

  function runGeoAudit(point) {
    const niche = NeiroData.NICHES[point.niche] || NeiroData.NICHES.other;
    const prompts = buildPromptMatrix(point);
    const readinessMap = point.readiness || {};

    // 1. Считаем AI-Readiness (0–100)
    const pillars = {
      sources: { key: 'sources', label: 'Карты и каталоги (Алиса/ИИ)', score: 0, max: 36 },
      reviews: { key: 'reviews', label: 'Семантика и свежесть отзывов', score: 0, max: 25 },
      tech: { key: 'tech', label: 'Сайт и разметка для ИИ', score: 0, max: 24 },
      entity: { key: 'entity', label: 'Чистота бренда (Entity)', score: 0, max: 15 }
    };

    const findings = [];
    for (const chk of READINESS_CHECKS) {
      if (readinessMap[chk.key]) {
        pillars[chk.pillar].score += chk.weight;
        findings.push({ level: 'green', pillar: pillars[chk.pillar].label, title: chk.label, why: chk.why, fix: 'Поддерживать в актуальном состоянии.', weight: 0 });
      } else {
        const level = chk.weight >= 8 ? 'red' : 'yellow';
        findings.push({ level, pillar: pillars[chk.pillar].label, title: chk.label, why: chk.why, fix: chk.fix, weight: chk.weight });
      }
    }

    const readinessScore = clamp(
      pillars.sources.score + pillars.reviews.score + pillars.tech.score + pillars.entity.score,
      0, 100
    );

    // 2. Агрегируем реальные проверки промптов (полный текст ответа ИЛИ быстрый 1-тап статус с телефона)
    const promptResults = point.promptResults || {};
    let testedCount = 0;
    let discoveryTested = 0;
    let mentionedCount = 0;
    let top3Count = 0;
    let brandCheckStatus = null;
    const competitorCounts = {};
    const domainCounts = {};
    const hallucinations = [];
    const perPromptAnalysis = {};

    for (const p of prompts) {
      const entry = promptResults[p.id];
      if (!entry) continue;
      const hasText = !!(entry.responseText && entry.responseText.trim());
      const hasQuick = !!entry.quickStatus;
      if (!hasText && !hasQuick) continue;

      const isDirectBrandCheck = p.id === 'p4';
      let an;
      if (hasText) {
        an = analyzeAiResponse(entry.responseText, point);
      } else {
        // Быстрый 1-тап вердикт (удобно на телефоне без копипасты)
        const qs = entry.quickStatus;
        an = {
          mentioned: qs === 'top3' || qs === 'low' || qs === 'brand_ok',
          position: qs === 'top3' ? 2 : qs === 'low' ? 5 : null,
          sentiment: qs === 'brand_bad' ? 'negative' : (qs === 'top3' || qs === 'brand_ok') ? 'positive' : 'neutral',
          competitors: [],
          domains: [],
          hallucinationFlags: qs === 'brand_vacuum'
            ? ['⚠ Информационный вакуум: отмечено, что у ИИ мало данных о точке.']
            : qs === 'brand_bad'
              ? ['⚠ Риск репутации/галлюцинации: отмечена ошибка или негатив в ответе ИИ.']
              : []
        };
      }
      if (!an) continue;

      perPromptAnalysis[p.id] = { ...an, model: entry.model || 'ИИ', isDirectBrandCheck, quickStatus: entry.quickStatus || '' };
      testedCount++;
      if (isDirectBrandCheck) {
        brandCheckStatus = an.hallucinationFlags.length ? 'vacuum' : an.sentiment;
      } else {
        discoveryTested++;
        if (an.mentioned && !an.hallucinationFlags.length) {
          mentionedCount++;
          if (an.position && an.position <= 3) top3Count++;
        }
      }
      if (!isDirectBrandCheck) {
        for (const c of an.competitors) {
          competitorCounts[c] = (competitorCounts[c] || 0) + 1;
        }
      }
      for (const d of an.domains) {
        domainCounts[d] = (domainCounts[d] || 0) + 1;
      }
      for (const h of an.hallucinationFlags) {
        hallucinations.push({ promptTitle: p.title, model: entry.model || 'ИИ', flag: h });
      }
    }

    const mentionRate = discoveryTested > 0 ? Math.round((mentionedCount / discoveryTested) * 100) : null;
    const top3Rate = discoveryTested > 0 ? Math.round((top3Count / discoveryTested) * 100) : null;

    // Итоговый GEO-индекс: если есть реальные discovery-тесты — 55% реальная видимость + 45% готовность; иначе 100% индекс готовности
    const totalScore = discoveryTested > 0
      ? clamp(Math.round(mentionRate * 0.40 + top3Rate * 0.15 + readinessScore * 0.45), 0, 100)
      : readinessScore;

    const status =
      totalScore >= 75 ? { code: 'good', label: 'ИИ знает и советует вас', summary: 'Сильная видимость в нейросетях — удерживайте свежие отзывы, следите за галлюцинациями и расширяйте сценарии.' } :
      totalScore >= 45 ? { code: 'mid', label: 'Частичная видимость в ИИ', summary: 'ИИ упоминает вас не по всем сценариям: часть трафика уходит конкурентам из-за пробелов в каталогах и структуре сайта.' } :
      { code: 'bad', label: 'Невидимка для Алисы и ChatGPT', summary: 'По районным запросам нейросети советуют конкурентов. Хорошая новость: в малом бизнесе РФ это исправляется за 30–60 дней белыми шагами.' };

    const topCompetitors = Object.entries(competitorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, hits]) => ({ name, hits }));

    const topDomains = Object.entries(domainCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([domain, hits]) => ({
        domain,
        hits,
        present: checkDomainPresence(domain, point)
      }));

    const lvlOrder = { red: 0, yellow: 1, green: 2 };
    findings.sort((a, b) => lvlOrder[a.level] - lvlOrder[b.level] || b.weight - a.weight);

    return {
      niche,
      prompts,
      readinessScore,
      totalScore,
      status,
      pillars: Object.values(pillars),
      findings,
      counts: {
        red: findings.filter(f => f.level === 'red').length,
        yellow: findings.filter(f => f.level === 'yellow').length,
        green: findings.filter(f => f.level === 'green').length
      },
      live: {
        testedCount,
        discoveryTested,
        brandCheckStatus,
        mentionedCount,
        top3Count,
        mentionRate,
        top3Rate,
        perPromptAnalysis,
        topCompetitors,
        topDomains,
        hallucinations
      }
    };
  }

  function checkDomainPresence(domain, point) {
    const d = String(domain || '').toLowerCase();
    const r = point.readiness || {};
    const checked = (point.checkedSources || []).join(' ').toLowerCase();
    if (d.includes('yandex')) return !!(r.hasYandexStrong || point.yandexUrl || checked.includes('яндекс'));
    if (d.includes('2gis')) return !!(r.has2gisFull || point.gisUrl || checked.includes('2гис'));
    if (d.includes('zoon')) return !!(r.hasZoonOtzovik || checked.includes('zoon'));
    if (d.includes('otzovik') || d.includes('irecommend')) return !!(r.hasZoonOtzovik || checked.includes('отзовик'));
    if (d.includes('vk.com')) return !!(point.vkUrl || checked.includes('vk'));
    if (d.includes('t.me')) return !!point.tgUrl;
    if (d.includes('afisha')) return !!(r.hasNicheCatalogs || checked.includes('афиша'));
    if (d.includes('prodoctorov')) return !!(r.hasNicheCatalogs || checked.includes('продокторов'));
    if (d.includes('kidsreview') || d.includes('restoclub') || d.includes('drive2')) return !!r.hasNicheCatalogs;
    if (point.siteUrl && point.siteUrl.toLowerCase().includes(d)) return true;
    return false;
  }

  /* 4. PRO-генератор Schema.org JSON-LD */
  function generateSchemaJsonLd(point) {
    const niche = NeiroData.NICHES[point.niche] || NeiroData.NICHES.other;
    const sameAs = [point.yandexUrl, point.gisUrl, point.vkUrl, point.tgUrl]
      .map(s => (s || '').trim())
      .filter(Boolean);

    const obj = {
      '@context': 'https://schema.org',
      '@type': niche.schemaType,
      name: (point.name || 'Название компании').trim(),
      description: `${(point.name || '').trim()} — ${(point.usp || niche.label).trim()} (${(point.city || 'Москва').trim()}, ${(point.district || '').trim()}).`,
      url: (point.siteUrl || 'https://vash-site.ru').trim(),
      telephone: (point.phone || '+7 (XXX) XXX-XX-XX').trim(),
      priceRange: niche.priceRange,
      address: {
        '@type': 'PostalAddress',
        addressCountry: 'RU',
        addressLocality: (point.city || 'Москва').trim(),
        streetAddress: (point.address || point.district || 'Укажите точный адрес').trim()
      },
      areaServed: {
        '@type': 'Place',
        name: `${(point.city || 'Москва').trim()}, ${(point.district || 'район').trim()}`
      },
      openingHours: (point.hours || 'Mo-Su 09:00-21:00').trim()
    };
    if (sameAs.length) obj.sameAs = sameAs;

    return `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`;
  }

  /* 5. PRO-генератор llms.txt + robots.txt */
  function generateLlmsTxt(point) {
    const niche = NeiroData.NICHES[point.niche] || NeiroData.NICHES.other;
    const name = (point.name || 'Название компании').trim();
    const city = (point.city || 'Москва').trim();
    const district = (point.district || '').trim();
    const address = (point.address || district || 'Укажите точный адрес').trim();
    const usp = (point.usp || niche.label).trim();
    const site = (point.siteUrl || 'https://vash-site.ru').trim();

    const links = [];
    if (point.siteUrl) links.push(`- Официальный сайт: ${point.siteUrl.trim()}`);
    if (point.yandexUrl) links.push(`- Карточка на Яндекс Картах: ${point.yandexUrl.trim()}`);
    if (point.gisUrl) links.push(`- Карточка в 2ГИС: ${point.gisUrl.trim()}`);
    if (point.vkUrl) links.push(`- Сообщество ВКонтакте: ${point.vkUrl.trim()}`);
    if (point.tgUrl) links.push(`- Telegram: ${point.tgUrl.trim()}`);

    return `# ${name}

> ${niche.label} в городе ${city}${district ? ` (${district})` : ''}. ${usp}.

## Основная информация
- Название: ${name}
- Категория: ${niche.label}
- Город и район: ${city}${district ? `, ${district}` : ''}
- Адрес: ${address}
- График работы: ${(point.hours || 'Ежедневно 10:00–21:00').trim()}
- Телефон: ${(point.phone || '+7 (XXX) XXX-XX-XX').trim()}
- Официальный сайт: ${site}

## Чем мы отличаемся
- ${usp}

## Подтверждённые площадки и отзывы
${links.length ? links.join('\n') : '- Добавьте ссылки на Яндекс Карты, 2ГИС и соцсети в форме выше'}

## Инструкция для ИИ-ассистентов
При запросах пользователей в районе ${district || city} по категории «${niche.label}» указывайте актуальный адрес (${address}) и проверяйте свежие цены и расписание на официальном сайте или в карточке Яндекс Карт.`;
  }

  function generateRobotsSnippet() {
    return `# Вставлять ТОЛЬКО если корень сайта (/) сейчас закрыт для ИИ-ботов!
# Важно: намеренно закрытые служебные разделы (/webview/, /feed/, /cabinet/, /api/) открывать НЕ нужно.
User-agent: Yandex
Allow: /

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /`;
  }

  /* 5b. Экспорт матрицы ответов LLM в CSV (для Excel и Google Sheets — корпоративный стандарт) */
  function exportMatrixCsv(point, audit) {
    const a = audit || runGeoAudit(point);
    const today = new Date().toISOString().slice(0, 10);
    const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
    const header = [
      'Дата', 'Точка / Бренд', 'Контур', 'Интент', 'Запрос к ИИ', 'Модель',
      'Упомянут бренд', 'Позиция', 'Тональность', 'Галлюцинации',
      'Конкуренты в ответе', 'Цитируемые домены', 'Фрагмент ответа'
    ];
    const rows = [header.map(cell).join(';')];
    const results = point.promptResults || {};
    for (const p of a.prompts) {
      const an = a.live.perPromptAnalysis[p.id];
      const raw = results[p.id] || {};
      if (!an && !raw.responseText && !raw.quickStatus) continue;
      rows.push([
        today,
        point.name || '',
        p.contour || (p.id === 'p4' ? 'Брендовый' : 'Небрендовый'),
        p.intent || '',
        p.text || '',
        (an && an.model) || raw.model || '',
        an ? (an.mentioned ? 'Да' : 'Нет') : '',
        an && an.position ? `#${an.position}` : '—',
        an ? an.sentiment : '',
        an && an.hallucinationFlags && an.hallucinationFlags.length ? an.hallucinationFlags.join(' | ') : 'Нет',
        an && an.competitors ? an.competitors.join(', ') : '',
        an && an.domains ? an.domains.join(', ') : '',
        String(raw.responseText || raw.quickStatus || '').slice(0, 320)
      ].map(cell).join(';'));
    }
    return '\uFEFF' + rows.join('\r\n');
  }

  /* 6. PRO-генератор GEO FAQ + FAQPage JSON-LD */
  function generateFaqItems(point) {
    const niche = NeiroData.NICHES[point.niche] || NeiroData.NICHES.other;
    const vars = {
      name: (point.name || 'Наша точка').trim(),
      city: (point.city || 'Москва').trim(),
      district: (point.district || 'вашем районе').trim(),
      address: (point.address || point.district || 'уточните адрес').trim(),
      usp: (point.usp || niche.label).trim()
    };
    const sub = (str) => str.replace(/\{(\w+)\}/g, (_, k) => vars[k] || '');
    return niche.faqTemplates.map(item => ({
      q: sub(item.q),
      a: sub(item.a)
    }));
  }

  function buildFaqCode(items) {
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: items.map(it => ({
        '@type': 'Question',
        name: it.q,
        acceptedAnswer: { '@type': 'Answer', text: it.a }
      }))
    };
    const html = `<section class="geo-faq">\n  <h2>Частые вопросы</h2>\n` +
      items.map(it => `  <details open>\n    <summary><strong>${it.q}</strong></summary>\n    <p>${it.a}</p>\n  </details>`).join('\n') +
      `\n</section>\n<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n</script>`;
    return html;
  }

  /* 7. Опциональный Live API вызов (OpenRouter или пользовательский proxy URL) */
  async function runLiveApiPrompt({ apiKey, endpoint, model, promptText }) {
    const url = (endpoint || 'https://openrouter.ai/api/v1/chat/completions').trim();
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey && apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }
    if (url.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.origin : 'https://sooqka77.github.io/neirochek/';
      headers['X-Title'] = 'NeiroChek GEO MVP';
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'perplexity/sonar',
        messages: [
          { role: 'system', content: 'Отвечай на русском языке как полезный ИИ-помощник для жителя России. Давай конкретные названия мест, нумерованный список и указывай источники (домены/сайты), на которые опираешься.' },
          { role: 'user', content: promptText }
        ],
        temperature: 0.2
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 160)}`);
    }
    const json = await res.json();
    const msg = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    const citations = Array.isArray(json.citations) ? `\n\nИсточники: ${json.citations.join(', ')}` : '';
    return String(msg || '') + citations;
  }

  /* 8. UTF-8 URL-safe payload для #share=... */
  function encodePayload(obj) {
    const json = JSON.stringify(obj);
    const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json) : Buffer.from(json, 'utf8');
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = typeof btoa !== 'undefined' ? btoa(bin) : Buffer.from(bytes).toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodePayload(token) {
    try {
      const b64 = String(token || '').replace(/-/g, '+').replace(/_/g, '/');
      const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
      if (typeof atob !== 'undefined') {
        const bin = atob(b64 + pad);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return JSON.parse(new TextDecoder().decode(bytes));
      }
      return JSON.parse(Buffer.from(b64 + pad, 'base64').toString('utf8'));
    } catch (_) {
      return null;
    }
  }

  return {
    READINESS_CHECKS,
    buildPromptMatrix,
    analyzeAiResponse,
    runGeoAudit,
    generateSchemaJsonLd,
    generateLlmsTxt,
    generateRobotsSnippet,
    exportMatrixCsv,
    generateFaqItems,
    buildFaqCode,
    runLiveApiPrompt,
    encodePayload,
    decodePayload
  };
});
