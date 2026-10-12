// POST 串流沿用 A 的 Authorization；不把登入憑證放進網址。
export async function readRoomEvents(response, next, signal, progress) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || '即時房間連線失敗'),{status:response.status});
  }
  if (!response.body?.getReader || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw Object.assign(new Error('此連線暫不支援即時房間串流'),{status:503});
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const {done,value} = await reader.read();
      if (done) break;
      progress?.();
      buffer = (buffer + decoder.decode(value,{stream:true})).replace(/\r\n/g,'\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0,end); buffer = buffer.slice(end+2);
        const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const packet = JSON.parse(data);
        if (packet.error) throw Object.assign(new Error(packet.error),{status:packet.status});
        if (!signal.aborted) next(packet);
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
