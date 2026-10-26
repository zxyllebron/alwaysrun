import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { clean, inWindow, parseJSON } from '../src/util.mjs';
import { Store } from '../src/store.mjs';
import { Engine } from '../src/engine.mjs';
import { config } from '../src/config.mjs';
function cleanup(dir){const resolved=path.resolve(dir),parent=path.resolve(os.tmpdir());if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('alwaysrun-test-'))throw new Error('Refusing cleanup outside this test fixture');fs.rmSync(resolved,{recursive:true,force:true});}

test('overnight window crosses midnight and excludes daytime',()=>{
  assert.equal(inWindow('23:00',8,new Date('2026-10-23T15:00:00Z')).active,true);
  const morning=inWindow('23:00',8,new Date('2026-10-23T22:59:00Z'));assert.equal(morning.active,true);assert.equal(morning.key,'2026-10-23');
  assert.equal(inWindow('23:00',8,new Date('2026-10-23T23:00:00Z')).active,false);
});
test('credentials are redacted in JSON, headers and token URLs',()=>{
  const raw='{"app_secret":"abcdefghijk","access_token":"abcxyz78900"} Bearer abcdefghijklmnopqrst https://x.test/?token=abcdefg sk-abcdefghijklmnopqrstuvwxyz';
  const text=clean(raw);for(const secret of ['abcdefghijk','abcxyz78900','abcdefghijklmnopqrst','token=abcdefg','sk-abcdefghijklmnopqrstuvwxyz'])assert.ok(!text.includes(secret));
});
test('Chinese evidence retrieval and upsert do not leave stale FTS entries',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alwaysrun-test-')),store=new Store(path.join(dir,'test.sqlite'));
  try{store.putDoc({id:'one',kind:'manual',title:'项目判断',body:'先补齐第一项目必要条件，再做第二项目。'});assert.equal(store.search('必要条件')[0].id,'one');store.putDoc({id:'one',kind:'manual',title:'项目判断',body:'已经完成'});assert.equal(store.search('必要条件').length,0);assert.equal(store.search('已经完成').length,1);}finally{store.close();cleanup(dir)}
});
test('malformed model output cannot be accepted as a plan',()=>{assert.throws(()=>parseJSON('I did all the work'));assert.deepEqual(parseJSON('```json\n{"ok":true}\n```'),{ok:true})});
test('restart marks unconfirmed model work interrupted',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alwaysrun-test-')),file=path.join(dir,'test.sqlite');let s=new Store(file);s.newRun('test');s.close();s=new Store(file);try{assert.equal(s.runs()[0].status,'interrupted')}finally{s.close();cleanup(dir)}
});
test('night budget is charged before model invocation and blocks excess calls',async()=>{
  const store=new Store(':memory:');const codex=new EventEmitter();let calls=0;codex.status={};codex.run=async()=>{calls++;return {text:'ok',usage:{outputTokens:11},threadId:'synthetic',turnId:'synthetic'}};codex.interrupt=async()=>{};
  const engine=new Engine(store,{},codex);engine.night={key:'test',deadline:Date.now()+100000};store.set('budget:test',{turns:config.night.maxTurns,outputTokens:0});await assert.rejects(engine.model('test','x'),/上限/);assert.equal(calls,0);
  store.set('budget:test',{turns:0,outputTokens:0});await engine.model('test','x');assert.equal(calls,1);assert.equal(store.get('budget:test').turns,1);assert.equal(store.get('budget:test').outputTokens,11);store.close();
});
test('executor completion is not success when independent verification fails',async()=>{
  const store=new Store(':memory:'),codex=new EventEmitter();codex.status={};codex.interrupt=async()=>{};
  const engine=new Engine(store,{},codex);store.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?,?)').run('p','Synthetic','Synthetic',process.cwd(),1,'active','test',new Date().toISOString());
  store.db.prepare('INSERT INTO tasks(id,project_id,title,prompt,acceptance,status,kind,evidence,result,updated) VALUES(?,?,?,?,?,?,?,?,?,?)').run('t','p','Synthetic task','test','artifact exists','ready','progress','[]','',new Date().toISOString());
  let calls=0;engine.model=async()=>({text:JSON.stringify(++calls===1?{status:'completed',summary:'claimed',artifacts:[],checks:[],blocker:'',nextPreparation:''}:{passed:false,summary:'No evidence',evidence:[]}),runId:'test'});
  const result=await engine.executeInner('t');assert.equal(result.status,'failed');assert.equal(store.tasks()[0].status,'failed');store.close();
});

test('night dispatch requires an active project and gives its prerequisite priority',()=>{
  const codex=new EventEmitter();codex.status={};const rows=[
    {id:'historical',status:'ready',project_status:'discovered',priority:1},
    {id:'paused',status:'ready',project_status:'paused',priority:1},
    {id:'completed',status:'done',project_status:'active',priority:1},
    {id:'blocked',status:'blocked',project_status:'active',priority:1},
    {id:'second',status:'ready',project_status:'active',priority:3,kind:'prerequisite'},
    {id:'first-progress',status:'ready',project_status:'active',priority:2,kind:'progress'},
    {id:'first-prerequisite',status:'ready',project_status:'active',priority:2,kind:'prerequisite'}
  ];
  const store={get:()=>null,tasks:()=>rows};const engine=new Engine(store,{},codex);
  assert.equal(engine.nextNightTask().id,'first-prerequisite');
  rows.find(t=>t.id==='first-prerequisite').status='done';assert.equal(engine.nextNightTask().id,'first-progress');
  rows.find(t=>t.id==='first-progress').project_status='paused';assert.equal(engine.nextNightTask().id,'second');
  rows.find(t=>t.id==='second').status='blocked';assert.equal(engine.nextNightTask(),undefined);
});
