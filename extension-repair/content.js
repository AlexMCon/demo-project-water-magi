(() => {
  'use strict';
  if (globalThis.__wmRepairInit) return;
  globalThis.__wmRepairInit = true;
  const C = __wmRepairCore;
  const defaults = {
    from: '136', to: '170', delay: '3', chapterDelay: '5', preset: 'original',
    anchor: 'https://comix.to/title/0qrqn-as-a-reincarnated-aristocrat-ill-use-my-appraisal-skill-to-rise-in-the-world/7281875-chapter-170',
    plan: '136: 7\n141: 11, 13\n143: 11, 13, 14\n144: 14\n145: 6, 7, 16, 17\n149: 7, 12\n152: 9, 13, 17\n156: 1, 6, 8, 13\n157: 1, 14, 17\n158: 3, 11, 16\n161: 5\n162: 13, 17\n168: 3, 8\n177: 10, 11, 12\n178: 2, 7\n181: 16, 18\n183: *',
  };
  let config, panel, running = false, stop = false, root;
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const readNumber = () => document.querySelector('.rpage-floatctl__chap')?.textContent.match(/Ch\.?\s*([\d.]+)/)?.[1];
  const seriesPath = () => location.pathname.match(/^\/title\/([^/]+)\//)?.[1];
  const $ = key => panel.querySelector(`[data-key="${key}"]`);
  const log = text => { $('log').textContent += text+'\n'; $('log').scrollTop = $('log').scrollHeight; };
  function save() {
    for (const k of ['from','to','delay','chapterDelay','anchor','plan','preset']) config[k] = $(k).value;
    return chrome.storage.local.set({wmRepairConfig:config});
  }
  function checkStop() { if (stop) throw Error('Oprit la cererea ta. Planul rămas este păstrat.'); }
  async function pause(ms) {
    for (let left=ms;left>0;left-=200) { checkStop(); await sleep(Math.min(left,200)); }
  }
  async function chapterDir(cap, create=false) {
    try { return await root.getDirectoryHandle(cap,{create}); }
    catch(e) { if (!create && e.name==='NotFoundError') return null; throw e; }
  }
  async function namesIn(dir) {
    const names=[];
    if (dir) for await(const [name,h] of dir.entries()) if(h.kind==='file') names.push(name);
    return names;
  }
  async function write(dir, name, data) {
    const writer=await (await dir.getFileHandle(name,{create:true})).createWritable();
    try { await writer.write(data); await writer.close(); }
    catch(e) { await writer.abort().catch(()=>{});throw e; }
  }
  async function pageData(n, api, nativeCanvas) {
    let container=[...document.querySelectorAll('.rpage-page')].find(el=>Number(el.dataset.page)===n);
    if (container) { container.scrollIntoView({block:'center'}); await pause(900); }
    container=[...document.querySelectorAll('.rpage-page')].find(el=>Number(el.dataset.page)===n);
    const canvas=container?.querySelector('canvas.rpage-page__img');
    if (canvas) {
      // Keep the processed canvas. Repeated samples let lazy rendering settle.
      let previous='', stable=0;
      for(let i=0;i<30;i++) {
        checkStop();
        const value=nativeCanvas.call(canvas,'image/webp',0.95);
        stable=value===previous?stable+1:0; previous=value;
        if(i>=3&&stable>=3&&canvas.width>0&&canvas.height>0) {
          const bytes=Uint8Array.from(atob(value.split(',')[1]),c=>c.charCodeAt(0));
          return {bytes,extension:'.webp',method:'canvas'};
        }
        await pause(500);
      }
      throw Error(`Canvas instabil la pagina ${n}; nu salvez o captură incompletă`);
    }
    const image=await __wmChapterApi.loadImage(api.urls[n-1]);
    return {...image,method:'API image'};
  }
  async function verifyBlob(blob, expected, label) {
    const bitmap=await createImageBitmap(blob);
    try {
      if(expected.width!==bitmap.width||expected.height!==bitmap.height) throw Error(`${label}: dimensiuni ${bitmap.width}×${bitmap.height}, API ${expected.width}×${expected.height}`);
      return {width:bitmap.width,height:bitmap.height};
    } finally { bitmap.close(); }
  }
  async function navigate(direction, old, series) {
    checkStop();
    const label=direction<0?'Previous chapter':'Next chapter';
    const button=document.querySelector(`button[aria-label="${label}"]`);
    if(!button||button.disabled) throw Error(`Nu există ${label}; verificarea/planul nu este complet`);
    button.click();
    for(let i=0;i<200;i++) {
      await pause(300);
      const now=readNumber();
      if(now&&now!==old) {
        if(seriesPath()!==series) throw Error('Readerul a trecut la altă serie');
        if((Number(now)-Number(old))*direction<=0) throw Error('Navigare în direcție neașteptată');
        await pause(1200);
        return;
      }
    }
    throw Error(`Capitolul ${old} nu s-a schimbat. Reîncarcă pagina și reia planul rămas.`);
  }
  async function run(mode, selectedRoot) {
    await save(); root=selectedRoot; stop=false;
    const from=Number(config.from),to=Number(config.to);
    const imageDelay=Number(config.delay),chapterDelay=Number(config.chapterDelay);
    if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||from>to) throw Error('Interval invalid');
    if(!Number.isFinite(imageDelay)||imageDelay<1||imageDelay>300||!Number.isFinite(chapterDelay)||chapterDelay<1||chapterDelay>300) throw Error('Pauzele trebuie să fie între 1 și 300 secunde');
    const plan=C.parsePlan(config.plan), originallyPlanned=Object.keys(plan).filter(n=>Number(n)>=from&&Number(n)<=to);
    if(mode==='repair'&&!originallyPlanned.length) throw Error('Planul nu are capitole în intervalul selectat');
    const start=readNumber();
    if(!start||Number(start)<from||Number(start)>to) throw Error(`Deschide un capitol din intervalul ${from}–${to}, în sursa dorită`);
    const series=seriesPath();
    const audit={}, visited=new Set(), repaired=[];
    let source, sourceName, mangaId, direction;
    // Audit starts at an edge. Repairs require the pending targets on one side.
    if(mode==='audit'&&Number(start)!==from&&Number(start)!==to) throw Error(`Pentru verificarea întregului interval pornește de la ${from} sau ${to}`);
    if(mode==='audit') direction=Number(start)===to?-1:1;
    if(mode==='repair'&&originallyPlanned.some(n=>Number(n)<Number(start))&&originallyPlanned.some(n=>Number(n)>Number(start))) {
      throw Error(`Planul are ținte în ambele direcții. Pornește din capitolul ${from} sau ${to}, apoi reia.`);
    }
    const iframe=document.createElement('iframe');iframe.hidden=true;panel.appendChild(iframe);
    const nativeCanvas=iframe.contentWindow.HTMLCanvasElement.prototype.toDataURL;
    let finished = false;
    const reportName=`wm-${mode}-${from}-${to}.json`;
    const reportFolder=await root.getDirectoryHandle('_wm-repair',{create:true});
    async function checkpoint(complete=finished) {
      finished=complete;
      await write(reportFolder,reportName,JSON.stringify({updatedAt:new Date().toISOString(),series,mangaId,source,sourceName,range:[from,to],mode,complete,chapters:audit,repaired},null,2));
    }
    try {
      for(let steps=0;steps<1500;steps++) {
        checkStop();
        const cap=C.chapter(readNumber());
        if(Number(cap)<from||Number(cap)>to) throw Error(`Am ajuns la ${cap}, în afara intervalului; schimbă manual sursa dacă este necesar`);
        if(visited.has(cap)) throw Error('Readerul a revenit la un capitol deja parcurs; opresc');
        visited.add(cap);
        const api=await __wmChapterApi.loadChapter(location.href);
        if(!api||Number(api.chapter.number)!==Number(cap)) throw Error('API-ul nu corespunde capitolului afișat');
        const key=C.sourceKey(api.chapter);
        if(!source) {
          source=key;sourceName=api.chapter.group?.name||key;mangaId=api.chapter.mangaId;
          log(`Sursă blocată pentru acest rulaj: ${sourceName} (${key}). Interval ${from}–${to}.`);
        } else if(key!==source||api.chapter.mangaId!==mangaId||seriesPath()!==series) {
          throw Error(`Sursa s-a schimbat (${api.chapter.group?.name||key}). Opresc; alege manual sursa și reia.`);
        }
        const total=api.chapter.pages.items.length;
        const chapterURL=location.href;
        const assertCurrent=()=>{ checkStop();if(location.href!==chapterURL||Number(readNumber())!==Number(cap))throw Error('Ai schimbat capitolul în timpul operației. Reia din pagina dorită.'); };
        let dir=await chapterDir(cap),names=await namesIn(dir);
        const before=C.compareFiles(names,total);
        const entry={chapterId:api.chapter.id,url:location.href,source,sourceName,expectedPages:total,missing:before.missing,duplicates:before.duplicates,unexpected:before.unexpected,invalid:[]};
        audit[cap]=entry;
        log(`Cap. ${cap}: ${before.present}/${total} locale; lipsesc ${before.missing.join(', ')||'niciuna'}.`);
        if(mode==='audit') {
          // Decode existing local files too; this requires no image requests to the server.
          if(dir) for(const name of names.filter(n=>/^\d+\.(webp|png|jpe?g|avif|gif|bmp)$/i.test(n))) {
            checkStop();const n=Number(name.split('.')[0]);
            if(n<1||n>total) continue;
            try { await verifyBlob(await (await dir.getFileHandle(name)).getFile(),api.chapter.pages.items[n-1],name); }
            catch(e) { entry.invalid.push({page:n,name,error:e.message});log(`  ${e.message}`); }
          }
          // Union with the editable queue so another source's pending work is retained.
          if(before.missing.length) {
            if(plan[cap]!=='*') plan[cap]=[...new Set([...(plan[cap]||[]),...before.missing])].sort((a,b)=>a-b);
            $('plan').value=C.formatPlan(plan);await save();
          }
        } else if(Object.hasOwn(plan,cap)) {
          const requested=C.requestedPages(plan[cap],total);
          dir=await chapterDir(cap,true);
          let remaining=[...requested];
          for(const n of requested) {
            checkStop();
            const existing=names.filter(name=>Number(name.split('.')[0])===n&&/\.(webp|png|jpe?g|avif|gif|bmp)$/i.test(name));
            if(existing.length&&!$('overwrite').checked) {
              for(const name of existing) await verifyBlob(await (await dir.getFileHandle(name)).getFile(),api.chapter.pages.items[n-1],name);
              log(`  ${cap}/${n}: există și se decodează; păstrez.`);
            } else {
              if(existing.length) {
                // Replacing a selected file keeps its format/name; do not leave a stale alternative.
                const expectedExtension=existing[0].slice(existing[0].lastIndexOf('.')).replace('.jpeg','.jpg');
                log(`  ${cap}/${n}: înlocuire cerută explicit (${expectedExtension}).`);
              }
              await pause(imageDelay*1000);assertCurrent();
              const image=await pageData(n,api,nativeCanvas);
              const blob=new Blob([image.bytes]);
              const dimensions=await verifyBlob(blob,api.chapter.pages.items[n-1],`Pagina ${n}`);
              const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',image.bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
              const name=String(n).padStart(3,'0')+image.extension;
              if(existing.some(old=>old!==name)) throw Error(`Pagina ${n} are alt format local. Salvează recuperarea într-un folder separat sau rezolvă manual fișierul existent.`);
              assertCurrent();await write(dir,name,image.bytes);
              // Read back and decode the saved file before marking it complete.
              await verifyBlob(await (await dir.getFileHandle(name)).getFile(),api.chapter.pages.items[n-1],name);
              repaired.push({chapter:cap,page:n,name,...dimensions,sha256,method:image.method});
              if(!names.includes(name))names.push(name);
              log(`  ${cap}/${name}: salvată și verificată (${image.method}).`);
            }
            remaining=remaining.filter(p=>p!==n);
            if(remaining.length)plan[cap]=remaining;else delete plan[cap];
            $('plan').value=C.formatPlan(plan);await save();await checkpoint();
          }
          entry.missing=C.compareFiles(await namesIn(dir),total).missing;
          if(entry.missing.length) log(`  Mai lipsesc în acest capitol (în afara selecției): ${entry.missing.join(', ')}`);
        }
        await checkpoint();
        if(mode==='audit') {
          if(Number(cap)===(direction<0?from:to)) {
            const unseen=Array.from({length:Math.floor(to)-Math.ceil(from)+1},(_,i)=>String(Math.ceil(from)+i)).filter(n=>!visited.has(n));
            if(unseen.length) throw Error(`Verificare incompletă: readerul a sărit capitolele ${unseen.join(', ')}. Verifică-le separat.`);
            await checkpoint(true);log('Verificare completă. Planul include și lipsurile de la final; verifică lista înainte de Recuperare.');break;
          }
        } else {
          const pending=Object.keys(plan).filter(n=>Number(n)>=from&&Number(n)<=to).sort((a,b)=>Math.abs(Number(a)-Number(cap))-Math.abs(Number(b)-Number(cap)));
          if(!pending.length) { await checkpoint(true);log('Selecția din acest interval este recuperată. Schimbă manual sursa pentru următorul interval.');break; }
          direction=Number(pending[0])<Number(cap)?-1:1;
          if(pending.some(n=>visited.has(n))) throw Error('Au rămas ținte deja parcurse; reia de la un capitol potrivit din plan');
        }
        log(`Pauză ${chapterDelay}s înainte de capitolul ${direction<0?'precedent':'următor'}…`);
        await pause(chapterDelay*1000);
        await navigate(direction,cap,series);
        if(steps===1499)throw Error('Limită de navigare atinsă');
      }
    } finally { iframe.remove(); await checkpoint().catch(e=>log(`Nu pot salva raportul: ${e.message}`)); }
  }
  async function init() {
    config={...defaults,...(await chrome.storage.local.get('wmRepairConfig')).wmRepairConfig};
    panel=document.createElement('section');panel.id='__wm_repair';
    panel.innerHTML=`<style>
#__wm_repair{position:fixed;left:12px;bottom:12px;z-index:2147483647;width:330px;max-height:92vh;overflow:auto;background:#16202b;color:#f3f6fb;border:1px solid #6083a6;border-radius:10px;padding:12px;font:12px/1.4 system-ui;box-shadow:0 4px 24px #0008}
#__wm_repair h3{margin:0 0 8px}#__wm_repair label{display:block;margin:6px 0}#__wm_repair input:not([type=checkbox]),#__wm_repair textarea,#__wm_repair select{box-sizing:border-box;width:100%;color:#fff;background:#243244;border:1px solid #637e99;border-radius:4px;padding:5px}
#__wm_repair textarea{height:130px;font:12px monospace}#__wm_repair button{padding:7px;margin:4px 3px 0 0;cursor:pointer}#__wm_repair pre{white-space:pre-wrap;max-height:150px;overflow:auto;color:#bce0ff;margin:8px 0 0}#__wm_repair .row{display:flex;gap:8px}#__wm_repair .row label{flex:1;min-width:0}#__wm_repair summary{cursor:pointer}
</style><h3>Nori 47 · Recuperare pagini</h3>
<details open><summary>Plan și sursă</summary>
<label>Preset <select data-key="preset"><option value="original">Aristocrat · Original 136–170</option><option value="kmanga">Aristocrat · K-Manga 171–184</option><option value="custom">Personalizat</option></select></label>
<div class="row"><label>De la<input data-key="from" type="number" step="any"></label><label>Până la<input data-key="to" type="number" step="any"></label></div>
<label>Pagina de pornire a sursei<input data-key="anchor" type="url"></label><button data-key="open">Deschide sursa</button><button data-key="use">Folosește pagina curentă</button>
<label>Capitol: pagini (sau * pentru tot capitolul)<textarea data-key="plan" spellcheck="false"></textarea></label>
<div class="row"><label>Pauză imagine (s)<input data-key="delay" type="number" min="1" max="300"></label><label>Pauză capitol (s)<input data-key="chapterDelay" type="number" min="1" max="300"></label></div>
<label><input data-key="overwrite" type="checkbox"> Înlocuiește paginile selectate care există deja</label></details>
<p>Alege folderul seriei, cu subfolderele capitolelor. Sursa se blochează la începutul fiecărui rulaj. Pentru altă sursă: oprește, schimbă manual, apoi reia.</p>
<button data-key="audit">Verifică toate paginile</button><button data-key="repair">Recuperează selecția</button><button data-key="stop" disabled>Oprește</button>
<pre data-key="log" aria-live="polite"></pre>`;
    document.body.appendChild(panel);
    for(const key of ['from','to','delay','chapterDelay','anchor','plan','preset']) { $(key).value=config[key];$(key).addEventListener('change',()=>save().catch(e=>log(e.message))); }
    $('preset').addEventListener('change',()=>{
      if($('preset').value==='original') { $('from').value='136';$('to').value='170';$('anchor').value=defaults.anchor; }
      if($('preset').value==='kmanga') { $('from').value='171';$('to').value='184';$('anchor').value='https://comix.to/title/0qrqn-as-a-reincarnated-aristocrat-ill-use-my-appraisal-skill-to-rise-in-the-world/11476574-chapter-184'; }
      save().catch(e=>log(e.message));
    });
    $('open').onclick=async()=>{
      try {
        if(running)throw Error('Oprește rulajul înainte să schimbi sursa');
        const url=new URL($('anchor').value);
        if(url.origin!==location.origin||!/^\/title\/[^/]+\/\d+(?:-|\/|$)/.test(url.pathname))throw Error('Introdu un URL de capitol de pe aceeași origine');
        await save();location.href=url.href;
      }catch(e){log(e.message);}
    };
    $('use').onclick=()=>{ if(!running){$('anchor').value=location.href;save().catch(e=>log(e.message));} };
    $('stop').onclick=()=>{stop=true;log('Oprire cerută; aștept finalizarea operației curente.');};
    for(const mode of ['audit','repair']) $(mode).onclick=async()=>{
      if(running)return;
      running=true;
      try {
        // Picker invoked synchronously within the button gesture.
        const selected=await showDirectoryPicker({id:'wm-repair',mode:'readwrite',startIn:'documents'});
        running=true;$('log').textContent='';
        for(const el of panel.querySelectorAll('input,textarea,select,button'))el.disabled=true;
        $('stop').disabled=false;
        await run(mode,selected);
      }catch(e){log(`Oprit: ${e.message}`);}
      finally { running=false;for(const el of panel.querySelectorAll('input,textarea,select,button'))el.disabled=false;$('stop').disabled=true; }
    };
    log('Pregătit. Verificare = API + fișiere locale, fără descărcarea imaginilor. Recuperare = numai paginile din plan și interval.');
  }
  // Like the main downloader, display controls only after the reader appears.
  const timer=setInterval(maybeInit,1000);
  function maybeInit() {
    if(!document.querySelector('.rpage-floatctl__chap'))return;
    clearInterval(timer);
    init().catch(e=>console.error('WM repair:',e));
  }
  maybeInit();
})();
