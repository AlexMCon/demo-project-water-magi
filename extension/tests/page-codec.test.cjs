const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test}=require('node:test');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'page-codec.js'),'utf8');
const chapter=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/chapter.decoded.json'),'utf8')).result;
const secure='https://comix.to/assets/build/current/secure-current.js';
const channel='__wm_chapter_codec_v2';
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));

function setup({status=200,foreignUrl=false,decodeError=false}={}){
  let receive;
  const replies=[],calls=[],imports=[];
  const window={addEventListener:(type,fn)=>{receive=fn;},postMessage:(data,origin)=>replies.push({data,origin})};
  const location={href:'https://comix.to/title/title-slug/10044831-chapter-2',origin:'https://comix.to',pathname:'/title/title-slug/10044831-chapter-2'};
  const context=vm.createContext({window,location,URL,AbortController,setTimeout,clearTimeout,
    performance:{getEntriesByType:()=>[
      {name:'https://other.example/secure-untrusted.js'}, {name:secure},
    ]},
    __importSiteModule:async url=>{imports.push(url);return {r(client){
      client.interceptors.request.use(config=>({
        ...config,url:foreignUrl?'https://other.example/api/v1/chapters/10044831':config.url,
        params:{_: 'currentkid.currenttoken'},
      }));
      client.interceptors.response.use(response=>{
        assert.equal(response.headers['x-enc'],'2');
        assert.equal(response.data.e,'current encrypted response');
        if(decodeError)throw new Error('decoder changed');
        return {data:chapter};
      });
    }};},
    fetch:async(url,options)=>{calls.push({url,options});return {
      ok:status===200,status,headers:{get:key=>key==='x-enc'?'2':null},
      json:async()=>({e:'current encrypted response'}),
    };},
  });
  // Replace only dynamic module loading in the test, leaving the bridge logic intact.
  vm.runInContext(source.replace('import(url)','__importSiteModule(url)'),context);
  const send=async(data={},origin=location.origin,sender=window)=>{
    await receive({source:sender,origin,data:{channel,action:'load',requestId:'request-1',chapterId:'10044831',...data}});
  };
  return {send,replies,calls,imports};
}

test('page bridge uses current site signing and x-enc: 2 response handling',async()=>{
  const app=setup();await app.send();
  assert.equal(app.calls.length,1);
  assert.equal(new URL(app.calls[0].url).searchParams.get('_'),'currentkid.currenttoken');
  assert.equal(app.calls[0].options.credentials,'same-origin');
  assert.deepEqual(app.imports,[secure]);
  assert.deepEqual(app.replies[0].data.data,chapter);
  assert.equal(app.replies[0].origin,'https://comix.to');
  await app.send({requestId:'request-2'});
  assert.equal(app.imports.length,1);
});

test('page bridge rejects foreign senders, origins, and chapters before making a request',async()=>{
  const app=setup();
  await app.send({},'https://other.example');await app.send({},'https://comix.to',{});
  await app.send({chapterId:'123'});await app.send({chapterId:'../10044831'});
  await app.send({requestId:15});await app.send({action:'arbitrary-fetch'});
  assert.equal(app.calls.length,0);assert.equal(app.replies.length,0);
});

test('page bridge reports HTTP and codec failures to the downloader',async()=>{
  for(const options of [{status:403},{decodeError:true}]){
    const app=setup(options);await app.send();
    assert.match(app.replies[0].data.error,/HTTP 403|decoder changed/);
    assert.equal(app.replies[0].data.data,undefined);
  }
});

test('page bridge rejects an unexpected request destination returned by the site',async()=>{
  const app=setup({foreignUrl:true});await app.send();
  assert.equal(app.calls.length,0);assert.match(app.replies[0].data.error,/neasteptata/);
});

test('isolated API client obtains and validates the current page bridge response',async()=>{
  const listeners=new Set();let posted;
  const location={href:'https://comix.to/title/title-slug/10044831-chapter-2',origin:'https://comix.to'};
  const window={
    addEventListener:(type,fn)=>listeners.add(fn),removeEventListener:(type,fn)=>listeners.delete(fn),
    postMessage:message=>{posted=message;queueMicrotask(()=>{
      for(const fn of listeners){
        fn({source:window,origin:location.origin,data:{...message,action:'result',requestId:'wrong',error:'ignore'}});
        fn({source:window,origin:location.origin,data:{...message,action:'result',data:chapter}});
      }
    });},
  };
  const context=vm.createContext({window,location,crypto:{randomUUID:()=> 'nonce-1'},
    atob,btoa,TextEncoder,TextDecoder,URL,AbortController,setTimeout,clearTimeout,
    fetch:async()=>{throw new Error('legacy API must not be used on comix.to');},
  });
  vm.runInContext(fs.readFileSync(path.join(root,'chapter-api.js'),'utf8'),context);
  const result=await context.__wmChapterApi.loadChapter(location.href);
  assert.equal(result.chapter.id,10044831);assert.equal(result.urls.length,22);
  assert.equal(posted.chapterId,'10044831');assert.equal(posted.requestId,'nonce-1');
  assert.equal(listeners.size,0);
  await nextTurn();
});
