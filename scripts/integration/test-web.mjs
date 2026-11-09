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

const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv
const argument=name=>{const index=args.indexOf(name);assert.ok(index>=0&&args[index+1],'Required '+name);return args[index+1]}
const library=await realpath(argument('--im-kit-archive')),chat=await realpath(argument('--chat-archive')),manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
const runs=join(root,'.test-artifacts','native-web');await mkdir(runs,{recursive:true})
const resume=args.indexOf('--resume-run'),resumed=resume>=0,area=resumed?await realpath(args[resume+1]):await mkdtemp(join(runs,'install-'))
const owned=relative(runs,area);assert.ok(!owned.startsWith('..')&&!isAbsolute(owned),'Resume target escaped owned native-test directory')
const attempt=await mkdtemp(join(area,'attempt-')),home=join(area,'home'),profile='turn-control-web',profileRoot=join(home,'profiles',profile),archives=[]
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
if(!resumed)await run([dsh,'--profile',profile,'--from-default-profile','web','--dump-config'],area)
const profileManifest=JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8'));profileManifest.pnpm={...profileManifest.pnpm,overrides:{...manifest.overrides,...args.includes('--candidate-inputs')?{'dsh-im-kit':'file:'+archives[0].path,'dsh-qq-chat':'file:'+archives[1].path}:{}}};await writeFile(join(profileRoot,'package.json'),JSON.stringify(profileManifest,null,2)+'\n')
await writeFile(join(profileRoot,'.npmrc'),'package-import-method=copy\nstore-dir='+join(root,'.test-artifacts','pnpm-store').replaceAll('\\','/')+'\ncache-dir='+join(root,'.test-artifacts','pnpm-cache').replaceAll('\\','/')+'\n')
const pnpm=await pnpmScript(root)
const peerNames=['@deepseek-ai/cordis@~4.1.0','@deepseek-ai/cordis-plugin-loader@~1.1.0','@deepseek-ai/schemastery@~3.19.0',...['agent','agent-preset-registry','app-boot','brand','llm','session','session-persistence','tools','scope','config-editor','typert-protocol','llm-deepseek-api-key','client-connection'].map(name=>'@deepseek-ai/dsh-'+name+'@0.2.2-rc.1')]
await run([pnpm,'add',archives[0].path,'@deepseek-ai/dsh@0.2.2-rc.1',...peerNames,'--ignore-scripts'],profileRoot)
await run([dsh,'plugin','--profile',profile,'add',archives[1].path],area);await run([dsh,'plugin','--profile',profile,'add',archives[2].path],area)
for(;;){const missing=await requiredProfilePeers(profileRoot);if(!missing.length)break;await run([pnpm,'add',...missing,'--ignore-scripts'],profileRoot)}
const installedFiles={chat:await verifyInstalledArchive(archives[1].path,join(profileRoot,'node_modules','dsh-qq-chat'),join(attempt,'chat-installed-files.json')),turn:await verifyInstalledArchive(archives[2].path,join(profileRoot,'node_modules','dsh-qq-turn-control'),join(attempt,'turn-installed-files.json'))}
const browserIndex=args.indexOf('--browser-cache');assert.ok(browserIndex>=0&&args[browserIndex+1],'Required --browser-cache')
process.env.PLAYWRIGHT_BROWSERS_PATH=await realpath(args[browserIndex+1]);const {chromium}=await import('playwright')
const overlay=[{id:'qq-turn-control',config:{enabled:false}},{id:'qq-turn-control-settings',config:{statusRefreshMs:250}},{id:'qq-chat-runtime',config:{enabled:false}},{id:'session-title-llm',disabled:true},{id:'session-telemetry-otel',disabled:true}]
await writeFile(join(profileRoot,'cordis.patch.yml'),JSON.stringify(overlay,null,2)+'\n')
const child=spawn(process.execPath,[join(profileRoot,'node_modules','@deepseek-ai','dsh','lib','bin.js'),'--profile',profile,'--host','127.0.0.1','--port','0','--no-open'],{cwd:area,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
let stdout='',stderr='',exitCode,context,page;const errors=[],consoleErrors=[],checks=[],exit=once(child,'close').then(([code,signal])=>{exitCode=code;return{code,signal}})
const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Web profile did not report ready')),60000),inspect=()=>{const match=(stdout+'\n'+stderr).match(/http:\/\/127\.0\.0\.1:\d+[^\s\u001b]*/);if(match){clearTimeout(timer);resolve(match[0])}};child.stdout.on('data',data=>{stdout+=data;inspect()});child.stderr.on('data',data=>{stderr+=data;inspect()});void exit.then(()=>{clearTimeout(timer);reject(Error('Web profile exited before ready'))})})
try{
 const login=await ready,origin=new URL(login).origin
 context=await chromium.launchPersistentContext(join(attempt,'browser-profile'),{headless:true,viewport:{width:1280,height:1000},locale:'zh-CN',colorScheme:'light',env:{...env,PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH}})
 await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||['data:','blob:'].includes(url.protocol)?route.continue():route.abort()})
 page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));page.on('console',entry=>{if(['error','warning'].includes(entry.type()))consoleErrors.push(entry.text().slice(0,800))})
 await page.goto(login,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:/^继续$|^Continue$/}).click()
 const open=async()=>{await page.getByRole('button',{name:/^插件$|^Plugins$/}).first().click();await page.getByText('dsh-qq-turn-control',{exact:true}).first().click()}
 await open();const form=page.locator('.qqturn-page');await form.getByText(/^策略未启用$|^Policy inactive$/).waitFor();checks.push('native-page-available-while-policy-disabled')
 await form.getByRole('switch',{name:/启用接话|Enable routing/}).click();await form.getByRole('button',{name:/^保存$|^Save$/}).click();await form.getByText(/^策略已启用$|^Policy active$/).waitFor();checks.push('native-save-enables-policy')
 await form.getByText(/意图分类器未注册|Intent classifier not registered/).waitFor();await form.getByRole('switch',{name:/启用意图分类器|Enable intent classifier/}).click();await form.getByRole('button',{name:/^保存$|^Save$/}).click();await page.getByText(/请先安装并启用意图分类器|Install and enable an intent classifier first/).waitFor();await form.getByRole('button',{name:/^放弃修改$|^Discard$/}).click();checks.push('missing-intent-provider-rejected-without-saving')
 const scopes=form.getByLabel(/^最多记录会话数$|^Maximum conversations$/);await scopes.fill('0');await form.getByRole('button',{name:/^保存$|^Save$/}).click();await page.getByText(/^请检查设置值$|^Check the settings values$/).waitFor();assert.equal(await scopes.inputValue(),'0');await form.getByRole('button',{name:/放弃修改|Discard/}).click();checks.push('invalid-save-retains-draft')
 const changedScopes=(await scopes.inputValue())==='31'?'32':'31';await scopes.fill(changedScopes);await form.getByRole('button',{name:/^刷新$|^Refresh$/}).click();await form.getByText(/有未保存的修改|Unsaved changes/).waitFor();assert.equal(await scopes.inputValue(),changedScopes);await form.getByRole('button',{name:/^保存$|^Save$/}).click();await page.getByText(/^接话设置已保存$|^Routing settings saved$/).waitFor();await form.getByText(/有未保存的修改|Unsaved changes/).waitFor({state:'hidden'});checks.push('polling-retains-draft-and-valid-settings-save')
 const bots=form.getByLabel(/^其他机器人发送者 ID|^Other-bot sender IDs/),botReplies=form.getByLabel(/^每个其他机器人的尝试上限$|^Attempts per other bot$/),gap=form.getByLabel(/^自动接话最小间隔|^Automatic continuation minimum gap/)
 await bots.fill('robot-one, robot-one');await form.getByRole('button',{name:/^保存$|^Save$/}).click();await page.getByText(/^请检查设置值$|^Check the settings values$/).waitFor();assert.equal(await bots.inputValue(),'robot-one, robot-one');await form.getByRole('button',{name:/放弃修改|Discard/}).click()
 await bots.fill('robot-one, robot-two');await botReplies.fill('2');await gap.fill('12000');await form.getByRole('button',{name:/^保存$|^Save$/}).click();await form.getByText(/有未保存的修改|Unsaved changes/).waitFor({state:'hidden'});assert.equal(await bots.inputValue(),'robot-one, robot-two');assert.equal(await botReplies.inputValue(),'2');assert.equal(await gap.inputValue(),'12000');checks.push('native-bot-identities-and-frequency-fields-save-and-reject-duplicates')
 await page.setViewportSize({width:1280,height:1000});await form.evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:join(attempt,'light.png'),fullPage:true});await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:join(attempt,'dark.png'),fullPage:true});await page.getByRole('button',{name:/^收起侧边栏$|^Collapse sidebar$/}).click();await page.setViewportSize({width:520,height:1000});await form.evaluate(element=>element.scrollIntoView({block:'start'}));assert.ok(await form.evaluate(element=>element.scrollWidth<=element.clientWidth+2));assert.ok(await form.evaluate(element=>[...element.querySelectorAll('input')].filter(item=>item.getClientRects().length).every(item=>{const rect=item.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth})));await page.screenshot({path:join(attempt,'narrow.png'),fullPage:true});checks.push('light-dark-and-narrow-layout')
 await page.setViewportSize({width:1280,height:1000});await page.getByRole('button',{name:/^打开侧边栏$|^Open sidebar$/}).click();await page.reload({waitUntil:'domcontentloaded'});await open();await form.getByText(/^策略已启用$|^Policy active$/).waitFor();assert.equal(await scopes.inputValue(),changedScopes);await form.getByRole('switch',{name:/启用接话|Enable routing/}).click();await form.getByRole('button',{name:/^保存$|^Save$/}).click();await form.getByText(/^策略未启用$|^Policy inactive$/).waitFor();checks.push('settings-survive-browser-reload-and-policy-disables')
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.equal(captures.length,0)
 await writeFile(join(attempt,'summary.json'),JSON.stringify({passed:true,dependencyResolution:args.includes('--candidate-inputs')?'candidate-archive-overrides':'public-manifest',checks,installedFiles,archives:archives.map(({name,sha256})=>({name,sha256})),clientErrors:errors,consoleErrors,realQqMessagesSent:0,realModelApiRequests:0},null,2)+'\n');console.log(JSON.stringify({area,attempt,passed:true,checks,realQqMessagesSent:0}))
}catch(error){if(page)await page.screenshot({path:join(attempt,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(join(attempt,'result.json'),JSON.stringify({passed:false,checks,error:{message:error.message,stack:error.stack},clientErrors:errors,consoleErrors},null,2)+'\n');throw error}
finally{await context?.close();if(exitCode===undefined){child.kill('SIGINT');const fallback=setTimeout(()=>child.kill(),5000);await exit;clearTimeout(fallback)}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await writeFile(join(attempt,'process.json'),JSON.stringify({exitCode,stdoutBytes:Buffer.byteLength(stdout),stderrBytes:Buffer.byteLength(stderr),rawProcessOutputPersisted:false},null,2)+'\n')}
