const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../repair-core.js');
test('editable recovery plan merges ranges, decimals and a whole missing chapter',()=>{
 const p=C.parsePlan('136:7;141:11,13\n136:8-9\n183:*\n170.5:1');
 assert.deepEqual(p['136'],[7,8,9]);assert.deepEqual(p['141'],[11,13]);assert.equal(p['183'],'*');assert.deepEqual(p['170.5'],[1]);
 assert.equal(C.formatPlan(p),'136: 7, 8, 9\n141: 11, 13\n170.5: 1\n183: *');
});
test('invalid plans cannot silently become wrong pages or file paths',()=>{
 for(const s of ['136:0','136:3-1','../136:1','136:foo','136:1,','136:1-10001','136:Infinity','136:'])assert.throws(()=>C.parsePlan(s));
});
test('whole chapter remains whole when lines repeat',()=>{assert.equal(C.parsePlan('183:*\n183:2')['183'],'*');});
test('API count detects trailing missing pages, duplicate formats and extra files',()=>{
 const r=C.compareFiles(['001.webp','003.jpg','003.png','006.webp','notes.txt'],5);
 assert.deepEqual(r.missing,[2,4,5]);assert.deepEqual(r.duplicates,[{page:3,names:['003.jpg','003.png']}]);assert.deepEqual(r.unexpected,['006.webp']);
 assert.deepEqual(C.compareFiles([],3).missing,[1,2,3]);assert.throws(()=>C.compareFiles([],0));
});
test('whole chapter expansion and out-of-range requests use authoritative total',()=>{
 assert.deepEqual(C.requestedPages('*',3),[1,2,3]);assert.deepEqual(C.requestedPages([2],3),[2]);assert.throws(()=>C.requestedPages([4],3));
});
test('source lock identifies groups and refuses unidentified sources',()=>{
 assert.equal(C.sourceKey({groupId:5,group:{name:'Original'}}),'group:5');
 assert.notEqual(C.sourceKey({groupId:5}),C.sourceKey({groupId:6}));
 assert.equal(C.sourceKey({group:{name:'K-Manga'}}),'name:K-Manga');assert.throws(()=>C.sourceKey({}));
});
test('standalone extension uses a distinct bridge channel and the main downloader site access',()=>{
 const fs=require('node:fs'),path=require('node:path'),base=path.resolve(__dirname,'..');
 const manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json')));
 assert.deepEqual(manifest.permissions,['storage']);
 const main=JSON.parse(fs.readFileSync(path.join(base,'..','extension','manifest.json')));
 assert.deepEqual(manifest.content_scripts.map(s=>s.matches),main.content_scripts.map(s=>s.matches));
 for(const file of ['page-codec.js','chapter-api.js']) {
  const generated=fs.readFileSync(path.join(base,file),'utf8');assert.ok(generated.includes('__wm_repair_codec_v1'));assert.ok(!generated.includes('__wm_chapter_codec_v2'));
  assert.equal(generated,fs.readFileSync(path.join(base,'..','extension',file),'utf8').replaceAll('__wm_chapter_codec_v2','__wm_repair_codec_v1'));
 }
});
