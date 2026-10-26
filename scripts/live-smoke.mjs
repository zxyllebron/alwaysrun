import fs from 'node:fs';
import path from 'node:path';
import { Codex } from '../src/codex.mjs';
import { Store } from '../src/store.mjs';
import { DATA, config } from '../src/config.mjs';
const cwd=path.join(DATA,'smoke-workspace');fs.mkdirSync(cwd,{recursive:true});
const codex=new Codex(),store=new Store(undefined,{recover:false});
codex.on('ownedThread',threadId=>{const owned=store.get('ownedThreads',[]);if(!owned.includes(threadId))store.set('ownedThreads',[...owned,threadId])});
const schema={type:'object',properties:{passed:{type:'boolean'},summary:{type:'string'}},required:['passed','summary'],additionalProperties:false};
try{
  const written=await codex.run('功能自测：只在当前测试目录创建 alwaysrun-ready.txt，内容精确为 ALWAYSRUN_READY。必须成功运行一条终端命令实际读取文件核对内容；命令失败时不得声称验证成功。不要改动其他目录，不要使用任何网络工具。完成后简短汇报文件路径。',{cwd,write:true,timeoutMs:180000});
  const verified=await codex.run('独立验收：只读检查当前目录 alwaysrun-ready.txt 是否存在且内容为 ALWAYSRUN_READY（允许尾部换行）。实际读取文件，不要仅相信本请求。用 JSON 返回 passed 和 summary。不得修改任何文件。',{cwd,schema,timeoutMs:180000});
  const actual=fs.readFileSync(path.join(cwd,'alwaysrun-ready.txt'),'utf8').trim();
  const commandPassed=(written.toolResults||[]).some(t=>t.type==='commandExecution'&&t.exitCode===0);
  const output={at:new Date().toISOString(),model:config.model,effort:config.effort,written,verified,actual,passed:actual==='ALWAYSRUN_READY'&&JSON.parse(verified.text).passed===true&&commandPassed};
  fs.writeFileSync(path.join(DATA,'live-smoke-result.json'),JSON.stringify(output,null,2));console.log(JSON.stringify({passed:output.passed,actual,verification:JSON.parse(verified.text)},null,2));
  if(!output.passed)process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1}finally{await codex.close();store.close()}
