import fs from 'node:fs';
import path from 'node:path';
import { config, DATA, saveConfig } from '../src/config.mjs';

if(Number(process.versions.node.split('.')[0])<24)throw new Error('Node.js 24 or newer is required.');

function discoverCodex(){
  if(config.codexBin!=='codex')return config.codexBin;
  for(const dir of (process.env.PATH||'').split(path.delimiter).filter(Boolean)){
    for(const relative of process.platform==='win32'?['codex.exe','node_modules/@openai/codex/bin/codex.js']:['codex']){
      const file=path.resolve(dir,relative);if(fs.existsSync(file))return file;
    }
  }
  if(process.platform==='win32'&&process.env.LOCALAPPDATA){
    const dir=path.join(process.env.LOCALAPPDATA,'OpenAI','Codex','bin');
    if(fs.existsSync(dir)){
      const bins=fs.readdirSync(dir,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>path.join(dir,d.name,'codex.exe')).filter(f=>fs.existsSync(f));
      bins.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);if(bins.length)return bins[0];
    }
  }
  return config.codexBin;
}
const codexBin=discoverCodex();if(codexBin!==config.codexBin)saveConfig({codexBin});
fs.writeFileSync(path.join(DATA,'runtime.json'),JSON.stringify({node:process.execPath,codex:config.codexBin},null,2));
console.log(JSON.stringify({data:DATA,port:config.port,model:config.model,effort:config.effort,codexDetected:codexBin!=='codex'&&fs.existsSync(codexBin),url:`http://127.0.0.1:${config.port}/`},null,2));
