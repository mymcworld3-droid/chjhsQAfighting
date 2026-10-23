import {readRoomEvents} from '../cultivation/data/room-event-stream.js';
export function createWorldTransport(authFetch){
  async function request(action,payload={},options={}){
    const controller=new AbortController();let timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('大世界連線逾時，請重試；進度會依伺服器紀錄恢復'));},action==='battle'&&payload.command==='questions'?18000:15000);});
    try{return await Promise.race([deadline,(async()=>{
      const response=await authFetch('/api/world',{method:'POST',body:JSON.stringify({action,...payload}),signal:controller.signal,keepalive:!!options.keepalive});
      const data=await response.json();if(!response.ok||!data.ok)throw Object.assign(new Error(data.error||'大世界操作未完成'),{status:response.status});return data;
    })()]);}finally{clearTimeout(timer);}
  }
  function subscribe(next,onError,resume){
    let stopped=false,controller,retry,delay=1000,connectedBefore=false;
    async function connect(){
      if(stopped)return;controller=new AbortController();const current=controller;let watchdog;
      const progress=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>current.abort(),30000);};
      try{
        if(connectedBefore)await resume?.();if(stopped)return;
        progress();const response=await authFetch('/api/world',{method:'POST',body:JSON.stringify({action:'subscribe'}),signal:current.signal});
        await readRoomEvents(response,packet=>{if(stopped)return;connectedBefore=true;delay=1000;next(packet);},current.signal,progress);
      }catch(error){if(!stopped)onError?.(error);if(error.status===401){stopped=true;return;}}
      finally{clearTimeout(watchdog);current.abort();if(!stopped){onError?.();retry=setTimeout(connect,delay);delay=Math.min(30000,delay*2);}}
    }
    void connect();return ()=>{stopped=true;clearTimeout(retry);controller?.abort();};
  }
  return {request,subscribe};
}
