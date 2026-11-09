/** Synchronous group-local reservations bound concurrent ambient and other-bot replies. */
import {scopeKey,type InboundMessage,type ScopeKey,type UserId} from 'dsh-im-kit'
import type {Settings} from './fields.ts'
interface Window{readonly ambient:number[];readonly bots:{sender:UserId;at:number}[]}
/** Reservations count admitted attempts, including failed generation or delivery; they never retry. */
export class ReplyBudget{
 private readonly scopes=new Map<ScopeKey,Window>()
 /** @param config - resolved operator limits. @param clock - monotonic milliseconds. */
 constructor(private readonly config:Settings,private readonly clock:()=>number){}
 /** Discard transient reservations on policy shutdown. */
 clear():void{this.scopes.clear()}
 /** @param input - exact group and sender. @param kind - automatic human continuation or explicitly addressed known bot. @returns whether one attempt was reserved atomically before asynchronous computation. */
 reserve(input:InboundMessage,kind:'ambient'|'bot'):boolean{
  const key=scopeKey(input.scope),now=this.clock(),old=this.scopes.get(key)
  const ambient=(old?.ambient??[]).filter(at=>now>=at&&now-at<this.config.ambientWindowMs)
  const bots=(old?.bots??[]).filter(item=>now>=item.at&&now-item.at<this.config.botWindowMs)
  if(kind==='ambient'){
   const last=ambient.at(-1)
   if(ambient.length>=this.config.maxAmbientReplies||last!==undefined&&now-last<this.config.minAmbientGapMs)return false
   ambient.push(now)
  }else{
   if(bots.length>=this.config.maxBotGroupReplies||bots.filter(item=>item.sender===input.senderId).length>=this.config.maxBotReplies)return false
   bots.push({sender:input.senderId,at:now})
  }
  this.scopes.delete(key);this.scopes.set(key,{ambient,bots})
  while(this.scopes.size>this.config.maxScopes){const oldest=this.scopes.keys().next().value;if(oldest!==undefined)this.scopes.delete(oldest)}
  return true
 }
}
