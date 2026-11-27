/* Конфиг подключения к единому бэкенду geo-api (Timeweb Cloud Apps).
 * После деплоя sooqka77/geo-api просто впишите сюда ваш URL, например:
 *   backendUrl: 'https://sooqka77-geo-api-xxxx.twc1.net'
 * Также можно временно проверить любой URL, дописав в браузере ?api=https://...
 */
window.NEIRO_CONFIG = {
  backendUrl: 'https://sooqka77-geo-api-f2ca.twc1.net',
  metrikaId: null
};
(function () {
  try {
    var p = new URLSearchParams(window.location.search).get('api');
    if (p && /^https?:\/\//i.test(p)) {
      window.NEIRO_CONFIG.backendUrl = p.replace(/\/+$/, '');
      sessionStorage.setItem('neiro_api_override', window.NEIRO_CONFIG.backendUrl);
    } else if (!window.NEIRO_CONFIG.backendUrl) {
      var saved = sessionStorage.getItem('neiro_api_override');
      if (saved) window.NEIRO_CONFIG.backendUrl = saved;
    }
  } catch (_) {}
})();
