/** Native owner page retains drafts while runtime state changes. */
import {useEffect,useId,useRef,useState,type ReactNode} from 'react'
import {Button,Input,Switch,Toast} from '@deepseek-ai/dsh-client-ui-primitives'
import type {HostObservable,InjectFace,PropsLocale,PropsRuntime} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {Settings} from '../fields.ts'
import type {Snapshot,SaveRequest,Failure} from '../control-types.ts'
/** Localized failure without remote diagnostics. */
export class PageProblem extends Error{constructor(readonly reason:Failure){super(reason)}}
/** Owner operations for the native bundle page. */
export interface PageFace{readonly read:()=>Promise<Snapshot>;readonly save:(request:SaveRequest)=>Promise<Snapshot>;readonly notify:(text:string,success:boolean)=>void}
/** App-wide transient notification. */
export interface Notice{readonly id:number;readonly text:string;readonly success:boolean}
/** Observable notification and dismissal. */
export interface NoticeFace{readonly hooks:{readonly notice:HostObservable<Notice|null>};readonly dismiss:(id:number)=>void}
/** @param props - notification subscription. @returns native toast when present. */
export function NoticeHost({useNotice,dismiss}:InjectFace<NoticeFace>):ReactNode{const value=useNotice(item=>item);return value?<Toast key={value.id} text={value.text} {...value.success?{tone:'success' as const}:{}} onDone={()=>dismiss(value.id)}/>:null}
/** @param props - slot view, locale and owner operations. @returns the bundle settings page. */
export function Page({view,...props}:PropsRuntime<'plugins.bundle.config'>&PropsLocale<'qqTurn'>&PageFace):ReactNode{return view==='page'?<Form {...props}/>:null}
function Form({t,read,save,notify}:PropsLocale<'qqTurn'>&PageFace):ReactNode{
 const id=useId(),alive=useRef(true),editing=useRef(false),writing=useRef(false),sequence=useRef(0)
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[baseline,setBaseline]=useState<Snapshot|null>(null),[draft,setDraft]=useState<Partial<Record<keyof Settings,string|boolean>>>({}),[failed,setFailed]=useState(false),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0)
 const dirty=Object.keys(draft).length>0;editing.current=dirty
 function accept(value:Snapshot,reset:boolean){setSnapshot(value);if(reset||!editing.current&&!writing.current){setBaseline(value);setDraft({})}}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++}},[])
 useEffect(()=>{let current=true,timer:ReturnType<typeof setTimeout>|undefined
  const poll=async()=>{const turn=++sequence.current;try{const value=await read();if(current&&turn===sequence.current){accept(value,false);setFailed(false)}if(current)timer=setTimeout(()=>{void poll()},value.refreshMs)}catch(error){if(current&&turn===sequence.current)setFailed(true)}}
  void poll();return()=>{current=false;sequence.current++;clearTimeout(timer)}
 },[read,refresh])
 async function submit():Promise<void>{
  if(!baseline||writing.current||!dirty)return
  const patch:Partial<Settings>={}
  for(const key of ['enabled','quoteWindowMs','maxScopes','maxRepliesPerScope'] as const){const raw=draft[key];if(raw===undefined)continue;if(key==='enabled'){if(typeof raw!=='boolean'){notify(t('invalid'),false);return}patch.enabled=raw}else{if(typeof raw!=='string'||!/^\d+$/.test(raw.trim())||!Number.isSafeInteger(Number(raw))){notify(t('invalid'),false);return}patch[key]=Number(raw)}}
  writing.current=true;sequence.current++;setBusy(true)
  try{const result=await save({revision:baseline.revision,patch});notify(t('saved'),true);if(alive.current){accept(result,true);setRefresh(value=>value+1)}}catch(error){notify(error instanceof PageProblem?t(error.reason):t('unavailable'),false)}finally{writing.current=false;if(alive.current)setBusy(false)}
 }
 if(!snapshot||!baseline)return<section className="qqturn-page">{failed?<div role="alert"><p>{t('load')}</p><Button onClick={()=>setRefresh(value=>value+1)}>{t('refresh')}</Button></div>:<span className="qqturn-spinner" role="status" aria-label={t('loading')}/>}</section>
 const numberField=(key:'quoteWindowMs'|'maxScopes'|'maxRepliesPerScope',label:'window'|'scopes'|'replies')=><div className="qqturn-field" key={key}><label htmlFor={`${id}-${key}`}>{t(label)}</label><Input id={`${id}-${key}`} type="number" disabled={busy} value={String(draft[key]??baseline.config[key])} onChange={event=>{const next=event.currentTarget.value;setDraft(value=>({...value,[key]:next}))}}/></div>
 return<section className="qqturn-page"><p className="qqturn-help">{t('intro')}</p><p aria-live="polite">{t(snapshot.active?'active':'inactive')}</p>{snapshot.entryDisabled&&<p className="qqturn-help">{t('entryDisabled')}</p>}{failed&&<p role="alert">{t('load')}</p>}<form onSubmit={event=>{event.preventDefault();void submit()}}><div className="qqturn-field"><span>{t('enabled')}</span><Switch label={t('enabled')} disabled={busy} checked={(draft.enabled??baseline.config.enabled)===true} onChange={value=>setDraft(previous=>({...previous,enabled:value}))}/></div>{numberField('quoteWindowMs','window')}{numberField('maxScopes','scopes')}{numberField('maxRepliesPerScope','replies')}<p className="qqturn-help">{t('reset')}</p>{dirty&&<p role="status">{t(snapshot.revision===baseline.revision?'dirty':'stale')}</p>}<div className="qqturn-actions"><Button type="submit" variant="primary" disabled={busy||!dirty}>{t('save')}</Button><Button type="button" disabled={busy||!dirty} onClick={()=>accept(snapshot,true)}>{t('discard')}</Button><Button type="button" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>{t('refresh')}</Button></div></form></section>
}
