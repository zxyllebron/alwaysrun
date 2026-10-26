import { parentPort } from 'node:worker_threads';
import { Store } from './store.mjs';
import { Context } from './context.mjs';
const store=new Store(undefined,{recover:false});
try { parentPort.postMessage(await new Context(store).sync()); }
catch(error){parentPort.postMessage({running:false,error:error.message});}
finally{store.close();}
