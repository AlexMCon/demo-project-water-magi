// Run with: node --expose-internals inspect.cjs
// Parse the source as data, then run only its bytecode-loader initialization.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('internal/deps/acorn/acorn/dist/acorn');
const inputPath = path.resolve(process.argv[2] && process.argv[2] !== '--verbose'
  ? process.argv[2] : path.join(__dirname, 'secure-tm8ho8-BG12c_J_.js'));
const source = fs.readFileSync(inputPath, 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const loaderEnd = ast.body[1].end;
const marker = 'return yW._$XNFbXJ=';
if (source.split(marker).length !== 2) throw new Error('Unexpected loader layout');
const loader = source.slice(0, loaderEnd).replace(marker,
  'globalThis.__vm = {decodeMain:ym,decodeNested:yl,seed:yj(),salt:l[""],environmentKey:yZ,slots:yB,kX,km,kl,kz};' + marker);
const context = vm.createContext(Object.create(null), {
  name: 'bytecode-inspection', codeGeneration: { strings: false, wasm: false },
});
vm.runInContext('globalThis.navigator = {appCodeName:"Mozilla"};', context);
vm.runInContext(loader, context, { timeout: 5000, filename: 'loader-only.js' });
const result = vm.runInContext(`JSON.stringify((()=>{
  const main = [], nested = [];
  function normalize(p) {
    const [a,b] = __vm.slots(p[32],p[33]);
    const fields = {};
    for(let i=0;i<32;i++) if(p[(i*a+b)&31] !== undefined) fields[i] = p[(i*a+b)&31];
    return {seeds:p.slice(32),fields};
  }
  for (let i=0;i<33;i++) main.push({index:i,...normalize(__vm.decodeMain(i))});
  for (let i=0;i<200;i++) {
    try { const p=__vm.decodeNested(i); if(!p)break; nested.push({index:i,...normalize(p)}); }
    catch(e) { break; }
  }
  return {seed:__vm.seed,salt:__vm.salt,environmentKey:__vm.environmentKey,main,nested};
})())`, context, { timeout: 5000 });
fs.writeFileSync(path.join(__dirname, 'bytecode.json'), result);
const data = JSON.parse(result);
console.log('VM seed, salt, environment key:', data.seed, data.salt, data.environmentKey);
for (const group of ['main', 'nested']) {
  console.log(group, data[group].length);
  if(process.argv.includes('--verbose')) for (const p of data[group]) console.log(p.index, 'constants:', JSON.stringify(p.fields[23]));
}
const disassembly=vm.runInContext(`JSON.stringify((()=>{
  const out=[];
  for(const [group,indices] of [['main',[0,23,28,29]],['nested',[4,5,7,8,11,12,14,15,175,176]]]){
    for(const index of indices){
      const p=__vm[group==='main'?'decodeMain':'decodeNested'](index),[a,b]=__vm.slots(p[32],p[33]);
      const field=n=>p[(n*a+b)&31],code=field(20),c=field(23),count=code.length>>1;
      const layout=(47607*p[32]^62661*p[33]^40285*count^17577*c.length)>>>0&3;
      const [j,o,d]=[[0,1,1],[count,0,0],[0,count,0],[1,0,1]][layout];
      const seed=field(15)||0,mask=field(25)||0,key=seed?__vm.kX(seed):null,permutations=[];
      if(seed)for(let n=0;n<8;n++){
        const perm=__vm.kz(__vm.km(seed^n*key.mult1,key.mult2),512,key.mult2),inverse=[];
        for(let z=0;z<512;z++)inverse[perm[z]]=z;permutations.push(inverse);
      }
      const instructions=[];
      for(let pc=0;pc<count;pc++){
        let op=code[j+(pc<<d)]^mask;
        if(seed)op=permutations[__vm.kl(seed,pc,key.mult1)][op];
        const operand=code[o+(pc<<d)]^mask;
        const branch=(field(12)||{})[pc];
        instructions.push({pc,op,operand,constant:c[operand],branch:branch===undefined?undefined:branch^(field(16)||0)});
      }
      out.push({group,index,constants:c,instructions});
    }
  }
  return out;
})())`,context,{timeout:5000});
const programs=JSON.parse(disassembly),handlers=new Map();
function walk(node){
  if(!node||typeof node!=='object')return;
  if(node.type==='SwitchStatement'&&node.discriminant.name==='Mh'){
    for(const item of node.cases)if(item.test){
      const body=item.consequent.map(n=>source.slice(n.start,n.end)).join('');
      handlers.set(item.test.value,body);
    }
  }
  for(const [key,val]of Object.entries(node))if(key!=='start'&&key!=='end'){
    if(Array.isArray(val))val.forEach(walk);else if(val&&typeof val==='object')walk(val);
  }
}
walk(ast);
const used=new Set();
let disText='Decoded instruction stream (constant annotations apply only to constant-taking instructions).\n';
for(const p of programs){
  disText+='\n'+p.group+' '+p.index+'\n';
  for(const i of p.instructions){
    used.add(i.op);
    const constant=JSON.stringify(i.constant);
    disText+=i.pc.toString().padStart(3)+' op='+i.op+' arg='+i.operand+
      (constant===undefined?'':' constant='+constant)+(i.branch===undefined?'':' branch='+i.branch)+'\n';
  }
}
disText+='\nOpcode implementations (Mb=push, MB=pop, Mc=peek, yK=locals, yI=constants):\n';
for(const op of [...used].sort((a,b)=>a-b))disText+=op+': '+handlers.get(op)+'\n';
fs.writeFileSync(path.join(__dirname,'codec.disassembly.txt'),disText);
// A token-based inspection view. Its line breaks are for reading, not execution.
let formatted = '';
for (const t of acorn.tokenizer(source, {ecmaVersion:'latest',sourceType:'module'})) {
  const raw=source.slice(t.start,t.end);
  formatted += t.type.label === 'string' && raw.length > 200 ? JSON.stringify('[encoded literal: '+raw.length+' chars]') : raw;
  formatted += [';', '{', '}'].includes(t.type.label) ? '\n' : ' ';
}
fs.writeFileSync(path.join(__dirname, 'secure.inspection.txt'), formatted);
