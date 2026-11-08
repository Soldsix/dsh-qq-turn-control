import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import Control,{Config as ControlConfig} from '../dist/control.js'
import {Config,QuotePolicy} from '../dist/index.js'
import {saveSchema,snapshotSchema} from '../dist/control-codecs.js'

async function mount(t,{otherPolicy=false}={}){
 const ctx=new Context(),writes=[]
 const entry={options:{id:'qq-turn-control',name:'dsh-qq-turn-control',config:{}},disabled:false,fiber:{config:{},effectiveConfig:Config({}),state:2}}
 const editor={entries:()=>[entry],async edit(target,change){assert.equal(target,entry);const next=change(entry.options.config);writes.push(next);entry.options.config=next;entry.fiber.effectiveConfig=Config(next)}}
 const fixture=ctx.plugin({name:'turn-control-fixture',apply(ctx){ctx.effect(()=>ctx.provide('configEditor',editor));if(otherPolicy)ctx.effect(()=>ctx.provide('qqTurnPolicy',{async decide(){return'default'},observe(){}}))}});await fixture.await()
 const fiber=ctx.plugin(Control,ControlConfig({}));await fiber.await();t.after(async()=>{await fiber.dispose();await fixture.dispose()})
 return{ctx,control:ctx.qqTurnControl,entry,writes}
}
test('settings use effective values and reject stale, invalid or extra edits without writing',async t=>{
 const {control,entry,writes}=await mount(t),original=await control.describe()
 assert.equal(snapshotSchema.safeParse(original).success,true);assert.equal(original.config.enabled,false);assert.equal(original.intentAvailable,false)
 entry.fiber.config={enabled:true,quoteWindowMs:{'!!js':'synthetic'}};assert.equal((await control.describe()).config.enabled,false)
 const saved=await control.save({revision:original.revision,patch:{enabled:true,quoteWindowMs:9000}});assert.equal(saved.config.quoteWindowMs,9000);assert.equal(writes.length,1)
 await assert.rejects(control.save({revision:original.revision,patch:{enabled:false}}),error=>error.details?.reason==='conflict')
 await assert.rejects(control.save({revision:saved.revision,patch:{maxScopes:0}}),error=>error.details?.reason==='invalid')
 await assert.rejects(control.save({revision:saved.revision,patch:{intentEnabled:true}}),error=>error.details?.reason==='classifier-missing')
 await assert.rejects(async()=>control.save({revision:saved.revision,patch:{credential:'synthetic'}}),error=>error.details?.reason==='invalid')
 assert.equal(writes.length,1);assert.equal(saveSchema.safeParse({revision:saved.revision,patch:{unknown:true}}).success,false)
})
test('another provider does not appear as this policy being active',async t=>{
 const {control,entry}=await mount(t,{otherPolicy:true});entry.fiber.effectiveConfig=Config({enabled:true})
 assert.equal((await control.describe()).active,false)
})
test('the installed quote provider is reported active only while its row and settings are enabled',async t=>{
 const ctx=new Context(),entry={options:{id:'qq-turn-control',name:'dsh-qq-turn-control'},disabled:false,fiber:{effectiveConfig:Config({enabled:true}),state:2}}
 const fixture=ctx.plugin({name:'turn-active-fixture',apply(ctx){ctx.effect(()=>ctx.provide('configEditor',{entries:()=>[entry]}));ctx.effect(()=>ctx.provide('qqTurnPolicy',new QuotePolicy(Config({enabled:true}))))}});await fixture.await()
 const fiber=ctx.plugin(Control,ControlConfig({}));await fiber.await();t.after(async()=>{await fiber.dispose();await fixture.dispose()})
 assert.equal((await ctx.qqTurnControl.describe()).active,true);entry.disabled=true;assert.equal((await ctx.qqTurnControl.describe()).active,false)
})
test('intent provider availability follows its independent service lifetime',async t=>{
 const ctx=new Context(),entry={options:{id:'qq-turn-control',name:'dsh-qq-turn-control'},disabled:false,fiber:{effectiveConfig:Config({}),state:2}}
 const fixture=ctx.plugin({name:'turn-intent-status-fixture',apply(ctx){ctx.effect(()=>ctx.provide('configEditor',{entries:()=>[entry]}))}});await fixture.await()
 const fiber=ctx.plugin(Control,ControlConfig({}));await fiber.await();t.after(async()=>{await fiber.dispose();await fixture.dispose()})
 assert.equal((await ctx.qqTurnControl.describe()).intentAvailable,false)
 const provider=ctx.plugin({name:'synthetic-intent',apply(ctx){ctx.effect(()=>ctx.provide('qqTurnIntent',{async classify(){return'default'}}))}});await provider.await()
 assert.equal((await ctx.qqTurnControl.describe()).intentAvailable,true);await provider.dispose();assert.equal((await ctx.qqTurnControl.describe()).intentAvailable,false)
})
test('policy can be disabled after an enabled intent provider disappears',async t=>{
 const {ctx,control}=await mount(t),provider=ctx.plugin({name:'synthetic-optional-intent',apply(ctx){ctx.effect(()=>ctx.provide('qqTurnIntent',{async classify(){return'default'}}))}});await provider.await()
 const initial=await control.describe(),saved=await control.save({revision:initial.revision,patch:{enabled:true,intentEnabled:true}})
 await provider.dispose();const disabled=await control.save({revision:saved.revision,patch:{enabled:false}})
 assert.equal(disabled.config.enabled,false);assert.equal(disabled.intentAvailable,false)
})
