import {sendPush} from './webpush.js';
// Bars rest-alert server. POST /schedule {sub,end,title,body} · POST /cancel {sub}
const cors=(env,req)=>{const o=req.headers.get('Origin')||'';const ok=(env.ALLOW_ORIGINS||'').split(',').map(s=>s.trim()).includes(o);return {'Access-Control-Allow-Origin':ok?o:'null','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400',Vary:'Origin'}};
const j=(d,s,h)=>new Response(JSON.stringify(d),{status:s,headers:{...h,'Content-Type':'application/json'}});
export default {async fetch(req,env){const h=cors(env,req);if(req.method==='OPTIONS')return new Response(null,{headers:h});
  const u=new URL(req.url);if(req.method==='GET'&&u.pathname==='/')return j({ok:true,service:'bars-push'},200,h);
  const LOG=env.TIMER.get(env.TIMER.idFromName('__log'));
  if(req.method==='GET'&&u.pathname==='/debug'){if(u.searchParams.get('self')){await LOG.selfTest()}return j(await LOG.getLog(),200,h)}
  if(req.method!=='POST')return j({error:'method'},405,h);if(h['Access-Control-Allow-Origin']==='null')return j({error:'origin'},403,h);
  let d;try{d=await req.json()}catch(_){return j({error:'json'},400,h)}
  const sub=d&&d.sub;if(!sub||typeof sub.endpoint!=='string'||!/^https:\/\//.test(sub.endpoint)||!sub.keys||!sub.keys.p256dh||!sub.keys.auth)return j({error:'sub'},400,h);
  const stub=env.TIMER.get(env.TIMER.idFromName(sub.endpoint)),host=new URL(sub.endpoint).host;
  if(u.pathname==='/schedule'){const end=+d.end;await LOG.log({ev:'schedule',inSec:Math.round((end-Date.now())/1000),host,title:String(d.title||'').slice(0,30)});if(!(end>Date.now()-5000&&end<Date.now()+3*3600e3))return j({error:'end'},400,h);
    await stub.schedule({sub,end,title:String(d.title||'Rest is over').slice(0,80),body:String(d.body||'Time for your next set').slice(0,160)});return j({ok:true},200,h)}
  if(u.pathname==='/status')return j(await stub.status(),200,h);
  if(u.pathname==='/cancel'){await LOG.log({ev:'cancel',host});await stub.cancel();return j({ok:true},200,h)}
  if(u.pathname==='/test'){const r=await sendPush(sub,JSON.stringify({title:'Bars',body:'Rest alerts are on 💪'}),env);return j({ok:r.ok,status:r.status},200,h)}
  return j({error:'path'},404,h)}};
export class RestTimer{constructor(state,env){this.state=state;this.env=env}
  async log(e){const a=(await this.state.storage.get('log'))||[];a.unshift(Object.assign({at:new Date().toISOString()},e));await this.state.storage.put('log',a.slice(0,40))}
  async getLog(){return {now:new Date().toISOString(),log:(await this.state.storage.get('log'))||[]}}
  async selfTest(){await this.state.storage.put('selfdue',Date.now()+5000);await this.state.storage.setAlarm(Date.now()+5000);await this.log({ev:'selftest-set'})}
  async status(){const [job,last]=await Promise.all([this.state.storage.get('job'),this.state.storage.get('last')]);return {ok:true,pending:job?job.end:0,last:last||null}}
  async schedule(job){await this.state.storage.put('job',job);await this.state.storage.setAlarm(Math.max(Date.now()+200,job.end))}
  async cancel(){await this.state.storage.delete('job');await this.state.storage.deleteAlarm()}
  async alarm(){const sd=await this.state.storage.get('selfdue');if(sd){await this.state.storage.delete('selfdue');await this.log({ev:'selftest-fired',lateMs:Date.now()-sd});return}
    const job=await this.state.storage.get('job');if(!job)return;await this.state.storage.delete('job');
    const r=await sendPush(job.sub,JSON.stringify({title:job.title,body:job.body,tag:'rest-'+job.end}),this.env);let txt='';try{txt=(await r.text()).slice(0,200)}catch(_){}
    await this.state.storage.put('last',{t:Date.now(),due:job.end,status:r.status,msg:txt});try{await this.env.TIMER.get(this.env.TIMER.idFromName('__log')).log({ev:'sent',lateMs:Date.now()-job.end,status:r.status,msg:txt,host:new URL(job.sub.endpoint).host})}catch(_){}if(r.status>=500){await this.state.storage.put('job',job);throw new Error('push '+r.status)}}}
