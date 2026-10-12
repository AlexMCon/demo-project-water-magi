const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(root, 'chapter-api.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const encrypted = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/chapter.encrypted.json'), 'utf8'));
const decoded = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/chapter.decoded.json'), 'utf8'));
const pageUrl = 'https://comix.example/title/emenr-tokyo-ghoulre/10044831-chapter-2';
const webp = Buffer.from('524946460c000000574542505650382000000000', 'hex');
const clean = value => JSON.parse(JSON.stringify(value));

function setup(fetch = async () => { throw new Error('unexpected fetch'); }, timers = {}) {
  const context = vm.createContext({
    atob, btoa, TextEncoder, TextDecoder, URL, AbortController,
    setTimeout, clearTimeout, ...timers, fetch,
  });
  vm.runInContext(apiSource, context);
  return { context, api: context.__wmChapterApi };
}
function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}
function imageResponse(bytes = webp) {
  return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
}

test('decrypts the supplied encrypted chapter and preserves all 22 page URLs', () => {
  const { api } = setup();
  assert.deepEqual(JSON.parse(api.decode(encrypted.e)), decoded);
  assert.deepEqual(clean(api.unpack(encrypted)), decoded.result);
  assert.equal(api.unpack(encrypted).pages.items.length, 22);
  // Known ciphertext independently produced by the original supplied codec.
  assert.equal(api.encode(JSON.stringify(decoded)), encrypted.e);
});

test('accepts plaintext status/result wrappers and already-unwrapped chapters', () => {
  const { api } = setup();
  assert.deepEqual(clean(api.unpack(decoded)), decoded.result);
  assert.deepEqual(clean(api.unpack(decoded.result)), decoded.result);
});

test('rejects malformed encryption, invalid JSON, unsuccessful or empty responses', () => {
  const { api } = setup();
  for (const e of [null, '', 'a', 'not base64!', '====']) {
    assert.throws(() => api.unpack({ e }), /invalid/);
  }
  assert.throws(() => api.unpack({e: api.encode('not JSON')}));
  assert.throws(() => api.unpack({status:'error',result:decoded.result}), /valid/);
  assert.throws(() => api.unpack({id:10044831,pages:{items:[]}}), /pagini/);
});

test('extracts chapter IDs and signs the normalized API path using the original codec vector', () => {
  const { api } = setup();
  const url = new URL(api.requestUrl(pageUrl + '?reader=1#page-2'));
  assert.equal(url.origin, 'https://comix.example');
  assert.equal(url.pathname, '/api/v1/chapters/10044831');
  assert.equal(url.searchParams.get('_'), 'IQ6wvJBq2kpghZR0oYZHfURu');
  assert.equal(url.searchParams.size, 1);
  assert.equal(api.requestUrl('https://comix.example/title/emenr-tokyo-ghoulre'), null);
  assert.equal(api.requestUrl('https://example.org/unrelated'), null);
});

test('fetches and decodes encrypted chapter JSON without depending on response headers', async () => {
  const calls = [];
  const { api } = setup(async (url, options) => {
    calls.push({url,options});
    return jsonResponse(encrypted);
  });
  const result = await api.loadChapter(pageUrl);
  assert.deepEqual(clean(result.chapter), decoded.result);
  assert.equal(result.urls[0], decoded.result.pages.items[0].url);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.headers.Accept, 'application/json');
  assert.equal(calls[0].options.signal.aborted, false);
  assert.equal(await api.loadChapter('https://example.org/unrelated'), null);
  assert.equal(calls.length, 1);
});

test('rejects HTTP failures, mismatched chapters, and non-JSON responses', async () => {
  const cases = [
    [jsonResponse({},403), /HTTP 403/],
    [jsonResponse({...decoded.result,id:123}), /alt capitol/],
    [{ok:true,status:200,json:async()=>{throw new SyntaxError('Unexpected HTML');}}, /HTML/],
  ];
  for (const [response,error] of cases) {
    const { api } = setup(async () => response);
    await assert.rejects(api.loadChapter(pageUrl), error);
  }
});

test('aborts a stalled request and clears its timeout', async () => {
  let abort, cleared = false;
  const { api } = setup((url, {signal}) => new Promise((resolve,reject) => {
    signal.addEventListener('abort', () => reject(new Error('request aborted')));
  }), {setTimeout: callback => {abort=callback;return 12;},clearTimeout:id=>{cleared=id===12;}});
  const pending = api.loadChapter(pageUrl);
  abort();
  await assert.rejects(pending, /aborted/);
  assert.equal(cleared, true);
});

test('resolves relative page URLs and rejects unsupported URL schemes', () => {
  const { api } = setup();
  const chapter = {pages:{baseUrl:'https://images.example/books/42',items:[
    {url:'001.webp'}, {url:'/002.png'}, {url:'https://cdn.example/003.jpg'},
  ]}};
  assert.deepEqual(clean(api.pageUrls(chapter,pageUrl)), [
    'https://images.example/books/42/001.webp','https://images.example/002.png','https://cdn.example/003.jpg',
  ]);
  for (const url of ['', 'data:text/html,no', 'javascript:alert(1)']) {
    assert.throws(() => api.pageUrls({pages:{items:[{url}]}},pageUrl), /URL/);
  }
});

test('downloads image bytes with their actual format and rejects HTML/error bodies', async () => {
  for (const [bytes,extension] of [
    [webp,'.webp'],[Buffer.from('ffd8ffe00001','hex'),'.jpg'],
    [Buffer.from('89504e470d0a1a0a','hex'),'.png'],[Buffer.from('GIF89a'),'.gif'],
  ]) {
    const { api } = setup(async (url,options) => {
      assert.equal(options.referrerPolicy,'no-referrer');
      return imageResponse(bytes);
    });
    const image = await api.loadImage('https://images.example/page');
    assert.equal(image.extension, extension);
    assert.deepEqual(Buffer.from(image.bytes),bytes);
  }
  const { api } = setup(async () => imageResponse(Buffer.from('<html>blocked</html>')));
  await assert.rejects(api.loadImage('https://images.example/page'), /format/);
});

// Exercise the production downloader through a small DOM/filesystem harness.
// Only expose its private entry point in the test copy; production has no test API.
function downloader(fetch, containers = []) {
  const logs = [], writes = new Map(), calls = [];
  const { context } = setup(async (url,options) => { calls.push(url); return fetch(url,options); });
  Object.assign(context, {
    location:{href:pageUrl},
    localStorage:{getItem:()=>null,setItem:()=>{}},
    document:{querySelectorAll:()=>containers,querySelector:()=>null},
    console:{log:m=>logs.push(m),error:m=>logs.push(m)},
    setTimeout:callback=>{queueMicrotask(callback);return 1;},clearTimeout:()=>{},
    setInterval:()=>1,clearInterval:()=>{},
  });
  context.window = context;
  const expose = contentSource.replace(/\}\)\(\);\s*$/, 'globalThis.__testDownload = descarca;})();');
  vm.runInContext(expose,context);
  const directory = {getDirectoryHandle:async chapter => ({
    getFileHandle:async name => ({createWritable:async()=>({
      write:async bytes=>writes.set(chapter+'/'+name,Buffer.from(bytes)),close:async()=>{},
    })}),
  })};
  return {
    run:skip=>context.__testDownload('2',directory,()=> 'data:image/webp;base64,'+'A'.repeat(64000),new Set(skip)),
    logs,writes,calls,
  };
}
function canvasPage(number) {
  const canvas = {};
  return {dataset:{page:String(number)},scrollIntoView:()=>{},querySelector:selector=>selector.startsWith('canvas')?canvas:null};
}

test('downloader uses encrypted API pages without rendered containers and honors skips', async () => {
  const app = downloader(async url => url.includes('/api/v1/') ? jsonResponse(encrypted) : imageResponse());
  assert.equal(await app.run([2,999]),true);
  assert.equal(app.writes.size,21);
  assert.equal(app.writes.has('2/002.webp'),false);
  assert.deepEqual(app.writes.get('2/001.webp'),webp);
  assert.equal(app.calls.includes(decoded.result.pages.items[1].url),false);
  assert.ok(app.logs.some(line=>line.includes('scris 21/21')));
});

test('a failed API image uses the rendered canvas while other API pages still download', async () => {
  const first = decoded.result.pages.items[0].url;
  let canvasChecks = 0;
  const delayedCanvas = {
    dataset:{page:'1'},scrollIntoView:()=>{},
    querySelector:selector=>selector.startsWith('canvas') && ++canvasChecks > 1 ? {} : null,
  };
  const app = downloader(async url => {
    if(url.includes('/api/v1/'))return jsonResponse(encrypted);
    if(url===first)throw new TypeError('CORS');
    return imageResponse();
  },[delayedCanvas]);
  assert.equal(await app.run([]),true);
  assert.equal(app.writes.size,22);
  assert.equal(app.writes.get('2/001.webp').length,48000);
  assert.ok(app.calls.includes(first));
  assert.ok(app.logs.some(line=>line.includes('1 de pe panza')));
});

test('prefers the final rendered canvas over a potentially processed API image', async () => {
  const app = downloader(async url => url.includes('/api/v1/') ? jsonResponse(encrypted) : imageResponse(),[canvasPage(1)]);
  assert.equal(await app.run([]),true);
  assert.equal(app.writes.size,22);
  assert.equal(app.writes.get('2/001.webp').length,48000);
  assert.equal(app.calls.includes(decoded.result.pages.items[0].url),false);
});

test('an unavailable API falls back to the existing canvas downloader', async () => {
  const app = downloader(async () => jsonResponse({},403),[canvasPage(1),canvasPage(2)]);
  assert.equal(await app.run([]),true);
  assert.equal(app.writes.size,2);
  assert.ok(app.logs.some(line=>line.includes('HTTP 403')));
});

test('DOM fallback downloads ordinary images on the current /hi/ CDN path', async () => {
  const imageUrl='https://images.example/hi/current-page';
  const rendered={dataset:{page:'1'},scrollIntoView:()=>{},querySelector:selector=>selector.startsWith('img')?{src:imageUrl}:null};
  const app=downloader(async url=>url.includes('/api/v1/')?jsonResponse({},403):imageResponse(),[rendered]);
  assert.equal(await app.run([]),true);
  assert.deepEqual(app.writes.get('2/001.webp'),webp);
  assert.ok(app.calls.includes(imageUrl));
});

test('an invalid encrypted response falls back and missing pages report failure', async () => {
  const app = downloader(async () => jsonResponse({e:'invalid!'}),[
    canvasPage(1),{dataset:{page:'2'},scrollIntoView:()=>{},querySelector:()=>null},
  ]);
  assert.equal(await app.run([]),false);
  assert.equal(app.writes.size,1);
  assert.ok(app.logs.some(line=>line.includes('lipsesc paginile 2')));
});
