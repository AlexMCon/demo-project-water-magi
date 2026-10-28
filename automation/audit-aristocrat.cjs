// Historical two-source preset; use audit-chapter-counts.cjs for other titles/ranges.
const path=require('node:path');
const {parseArgs,run}=require('./audit-chapter-counts.cjs');
async function main(args){
  if(!args[0]||args.includes('--help')){
    console.log('Usage: node automation/audit-aristocrat.cjs SOURCE [OUTPUT_DIR]\nAudits Original 136–170, then K-Manga 171–184, in separate source-locked runs.');return;
  }
  const output=path.resolve(args[1]||'output/aristocrat-audit');
  const batches=[
    {label:'original',from:136,to:170,url:'https://comix.to/title/0qrqn-as-a-reincarnated-aristocrat-ill-use-my-appraisal-skill-to-rise-in-the-world/7281875-chapter-170'},
    {label:'kmanga',from:171,to:184,url:'https://comix.to/title/0qrqn-as-a-reincarnated-aristocrat-ill-use-my-appraisal-skill-to-rise-in-the-world/11476574-chapter-184'},
  ];
  for(const batch of batches){
    const config=parseArgs([args[0],batch.url,'--from',String(batch.from),'--to',String(batch.to),'--output',path.join(output,batch.label),'--profile',path.join(output,'browser-profile')]);
    await run(config);
  }
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
