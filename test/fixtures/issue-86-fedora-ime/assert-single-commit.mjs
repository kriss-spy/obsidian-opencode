import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
for (const name of ['chinese-1','chinese-2','japanese-1','japanese-2']) {
 const capture=JSON.parse(readFileSync(new URL(`./${name}-events.json`,import.meta.url),'utf8'));
 try {assert.equal(capture.input,capture.expected); console.log(`PASS ${name}`);}
 catch(error){console.error(`FAIL ${name}: expected ${JSON.stringify(capture.expected)}, received ${JSON.stringify(capture.input)}`);process.exitCode=1;}
}
