import { Codex } from '../src/codex.mjs';
import { Store } from '../src/store.mjs';
const codex=new Codex(),store=new Store(undefined,{recover:false});
codex.on('ownedThread',threadId=>{const owned=store.get('ownedThreads',[]);if(!owned.includes(threadId))store.set('ownedThreads',[...owned,threadId])});
try{console.log(JSON.stringify(await codex.connect(),null,2));if(process.argv.includes('--live')){const r=await codex.run('只回复 ALWAYSRUN_READY。不要使用工具，不要修改任何文件。',{timeoutMs:120000});console.log(JSON.stringify(r,null,2));}}catch(e){console.error(e.message);process.exitCode=1}finally{await codex.close();store.close()}
