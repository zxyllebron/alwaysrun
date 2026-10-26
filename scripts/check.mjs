import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let count=0;
for(const dir of ['src','scripts','static','tests'])for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
  if(!entry.isFile()||!/[.](?:mjs|js)$/.test(entry.name))continue;
  const relative=path.join(dir,entry.name),result=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8',windowsHide:true});
  if(result.error||result.status!==0){console.error(relative,result.error?.message||result.stderr);process.exit(1)}count++;
}
console.log(`Syntax checks passed: ${count} files.`);
