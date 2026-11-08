import {test} from 'node:test'
import assert from 'node:assert/strict'
import {identifier} from 'dsh-im-kit'
import {Config,QuotePolicy,apply} from '../dist/index.js'
import {RecentContext} from '../dist/intent.js'
import {Context} from '@deepseek-ai/cordis'
import {setTimeout as delay} from 'node:timers/promises'

const ident=(domain,value)=>identifier('im.'+domain,value)
const account={tenantId:ident('tenant','t'),networkId:ident('network','n'),accountId:ident('account','a')}
function message(id,peer,sender,text,options={}){return{scope:{account:{...account,accountId:ident('account',options.account??'a')},kind:'group',peerId:ident('peer',peer)},messageId:ident('message',id),senderId:ident('user',sender),sentAt:1,receivedAt:1,directedToBot:false,parts:[{type:'text',text},...(options.parts??[])]}}
function result(text){return{status:'responded',modelOutcome:'completed',receipt:{status:'accepted',messageIds:[ident('message','reply')]},reply:text}}
const limits={maxScopes:2,contextWindowMs:1000,maxContextMessages:4,maxContextChars:32}

test('context distinguishes participants and bot reply without passing raw identities or later messages',()=>{
 let now=1;const ctx=new RecentContext(limits,()=>now),a=message('1','group-secret','alice-secret','A asks'),b=message('2','group-secret','bob-secret','I disagree'),later=message('3','group-secret','later-secret','later')
 ctx.seen(a);ctx.observe(a,result('Bot answers'));ctx.seen(b);ctx.seen(later)
 const snapshot=ctx.request(b)
 assert.deepEqual(snapshot.history.map(x=>[x.speaker,x.text]),[['member-1','A asks'],['bot','Bot answers']])
 assert.equal(snapshot.candidate.speaker,'member-2');assert.equal(snapshot.candidate.text,'I disagree')
 for(const secret of ['group-secret','alice-secret','bob-secret','later-secret'])assert.equal(JSON.stringify(snapshot).includes(secret),false)
 assert.equal(JSON.stringify(snapshot).includes('later'),false)
})
test('account, group and source replay are isolated; windows and capacities are enforced',()=>{
 let now=1;const ctx=new RecentContext({...limits,maxScopes:1},()=>now),a=message('1','g1','a','first'),b=message('2','g1','b','second')
 ctx.seen(a);ctx.seen(a);ctx.seen(b);assert.equal(ctx.request(b).history.length,1)
 const firstId=ctx.request(b).contextId;assert.equal(ctx.request(a).contextId,firstId)
 ctx.seen(message('3','g2','c','other'));assert.equal(ctx.request(b),null)
 const other=message('4','g1','b','different account',{account:'other'});ctx.seen(other);assert.equal(ctx.request(a),null);assert.notEqual(ctx.request(other).contextId,firstId)
 now=1002;assert.equal(ctx.request(other),null)
})
test('simultaneous account and group windows have distinct opaque classifier context IDs',()=>{
 const ctx=new RecentContext({...limits,maxScopes:3}),a=message('1','g','a','one'),b=message('2','g','b','two',{account:'other'}),c=message('3','other-group','c','three')
 ctx.seen(a);ctx.seen(b);ctx.seen(c)
 const ids=[ctx.request(a).contextId,ctx.request(b).contextId,ctx.request(c).contextId]
 assert.equal(new Set(ids).size,3);assert.ok(ids.every(value=>!value.includes('other-group')))
})
test('text is bounded and media is represented by type, not attachment or local paths',()=>{
 const ctx=new RecentContext(limits),img=message('1','g','a','A'.repeat(60),{parts:[{type:'image',attachmentId:ident('attachment','private-id')}]})
 ctx.seen(img);const snapshot=ctx.request(img)
 assert.equal(snapshot.candidate.text.length,32);assert.equal(snapshot.candidate.truncated,true);assert.deepEqual(snapshot.candidate.media,['image']);assert.equal(JSON.stringify(snapshot).includes('private-id'),false)
})
test('mentions use group-local aliases and unknown replies carry no implied target',()=>{
 const ctx=new RecentContext(limits),a=message('1','g','alice','hi'),b=message('2','g','bob','your turn',{parts:[{type:'mention',userId:ident('user','alice')},{type:'reply',messageId:ident('message','unknown-private-id')}]})
 ctx.seen(a);ctx.seen(b);const snapshot=ctx.request(b)
 assert.equal(snapshot.candidate.speaker,'member-2');assert.deepEqual(snapshot.candidate.mentions,['member-1']);assert.equal(snapshot.candidate.hasReply,true)
 assert.equal(JSON.stringify(snapshot).includes('unknown-private-id'),false)
})
test('quote wins without classifier; unquoted decision receives a snapshot and the cancellation signal',async()=>{
 const requests=[],config=Config({enabled:true,intentEnabled:true}),controller=new AbortController(),policy=new QuotePolicy(config,()=>1,()=>({async classify(request,signal){requests.push({request,signal});return'reply'}}))
 const a=message('1','g','a','What do you think?'),b=message('2','g','b','I disagree'),quote=message('3','g','c','quote',{parts:[{type:'reply',messageId:ident('message','reply')}]})
 policy.seen(a);policy.observe(a,result('My opinion'));policy.seen(b)
 assert.equal(await policy.decide(b,controller.signal),'reply');assert.equal(requests.length,1);assert.equal(requests[0].signal,controller.signal)
 assert.deepEqual(requests[0].request.history.map(x=>x.text),['What do you think?','My opinion'])
 policy.seen(quote);assert.equal(await policy.decide(quote,controller.signal),'reply');assert.equal(requests.length,1)
})
test('intent routing is opt-in and rejects excessive memory settings',()=>{
 let effects=0;const ctx={get:()=>undefined,effect:()=>{effects++}}
 apply(ctx,Config({enabled:true}));assert.equal(effects,1)
 assert.throws(()=>new QuotePolicy(Config({enabled:true,intentEnabled:true,maxScopes:100000,maxContextMessages:100,maxContextChars:4096})),/memory ceiling/)
})
test('intent routing follows classifier service lifetime regardless of startup order',async t=>{
 const ctx=new Context(),policy=ctx.plugin({name:'intent-order-policy',apply(ctx){apply(ctx,Config({enabled:true,intentEnabled:true}))}})
 await policy.await();t.after(()=>policy.dispose());assert.ok(ctx.get('qqTurnPolicy'))
 const provider=ctx.plugin({name:'intent-order-provider',apply(ctx){ctx.effect(()=>ctx.provide('qqTurnIntent',{async classify(){return'reply'}}))}})
 await provider.await();t.after(()=>provider.dispose())
 for(let i=0;i<100&&!ctx.get('qqTurnIntent');i++)await delay(2)
 assert.ok(ctx.get('qqTurnIntent'));const installed=ctx.get('qqTurnPolicy'),input=message('lifetime','g','a','test'),signal=new AbortController().signal
 installed.seen(input);assert.equal(await installed.decide(input,signal),'reply');installed.observe(input,result('accepted'))
 await provider.dispose()
 for(let i=0;i<100&&ctx.get('qqTurnIntent');i++)await delay(2)
 assert.equal(ctx.get('qqTurnIntent'),undefined);assert.equal(ctx.get('qqTurnPolicy'),installed)
 await assert.rejects(installed.decide(input,signal),/classifier is unavailable/)
 const quoted=message('lifetime-quote','g','b','quoted',{parts:[{type:'reply',messageId:ident('message','reply')}]});assert.equal(await installed.decide(quoted,signal),'reply')
})
