/** Bounded group-local context for an independently installed intent classifier. */
import {scopeKey,type InboundMessage,type MessageId,type ScopeKey,type UserId} from 'dsh-im-kit'
import {randomUUID} from 'node:crypto'
import {brandString,type Branded} from '@deepseek-ai/dsh-brand'
import type {ChatResult} from 'dsh-qq-chat'

/** One text-only observation presented to a classifier; speaker aliases are scoped to one call. */
export interface IntentTurn{readonly speaker:string;readonly text:string;readonly truncated:boolean;readonly media:readonly string[];readonly mentions:readonly string[];readonly hasReply:boolean;readonly directedToBot?:boolean;readonly replyTo?:{readonly speaker:string;readonly text:string;readonly truncated:boolean;readonly media:readonly string[]};readonly respondingTo?:string}
/** Ephemeral conversation identity for classifier session isolation; changes on eviction or restart. */
export type IntentContextId=Branded<'qq-turn.intent-context'>
/** Metadata excludes account, group, sender and message IDs; user text remains untrusted. */
export interface IntentRequest{readonly contextId:IntentContextId;readonly history:readonly IntentTurn[];readonly candidate:IntentTurn}
/** Independently supplied intent classifier; it must stop owned work when the signal aborts. */
export interface TurnIntent{
 /** @param request - bounded, untrusted conversation data. @param signal - routing lifetime. @returns reply, ignore, or delegation to the basic trigger. */
 classify(request:IntentRequest,signal:AbortSignal):Promise<'reply'|'ignore'|'default'>
}
/** Runtime context limits supplied by the native profile. */
export interface ContextLimits{readonly maxScopes:number;readonly contextWindowMs:number;readonly maxContextMessages:number;readonly maxContextChars:number}
interface Entry{readonly id:MessageId|null;readonly sender:UserId|null;readonly at:number;readonly text:string;readonly truncated:boolean;readonly media:readonly string[];readonly mentions:readonly UserId[];readonly hasReply:boolean;readonly directedToBot:boolean;readonly replyIds:readonly MessageId[];readonly target:MessageId|null;readonly respondingTo:UserId|null}
interface Window{readonly id:IntentContextId;readonly entries:Entry[]}
function wellFormed(value:string):string{return value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,'\uFFFD')}

/** Group-local memory is transient and never substitutes for a durable archive. */
export class RecentContext{
 private readonly scopes=new Map<ScopeKey,Window>()
 /** @param limits - resolved profile limits. @param clock - monotonic milliseconds. */
 constructor(private readonly limits:ContextLimits,private readonly clock:()=>number=()=>performance.now()){}
 /** Discard transient windows without changing durable Chat or classifier Session data. */
 clear():void{this.scopes.clear()}
 private remember(key:ScopeKey,entry:Entry):void{
  const now=this.clock(),old=this.scopes.get(key),entries=(old?.entries??[]).filter(item=>now>=item.at&&now-item.at<=this.limits.contextWindowMs)
  if(entry.id!==null&&entries.some(item=>item.id===entry.id))return
  const id=old&&entries.length?old.id:brandString<IntentContextId>(randomUUID())
  entries.push(entry);this.scopes.delete(key);this.scopes.set(key,{id,entries:entries.slice(-this.limits.maxContextMessages)})
  while(this.scopes.size>this.limits.maxScopes){const first=this.scopes.keys().next().value;if(first!==undefined)this.scopes.delete(first)}
 }
 /** @param input - fresh, admitted source. */
 seen(input:InboundMessage):void{
  if(input.scope.kind!=='group')return
  let text='',truncated=false,hasReply=false;const media:string[]=[],mentions:UserId[]=[],targets:MessageId[]=[]
  for(const part of input.parts){
   if(part.type==='text'){
    const remaining=this.limits.maxContextChars-text.length
    if(part.text.length>remaining)truncated=true
    if(remaining>0)text+=part.text.slice(0,remaining)
   }else if(part.type==='mention'){
    if(!mentions.includes(part.userId)){if(mentions.length<this.limits.maxContextMessages)mentions.push(part.userId);else truncated=true}
   }else if(part.type==='reply'){hasReply=true;if(targets.length<2)targets.push(part.messageId)}
   else if(part.type==='image'||part.type==='audio'||part.type==='video'||part.type==='file'||part.type==='forward'||part.type==='card'){
    if(!media.includes(part.type))media.push(part.type)
   }
  }
  this.remember(scopeKey(input.scope),{id:input.messageId,sender:input.senderId,at:this.clock(),text:wellFormed(text),truncated,media,mentions,hasReply,directedToBot:input.directedToBot,replyIds:[],target:targets.length===1?targets[0]!:null,respondingTo:null})
 }
 /** @param input - source that caused the result. @param result - completed transport outcome. */
 observe(input:InboundMessage,result:ChatResult):void{
  if(input.scope.kind!=='group'||result.status!=='responded'||result.modelOutcome!=='completed'||result.receipt?.status!=='accepted'||result.reply===null)return
  const text=wellFormed(result.reply.slice(0,this.limits.maxContextChars))
  this.remember(scopeKey(input.scope),{id:null,sender:null,at:this.clock(),text,truncated:result.reply.length>text.length,media:[],mentions:[],hasReply:false,directedToBot:false,replyIds:result.receipt.messageIds.slice(0,this.limits.maxContextMessages),target:null,respondingTo:input.senderId})
 }
 /** @param input - exact candidate. @returns bounded context ending at the candidate, or null when absent or expired. */
 request(input:InboundMessage):IntentRequest|null{
  if(input.scope.kind!=='group')return null
  const window=this.scopes.get(scopeKey(input.scope));if(!window)return null
  const entries=window.entries,now=this.clock(),index=entries.findIndex(item=>item.id===input.messageId)
  if(index<0||now<entries[index]!.at||now-entries[index]!.at>this.limits.contextWindowMs)return null
  const relevant=entries.slice(0,index+1).filter(item=>now>=item.at&&now-item.at<=this.limits.contextWindowMs),aliases=new Map<UserId,string>()
  const alias=(user:UserId):string=>{const name=aliases.get(user)??'member-'+(aliases.size+1);aliases.set(user,name);return name}
  const convert=(item:Entry,index:number):IntentTurn=>{
   let speaker='bot'
   if(item.sender!==null)speaker=alias(item.sender)
   const target=item.target===null?undefined:relevant.slice(0,index).find(entry=>entry.id===item.target||entry.replyIds.includes(item.target!))
   return{speaker,text:item.text,truncated:item.truncated,media:[...item.media],mentions:item.mentions.map(alias),hasReply:item.hasReply,...item.directedToBot?{directedToBot:true}:{},...target?{replyTo:{speaker:target.sender===null?'bot':alias(target.sender),text:target.text,truncated:target.truncated,media:[...target.media]}}:{},...item.respondingTo===null?{}:{respondingTo:alias(item.respondingTo)}}
  }
  const turns=relevant.map(convert),candidate=turns.pop()
  return candidate?{contextId:window.id,history:turns,candidate}:null
 }
}
