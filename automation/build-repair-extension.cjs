const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const file of ['chapter-api.js', 'page-codec.js']) {
  const source = fs.readFileSync(path.join(root, 'extension', file), 'utf8');
  fs.writeFileSync(path.join(root, 'extension-repair', file), source.replaceAll('__wm_chapter_codec_v2', '__wm_repair_codec_v1'));
}
console.log('Repair codec files synchronized with separate message channel.');
