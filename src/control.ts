/** Owner-only settings persist independently of policy runtime reloads. */
import {createHash} from 'node:crypto'
import type {Context} from '@deepseek-ai/cordis'
import type {Entry} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import {Remote,RemoteError,TypertRemoteService,principalOf} from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from './index.ts'
import {Config as RuntimeConfig,QuotePolicy,validateConfig} from './index.ts'
import {FIELDS,type Settings} from './fields.ts'
import {saveSchema} from './control-codecs.ts'
import type {Failure,Snapshot} from './control-types.ts'

/** Target row and polling interval are explicitly configurable. */
export interface ControlConfig{targetEntryId:string;statusRefreshMs:number}
/** Control remains active when policy execution is disabled. */
export const Config:z<ControlConfig>=z.object({targetEntryId:z.string().default('qq-turn-control'),statusRefreshMs:z.number().min(250).max(60000).step(1).default(3000)})
declare module '@deepseek-ai/cordis'{interface Context{readonly qqTurnControl:TurnControl}}
const fail=(reason:Failure)=>new RemoteError('qq-turn/control','Turn control operation could not complete',{reason})
function parse(value:unknown):Settings{
 try{if(typeof value!=='object'||!value||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(FIELDS,key)))throw fail('invalid');const config=z.resolve(value,RuntimeConfig,{})[0];validateConfig(config);return config}catch(error){throw fail('invalid')}
}
function revision(value:Settings):string{return createHash('sha256').update(JSON.stringify(Object.keys(FIELDS).map(key=>[key,value[key as keyof Settings]]))).digest('hex')}
/** Saved settings are changed only by the profile owner. */
export class TurnControl extends TypertRemoteService{
 static inject=['configEditor']
 static Config=Config
 private readonly lifetime=new AbortController()
 private tail:Promise<void>=Promise.resolve()
 constructor(ctx:Context,private readonly config:ControlConfig){super(ctx,'qqTurnControl');if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(config.targetEntryId))throw new Error('Invalid target entry');ctx.effect(()=>async()=>{this.lifetime.abort();await this.tail})}
 private owner():void{if(principalOf(this.ctx.invocation))throw fail('forbidden');if(this.lifetime.signal.aborted||this.ctx.invocation?.signal.aborted)throw fail('cancelled')}
 private target():Entry{const all=this.ctx.configEditor.entries(),entry=all.find(value=>value.options.id===this.config.targetEntryId);if(!entry||entry.options.name!=='dsh-qq-turn-control'||!entry.fiber||all.some(value=>value!==entry&&value.options.name==='dsh-qq-turn-control'))throw fail('unavailable');return entry}
 private snapshot():Snapshot{const entry=this.target(),config=parse(entry.fiber?.effectiveConfig),provider=this.ctx.get('qqTurnPolicy');return{config:structuredClone(config),revision:revision(config),active:config.enabled&&!entry.disabled&&entry.fiber?.state===2&&provider instanceof QuotePolicy,intentAvailable:Boolean(this.ctx.get('qqTurnIntent')),entryDisabled:entry.disabled,refreshMs:this.config.statusRefreshMs}}
 private serial<T>(operation:()=>Promise<T>):Promise<T>{this.owner();const task=this.tail.then(()=>{if(this.lifetime.signal.aborted)throw fail('cancelled');return operation()});this.tail=task.then(()=>{},()=>{});return task}
 /** @returns detached saved settings and runtime metadata. */
 @Remote
 describe():Promise<Snapshot>{return this.serial(async()=>this.snapshot())}
 /** @param request - expected revision and declared changed fields. @returns settings after the awaited profile edit. */
 @Remote
 save(request:unknown):Promise<Snapshot>{
  this.owner();let edit:ReturnType<typeof saveSchema.parse>;try{edit=saveSchema.parse(request)}catch(error){throw fail('invalid')}
  return this.serial(async()=>{
   const entry=this.target(),current=parse(entry.fiber?.effectiveConfig);if(revision(current)!==edit.revision)throw fail('conflict');const next=parse({...current,...edit.patch})
   if(next.intentEnabled&&(next.enabled||edit.patch.intentEnabled===true)&&!this.ctx.get('qqTurnIntent'))throw fail('classifier-missing')
   let conflict=false
   try{await this.ctx.configEditor.edit(entry,raw=>{if(revision(parse(entry.fiber?.effectiveConfig))!==edit.revision){conflict=true;throw fail('conflict')}return{...raw,...edit.patch}})}catch(error){throw fail(conflict?'conflict':'apply-failed')}
   return this.snapshot()
  })
 }
}
export default TurnControl
