/** Optional quote and independently supplied intent routing. */
import type {Context} from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {scopeKey,type InboundMessage,type MessageId,type ScopeKey} from 'dsh-im-kit'
import type {ChatResult,ChatTurnPolicy} from 'dsh-qq-chat'
import type {Settings} from './fields.ts'
import {RecentContext,type TurnIntent} from './intent.ts'
export type {IntentContextId,IntentRequest,IntentTurn,TurnIntent} from './intent.ts'

/** Runtime limits for accepted-reply correlation. */
export interface Config extends Settings{}
/** The provider is disabled until an operator enables its bundle entry. */
export const Config:z<Config>=z.object({enabled:z.boolean().default(false),quoteWindowMs:z.number().min(0).max(3600000).step(1).default(300000),maxScopes:z.number().min(1).max(100000).step(1).default(1024),maxRepliesPerScope:z.number().min(1).max(100).step(1).default(10),intentEnabled:z.boolean().default(false),contextWindowMs:z.number().min(1000).max(3600000).step(1).default(300000),maxContextMessages:z.number().min(2).max(100).step(1).default(16),maxContextChars:z.number().min(32).max(4096).step(1).default(512)})
/** @param config - parsed profile limits. @throws Error when the memory ceiling would be exceeded. */
export function validateConfig(config:Config):void{
 if(config.intentEnabled&&config.maxScopes*config.maxContextMessages*config.maxContextChars>64000000)throw new Error('Intent context exceeds the memory ceiling')
}
declare module '@deepseek-ai/cordis'{interface Context{readonly qqTurnIntent:TurnIntent}}
/** Native bundle identity. */
export const name='qq-turn-control'
type Reply={readonly id:MessageId;readonly time:number}
/** Exact reply IDs avoid confusing references to a different group or account. */
export class QuotePolicy implements ChatTurnPolicy{
 private readonly scopes=new Map<ScopeKey,Reply[]>()
 private readonly context:RecentContext|null
 /** @param config - parsed routing limits. @param clock - monotonic milliseconds. @param intent - current optional classifier provider. */
 constructor(private readonly config:Config,private readonly clock:()=>number=()=>performance.now(),private readonly intent:()=>TurnIntent|undefined=()=>undefined){validateConfig(config);this.context=config.intentEnabled?new RecentContext(config,clock):null}
 /** @param input - fresh admitted group source. */
 seen(input:InboundMessage):void{this.context?.seen(input)}
 /** @param input - original normalized message. @param signal - caller cancellation. @returns quote match or the optional classifier's decision. */
 async decide(input:InboundMessage,signal:AbortSignal):Promise<'reply'|'ignore'|'default'>{
  signal.throwIfAborted();if(input.scope.kind!=='group'||input.directedToBot)return'default'
  const saved=this.scopes.get(scopeKey(input.scope))??[],now=this.clock()
  if(input.parts.some(part=>part.type==='reply'&&saved.some(reply=>reply.id===part.messageId&&now-reply.time<=this.config.quoteWindowMs&&now>=reply.time)))return'reply'
  const request=this.context?.request(input)
  if(!request)return'default'
  const classifier=this.intent();if(!classifier)throw new Error('Intent classifier is unavailable')
  return classifier.classify(request,signal)
 }
 /** @param input - original source. @param result - actual model and delivery outcome. */
 observe(input:InboundMessage,result:ChatResult):void{
  this.context?.observe(input,result)
  if(input.scope.kind!=='group'||result.status!=='responded'||result.modelOutcome!=='completed'||result.receipt?.status!=='accepted'||!result.receipt.messageIds.length)return
  const key=scopeKey(input.scope),now=this.clock(),saved=(this.scopes.get(key)??[]).filter(item=>now-item.time<=this.config.quoteWindowMs)
  for(const id of result.receipt.messageIds)saved.push({id,time:now})
  this.scopes.delete(key);this.scopes.set(key,saved.slice(-this.config.maxRepliesPerScope))
  while(this.scopes.size>this.config.maxScopes){const first=this.scopes.keys().next().value;if(first!==undefined)this.scopes.delete(first)}
 }
}
/** @param ctx - DSH profile context. @param config - validated limits. */
export function apply(ctx:Context,config:Config):void{
 if(!config.enabled)return
 validateConfig(config)
 if(ctx.get('qqTurnPolicy'))throw new Error('Another turn policy is already installed')
 if(config.intentEnabled&&!ctx.get('qqTurnIntent'))throw new Error('Intent classifier is unavailable')
 ctx.effect(()=>ctx.provide('qqTurnPolicy',new QuotePolicy(config,()=>performance.now(),()=>ctx.get('qqTurnIntent'))))
}
