const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parseArgs,summarize,localChapters}=require('../audit-chapter-counts.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'wm-live-audit-'));
process.on('exit',()=>fs.rmSync(root,{recursive:true,force:true}));
const url='https://comix.to/title/test/123-chapter-10';
test('CLI validates origin, chapter range and keeps output outside images',()=>{
 const good=parseArgs([root,url,'--from','10','--to','12','--output',path.join(os.tmpdir(),'wm-audit-report')]);
 assert.equal(good.lockSource,true);assert.equal(good.pause,5);
 for(const args of [[root,'https://other.example/title/test/123','--from','10','--to','12'],[root,url,'--from','12','--to','10'],[root,url,'--from','10','--to','12','--pause-seconds','0'],[root,url,'--from','10','--to','12','--output',root]])assert.throws(()=>parseArgs(args));
});
test('reaching interval edge does not hide skipped fractional or integer chapters',()=>{
 const report={reachedEnd:true,chapters:[{number:'10',missing:[]},{number:'12',missing:[3]}]};
 summarize(report,new Map([['10',root],['10.5',root],['12',root]]),10,12);
 assert.equal(report.complete,false);assert.deepEqual(report.notVisited,['10.5']);assert.deepEqual(report.unvisitedIntegers,['11']);assert.deepEqual(report.missingPages,{'12':[3]});
 report.chapters.push({number:'10.5',missing:[]},{number:'11',missing:[]});summarize(report,new Map([['10',root],['10.5',root],['12',root]]),10,12);assert.equal(report.complete,true);
 report.error='Cloudflare';summarize(report,new Map(),10,12);assert.equal(report.complete,false);
});
test('numeric folder aliases cannot silently select a different copy',()=>{
 fs.mkdirSync(path.join(root,'10'));assert.equal(localChapters(root).get('10'),path.join(root,'10'));
 fs.mkdirSync(path.join(root,'chapter-10'));assert.throws(()=>localChapters(root),/Duplicate/);
});
