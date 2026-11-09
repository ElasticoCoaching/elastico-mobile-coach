/* Elastico 0.5 test sync. No secret credentials in frontend. Auth + RLS enforced server-side. */
(function(){
'use strict';
const cfg=window.ELASTICO_SYNC_CONFIG||{};
const ready=()=>/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(cfg.url||'') && /^.{20,}$/.test(cfg.anonKey||'') && !cfg.anonKey.includes('REPLACE');
const role=document.documentElement.dataset.elasticoRole;
let session=null, member=null, busy=false, syncTimer=null, lastStatus='Ikke forbundet';
const k='elastico-sync-session-'+role;
try{session=JSON.parse(sessionStorage.getItem(k)||'null')}catch{}
const url=()=>cfg.url.replace(/\/$/,'');
const headers=()=>({'apikey':cfg.anonKey,'Authorization':'Bearer '+session.access_token,'Content-Type':'application/json'});
async function request(path,method='GET',body=null,extra={}){
 if(!session?.access_token)throw Error('Log ind først');
 const res=await fetch(url()+path,{method,headers:{...headers(),...extra},body:body===null?undefined:JSON.stringify(body)});
 const raw=await res.text();let data;try{data=raw?JSON.parse(raw):null}catch{data=raw}
 if(!res.ok){if(res.status===401){session=null;sessionStorage.removeItem(k)}throw Error((data?.message||data?.error_description||data?.error||data?.hint||res.statusText)+' ('+res.status+')')}
 return data;
}
function status(s){lastStatus=s;const e=document.getElementById('elastico-sync-status');if(e)e.textContent=s}
function panel(){
 const div=document.createElement('section');div.id='elastico-sync-panel';div.style='position:relative;z-index:9999;margin:8px auto;padding:12px;max-width:520px;background:#17353c;color:#fff;border:1px solid #65858b;border-radius:12px;font:14px system-ui';
 div.innerHTML='<div style="display:flex;gap:10px;justify-content:space-between;align-items:center"><strong>☁ Elastico 0.5 · '+(role==='coach'?'Træner':'Spiller')+'</strong><span id="elastico-sync-status" style="font-size:12px">Ikke forbundet</span></div><div id="elastico-sync-login" style="margin-top:9px;display:flex;gap:6px;flex-wrap:wrap"><input id="elastico-email" type="email" placeholder="Testkonto e-mail" aria-label="E-mail" style="flex:1;min-width:150px;padding:7px"><input id="elastico-password" type="password" placeholder="Adgangskode" aria-label="Adgangskode" style="flex:1;min-width:140px;padding:7px"><button id="elastico-login" style="padding:7px">Log ind</button></div><div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button id="elastico-sync-now" style="padding:7px">Synkronisér nu</button><button id="elastico-logout" style="padding:7px">Log ud</button></div><div style="font-size:11px;margin-top:8px;opacity:.85">Kun testdata. Online-overførsel kræver netforbindelse. JSON-backup er stadig tilgængelig.</div>';
 document.body.insertBefore(div,document.body.firstChild);
 div.querySelector('#elastico-login').onclick=login;
 div.querySelector('#elastico-sync-now').onclick=()=>sync(true);
 div.querySelector('#elastico-logout').onclick=()=>{session=null;member=null;sessionStorage.removeItem(k);status('Logget ud')};
 if(!ready())status('Konfiguration mangler');else if(session)verify().then(()=>sync(false)).catch(e=>status('Log ind igen: '+e.message));
}
async function login(){
 if(!ready())return status('Udfyld sync-config.js først');
 const email=document.getElementById('elastico-email').value.trim(),password=document.getElementById('elastico-password').value;
 if(!email||!password)return status('Angiv e-mail og adgangskode');
 try{
  const res=await fetch(url()+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'apikey':cfg.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const data=await res.json();if(!res.ok)throw Error(data.msg||data.error_description||data.message||'Login afvist');
  session={access_token:data.access_token,user_id:data.user.id,expires_at:Date.now()+data.expires_in*1000};sessionStorage.setItem(k,JSON.stringify(session));await verify();await sync(true);
 }catch(e){status('Loginfejl: '+e.message)}
}
async function verify(){
 if(!session||Date.now()>session.expires_at-30000)throw Error('Session udløbet – log ind igen');
 const m=await request('/rest/v1/elastico_demo_members?select=user_id,role&user_id=eq.'+encodeURIComponent(session.user_id));
 member=m?.[0];if(member?.role!==role){session=null;sessionStorage.removeItem(k);throw Error('Kontoen har ikke rollen '+role)}
 status('Forbundet som '+(role==='coach'?'træner':'spiller'));
}
async function getOtherUser(){const rows=await request('/rest/v1/elastico_demo_members?select=user_id,role&role=eq.'+(role==='coach'?'player':'coach'));return rows?.[0]?.user_id}
// Membership table only permits reading own row. Other user's ID is provided via explicit configuration.
function otherId(){const id=role==='coach'?cfg.playerUserId:cfg.coachUserId;if(!/^[a-f0-9-]{36}$/i.test(id||''))throw Error('Indsæt '+(role==='coach'?'playerUserId':'coachUserId')+' i sync-config.js');return id}
function validTask(t){return t&&/^coach-[A-Za-z0-9-]{1,100}$/.test(t.id||'')&&/^\d{4}-\d{2}-\d{2}$/.test(t.date||'')&&Array.isArray(t.exercises)&&t.exercises.length>0&&t.exercises.length<=30}
async function coachSync(){
 const b=window.bridgeState();const tasks=(b.tasks||[]).filter(validTask).slice(0,100);
 const playerId=otherId();
 if(tasks.length){const rows=tasks.map(t=>({id:t.id,coach_id:session.user_id,player_id:playerId,payload:t,updated_at:new Date().toISOString()}));await request('/rest/v1/elastico_demo_tasks?on_conflict=id','POST',rows,{'Prefer':'resolution=merge-duplicates,return=minimal'})}
 const feedback=await request('/rest/v1/elastico_demo_feedback?select=task_id,payload&order=updated_at.desc&limit=100');
 let changed=0;
 for(const row of feedback||[]){const f=row.payload;if(!b.tasks.some(t=>t.id===row.task_id))continue;if(JSON.stringify(b.feedback.find(x=>x.taskId===row.task_id))!==JSON.stringify(f)){b.feedback=b.feedback.filter(x=>x.taskId!==row.task_id);b.feedback.push(f);changed++}}
 if(changed){window.bridgeSave(b);if(typeof window.render==='function')window.render()}
 return `${tasks.length} opgaver sendt · ${feedback?.length||0} svar hentet`;
}
function playerId(){const p=window.elasticoGetPlayerDb()?.players?.find(v=>String(v.name||'').trim().toLowerCase()==='lucas hessel');if(!p)throw Error('Demospilleren Lucas Hessel findes ikke');return p.id}
async function playerSync(){
 const rows=await request('/rest/v1/elastico_demo_tasks?select=id,payload&order=updated_at.desc&limit=100');
 const pId=playerId();let imported=0;
 for(const row of rows||[]){const t=row.payload;if(!validTask(t))continue;
  const exercises=t.exercises.map((e,i)=>({id:t.id+'-ex'+i,name:String(e.name||'Øvelse').slice(0,100),prescription:String(e.prescription||'').slice(0,200),notes:String(e.notes||'').slice(0,800),module:String(e.module||'').slice(0,80),rounds:e.rounds??e.sets,workSeconds:e.workSeconds,restSeconds:e.restSeconds,design:e.design&&typeof e.design==='object'?e.design:null}));
  const event={id:t.id,date:t.date,teamId:window.elasticoGetPlayerDb().players.find(x=>x.id===pId).teamId,playerId:pId,type:'individual',title:String(t.title||'Træning').slice(0,100),exercises};
  const idx=window.elasticoGetPlayerDb().calendarEvents.findIndex(e=>e.id===t.id);
  if(idx<0){window.elasticoGetPlayerDb().calendarEvents.push(event);imported++}else if(JSON.stringify(window.elasticoGetPlayerDb().calendarEvents[idx].exercises)!==JSON.stringify(exercises)){window.elasticoGetPlayerDb().calendarEvents[idx]={...window.elasticoGetPlayerDb().calendarEvents[idx],...event};imported++}
 }
 if(imported){window.save();window.render()}
 const events=window.elasticoGetPlayerDb().calendarEvents.filter(e=>String(e.id).startsWith('coach-')&&e.playerId===pId&&rows?.some(r=>r.id===e.id));
 const feedback=events.map(t=>({taskId:t.id,title:t.title,date:t.date,rpe:window.elasticoGetPlayerDb().sessionFeedback?.[t.id]?.rpe||null,comment:window.elasticoGetPlayerDb().sessionFeedback?.[t.id]?.comment||'',completions:(t.exercises||[]).map(ex=>({name:ex.name,status:window.elasticoGetPlayerDb().taskCompletions?.find(c=>String(c.playerId)===String(pId)&&String(c.eventId)===String(t.id)&&String(c.taskId)===String(ex.id))?.status||'pending'}))}));
 const coachId=otherId();
 if(feedback.length){const payload=feedback.map(f=>({task_id:f.taskId,player_id:session.user_id,payload:f,updated_at:new Date().toISOString()}));await request('/rest/v1/elastico_demo_feedback?on_conflict=task_id','POST',payload,{'Prefer':'resolution=merge-duplicates,return=minimal'})}
 return `${rows?.length||0} opgaver hentet · ${feedback.length} svar sendt`;
}
async function sync(manual){
 if(!ready()){if(manual)status('Konfiguration mangler');return}
 if(!session){if(manual)status('Log ind først');return}
 if(busy)return;busy=true;
 try{await verify();status('Synkroniserer…');const result=role==='coach'?await coachSync():await playerSync();status('✓ '+result+' · '+new Date().toLocaleTimeString('da-DK'))}
 catch(e){status('Synkronisering fejlede: '+e.message)}finally{busy=false}
}
window.elasticoSync={schedule(){if(!session||busy)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>sync(false),900)},sync};
window.addEventListener('online',()=>sync(false));
setInterval(()=>{if(session&&document.visibilityState==='visible')sync(false)},20000);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',panel);else panel();
})();
