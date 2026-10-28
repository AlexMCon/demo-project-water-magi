// Offline browser integration tests: actual File System API and image decoding, mocked reader/API.
const {chromium}=require('playwright');
const path=require('node:path');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 let page;
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const context=await browser.newContext();
  await context.route('https://comix.to/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body><button class="rpage-floatctl__chap">Ch.136 / 184</button><button aria-label="Previous chapter">Previous</button><button aria-label="Next chapter">Next</button></body>'}));
  page=await context.newPage();await page.goto('https://comix.to/title/test/100-chapter-136');
  await page.evaluate(async()=>{
   const config={from:'136',to:'136',delay:'1',chapterDelay:'1',preset:'custom',anchor:location.href,plan:'136: 2\n183: *'};
   globalThis.chrome={storage:{local:{get:async()=>({wmRepairConfig:config}),set:async value=>Object.assign(config,value.wmRepairConfig)}}};
   const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('repair-smoke',{create:true});
   await root.removeEntry('136',{recursive:true}).catch(()=>{});
   globalThis.showDirectoryPicker=async()=>root;
   const canvas=document.createElement('canvas');canvas.width=12;canvas.height=18;
   const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,12,18);ctx.fillStyle='black';ctx.fillRect(2,2,5,5);
   const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));globalThis.testBytes=await blob.arrayBuffer();
   const dir=await root.getDirectoryHandle('136',{create:true});const w=await(await dir.getFileHandle('001.png',{create:true})).createWritable();await w.write(testBytes);await w.close();
   globalThis.testRequests=[];
   globalThis.__wmChapterApi={loadChapter:async()=>({chapter:{id:100,number:Number(document.querySelector('.rpage-floatctl__chap').textContent.match(/Ch\.?\s*([\d.]+)/)[1]),mangaId:1,groupId:globalThis.changedSource?2:1,group:{name:'Original'},pages:{items:Array.from({length:3},()=>({width:12,height:18}))}},urls:['https://images.test/1','https://images.test/2','https://images.test/3']}),loadImage:async url=>{testRequests.push(url);return{bytes:testBytes,extension:'.png'}}};
  });
  await page.addScriptTag({path:path.resolve('extension-repair/repair-core.js')});
  await page.addScriptTag({path:path.resolve('extension-repair/content.js')});
  const el=k=>page.locator(`#__wm_repair [data-key="${k}"]`);
  const finish=()=>page.waitForFunction(()=>!document.querySelector('#__wm_repair [data-key="audit"]').disabled,{},{timeout:20000});
  await el('audit').click();await page.waitForFunction(()=>document.querySelector('#__wm_repair pre').textContent.includes('Verificare completă'));await finish();
  assert.match(await el('plan').inputValue(),/136: 2, 3/);assert.match(await el('plan').inputValue(),/183: \*/);
  assert.deepEqual(await page.evaluate(()=>testRequests),[]);
  await el('repair').click();await page.waitForFunction(()=>document.querySelector('#__wm_repair pre').textContent.includes('Selecția din acest interval este recuperată'));await finish();
  assert.deepEqual(await page.evaluate(()=>testRequests),['https://images.test/2','https://images.test/3']);
  assert.equal(await el('plan').inputValue(),'183: *');
  const saved=await page.evaluate(async()=>{
   const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('repair-smoke');
   const dir=await root.getDirectoryHandle('136');const names=[];for await(const name of dir.keys())names.push(name);
   const report=await(await root.getDirectoryHandle('_wm-repair')).getFileHandle('wm-repair-136-136.json');return{names:names.sort(),report:JSON.parse(await(await report.getFile()).text())};
  });
  assert.deepEqual(saved.names,['001.png','002.png','003.png']);assert.equal(saved.report.complete,true);assert.equal(saved.report.repaired.length,2);
  // Group change before chapter 137 must stop before any images are requested for it.
  await el('from').fill('136');await el('to').fill('137');await el('plan').fill('137: 1');
  await page.evaluate(()=>{
   document.querySelector('[aria-label="Next chapter"]').onclick=()=>{document.querySelector('.rpage-floatctl__chap').textContent='Ch.137 / 184';history.pushState({},'','/title/test/101-chapter-137');globalThis.changedSource=true;};
  });
  await el('repair').click();await page.waitForFunction(()=>document.querySelector('#__wm_repair pre').textContent.includes('Sursa s-a schimbat'),{},{timeout:20000});await finish();
  assert.deepEqual(await page.evaluate(()=>testRequests),['https://images.test/2','https://images.test/3']);assert.equal(await el('plan').inputValue(),'137: 1');
  // Abort/stop leaves pending pages intact and does not issue an image request.
  await page.evaluate(()=>{document.querySelector('.rpage-floatctl__chap').textContent='Ch.136 / 184';history.pushState({},'','/title/test/100-chapter-136');globalThis.changedSource=false;});
  await el('to').fill('136');await el('plan').fill('136: 1');await el('overwrite').check();await el('delay').fill('5');
  await el('repair').click();await page.waitForFunction(()=>document.querySelector('#__wm_repair [data-key="stop"]').disabled===false);await el('stop').click();await finish();
  assert.equal(await el('plan').inputValue(),'136: 1');assert.deepEqual(await page.evaluate(()=>testRequests),['https://images.test/2','https://images.test/3']);
  const other=await context.newPage();
  await context.route('https://example.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body>Ordinary website</body>'}));
  await other.goto('https://example.test/');
  await other.evaluate(()=>{
    globalThis.storageReads=0;
    globalThis.chrome={storage:{local:{get:async()=>{storageReads++;return{};},set:async()=>{}}}};
  });
  await other.addScriptTag({path:path.resolve('extension-repair/repair-core.js')});
  await other.addScriptTag({path:path.resolve('extension-repair/content.js')});
  await other.waitForTimeout(1200);
  assert.equal(await other.locator('#__wm_repair').count(),0);
  assert.equal(await other.evaluate(()=>storageReads),0);
  await other.evaluate(()=>{const reader=document.createElement('button');reader.className='rpage-floatctl__chap';reader.textContent='Ch.1';document.body.appendChild(reader);});
  await other.waitForSelector('#__wm_repair',{timeout:5000});
  assert.equal(await other.evaluate(()=>storageReads),1);
  console.log('Browser smoke passed: trailing-page audit, selective repair, read-back decode, checkpoint, source lock, stop and reader-only panel (including delayed reader).');
 }catch(e){if(page)console.error(await page.locator('body').innerText());throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
