/** Browser-safe native owner controls for one saved policy. */
import type {Settings} from './fields.ts'
import type {} from '@deepseek-ai/dsh-typert-protocol/types'
/** Saved configuration and separately observed runtime availability. */
export interface Snapshot{readonly config:Settings;readonly revision:string;readonly active:boolean;readonly entryDisabled:boolean;readonly refreshMs:number}
/** Revision-checked partial settings. */
export interface SaveRequest{readonly revision:string;readonly patch:Partial<Settings>}
/** Sanitized operator failures. */
export type Failure='forbidden'|'cancelled'|'invalid'|'conflict'|'unavailable'|'apply-failed'
declare module '@deepseek-ai/dsh-typert-protocol/types'{interface RemoteErrorDetailsMap{
 /** Native settings failure without source or provider details. */
 'qq-turn/control':{readonly reason:Failure}
}}
