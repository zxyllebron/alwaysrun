import crypto from 'node:crypto';
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export const hash = value => crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:String(value)).digest('hex');
export const displayPath = value => String(value||'').replace(/^\\\\\?\\/, '');
export function clean(value) {
  return String(value ?? '')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[私钥已隐藏]')
    .replace(/\b(?:sk-|gh[pousr]_|glpat-)[A-Za-z0-9_.-]{10,}/g, '[凭据已隐藏]')
    .replace(/((?:password|passwd|app_secret|client_secret|access_token|refresh_token|api_key|密码)["']?\s*[:=：]\s*["']?)[^\s"',}\n]{4,}/gi, '$1[凭据已隐藏]')
    .replace(/([?&](?:token|code|key|disposable_login_token)=)[^\s&)]+/gi, '$1[凭据已隐藏]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{12,}/gi, 'Bearer [凭据已隐藏]');
}
export function parseJSON(text) {
  const trimmed = String(text).trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  try { return JSON.parse(trimmed); } catch {
    const start = trimmed.indexOf('{'), end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('模型未返回有效 JSON；本次结果未被当成计划执行。');
  }
}
export function chinaTime(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type,p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour)*60+Number(parts.minute) };
}
export const minuteOf = str => Number(str.slice(0,2))*60+Number(str.slice(3,5));
export function inWindow(start, hours, date = new Date()) {
  const t=chinaTime(date), begin=minuteOf(start), elapsed=(t.minute-begin+1440)%1440;
  const anchor = new Date(date.getTime() - elapsed*60000);
  return { active: elapsed < hours*60, key: chinaTime(anchor).day, elapsed };
}
export function assertText(value, name, max = 20000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name}不能为空，且长度不能超过 ${max} 字符。`);
  return value.trim();
}
