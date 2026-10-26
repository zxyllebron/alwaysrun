import { Worker } from 'node:worker_threads';
import { Context } from './context.mjs';

// Reading the user's large SQLite stores never blocks HTTP, stop controls, or the deadline timer.
export class BackgroundContext extends Context {
  async sync(){
    if(this.promise)return this.promise;
    this.busy=true;this.status={...(this.store.get('sourceStatus')||this.status),running:true};
    this.promise=new Promise((resolve)=>{
      const worker=this.worker=new Worker(new URL('./sync-worker.mjs',import.meta.url));
      let settled=false;
      const done=status=>{if(settled)return;settled=true;this.status=status;this.busy=false;this.promise=null;this.worker=null;resolve(status)};
      worker.once('message',done);worker.once('error',error=>done({...this.status,running:false,error:error.message}));
      worker.once('exit',code=>{if(!settled)done({...this.status,running:false,error:`资料同步进程退出（${code}）`})});
    });return this.promise;
  }
}
