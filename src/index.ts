/** Optional quote and independently supplied intent routing. */
import type {Context} from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {scopeKey,type InboundMessage,type MessageId,type ScopeKey} from 'dsh-im-kit'
import type {ChatResult,ChatTurnPolicy} from 'dsh-qq-chat'
import type {Settings} from './fields.ts'
import {RecentContext,type TurnIntent} from './intent.ts'
import {ReplyBudget} from './budget.ts'
export type {IntentContextId,IntentRequest,IntentTurn,TurnIntent} from './intent.ts'

/** Runtime limits for accepted-reply correlation. */
export interface Config extends Settings{}
/** The provider is disabled until an operator enables its bundle entry. */
export const Config:z<Config>=z.object({enabled:z.boolean().default(false),quoteWindowMs:z.number().min(0).max(3600000).step(1).default(300000),maxScopes:z.number().min(1).max(100000).step(1).default(1024),maxRepliesPerScope:z.number().min(1).max(100).step(1).default(10),intentEnabled:z.boolean().default(false),contextWindowMs:z.number().min(1000).max(3600000).step(1).default(300000),maxContextMessages:z.number().min(2).max(100).step(1).default(16),maxContextChars:z.number().min(32).max(4096).step(1).default(512),botIds:z.array(z.string()).default([]),botWindowMs:z.number().min(1000).max(3600000).step(1).default(60000),maxBotReplies:z.number().min(0).max(100).step(1).default(3),maxBotGroupReplies:z.number().min(0).max(100).step(1).default(6),ambientWindowMs:z.number().min(1000).max(3600000).step(1).default(60000),minAmbientGapMs:z.number().min(0).max(3600000).step(1).default(8000),maxAmbientReplies:z.number().min(0).max(100).step(1).default(3)})
/** @param config - parsed profile limits. @throws Error when the memory ceiling would be exceeded. */
export function validateConfig(config:Config):void{
 if(config.intentEnabled&&config.maxScopes*config.maxContextMessages*config.maxContextChars>64000000)throw new Error('Intent context exceeds the memory ceiling')
 if(config.botIds.length>256||new Set(config.botIds).size!==config.botIds.length||config.botIds.some(id=>!id.trim()||id!==id.trim()||id.length>128))throw new Error('Invalid configured bot identities')
 if(config.minAmbientGapMs>config.ambientWindowMs)throw new Error('Automatic continuation gap exceeds its window')
}
declare module '@deepseek-ai/cordis'{interface Context{readonly qqTurnIntent:TurnIntent}}
/** Native bundle identity. */
export const name='qq-turn-control'
type Reply={readonly id:MessageId;readonly time:number}
/** Exact reply IDs avoid confusing references to a different group or account. */
export class QuotePolicy implements ChatTurnPolicy{
 private readonly scopes=new Map<ScopeKey,Reply[]>()
 private readonly context:RecentContext|null
 private readonly budget:ReplyBudget
 private readonly botIds:ReadonlySet<string>
 private readonly lifetime=new AbortController()
 private readonly pending=new Set<Promise<'reply'|'ignore'|'default'>>()
 private closing:Promise<void>|undefined
 /** @param config - parsed routing limits. @param clock - monotonic milliseconds. @param intent - current optional classifier provider. */
 constructor(private readonly config:Config,private readonly clock:()=>number=()=>performance.now(),private readonly intent:()=>TurnIntent|undefined=()=>undefined){validateConfig(config);this.context=config.intentEnabled?new RecentContext(config,clock):null;this.budget=new ReplyBudget(config,clock);this.botIds=new Set(config.botIds)}
 /** @param input - fresh admitted source, including direct mentions. @returns block only for configured bots without an explicit bot target or an available reservation; ordinary members are always allowed. */
 guard(input:InboundMessage):'allow'|'block'{
  if(this.lifetime.signal.aborted)return'block'
  if(input.scope.kind!=='group'||!this.botIds.has(input.senderId))return'allow'
  return(input.directedToBot||this.quoted(input))&&this.budget.reserve(input,'bot')?'allow':'block'
 }
 /** @param input - source actually selected for a reply by Chat, including its basic same-sender trigger. @returns one synchronous reservation for an automatic human continuation; explicit humans, known quotes and already guarded bot attempts bypass this budget. */
 allowReply(input:InboundMessage):boolean{
  if(this.lifetime.signal.aborted)return false
  if(input.scope.kind!=='group'||input.directedToBot||this.botIds.has(input.senderId)||this.quoted(input))return true
  return this.budget.reserve(input,'ambient')
 }
 private quoted(input:InboundMessage):boolean{
  const targets=input.parts.filter(part=>part.type==='reply'),saved=this.scopes.get(scopeKey(input.scope))??[],now=this.clock()
  return targets.length===1&&saved.some(reply=>reply.id===targets[0]!.messageId&&now>=reply.time&&now-reply.time<=this.config.quoteWindowMs)
 }
 /** @param input - fresh admitted group source. */
 seen(input:InboundMessage):void{if(!this.lifetime.signal.aborted)this.context?.seen(input)}
 /** @param input - original normalized message. @param signal - caller cancellation. @returns quote match or the optional classifier's decision. */
 async decide(input:InboundMessage,signal:AbortSignal):Promise<'reply'|'ignore'|'default'>{
  signal.throwIfAborted();this.lifetime.signal.throwIfAborted();if(input.scope.kind!=='group'||input.directedToBot)return'default'
  if(input.parts.some(part=>part.type==='mention'))return'ignore'
  if(this.quoted(input))return'reply'
  const request=this.context?.request(input)
  if(!request)return'default'
  if(request.candidate.replyTo&&request.candidate.replyTo.speaker!=='bot'||request.candidate.mentions.length)return'ignore'
  const classifier=this.intent();if(!classifier)throw new Error('Intent classifier is unavailable')
  const combined=AbortSignal.any([signal,this.lifetime.signal])
  const task=Promise.resolve().then(()=>{combined.throwIfAborted();return classifier.classify(request,combined)})
  this.pending.add(task);void task.then(()=>this.pending.delete(task),()=>this.pending.delete(task))
  const decision=await task;combined.throwIfAborted()
  return decision==='default'?'ignore':decision
 }
 /** @param input - original source. @param result - actual model and delivery outcome. */
 observe(input:InboundMessage,result:ChatResult):void{
  if(this.lifetime.signal.aborted)return
  this.context?.observe(input,result)
  if(input.scope.kind!=='group'||result.status!=='responded'||result.modelOutcome!=='completed'||result.receipt?.status!=='accepted'||!result.receipt.messageIds.length)return
  const key=scopeKey(input.scope),now=this.clock(),saved=(this.scopes.get(key)??[]).filter(item=>now-item.time<=this.config.quoteWindowMs)
  for(const id of result.receipt.messageIds)saved.push({id,time:now})
  this.scopes.delete(key);this.scopes.set(key,saved.slice(-this.config.maxRepliesPerScope))
  while(this.scopes.size>this.config.maxScopes){const first=this.scopes.keys().next().value;if(first!==undefined)this.scopes.delete(first)}
 }
 /** @returns completion after owned classifier decisions settle; new observations stop and new decisions fail immediately. */
 close():Promise<void>{
  if(this.closing)return this.closing
  const settled=Promise.allSettled([...this.pending]);this.lifetime.abort();this.scopes.clear();this.context?.clear();this.budget.clear()
  return this.closing=settled.then(()=>{})
 }
}
/** @param ctx - DSH profile context. @param config - validated limits. */
export function apply(ctx:Context,config:Config):void{
 if(!config.enabled)return
 validateConfig(config)
 if(ctx.get('qqTurnPolicy'))throw new Error('Another turn policy is already installed')
 ctx.effect(()=>{
  const policy=new QuotePolicy(config,()=>performance.now(),()=>ctx.get('qqTurnIntent')),detach=ctx.provide('qqTurnPolicy',policy)
  return async()=>{const closed=policy.close();await detach();await closed}
 })
}
