// Runs in the page's MAIN world so it can reuse the site's current module.
// The extension only requests the chapter currently open in this reader tab.
(() => {
  const channel = '__wm_chapter_codec_v2';
  let handlers;
  async function getHandlers() {
    if (!handlers) handlers = (async () => {
      let url;
      for (let attempt = 0; attempt < 50 && !url; attempt++) {
        url = performance.getEntriesByType('resource').map(entry => entry.name).find(name => {
          try {
            const candidate = new URL(name, location.href);
            return candidate.origin === location.origin && /\/secure-[^/]+\.js$/.test(candidate.pathname);
          } catch { return false; }
        });
        if (!url) await new Promise(resolve => setTimeout(resolve, 300));
      }
      if (!url) throw new Error('modulul de decodare al site-ului nu este disponibil');
      // Importing an already-loaded module reuses its existing module instance.
      const module = await import(url);
      let sign, decode;
      if (typeof module.r !== 'function') throw new Error('interfata modulului site-ului s-a schimbat');
      module.r({ interceptors: {
        request: { use(fn) { sign = fn; } },
        response: { use(fn) { decode = fn; } },
      } });
      if (!sign || !decode) throw new Error('nu pot initializa decodarea pentru acest site');
      return { sign, decode };
    })().catch(error => { handlers = null; throw error; });
    return handlers;
  }
  async function loadChapter(id) {
    const { sign, decode } = await getHandlers();
    const config = await sign({ url: `/api/v1/chapters/${id}`, method: 'get', params: {} });
    const url = new URL(config.url, location.origin);
    if (url.origin !== location.origin || url.pathname !== `/api/v1/chapters/${id}`) {
      throw new Error('cale API neasteptata');
    }
    for (const [key, value] of Object.entries(config.params || {})) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url.href, {
        credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await decode({
        headers: { 'x-enc': response.headers.get('x-enc') }, data: await response.json(),
      });
      return result.data;
    } finally { clearTimeout(timer); }
  }
  window.addEventListener('message', async event => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin ||
        message?.channel !== channel || message.action !== 'load' ||
        typeof message.requestId !== 'string' || message.requestId.length > 100 ||
        !/^\d+$/.test(message.chapterId)) return;
    const current = location.pathname.match(/^\/title\/[^/]+\/(\d+)(?:-|\/|$)/)?.[1];
    if (message.chapterId !== current) return;
    try {
      const data = await loadChapter(message.chapterId);
      window.postMessage({ channel, action: 'result', requestId: message.requestId, data }, location.origin);
    } catch (error) {
      window.postMessage({ channel, action: 'result', requestId: message.requestId, error: error.message }, location.origin);
    }
  });
})();
