import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, ROOT, DATA, saveConfig } from './config.mjs';
import { Store } from './store.mjs';
import { BackgroundContext } from './background-context.mjs';
import { Codex } from './codex.mjs';
import { Feishu } from './feishu.mjs';
import { Engine } from './engine.mjs';
import { assertText, hash, now, clean, displayPath } from './util.mjs';

const store=new Store(),context=new BackgroundContext(store),codex=new Codex(),feishu=new Feishu(store),engine=new Engine(store,context,codex);
// Canonicalize old Windows extended paths and merge duplicate directory projects.
const projectPaths=new Map();for(const p of store.projects()){const cwd=displayPath(p.cwd),key=cwd.toLowerCase();if(projectPaths.has(key)){store.db.prepare('UPDATE tasks SET project_id=? WHERE project_id=?').run(projectPaths.get(key),p.id);store.db.prepare('DELETE FROM projects WHERE id=?').run(p.id)}else{projectPaths.set(key,p.id);store.db.prepare('UPDATE projects SET cwd=? WHERE id=?').run(cwd,p.id)}}
const csrf=crypto.randomBytes(32).toString('hex');
if(!store.get('bootstrapped')){
  // A clean installation starts without invented user preferences or an active project.
  store.set('bootstrapped',true);
}

function json(res,code,value){res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));}
async function body(req){let data='';for await(const piece of req){data+=piece;if(data.length>2e6)throw new Error('请求内容过大')}return data?JSON.parse(data):{};}
function launch(res,title,fn){try{const promise=fn();Promise.resolve(promise).catch(e=>store.event('error',title,clean(e.message)));json(res,202,{accepted:true})}catch(e){json(res,409,{error:clean(e.message)})}}
function state(){return {config,engine:engine.status(),sources:context.status.lastSync?context.status:store.get('sourceStatus'),feishu:feishu.status(),stats:store.stats(),projects:store.projects(),tasks:store.tasks(),runs:store.runs().map(r=>({...r,body:r.body?.slice(0,10000)})),events:store.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 50').all(),messages:store.messages(),lastPlan:store.get('lastPlan'),budget:engine.night?store.get('budget:'+engine.night.key):store.get('nightSession')?.budget||null};}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const expected=new Set([`127.0.0.1:${config.port}`,`localhost:${config.port}`]);
  if(!expected.has(req.headers.host)){json(res,403,{error:'仅允许本机访问'});return;}
  const url=new URL(req.url,'http://'+req.headers.host);
  try{
    if(req.method==='POST'){
      if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host)throw new Error('请求来源不匹配');
      if(req.headers['x-alwaysrun-token']!==csrf){json(res,403,{error:'操作凭证失效，请刷新页面'});return;}
      const data=await body(req);
      if(url.pathname==='/api/sync'){await context.sync();json(res,200,context.status);return;}
      if(url.pathname==='/api/connect'){launch(res,'连接模型失败',()=>codex.connect());return;}
      if(url.pathname==='/api/analyze'){if(engine.busy)throw new Error('已有任务运行中');launch(res,'偏好分析失败',()=>engine.analyze());return;}
      if(url.pathname==='/api/plan'){if(engine.busy)throw new Error('已有任务运行中');launch(res,'生成计划失败',()=>engine.plan());return;}
      if(url.pathname==='/api/chat'){if(engine.busy)throw new Error('已有任务运行中');const text=assertText(data.message,'消息',20000);launch(res,'对话失败',()=>engine.chat(text));return;}
      if(url.pathname==='/api/stop'){await engine.stop();json(res,200,{ok:true});return;}
      if(url.pathname==='/api/shutdown'){json(res,200,{ok:true});setTimeout(()=>void shutdown(),100);return;}
      if(url.pathname==='/api/night/start'){json(res,200,await engine.startNight());return;}
      if(url.pathname==='/api/tasks/run'){if(engine.busy)throw new Error('已有任务运行中');launch(res,'任务执行失败',()=>engine.execute(assertText(data.id,'任务ID',200)));return;}
      if(url.pathname==='/api/tasks/status'){if(!['ready','cancelled'].includes(data.status))throw new Error('任务状态无效');const t=store.tasks().find(t=>t.id===data.id);if(!t||t.status==='running')throw new Error('该任务当前不可修改');store.db.prepare('UPDATE tasks SET status=?,updated=? WHERE id=?').run(data.status,now(),data.id);json(res,200,{ok:true});return;}
      if(url.pathname==='/api/projects'){
        const title=assertText(data.title,'项目名称',150),goal=assertText(data.goal,'项目目标',10000),cwd=displayPath(path.resolve(assertText(data.cwd,'项目目录',1500)));if(!fs.existsSync(cwd)||!fs.statSync(cwd).isDirectory())throw new Error('项目目录不存在');
        const priority=Math.max(1,Math.min(99,Number(data.priority)||10)),pid=data.id||hash(cwd.toLowerCase()).slice(0,16);
        store.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,goal=excluded.goal,cwd=excluded.cwd,priority=excluded.priority,status=excluded.status,updated=excluded.updated').run(pid,title,goal,cwd,priority,data.status==='paused'?'paused':'active','user',now());json(res,200,{id:pid});return;
      }
      if(url.pathname==='/api/context'){const direct=data.authorType==='user';const key=context.importText(assertText(data.title,'资料名称',200),assertText(data.text,'上下文内容',1500000),data.uri||'user-supplied',{role:direct?'user':'unknown',explicit:direct,submittedBy:'user'});json(res,200,{id:key});return;}
      if(url.pathname==='/api/threads/select'){const t=store.db.prepare('SELECT id FROM threads WHERE id=?').get(data.id);if(!t)throw new Error('本机会话不存在');store.db.prepare('UPDATE threads SET selected=? WHERE id=?').run(data.selected?1:0,data.id);json(res,200,{ok:true});return;}
      if(url.pathname==='/api/preferences'){
        const p=store.get('profile');if(!p)throw new Error('请先分析偏好');const pref=p.preferences.find(x=>x.id===data.id);if(!pref||!['accepted','rejected'].includes(data.status))throw new Error('偏好操作无效');pref.status=data.status;if(data.status==='accepted'&&pref.supersedes){const older=p.preferences.find(x=>x.id===pref.supersedes);if(older)older.status='superseded'}store.set('profile',p);store.event('profile','偏好反馈已保存',pref.statement);json(res,200,{ok:true});return;
      }
      if(url.pathname==='/api/config'){
        const patch={};if(data.longTermGoal!==undefined)patch.longTermGoal=assertText(data.longTermGoal,'长期目标',15000);
        if(data.night)patch.night={enabled:!!data.night.enabled,start:data.night.start,hours:Number(data.night.hours),maxTurns:Number(data.night.maxTurns),maxOutputTokens:Number(data.night.maxOutputTokens),taskMinutes:Number(data.night.taskMinutes)};
        saveConfig(patch);store.event('settings','运行设置已更新');json(res,200,config);return;
      }
      if(url.pathname==='/api/feishu/base'){
        const link=new URL(assertText(data.url,'飞书链接',1500));if(!/(^|\.)(feishu\.cn|larksuite\.com)$/.test(link.hostname)||link.protocol!=='https:')throw new Error('请填写官方飞书多维表格链接');
        const token=link.pathname.match(/\/base\/([A-Za-z0-9]+)/)?.[1];if(!token)throw new Error('需要 /base/ 多维表格链接；当前链接可能是教程文章或知识库页。');
        const bases=[...config.feishu.bases.filter(b=>b.appToken!==token),{url:link.href,appToken:token,tableId:link.searchParams.get('table')||'',title:data.title||'飞书数据库'}];saveConfig({feishu:{bases}});json(res,200,{ok:true});return;
      }
      if(url.pathname==='/api/feishu/sync'){launch(res,'飞书同步失败',()=>feishu.sync());return;}
      json(res,404,{error:'接口不存在'});return;
    }
    if(req.method!=='GET'){json(res,405,{error:'Method not allowed'});return;}
    if(url.pathname==='/api/bootstrap'){json(res,200,{token:csrf});return;}
    if(url.pathname==='/api/state'){json(res,200,state());return;}
    if(url.pathname==='/api/threads'){json(res,200,store.db.prepare('SELECT * FROM threads ORDER BY selected DESC,updated DESC').all());return;}
    if(url.pathname==='/api/search'){json(res,200,store.search(url.searchParams.get('q')||'',40,url.searchParams.get('kind')||'').map(d=>({...d,body:d.body.slice(0,1800)})));return;}
    if(url.pathname==='/api/document'){const d=store.document(url.searchParams.get('id'));json(res,d?200:404,d||{error:'资料不存在'});return;}
    if(url.pathname==='/api/health'){json(res,200,{ok:true,service:'alwaysrun',model:config.model,effort:config.effort});return;}
    const publicFiles={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/icon.svg':'icon.svg'};const name=publicFiles[url.pathname];
    if(!name){res.writeHead(404);res.end('Not found');return;}
    const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html';res.writeHead(200,{'content-type':type+'; charset=utf-8','cache-control':'no-cache'});res.end(fs.readFileSync(path.join(ROOT,'static',name)));
  }catch(e){json(res,400,{error:clean(e.message)});}
});
server.on('error',e=>{console.error(e.message);process.exitCode=1;void codex.close()});
server.listen(config.port,'127.0.0.1',()=>{
  fs.writeFileSync(path.join(DATA,'server.pid'),String(process.pid));
  console.log(`Alwaysrun: http://127.0.0.1:${config.port} (${config.model} / ${config.effort})`);
  void context.sync().then(()=>store.event('source','本机上下文已同步'));
  void codex.connect().catch(e=>store.event('error','模型连接未就绪',e.message));
});
const syncTimer=setInterval(()=>{if(!context.busy)void context.sync()},config.syncSeconds*1000);
const nightTimer=setInterval(()=>engine.tick(),30000);
async function shutdown(){clearInterval(syncTimer);clearInterval(nightTimer);clearTimeout(engine.deadlineTimer);await engine.stop();await context.worker?.terminate();await codex.close();server.close();setTimeout(()=>process.exit(0),1800).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
