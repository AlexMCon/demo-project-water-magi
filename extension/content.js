(() => {
  if (window.__wmInit) return; window.__wmInit = true;
  const somn = ms => new Promise(r => setTimeout(r, ms));
  const KEY = '__wm_cfg';
  const cfg = Object.assign({ de: '', pana: '', doar: '', sariJum: true, ignora: '' },
    JSON.parse(localStorage.getItem(KEY) || '{}'));
  const salveaza = () => localStorage.setItem(KEY, JSON.stringify(cfg));

  const capCurent = () => {
    const t = document.querySelector('.rpage-floatctl__chap');
    const m = t && t.textContent.trim().match(/Ch\.?\s*([\d.]+)/);
    return m ? m[1] : null;
  };

  // "29:31,32; 30:5"  ->  { '29': [31,32], '30': [5] }
  const parseIgnora = s => {
    const o = {};
    for (const p of s.split(';')) {
      const [c, pg] = p.split(':');
      if (c && pg) o[c.trim()] = pg.split(',').map(Number).filter(Boolean);
    }
    return o;
  };

  let logEl;
  const log = (m, err) => {
    (err ? console.error : console.log)(m);
    if (logEl) { logEl.textContent += m + '\n'; logEl.scrollTop = logEl.scrollHeight; }
  };

  async function descarca(cap, root, nativ, sari) {
    if (sari.size) log(`  sar peste paginile ${[...sari].join(', ')}`);
    const dir = await root.getDirectoryHandle(cap, { create: true });
    const containers = () => [...document.querySelectorAll('.rpage-page')];
    let total = containers().length;
    const date = new Map();

    // Read encrypted or plain chapter responses before resorting to rendered pages.
    let api;
    try {
      api = await __wmChapterApi.loadChapter(location.href);
      if (api && Number(api.chapter.number) !== Number(cap)) throw new Error('numarul capitolului nu corespunde paginii');
    } catch (e) {
      api = null;
      log(`  nu pot citi capitolul din API (${e.message}); folosesc pagina afisata`, true);
    }
    if (api) {
      total = api.urls.length;
      log(`  ${total} pagini din API`);
    }
    if (!api) {
      for (let t = 0; t < 50 && !total; t++) { await somn(300); total = containers().length; }
    }
    if (!total) throw new Error('nu am gasit pagini pentru acest capitol');
    const numere = Array.from({ length: total }, (_, i) => i + 1).filter(n => !sari.has(n));

    for (let pas = 0; pas < 3 && date.size < numere.length; pas++) {
      for (const n of numere) {
        if (date.has(n)) continue;
        const el = containers().find(page => Number(page.dataset.page) === n);
        if (el) {
          el.scrollIntoView({ block: 'center' });
          await somn(pas === 0 ? 700 : 1200);
        }

        // Canvas pages can contain a processed image; keep the rendered result.
        const cv = el?.querySelector('canvas.rpage-page__img');
        try {
          if (cv) {
            let a = nativ.call(cv, 'image/webp', 0.95);
            for (let t = 0; t < 12; t++) {
              await somn(400);
              const b = nativ.call(cv, 'image/webp', 0.95);
              if (a.length > 60000 && a.length === b.length) { a = b; break; }
              a = b;
            }
            if (a.length > 60000) { date.set(n, { tip: 'panza', val: a }); log(`  pagina ${n}: de pe panza`); }
            continue;
          }
          const img = el?.querySelector('img.rpage-page__img[src]');
          const url = api?.urls[n - 1] || (img?.src && /^https?:\/\//.test(img.src) ? img.src : null);
          if (!url) continue;
          const image = await __wmChapterApi.loadImage(url);
          date.set(n, { tip: 'bytes', val: image.bytes, ext: image.extension });
          log(`  pagina ${n}: descarcata`);
        } catch (e) { log(`  pagina ${n}: ${e.message}`, true); }
      }
      log(`  ${date.size}/${numere.length}`);
    }

    let panze = 0;
    const scrise = new Set();
    for (const n of numere) {
      if (!date.has(n)) continue;
      const r = date.get(n);
      let buf, ext = r.ext || '.webp';
      if (r.tip === 'panza') { buf = Uint8Array.from(atob(r.val.split(',')[1]), c => c.charCodeAt(0)); panze++; }
      else buf = r.val;
      const w = await (await dir.getFileHandle(String(n).padStart(3, '0') + ext, { create: true })).createWritable();
      await w.write(buf); await w.close();
      scrise.add(n);
    }
    const lipsa = numere.filter(n => !scrise.has(n));
    if (lipsa.length) log(`  lipsesc paginile ${lipsa.join(', ')}`, true);
    log(`  scris ${scrise.size}/${numere.length} pagini (${panze} de pe panza)`);
    return !lipsa.length;
  }

  async function ruleaza() {
    const doar = new Set(cfg.doar.split(',').map(s => s.trim()).filter(Boolean));
    let de = parseFloat(cfg.de), pana = parseFloat(cfg.pana);
    if (doar.size) {
      de = Math.min(...[...doar].map(parseFloat)); pana = Math.max(...[...doar].map(parseFloat));
      log(`doar capitolele: ${[...doar].join(', ')}`);
    }
    if (isNaN(de) || isNaN(pana)) { log('completeaza "de la" si "pana la" sau "doar cap."', true); return; }
    const IGNORA = parseIgnora(cfg.ignora);

    const vechi = document.getElementById('__pi'); if (vechi) vechi.remove();
    document.body.insertAdjacentHTML('beforeend',
      '<iframe id="__pi" style="position:fixed;left:-9999px;width:10px;height:10px"></iframe>');
    let nativ;
    try { nativ = document.getElementById('__pi').contentWindow.HTMLCanvasElement.prototype.toDataURL; } catch (e) {}
    if (!nativ) nativ = HTMLCanvasElement.prototype.toDataURL;

    const root = await showDirectoryPicker({ id: 'watermagician', startIn: 'downloads', mode: 'readwrite' });
    const facute = [], esuate = [], sarite = [];

    while (true) {
      for (let t = 0; t < 100 && !capCurent(); t++) await somn(300);
      await somn(1200);

      const cap = capCurent();
      if (!cap) throw new Error('nu pot citi numarul capitolului');
      const nr = parseFloat(cap);
      if (nr > pana) { log(`capitolul ${cap} e dupa ${pana}, ma opresc`); break; }

      const jum = nr % 1 !== 0;
      if (nr < de || (jum && cfg.sariJum) || (doar.size && !doar.has(cap))) {
        log(`=== sar capitolul ${cap} ===`); sarite.push(cap);
      } else {
        log(`=== capitol ${cap} ===`);
        (await descarca(cap, root, nativ, new Set(IGNORA[cap] || [])) ? facute : esuate).push(cap);
      }

      if (nr >= pana) break;
      const next = document.querySelector('button[aria-label="Next chapter"]');
      if (!next) { log('nu mai exista buton de Next'); break; }
      next.click();
      for (let t = 0; t < 200 && capCurent() === cap; t++) await somn(300);
      if (capCurent() === cap) { log('capitolul nu s-a schimbat, ma opresc', true); break; }
    }

    log(`gata. reusite: ${facute.join(', ') || '-'}`);
    if (sarite.length) log(`sarite: ${sarite.join(', ')}`);
    if (esuate.length) log(`esuate: ${esuate.join(', ')}`, true);
  }

  function panou() {
    const el = document.createElement('div');
    el.id = '__wm';
    el.innerHTML = `
<style>
#__wm{position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#111;color:#eee;font:12px/1.4 system-ui,sans-serif;padding:10px;border-radius:8px;width:230px;box-shadow:0 2px 12px #000a}
#__wm label{display:block;margin-bottom:6px}
#__wm input[type=number],#__wm input[type=text]{width:100%;box-sizing:border-box;background:#222;color:#eee;border:1px solid #444;border-radius:4px;padding:3px 5px;margin-top:2px}
#__wm button{width:100%;padding:6px;border:0;border-radius:4px;background:#2d7;color:#000;font-weight:bold;cursor:pointer}
#__wm button:disabled{background:#555;color:#aaa;cursor:default}
#__wm .log{margin-top:6px;max-height:110px;overflow:auto;white-space:pre-wrap;color:#9cf;font-family:monospace;font-size:11px}
</style>
<label>De la cap.<input type=number step=any id=__wm_de></label>
<label>Până la cap.<input type=number step=any id=__wm_pana></label>
<label>Doar cap. (ex: 11,13,18 — ignoră de la/până la)<input type=text id=__wm_doar></label>
<label><input type=checkbox id=__wm_jum> sari capitolele .5</label>
<label>Pagini de sărit (ex: 29:31,32; 30:5)<input type=text id=__wm_ign></label>
<button id=__wm_start>Start</button>
<div class=log id=__wm_log></div>`;
    document.body.appendChild(el);

    const $ = id => el.querySelector('#__wm_' + id);
    logEl = $('log');
    $('de').value = cfg.de; $('pana').value = cfg.pana;
    $('jum').checked = cfg.sariJum; $('ign').value = cfg.ignora; $('doar').value = cfg.doar;
    $('doar').oninput = e => { cfg.doar = e.target.value; salveaza(); };
    $('de').oninput   = e => { cfg.de = e.target.value; salveaza(); };
    $('pana').oninput = e => { cfg.pana = e.target.value; salveaza(); };
    $('jum').onchange = e => { cfg.sariJum = e.target.checked; salveaza(); };
    $('ign').oninput  = e => { cfg.ignora = e.target.value; salveaza(); };

    $('start').onclick = async () => {
      const b = $('start'); b.disabled = true; logEl.textContent = '';
      try { await ruleaza(); } catch (e) { log('eroare: ' + e.message, true); }
      b.disabled = false;
    };
  }

  const t = setInterval(() => {
    if (document.querySelector('.rpage-floatctl__chap')) { clearInterval(t); panou(); }
  }, 1000);
})();
