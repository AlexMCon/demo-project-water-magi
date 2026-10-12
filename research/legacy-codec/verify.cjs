// Compare the readable reconstruction with the supplied codec, including
// intermediate values; do not rely solely on our own encoder/decoder agreeing.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const codec = require('./decode-stuff.cjs');
const { createReference } = require('./reference.cjs');
const read = name => fs.readFileSync(name === 'stuff.json'
  ? path.join(__dirname, '..', '..', 'extension', 'tests', 'fixtures', 'chapter.encrypted.json')
  : path.resolve(process.env.WM_LEGACY_SOURCE || path.join(__dirname, name)));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const originalJson = read('stuff.json');
const originalJs = read('secure-tm8ho8-BG12c_J_.js');
const encoded = JSON.parse(originalJson).e;
const reference = createReference();
const expected = reference.decode(encoded);
const reconstructed = codec.decodePayload(encoded);
assert.equal(reconstructed, expected);
assert.equal(codec.encodePlaintext(reconstructed), encoded);
assert.equal(reference.encode(reconstructed), encoded);
assert.deepEqual(JSON.parse(reconstructed), JSON.parse(expected));

const stageNames = ['_0x44e662', '_0x38ccf0', '_0x3e82df'];
const trace = reference.trace();
let bytes = Buffer.from(encoded, 'base64url');
for (const [i, stage] of [...codec.stages].reverse().entries()) {
  bytes = codec.decodeStage(bytes, stage);
  assert.deepEqual(bytes, Buffer.from(trace.find(entry => entry.name === stageNames[i]).result));
}

const samples = [
  '', 'a', '{}', 'null',
  JSON.stringify({text:'Bună! 你好 🙂',quote:'"',newline:'\n'}),
  Array.from({length:128},(_,i)=>String.fromCharCode(i)).join(''),
  ...[23,24,25,31,32,33,255,256,257,1024].map(n=>'x'.repeat(n)),
];
for (const text of samples) {
  const encrypted = reference.encode(text);
  assert.equal(codec.encodePlaintext(text), encrypted);
  assert.equal(codec.decodePayload(encrypted), text);
  assert.equal(reference.decode(encrypted), text);
}
assert.deepEqual(read('stuff.json'), originalJson);
assert.deepEqual(read('secure-tm8ho8-BG12c_J_.js'), originalJs);
const report = {
  originals: {
    'stuff.json': {bytes: originalJson.length, sha256: sha256(originalJson)},
    'secure-tm8ho8-BG12c_J_.js': {bytes: originalJs.length, sha256: sha256(originalJs)},
  },
  output: {
    bytes: Buffer.byteLength(reconstructed, 'utf8'), sha256: sha256(reconstructed),
    rootKeys: Object.keys(JSON.parse(reconstructed)),
    pageCount: JSON.parse(reconstructed).result.pages.items.length,
  },
  validation: {
    matchesOriginalDecoder: true, allThreeIntermediateStagesMatch: true,
    originalEncoderReproducesPayload: true, reconstructedEncoderReproducesPayload: true,
    differentialSamplesPassed: samples.length, originalsUnchangedDuringValidation: true,
  },
};
fs.writeFileSync(path.join(__dirname,'verification.json'), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
