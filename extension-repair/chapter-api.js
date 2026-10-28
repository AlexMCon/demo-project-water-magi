// Codec recovered from secure-tm8ho8-BG12c_J_.js. Browser APIs only.
// Loaded before content.js in the extension's isolated content-script world.
(() => {
  const constants = [
    {
      initial: 189,
      table: 'gbicCvAMzfcXEtGAyjvvhmb2yCWzWhjqcxXZ7ZhpzANOzoQLo3nuPZ2vK9dkb9hJExC0Vni/hdQBceI+mw611gkhQFjBuf4bJg1TxYqM+SL4YDqtwjxiGSdeH7so7Fn1HiRo37Z+RNvl44twXWVhomtMjw+8bemfmv9XEXr7mS82MxaCOJZRR0oHd9PLI5O+gyBGT6hcLoduNa7yCObVVCk3bFWsoD+xcqTrBcP6dNJN/NB1Br2QGhSN2snHAqeRNKVFQiyeAFLPSKGwY8aq9EPgsi17qd4ywPMxiH8w6N1qX1tLKtzhOeemHWeJQfFQ5H23q7qSlJUcjgTEl3x2/Q==',
      key: 'rafYl4oSAKQX+GYoic9oW4iGwiYpZzs0',
    },
    {
      initial: 133,
      table: '2lQehmgyYFAoWUi0haazZqHy5zZ34NN+VzlfsoB2Y1yY0IuMLjgVcV2xt8t4moH+AP0NMJ5qekW7DFIHEWKkOgIBIMhDdA8lbM6iHKjDlq6IChpb3CnA9NmsvQW/afdt1SfJjTdwcvpKqunCJLxBFmXX9hecm6tGb+HRxD7BC3njoxPxgnX5pdKP1IMSkd4/O3NRfZSE6DVLG2s9uexaipA05cpJzE8Qkv/z5jzHAwlEWOLd3yxA+0cvVbpOoJPFGc8f1lb4vu2HUxjuuEwEQk0GsPCVnyKvfOoh9TG2YYmZLV4I67UU2NsrrakqZ47k/O+ne25/DjPGZCMdnZcmzQ==',
      key: '2USAq+VTo5ht4bQn+K9DUcpUQRTtrB56',
    },
    {
      initial: 32,
      table: '+mhJSFwzaV+PQPDyKp2scO/S9SdFsy/7e56UWT8XHbK3E2+19nEPwfwOgE9uVCaDtOAWTobCZX+cBCXlIbBqyDyQB1beKLspW6kGPhBCV9x0jf0KUeFhHjmlMf7qMFIB41PfDFprZ3bJiK4YxrZDv+K6dcwJmggVO8f5ktrXTM0cZL4fer0SpnkbvNajPbHxfuTz5lVEBarOI4rdc+2V6zTsjpfQYjgN1MMr6EvA6eehN6dQ1bgUogt9rZOBbQBeNnLYY00uZqSoJBnFi5gthCJsWF33ykosn9v/9KB8udMCz0YRYImrA4VHr5mMgpH4xDXLeEHRd5vZOiAalofuMg==',
      key: 'yNHlokVEnuecesDrB/lDhVuUNiheWc3a47VtkwZ2ENg=',
    },
  ];
  const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  let stages;
  function getStages() {
    if (!stages) stages = constants.map(({ initial, table, key }) => {
      const forward = fromBase64(table), inverse = new Uint8Array(256);
      if (forward.length !== 256 || new Set(forward).size !== 256) throw new Error('tabel de decodare invalid');
      forward.forEach((value, index) => { inverse[value] = index; });
      return { initial, forward, inverse, key: fromBase64(key) };
    });
    return stages;
  }
  function transform(input, stage, decode) {
    const output = new Uint8Array(input.length);
    let previous = stage.initial;
    for (let i = 0; i < input.length; i++) {
      output[i] = decode
        ? stage.inverse[input[i]] ^ stage.key[i % stage.key.length] ^ previous
        : stage.forward[input[i] ^ stage.key[i % stage.key.length] ^ previous];
      previous = decode ? input[i] : output[i];
    }
    return output;
  }
  function encode(text) {
    let bytes = new TextEncoder().encode(text);
    for (const stage of getStages()) bytes = transform(bytes, stage, false);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(encoded) {
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) {
      throw new Error('raspuns criptat invalid');
    }
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4);
    let bytes = fromBase64(padded);
    for (const stage of [...getStages()].reverse()) bytes = transform(bytes, stage, true);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  function unpack(response) {
    const decoded = response && Object.hasOwn(response, 'e') ? JSON.parse(decode(response.e)) : response;
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('raspuns capitol invalid');
    if (Object.hasOwn(decoded, 'status') && decoded.status !== 'ok') throw new Error('API-ul nu a returnat un capitol valid');
    const chapter = Object.hasOwn(decoded, 'result') ? decoded.result : decoded;
    if (!chapter || !Array.isArray(chapter.pages?.items) || !chapter.pages.items.length) {
      throw new Error('raspunsul capitolului nu contine pagini');
    }
    return chapter;
  }

  function chapterId(pageUrl) {
    return new URL(pageUrl).pathname.match(/^\/title\/[^/]+\/(\d+)(?:-|\/|$)/)?.[1] || null;
  }
  function requestUrl(pageUrl) {
    const id = chapterId(pageUrl);
    if (!id) return null;
    const url = new URL(`/api/v1/chapters/${id}`, pageUrl);
    // Fu/zu in the supplied bundle sign the path without the /api/v1 prefix.
    // This request has no other query parameters to serialize.
    url.searchParams.set('_', encode(`/chapters/${id}`));
    return url.href;
  }
  function pageUrls(chapter, pageUrl) {
    const prefix = chapter.pages.baseUrl || '';
    const base = prefix ? new URL(prefix.endsWith('/') ? prefix : prefix + '/', pageUrl).href : pageUrl;
    return chapter.pages.items.map((page, index) => {
      if (typeof page.url !== 'string' || !page.url.trim()) throw new Error(`URL lipsa la pagina ${index + 1}`);
      const url = new URL(page.url, base);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`URL invalid la pagina ${index + 1}`);
      return url.href;
    });
  }
  async function request(url, options, consume) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await consume(response);
    } finally { clearTimeout(timer); }
  }
  async function loadChapter(pageUrl) {
    const id = chapterId(pageUrl);
    if (!id) return null;
    const hostname = new URL(pageUrl).hostname;
    const response = hostname === 'comix.to' || hostname.endsWith('.comix.to')
      ? await loadFromPage(id)
      : await request(requestUrl(pageUrl), { credentials: 'same-origin', headers: { Accept: 'application/json' } }, r => r.json());
    const chapter = unpack(response);
    if (String(chapter.id) !== chapterId(pageUrl)) throw new Error('API-ul a returnat alt capitol');
    return { chapter, urls: pageUrls(chapter, pageUrl) };
  }

  function loadFromPage(id) {
    return new Promise((resolve, reject) => {
      const channel = '__wm_repair_codec_v1';
      const requestId = crypto.randomUUID();
      const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); };
      const receive = event => {
        const message = event.data;
        if (event.source !== window || event.origin !== location.origin || message?.channel !== channel ||
            message.action !== 'result' || message.requestId !== requestId) return;
        cleanup();
        if (message.error) reject(new Error(message.error));
        else resolve(message.data);
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error('site-ul nu a raspuns la cererea capitolului')); }, 35000);
      window.addEventListener('message', receive);
      window.postMessage({ channel, action: 'load', requestId, chapterId: id }, location.origin);
    });
  }

  function imageExtension(bytes) {
    const b = new Uint8Array(bytes);
    const text = (start, end) => String.fromCharCode(...b.subarray(start, end));
    if (b.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return '.webp';
    if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return '.jpg';
    if (b.length >= 8 && b[0] === 137 && text(1, 4) === 'PNG' && text(4, 8) === '\r\n\x1a\n') return '.png';
    if (b.length >= 6 && ['GIF87a', 'GIF89a'].includes(text(0, 6))) return '.gif';
    if (b.length >= 12 && text(4, 8) === 'ftyp' && ['avif', 'avis'].includes(text(8, 12))) return '.avif';
    throw new Error('raspunsul imaginii nu este un format recunoscut');
  }
  async function loadImage(url) {
    const bytes = await request(url, { mode: 'cors', cache: 'reload', referrerPolicy: 'no-referrer' }, r => r.arrayBuffer());
    return { bytes, extension: imageExtension(bytes) };
  }

  globalThis.__wmChapterApi = Object.freeze({ decode, encode, unpack, chapterId, requestUrl, pageUrls, loadChapter, loadImage });
})();
