'use strict';
const F=[['name','Наименование'],['type','Тип'],['sn','Заводской номер'],['year','Год выпуска'],['range','Диапазон измерений'],['cls','Класс точности'],['place','Место установки СИ'],['object','Объект установки'],['dept','Подразделение'],['inst','Дата установки'],['interval','Межповерочный интервал, мес.'],['date','Дата последней поверки / калибровки'],['kind','Поверка (П) / Калибровка (К)']];
const $=s=>document.querySelector(s),app=$('#app');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const S={sheets:{},me:null,cur:'*',q:'',open:null,lim:60};
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
S.gh=localStorage.si_g||'';
const hd=()=>({Accept:'application/vnd.github+json',...(S.gh?{Authorization:'Bearer '+S.gh}:{})});
const gu=p=>`https://api.github.com/repos/${REPO}${p}`;
async function g(p,method,body){const r=await fetch(gu(p),{method:method||'GET',headers:hd(),body:body?JSON.stringify(body):undefined,cache:'no-store'});let j={};try{j=await r.json()}catch{}
  if(r.status===401&&S.gh){localStorage.removeItem('si_g');localStorage.removeItem('si_s');S.gh='';S.me=null;setTimeout(login,0);throw new Error('Токен недействителен — войдите заново и введите фразу бригады')}
  if(!r.ok){const e=new Error(j.message||'GitHub '+r.status);e.status=r.status;throw e}return j}
async function rd(p,ref){let j;try{j=await g('/contents/'+p+'?t='+Date.now()+(ref?'&ref='+ref:''))}catch(e){if(e.status===404)return{sha:null,json:null};throw e}
  let c=j.content;if(!c)c=(await g('/git/blobs/'+j.sha)).content;return{sha:j.sha,json:JSON.parse(new TextDecoder().decode(unb64(c)))}}
let BR='';
// Атомарный коммит нескольких файлов; при гонке (кто-то успел раньше) всё перечитывается и применяется заново
async function txn(build,msg){for(let i=0;i<6;i++){
  if(!BR)BR=(await g('')).default_branch;
  const head=(await g(`/git/ref/heads/${BR}`)).object.sha,cm=await g('/git/commits/'+head);
  const files=await build(async p=>(await rd(p,head)).json);if(!files)return null;
  const tree=await g('/git/trees','POST',{base_tree:cm.tree.sha,tree:Object.entries(files).map(([path,o])=>({path,mode:'100644',type:'blob',content:JSON.stringify(o)}))});
  const c=await g('/git/commits','POST',{message:msg,tree:tree.sha,parents:[head]});
  try{await g(`/git/refs/heads/${BR}`,'PATCH',{sha:c.sha,force:false});return files}catch(e){if(e.status!==422&&e.status!==409)throw e}}
  throw new Error('Конфликт записи, повторите')}
const upd=async(p,fn,msg)=>(await txn(async rd=>({[p]:fn(await rd(p))}),msg))[p];
const hfile=async(rd,hs)=>{const p='data/history/'+new Date().toISOString().slice(0,7)+'.json',t=new Date().toISOString();return[p,[...hs.map(x=>({t,user:S.me.name||S.me.login,...x})),...((await rd(p))||[])]]};
const hist=hs=>txn(async rd=>{const[p,a]=await hfile(rd,hs);return{[p]:a}},'history');
/* ---------- загрузка таблицы: файл на лист, кэш по sha ---------- */
async function loadAll(){
  const[idx,dir]=await Promise.all([rd('data/index.json'),g('/contents/data/s?t='+Date.now())]);
  if(!idx.json)throw new Error('Данные не найдены. Запустите в репозитории Actions → seed (новая установка) или migrate (старый формат).');
  S.index=idx.json.sheets;localStorage.si_idx=JSON.stringify(S.index);const shaOf=Object.fromEntries(dir.map(f=>[f.name,f.sha])),out={};
  await Promise.all(S.index.map(async m=>{const k='si_c_'+m.file;let c=null;try{c=JSON.parse(localStorage[k]||'null')}catch{}
    if(!c||c.sha!==shaOf[m.file]){const r=await rd('data/s/'+m.file);c={sha:r.sha,rows:r.json.rows};try{localStorage[k]=JSON.stringify(c)}catch{}}out[m.name]=c.rows}));
  S.sheets=Object.fromEntries(S.index.map(m=>[m.name,out[m.name]]));S.lt=Date.now()}
const FK=F.map(f=>f[0]),lbl=k=>F.find(f=>f[0]===k)[1];
// mk: только изменённые поля + прежние значения (для слияния с чужими правками)
const mk=(sheet,id,row)=>{const cur=S.sheets[sheet].find(x=>x.id===id),r={},w={};for(const k in row)if(row[k]!==cur[k]){r[k]=row[k];w[k]=cur[k]}return{op:'upd',sheet,id,row:r,was:w}};
async function ops(list){
  list=list.filter(o=>o.op!=='upd'||Object.keys(o.row).length);if(!list.length)return;
  const names=[...new Set(list.map(o=>o.sheet))],meta=n=>S.index.find(x=>x.name===n),dec={},fresh={};
  for(const n of names)fresh[n]=(await rd('data/s/'+meta(n).file)).json.rows;
  for(const o of list.filter(o=>o.op==='upd')){const fr=fresh[o.sheet].find(x=>x.id===o.id);if(!fr)continue;
    for(const k in o.row)if(fr[k]!==o.was[k]&&fr[k]!==o.row[k])dec[o.id+'.'+k]=confirm(`Поле «${lbl(k)}» только что изменил другой пользователь.\nСейчас в таблице: «${fr[k]}»\nВы хотите поставить: «${o.row[k]}»\n\nOK — поставить ваше значение, Отмена — оставить чужое`)?'mine':'theirs'}
  const hs=[];
  const files=await txn(async rd=>{hs.length=0;const files={};
    for(const n of names){const p='data/s/'+meta(n).file,d=await rd(p),sh=d.rows,lab=r=>`${r.name} ${r.type} №${r.sn} (${r.place||'—'})`;
      for(const o of list.filter(o=>o.sheet===n)){
        if(o.op==='upd'){const r=sh.find(x=>x.id===o.id);if(!r)continue;const ch=[],sk=[];
          for(const k in o.row){if(r[k]===o.row[k])continue;if(r[k]!==o.was[k]&&dec[o.id+'.'+k]!=='mine'){sk.push(lbl(k));continue}ch.push(`${lbl(k)}: «${r[k]}» → «${o.row[k]}»`);r[k]=o.row[k]}
          if(ch.length||sk.length)hs.push({action:'upd',sheet:n,text:lab(r)+(ch.length?' | '+ch.join('; '):'')+(sk.length?' | не применено (изменил другой): '+sk.join(', '):'')})}
        if(o.op==='add'){const r={id:o.nid,x:null};FK.forEach(k=>r[k]=String(o.row[k]??''));let i=o.afterId==='__first'?0:sh.findIndex(x=>x.id===o.afterId)+1;if(o.afterId!=='__first'&&i===0)i=sh.length;sh.splice(i,0,r);hs.push({action:'add',sheet:n,text:lab(r)})}
        if(o.op==='del'){const i=sh.findIndex(x=>x.id===o.id);if(i<0)continue;hs.push({action:'del',sheet:n,text:lab(sh[i])});sh.splice(i,1)}}
      files[p]=d}
    if(!hs.length)return null;const[hp,ha]=await hfile(rd,hs);files[hp]=ha;return files},'СИ: '+S.me.login);
  if(files)for(const n of names)S.sheets[n]=files['data/s/'+meta(n).file].rows;
  draw()}
const lib=(u,t)=>window[t]?Promise.resolve():new Promise((ok,no)=>{const s=document.createElement('script');s.src=u;s.onload=ok;s.onerror=()=>no(new Error('Не удалось загрузить библиотеку (нужен интернет)'));document.head.appendChild(s)});
const QRL=()=>lib('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js','qrcode').then(()=>{qrcode.stringToBytes=qrcode.stringToBytesFuncs['UTF-8']});
const qrSvg=(r,sz=4)=>{const q=qrcode(0,'L');q.addData('SI1|'+[r.name,r.type,r.sn,r.range].map(x=>String(x||'').replace(/\|/g,'/')).join('|'));q.make();return q.createSvgTag({cellSize:sz,margin:2,scalable:true})};
function modal(html){const m=document.createElement('div');m.className='modal';m.innerHTML='<div class="mb">'+html+'</div>';m.onclick=e=>{if(e.target===m)m.remove()};document.body.appendChild(m);return m}
/* ---------- вход: личный логин/пароль (кто правит) + фраза бригады (открывает токен GitHub) ---------- */
async function kdf(pw,salt,it){const k=await crypto.subtle.importKey('raw',TE.encode(pw),'PBKDF2',false,['deriveBits']);const b=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations:it||200000,hash:'SHA-256'},k,512));return{h:hex(b.slice(0,32)),k:b.slice(32)}}
const aes=k=>crypto.subtle.importKey('raw',k,'AES-GCM',false,['encrypt','decrypt']);
async function encTok(t,k){const iv=crypto.getRandomValues(new Uint8Array(12));return{iv:hex(iv),ct:b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await aes(k),TE.encode(t))))}}
async function decTok(o,k){return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(o.iv)},await aes(k),unb64(o.ct)))}
const salt16=()=>hex(crypto.getRandomValues(new Uint8Array(16)));
const AL='abcdefghjkmnpqrstuvwxyz23456789',newPhrase=()=>Array.from({length:5},()=>Array.from(crypto.getRandomValues(new Uint8Array(4)),b=>AL[b%31]).join('')).join('-');
const nph=p=>p.trim().toLowerCase().replace(/\s+/g,'');
async function mkVault(token,phrase){const salt=salt16(),d=await kdf(nph(phrase),salt,600000);return{salt,...await encTok(token,d.k)}}
async function openVault(v,phrase){return decTok(v,(await kdf(nph(phrase),v.salt,600000)).k)}
const phraseDlg=(ph,rot)=>modal(`<h3>Фраза бригады</h3><p style="font-size:21px;word-break:break-all"><b>${ph}</b></p><p>Запишите и передайте сотрудникам лично. Её вводят один раз на каждом телефоне, вместе с личным логином и паролем.${rot?'<br><br><b>Важно:</b> раньше токен лежал в репозитории в зашифрованном виде. Создайте на GitHub НОВЫЙ токен, затем «Люди» → «🔑 Фраза / токен» и введите его; старый токен удалите.':''}</p><div class="row"><button onclick="this.closest('.modal').remove()">Записал</button></div>`);
async function firstVault(){const ph=newPhrase();await txn(async rd=>{const u=(await rd('data/users.json'))||{users:[]};u.users.forEach(x=>delete x.tok);return{'data/vault.json':await mkVault(S.gh,ph),'data/users.json':u}},'vault');phraseDlg(ph,true)}
async function login(){
  let U,V;try{S.gh=localStorage.si_g||'';[U,V]=await Promise.all([rd('data/users.json'),rd('data/vault.json')]);U=U.json||{users:[]};V=V.json}catch(e){app.innerHTML='<main><p style="color:var(--red)">'+esc(e.message)+'<br>Репозиторий: '+esc(REPO)+'</p></main>';return}
  const setup=!U.users.length,needKey=!S.gh&&!setup;
  app.innerHTML=`<header><b>Учёт СИ</b></header><main><div class="mb" style="margin-top:30px"><h3>${setup?'Первый запуск: создайте администратора':'Вход'}</h3>
  ${setup?'<div class="row"><input id="nm" placeholder="Ваше имя (для истории)"></div>':''}<div class="row"><input id="lg" placeholder="Логин" autocapitalize="none"></div><div class="row"><input id="pw" type="password" placeholder="Пароль (от 4 символов)"></div>
  ${setup?'<div class="row"><input id="tk" type="password" placeholder="Токен GitHub (Contents: Read and write)"></div>':''}
  ${needKey?(V?'<div class="row"><input id="ph" placeholder="Фраза бригады (один раз на этом телефоне)" autocapitalize="none"></div>':'<div class="row"><input id="tk" type="password" placeholder="Фраза бригады ещё не создана. Админ: введите токен GitHub"></div>'):''}
  <div class="row"><button id="go">${setup?'Создать и войти':'Войти'}</button></div><p id="er" style="color:var(--red)"></p></div></main>`;
  $('#go').onclick=async()=>{try{const lg=$('#lg').value.trim(),pw=$('#pw').value;if(!lg||pw.length<4)throw new Error('Введите логин и пароль (от 4 символов)');let admin,nm,ph;
    if(setup){const gh=$('#tk').value.trim();S.gh=gh;const rr=await g('');if(!rr.permissions?.push)throw new Error('Токен не даёт права записи в '+REPO);
      nm=$('#nm').value.trim()||lg;ph=newPhrase();const salt=salt16(),d=await kdf(pw,salt);
      await txn(async()=>({'data/users.json':{users:[{login:lg,name:nm,admin:true,salt,hash:d.h}]},'data/vault.json':await mkVault(gh,ph)}),'setup');admin=true;localStorage.si_g=gh}
    else{const u=U.users.find(x=>x.login===lg);if(!u)throw new Error('Неверный логин или пароль');const d=await kdf(pw,u.salt);if(d.h!==u.hash)throw new Error('Неверный логин или пароль');admin=!!u.admin;nm=u.name||u.login;
      if(needKey){if(V){try{S.gh=await openVault(V,$('#ph').value)}catch{throw new Error('Неверная фраза бригады')}}else{if(!admin)throw new Error('Фраза бригады ещё не создана — сначала войдите администратором');S.gh=$('#tk').value.trim()}localStorage.si_g=S.gh}}
    S.me={login:lg,name:nm,admin};localStorage.si_s=JSON.stringify(S.me);await start();if(ph){await hist([{action:'setup',sheet:'',text:'Создан администратор'}]);phraseDlg(ph)}}catch(e){$('#er').textContent=e.message}};
}
async function start(){try{await loadAll();draw();if(S.me.admin&&!(await rd('data/vault.json')).json)await firstVault()}
  catch(e){let c;try{c=JSON.parse(localStorage.si_idx||'null')}catch{}
    if(c&&c.every(m=>localStorage['si_c_'+m.file])&&!S.sheets.length){S.index=c;S.sheets=Object.fromEntries(c.map(m=>[m.name,JSON.parse(localStorage['si_c_'+m.file]).rows]));draw();alert('Нет связи с GitHub — показаны данные, сохранённые на телефоне. Изменить таблицу сейчас нельзя.')}else alert(e.message)}}
document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='visible'&&S.me&&!S.open&&!document.querySelector('.modal')&&Date.now()-(S.lt||0)>20000){try{await loadAll();draw()}catch{}}});
/* ---------- основной экран ---------- */
const items=()=>Object.entries(S.sheets).flatMap(([sh,rows])=>(S.cur==='*'||S.cur===sh)?rows.map(r=>({sh,r})):[]);
function draw(){
  const all=items(),by={red:{},yel:{}},n={red:0,yel:0,grn:0,'':0};
  all.forEach(({r})=>{const s=status(r).c;n[s]++;if(by[s]){const g=r.name.trim();by[s][g]=(by[s][g]||0)+1}});
  const det=c=>Object.entries(by[c]).map(([k,v])=>`${esc(k)}: ${v}`).join('<br>')||'—';
  const tk=S.q.toLowerCase().split(/\s+/).filter(Boolean);
  const RK={red:0,yel:1,grn:2,'':3};
  const list=all.filter(({sh,r})=>(!S.flt||status(r).c===S.flt)&&tk.every(t=>(sh+' '+F.map(f=>r[f[0]]).join(' ')).toLowerCase().includes(t))).sort((a,b)=>{const x=status(a.r).c,y=status(b.r).c;return(RK[x]-RK[y])||((due(a.r)||0)-(due(b.r)||0))});
  app.innerHTML=`<header><b>Учёт СИ · ${esc(S.me.name||S.me.login)}</b><button class="g s" id="bh">История</button>${S.me.admin?'<button class="g s" id="bu">Люди</button>':''}<button class="g s" id="bx">Выйти</button></header>
  <main><div class="row"><select id="sh"><option value="*">Все листы</option>${Object.keys(S.sheets).map(k=>`<option ${k===S.cur?'selected':''}>${esc(k)}</option>`).join('')}</select></div>
  <div class="stats">${[['','',all.length,'Всего СИ'],['red','red',n.red,'Просрочено'],['yel','yel',n.yel,'Скоро (&lt;3 мес.)'],['grn','grn',n.grn,'Годно']].map(([f,c,v,l])=>`<div class="st ${c} ${f&&S.flt===f?'on':''}" data-t="${f}" style="cursor:pointer"><b>${v}</b><small>${l}</small></div>`).join('')}</div>
  <details style="margin:6px 0"><summary>По типам</summary><div class="row"><div class="st red"><small>Просрочено</small><br>${det('red')}</div><div class="st yel"><small>Скоро</small><br>${det('yel')}</div></div></details>
  <div class="row"><button id="bs">📷 Сканировать QR</button><button id="bb" class="g">📦 Установка пачкой</button></div>
  <div class="row"><input id="q" type="search" placeholder="Поиск: тип, номер, место…" value="${esc(S.q)}"></div>
  <div class="row"><button class="g s" id="be">⬇ Excel (актуальный)</button><button class="g s" id="bp">🖨 Печать QR</button><button class="g s" id="bn">🔔</button></div>
  <p class="sub">Показано: ${list.length}${S.flt?" · фильтр: "+{red:"просрочено",yel:"скоро истекает",grn:"годно"}[S.flt]+" (нажмите плитку ещё раз, чтобы снять)":""}</p><div id="ls">${list.slice(0,S.lim).map(({sh,r})=>card(sh,r)).join('')}${list.length>S.lim?`<button class="g" id="more">Показать ещё (${list.length-S.lim})</button>`:''}${list.length?'':'<p class="center">Ничего не найдено</p>'}</div></main>`;
  $('#sh').onchange=e=>{S.cur=e.target.value;draw()};
  $('#q').oninput=e=>{S.q=e.target.value;S.lim=60;clearTimeout(S.tm);S.tm=setTimeout(()=>{draw();const q=$('#q');q.focus();q.setSelectionRange(99,99)},250)};
  $('#bx').onclick=()=>{localStorage.removeItem('si_s');S.me=null;login()};$('#bh').onclick=history;if(S.me.admin)$('#bu').onclick=users;
  $('#bs').onclick=scanOne;$('#bb').onclick=batch;$('#bp').onclick=printQR;$('#be').onclick=exportXlsx;$('#bn').onclick=askNotify;
  const mo=$('#more');if(mo)mo.onclick=()=>{S.lim+=60;draw()};
  document.querySelectorAll('[data-t]').forEach(e=>e.onclick=()=>{S.flt=S.flt===e.dataset.t?'':e.dataset.t;S.lim=60;draw();$('#ls').scrollIntoView({behavior:'smooth'})});
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
  if(a==='save'){const row={};document.querySelectorAll('.card [data-f]').forEach(i=>row[i.dataset.f]=i.value.trim());await ops([mk(sh,id,row)])}
  if(a==='del'&&confirm(`Удалить из таблицы?\n${r.name} ${r.type} №${r.sn}`)){S.open=null;await ops([{op:'del',sheet:sh,id}])}
  if(a==='qr'){await QRL();const m=modal(`<div class="center" style="max-width:300px;margin:auto">${qrSvg(r,6)}<p>${esc(r.name)} ${esc(r.type)}<br>№${esc(r.sn)} · ${esc(r.range)}<br><b>${esc(r.place)}</b></p><button class="g" onclick="this.closest('.modal').remove()">Закрыть</button></div>`)}
  if(a==='swap'){alert('Отсканируйте QR второго СИ, с которым нужно поменяться местами');const q=await scanCode();if(!q)return;const f=find(q);if(!f||f.sh!==sh)return alert('Второй прибор не найден на этом листе');
    const P=['place','object','dept','inst'],a1={},b1={};P.forEach(k=>{a1[k]=f.r[k];b1[k]=r[k]});
    if(confirm(`Поменять местами:\n«${r.place}» ⇄ «${f.r.place}»?`))await ops([mk(sh,id,a1),mk(sh,f.r.id,b1)])}
  }catch(e){alert(e.message)}}
/* ---------- сканер ---------- */
function parseQR(t){t=String(t).trim();if(t.startsWith('SI1|')){const a=t.slice(4).split('|');return{name:a[0]||'',type:a[1]||'',sn:a[2]||'',range:a[3]||''}}
  try{const j=JSON.parse(t);if(j.s!==undefined)return{name:j.n||'',type:j.t||'',sn:String(j.s),range:j.r||''}}catch{}return null}
function find(q){for(const[sh,rows]of Object.entries(S.sheets)){const r=rows.find(r=>norm(r.sn)===norm(q.sn)&&norm(r.type)===norm(q.type));if(r)return{sh,r}}
  for(const[sh,rows]of Object.entries(S.sheets)){const r=rows.find(r=>norm(r.sn)===norm(q.sn)&&norm(r.name)===norm(q.name));if(r)return{sh,r}}return null}
async function scanCode(cont){ // cont(q) вызывается на каждый код; без cont — вернёт первый
  await lib('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js','jsQR');
  const m=modal('<video playsinline muted autoplay></video><p id="msg" class="center">Наведите камеру на QR с 15–25 см, без бликов</p><div class="row"><button class="g" id="ph">📸 Снять фото QR</button><button class="g" id="cx">Закрыть</button></div><input type="file" accept="image/*" capture="environment" id="fi" hidden>'),v=m.querySelector('video'),msg=t=>{m.querySelector('#msg').textContent=t};
  m.onclick=null;
  let stream;try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}})}catch(e){m.remove();alert('Нет доступа к камере: '+e.message+'\nРазрешите камеру для сайта в настройках браузера.');return null}
  try{const tr=stream.getVideoTracks()[0],c=tr.getCapabilities&&tr.getCapabilities();if(c&&c.focusMode&&c.focusMode.includes('continuous'))await tr.applyConstraints({advanced:[{focusMode:'continuous'}]})}catch{}
  v.srcObject=stream;try{await v.play()}catch{}
  const bd=window.BarcodeDetector?new BarcodeDetector({formats:['qr_code']}):null,cv=document.createElement('canvas'),cx=cv.getContext('2d',{willReadFrequently:true});
  const decode=async src=>{const w=src.videoWidth||src.naturalWidth,h=src.videoHeight||src.naturalHeight;if(!w)return'';
    if(bd){try{const c=await bd.detect(src);if(c[0]&&c[0].rawValue)return c[0].rawValue}catch{}}
    const k=Math.min(1,1600/Math.max(w,h));cv.width=Math.round(w*k);cv.height=Math.round(h*k);cx.drawImage(src,0,0,cv.width,cv.height);
    const im=cx.getImageData(0,0,cv.width,cv.height),c=jsQR(im.data,im.width,im.height,{inversionAttempts:'attemptBoth'});return c?c.data:''};
  return new Promise(res=>{let alive=true,last='',lt=0;
    const stop=val=>{alive=false;stream.getTracks().forEach(t=>t.stop());m.remove();res(val)};
    const handle=async txt=>{const q=parseQR(txt);if(!q){msg('QR прочитан, но это не код нашего формата: '+txt.slice(0,60));return}
      if(txt===last&&Date.now()-lt<3000)return;last=txt;lt=Date.now();if(cont){msg(await cont(q)||'');return}stop(q)};
    m.querySelector('#cx').onclick=()=>stop(null);
    m.querySelector('#ph').onclick=()=>m.querySelector('#fi').click();
    m.querySelector('#fi').onchange=e=>{const f=e.target.files[0];if(!f)return;const im=new Image();im.onload=async()=>{const t=await decode(im);if(t)await handle(t);else msg('На фото QR не найден. Снимите ближе и ровнее.')};im.src=URL.createObjectURL(f)};
    (async function tick(){if(!alive)return;try{const t=await decode(v);if(t)await handle(t)}catch{}if(alive)setTimeout(tick,120)})();});
}
async function scanOne(){const q=await scanCode();if(!q)return;const f=find(q);if(f){S.cur=f.sh;S.flt='';S.q=f.r.sn;S.open=f.sh+'|'+f.r.id;draw();scrollTo(0,0)}else addDlg(q)}
/* ---------- добавление нового СИ: на выбранное место листа ---------- */
function addDlg(q){
  let best=null,bs=-1;
  for(const[sh,rows]of Object.entries(S.sheets)){let s=0;rows.forEach(r=>{const p=(norm(r.name)===norm(q.name)?2:0)+(norm(r.type)===norm(q.type)?3:0)+(norm(r.range)===norm(q.range)?1:0);if(p>=2)s+=p});if(s>bs){bs=s;best=sh}}
  const m=modal(`<h3>СИ не найдено в таблице</h3><p>${esc(q.name)} ${esc(q.type)} №${esc(q.sn)} ${esc(q.range)}</p><label>Лист</label><select id="as" style="width:100%">${Object.keys(S.sheets).map(k=>`<option ${k===best?'selected':''}>${esc(k)}</option>`).join('')}</select>
  <label>Куда устанавливается (место на листе)</label><select id="ap" style="width:100%"></select>
  <label>Если на этом месте уже записан другой прибор</label><select id="ao" style="width:100%"><option value="keep">Оставить его, добавить новую строку рядом</option><option value="del">Удалить старый прибор из таблицы (его заменили)</option></select>
  <div class="fm" id="af"></div><div class="row"><button id="ay">Добавить</button><button class="g" id="an">Отмена</button></div>`);
  const rowsOf=()=>S.sheets[m.querySelector('#as').value];
  const fillForm=()=>{const nb=rowsOf()[+m.querySelector('#ap').value]||{};
    m.querySelector('#af').innerHTML=F.map(([k,l])=>{const v=q[k]??(['place','object','dept','inst','interval'].includes(k)?nb[k]||'':'');return`<div><label>${l}</label><input data-f="${k}" value="${esc(v)}"></div>`}).join('')};
  const fillPlaces=()=>{const rows=rowsOf();let a=-1;rows.forEach((r,i)=>{if(norm(r.name)===norm(q.name)&&norm(r.type)===norm(q.type))a=i});if(a<0)rows.forEach((r,i)=>{if(norm(r.name)===norm(q.name))a=i});
    m.querySelector('#ap').innerHTML='<option value="-1">— новое место (ввести вручную), в конец листа —</option>'+rows.map((r,i)=>`<option value="${i}" ${i===a?'selected':''}>${esc(r.place)} — ${esc(r.object)} · ${esc(r.type)} №${esc(r.sn)}</option>`).join('');fillForm()};
  m.querySelector('#as').onchange=fillPlaces;m.querySelector('#ap').onchange=fillForm;fillPlaces();m.querySelector('#an').onclick=()=>m.remove();
  m.querySelector('#ay').onclick=async()=>{const row={};m.querySelectorAll('[data-f]').forEach(i=>row[i.dataset.f]=i.value.trim());const sh=m.querySelector('#as').value,rows=S.sheets[sh],i=+m.querySelector('#ap').value,del=m.querySelector('#ao').value==='del'&&i>=0;m.remove();S.cur=sh;
    const nid='n'+Date.now().toString(36),list=[];
    if(i<0)list.push({op:'add',sheet:sh,row,nid});else if(del)list.push({op:'del',sheet:sh,id:rows[i].id},{op:'add',sheet:sh,row,nid,afterId:i>0?rows[i-1].id:'__first'});else list.push({op:'add',sheet:sh,row,nid,afterId:rows[i].id});
    try{await ops(list)}catch(e){alert(e.message)}}}
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
        const other=S.sheets[x.f.sh].find(z=>z.id!==r.id&&z.place===p&&z.object===ob&&!used.has(z.id));if(other)o.push(mk(x.f.sh,other.id,{place:r.place,object:r.object}))}}
      o.push(mk(x.f.sh,r.id,row))}
    mm.remove();try{await ops(o)}catch(e){alert(e.message)}}}
/* ---------- печать QR ---------- */
async function printQR(){await QRL();const all=items(),cells=all.map(({r})=>`<div class="c">${qrSvg(r,3)}<div class="t"><b>${esc(r.place)}</b><br>${esc(r.object)}</div></div>`).join('');
  const w=window.open('','_blank');w.document.write(`<!doctype html><meta charset=utf-8><title>QR СИ</title><style>@page{size:A4;margin:8mm}body{margin:0;font:9px Arial}.g{display:grid;grid-template-columns:repeat(5,1fr)}.c{border:.5px dashed #888;padding:2mm;text-align:center;break-inside:avoid;height:44mm;overflow:hidden}.c svg{width:30mm;height:30mm}.t{font-size:8px;line-height:1.1}.n{padding:4px;font-size:12px}@media print{.n{display:none}}</style><div class=n>${all.length} наклеек (${esc(S.cur==='*'?'все листы':S.cur)}). <button onclick=print()>Печать / Сохранить в PDF</button></div><div class=g>${cells}</div>`);w.document.close()}
/* ---------- Excel, история, пользователи, push ---------- */
async function exportXlsx(){const r=await fetch(gu('/contents/Perechen_SI.xlsx?ref=excel&t='+Date.now()),{headers:{...hd(),Accept:'application/vnd.github.raw'}});
  if(!r.ok)return alert('Excel ещё не сформирован. Он собирается через 1–2 минуты после последней правки. Первый раз: в репозитории Actions → export-xlsx → Run workflow.');
  const a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download='Перечень_СИ.xlsx';a.click()}
async function history(){let dir=[];try{dir=await g('/contents/data/history?t='+Date.now())}catch{}
  const files=dir.map(f=>f.name).sort().reverse(),A={upd:'изменил',add:'добавил',del:'удалил',user:'пользователи',setup:'настройка'};let n=0;
  const m=modal(`<h3>История</h3><div id="hl"></div><div class="row"><button class="g" id="hm">Показать более ранние</button><button class="g" onclick="this.closest('.modal').remove()">Закрыть</button></div>`);
  const more=async()=>{const f=files[n++];if(!f){m.querySelector('#hl').innerHTML||(m.querySelector('#hl').textContent='Пока пусто');m.querySelector('#hm').style.display='none';return}
    const h=(await rd('data/history/'+f)).json||[];m.querySelector('#hl').insertAdjacentHTML('beforeend','<small>'+esc(f.slice(0,7))+'</small>'+h.map(x=>`<div class="hist"><small>${new Date(x.t).toLocaleString('ru')} · <b>${esc(x.user)}</b> ${A[x.action]||x.action}${x.sheet?' · '+esc(x.sheet):''}</small><br>${esc(x.text)}</div>`).join(''));if(n>=files.length)m.querySelector('#hm').style.display='none'};
  m.querySelector('#hm').onclick=more;await more()}
async function users(){const U=(await rd('data/users.json')).json;const m=modal(`<h3>Пользователи</h3>${U.users.map(x=>`<div class="hist"><b>${esc(x.name||x.login)}</b> <small>логин: ${esc(x.login)}${x.admin?' · админ':''}</small> <button class="g s" data-r="${esc(x.login)}">имя</button> ${x.admin?'':`<button class="r s" data-d="${esc(x.login)}">удалить</button>`}</div>`).join('')}
  <div class="row"><input id="nn" placeholder="Имя (например: Иванов И.)"></div><div class="row"><input id="nl" placeholder="Логин" autocapitalize="none"><input id="np" placeholder="Пароль"></div><div class="row"><button id="na">Создать</button><button class="g" id="nk">🔑 Фраза / токен</button><button class="g" id="nc">Закрыть</button></div>`);
  m.querySelector('#nc').onclick=()=>m.remove();
  m.querySelector('#nk').onclick=async()=>{const t=prompt('Новый токен GitHub (оставьте пустым, чтобы сменить только фразу):');if(t===null)return;const old=S.gh,tok=t.trim()||S.gh,ph=newPhrase();
    try{S.gh=tok;const v=await mkVault(tok,ph);await upd('data/vault.json',()=>v,'vault');if(t.trim())localStorage.si_g=tok;await hist([{action:'user',sheet:'',text:t.trim()?'Заменены токен и фраза бригады':'Заменена фраза бригады'}]);m.remove();phraseDlg(ph)}catch(e){S.gh=old;alert(e.message)}};
  m.querySelector('#na').onclick=async()=>{try{const nl=$('#nl').value.trim(),np=$('#np').value,nn=$('#nn').value.trim()||nl;if(!nl||np.length<4)throw new Error('Логин и пароль (от 4 символов)');const salt=salt16(),d=await kdf(np,salt);
    await upd('data/users.json',u=>{if(u.users.some(x=>x.login===nl))throw new Error('Логин занят');u.users.push({login:nl,name:nn,salt,hash:d.h});return u},'user '+nl);await hist([{action:'user',sheet:'',text:'Создан пользователь '+nn+' ('+nl+')'}]);m.remove();users()}catch(e){alert(e.message)}};
  m.querySelectorAll('[data-r]').forEach(b=>b.onclick=async()=>{const lg=b.dataset.r,cur=U.users.find(x=>x.login===lg),n=(prompt('Имя для «'+lg+'»',cur.name||lg)||'').trim();if(!n)return;
    try{await upd('data/users.json',u=>{u.users.find(x=>x.login===lg).name=n;return u},'user name');await hist([{action:'user',sheet:'',text:'Имя пользователя '+lg+' → '+n}]);
      if(lg===S.me.login){S.me.name=n;localStorage.si_s=JSON.stringify(S.me);draw()}m.remove();users()}catch(e){alert(e.message)}});
  m.querySelectorAll('[data-d]').forEach(b=>b.onclick=async()=>{if(confirm('Удалить '+b.dataset.d+'?')){await upd('data/users.json',u=>({users:u.users.filter(x=>x.login!==b.dataset.d)}),'user del');await hist([{action:'user',sheet:'',text:'Удалён пользователь '+b.dataset.d}]);m.remove();users()}})}
const u8=s=>{const p='='.repeat((4-s.length%4)%4);return unb64((s+p).replace(/-/g,'+').replace(/_/g,'/'))};
async function askNotify(){try{if(!('Notification' in window)||!('PushManager' in window)||!('serviceWorker' in navigator))return alert('Этот браузер не поддерживает push. На iPhone: откройте сайт в Safari → «Поделиться» → «На экран Домой», запустите приложение с иконки и нажмите 🔔 снова (нужен iOS 16.4 и новее). На Android используйте Chrome.');if(await Notification.requestPermission()!=='granted')return alert('Уведомления запрещены в настройках браузера');
  const cfg=(await rd('data/config.json')).json,reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:u8(cfg.vapid)});
  await upd('data/subs.json',s=>{s=s||{subs:[]};s.subs=s.subs.filter(x=>x.endpoint!==sub.endpoint);s.subs.push({...sub.toJSON(),login:S.me.login});return s},'push sub');alert('Push-уведомления включены для этого устройства')}catch(e){alert(e.message)}}
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js');
try{const ss=JSON.parse(localStorage.si_s||'null');if(ss){if(ss.gh){localStorage.si_g=ss.gh;delete ss.gh;localStorage.si_s=JSON.stringify(ss)}if(localStorage.si_g){S.gh=localStorage.si_g;S.me={login:ss.login,name:ss.name||ss.login,admin:ss.admin}}}}catch{}
S.me?start():login();
