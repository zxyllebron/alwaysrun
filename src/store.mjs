import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA } from './config.mjs';
import { now, id, clean, hash } from './util.mjs';
export class Store {
  constructor(file=path.join(DATA,'alwaysrun.sqlite'),{recover=true}={}) {
    this.db=new DatabaseSync(file);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,kind TEXT,title TEXT,uri TEXT,body TEXT,updated TEXT,meta TEXT,hash TEXT);
      CREATE INDEX IF NOT EXISTS document_kind ON documents(kind,updated);
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(id UNINDEXED,title,body,tokenize='trigram');
      CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,title TEXT,cwd TEXT,updated INTEGER,archived INTEGER,selected INTEGER DEFAULT 0,imported INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,title TEXT,goal TEXT,cwd TEXT,priority INTEGER,status TEXT DEFAULT 'active',origin TEXT,updated TEXT);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,project_id TEXT,title TEXT,prompt TEXT,acceptance TEXT,status TEXT,kind TEXT,evidence TEXT,result TEXT,attempts INTEGER DEFAULT 0,updated TEXT);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,kind TEXT,status TEXT,created TEXT,finished TEXT,thread_id TEXT,turn_id TEXT,body TEXT,error TEXT,usage TEXT);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,created TEXT,kind TEXT,title TEXT,detail TEXT);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,role TEXT,body TEXT,created TEXT);
    `);
    if(recover){this.db.prepare("UPDATE runs SET status='interrupted',finished=?,error='服务重启，未确认的运行不会计为成功。' WHERE status='running'").run(now());
    this.db.prepare("UPDATE tasks SET status='interrupted',updated=? WHERE status='running'").run(now());}
  }
  get(key,fallback=null){const r=this.db.prepare('SELECT value FROM kv WHERE key=?').get(key);return r?JSON.parse(r.value):fallback;}
  set(key,value){this.db.prepare('INSERT OR REPLACE INTO kv VALUES(?,?)').run(key,JSON.stringify(value));}
  event(kind,title,detail=''){this.db.prepare('INSERT INTO events(created,kind,title,detail) VALUES(?,?,?,?)').run(now(),kind,clean(title),clean(typeof detail==='string'?detail:JSON.stringify(detail)));}
  putDoc(doc){
    const body=clean(doc.body),title=clean(doc.title),uri=clean(doc.uri||''),fingerprint=hash(body+title+uri+JSON.stringify(doc.meta||{}));
    if(this.db.prepare('SELECT hash FROM documents WHERE id=?').get(doc.id)?.hash===fingerprint)return false;
    this.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?,?,?,?)').run(doc.id,doc.kind,title,uri,body,doc.updated||now(),JSON.stringify(doc.meta||{}),fingerprint);
    this.db.prepare('DELETE FROM documents_fts WHERE id=?').run(doc.id);
    this.db.prepare('INSERT INTO documents_fts(id,title,body) VALUES(?,?,?)').run(doc.id,title,body);return true;
  }
  removeDocs(prefix){const rows=this.db.prepare('SELECT id FROM documents WHERE id LIKE ?').all(prefix+'%');for(const r of rows){this.db.prepare('DELETE FROM documents_fts WHERE id=?').run(r.id);this.db.prepare('DELETE FROM documents WHERE id=?').run(r.id);}}
  search(q='',limit=30,kind=''){
    limit=Math.max(1,Math.min(100,Number(limit)||30));
    let rows;
    if(q.trim().length>=3){try{rows=this.db.prepare(`SELECT d.*,bm25(documents_fts) rank FROM documents_fts JOIN documents d ON d.id=documents_fts.id WHERE documents_fts MATCH ? ${kind?'AND d.kind=?':''} ORDER BY rank LIMIT ?`).all(...[q.split(/\s+/).map(x=>'"'+x.replaceAll('"','""')+'"').join(' OR '),...(kind?[kind]:[]),limit]);}catch{}}
    if(!rows?.length){let tokens=q.trim().split(/\s+/).filter(Boolean).slice(0,8);const clauses=tokens.map(()=>'(title LIKE ? OR body LIKE ?)').join(' OR ');rows=this.db.prepare(`SELECT * FROM documents WHERE (${clauses||'1=1'}) ${kind?'AND kind=?':''} ORDER BY updated DESC LIMIT ?`).all(...tokens.flatMap(x=>['%'+x+'%','%'+x+'%']),...(kind?[kind]:[]),limit);}
    return rows.map(r=>({...r,meta:JSON.parse(r.meta)}));
  }
  document(id){const r=this.db.prepare('SELECT * FROM documents WHERE id=?').get(id);return r?{...r,meta:JSON.parse(r.meta)}:null;}
  stats(){return this.db.prepare('SELECT kind,count(*) count,sum(length(body)) characters FROM documents GROUP BY kind').all();}
  newRun(kind){const r={id:id(),kind,status:'running',created:now(),body:'',usage:{}};this.db.prepare('INSERT INTO runs(id,kind,status,created,body,usage) VALUES(?,?,?,?,?,?)').run(r.id,kind,r.status,r.created,'','{}');return r;}
  finishRun(r,status,body='',error='',usage={}){this.db.prepare('UPDATE runs SET status=?,finished=?,thread_id=?,turn_id=?,body=?,error=?,usage=? WHERE id=?').run(status,now(),r.threadId||'',r.turnId||'',clean(body),clean(error),JSON.stringify(usage),r.id);}
  runs(){return this.db.prepare('SELECT * FROM runs ORDER BY created DESC LIMIT 40').all().map(r=>({...r,usage:JSON.parse(r.usage||'{}')}));}
  projects(){return this.db.prepare('SELECT * FROM projects ORDER BY priority,updated DESC').all();}
  tasks(){return this.db.prepare('SELECT t.*,p.title project_title,p.priority,p.status project_status FROM tasks t LEFT JOIN projects p ON p.id=t.project_id ORDER BY p.priority,t.updated DESC LIMIT 200').all();}
  message(role,body){const m={id:id(),role,body:clean(body),created:now()};this.db.prepare('INSERT INTO messages VALUES(?,?,?,?)').run(m.id,m.role,m.body,m.created);return m;}
  messages(){return this.db.prepare('SELECT * FROM (SELECT * FROM messages ORDER BY created DESC LIMIT 80) ORDER BY created').all();}
  close(){this.db.close();}
}
