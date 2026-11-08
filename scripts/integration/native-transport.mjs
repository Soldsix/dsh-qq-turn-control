/** Owned in-process transport captures only synthetic messages. */
import {ImRuntime,identifier} from 'dsh-im-kit'
export const name='turn-test-transport'
export function apply(ctx){
 const im=new ImRuntime(),outputs=[],intentRequests=[];let availability='available'
 const account={tenantId:identifier('im.tenant','fixture'),networkId:identifier('im.network','fixture'),accountId:identifier('im.account','bot')}
 const release=im.register({account,async availability(){return availability},async send(message){outputs.push(structuredClone(message));return{status:'accepted',messageIds:[identifier('im.message','reply-'+outputs.length)]}},async dispose(){}})
 ctx.effect(()=>async()=>{await release();await im.close()})
 ctx.effect(()=>ctx.provide('im',im));ctx.effect(()=>ctx.provide('turnTest',{account,outputs,intentRequests,setAvailability(value){availability=value}}))
 ctx.effect(()=>ctx.provide('qqTurnIntent',{async classify(request,signal){signal.throwIfAborted();intentRequests.push(structuredClone(request));return request.candidate.text==='UNQUOTED_B'&&request.history.some(item=>item.text==='INTENT_FIRST')&&request.history.some(item=>item.text==='LAB_REPLY_5')?'reply':'default'}}))
}
