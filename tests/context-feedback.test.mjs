import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { Context } from '../src/context.mjs';
import { config } from '../src/config.mjs';
import { mergePreferences, decisionProfile } from '../src/preferences.mjs';

function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alwaysrun-feedback-')),file=path.join(dir,'workstation.sqlite'),source=new DatabaseSync(file);source.exec('CREATE TABLE records(id TEXT,kind TEXT,day TEXT,updated TEXT,body TEXT);CREATE TABLE tasks(id TEXT,body TEXT);CREATE TABLE planning_items(id TEXT,body TEXT)');const previous=config.workstationDb;config.workstationDb=file;const store=new Store(':memory:'),context=new Context(store);return {source,store,context,close(){source.close();store.close();config.workstationDb=previous;const resolved=path.resolve(dir);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('alwaysrun-feedback-'))throw new Error('Cleanup path mismatch');fs.rmSync(resolved,{recursive:true,force:true})}};}

test('an unconfigured optional workstation does not become a sync failure',async()=>{
  const previous=config.workstationDb,store=new Store(':memory:'),context=new Context(store);config.workstationDb='';
  context.syncCodex=()=>({connected:true,threads:0});
  try{const status=await context.sync();assert.equal(status.error,null);assert.equal(status.workstation.enabled,false);assert.equal(status.workstation.optional,true);assert.equal(store.stats().length,0)}finally{config.workstationDb=previous;store.close()}
});
test('source reconciliation removes shortened chunks and invalidated records; errors retain last good index',()=>{
  const f=fixture();try{
    const insert=f.source.prepare('INSERT INTO records VALUES(?,?,?,?,?)');const update=f.source.prepare('UPDATE records SET body=? WHERE id=?');
    insert.run('r','memory','2026-10-24','2026-10-24T00:00:00+08:00',JSON.stringify({title:'fixture',text:'A'.repeat(14000)}));f.context.syncWorkstation();const first=f.context.updateRevision();assert.equal(f.store.stats()[0].count,3);
    update.run(JSON.stringify({title:'fixture',text:'缩短后的正文'}),'r');f.context.syncWorkstation();assert.equal(f.store.stats()[0].count,1);assert.notEqual(f.context.updateRevision(),first);
    for(const flag of ['deleted','dismissed','stale','superseded_by_api_job']){update.run(JSON.stringify({title:'fixture',text:'废弃正文',[flag]:true}),'r');f.context.syncWorkstation();assert.equal(f.store.search('废弃正文').length,0);assert.equal(f.store.stats().length,0);}
    update.run(JSON.stringify({title:'fixture',text:'恢复正文'}),'r');f.context.syncWorkstation();assert.equal(f.store.search('恢复正文').length,1);
    f.source.exec('DROP TABLE tasks');assert.throws(()=>f.context.syncWorkstation());assert.equal(f.store.search('恢复正文').length,1);
  }finally{f.close()}
});
test('source aliases remain traceable without turning transcripts or assistant analysis into user preference evidence',()=>{
  const f=fixture(),tid='11111111-1111-1111-1111-111111111111',own='22222222-2222-2222-2222-222222222222';try{
    f.store.putDoc({id:'raw-user',kind:'codex',title:'原始用户消息',body:'我希望优先交付可用版本。',meta:{role:'user',threadId:tid}});
    const insert=f.source.prepare('INSERT INTO records VALUES(?,?,?,?,?)');insert.run('thread:'+tid,'codex','2026-10-24','2026-10-24',JSON.stringify({title:'转录副本',text:'助手总结：用户可能希望优先交付可用版本。'}));
    insert.run('unknown-record','memory','2026-10-24','2026-10-24',JSON.stringify({title:'作者未知',text:'不清楚作者是谁的背景资料。'}));
    f.store.set('ownedThreads',[own]);insert.run('thread:'+own,'codex','2026-10-24','2026-10-24',JSON.stringify({title:'分身自己的分析',text:'不应成为独立用户证据'}));f.context.syncWorkstation();
    const evidence=f.context.evidence();assert.equal(f.store.document('workstation:thread:'+tid+':0').meta.role,'mixed');assert.equal(f.store.document('workstation:unknown-record:0').meta.role,'unknown');assert.equal(f.store.document('workstation:thread:'+own+':0'),null);
    const raw=evidence.find(x=>x.id==='raw-user');assert.ok(raw);assert.ok(raw.copies.some(x=>x.id==='workstation:thread:'+tid+':0'));assert.ok(!evidence.some(x=>x.id==='workstation:thread:'+tid+':0'));
    f.context.importText('引用聊天','别人说的内容');assert.equal(f.store.search('别人说的内容')[0].meta.role,'unknown');
  }finally{f.close()}
});
test('feedback survives paraphrase, restart and conflicting new evidence',()=>{
  const evidence=[{id:'e1',text:'先交付'},{id:'e2',text:'预算'},{id:'e3',text:'现在先验证需求'}];
  const previous={preferences:[{id:'accepted',statement:'先做可用交付',status:'accepted',evidenceIds:['e1']},{id:'rejected',statement:'可以无限花钱',status:'rejected',evidenceIds:['e2']}]};
  const common={category:'决策',confidence:.9,evidenceQuote:'先交付'};
  const output=[{...common,statement:'优先交付能用版本',existingPreferenceId:'accepted',relation:'same',evidenceIds:['e1']},{...common,statement:'不必设置支出限制',existingPreferenceId:'',relation:'new',evidenceIds:['e2']},{...common,statement:'当前应先验证需求',existingPreferenceId:'accepted',relation:'conflict',evidenceIds:['e3']}];
  const preferences=mergePreferences(output,previous,evidence);assert.equal(preferences.filter(p=>p.status==='accepted').length,1);assert.equal(preferences.find(p=>p.id==='rejected').status,'rejected');assert.equal(preferences.filter(p=>p.status==='needs_review').length,2);
  const usable=decisionProfile({preferences});assert.deepEqual(usable.preferences.map(p=>p.id),['accepted']);assert.equal(usable.rejectedInterpretations.length,1);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alwaysrun-feedback-')),file=path.join(dir,'feedback.sqlite');let store=new Store(file);
  try{
    store.set('profile',{preferences});store.close();store=new Store(file);
    const reloaded=store.get('profile');assert.equal(reloaded.preferences.find(p=>p.id==='rejected').status,'rejected');
    const pending=reloaded.preferences.find(p=>p.status==='needs_review'&&p.supersedes==='accepted');
    const next=mergePreferences([{...common,statement:'重新表述仍待核实的判断',existingPreferenceId:pending.id,relation:'same',evidenceIds:['e3']}],reloaded,evidence);
    assert.equal(next.find(p=>p.id===pending.id).status,'needs_review');assert.equal(next.filter(p=>p.status==='needs_review').length,2);
    assert.deepEqual(decisionProfile({preferences:next}).preferences.map(p=>p.id),['accepted']);
  }finally{
    store.close();const resolved=path.resolve(dir);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('alwaysrun-feedback-'))throw new Error('Cleanup path mismatch');fs.rmSync(resolved,{recursive:true,force:true});
  }
});
