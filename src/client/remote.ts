/** Client descriptors validate native requests and responses. */
import type {RemoteResult,TypertRemoteContribution} from '@deepseek-ai/dsh-typert-protocol/types'
import type {Snapshot,SaveRequest} from '../control-types.ts'
import {saveSchema,snapshotSchema} from '../control-codecs.ts'
declare module '@deepseek-ai/dsh-typert-protocol/types'{interface TypertRemoteNamespaceMap{
 /** Owner-only routing settings. */
 qqTurnControl:{describe():Promise<RemoteResult<Snapshot>>;save(request:SaveRequest):Promise<RemoteResult<Snapshot>>}
}}
/** Strict descriptors match the Host's declared operations. */
export const remote:TypertRemoteContribution={package:'dsh-qq-turn-control',descriptors:['describe','save'].map(method=>({id:`qqTurnControl/${method}`,service:'qqTurnControl',namespace:'qqTurnControl',method,invocation:{kind:'direct'},parameters:method==='describe'?[]:[{name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:'dsh-qq-turn-control#saveRequest',create:()=>saveSchema}}],result:{mode:'strict',typeSymbol:'dsh-qq-turn-control#snapshot',create:()=>snapshotSchema}}))}
