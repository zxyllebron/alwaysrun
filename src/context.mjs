import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.mjs';
import { clean, hash, now, displayPath } from './util.mjs';

const readDb = p => new DatabaseSync(p,{readOnly:true});
const contentText = item => item.text || (item.content||[]).filter(x=>['text','input_text','output_text'].includes(x.type)).map(x=>x.text||'').join('\n');
function chunk(text,size=6500){const out=[];for(let i=0;i<text.length;i+=size)out.push(text.slice(i,i+size));return out;}
const inactive = record => record.deleted||record.dismissed||record.stale||record.superseded_by_api_job||record.superseded;
function workstationRecord(row,table){
  try{const record=JSON.parse(row.body);if(record&&typeof record==='object'&&!Array.isArray(record))return record;}catch{}
  throw new Error(`个人工作台 ${table} 包含无效资料记录，本次保留上次成功索引。`);
}
export class Context {
  constructor(store){this.store=store;this.busy=false;this.status={running:false,lastSync:null,error:null};}
  async sync(){
    if(this.busy)return this.status;this.busy=true;this.status.running=true;const started=Date.now();
    const previous=this.store.get('sourceStatus')||this.status,errors=[];
    const syncSource=(key,label,read)=>{
      let result;try{result=read()}catch(e){result={connected:false,error:clean(e.message)}}
      if(result.error){errors.push(`${label}：${result.error}`);return {...previous[key],...result,...(key==='workstation'?{retainedLastIndex:true}:{})}}
      return result;
    };
    try{
      const codex=syncSource('codex','Codex',()=>this.syncCodex());
      const workstation=syncSource('workstation','个人工作台',()=>this.syncWorkstation());
      this.updateRevision();
      this.status={running:false,lastSync:now(),durationMs:Date.now()-started,codex,workstation,error:errors.join('\n')||null};
      if(this.status.error)this.store.event('error','同步上下文失败',this.status.error);
      this.store.set('sourceStatus',this.status);return this.status;
    }catch(e){this.status={...previous,running:false,error:clean(e.message)};this.store.set('sourceStatus',this.status);this.store.event('error','同步上下文失败',e.message);return this.status;}finally{this.busy=false;}
  }
  updateRevision(){const revision=hash(JSON.stringify(this.store.db.prepare('SELECT id,hash FROM documents ORDER BY id').all()));this.store.set('contextRevision',revision);return revision;}
  syncCodex(){
    const home=config.codexHome,statePath=path.join(home,'state_5.sqlite'),historyPath=path.join(home,'thread_history_1.sqlite');
    if(!fs.existsSync(statePath)||!fs.existsSync(historyPath))return {connected:false,error:'未找到本地 Codex SQLite 聊天库。'};
    const state=readDb(statePath),history=readDb(historyPath);let added=0,messages=0;
    try{
      const threads=state.prepare('SELECT id,title,name,cwd,updated_at_ms,updated_at,archived,source FROM threads').all().map(t=>({...t,cwd:displayPath(t.cwd)}));
      const owned=new Set(this.store.get('ownedThreads',[]));
      const getItems=history.prepare("SELECT item_id,item_json,created_at_ms FROM thread_items WHERE thread_id=? AND item_type IN ('userMessage','agentMessage') ORDER BY rollout_ordinal");
      for(const t of threads){
        if(owned.has(t.id)||t.source==='alwaysrun')continue;
        const local=this.store.db.prepare('SELECT * FROM threads WHERE id=?').get(t.id),updated=t.updated_at_ms||t.updated_at*1000;
        const title=t.name||t.title||'未命名对话';
        this.store.db.prepare('INSERT INTO threads(id,title,cwd,updated,archived) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,cwd=excluded.cwd,updated=excluded.updated,archived=excluded.archived').run(t.id,title,t.cwd,updated,t.archived);
        // Avoid rescanning the large live history DB for unchanged conversations every minute.
        // A periodic forced check catches an active turn whose metadata publication was delayed.
        const checked=this.store.get('threadChecked:'+t.id,0);
        if(local&&local.updated===updated&&checked>Date.now()-5*60000){messages+=local.imported;continue;}
        const items=getItems.all(t.id);messages+=items.length;
        const signature=hash(items.map(x=>x.item_id+hash(x.item_json)).join('|'));
        this.store.set('threadChecked:'+t.id,Date.now());
        if(this.store.get('threadHash:'+t.id)===signature)continue;
        this.store.db.exec('BEGIN');try{
          this.store.removeDocs('codex:'+t.id+':');
          for(const row of items){let item;try{item=JSON.parse(row.item_json)}catch{continue}const role=item.type==='userMessage'?'user':'assistant';
            const text=contentText(item);if(!text.trim()||text.startsWith('<external_codex_apps_open_page>'))continue;
            // System scaffolding is not a personal preference sample. Explicit AGENTS.md is ingested separately.
            if(role==='user'&&(/^# AGENTS\.md instructions/.test(text)||/^<environment_context>/.test(text)))continue;
            for(const [i,part] of chunk(text).entries())if(this.store.putDoc({id:`codex:${t.id}:${row.item_id}:${i}`,kind:'codex',title,uri:`codex://threads/${t.id}`,body:part,updated:new Date(row.created_at_ms||updated).toISOString(),meta:{threadId:t.id,itemId:row.item_id,role,cwd:t.cwd,source:'local-codex-history'}}))added++;
          }
          this.store.set('threadHash:'+t.id,signature);this.store.db.prepare('UPDATE threads SET imported=? WHERE id=?').run(items.length,t.id);this.store.db.exec('COMMIT');
        }catch(e){this.store.db.exec('ROLLBACK');throw e;}
        if(t.cwd&&fs.existsSync(t.cwd)&&!local){
          const pid=hash(t.cwd.toLowerCase()).slice(0,16);
          this.store.db.prepare('INSERT OR IGNORE INTO projects(id,title,goal,cwd,priority,status,origin,updated) VALUES(?,?,?,?,?,?,?,?)').run(pid,path.basename(t.cwd)||title,'',t.cwd,50,'discovered','codex',now());
        }
      }
      const agents=path.join(home,'AGENTS.md');if(fs.existsSync(agents))this.store.putDoc({id:'instruction:global-agents',kind:'instruction',title:'用户已确认的全局长期上下文',uri:agents,body:fs.readFileSync(agents,'utf8'),meta:{role:'user',explicit:true}});
      return {connected:true,threads:threads.filter(x=>!owned.has(x.id)).length,messages,updatedDocuments:added,coverage:'本机全部可读会话的用户消息与助手可见回复；不采集隐藏推理、凭据、图像或原始工具输出。'};
    }finally{state.close();history.close();}
  }
  syncWorkstation(){
    if(!config.workstationDb)return {connected:false,enabled:false,optional:true,records:0};
    if(!fs.existsSync(config.workstationDb))return {connected:false,error:'个人工作台数据库不存在'};
    const db=readDb(config.workstationDb);let count=0,feishu=0;const kinds={},documents=[];
    const owned=new Set(this.store.get('ownedThreads',[]));
    const originOf=(record,row)=>record.thread_id||record.source_thread_id||String(row.id).match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0]||null;
    try{
      // Read a complete source snapshot first. On any source error the previous index is retained.
      db.exec('BEGIN');
      for(const row of db.prepare('SELECT * FROM records').all()){
        const record=workstationRecord(row,'records');if(inactive(record))continue;
        const originThreadId=originOf(record,row);if(originThreadId&&owned.has(originThreadId))continue;
        const body=record.text||record.content||record.summary||'';if(!body)continue;
        kinds[row.kind]=(kinds[row.kind]||0)+1;if(/feishu|lark/.test(row.kind))feishu++;
        for(const [i,part] of chunk(typeof body==='string'?body:JSON.stringify(body)).entries()){
          documents.push({id:`workstation:${row.id}:${i}`,kind:/feishu|lark/.test(row.kind)?'feishu':'workstation',title:record.title||row.kind,uri:record.url||record.path||config.workstationDb,body:part,updated:row.updated||now(),meta:{recordId:row.id,sourceKind:row.kind,day:row.day,role:originThreadId?'mixed':'unknown',derived:true,originThreadId,coverage:record.coverage||''}});count++;
        }
      }
      for(const table of ['tasks','planning_items'])for(const row of db.prepare(`SELECT * FROM ${table}`).all()){
        const task=workstationRecord(row,table);if(inactive(task))continue;
        documents.push({id:`workstation-${table}:${row.id}`,kind:'workstation',title:task.title||'工作台任务',uri:config.workstationDb,body:JSON.stringify(task,null,2),updated:task.updated||task.created||now(),meta:{recordId:row.id,sourceKind:table,status:task.status,role:task.origin==='user'?'user':'unknown',derived:task.origin!=='user'}});
      }
      db.exec('COMMIT');
      const alive=new Set(documents.map(d=>d.id));
      this.store.db.exec('BEGIN IMMEDIATE');try{
        for(const doc of documents)this.store.putDoc(doc);
        // GLOB keeps '_' literal: only these importer-owned namespaces may be reconciled.
        for(const old of this.store.db.prepare("SELECT id FROM documents WHERE id GLOB 'workstation:*' OR id GLOB 'workstation-tasks:*' OR id GLOB 'workstation-planning_items:*'").all())if(!alive.has(old.id)){this.store.db.prepare('DELETE FROM documents_fts WHERE id=?').run(old.id);this.store.db.prepare('DELETE FROM documents WHERE id=?').run(old.id)}
        // Publish the content fingerprint atomically with both index tables, never from source timestamps.
        this.updateRevision();
        this.store.db.exec('COMMIT');
      }catch(e){this.store.db.exec('ROLLBACK');throw e;}
      return {connected:true,records:count,kinds,feishuRecords:feishu,path:config.workstationDb};
    }finally{db.close();}
  }
  evidence(query='',maxChars=60000){
    const selected=this.store.db.prepare('SELECT id FROM threads WHERE selected=1').all();
    const pool=[];const seen=new Set(),contentSeen=new Map();
    const add=rows=>{for(const r of rows){
      if(seen.has(r.id))continue;seen.add(r.id);
      if(r.meta?.derived&&r.meta.originThreadId&&this.store.db.prepare("SELECT 1 FROM documents WHERE kind='codex' AND json_extract(meta,'$.threadId')=? LIMIT 1").get(r.meta.originThreadId))continue;
      const signature=hash(r.body.replace(/\s+/g,' ').trim());const old=contentSeen.get(signature);
      if(old){old.copies??=[];old.copies.push({id:r.id,title:r.title,uri:r.uri,role:r.meta?.role});continue;}
      contentSeen.set(signature,r);pool.push(r);
    }};
    add(this.store.search('',10,'instruction'));
    for(const t of selected)add(this.store.db.prepare("SELECT * FROM documents WHERE json_extract(meta,'$.threadId')=? ORDER BY updated DESC LIMIT 20").all(t.id).map(r=>({...r,meta:JSON.parse(r.meta)})));
    add(this.store.search('',20,'manual'));
    if(query)add(this.store.search(query,40));
    // Explicit user corrections receive more weight than assistant-generated suggestions.
    add(this.store.search('我希望 我要求 不要 必须 优先 以后 目标 喜欢',80,'codex').filter(r=>r.meta.role==='user'));
    add(this.store.search('',40,'feishu'));add(this.store.search('',30,'workstation'));
    add(this.store.search('',80,'codex'));
    let used=0;const result=[];
    for(const row of pool){const room=maxChars-used;if(room<300)break;const body=row.body.slice(0,Math.min(4500,room));
      const relatedCopies=row.meta?.threadId?this.store.db.prepare("SELECT id,title,uri FROM documents WHERE json_extract(meta,'$.originThreadId')=? LIMIT 3").all(row.meta.threadId):[];
      result.push({id:row.id,title:row.title,source:row.kind,uri:row.uri,updated:row.updated,role:row.meta?.role,derived:!!row.meta?.derived,copies:[...(row.copies||[]),...relatedCopies],text:body});used+=body.length;
    }
    return result;
  }
  importText(title,text,uri='user-supplied',meta={}){const doc={id:'manual:'+hash(title+text).slice(0,24),kind:'manual',title,body:text,uri,meta:{role:'unknown',supplied:true,...meta}};this.store.putDoc(doc);this.updateRevision();this.store.event('source','导入补充上下文',title);return doc.id;}
}
