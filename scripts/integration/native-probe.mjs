/** Exercise routing through the installed Host, IM provider, chat and policy plugins. */
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {setTimeout as delay} from 'node:timers/promises'
import {identifier} from 'dsh-im-kit'
export const inject=['im','turnTest','qqChat','qqTurnControl','typertGateway','remoteAccess']
export function apply(ctx,config){const task=probe(ctx,config);ctx.effect(()=>async()=>{await task})}
async function probe(ctx,config){
 const checks=[]
 try{
  const deadline=Date.now()+15000;while(!ctx.qqChat.status().transportAttached||!ctx.get('qqTurnPolicy')){assert.ok(Date.now()<deadline);await delay(15)}
  const source=(id,peer,sender,directed,parts)=>{const now=Date.now();return{scope:{account:ctx.turnTest.account,kind:'group',peerId:identifier('im.peer',peer)},messageId:identifier('im.message',id),senderId:identifier('im.user',sender),sentAt:now,receivedAt:now,directedToBot:directed,parts}}
  const text=value=>[{type:'text',text:value}],quote=id=>[{type:'reply',messageId:identifier('im.message',id)},{type:'text',text:'I disagree'}]
  const send=async message=>{const report=await ctx.im.publish(message,new AbortController().signal);assert.equal(report.failed,0);assert.equal(report.accepted,1)}
  const policy=ctx.get('qqTurnPolicy'),originalDecide=policy.decide.bind(policy);let decisions=0,observations=0
  policy.seen=()=>{observations++};policy.decide=async(...args)=>{decisions++;return originalDecide(...args)}
  const muted=source('muted','one','alice',false,text('muted'))
  ctx.turnTest.setAvailability('muted');await send(muted);await send(muted);ctx.turnTest.setAvailability('available')
  assert.equal(observations,1);assert.equal(decisions,0);assert.equal(ctx.turnTest.outputs.length,0)
  const stale=source('stale','one','alice',false,text('stale'));stale.sentAt=1;stale.receivedAt=1;await send(stale)
  assert.equal(observations,1);assert.equal(decisions,0)
  checks.push('muted-duplicate-and-expired-events-never-trigger-policy-decision')
  await send(source('first','one','alice',true,text('FIRST')));assert.equal(ctx.turnTest.outputs.length,1)
  await send(source('second','one','bob',false,quote('reply-1')));assert.equal(ctx.turnTest.outputs.length,2)
  checks.push('other-sender-quote-enters-chat-through-native-policy')
  await send(source('third','two','carol',false,quote('reply-1')));await send(source('fourth','one','carol',false,text('unrelated')));assert.equal(ctx.turnTest.outputs.length,2)
  checks.push('different-group-and-unaddressed-unrelated-messages-are-ignored')
  await send(source('fifth','two','carol',true,text('DIRECT')));assert.equal(ctx.turnTest.outputs.length,3)
  checks.push('explicit-addressing-always-enters-chat')
  await send(source('second','one','bob',false,quote('reply-1')));assert.equal(ctx.turnTest.outputs.length,3)
  checks.push('replayed-source-does-not-regenerate')
  const peer={id:'turn-owner-fixture',ctx,principal:{kind:'owner'},signal:new AbortController().signal,interactions:'none',async dispose(){}}
  const invoke=(method,args={},caller=peer)=>ctx.typertGateway.invoke({namespace:'qqTurnControl',method,args,peer:caller,signal:peer.signal})
  const state=await invoke('describe');assert.equal(state.active,true)
  ctx.effect(()=>ctx.remoteAccess.registerPolicy('turn-test-guest',{bindings:()=>[{resource:{kind:'global'},role:{name:'qa-turn',resource:'global',actions:['qqTurnControl/describe','qqTurnControl/save']}}]}))
  const guest={...peer,id:'turn-guest-fixture',principal:{kind:'turn-test-guest'}}
  for(const [method,args]of [['describe',{}],['save',{request:{revision:state.revision,patch:{enabled:false}}}]])await assert.rejects(invoke(method,args,guest),error=>error.code==='qq-turn/control'&&error.details.reason==='forbidden')
  await assert.rejects(invoke('save',{request:{revision:'0'.repeat(64),patch:{enabled:false}}}),error=>error.details?.reason==='conflict')
  await assert.rejects(invoke('save',{request:{revision:state.revision,patch:{maxScopes:0}}}),error=>error.details?.reason==='invalid')
  checks.push('owner-settings-refuse-guest-stale-and-invalid-edits')
  const saved=await invoke('save',{request:{revision:state.revision,patch:{maxScopes:31}}});assert.equal(saved.config.maxScopes,31);assert.equal(saved.active,true)
  await send(source('sixth','one','bob',false,quote('reply-1')));assert.equal(ctx.turnTest.outputs.length,3)
  await send(source('seventh','two','carol',true,text('DIRECT AGAIN')));assert.equal(ctx.turnTest.outputs.length,4)
  checks.push('native-setting-reload-clears-quote-cache-and-direct-requests-still-work')
  await invoke('save',{request:{revision:saved.revision,patch:{intentEnabled:true}}})
  await send(source('intent-first','two','alice',true,text('INTENT_FIRST')));assert.equal(ctx.turnTest.outputs.length,5)
  await send(source('intent-b','two','bob',false,text('UNQUOTED_B')));assert.equal(ctx.turnTest.outputs.length,6)
  const request=ctx.turnTest.intentRequests.find(item=>item.candidate.text==='UNQUOTED_B')
  assert.ok(request);assert.deepEqual(request.history.map(item=>[item.speaker,item.text]),[['member-1','INTENT_FIRST'],['bot','LAB_REPLY_5']]);assert.equal(request.candidate.speaker,'member-2')
  assert.ok(!JSON.stringify(request).includes('alice'));assert.ok(!JSON.stringify(request).includes('bob'))
  checks.push('optional-intent-provider-receives-scoped-context-and-routes-unquoted-followup')
  for(let index=0;index<15;index++){
   const directed=index===8,referenced=index===5,peer=referenced?'two':index%2?'one':'two'
   await send(source('participant-'+index,peer,'participant-'+index,directed,referenced?quote('reply-5'):text('participant message '+index)))
  }
  assert.equal(ctx.turnTest.outputs.length,8)
  checks.push('fifteen-synthetic-participants-produce-only-one-quote-and-one-explicit-reply')
  const beforeBots=await invoke('describe')
  const guarded=await invoke('save',{request:{revision:beforeBots.revision,patch:{botIds:['robot-1','robot-2','robot-3'],maxBotReplies:2,maxBotGroupReplies:3}}});assert.deepEqual(guarded.config.botIds,['robot-1','robot-2','robot-3'])
  await Promise.all(Array.from({length:15},(_,index)=>send(source('bot-loop-'+index,'one','robot-'+(index%3+1),true,text('BOT_LOOP')))))
  assert.equal(ctx.turnTest.outputs.length,11)
  const botOutputs=ctx.turnTest.outputs.slice(8);for(const sender of ['robot-1','robot-2','robot-3'])assert.ok(botOutputs.filter(value=>value.parts[0]?.messageId?.startsWith('bot-loop-')&&Number(value.parts[0].messageId.slice(9))%3+1===Number(sender.slice(6))).length<=2)
  await send(source('bot-loop-0','one','robot-1',true,text('BOT_LOOP')));assert.equal(ctx.turnTest.outputs.length,11)
  checks.push('native-parallel-other-bot-mentions-have-atomic-sender-and-group-budgets-without-replay')
  await send(source('human-after-bot-limit','one','ordinary-member',true,text('HUMAN_DIRECT')));assert.equal(ctx.turnTest.outputs.length,12)
  checks.push('ordinary-explicit-human-mention-survives-other-bot-budget-exhaustion')
  await writeFile(config.resultPath,JSON.stringify({passed:true,checks,outputs:ctx.turnTest.outputs.length,realQqMessagesSent:0},null,2)+'\n')
 }catch(error){await writeFile(config.resultPath,JSON.stringify({passed:false,checks,error:{message:error.message,stack:error.stack},realQqMessagesSent:0},null,2)+'\n')}
}
