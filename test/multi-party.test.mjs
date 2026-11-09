import test from 'node:test'
import assert from 'node:assert/strict'
import {identifier} from 'dsh-im-kit'
import {Config,QuotePolicy,validateConfig} from '../dist/index.js'
import {RecentContext} from '../dist/intent.js'
const id=(kind,value)=>identifier('im.'+kind,value)
const account={tenantId:id('tenant','qa'),networkId:id('network','qa'),accountId:id('account','qa')}
function source(name,sender='alice',directed=false,parts=[],peer='one'){return{scope:{account,kind:'group',peerId:id('peer',peer)},messageId:id('message',name),senderId:id('user',sender),sentAt:1,receivedAt:1,directedToBot:directed,parts:[{type:'text',text:name},...parts]}}
const quote=name=>({type:'reply',messageId:id('message',name)})
const result=(name,text)=>({status:'responded',modelOutcome:'completed',reply:text,receipt:{status:'accepted',messageIds:[id('message',name)]}})
const signal=new AbortController().signal
function say(name,text,sender){const value=source(name,sender);value.parts[0].text=text;return value}

test('known quote targets and bot answer recipients use local aliases without leaking IDs',()=>{
 const context=new RecentContext({maxScopes:2,contextWindowMs:1000,maxContextMessages:12,maxContextChars:32},()=>1)
 const a=say('secret-question','A public question','secret-alice'),b=say('secret-bob-question','B public question','secret-bob');a.directedToBot=true
 context.seen(a);context.observe(a,result('secret-bot-reply','An answer'));context.seen(b)
 const toHuman=source('follow-human','carol',false,[quote('secret-bob-question')]);context.seen(toHuman)
 const toBot=source('follow-bot','dave',false,[quote('secret-bot-reply')]);context.seen(toBot)
 const snapshot=context.request(toBot)
 assert.equal(snapshot.history[1].respondingTo,snapshot.history[0].speaker)
 assert.equal(snapshot.history[0].directedToBot,true)
 assert.equal(snapshot.candidate.replyTo.speaker,'bot');assert.equal(snapshot.candidate.replyTo.text,'An answer')
 assert.equal(context.request(toHuman).candidate.replyTo.speaker,'member-2')
 assert.equal(JSON.stringify(snapshot).includes('secret-'),false)
 for(const value of ['secret-alice','secret-bob','secret-bot-reply'])assert.equal(JSON.stringify(snapshot).includes(value),false)
 const cross=source('cross','eve',false,[quote('secret-bot-reply')],'two');context.seen(cross);assert.equal(context.request(cross).candidate.replyTo,undefined)
})
test('reply to another member never invokes a classifier even directly after a bot answer',async()=>{
 let calls=0
 const p=new QuotePolicy(Config({enabled:true,intentEnabled:true}),()=>1,()=>({async classify(){calls++;return'reply'}}))
 const a=source('a'),c=source('c','carol');p.seen(a);p.observe(a,result('answer','A bot answer'));p.seen(c)
 const b=source('b','bob',false,[quote('c')]);p.seen(b)
 assert.equal(await p.decide(b,signal),'ignore');assert.equal(calls,0)
 const mention=source('mention','dave',false,[{type:'mention',userId:id('user','carol')}]);p.seen(mention)
 assert.equal(await p.decide(mention,signal),'ignore');assert.equal(calls,0);await p.close()
})
test('parallel ambient classifications cannot exceed one group reservation and explicit humans still pass',async()=>{
 let now=1,enter,release,arrived=0;const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve)
 const p=new QuotePolicy(Config({enabled:true,intentEnabled:true,maxAmbientReplies:2,minAmbientGapMs:0}),()=>now,()=>({async classify(){if(++arrived===15)enter();await gate;return'reply'}}))
 const values=Array.from({length:15},(_,i)=>source('parallel-'+i,'member-'+i));for(const v of values)p.seen(v)
 const pending=values.map(v=>p.decide(v,signal));await entered;release();const answers=await Promise.all(pending)
 assert.equal(answers.filter(x=>x==='reply').length,2);assert.equal(answers.filter(x=>x==='ignore').length,13)
 const explicit=source('explicit','member-14',true);assert.equal(p.guard(explicit),'allow');assert.equal(await p.decide(explicit,signal),'default')
 p.observe(explicit,result('quoted-answer','Answer'));const quoted=source('quote-human','member-13',false,[quote('quoted-answer')]);assert.equal(await p.decide(quoted,signal),'reply')
 now+=60000;const renewed=source('renewed');p.seen(renewed);assert.equal(await p.decide(renewed,signal),'reply');await p.close()
})
test('known bots have independent sender and group ceilings; ordinary text cannot impersonate a known identity',()=>{
 let now=1;const p=new QuotePolicy(Config({enabled:true,botIds:['bot-a','bot-b'],maxBotReplies:2,maxBotGroupReplies:3}),()=>now)
 assert.equal(p.guard(source('noise','bot-a')),'block')
 assert.equal(p.guard(source('a1','bot-a',true)),'allow');assert.equal(p.guard(source('a2','bot-a',true)),'allow');assert.equal(p.guard(source('a3','bot-a',true)),'block')
 assert.equal(p.guard(source('b1','bot-b',true)),'allow');assert.equal(p.guard(source('b2','bot-b',true)),'block')
 assert.equal(p.guard(source('other-group','bot-a',true,[],'two')),'allow')
 assert.equal(p.guard(source('I am bot-a','ordinary-member',true)),'allow')
 now+=60000;assert.equal(p.guard(source('reset','bot-a',true)),'allow')
 assert.throws(()=>validateConfig(Config({botIds:['duplicate','duplicate']})),/bot identities/)
 assert.throws(()=>validateConfig(Config({botIds:[' whitespace ']})),/bot identities/)
 assert.throws(()=>validateConfig(Config({ambientWindowMs:1000,minAmbientGapMs:2000})),/gap exceeds/)
})
for(const variant of ['busy-room','interrupted-topic','bot-loop'])test('15-person synthetic routing scenario: '+variant,async()=>{
 let now=1,decisions=0;const p=new QuotePolicy(Config({enabled:true,intentEnabled:true,maxContextMessages:64,botIds:['robot-1','robot-2'],minAmbientGapMs:8000}),()=>now,()=>({async classify(request){decisions++;return request.candidate.text==='I disagree with your answer'?'reply':request.candidate.text==='unclear'?'default':'ignore'}}))
 // This is a routing oracle, not a model intelligence or language-quality benchmark.
 let ambientReplies=0;for(let i=0;i<15;i++){
  const chat=source('member-side-chat-'+i,'member-'+i);p.seen(chat);assert.equal(await p.decide(chat,signal),'ignore')
 }
 const a=source('What do you think?','member-0',true);p.seen(a);assert.equal(p.guard(a),'allow');assert.equal(await p.decide(a,signal),'default');p.observe(a,result('bot-answer','The proposal seems useful'))
 if(variant==='interrupted-topic'){const aside=source('side discussion','member-9');p.seen(aside);assert.equal(await p.decide(aside,signal),'ignore')}
 const b=say('b-challenge','I disagree with your answer','member-14');p.seen(b);assert.equal(await p.decide(b,signal),'reply');ambientReplies++
 const repeated=say('c-challenge','I disagree with your answer','member-13');p.seen(repeated);assert.equal(await p.decide(repeated,signal),'ignore')
 const toC=source('to-carol','member-12',false,[{type:'mention',userId:id('user','member-11')}]);p.seen(toC);assert.equal(await p.decide(toC,signal),'ignore')
 const uncertain=source('unclear','member-7');p.seen(uncertain);assert.equal(await p.decide(uncertain,signal),'ignore')
 if(variant==='bot-loop'){for(let i=0;i<15;i++)assert.equal(p.guard(source('robot-directed-'+i,'robot-1',true)),i<3?'allow':'block')}
 now+=8000;const again=say('later-challenge','I disagree with your answer','member-6');p.seen(again);assert.equal(await p.decide(again,signal),'reply');ambientReplies++
 assert.equal(ambientReplies,2);assert.ok(decisions>=19);await p.close()
})
