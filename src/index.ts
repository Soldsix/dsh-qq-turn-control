/** Optional bounded quote routing; it retains only accepted reply identities in memory. */
import type {Context} from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {scopeKey,type InboundMessage,type MessageId,type ScopeKey} from 'dsh-im-kit'
import type {ChatResult,ChatTurnPolicy} from 'dsh-qq-chat'

/** Runtime limits for accepted-reply correlation. */
export interface Config{enabled:boolean;quoteWindowMs:number;maxScopes:number;maxRepliesPerScope:number}
/** The provider is disabled until an operator enables its bundle entry. */
export const Config:z<Config>=z.object({enabled:z.boolean().default(false),quoteWindowMs:z.number().min(0).max(3600000).step(1).default(300000),maxScopes:z.number().min(1).max(100000).step(1).default(1024),maxRepliesPerScope:z.number().min(1).max(100).step(1).default(10)})
/** Native bundle identity. */
export const name='qq-turn-control'
type Reply={readonly id:MessageId;readonly time:number}
/** Exact reply IDs avoid confusing references to a different group or account. */
export class QuotePolicy implements ChatTurnPolicy{
 private readonly scopes=new Map<ScopeKey,Reply[]>()
 constructor(private readonly config:Config){}
 /** @param input - original normalized message. @param signal - caller cancellation. @returns reply only for an unexpired quote of this bot's accepted output. */
 async decide(input:InboundMessage,signal:AbortSignal):Promise<'reply'|'default'>{
  signal.throwIfAborted();if(input.scope.kind!=='group'||input.directedToBot)return'default'
  const saved=this.scopes.get(scopeKey(input.scope))??[],now=Date.now()
  return input.parts.some(part=>part.type==='reply'&&saved.some(reply=>reply.id===part.messageId&&now-reply.time<=this.config.quoteWindowMs&&now>=reply.time))?'reply':'default'
 }
 /** @param input - original source. @param result - actual model and delivery outcome. */
 observe(input:InboundMessage,result:ChatResult):void{
  if(input.scope.kind!=='group'||result.status!=='responded'||result.modelOutcome!=='completed'||result.receipt?.status!=='accepted'||!result.receipt.messageIds.length)return
  const key=scopeKey(input.scope),now=Date.now(),saved=(this.scopes.get(key)??[]).filter(item=>now-item.time<=this.config.quoteWindowMs)
  for(const id of result.receipt.messageIds)saved.push({id,time:now})
  this.scopes.delete(key);this.scopes.set(key,saved.slice(-this.config.maxRepliesPerScope))
  while(this.scopes.size>this.config.maxScopes){const first=this.scopes.keys().next().value;if(first!==undefined)this.scopes.delete(first)}
 }
}
/** @param ctx - DSH profile context. @param config - validated limits. */
export function apply(ctx:Context,config:Config):void{if(config.enabled)ctx.effect(()=>ctx.provide('qqTurnPolicy',new QuotePolicy(config)))}
