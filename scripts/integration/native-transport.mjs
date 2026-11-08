/** Owned in-process transport captures only synthetic messages. */
import {ImRuntime,identifier} from 'dsh-im-kit'
export const name='turn-test-transport'
export function apply(ctx){
 const im=new ImRuntime(),outputs=[]
 const account={tenantId:identifier('im.tenant','fixture'),networkId:identifier('im.network','fixture'),accountId:identifier('im.account','bot')}
 const release=im.register({account,async availability(){return 'available'},async send(message){outputs.push(structuredClone(message));return{status:'accepted',messageIds:[identifier('im.message','reply-'+outputs.length)]}},async dispose(){}})
 ctx.effect(()=>async()=>{await release();await im.close()})
 ctx.effect(()=>ctx.provide('im',im));ctx.effect(()=>ctx.provide('turnTest',{account,outputs}))
}
