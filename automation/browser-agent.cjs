const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const readline=require('node:readline');
const work=path.resolve(process.env.WM_OUTPUT_DIR||path.join(__dirname,'..','output','browser-test'));
const extension=path.join(__dirname,'..','extension');
fs.mkdirSync(work,{recursive:true});
let context,page,cdp,worlds=new Map(),responses=[],failures=[];
const send=value=>console.log(JSON.stringify(value));
async function world(){
  for(const [id,c] of worlds){
    if(c.auxData?.isDefault)continue;
    try{
      const r=await cdp.send('Runtime.evaluate',{expression:'typeof globalThis.__wmChapterApi',contextId:id,returnByValue:true});
      if(r.result.value==='object')return id;
    }catch{}
  }
  throw new Error('Extension execution context not found');
}
async function evaluate(expression,isolated){
  if(!isolated)return await page.evaluate(expression);
  const r=await cdp.send('Runtime.evaluate',{expression,contextId:await world(),returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result.value;
}
async function snapshot(){
  return await page.evaluate(()=>({url:location.href,title:document.title,text:document.body?.innerText.slice(0,2400),
    panel:!!document.querySelector('#__wm'),chapter:document.querySelector('.rpage-floatctl__chap')?.textContent,
    pageCount:document.querySelectorAll('.rpage-page').length,log:document.querySelector('#__wm_log')?.textContent,
    scripts:[...document.scripts].filter(s=>s.src.includes('secure')).map(s=>s.src)}));
}
(async()=>{
  context=await chromium.launchPersistentContext(path.join(work,'browser-profile'),{
    channel:'chromium',
    executablePath:process.env.WM_BROWSER_PATH||undefined,
    headless:process.env.WM_HEADFUL!=='1',viewport:{width:1280,height:900},acceptDownloads:true,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
  });
  page=context.pages()[0]||await context.newPage();
  page.on('response',async r=>{
    const u=new URL(r.url());
    if(u.pathname.startsWith('/api/v1/chapters/')){
      const entry={url:r.url(),status:r.status(),header:r.headers()['x-enc'],time:new Date().toISOString()};
      try{entry.body=await r.text();}catch(e){entry.error=e.message;}
      responses.push(entry);
      fs.writeFileSync(path.join(work,'chapter-responses.json'),JSON.stringify(responses,null,2));
      send({event:'chapter-response',path:u.pathname,status:r.status(),encoded:entry.body?.includes('"e"')});
    }
  });
  page.on('requestfailed',r=>{failures.push({url:r.url(),error:r.failure()?.errorText});});
  page.on('pageerror',e=>send({event:'page-error',message:e.message.slice(0,240)}));
  page.on('dialog',async d=>{send({event:'dialog',type:d.type(),message:d.message().slice(0,300)});await d.dismiss();});
  cdp=await context.newCDPSession(page);
  cdp.on('Runtime.executionContextCreated',e=>worlds.set(e.context.id,e.context));
  cdp.on('Runtime.executionContextDestroyed',e=>worlds.delete(e.executionContextId));
  cdp.on('Runtime.executionContextsCleared',()=>worlds.clear());
  await cdp.send('Runtime.enable');
  send({ready:true,browser:context.browser()?.version(),work});
  const rl=readline.createInterface({input:process.stdin});
  for await(const line of rl){
    let command;
    try{
      command=JSON.parse(line);
      let result;
      if(command.type==='goto'){
        try{await page.goto(command.url,{waitUntil:'domcontentloaded',timeout:45000});}catch(e){send({event:'navigation-warning',message:e.message});}
        result=await snapshot();
      }else if(command.type==='snapshot')result=await snapshot();
      else if(command.type==='evaluate')result=await evaluate(command.code,command.isolated);
      else if(command.type==='fill'){await page.locator(command.selector).fill(command.value);result=true;}
      else if(command.type==='click'){await page.locator(command.selector).click({timeout:10000});result=true;}
      else if(command.type==='screenshot'){const target=path.join(work,command.name||'page.png');await page.screenshot({path:target,fullPage:false});result=target;}
      else if(command.type==='export'){
        const output=path.join(work,'chapter-1');fs.mkdirSync(output,{recursive:true});
        const names=await page.evaluate(async()=>{
          const base=await (await navigator.storage.getDirectory()).getDirectoryHandle('watermagician-live-test');
          const dir=await base.getDirectoryHandle('1');const out=[];
          for await(const [name,handle]of dir.entries())if(handle.kind==='file')out.push(name);
          return out.sort();
        });
        const metadata=await page.evaluate(async()=>{
          const base=await (await navigator.storage.getDirectory()).getDirectoryHandle('watermagician-live-test');
          const chapter=JSON.parse(await (await (await base.getFileHandle('chapter.json')).getFile()).text());
          const log=await (await (await base.getFileHandle('download-log.txt')).getFile()).text();
          return {chapter,log};
        });
        fs.writeFileSync(path.join(work,'chapter.decoded.json'),JSON.stringify(metadata.chapter,null,2));
        fs.writeFileSync(path.join(work,'download-log.txt'),metadata.log);
        const verified=[];
        for(const name of names){
          if(!/^\d{3}\.(webp|png|jpg|gif|avif)$/.test(name))throw new Error('Unexpected output filename');
          const item=await page.evaluate(async name=>{
            const base=await (await navigator.storage.getDirectory()).getDirectoryHandle('watermagician-live-test');
            const dir=await base.getDirectoryHandle('1'),blob=await (await dir.getFileHandle(name)).getFile();
            const bitmap=await createImageBitmap(blob),width=bitmap.width,height=bitmap.height;bitmap.close();
            const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
            for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
            return {base64:btoa(binary),width,height};
          },name);
          const bytes=Buffer.from(item.base64,'base64');fs.writeFileSync(path.join(output,name),bytes);
          const expected=metadata.chapter.pages.items[Number(name.slice(0,3))-1];
          if(!expected||expected.width!==item.width||expected.height!==item.height)throw new Error('Image dimensions do not match API: '+name);
          verified.push({name,bytes:bytes.length,width:item.width,height:item.height,
            sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex')});
        }
        const expectedNames=Array.from({length:metadata.chapter.pages.items.length},(_,i)=>String(i+1).padStart(3,'0'));
        if(names.length!==expectedNames.length||expectedNames.some(n=>!names.some(name=>name.startsWith(n+'.'))))throw new Error('Missing output pages');
        const report={testedAt:new Date().toISOString(),extensionVersion:JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8')).version,url:page.url(),
          chapterId:metadata.chapter.id,expectedPages:expectedNames.length,savedPages:verified.length,
          totalBytes:verified.reduce((n,v)=>n+v.bytes,0),allImagesDecoded:true,allDimensionsMatch:true,
          outputDirectory:output,folderSelection:'Browser-private test directory, exported byte-for-byte',files:verified};
        fs.writeFileSync(path.join(work,'verification.json'),JSON.stringify(report,null,2));
        result={folder:output,pages:report.savedPages,bytes:report.totalBytes,allImagesDecoded:true,allDimensionsMatch:true};
      }
      else if(command.type==='network')result={responses:responses.map(({body,...entry})=>({...entry,bodyPreview:body?.slice(0,250)})),failures:failures.slice(-30)};
      else if(command.type==='close'){await context.close();send({id:command.id,closed:true});break;}
      else throw new Error('Unknown command');
      send({id:command.id,result});
    }catch(e){send({id:command?.id,error:e.message});}
  }
  await context.close().catch(()=>{});
})().catch(e=>{send({fatal:e.message});process.exitCode=1;});
