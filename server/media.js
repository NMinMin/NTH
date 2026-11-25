import { createHmac, timingSafeEqual } from 'node:crypto';
export function sign(id,uid,exp,secret){return createHmac('sha256',secret).update(id+':'+uid+':'+exp).digest('hex')}
export function verify(id,uid,exp,sig,secret){
 if(!/^\d+$/.test(String(exp))||Number(exp)<Date.now()/1000||!/^[a-f0-9]{64}$/.test(sig||''))return false;
 return timingSafeEqual(Buffer.from(sign(id,uid,exp,secret),'hex'),Buffer.from(sig,'hex'));
}
export function rangeOf(header,size){
 if(!header)return {start:0,end:size-1,partial:false};
 const m=/^bytes=(\d*)-(\d*)$/.exec(header);
 if(!m||(!m[1]&&!m[2]))throw Error('range');
 const start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
 const end=m[1]&&m[2]?Math.min(Number(m[2]),size-1):size-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=size)throw Error('range');
 return {start,end,partial:true};
}
