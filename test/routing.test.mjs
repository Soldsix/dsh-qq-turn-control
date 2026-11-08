import {test} from 'node:test'
import assert from 'node:assert/strict'
import {identifier} from 'dsh-im-kit'
import {Config,QuotePolicy} from '../dist/index.js'
const account={tenantId:identifier('im.tenant','synthetic'),networkId:identifier('im.network','synthetic'),accountId:identifier('im.account','bot')}
const msg=(peer,parts=[])=>({scope:{account,kind:'group',peerId:identifier('im.peer',peer)},messageId:identifier('im.message','incoming'),senderId:identifier('im.user','alice'),sentAt:Date.now(),receivedAt:Date.now(),parts,directedToBot:false})
const result=(status='accepted')=>({status:'responded',modelOutcome:'completed',receipt:status==='accepted'?{status,messageIds:[identifier('im.message','bot-reply')]}:{status:'uncertain',code:'timeout'}})
test('only accepted bot replies in the exact conversation can be quoted',async()=>{
 const policy=new QuotePolicy(Config({enabled:true})),source=msg('one'),quote=[{type:'reply',messageId:identifier('im.message','bot-reply')}],signal=new AbortController().signal
 assert.equal(await policy.decide(msg('one',quote),signal),'default');policy.observe(source,result('uncertain'));assert.equal(await policy.decide(msg('one',quote),signal),'default')
 policy.observe(source,result());assert.equal(await policy.decide(msg('one',quote),signal),'reply');assert.equal(await policy.decide(msg('two',quote),signal),'default')
 const other=msg('one',quote);other.scope={...other.scope,account:{...account,accountId:identifier('im.account','another-bot')}};assert.equal(await policy.decide(other,signal),'default')
})
test('scope capacity and cancellation do not leak prior reply targets',async()=>{
 const policy=new QuotePolicy(Config({enabled:true,maxScopes:1})),quote=[{type:'reply',messageId:identifier('im.message','bot-reply')}],controller=new AbortController()
 policy.observe(msg('one'),result());policy.observe(msg('two'),result());assert.equal(await policy.decide(msg('one',quote),controller.signal),'default');assert.equal(await policy.decide(msg('two',quote),controller.signal),'reply')
 controller.abort();await assert.rejects(policy.decide(msg('two',quote),controller.signal),error=>error.name==='AbortError')
})
