'use strict';
const F=[['name','Наименование'],['type','Тип'],['sn','Заводской номер'],['year','Год выпуска'],['range','Диапазон измерений'],['cls','Класс точности'],['place','Место установки СИ'],['object','Объект установки'],['dept','Подразделение'],['inst','Дата установки'],['interval','Межповерочный интервал, мес.'],['date','Дата последней поверки / калибровки'],['kind','Поверка (П) / Калибровка (К)']];
const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const S={tok:localStorage.si_tok||'',sheets:{},me:null,cur:'*',q:'',open:null,lim:60};
const norm=s=>String(s||'').toLowerCase().replace(/[\s\-_.\/\\]/g,'');
const group=r=>/термоманометр|манометр/i.test(r.name)?'Манометры':'Термометры';
/* ---------- срок поверки ---------- */
function due(r){ // → {date:Date|null,text}
  const raw=String(r.date||'').replace(/[\\\s]/g,''); if(!raw)return null;
  let iv=parseInt(r.interval); if(!(iv>0))iv=group(r)==='Манометры'?12:24;
  let m,end;
  if(m=raw.match(/^([1-4])[кk](\d{2})$/i)){const y=2000+ +m[2],q=+m[1]; end=new Date(y,q*3,0); end.setMonth(end.getMonth()+iv+0); end=new Date(end.getFullYear(),end.getMonth()+1,0);} // конец квартала
  else if(m=raw.match(/^(\d{2})ДЯУ$/i)){end=new Date(2000+ +m[1]+iv/12,11,31)}                     // клеймо: до конца года
  else if(m=raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)){end=new Date(+m[3],+m[2]-1+iv,+m[1])}
  else if(m=raw.match(/^(\d{1,2})\.(\d{4})$/)){end=new Date(+m[2],+m[1]-1+iv+1,0)}
  else return null;
  return end;
}
function status(r){const d=due(r);if(!d)return{c:'',t:'нет даты',d:null};const days=(d-new Date())/864e5;
  const ds=d.toLocaleDateString('ru');return days<0?{c:'red',t:'просрочено',d:ds}:days<=92?{c:'yel',t:'скоро',d:ds}:{c:'grn',t:'годно',d:ds}}
/* ---------- GitHub как хранилище ---------- */
const TE=new TextEncoder(),hex=b=>[...b].map(x=>x.toString(16).padStart(2,'0')).join(''),unhex=h=>Uint8Array.from(h.match(/../g),x=>parseInt(x,16));
const b64=u=>{let s='';for(let i=0;i<u.length;i+=8192)s+=String.fromCharCode(...u.subarray(i,i+8192));return btoa(s)};
const unb64=s=>Uint8Array.from(atob(s.replace(/\s/g,'')),c=>c.charCodeAt(0));
const rq=new URLSearchParams(location.search).get('repo');if(rq)localStorage.si_repo=rq;
const REPO=localStorage.si_repo||(location.hostname.split('.')[0]+'/'+location.pathname.split('/')[1]);
const hd=()=>({Accept:'application/vnd.github+json',...(S.gh?{Authorization:'Bearer '+S.gh}:{})});
const api=p=>`https://api.github.com/repos/${REPO}/contents/${p}`;
async function rd(p){const r=await fetch(api(p)+'?t='+Date.now(),{headers:hd(),cache:'no-store'});if(r.status===404)return{sha:null,json:null};const j=await r.json();if(!r.ok)throw new Error(j.message||'GitHub '+r.status);
  let c=j.content;if(!c)c=(await(await fetch(j.git_url,{headers:hd()})).json()).content;return{sha:j.sha,json:JSON.parse(new TextDecoder().decode(unb64(c)))}}
async function upd(p,fn,msg){for(let i=0;i<5;i++){const{sha,json}=await rd(p);const nj=fn(json);
  const r=await fetch(api(p),{method:'PUT',headers:hd(),body:JSON.stringify({message:msg,content:b64(TE.encode(JSON.stringify(nj))),...(sha?{sha}:{})})});
  if(r.ok)return nj;if(r.status!==409&&r.status!==422)throw new Error((await r.json()).message||'GitHub '+r.status)}throw new Error('Конфликт записи, повторите')}
const hist=(hs)=>{const t=new Date().toISOString();return upd('data/history.json',h=>[...hs.map(x=>({t,user:S.me.login,...x})),...(h||[])].slice(0,3000),'history')};
const FK=F.map(f=>f[0]);
async function ops(list){const hs=[];
  const db=await upd('data/db.json',d=>{hs.length=0;for(const o of list){const sh=d.sheets[o.sheet];if(!sh)continue;const lab=r=>`${r.name} ${r.type} №${r.sn} (${r.place||'—'})`;
    if(o.op==='upd'){const r=sh.find(x=>x.id===o.id);if(!r)continue;const ch=[];for(const k of FK)if(o.row[k]!==undefined&&o.row[k]!==r[k]){ch.push(`${k}: «${r[k]}» → «${o.row[k]}»`);r[k]=o.row[k]}if(ch.length)hs.push({action:'upd',sheet:o.sheet,text:lab(r)+' | '+ch.join('; ')})}
    if(o.op==='add'){const r={id:o.nid,x:null};FK.forEach(k=>r[k]=String(o.row[k]??''));const i=sh.findIndex(x=>x.id===o.afterId);sh.splice(i<0?sh.length:i+1,0,r);hs.push({action:'add',sheet:o.sheet,text:lab(r)})}
    if(o.op==='del'){const i=sh.findIndex(x=>x.id===o.id);if(i<0)continue;hs.push({action:'del',sheet:o.sheet,text:lab(sh[i])});sh.splice(i,1)}}return d},'СИ: '+S.me.login);
  if(hs.length)await hist(hs);S.sheets=db.sheets;draw()}
const lib=(u,t)=>window[t]?Promise.resolve():new Promise((ok,no)=>{const s=document.createElement('script');s.src=u;s.onload=ok;s.onerror=()=>no(new Error('Не удалось загрузить библиотеку (нужен интернет)'));document.head.appendChild(s)});
const QRL=()=>lib('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js','qrcode').then(()=>{qrcode.stringToBytes=qrcode.stringToBytesFuncs['UTF-8']});
const qrSvg=(r,sz=4)=>{const q=qrcode(0,'M');q.addData(JSON.stringify({n:r.name,t:r.type,s:r.sn,r:r.range}));q.make();return q.createSvgTag({cellSize:sz,margin:2,scalable:true})};
function modal(html){const m=document.createElement('div');m.className='modal';m.innerHTML='<div class="mb">'+html+'</div>';m.onclick=e=>{if(e.target===m)m.remove()};document.body.appendChild(m);return m}
/* ---------- вход (пароль защищает токен GitHub: PBKDF2 + AES-GCM) ---------- */
async function kdf(pw,salt){const k=await crypto.subtle.importKey('raw',TE.encode(pw),'PBKDF2',false,['deriveBits']);const b=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations:200000,hash:'SHA-256'},k,512));return{h:hex(b.slice(0,32)),k:b.slice(32)}}
const aes=k=>crypto.subtle.importKey('raw',k,'AES-GCM',false,['encrypt','decrypt']);
async function encTok(t,k){const iv=crypto.getRandomValues(new Uint8Array(12));return{iv:hex(iv),ct:b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await aes(k),TE.encode(t))))}}
async function decTok(o,k){return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(o.iv)},await aes(k),unb64(o.ct)))}
const salt16=()=>hex(crypto.getRandomValues(new Uint8Array(16)));
async function login(){
  let U;try{S.gh='';U=(await rd('data/users.json')).json||{users:[]}}catch(e){app.innerHTML='<main><p style="color:var(--red)">'+esc(e.message)+'<br>Репозиторий: '+esc(REPO)+'</p></main>';return}
  const setup=!U.users.length;
  app.innerHTML=`<header><b>Учёт СИ</b></header><main><div class="mb" style="margin-top:30px"><h3>${setup?'Первый запуск: создайте администратора':'Вход'}</h3>
  <div class="row"><input id="lg" placeholder="Логин" autocapitalize="none"></div><div class="row"><input id="pw" type="password" placeholder="Пароль (от 4 символов)"></div>
  ${setup?'<div class="row"><input id="tk" type="password" placeholder="Токен GitHub (Contents: Read and write)"></div>':''}
  <div class="row"><button id="go">${setup?'Создать и войти':'Войти'}</button></div><p id="er" style="color:var(--red)"></p></div></main>`;
  $('#go').onclick=async()=>{try{const lg=$('#lg').value.trim(),pw=$('#pw').value;if(!lg||pw.length<4)throw new Error('Введите логин и пароль (от 4 символов)');let admin,gh;
    if(setup){gh=$('#tk').value.trim();S.gh=gh;const rr=await(await fetch('https://api.github.com/repos/'+REPO,{headers:hd()})).json();if(!rr.permissions?.push)throw new Error('Токен не даёт права записи в '+REPO);
      const salt=salt16(),d=await kdf(pw,salt),tok=await encTok(gh,d.k);await upd('data/users.json',()=>({users:[{login:lg,admin:true,salt,hash:d.h,tok}]}),'admin');admin=true;S.me={login:lg};await hist([{action:'setup',sheet:'',text:'Создан администратор'}])}
    else{const u=U.users.find(x=>x.login===lg);if(!u)throw new Error('Неверный логин или пароль');const d=await kdf(pw,u.salt);if(d.h!==u.hash)throw new Error('Неверный логин или пароль');gh=await decTok(u.tok,d.k);admin=!!u.admin}
    localStorage.si_s=JSON.stringify({login:lg,admin,gh});S.gh=gh;S.me={login:lg,admin};start()}catch(e){$('#er').textContent=e.message}};
}
async function start(){try{const j=await rd('data/db.json');S.sheets=j.json.sheets;S.cur='*';draw()}catch(e){alert(e.message)}}
/* ---------- основной экран ---------- */
const items=()=>Object.entries(S.sheets).flatMap(([sh,rows])=>(S.cur==='*'||S.cur===sh)?rows.map(r=>({sh,r})):[]);
function draw(){
  const all=items(),by={red:{},yel:{}},n={red:0,yel:0,grn:0,'':0};
  all.forEach(({r})=>{const s=status(r).c;n[s]++;if(by[s]){const g=r.name.trim();by[s][g]=(by[s][g]||0)+1}});
  const det=c=>Object.entries(by[c]).map(([k,v])=>`${esc(k)}: ${v}`).join('<br>')||'—';
  const tk=S.q.toLowerCase().split(/\s+/).filter(Boolean);
  const list=all.filter(({sh,r})=>tk.every(t=>(sh+' '+F.map(f=>r[f[0]]).join(' ')).toLowerCase().includes(t)));
  app.innerHTML=`<header><b>Учёт СИ · ${esc(S.me.login)}</b><button class="g s" id="bh">История</button>${S.me.admin?'<button class="g s" id="bu">Люди</button>':''}<button class="g s" id="bx">Выйти</button></header>
  <main><div class="row"><select id="sh"><option value="*">Все листы</option>${Object.keys(S.sheets).map(k=>`<option ${k===S.cur?'selected':''}>${esc(k)}</option>`).join('')}</select></div>
  <div class="stats"><div class="st"><b>${all.length}</b><small>Всего СИ</small></div><div class="st red"><b>${n.red}</b><small>Просрочено</small></div><div class="st yel"><b>${n.yel}</b><small>Скоро (&lt;3 мес.)</small></div><div class="st grn"><b>${n.grn}</b><small>Годно</small></div></div>
  <details style="margin:6px 0"><summary>По типам</summary><div class="row"><div class="st red"><small>Просрочено</small><br>${det('red')}</div><div class="st yel"><small>Скоро</small><br>${det('yel')}</div></div></details>
  <div class="row"><button id="bs">📷 Сканировать QR</button><button id="bb" class="g">📦 Установка пачкой</button></div>
  <div class="row"><input id="q" type="search" placeholder="Поиск: тип, номер, место…" value="${esc(S.q)}"></div>
  <div class="row"><button class="g s" id="be">⬇ Excel (актуальный)</button><button class="g s" id="bp">🖨 Печать QR</button><button class="g s" id="bn">🔔</button></div>
  <div id="ls">${list.slice(0,S.lim).map(({sh,r})=>card(sh,r)).join('')}${list.length>S.lim?`<button class="g" id="more">Показать ещё (${list.length-S.lim})</button>`:''}${list.length?'':'<p class="center">Ничего не найдено</p>'}</div></main>`;
  $('#sh').onchange=e=>{S.cur=e.target.value;draw()};
  $('#q').oninput=e=>{S.q=e.target.value;S.lim=60;clearTimeout(S.tm);S.tm=setTimeout(()=>{draw();const q=$('#q');q.focus();q.setSelectionRange(99,99)},250)};
  $('#bx').onclick=()=>{localStorage.removeItem('si_s');S.gh='';S.me=null;login()};$('#bh').onclick=history;if(S.me.admin)$('#bu').onclick=users;
  $('#bs').onclick=scanOne;$('#bb').onclick=batch;$('#bp').onclick=printQR;$('#be').onclick=exportXlsx;$('#bn').onclick=askNotify;
  const mo=$('#more');if(mo)mo.onclick=()=>{S.lim+=60;draw()};
  document.querySelectorAll('[data-o]').forEach(e=>e.onclick=()=>{S.open=S.open===e.dataset.o?null:e.dataset.o;draw()});
  document.querySelectorAll('[data-a]').forEach(b=>b.onclick=ev=>{ev.stopPropagation();act(b.dataset.a,b.dataset.sh,b.dataset.id)});
}
function card(sh,r){const s=status(r),o=S.open===sh+'|'+r.id;
  return `<div class="card ${s.c}"><div data-o="${esc(sh+'|'+r.id)}"><span class="bd">${s.t}${s.d?' · до '+s.d:''}</span><h4>${esc(r.name)} · ${esc(r.type)} · №${esc(r.sn)}</h4>
  <div class="sub">${esc(r.place)} — ${esc(r.object)} · ${esc(r.range)}<br>Лист: ${esc(sh)} · ${esc(r.date||'нет даты')} ${esc(r.kind)}</div></div>
  ${o?`<div class="fm">${F.map(([k,l])=>`<div><label>${l}</label><input data-f="${k}" value="${esc(r[k])}"></div>`).join('')}</div>
  <div class="row"><button data-a="save" data-sh="${esc(sh)}" data-id="${r.id}">Сохранить</button><button class="g" data-a="qr" data-sh="${esc(sh)}" data-id="${r.id}">Показать QR</button><button class="g" data-a="swap" data-sh="${esc(sh)}" data-id="${r.id}">⇄ Поменять местами</button><button class="r" data-a="del" data-sh="${esc(sh)}" data-id="${r.id}">Удалить</button></div>`:''}</div>`}
async function act(a,sh,id){const r=S.sheets[sh].find(x=>x.id===id);
  try{
  if(a==='save'){const row={};document.querySelectorAll('.card [data-f]').forEach(i=>row[i.dataset.f]=i.value.trim());await ops([{op:'upd',sheet:sh,id,row}])}
  if(a==='del'&&confirm(`Удалить из таблицы?\n${r.name} ${r.type} №${r.sn}`)){S.open=null;await ops([{op:'del',sheet:sh,id}])}
  if(a==='qr'){await QRL();const m=modal(`<div class="center" style="max-width:300px;margin:auto">${qrSvg(r,6)}<p>${esc(r.name)} ${esc(r.type)}<br>№${esc(r.sn)} · ${esc(r.range)}<br><b>${esc(r.place)}</b></p><button class="g" onclick="this.closest('.modal').remove()">Закрыть</button></div>`)}
  if(a==='swap'){alert('Отсканируйте QR второго СИ, с которым нужно поменяться местами');const q=await scanCode();if(!q)return;const f=find(q);if(!f||f.sh!==sh)return alert('Второй прибор не найден на этом листе');
    const P=['place','object','dept','inst'],a1={},b1={};P.forEach(k=>{a1[k]=f.r[k];b1[k]=r[k]});
    if(confirm(`Поменять местами:\n«${r.place}» ⇄ «${f.r.place}»?`))await ops([{op:'upd',sheet:sh,id,row:a1},{op:'upd',sheet:sh,id:f.r.id,row:b1}])}
  }catch(e){alert(e.message)}}
/* ---------- сканер ---------- */
function parseQR(t){try{const j=JSON.parse(t);if(j.s!==undefined)return{name:j.n||'',type:j.t||'',sn:String(j.s),range:j.r||''}}catch{}return null}
function find(q){for(const[sh,rows]of Object.entries(S.sheets)){const r=rows.find(r=>norm(r.sn)===norm(q.sn)&&norm(r.type)===norm(q.type));if(r)return{sh,r}}
  for(const[sh,rows]of Object.entries(S.sheets)){const r=rows.find(r=>norm(r.sn)===norm(q.sn)&&norm(r.name)===norm(q.name));if(r)return{sh,r}}return null}
async function scanCode(cont){ // cont(q) вызывается на каждый код; без cont — вернёт первый
  await lib('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js','jsQR');
  const m=modal('<video playsinline muted></video><div class="row"><button class="g" id="cx">Закрыть</button></div><p id="msg" class="center"></p>'),v=m.querySelector('video');
  let stream;try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}})}catch{m.remove();alert('Нет доступа к камере');return null}
  v.srcObject=stream;await v.play();const bd=window.BarcodeDetector?new BarcodeDetector({formats:['qr_code']}):null,cv=document.createElement('canvas'),cx=cv.getContext('2d',{willReadFrequently:true});
  return new Promise(res=>{let alive=true,last='',lt=0;const stop=v=>{alive=false;stream.getTracks().forEach(t=>t.stop());m.remove();res(v)};m.querySelector('#cx').onclick=()=>stop(null);
    (async function tick(){if(!alive)return;let txt='';
      try{if(v.videoWidth){if(bd){const c=await bd.detect(v);txt=c[0]?.rawValue||''}
        if(!txt){cv.width=v.videoWidth;cv.height=v.videoHeight;cx.drawImage(v,0,0);const im=cx.getImageData(0,0,cv.width,cv.height),c=jsQR(im.data,im.width,im.height);txt=c?.data||''}}}catch{}
      const q=txt&&parseQR(txt);
      if(q&&(txt!==last||Date.now()-lt>3000)){last=txt;lt=Date.now();if(cont){const ok=await cont(q);m.querySelector('#msg').textContent=ok||'';}else return stop(q)}
      requestAnimationFrame(tick)})();});
}
async function scanOne(){const q=await scanCode();if(!q)return;const f=find(q);if(f){S.cur=f.sh;S.q='';S.open=f.sh+'|'+f.r.id;draw();document.querySelector('.card.open,.card')?.scrollIntoView()}else addDlg(q)}
/* ---------- добавление нового СИ ---------- */
function addDlg(q){
  let best=null,bs=-1,after=-1;
  for(const[sh,rows]of Object.entries(S.sheets)){let s=0,last=-1;rows.forEach((r,i)=>{const p=(norm(r.name)===norm(q.name)?2:0)+(norm(r.type)===norm(q.type)?3:0)+(norm(r.range)===norm(q.range)?1:0);if(p>=2){s+=p;last=i}});if(s>bs){bs=s;best=sh;after=last}}
  const m=modal(`<h3>СИ не найдено в таблице</h3><p>${esc(q.name)} ${esc(q.type)} №${esc(q.sn)} ${esc(q.range)}</p><label>Лист</label><select id="as" style="width:100%">${Object.keys(S.sheets).map(k=>`<option ${k===best?'selected':''}>${esc(k)}</option>`).join('')}</select>
  <p class="sub" id="ai"></p><div class="fm" id="af"></div><div class="row"><button id="ay">Добавить</button><button class="g" id="an">Отмена</button></div>`);
  const fill=()=>{const sh=m.querySelector('#as').value,rows=S.sheets[sh];let a=-1;rows.forEach((r,i)=>{if(norm(r.name)===norm(q.name)&&norm(r.type)===norm(q.type))a=i});if(a<0)rows.forEach((r,i)=>{if(norm(r.name)===norm(q.name))a=i});after=a;
    const nb=rows[a]||{};m.querySelector('#ai').textContent=a>=0?`Будет вставлено после: «${nb.place}» (${nb.object})`:'Будет добавлено в конец листа';
    m.querySelector('#af').innerHTML=F.map(([k,l])=>{const v=q[k]??(['dept','object','interval','inst'].includes(k)?nb[k]||'':'');return`<div><label>${l}</label><input data-f="${k}" value="${esc(v)}"></div>`}).join('')};
  m.querySelector('#as').onchange=fill;fill();m.querySelector('#an').onclick=()=>m.remove();
  m.querySelector('#ay').onclick=async()=>{const row={};m.querySelectorAll('[data-f]').forEach(i=>row[i.dataset.f]=i.value.trim());const sh=m.querySelector('#as').value;m.remove();S.cur=sh;await ops([{op:'add',sheet:sh,row,afterId:S.sheets[sh][after]?.id,nid:'n'+Date.now().toString(36)}])}}
/* ---------- пакетная установка ---------- */
async function batch(){
  const L=[];const m=document.createElement('div');
  alert('Сканируйте приборы по очереди. Для каждого можно указать новое место и данные поверки/калибровки. Затем «Применить».');
  const q0=await scanCode(async q=>{const f=find(q);if(!f)return 'Не найден: '+q.sn;if(L.some(x=>x.f.r.id===f.r.id))return 'Уже в списке';L.push({f,place:'',date:f.r.date,kind:f.r.kind});return`Добавлено: ${f.r.type} №${f.r.sn} (всего ${L.length})`});
  if(!L.length)return;
  const mm=modal(`<h3>Установка: ${L.length} шт.</h3><div id="bl"></div><div class="row"><button id="ap">Применить</button><button class="g" id="ca">Отмена</button></div>`);
  mm.querySelector('#bl').innerHTML=L.map((x,i)=>{const r=x.f.r,pl=[...new Map(S.sheets[x.f.sh].filter(z=>z.name===r.name).map(z=>[z.place+'|'+z.object,z])).values()];
    return`<div class="card"><b>${esc(r.type)} №${esc(r.sn)}</b><div class="sub">Сейчас: ${esc(r.place)} (${esc(r.object)})</div><div class="fm"><div><label>Установить на место</label><select data-i="${i}" data-k="place"><option value="">— без изменения —</option>${pl.map(z=>`<option value="${esc(z.place+'|'+z.object)}">${esc(z.place)} — ${esc(z.object)}</option>`).join('')}</select></div>
    <div><label>Дата поверки/калибровки</label><input data-i="${i}" data-k="date" value="${esc(x.date)}"></div><div><label>П / К</label><input data-i="${i}" data-k="kind" value="${esc(x.kind)}"></div></div></div>`}).join('');
  mm.querySelectorAll('[data-i]').forEach(e=>e.onchange=()=>L[e.dataset.i][e.dataset.k]=e.value);
  mm.querySelector('#ca').onclick=()=>mm.remove();
  mm.querySelector('#ap').onclick=async()=>{const o=[],used=new Set(L.map(x=>x.f.r.id));
    for(const x of L){const r=x.f.r,row={date:x.date.trim(),kind:x.kind.trim()};
      if(x.place){const[p,ob]=x.place.split('|');if(p!==r.place||ob!==r.object){row.place=p;row.object=ob;
        const other=S.sheets[x.f.sh].find(z=>z.id!==r.id&&z.place===p&&z.object===ob&&!used.has(z.id));if(other)o.push({op:'upd',sheet:x.f.sh,id:other.id,row:{place:r.place,object:r.object}})}}
      o.push({op:'upd',sheet:x.f.sh,id:r.id,row})}
    mm.remove();try{await ops(o)}catch(e){alert(e.message)}}}
/* ---------- печать QR ---------- */
async function printQR(){await QRL();const all=items(),cells=all.map(({r})=>`<div class="c">${qrSvg(r,3)}<div class="t"><b>${esc(r.place)}</b><br>${esc(r.object)}</div></div>`).join('');
  const w=window.open('','_blank');w.document.write(`<!doctype html><meta charset=utf-8><title>QR СИ</title><style>@page{size:A4;margin:8mm}body{margin:0;font:9px Arial}.g{display:grid;grid-template-columns:repeat(5,1fr)}.c{border:.5px dashed #888;padding:2mm;text-align:center;break-inside:avoid;height:41mm;overflow:hidden}.c svg{width:24mm;height:24mm}.t{font-size:8px;line-height:1.1}.n{padding:4px;font-size:12px}@media print{.n{display:none}}</style><div class=n>${all.length} наклеек (${esc(S.cur==='*'?'все листы':S.cur)}). <button onclick=print()>Печать / Сохранить в PDF</button></div><div class=g>${cells}</div>`);w.document.close()}
/* ---------- Excel, история, пользователи, push ---------- */
async function exportXlsx(){const r=await fetch(api('Perechen_SI.xlsx'),{headers:{...hd(),Accept:'application/vnd.github.raw'}});if(!r.ok)return alert('Файл ещё не сформирован (смотрите вкладку Actions в репозитории)');
  const a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download='Перечень_СИ.xlsx';a.click()}
async function history(){const h=(await rd('data/history.json')).json||[];const A={upd:'изменил',add:'добавил',del:'удалил',user:'пользователи',setup:'настройка'};
  modal(`<h3>История</h3>${h.map(x=>`<div class="hist"><small>${new Date(x.t).toLocaleString('ru')} · <b>${esc(x.user)}</b> ${A[x.action]||x.action}${x.sheet?' · '+esc(x.sheet):''}</small><br>${esc(x.text)}</div>`).join('')||'Пока пусто'}<div class="row"><button class="g" onclick="this.closest('.modal').remove()">Закрыть</button></div>`)}
async function users(){const U=(await rd('data/users.json')).json;const m=modal(`<h3>Пользователи</h3>${U.users.map(x=>`<div class="hist">${esc(x.login)} ${x.admin?'(админ)':`<button class="r s" data-d="${esc(x.login)}">удалить</button>`}</div>`).join('')}
  <div class="row"><input id="nl" placeholder="Новый логин" autocapitalize="none"><input id="np" placeholder="Пароль"></div><div class="row"><button id="na">Создать</button><button class="g" id="nc">Закрыть</button></div>`);
  m.querySelector('#nc').onclick=()=>m.remove();
  m.querySelector('#na').onclick=async()=>{try{const nl=$('#nl').value.trim(),np=$('#np').value;if(!nl||np.length<4)throw new Error('Логин и пароль (от 4 символов)');const salt=salt16(),d=await kdf(np,salt),tok=await encTok(S.gh,d.k);
    await upd('data/users.json',u=>{if(u.users.some(x=>x.login===nl))throw new Error('Логин занят');u.users.push({login:nl,salt,hash:d.h,tok});return u},'user '+nl);await hist([{action:'user',sheet:'',text:'Создан пользователь '+nl}]);m.remove();users()}catch(e){alert(e.message)}};
  m.querySelectorAll('[data-d]').forEach(b=>b.onclick=async()=>{if(confirm('Удалить '+b.dataset.d+'?')){await upd('data/users.json',u=>({users:u.users.filter(x=>x.login!==b.dataset.d)}),'user del');await hist([{action:'user',sheet:'',text:'Удалён пользователь '+b.dataset.d}]);m.remove();users()}})}
const u8=s=>{const p='='.repeat((4-s.length%4)%4);return unb64((s+p).replace(/-/g,'+').replace(/_/g,'/'))};
async function askNotify(){try{if(await Notification.requestPermission()!=='granted')return alert('Уведомления запрещены в настройках браузера');
  const cfg=(await rd('data/config.json')).json,reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:u8(cfg.vapid)});
  await upd('data/subs.json',s=>{s=s||{subs:[]};s.subs=s.subs.filter(x=>x.endpoint!==sub.endpoint);s.subs.push({...sub.toJSON(),login:S.me.login});return s},'push sub');alert('Push-уведомления включены для этого устройства')}catch(e){alert(e.message)}}
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js');
try{const ss=JSON.parse(localStorage.si_s||'null');if(ss){S.gh=ss.gh;S.me={login:ss.login,admin:ss.admin}}}catch{}
S.me?start():login();
