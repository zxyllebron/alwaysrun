import { config } from './config.mjs';
import { now, clean } from './util.mjs';
export class Feishu {
  constructor(store){this.store=store;this.token=null;this.expires=0;}
  status(){return {configured:!!(process.env[config.feishu.appIdEnv]&&process.env[config.feishu.appSecretEnv]),bases:config.feishu.bases,lastSync:this.store.get('feishuSync'),localSnapshotRecords:this.store.db.prepare("SELECT count(*) n FROM documents WHERE kind='feishu'").get().n};}
  async request(route,token){const response=await fetch(config.feishu.baseUrl+'/open-apis/'+route,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000),redirect:'error'});const body=await response.json();if(!response.ok||body.code!==0)throw new Error(`飞书读取失败（${body.code||response.status}）：${clean(body.msg||'权限或资源不可用')}`);return body.data;}
  async authenticate(){
    if(this.token&&this.expires>Date.now())return this.token;
    const app_id=process.env[config.feishu.appIdEnv],app_secret=process.env[config.feishu.appSecretEnv];
    if(!app_id||!app_secret)throw new Error('飞书实时读取尚未授权：请在本机环境配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET，并给机器人相应资源读取权限。');
    // Endpoint is fixed to the official service. Credentials are never sent to the model or stored by alwaysrun.
    if(config.feishu.baseUrl!=='https://open.feishu.cn')throw new Error('飞书认证地址必须为官方 https://open.feishu.cn');
    const r=await fetch(config.feishu.baseUrl+'/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app_id,app_secret}),signal:AbortSignal.timeout(30000),redirect:'error'});const data=await r.json();
    if(!r.ok||data.code!==0||!data.tenant_access_token)throw new Error(`飞书应用认证失败（${data.code||r.status}）`);
    this.token=data.tenant_access_token;this.expires=Date.now()+Math.max(30,data.expire-60)*1000;return this.token;
  }
  async sync(){
    const token=await this.authenticate();if(!config.feishu.bases.length)throw new Error('请先在资料连接中添加飞书多维表格链接。教程文章不含你的数据库地址。');
    let records=0,tables=0;
    for(const base of config.feishu.bases){
      let tableList=base.tableId?[{table_id:base.tableId,name:base.title||'多维表格'}]:[];
      if(!tableList.length){let page;do{const d=await this.request(`bitable/v1/apps/${encodeURIComponent(base.appToken)}/tables?page_size=100${page?'&page_token='+encodeURIComponent(page):''}`,token);tableList.push(...(d.items||[]));page=d.has_more?d.page_token:null}while(page)}
      for(const table of tableList){let page;tables++;do{const d=await this.request(`bitable/v1/apps/${encodeURIComponent(base.appToken)}/tables/${encodeURIComponent(table.table_id)}/records?page_size=500${page?'&page_token='+encodeURIComponent(page):''}`,token);
        for(const rec of d.items||[]){this.store.putDoc({id:`feishu:${base.appToken}:${table.table_id}:${rec.record_id}`,kind:'feishu',title:table.name||base.title||'飞书多维表格',uri:base.url,body:JSON.stringify(rec.fields,null,2),updated:now(),meta:{recordId:rec.record_id,tableId:table.table_id,role:'record',source:'feishu-api'}});records++}page=d.has_more?d.page_token:null;
      }while(page)}
    }
    const result={at:now(),records,tables};this.store.set('feishuSync',result);this.store.event('source','飞书数据库已同步',`${tables} 张表，${records} 条记录`);return result;
  }
}
