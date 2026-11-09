/** Install independent archives in a fresh SDK profile and test the real native Chat path. */
import assert from 'node:assert/strict'
import {pnpmScript} from './pnpm.mjs'
import {requiredProfilePeers} from './profile-peers.mjs'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createServer} from 'node:http'
import {createHash} from 'node:crypto'
import {mkdtemp,mkdir,readFile,writeFile,copyFile,realpath} from 'node:fs/promises'
import {join,basename,relative,isAbsolute,delimiter} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {verifyInstalledArchive} from './verify-installed.mjs'
import {parse} from 'yaml'

const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv
const argument=name=>{const index=args.indexOf(name);assert.ok(index>=0&&args[index+1],'Required '+name);return args[index+1]}
const library=await realpath(argument('--im-kit-archive')),chat=await realpath(argument('--chat-archive')),manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
const runs=join(root,'.test-artifacts','native');await mkdir(runs,{recursive:true})
const resume=args.indexOf('--resume-run'),resumed=resume>=0,area=resumed?await realpath(args[resume+1]):await mkdtemp(join(runs,'install-'))
const owned=relative(runs,area);assert.ok(!owned.startsWith('..')&&!isAbsolute(owned),'Resume target escaped owned native-test directory')
const attempt=await mkdtemp(join(area,'attempt-')),home=join(area,'home'),profile='turn-control-native',profileRoot=join(home,'profiles',profile),archives=[]
for(const source of[library,chat,join(root,'artifacts',manifest.name+'-'+manifest.version+'.tgz')]){const path=join(attempt,basename(source));await copyFile(source,path);archives.push({path,name:basename(source),sha256:createHash('sha256').update(await readFile(path)).digest('hex')})}
await writeFile(join(attempt,'inputs.json'),JSON.stringify(archives.map(({name,sha256})=>({name,sha256})),null,2)+'\n')
const captures=[];let active=0,peak=0,holds=0,parallelArrivals=0,releaseParallel
const parallel=new Promise(resolve=>{releaseParallel=resolve})
function marker(data){for(const message of[...data.messages??[]].reverse())if(message.role==='user')for(const block of[...typeof message.content==='string'?[{text:message.content}]:Array.isArray(message.content)?message.content:[]].reverse()){const found=typeof block.text==='string'&&block.text.match(/LAB_(?:PARALLEL_[AB]|FIFTEEN_\d+|AFTER_CANCEL|FIRST|FOLLOW|HOLD)\b/);if(found)return found[0]}return'none'}
const server=createServer(async(request,response)=>{
 if(request.url==='/fixture/status'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({requests:captures.length,active,holds}));return}
 if(request.url?.endsWith('/models')){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({object:'list',data:[{id:'deepseek-flash',object:'model',owned_by:'fixture',input_modalities:['text'],output_modalities:['text'],api_capabilities:{anthropic_messages:{}}}]}));return}
 if(!request.url?.endsWith('/messages')){response.statusCode=404;response.end();return}
 let raw='';for await(const chunk of request)raw+=chunk
 const data=JSON.parse(raw),current=marker(data);captures.push(data);const serial=captures.length
 active++;peak=Math.max(peak,active);if(current==='LAB_HOLD')holds++
 const closed=new AbortController();response.once('close',()=>closed.abort())
 try{
  response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'})
  if(current.startsWith('LAB_PARALLEL_')){parallelArrivals++;if(parallelArrivals===2)releaseParallel();await Promise.race([parallel,new Promise((_,reject)=>closed.signal.addEventListener('abort',()=>reject(Error('closed')),{once:true}))])}
  if(current==='LAB_HOLD')await delay(30000,undefined,{signal:closed.signal})
  const send=(type,payload)=>response.write('event: '+type+'\ndata: '+JSON.stringify({type,...payload})+'\n\n')
  send('message_start',{message:{id:'lab-fixture-'+serial,type:'message',role:'assistant',model:data.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}})
  send('content_block_start',{index:0,content_block:{type:'thinking',thinking:'',signature:''}})
  send('content_block_delta',{index:0,delta:{type:'thinking_delta',thinking:'SYNTHETIC_NOT_PUBLIC'}})
  send('content_block_delta',{index:0,delta:{type:'signature_delta',signature:'synthetic-local-signature'}});send('content_block_stop',{index:0})
  send('content_block_start',{index:1,content_block:{type:'text',text:''}});send('content_block_delta',{index:1,delta:{type:'text_delta',text:'LAB_REPLY_'+serial}});send('content_block_stop',{index:1})
  send('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:10}});send('message_stop',{});response.end()
 }catch(error){if(!closed.signal.aborted)response.destroy(error)}finally{active--;if(current==='LAB_HOLD')holds--}
})
server.listen(0,'127.0.0.1');await once(server,'listening');server.unref()
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|SECRET|TOKEN|PASSWORD|^NPM_CONFIG_CACHE$/i.test(key)))
env.NPM_CONFIG_CACHE=join(root,'.npm-cache')
await mkdir(join(attempt,'temp'),{recursive:true})
Object.assign(env,{DSH_HOME:home,TEMP:join(attempt,'temp'),TMP:join(attempt,'temp'),DSH_PRIMARY_RUNTIME:'',DSH_SYSTEM_PROMPT:'Synthetic local Lab acceptance. No private persona or skills.',DEEPSEEK_API_KEY:'synthetic-loopback-only',DEEPSEEK_BASE_URL:'http://127.0.0.1:'+server.address().port+'/anthropic'})
const dsh=join(root,'node_modules','@deepseek-ai','dsh','lib','bin.js'),commands=[]
async function run(argv,cwd){
 const deadline=AbortSignal.timeout(300000),child=spawn(process.execPath,argv,{cwd,env,windowsHide:true,signal:deadline,stdio:['ignore','pipe','pipe']})
 await writeFile(join(attempt,'setup-live.json'),JSON.stringify({pid:child.pid,startedAt:new Date().toISOString()})+'\n')
 let stdout='',stderr='',failure;child.stdout.on('data',data=>{stdout+=data});child.stderr.on('data',data=>{stderr+=data});child.once('error',error=>{failure=error})
 const [code,signal]=await new Promise(resolve=>child.once('close',(...values)=>resolve(values)))
 commands.push({argv,code,signal,timedOut:deadline.aborted,stdout,stderr});await writeFile(join(attempt,'installation.json'),JSON.stringify(commands,null,2)+'\n')
 if(failure)throw failure;assert.equal(deadline.aborted,false,'Setup timed out');assert.equal(signal,null);assert.equal(code,0,stderr.slice(-1400));return stdout
}
if(!resumed){const composition=await run([dsh,'--profile',profile,'--from-default-profile','sdk','--dump-config'],area);assert.ok(!composition.includes('@deepseek-ai/dsh-agent-preset-registry'),'SDK template now supplies a registry; update the fixture explicitly')}
const profileManifest=JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8'));profileManifest.pnpm={...profileManifest.pnpm,overrides:{...manifest.overrides,...args.includes('--candidate-inputs')?{'dsh-im-kit':'file:'+archives[0].path,'dsh-qq-chat':'file:'+archives[1].path}:{}}};await writeFile(join(profileRoot,'package.json'),JSON.stringify(profileManifest,null,2)+'\n')
await writeFile(join(profileRoot,'.npmrc'),'package-import-method=copy\nstore-dir='+join(root,'.test-artifacts','pnpm-store').replaceAll('\\','/')+'\ncache-dir='+join(root,'.test-artifacts','pnpm-cache').replaceAll('\\','/')+'\n')
const pnpm=await pnpmScript(root)
const peerNames=['@deepseek-ai/cordis@~4.1.0','@deepseek-ai/cordis-plugin-loader@~1.1.0','@deepseek-ai/schemastery@~3.19.0',...['agent','agent-preset-registry','app-boot','brand','llm','session','session-persistence','tools','scope','config-editor','typert-protocol','llm-deepseek-api-key','client-connection'].map(name=>'@deepseek-ai/dsh-'+name+'@0.2.2-rc.1')]
await run([pnpm,'add',archives[0].path,'@deepseek-ai/dsh@0.2.2-rc.1',...peerNames,'--ignore-scripts'],profileRoot)
await run([dsh,'plugin','--profile',profile,'add',archives[1].path],area);await run([dsh,'plugin','--profile',profile,'add',archives[2].path],area)
for(;;){const missing=await requiredProfilePeers(profileRoot);if(!missing.length)break;await run([pnpm,'add',...missing,'--ignore-scripts'],profileRoot)}
const installedFiles={chat:await verifyInstalledArchive(archives[1].path,join(profileRoot,'node_modules','dsh-qq-chat'),join(attempt,'chat-installed-files.json')),turn:await verifyInstalledArchive(archives[2].path,join(profileRoot,'node_modules','dsh-qq-turn-control'),join(attempt,'turn-installed-files.json'))}
for(const name of ['native-transport.mjs','native-probe.mjs'])await copyFile(fileURLToPath(new URL('./'+name,import.meta.url)),join(profileRoot,name))
const fixture=name=>pathToFileURL(join(profileRoot,name)).href
const overlay=[
 {id:'qq-turn-control',config:{enabled:true}},
 {id:'qq-chat-runtime',config:{enabled:true,trigger:'directed',namespace:'turn-'+basename(attempt).toLowerCase(),databasePath:join(attempt,'chat.sqlite3'),workspacePath:join(attempt,'workspace'),presetId:'turn-test-preset',provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'off',maxTokens:128}},
 {id:'session-telemetry-otel',disabled:true},
 {insert:[{id:'turn-preset-registry',name:'@deepseek-ai/dsh-agent-preset-registry',config:{default:'turn-test-preset'}},{id:'turn-preset',name:'@deepseek-ai/dsh-agent-preset',config:{id:'turn-test-preset',plugins:[]}},{id:'turn-transport',name:fixture('native-transport.mjs')},{id:'turn-probe',name:fixture('native-probe.mjs'),config:{resultPath:join(attempt,'result.json')}}]},
]
await writeFile(join(profileRoot,'cordis.patch.yml'),JSON.stringify(overlay,null,2)+'\n')
const child=spawn(process.execPath,[join(profileRoot,'node_modules','@deepseek-ai','dsh','lib','bin.js'),'--profile',profile],{cwd:area,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
let stdoutBytes=0,stderrBytes=0,exitCode,result
child.stdout.on('data',data=>{stdoutBytes+=data.length});child.stderr.on('data',data=>{stderrBytes+=data.length})
const exit=once(child,'close').then(([code,signal])=>{exitCode=code;return{code,signal}})
try{
 const deadline=Date.now()+90000
 while(Date.now()<deadline){try{result=JSON.parse(await readFile(join(attempt,'result.json'),'utf8'));break}catch(error){if(error.code!=='ENOENT')throw error}assert.equal(exitCode,undefined,'Native DSH exited before the routing probe');await delay(30)}
 assert.ok(result,'Native routing probe timed out');assert.equal(result.passed,true,JSON.stringify(result.error));assert.equal(captures.length,15)
 assert.ok(JSON.stringify(captures[1].messages).includes('FIRST'));assert.ok(JSON.stringify(captures[1].messages).includes('LAB_REPLY_1'))
 assert.ok(!JSON.stringify(captures[2].messages).includes('FIRST'),'Conversation history crossed groups')
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'shutdown',params:{}})+'\n')
 const stopped=await Promise.race([exit,delay(15000,undefined,{ref:false}).then(()=>{throw Error('Native shutdown timed out')})]);assert.deepEqual(stopped,{code:0,signal:null})
 const journalPath=join(attempt,'chat.sqlite3'),digest=()=>readFile(journalPath).then(bytes=>createHash('sha256').update(bytes).digest('hex')),original=await digest()
 const names=value=>Array.isArray(value)?value.flatMap(names):value&&typeof value==='object'?[...typeof value.name==='string'?[value.name]:[],...Object.values(value).flatMap(names)]:[]
 const yamlOptions={customTags:[{tag:'tag:yaml.org,2002:js',resolve:value=>value}]}
 await run([dsh,'plugin','--profile',profile,'remove',manifest.name],area)
 const removed=JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8'));assert.equal(removed.dependencies?.[manifest.name],undefined)
 const without=names(parse(await run([dsh,'--profile',profile,'--dump-config'],area),yamlOptions));assert.ok(!without.includes('dsh-qq-turn-control')&&!without.includes('dsh-qq-turn-control/control'))
 assert.equal(await digest(),original,'Removal changed retained Chat receipts')
 await run([dsh,'plugin','--profile',profile,'add',archives[2].path],area)
 await verifyInstalledArchive(archives[2].path,join(profileRoot,'node_modules',manifest.name),join(attempt,'reinstalled-files.json'))
 const restored=names(parse(await run([dsh,'--profile',profile,'--dump-config'],area),yamlOptions));assert.ok(restored.includes('dsh-qq-turn-control')&&restored.includes('dsh-qq-turn-control/control'))
 assert.equal(await digest(),original,'Reinstallation changed retained Chat receipts')
 result.checks.push('native-cli-remove-and-reinstall-retain-chat-journal')
 await writeFile(join(attempt,'summary.json'),JSON.stringify({passed:true,dependencyResolution:args.includes('--candidate-inputs')?'candidate-archive-overrides':'public-manifest',checks:result.checks,archives:archives.map(({name,sha256})=>({name,sha256})),installedFiles,nativeAdapterRequests:captures.length,normalShutdown:true,realQqMessagesSent:0,realModelApiRequests:0,semanticQualityVerified:false},null,2)+'\n')
 console.log(JSON.stringify({area,attempt,passed:true,checks:result.checks,nativeAdapterRequests:captures.length,realQqMessagesSent:0}))
}finally{
 if(exitCode===undefined){child.stdin.end();const fallback=setTimeout(()=>child.kill(),5000);await exit;clearTimeout(fallback)}
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
 await writeFile(join(attempt,'process.json'),JSON.stringify({exitCode,stdoutBytes,stderrBytes,rawProcessOutputPersisted:false},null,2)+'\n')
}
