import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {verifyManifest,verifyFiles,verifyPair,verifyText} from '../scripts/verify-package.mjs'
test('publication checks reject private locations, executable entry points and mismatched docs',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));verifyManifest(manifest)
 assert.throws(()=>verifyManifest({...manifest,bin:'dist/index.js'}));assert.throws(()=>verifyManifest({...manifest,dependencies:{hidden:'file:../production'}}))
 assert.throws(()=>verifyFiles(['data/history.sqlite3']));assert.throws(()=>verifyText('C:/Users/example/private\n','negative fixture'))
 const en=await readFile(new URL('../README.md',import.meta.url),'utf8'),zh=await readFile(new URL('../README.zh.md',import.meta.url),'utf8');verifyPair(en,zh);verifyPair(en.replace(/\r?\n/gu,'\r\n'),zh.replace(/\r?\n/gu,'\r\n'));assert.throws(()=>verifyPair(en.replace('## Summary','## Missing'),zh));assert.throws(()=>verifyManifest({...manifest,dependencies:{...manifest.dependencies,'dsh-qq-chat':'^0.2.1'}}));assert.throws(()=>verifyPair(en,zh+'extra\n'))
})
