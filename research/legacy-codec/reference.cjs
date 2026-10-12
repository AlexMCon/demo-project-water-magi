// Minimal offline harness: load the bytecode VM and codec initializer only.
// Browser event handlers, page manipulation, and network-related initialization
// are outside the selected prefix. No Node APIs are passed into the VM context.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = path.resolve(process.env.WM_LEGACY_SOURCE || path.join(__dirname, 'secure-tm8ho8-BG12c_J_.js'));
const browserPrelude = `
globalThis.navigator = {appCodeName:'Mozilla'};
globalThis.atob = function atob(s) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  s=String(s).replace(/[\\t\\n\\f\\r ]/g,'').replace(/=+$/,'');
  let acc=0, bits=0, out='';
  for(const c of s) { const n=alphabet.indexOf(c); if(n<0)throw new Error('Invalid base64');
    acc=(acc<<6)|n; bits+=6; if(bits>=8) {bits-=8;out+=String.fromCharCode((acc>>>bits)&255);} }
  return out;
};
globalThis.btoa = function btoa(s) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let acc=0,bits=0,out=''; s=String(s);
  for(let i=0;i<s.length;i++) {const n=s.charCodeAt(i);if(n>255)throw new Error('Non-byte character');
    acc=(acc<<8)|n;bits+=8;while(bits>=6){bits-=6;out+=alphabet[(acc>>>bits)&63];}}
  if(bits)out+=alphabet[(acc<<(6-bits))&63];
  while(out.length%4)out+='=';
  return out;
};
globalThis.TextEncoder=class TextEncoder {encode(s){
  const raw=unescape(encodeURIComponent(s));return Uint8Array.from(raw,c=>c.charCodeAt(0));
}};
globalThis.TextDecoder=class TextDecoder {decode(bytes){
  let s='';for(const b of bytes)s+=String.fromCharCode(b);return decodeURIComponent(escape(s));
}};
globalThis.__trace=[];
globalThis.__record=false;
// The prefix registers these unrelated, originally hoisted application helpers.
// They are never invoked by the codec.
function Eu(){} function Bu(){} function zu(){} function Qu(){} function Ru(){}
function Ku(){} function Fu(){} function Lu(){} function Wu(){}
`;

function createReference() {
  const context=vm.createContext(Object.create(null), {
    name:'offline-codec-reference',codeGeneration:{strings:false,wasm:false},
  });
  vm.runInContext(browserPrelude,context,{timeout:2000});
  const source=fs.readFileSync(sourcePath,'utf8');
  const stop=source.indexOf('vmE_711c6c.hu=hu');
  if(stop<0)throw new Error('Codec initializer marker missing');
  let selected=source.slice(0,stop);
  const original='function kG(yS,yH,yt,yu,yA,ye){';
  if(selected.split(original).length!==2)throw new Error('VM entry marker mismatch');
  selected=selected.replace(original,`function kG(yS,yH,yt,yu,yA,ye){
    let entry;
    if(globalThis.__record){
      const [a,b]=yB(yA[32],yA[33]), constants=yA[(23*a+b)&31];
      entry={name:constants[constants.length-1],args:Array.from(yH||[])};
      globalThis.__trace.push(entry);
    }
    const result=kG_original(yS,yH,yt,yu,yA,ye);
    if(entry)entry.result=result;
    return result;
  }
  function kG_original(yS,yH,yt,yu,yA,ye){`);
  vm.runInContext(selected,context,{timeout:5000,filename:'codec-prefix.js'});
  function call(index,input,record=false) {
    context.__input=JSON.stringify(input);
    context.__record=record;
    const result=vm.runInContext(`JSON.stringify(hu[${index}](JSON.parse(__input)))`,context,{timeout:5000});
    return JSON.parse(result);
  }
  return {
    names:vm.runInContext('hu.map(f=>f.name)',context),
    call,
    decode:s=>call(3,s,true), encode:s=>call(2,s),
    trace:()=>JSON.parse(vm.runInContext('JSON.stringify(__trace)',context,{timeout:2000})),
  };
}
module.exports={createReference};

if(require.main===module){
  const payload=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','extension','tests','fixtures','chapter.encrypted.json'),'utf8')).e;
  const reference=createReference();
  const plain=reference.decode(payload);
  const data=JSON.parse(plain);
  fs.writeFileSync(path.join(__dirname,'stuff.decoded.raw.json'),plain);
  fs.writeFileSync(path.join(__dirname,'stuff.decoded.json'),JSON.stringify(data,null,2)+'\n');
  fs.writeFileSync(path.join(__dirname,'codec-trace.json'),JSON.stringify(reference.trace(),null,2)+'\n');
  console.log('Recovered JSON:',plain.length,'characters');
  console.log('Root:',Array.isArray(data)?'array':typeof data,'keys:',Object.keys(data));
  console.log('Preview:',plain.slice(0,650));
  console.log('Exact round trip:',reference.encode(plain)===payload);
  console.log('Call chain:',reference.trace().map(x=>x.name));
}
