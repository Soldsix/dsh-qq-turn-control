import {test} from 'node:test'
import assert from 'node:assert/strict'
import {identifier} from 'dsh-im-kit'
import {dirname,join} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {QuotePolicy,Config} from '../dist/index.js'
const installed=dirname(fileURLToPath(import.meta.resolve('dsh-qq-chat')))
const {ChatKernel}=await import(pathToFileURL(join(installed,'kernel.js')))
const {Config:ChatConfig,resolveConfig}=await import(pathToFileURL(join(installed,'config.js')))
const {SqliteJournal}=await import(pathToFileURL(join(installed,'journal.js')))
const root=fileURLToPath(new URL('../.test-artifacts/',import.meta.url))
const message=(id,{sender='90000002',directed=true,override={}}={})=>{const now=Date.now();return{scope:{account:{tenantId:identifier('im.tenant','qa'),networkId:identifier('im.network','test'),accountId:identifier('im.account','bot')},kind:'group',peerId:identifier('im.peer','qa')},messageId:identifier('im.message',id),senderId:identifier('im.user',sender),sentAt:now,receivedAt:now,directedToBot:directed,parts:[{type:'text',text:'synthetic'}],...override}}

test('quote policy and durable chat kernel route a second member without altering the original event',async t=>{
 await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'turn-')),store=await SqliteJournal.open({databasePath:join(directory,'chat.sqlite3'),busyMs:20,timeoutMs:3000,startupMs:5000,shutdownMs:3000}),calls=[]
 const model={async resolvePreset(){return'qa'},async run(mapping,input){calls.push(input);return{sessionId:mapping.sessionId,text:'synthetic reply',fromOffset:0,toOffset:1,admitted:true,externalInput:false,completed:true}},async dispose(){}}
 const port={async availability(){return'available'},async send(){return{status:'accepted',messageIds:[identifier('im.message','accepted-reply')]}}}
 let release,entered;const hold=new Promise(resolve=>{release=resolve}),blocked=new Promise(resolve=>{entered=resolve}),wrapper={}
 t.after(()=>release())
 for(const key of ['claim','receipt','start','prepareSend','mapping','saveMapping','stats','close'])wrapper[key]=store[key].bind(store)
 wrapper.finish=async result=>{if(result.status==='responded'){entered();await hold}return store.finish(result)}
 const kernel=new ChatKernel(resolveConfig(ChatConfig({enabled:true,trigger:'directed'}),root),wrapper,model),policy=new QuotePolicy(Config({enabled:true})),signal=new AbortController().signal
 t.after(async()=>{await kernel.close();await store.close()})
 const first=message('1'),pending=kernel.submit(first,'live',port,signal,'default',result=>policy.observe(first,result)),timeout=AbortSignal.timeout(30000);await Promise.race([blocked,new Promise((_,reject)=>timeout.addEventListener('abort',()=>reject(Error('Durable finish barrier timed out')),{once:true}))])
 const second=message('2',{sender:'90000003',directed:false,override:{parts:[{type:'reply',messageId:identifier('im.message','accepted-reply')},{type:'text',text:'I disagree'}]}})
 const decision=await policy.decide(second,signal);assert.equal(decision,'reply')
 const response=kernel.submit(second,'live',port,signal,decision);release();assert.equal((await pending).status,'responded');const answer=await response
 assert.equal(answer.status,'responded');assert.equal(calls.length,2);assert.equal(calls[1].senderId,second.senderId);assert.equal(calls[1].directedToBot,false)
 const other=message('3',{sender:'90000004',directed:false});assert.equal(await policy.decide(other,signal),'default');assert.equal((await kernel.submit(other,'live',port,signal,'default')).reason,'not-directed')
})
