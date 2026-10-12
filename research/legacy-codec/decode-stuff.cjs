// Readable reconstruction of the response codec in secure-tm8ho8-BG12c_J_.js.
// Uses Node built-ins only; does not load or execute the obfuscated JavaScript.
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');

// These exact tables, repeating keys, and initial feedback bytes were recovered
// from the decoded constant pools of nested VM functions 4, 11, and 7.
// Order here is the ENCODING order: A -> B -> C.
const constants = [
  {
    name: 'A', initial: 189,
    table: 'gbicCvAMzfcXEtGAyjvvhmb2yCWzWhjqcxXZ7ZhpzANOzoQLo3nuPZ2vK9dkb9hJExC0Vni/hdQBceI+mw611gkhQFjBuf4bJg1TxYqM+SL4YDqtwjxiGSdeH7so7Fn1HiRo37Z+RNvl44twXWVhomtMjw+8bemfmv9XEXr7mS82MxaCOJZRR0oHd9PLI5O+gyBGT6hcLoduNa7yCObVVCk3bFWsoD+xcqTrBcP6dNJN/NB1Br2QGhSN2snHAqeRNKVFQiyeAFLPSKGwY8aq9EPgsi17qd4ywPMxiH8w6N1qX1tLKtzhOeemHWeJQfFQ5H23q7qSlJUcjgTEl3x2/Q==',
    key: 'rafYl4oSAKQX+GYoic9oW4iGwiYpZzs0',
  },
  {
    name: 'B', initial: 133,
    table: '2lQehmgyYFAoWUi0haazZqHy5zZ34NN+VzlfsoB2Y1yY0IuMLjgVcV2xt8t4moH+AP0NMJ5qekW7DFIHEWKkOgIBIMhDdA8lbM6iHKjDlq6IChpb3CnA9NmsvQW/afdt1SfJjTdwcvpKqunCJLxBFmXX9hecm6tGb+HRxD7BC3njoxPxgnX5pdKP1IMSkd4/O3NRfZSE6DVLG2s9uexaipA05cpJzE8Qkv/z5jzHAwlEWOLd3yxA+0cvVbpOoJPFGc8f1lb4vu2HUxjuuEwEQk0GsPCVnyKvfOoh9TG2YYmZLV4I67UU2NsrrakqZ47k/O+ne25/DjPGZCMdnZcmzQ==',
    key: '2USAq+VTo5ht4bQn+K9DUcpUQRTtrB56',
  },
  {
    name: 'C', initial: 32,
    table: '+mhJSFwzaV+PQPDyKp2scO/S9SdFsy/7e56UWT8XHbK3E2+19nEPwfwOgE9uVCaDtOAWTobCZX+cBCXlIbBqyDyQB1beKLspW6kGPhBCV9x0jf0KUeFhHjmlMf7qMFIB41PfDFprZ3bJiK4YxrZDv+K6dcwJmggVO8f5ktrXTM0cZL4fer0SpnkbvNajPbHxfuTz5lVEBarOI4rdc+2V6zTsjpfQYjgN1MMr6EvA6eehN6dQ1bgUogt9rZOBbQBeNnLYY00uZqSoJBnFi5gthCJsWF33ykosn9v/9KB8udMCz0YRYImrA4VHr5mMgpH4xDXLeEHRd5vZOiAalofuMg==',
    key: 'yNHlokVEnuecesDrB/lDhVuUNiheWc3a47VtkwZ2ENg=',
  },
];

const stages = constants.map(({ name, initial, table, key }) => {
  const forward = Buffer.from(table, 'base64');
  if (forward.length !== 256 || new Set(forward).size !== 256) {
    throw new Error(`Stage ${name}: expected a permutation of all 256 byte values`);
  }
  const inverse = Buffer.alloc(256);
  forward.forEach((value, index) => { inverse[value] = index; });
  return { name, initial, forward, inverse, key: Buffer.from(key, 'base64') };
});

function decodeStage(input, stage) {
  const output = Buffer.alloc(input.length);
  let previous = stage.initial;
  for (let i = 0; i < input.length; i++) {
    const current = input[i];
    // Undo substitution, then undo the two XORs. Feedback uses INPUT bytes.
    output[i] = stage.inverse[current] ^ stage.key[i % stage.key.length] ^ previous;
    previous = current;
  }
  return output;
}

function encodeStage(input, stage) {
  const output = Buffer.alloc(input.length);
  let previous = stage.initial;
  for (let i = 0; i < input.length; i++) {
    // The original forward transformation. Feedback uses OUTPUT bytes.
    output[i] = stage.forward[input[i] ^ stage.key[i % stage.key.length] ^ previous];
    previous = output[i];
  }
  return output;
}

function decodeBytes(encoded) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]*$/.test(encoded)) {
    throw new Error('Expected an unpadded base64url string in field e');
  }
  let bytes = Buffer.from(encoded, 'base64url');
  if (bytes.toString('base64url') !== encoded) throw new Error('Invalid base64url encoding');
  for (const stage of [...stages].reverse()) bytes = decodeStage(bytes, stage);
  return bytes;
}

function decodePayload(encoded) {
  return new TextDecoder('utf-8', { fatal: true }).decode(decodeBytes(encoded));
}

function encodePlaintext(text) {
  let bytes = Buffer.from(text, 'utf8');
  for (const stage of stages) bytes = encodeStage(bytes, stage);
  return bytes.toString('base64url');
}

module.exports = { stages, decodeStage, encodeStage, decodeBytes, decodePayload, encodePlaintext };

if (require.main === module) {
  const inputPath = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'extension', 'tests', 'fixtures', 'chapter.encrypted.json'));
  const outputPath = path.resolve(process.argv[3] || path.join(__dirname, 'stuff.decoded.json'));
  const rawPath = outputPath.replace(/(?:\.json)?$/i, '.raw.json');
  const sourcePath = path.resolve(process.env.WM_LEGACY_SOURCE || path.join(__dirname, 'secure-tm8ho8-BG12c_J_.js'));
  for (const output of [outputPath, rawPath]) {
    if ([inputPath, sourcePath].some(input => input.toLowerCase() === output.toLowerCase())) {
      throw new Error('Output must not overwrite an original input file');
    }
  }
  const wrapper = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const plaintext = decodePayload(wrapper.e);
  const parsed = JSON.parse(plaintext);
  if (encodePlaintext(plaintext) !== wrapper.e) throw new Error('Exact round-trip check failed');
  fs.writeFileSync(rawPath, plaintext, 'utf8');
  fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  console.log(`Decoded JSON: ${outputPath}`);
  console.log(`Exact original text: ${rawPath}`);
  console.log(`Recovered ${Buffer.byteLength(plaintext, 'utf8')} bytes. Exact round trip: PASS.`);
}
