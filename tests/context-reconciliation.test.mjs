import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { Context } from '../src/context.mjs';
import { config } from '../src/config.mjs';

const timestamp='2026-10-24T00:00:00+08:00';
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alwaysrun-reconcile-'));
  const file=path.join(dir,'workstation.sqlite'),source=new DatabaseSync(file);
  source.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,day TEXT,updated TEXT,body TEXT);
    CREATE TABLE tasks(id TEXT PRIMARY KEY,body TEXT);CREATE TABLE planning_items(id TEXT PRIMARY KEY,body TEXT);
    CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);INSERT INTO settings VALUES('feishu_enabled','false');`);
  const previous=config.workstationDb;config.workstationDb=file;
  const store=new Store(':memory:'),context=new Context(store);
  // Never read real Codex history or invoke a model in this fixture.
  context.syncCodex=()=>({connected:true,threads:0});
  t.after(()=>{
    source.close();store.close();config.workstationDb=previous;
    const resolved=path.resolve(dir);
    if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('alwaysrun-reconcile-'))throw new Error('Unsafe fixture cleanup path');
    fs.rmSync(resolved,{recursive:true,force:true});
  });
  return {file,source,store,context,
    put(table,id,value){
      const body=typeof value==='string'?value:JSON.stringify(value);
      if(table==='records')source.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?,?,?)').run(id,'memory','2026-10-24',timestamp,body);
      else source.prepare(`INSERT OR REPLACE INTO ${table} VALUES(?,?)`).run(id,body);
    },
    sync(){
      const before=fs.readFileSync(file);
      try{return context.syncWorkstation()}
      finally{assert.deepEqual(fs.readFileSync(file),before,'source database must remain byte-identical');}
    }
  };
}
function indexState(store){
  return {
    documents:store.db.prepare('SELECT * FROM documents ORDER BY id').all(),
    fts:store.db.prepare('SELECT * FROM documents_fts ORDER BY id').all(),
    revision:store.get('contextRevision')
  };
}
function assertAbsent(store,term){
  assert.equal(store.search(term).length,0);
  assert.equal(store.db.prepare('SELECT count(*) n FROM documents_fts WHERE documents_fts MATCH ?').get(term).n,0);
}

test('complete snapshot removes trailing chunks and preserves other index namespaces',t=>{
  const f=fixture(t);
  const otherIds=['manual:kept','codex:kept','feishu:kept','workstation-external:kept','workstation-planningXitems:kept'];
  for(const id of otherIds)f.store.putDoc({id,kind:'manual',title:id,body:'unrelated_source_marker'});
  const unrelated=f.store.db.prepare('SELECT * FROM documents ORDER BY id').all();
  f.put('records','r',{title:'fixture',text:'A'.repeat(6500)+'obsolete_tail_marker'+'B'.repeat(6500)});
  f.sync();assert.equal(f.store.db.prepare("SELECT count(*) n FROM documents WHERE id GLOB 'workstation:*'").get().n,3);
  f.put('records','r',{title:'fixture',text:'current_body_marker'});f.sync();
  assert.deepEqual(f.store.db.prepare("SELECT id FROM documents WHERE id GLOB 'workstation:*'").all().map(r=>r.id),['workstation:r:0']);
  assert.equal(f.store.search('current_body_marker').length,1);assertAbsent(f.store,'obsolete_tail_marker');
  assert.equal(f.store.db.prepare('SELECT id FROM documents_fts').all().filter(r=>r.id.startsWith('workstation:')).length,1);
  assert.deepEqual(f.store.db.prepare("SELECT * FROM documents WHERE id NOT GLOB 'workstation:*' ORDER BY id").all(),unrelated);
  assert.equal(f.source.prepare("SELECT value FROM settings WHERE key='feishu_enabled'").get().value,'false');
});

for(const table of ['records','tasks','planning_items'])test(`${table}: every invalidation removes a previously searchable row and restoration returns it`,t=>{
  const f=fixture(t),term='searchable_'+table;
  for(const flag of ['deleted','dismissed','stale','superseded','superseded_by_api_job']){
    const active={title:'fixture',text:term,origin:'user'};
    f.put(table,'r',active);f.sync();assert.equal(f.store.search(term).length,1,`${flag}: active before invalidation`);
    const before=f.store.get('contextRevision');
    f.put(table,'r',{...active,[flag]:flag.startsWith('superseded')?'replacement-id':true});f.sync();
    assertAbsent(f.store,term);assert.equal(f.store.stats().length,0);assert.notEqual(f.store.get('contextRevision'),before);
    f.put(table,'r',active);f.sync();assert.equal(f.store.search(term).length,1,`${flag}: restored`);
  }
  f.source.prepare(`DELETE FROM ${table}`).run();f.sync();assertAbsent(f.store,term);
});

test('revision follows content with identical timestamps and is stable for an unchanged snapshot',t=>{
  const f=fixture(t);
  f.put('records','r',{title:'same',text:'first_body_marker'});f.sync();
  const first=f.store.get('contextRevision');assert.ok(first);
  f.put('records','r',{title:'same',text:'second_body_marker'});f.sync();
  const second=f.store.get('contextRevision');assert.notEqual(second,first);
  assert.equal(f.store.document('workstation:r:0').updated,timestamp);assertAbsent(f.store,'first_body_marker');
  f.sync();assert.equal(f.store.get('contextRevision'),second);
  f.put('records','r',{title:'same',text:''});f.sync();assertAbsent(f.store,'second_body_marker');
  assert.notEqual(f.store.get('contextRevision'),second);
});

test('late source failures and missing database retain the last index and persist a visible error',async t=>{
  const f=fixture(t);f.put('records','r',{text:'last_success_marker'});
  const success=await f.context.sync();assert.equal(success.error,null);
  const before=indexState(f.store);
  f.put('records','r',{text:'uncommitted_snapshot_marker'});
  for(const [table,invalid] of [['records','{'],['tasks','null'],['planning_items','{']]){
    f.put(table,'bad',invalid);
    const sourceBefore=fs.readFileSync(f.file),status=await f.context.sync();
    assert.deepEqual(fs.readFileSync(f.file),sourceBefore);
    assert.equal(status.workstation.connected,false);assert.equal(status.workstation.retainedLastIndex,true);
    assert.ok(status.workstation.error);assert.match(status.error,/工作台/);assert.deepEqual(f.store.get('sourceStatus'),status);
    assert.deepEqual(indexState(f.store),before);assert.equal(f.store.search('last_success_marker').length,1);
    f.source.prepare(`DELETE FROM ${table} WHERE id=?`).run('bad');
  }
  f.source.exec('DROP TABLE planning_items');
  assert.ok((await f.context.sync()).error);assert.deepEqual(indexState(f.store),before);
  f.source.exec('CREATE TABLE planning_items(id TEXT PRIMARY KEY,body TEXT)');
  config.workstationDb=path.join(path.dirname(f.file),'missing.sqlite');
  assert.ok((await f.context.sync()).error);assert.deepEqual(indexState(f.store),before);
  assert.equal(fs.existsSync(config.workstationDb),false,'a missing source must not be created');
  config.workstationDb=f.file;
  const recovered=await f.context.sync();assert.equal(recovered.error,null);assert.equal(recovered.workstation.connected,true);
  assert.equal(f.store.get('sourceStatus').error,null);assert.equal(f.store.search('uncommitted_snapshot_marker').length,1);
});

test('destination write and revision failures roll back documents, FTS and revision together',t=>{
  const f=fixture(t);
  f.put('records','keep',{text:'original_keep_marker'});f.put('records','remove',{text:'original_remove_marker'});f.sync();
  const before=indexState(f.store);
  f.put('records','keep',{text:'updated_keep_marker'});f.source.prepare('DELETE FROM records WHERE id=?').run('remove');
  f.put('records','new',{text:'new_marker'});
  const putDoc=f.store.putDoc;let writes=0;
  f.store.putDoc=function(doc){const result=putDoc.call(this,doc);if(++writes===2)throw new Error('injected index write failure');return result};
  try{assert.throws(()=>f.sync(),/injected index write failure/)}finally{f.store.putDoc=putDoc}
  assert.deepEqual(indexState(f.store),before);
  const updateRevision=f.context.updateRevision;
  f.context.updateRevision=function(){updateRevision.call(this);throw new Error('injected revision failure')};
  try{assert.throws(()=>f.sync(),/injected revision failure/)}finally{f.context.updateRevision=updateRevision}
  assert.deepEqual(indexState(f.store),before);
  f.sync();assertAbsent(f.store,'original_remove_marker');assert.equal(f.store.search('new_marker').length,1);
});

test('Codex failure does not prevent a complete workstation snapshot from updating its revision',async t=>{
  const f=fixture(t);f.context.syncCodex=()=>{throw new Error('synthetic Codex read failure')};
  f.put('records','r',{text:'independent_source_marker'});
  const status=await f.context.sync();
  assert.equal(status.codex.connected,false);assert.match(status.error,/synthetic Codex read failure/);
  assert.equal(status.workstation.connected,true);assert.equal(f.store.search('independent_source_marker').length,1);
  assert.ok(f.store.get('contextRevision'));assert.deepEqual(f.store.get('sourceStatus'),status);
});

test('connections show escaped source errors and retained-index status',()=>{
  const code=fs.readFileSync(new URL('../static/app.js',import.meta.url),'utf8').split("document.addEventListener(")[0];
  const sandbox=vm.createContext({document:{querySelector:()=>({})},fixture:{
    config:{model:'synthetic-model',effort:'high'},
    sources:{workstation:{connected:false,error:'读取失败 <fixture>',retainedLastIndex:true,records:1},error:'读取失败 <fixture>'},
    engine:{codex:{}},feishu:{}
  }});
  vm.runInContext(code,sandbox);
  const html=vm.runInContext('state=fixture; connections()',sandbox);
  assert.match(html,/读取失败 &lt;fixture&gt;/);assert.match(html,/保留上次成功索引/);assert.ok(!html.includes('读取失败 <fixture>'));
  assert.match(html,/synthetic-model/);
});
