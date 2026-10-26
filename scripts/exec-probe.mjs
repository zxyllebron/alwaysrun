import {Codex} from '../src/codex.mjs';
import {ROOT} from '../src/config.mjs';
const codex=new Codex();
try{
  await codex.connect();
  for(const sandboxPolicy of [{type:'readOnly'},{type:'workspaceWrite',writableRoots:[ROOT],networkAccess:false}]){
    const result=await codex.request('command/exec',{command:[process.execPath,'-e','console.log("ALWAYSRUN_EXEC_READY")'],cwd:ROOT,sandboxPolicy,timeoutMs:15000},30000);
    if(result.exitCode!==0||!result.stdout.includes('ALWAYSRUN_EXEC_READY'))throw new Error('命令执行未通过验证');
    console.log(JSON.stringify({mode:sandboxPolicy.type,...result}));
  }
}catch(e){console.error(e.message);process.exitCode=1}finally{await codex.close()}
