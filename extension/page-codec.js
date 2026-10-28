// Runs in MAIN world and reuses the site's already-loaded signing/decoding handlers.
// Only the chapter currently open in this reader may be requested.
(() => {
  const channel = '__wm_chapter_codec_v2';
  let handlers;
  function currentChapter() {
    return location.pathname.match(/^\/title\/[^/]+\/(\d+)(?:-|\/|$)/)?.[1];
  }
  function assertCurrent(id) {
    if (currentChapter() !== id) throw new Error('capitolul deschis s-a schimbat; reia operatia');
  }
  function destination(config, id) {
    if (String(config.method || 'get').toLowerCase() !== 'get') throw new Error('metoda API neasteptata');
    const target = config.baseURL && !/^(?:[a-z][\w+.-]*:)?\/\//i.test(config.url)
      ? String(config.baseURL).replace(/\/+$/, '') + '/' + String(config.url).replace(/^\/+/, '')
      : config.url;
    const url = new URL(target, location.origin);
    if (url.origin !== location.origin || url.username || url.password || url.pathname !== `/api/v1/chapters/${id}`) {
      throw new Error('cale API neasteptata');
    }
    return url;
  }
  function loadedModules() {
    return [...new Set(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => {
      try {
        const url = new URL(name, location.href);
        return url.origin === location.origin && /\/(?:secure|apicore)-[^/]+\.js$/.test(url.pathname);
      } catch { return false; }
    }))];
  }
  function modernHandlers(module, id) {
    // Current apicore exports Axios plus the read-only chapter detail service.
    const values = Object.values(module);
    const libraries = values.filter(value => typeof value === 'function' &&
      typeof value.Axios === 'function' && typeof value.AxiosHeaders?.from === 'function');
    const services = values.filter(value => value && typeof value === 'object' &&
      typeof value.zQ === 'function' && typeof value.Ig === 'function');
    if (libraries.length !== 1 || services.length !== 1) return null;
    const library = libraries[0], proto = library.Axios.prototype;
    // The bound public request() synchronously delegates to this dispatcher.
    const dispatch = Function.prototype.toString.call(proto.request).match(/\bthis\.([\w$]+)\(/)?.[1];
    const descriptor = dispatch && Object.getOwnPropertyDescriptor(proto, dispatch);
    if (!descriptor || typeof descriptor.value !== 'function' || ['request', 'constructor'].includes(dispatch)) return null;
    let client, request;
    const capture = new Error('wm capture: no network request');
    try {
      // No await inside this block: no other task runs while the dispatcher is replaced.
      // The probe stops BEFORE request interceptors, adapters, or network activity.
      Object.defineProperty(proto, dispatch, { ...descriptor, value(config) {
        client = this; request = config; throw capture;
      } });
      Promise.resolve(services[0].zQ(id)).catch(() => {});
    } finally {
      Object.defineProperty(proto, dispatch, descriptor);
    }
    if (!client || !request) throw new Error('nu pot identifica sincron clientul API al site-ului');
    destination({ ...request, baseURL: request.baseURL ?? client.defaults?.baseURL }, id);
    const requests = client.interceptors?.request?.handlers?.filter(Boolean);
    const responses = client.interceptors?.response?.handlers?.filter(Boolean);
    if (!requests?.length || !responses?.length ||
        requests.some(h => typeof h.fulfilled !== 'function') || responses.some(h => typeof h.fulfilled !== 'function')) return null;
    return {
      async sign(input) {
        let config = { ...input, url: input.url.replace(/^\/api\/v1/, ''),
          baseURL: client.defaults.baseURL,
          headers: library.AxiosHeaders.from({ ...client.defaults.headers?.common,
            ...client.defaults.headers?.get, Accept: 'application/json' }) };
        // Axios applies request interceptors newest first and response interceptors oldest first.
        for (const handler of [...requests].reverse()) {
          if (!handler.runWhen || handler.runWhen(config) !== false) config = await handler.fulfilled(config);
        }
        return config;
      },
      async decode(input) {
        let response = input;
        for (const handler of responses) response = await handler.fulfilled(response);
        return response;
      },
    };
  }
  async function getHandlers(id) {
    if (!handlers) handlers = (async () => {
      let urls = [];
      for (let attempt = 0; attempt < 50 && !urls.length; attempt++) {
        urls = loadedModules();
        if (!urls.length) await new Promise(resolve => setTimeout(resolve, 300));
      }
      if (!urls.length) throw new Error('modulul de decodare al site-ului nu este disponibil');
      // Prefer current apicore; retain the older secure installer without probing arbitrary functions.
      urls.sort((a,b) => Number(!new URL(a).pathname.includes('/apicore-')) - Number(!new URL(b).pathname.includes('/apicore-')));
      for (const url of urls) {
        const module = await import(url);
        if (new URL(url).pathname.includes('/apicore-')) {
          const current = modernHandlers(module, id);
          if (current) return current;
        } else if (typeof module.r === 'function') {
          let sign, decode;
          module.r({ interceptors: {
            request: { use(fn) { sign = fn; } },
            response: { use(fn) { decode = fn; } },
          } });
          if (sign && decode) return { sign, decode };
        }
      }
      throw new Error('interfata modulului site-ului s-a schimbat');
    })().catch(error => { handlers = null; throw error; });
    return handlers;
  }
  async function loadChapter(id) {
    const { sign, decode } = await getHandlers(id);
    assertCurrent(id);
    const config = await sign({ url: `/api/v1/chapters/${id}`, method: 'get', params: {} });
    const url = destination(config, id);
    for (const [key, value] of Object.entries(config.params || {})) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      assertCurrent(id);
      const headers = typeof config.headers?.toJSON === 'function' ? config.headers.toJSON() : config.headers;
      const response = await fetch(url.href, {
        credentials: 'same-origin', headers: { ...headers, Accept: 'application/json' }, signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const responseHeaders = Object.fromEntries(response.headers.entries?.() || []);
      responseHeaders['x-enc'] = response.headers.get('x-enc');
      const result = await decode({ config, status: response.status,
        headers: responseHeaders, data: await response.json(),
      });
      assertCurrent(id);
      return result.data;
    } finally { clearTimeout(timer); }
  }
  window.addEventListener('message', async event => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin ||
        message?.channel !== channel || message.action !== 'load' ||
        typeof message.requestId !== 'string' || message.requestId.length > 100 ||
        !/^\d+$/.test(message.chapterId)) return;
    if (message.chapterId !== currentChapter()) return;
    try {
      const data = await loadChapter(message.chapterId);
      window.postMessage({ channel, action: 'result', requestId: message.requestId, data }, location.origin);
    } catch (error) {
      window.postMessage({ channel, action: 'result', requestId: message.requestId, error: error.message }, location.origin);
    }
  });
})();
