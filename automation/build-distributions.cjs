// Build portable unpacked folders and ZIPs using Python's standard library.
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const output=path.resolve(process.argv[2]||path.join(root,'output','extensions'));
if (process.argv.includes('--help')) {
  console.log('Usage: node automation/build-distributions.cjs [OUTPUT_DIR]\nSet PYTHON to a Python 3 executable if it is not python3/python.');process.exit(0);
}
for (const name of ['chapter-api.js','page-codec.js']) {
  const source=fs.readFileSync(path.join(root,'extension',name),'utf8').replaceAll('__wm_chapter_codec_v2','__wm_repair_codec_v1');
  fs.writeFileSync(path.join(root,'extension-repair',name),source);
}
const distributions=[
  {source:'extension',name:'nori46',files:['manifest.json','chapter-api.js','page-codec.js','content.js','README.txt']},
  {source:'extension-repair',name:'nori47',files:['manifest.json','chapter-api.js','page-codec.js','repair-core.js','content.js','README.md']},
];
for (const item of distributions) {
  const folder=path.join(output,item.name);fs.mkdirSync(folder,{recursive:true});
  for (const name of item.files) fs.copyFileSync(path.join(root,item.source,name),path.join(folder,name));
}
const code=`import json, pathlib, sys, zipfile
root=pathlib.Path(sys.argv[1]); items=json.loads(sys.argv[2])
for item in items:
    folder=root/item['name']; archive=root/(item['name']+'.zip')
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for name in item['files']:
            info=zipfile.ZipInfo(name, date_time=(2026,1,1,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=0o100644 << 16
            z.writestr(info,(folder/name).read_bytes())
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        assert sorted(z.namelist())==sorted(item['files'])
    manifest=json.loads((folder/'manifest.json').read_text())
    print(manifest['name']+' '+manifest['version']+': '+str(folder)+' | '+str(archive))
`;
let candidates=process.env.PYTHON?[process.env.PYTHON]:process.platform==='win32'?['python','py']:['python3','python'];
for (let i=0;i<candidates.length;i++) {
  const result=spawnSync(candidates[i],['-c',code,output,JSON.stringify(distributions)],{encoding:'utf8'});
  if (result.error?.code==='ENOENT' && i<candidates.length-1) continue;
  if (result.error) throw result.error;
  process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
  process.exitCode=result.status||0;break;
}
