// Read-only live API totals: no manga images are downloaded or modified.
const fs = require('node:fs');
const path = require('node:path');
const C = require('../extension-repair/repair-core.js');
const project = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs(args) {
  if (args.includes('--help') || args.length < 2) return null;
  const config = { source: path.resolve(args[0]), url: args[1], output: path.resolve('output/chapter-audit'),
    pause: 5, wait: 120, headless: false, lockSource: true };
  for (let i = 2; i < args.length; i++) {
    const option = args[i];
    if (option === '--headless') { config.headless = true; continue; }
    if (option === '--allow-source-change') { config.lockSource = false; continue; }
    const value = args[++i];
    if (value === undefined) throw Error('Missing value for '+option);
    const field = { '--from':'first', '--to':'last', '--output':'output', '--profile':'profile',
      '--pause-seconds':'pause', '--wait-seconds':'wait' }[option];
    if (!field) throw Error('Unknown option: '+option);
    config[field] = ['first','last','pause','wait'].includes(field) ? Number(value) : path.resolve(value);
  }
  const url = new URL(config.url);
  if (url.protocol !== 'https:' || !(url.hostname === 'comix.to' || url.hostname.endsWith('.comix.to')) ||
      !/^\/title\/[^/]+\/\d+(?:-|\/|$)/.test(url.pathname)) throw Error('Use an HTTPS comix.to chapter URL');
  if (![config.first,config.last,config.pause,config.wait].every(Number.isFinite) ||
      config.first < 0 || config.last < config.first || config.pause < 1 || config.wait < 1) throw Error('Invalid chapter range or pause/wait');
  if (!fs.statSync(config.source).isDirectory()) throw Error('Source must be a chapter root directory');
  config.profile ||= path.join(config.output, 'browser-profile');
  const relative = path.relative(config.source, config.output);
  if (!relative || (!relative.startsWith('..'+path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw Error('Keep the report/profile output outside the source image tree');
  }
  return config;
}
function localChapters(source) {
  const folders = new Map();
  for (const item of fs.readdirSync(source, {withFileTypes:true})) {
    if (!item.isDirectory()) continue;
    let cap;
    try { cap=C.chapter(item.name.replace(/^(?:chapter|ch)[-_ ]/i,'')); } catch { continue; }
    if (folders.has(cap)) throw Error('Duplicate chapter folders for '+cap);
    folders.set(cap, path.join(source,item.name));
  }
  return folders;
}
function summarize(report, folders, first, last) {
  const visited = new Set(report.chapters.map(c => c.number));
  report.notVisited = [...folders.keys()].filter(n => Number(n)>=first && Number(n)<=last && !visited.has(n));
  report.unvisitedIntegers = Array.from({length:Math.floor(last)-Math.ceil(first)+1},(_,i)=>String(Math.ceil(first)+i)).filter(n=>!visited.has(n));
  report.complete = report.reachedEnd === true && !report.notVisited.length && !report.unvisitedIntegers.length && !report.error;
  report.missingPages = Object.fromEntries(report.chapters.filter(c=>c.missing.length).map(c=>[c.number,c.missing]));
  report.updatedAt = new Date().toISOString();
}
async function run(config) {
  const {chromium} = require('playwright');
  fs.mkdirSync(config.output,{recursive:true});
  const folders=localChapters(config.source), initial=new URL(config.url);
  const series=initial.pathname.match(/^\/title\/([^/]+)\//)[1];
  const report={startedAt:new Date().toISOString(),root:config.source,range:[config.first,config.last],chapters:[],complete:false};
  const save=()=>{
    summarize(report,folders,config.first,config.last);
    fs.writeFileSync(path.join(config.output,'live-totals.json'),JSON.stringify(report,null,2));
  };
  save();
  const extension=path.join(project,'extension');
  let context;
  try {
    context=await chromium.launchPersistentContext(config.profile,{channel:'chromium',headless:config.headless,
      executablePath:process.env.WM_BROWSER_PATH||undefined,
      args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    await context.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if (['image','media','font'].includes(request.resourceType()) || /^\/(?:hi|i5)\//.test(url.pathname)) return route.abort();
      return route.continue();
    });
    const page=context.pages()[0]||await context.newPage();
    page.on('popup',popup=>popup.close().catch(()=>{}));
    const cdp=await context.newCDPSession(page),worlds=new Map();
    cdp.on('Runtime.executionContextCreated',e=>worlds.set(e.context.id,e.context));
    cdp.on('Runtime.executionContextsCleared',()=>worlds.clear());
    cdp.on('Runtime.executionContextDestroyed',e=>worlds.delete(e.executionContextId));
    await cdp.send('Runtime.enable');
    async function metadata() {
      for (const [id,world] of worlds) {
        if (world.auxData?.isDefault) continue;
        let probe;
        try { probe=await cdp.send('Runtime.evaluate',{expression:'typeof __wmChapterApi',contextId:id,returnByValue:true}); } catch { continue; }
        if (probe.result.value!=='object') continue;
        const result=await cdp.send('Runtime.evaluate',{expression:'__wmChapterApi.loadChapter(location.href)',contextId:id,returnByValue:true,awaitPromise:true});
        if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
        return result.result.value.chapter;
      }
      throw Error('Extension context missing');
    }
    await page.goto(config.url,{waitUntil:'domcontentloaded',timeout:60000});
    console.log(`Reader opened. If Cloudflare asks, complete it manually in Chromium; waiting up to ${config.wait}s.`);
    let source,direction;
    for (let step=0;step<1500;step++) {
      await page.waitForSelector('.rpage-floatctl__chap',{timeout:config.wait*1000});
      await sleep(config.pause*1000);
      const current=new URL(page.url());
      if (current.origin!==initial.origin || current.pathname.match(/^\/title\/([^/]+)\//)?.[1]!==series) throw Error('Reader changed origin or series');
      const chapter=await metadata(),cap=C.chapter(String(chapter.number));
      const visible=await page.locator('.rpage-floatctl__chap').innerText();
      if (Number(visible.match(/Ch\.?\s*([\d.]+)/)?.[1])!==Number(cap)) throw Error('API chapter differs from displayed reader');
      if (Number(cap)<config.first || Number(cap)>config.last) throw Error('Reader outside requested range');
      if (!direction) {
        if (Number(cap)!==config.first && Number(cap)!==config.last) throw Error('Start at the first or last chapter in the interval');
        direction=Number(cap)===config.last?-1:1;
      }
      if (report.chapters.some(c=>c.number===cap)) throw Error('Reader repeated a chapter');
      const key=C.sourceKey(chapter);
      if (source && source!==key && config.lockSource) throw Error('Source changed: stop and change source manually, then audit the next interval separately');
      source ||= key;
      const folder=folders.get(cap),names=folder?fs.readdirSync(folder):[];
      const comparison=C.compareFiles(names,chapter.pages.items.length);
      const entry={number:cap,id:chapter.id,group:chapter.group,source:key,expectedPages:chapter.pages.items.length,
        ...comparison,url:page.url(),pageDimensions:chapter.pages.items.map(p=>({width:p.width,height:p.height})),reader:visible};
      report.chapters.push(entry);save();
      console.log(`Chapter ${cap}: ${comparison.present}/${entry.expectedPages}; missing ${comparison.missing.join(',')||'none'}`);
      if (Number(cap)===(direction<0?config.first:config.last)) { report.reachedEnd=true;save();break; }
      const previous=page.url(),button=page.locator(`button[aria-label="${direction<0?'Previous':'Next'} chapter"]`);
      if (!await button.count() || await button.isDisabled()) throw Error('Chapter navigation not available before range end');
      await button.evaluate(element=>element.click());
      await page.waitForFunction(url=>location.href!==url,previous,{timeout:60000});
      await page.waitForFunction(n=>{
        const match=document.querySelector('.rpage-floatctl__chap')?.textContent.match(/Ch\.?\s*([\d.]+)/);
        return match && Number(match[1])!==Number(n);
      },cap,{timeout:60000});
    }
    if (!report.complete) throw Error('Audit incomplete; inspect notVisited/unvisitedIntegers in live-totals.json');
  } catch(error) {
    report.error=error.message;save();throw error;
  } finally { await context?.close(); }
  return report;
}
const usage='Usage: node automation/audit-chapter-counts.cjs SOURCE START_URL --from 10 --to 45 [--output output/audit] [--profile DIR] [--pause-seconds 5] [--wait-seconds 120] [--headless] [--allow-source-change]';
if (require.main===module) {
  Promise.resolve().then(()=>{
    const config=parseArgs(process.argv.slice(2));
    if (!config) { console.log(usage);return; }
    return run(config);
  }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={parseArgs,localChapters,summarize,run};
