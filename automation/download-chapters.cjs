// Sequential Chrome-extension runner. Output and profiles stay under output/.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const args = process.argv.slice(2);
let url = args[0] || 'https://comix.to/title/emenr-tokyo-ghoulre/10044830-chapter-1';
const until = Number(args[1] || 10);
const work = path.resolve(args[2] || 'output/sequential-download');
if (new URL(url).hostname !== 'comix.to' || !Number.isFinite(until)) throw Error('Invalid URL or chapter limit');
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(work, { recursive: true });
// Resume at the highest contiguous verified integer chapter without browsing all older chapters.
if (new URL(url).pathname.endsWith('/10044830-chapter-1')) {
  for (let n = 1; n <= until; n++) {
    const reportFile = path.join(work, 'chapters', String(n), 'verification.json');
    if (!fs.existsSync(reportFile)) break;
    const report = JSON.parse(fs.readFileSync(reportFile));
    if (!report.allImagesDecoded || report.files.length !== report.expectedPages ||
        !report.files.every(f => {
          const target = path.join(work, 'chapters', String(n), f.name);
          return fs.existsSync(target) && createHash('sha256').update(fs.readFileSync(target)).digest('hex') === f.sha256;
        })) break;
    if (new URL(report.url).origin !== new URL(url).origin) throw Error('Unexpected saved origin');
    url = report.url;
  }
}

(async () => {
  const context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
    channel: 'chromium', executablePath: process.env.WM_BROWSER_PATH || undefined,
    headless: process.env.WM_HEADFUL !== '1',
    args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`],
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    page.on('popup', p => p.close().catch(()=>{}));
    page.on('pageerror', e => console.log('Reader warning: '+e.message.slice(0,200)));
    page.setDefaultTimeout(15000);
    let blocked;
    page.on('response', r => { if ([403, 429].includes(r.status()) && /\/api\/v1\/chapters\/|\/hi\//.test(r.url())) blocked = `HTTP ${r.status()}`; });
    const cdp = await context.newCDPSession(page), worlds = new Map();
    cdp.on('Runtime.executionContextCreated', e => worlds.set(e.context.id, e.context));
    cdp.on('Runtime.executionContextsCleared', () => worlds.clear());
    cdp.on('Runtime.executionContextDestroyed', e => worlds.delete(e.executionContextId));
    await cdp.send('Runtime.enable');
    async function isolated(code) {
      for (const [id, w] of worlds) {
        if (w.auxData?.isDefault) continue;
        let probe;
        try { probe = await cdp.send('Runtime.evaluate', { expression: 'typeof __wmChapterApi', contextId: id, returnByValue: true }); } catch { continue; }
        if (probe.result.value !== 'object') continue;
        const r = await cdp.send('Runtime.evaluate', { expression: code, contextId: id, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      }
      throw Error('Extension context missing');
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const seen = new Set();
    while (true) {
      try { await page.waitForSelector('#__wm_start', { timeout: process.env.WM_HEADFUL === '1' ? 15 * 60 * 1000 : 60000 }); }
      catch(error) {
        fs.writeFileSync(path.join(work,'reader-error.json'),JSON.stringify(await page.evaluate(()=>({url:location.href,title:document.title,text:document.body?.innerText.slice(0,5000)})),null,2));
        await page.screenshot({path:path.join(work,'reader-error.png')});throw error;
      }
      await sleep(5000);
      const cap = await page.locator('.rpage-floatctl__chap').innerText();
      const number = cap.match(/Ch\.?\s*([\d.]+)/)?.[1];
      if (!number || seen.has(number)) throw Error('Missing or repeated chapter: ' + cap);
      if (Number(number) > until) break;
      seen.add(number);
      const output = path.join(work, 'chapters', number);
      const reportPath = path.join(output, 'verification.json');
      let complete = false;
      if (fs.existsSync(reportPath)) {
        const report = JSON.parse(fs.readFileSync(reportPath));
        complete = report.url === page.url() && report.files.length === report.expectedPages && report.files.every(f => {
          const p = path.join(output, f.name);
          return fs.existsSync(p) && createHash('sha256').update(fs.readFileSync(p)).digest('hex') === f.sha256;
        });
      }
      if (!complete) {
        console.log(`Downloading chapter ${number}, including fractional chapters; 3 seconds between extension image requests.`);
        await isolated(`(async()=>{
          const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('wm-sequential',{create:true});
          await root.removeEntry(${JSON.stringify(number)},{recursive:true}).catch(e=>{if(e.name!=='NotFoundError')throw e});
          globalThis.showDirectoryPicker=async()=>root;
          if(!globalThis.__wmSlowInstalled){
            const original=__wmChapterApi;
            globalThis.__wmChapterApi={...original,
              loadChapter:async u=>{const result=await original.loadChapter(u);globalThis.__wmCaptured=result.chapter;return result},
              loadImage:async u=>{await new Promise(r=>setTimeout(r,3000));return original.loadImage(u)}
            };globalThis.__wmSlowInstalled=true;
          }
        })()`);
        for (const [selector, value] of [['#__wm_de', number], ['#__wm_pana', number], ['#__wm_doar', ''], ['#__wm_ign', '']]) await page.locator(selector).fill(value);
        await page.locator('#__wm_jum').uncheck();
        await page.locator('#__wm_start').click();
        const deadline = Date.now() + 45 * 60 * 1000;
        let lastProgress = '', lastProgressAt = 0;
        while (await page.locator('#__wm_start').isDisabled()) {
          if (blocked) throw Error(blocked + ': stopped without retry');
          if (Date.now() > deadline) throw Error('Chapter download timed out');
          if (Date.now() - lastProgressAt > 15000) {
            const progress = (await page.locator('#__wm_log').innerText()).trim().split('\n').at(-1);
            if (progress !== lastProgress) { console.log(`Chapter ${number}: ${progress}`); lastProgress = progress; }
            lastProgressAt = Date.now();
          }
          await sleep(2000);
        }
        const log = await page.locator('#__wm_log').innerText();
        if (!log.includes(`gata. reusite: ${number}`) || /esuate:|eroare:/.test(log)) throw Error(log);
        const chapter = await isolated('globalThis.__wmCaptured');
        if (!chapter || Number(chapter.number) !== Number(number)) throw Error('Captured chapter mismatch');
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, 'chapter.json'), JSON.stringify(chapter, null, 2));
        fs.writeFileSync(path.join(output, 'download-log.txt'), log);
        const names = await page.evaluate(async cap => {
          const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('wm-sequential')).getDirectoryHandle(cap);
          const names=[];for await(const [name,h] of dir.entries())if(h.kind==='file')names.push(name);return names.sort();
        }, number);
        if (names.length !== chapter.pages.items.length) throw Error('Page count mismatch');
        const files = [];
        for (let i=0;i<names.length;i++) {
          const name=names[i];
          if (!new RegExp(`^${String(i+1).padStart(3,'0')}\\.(webp|png|jpg|gif|avif)$`).test(name)) throw Error('Page order mismatch');
          const item=await page.evaluate(async ({cap,name})=>{
            const dir=await (await (await navigator.storage.getDirectory()).getDirectoryHandle('wm-sequential')).getDirectoryHandle(cap);
            const blob=await (await dir.getFileHandle(name)).getFile();
            const bitmap=await createImageBitmap(blob);const width=bitmap.width,height=bitmap.height;bitmap.close();
            const bytes=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));
            return {base64:btoa(s),width,height};
          },{cap:number,name});
          const expected=chapter.pages.items[i];
          if(item.width!==expected.width||item.height!==expected.height)throw Error('Image dimensions mismatch: '+name);
          const bytes=Buffer.from(item.base64,'base64'),sha256=createHash('sha256').update(bytes).digest('hex');
          fs.writeFileSync(path.join(output,name),bytes);
          files.push({name,bytes:bytes.length,width:item.width,height:item.height,sha256});
        }
        if(new Set(files.map(f=>f.sha256)).size!==files.length)throw Error('Duplicate images in chapter');
        fs.writeFileSync(reportPath,JSON.stringify({verifiedAt:new Date().toISOString(),url:page.url(),chapterId:chapter.id,number,expectedPages:chapter.pages.items.length,allImagesDecoded:true,allDimensionsMatch:true,files},null,2));
        console.log(`Verified chapter ${number}: ${files.length} images.`);
      } else console.log(`Chapter ${number}: verified files already present, skipping download.`);
      if(Number(number)>=until)break;
      const next=page.locator('button[aria-label="Next chapter"]');
      if(!await next.count()||await next.isDisabled())break;
      console.log('Pausing 30 seconds before next chapter.');
      await sleep(30000);
      const previous=page.url();await next.evaluate(button=>button.click());
      try {
        await page.waitForFunction(old=>location.href!==old,previous,{timeout:60000});
      } catch (error) {
        const diagnostic = await page.evaluate(()=>({url:location.href,chapter:document.querySelector('.rpage-floatctl__chap')?.textContent,next:document.querySelector('button[aria-label="Next chapter"]')?.outerHTML,text:document.body.innerText.slice(-4000)}));
        fs.writeFileSync(path.join(work,'navigation-error.json'),JSON.stringify(diagnostic,null,2));
        await page.screenshot({path:path.join(work,'navigation-error.png')});
        throw error;
      }
      await page.waitForFunction(old=>document.querySelector('.rpage-floatctl__chap')?.textContent.match(/Ch\.?\s*([\d.]+)/)?.[1]!==old,number,{timeout:60000});
    }
    console.log('Finished. Verified chapters: '+[...seen].join(', '));
  } finally { await context.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
