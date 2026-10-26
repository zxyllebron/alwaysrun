import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:8e6,windowsHide:true});
const files=git(['ls-files','--cached','-z']).split('\0').filter(Boolean);
if(!files.length)throw new Error('No indexed files to audit. Stage only public source files first.');
const roots=new Set(['src','static','scripts','tests','docs','examples','.github']);
const names=new Set(['README.md','README.en.md','LICENSE','SECURITY.md','CONTRIBUTING.md','CHANGELOG.md','package.json','.gitignore','.gitattributes','Start Alwaysrun.cmd','Stop Alwaysrun.cmd']);
const secrets=[
  /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{36,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /["'](?:app_secret|access_token|refresh_token|api_key)["']\s*:\s*["'][A-Za-z0-9_=-]{24,}["']/
];
const errors=[];
for(const file of files){
  if(!roots.has(file.split('/')[0])&&!names.has(file))errors.push(`${file}: outside the public source allowlist`);
  if(/(?:^|\/)(?:data|artifacts|\.codex|\.protocol|node_modules|reference)(?:\/|$)|\.(?:sqlite|db|log|key|pem)(?:-|$)|(?:^|\/)\.env(?:\.|$)/i.test(file))errors.push(`${file}: private runtime or credential path`);
  const body=git(['show',`:${file}`]);
  if(Buffer.byteLength(body)>750000||body.includes('\0'))errors.push(`${file}: unexpected large or binary file`);
  if(secrets.some(pattern=>pattern.test(body)))errors.push(`${file}: possible credential (value omitted)`);
  if(/[A-Z]:[\\/]Users[\\/][^\s"'<>\\/]+[\\/]/i.test(body))errors.push(`${file}: machine-specific user profile path`);
  if(/codex:\/\/threads\/[0-9a-f-]{36}/i.test(body))errors.push(`${file}: concrete conversation reference`);
}
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`Public source audit passed: ${files.length} indexed text files; runtime data and credential paths excluded.`);
