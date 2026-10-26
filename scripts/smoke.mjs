import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'alwaysrun-clean-check-'));
const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const env={...process.env,ALWAYSRUN_DATA:path.join(fixture,'data'),ALWAYSRUN_PORT:String(port),ALWAYSRUN_NAME:'Synthetic User',ALWAYSRUN_MODEL:'synthetic-model',ALWAYSRUN_EFFORT:'high',ALWAYSRUN_CODEX_HOME:path.join(fixture,'empty-codex-home'),ALWAYSRUN_CODEX_BIN:path.join(fixture,'no-model-binary'),ALWAYSRUN_WORKSTATION_DB:''};
const setup=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/setup.mjs')],{cwd:root,env,encoding:'utf8',windowsHide:true}));
if(setup.data!==env.ALWAYSRUN_DATA||!fs.existsSync(path.join(setup.data,'runtime.json')))throw new Error('Clean setup failed');
const child=spawn(process.execPath,[path.join(root,'src/server.mjs')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let diagnostics='';child.stderr.on('data',part=>{diagnostics+=part.toString()});child.stdout.on('data',()=>{});
const exited=once(child,'exit');const url=`http://127.0.0.1:${port}`;
const assert=(condition,message)=>{if(!condition)throw new Error(message)};
try{
  let healthy=false;
  for(let i=0;i<50;i++){
    if(child.exitCode!==null)throw new Error('Fresh server exited: '+diagnostics.slice(-1000));
    try{healthy=(await (await fetch(url+'/api/health')).json()).service==='alwaysrun'}catch{}
    if(healthy)break;await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert(healthy,'Fresh server did not start');
  const page=await fetch(url+'/');assert(page.ok&&(await page.text()).includes('alwaysrun'),'UI unavailable');
  const state=await (await fetch(url+'/api/state')).json();
  assert(state.projects.length===0&&state.tasks.length===0&&!state.engine.profile,'Clean installation must not contain personal projects or inferred preferences');
  assert(state.config.night.enabled===false&&!state.config.workstationDb,'Optional sources and automatic execution must start disabled');
  assert(state.config.codexHome===env.ALWAYSRUN_CODEX_HOME,'Real local context must not be used by this check');
  assert(state.config.model==='synthetic-model'&&state.config.effort==='high','Explicit model configuration was not preserved');
  const token=(await (await fetch(url+'/api/bootstrap')).json()).token;
  const post=(route,body={},extra={})=>fetch(url+'/api/'+route,{method:'POST',headers:{'content-type':'application/json','x-alwaysrun-token':token,...extra},body:JSON.stringify(body)});
  assert((await fetch(url+'/api/context',{method:'POST',body:'{}'})).status===403,'Missing action credential accepted');
  assert((await post('sync',{}, {origin:'https://example.invalid'})).status===400,'Cross-origin write accepted');
  const imported=await post('context',{title:'Synthetic context',text:'This is synthetic smoke-check content.',authorType:'unknown'});assert(imported.ok,'Text import failed');
  const docs=await (await fetch(url+'/api/search?q=Synthetic')).json();assert(docs.length>0&&docs[0].meta.role==='unknown','Imported author provenance lost');
  assert((await post('shutdown')).ok,'Shutdown failed');await exited;
  console.log('Clean-install smoke passed: empty state, UI, optional sources, CSRF, origin checks, synthetic import, search and shutdown. No model calls or personal sources.');
}finally{
  if(child.exitCode===null){child.kill();await exited.catch(()=>{})}
  const target=path.resolve(fixture);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('alwaysrun-clean-check-'))throw new Error('Unsafe fixture cleanup target');
  fs.rmSync(target,{recursive:true,force:true});
}
