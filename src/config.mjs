import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.resolve(process.env.ALWAYSRUN_DATA || path.join(ROOT, 'data'));
fs.mkdirSync(DATA, { recursive: true });
const defaults = {
  name: process.env.ALWAYSRUN_NAME || 'User', port: Number(process.env.ALWAYSRUN_PORT || 8790),
  model: process.env.ALWAYSRUN_MODEL || 'gpt-6.1-sol', effort: process.env.ALWAYSRUN_EFFORT || 'xhigh',
  codexBin: process.env.ALWAYSRUN_CODEX_BIN || 'codex', codexHome: process.env.ALWAYSRUN_CODEX_HOME || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  workstationDb: process.env.ALWAYSRUN_WORKSTATION_DB || '',
  syncSeconds: 60,
  night: { enabled: false, start: '23:00', hours: 8, maxTurns: 24, maxOutputTokens: 100000, taskMinutes: 20, maxIdleCycles: 2 },
  feishu: { baseUrl: 'https://open.feishu.cn', appIdEnv: 'FEISHU_APP_ID', appSecretEnv: 'FEISHU_APP_SECRET', bases: [] },
  longTermGoal: '根据已确认的长期目标与项目现状推进项目；第一项目卡住时先补齐其必要条件，再推进下一优先项目。'
};
const configPath = path.join(DATA, 'config.json');
let saved = {}; try { saved=JSON.parse(fs.readFileSync(configPath,'utf8')); } catch {}
export const config = { ...defaults,...saved,night:{...defaults.night,...saved.night},feishu:{...defaults.feishu,...saved.feishu} };
export function saveConfig(patch) {
  const next={...config,...patch,night:{...config.night,...patch.night},feishu:{...config.feishu,...patch.feishu}};
  if(typeof next.model!=='string'||!/^[-A-Za-z0-9_.:]{1,100}$/.test(next.model))throw new Error('模型名称无效');
  if(!['none','minimal','low','medium','high','xhigh','max','ultra'].includes(next.effort))throw new Error('推理等级无效');
  if(!Number.isInteger(next.port)||next.port<1024||next.port>65535)throw new Error('端口无效');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.night.start))throw new Error('时间格式应为 HH:MM');
  for(const [key,min,max] of [['hours',1,9],['maxTurns',1,500],['maxOutputTokens',1000,2000000],['taskMinutes',1,60],['maxIdleCycles',1,5]])if(!Number.isFinite(next.night[key])||next.night[key]<min||next.night[key]>max)throw new Error(`${key} 超出范围`);
  const temporary=configPath+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify(next,null,2));fs.renameSync(temporary,configPath);Object.assign(config,next);return config;
}
if(!fs.existsSync(configPath))saveConfig({});
