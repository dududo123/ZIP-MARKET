(() => {
'use strict';
const VERSION='5.0.0';
const $=(s,root=document)=>root.querySelector(s);
const $$=(s,root=document)=>[...root.querySelectorAll(s)];
const els={
 login:$('#loginView'),user:$('#userView'),admin:$('#adminView'),session:$('#sessionActions'),sessionName:$('#sessionName'),
 userName:$('#userName'),userEmployee:$('#userEmployee'),balance:$('#creditBalance'),payPanel:$('#payPanel'),gamesPanel:$('#gamesPanel'),
 txList:$('#transactionList'),txCount:$('#transactionCount'),txToggle:$('#toggleTransactionsBtn'),gameGrid:$('#gameGrid'),gameProgress:$('#gameProgress'),
 modalRoot:$('#modalRoot'),modalContent:$('#modalContent'),toast:$('#toast'),participantList:$('#participantList'),participantCount:$('#participantCount'),
 adminGameList:$('#adminGameList'),adminGameCount:$('#adminGameCount'),search:$('#participantSearch')
};
const state={role:null,token:null,user:null,transactions:[],games:[],completedGameIds:new Set(),adminData:{participants:[],games:[]},modalCleanup:null,currentRoute:'login'};
let toastTimer;

function escapeHtml(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function formatDate(v){try{return new Intl.DateTimeFormat('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v));}catch{return '';}}
function showToast(message,kind=''){clearTimeout(toastTimer);els.toast.textContent=message;els.toast.classList.remove('hidden');els.toast.style.background=kind==='error'?'#7e2020':'';toastTimer=setTimeout(()=>els.toast.classList.add('hidden'),3400);}
function setBusy(button,busy,label){if(!button)return;button.disabled=busy;button.classList.toggle('loading',busy);if(label){if(busy){button.dataset.oldText=button.textContent;button.textContent=label;}else if(button.dataset.oldText){button.textContent=button.dataset.oldText;delete button.dataset.oldText;}}}
async function api(path,{method='GET',body,token=state.token}={}){
 const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),18000);
 try{
  const res=await fetch(`/api${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:ctrl.signal});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||`요청 실패 (${res.status})`);
  return data;
 }catch(e){if(e.name==='AbortError')throw new Error('응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.');throw e;}finally{clearTimeout(timer);}
}
function saveSession(){if(!state.token)return;sessionStorage.setItem('zipSession',JSON.stringify({version:VERSION,role:state.role,token:state.token,user:state.user,transactions:state.transactions,games:state.games,completed:[...state.completedGameIds]}));}
function restoreSession(){try{const s=JSON.parse(sessionStorage.getItem('zipSession'));if(s?.version!==VERSION||!s.token)return false;Object.assign(state,{role:s.role,token:s.token,user:s.user,transactions:s.transactions||[],games:s.games||[],completedGameIds:new Set(s.completed||[])});return true;}catch{return false;}}
function clearSession(){state.role=null;state.token=null;state.user=null;state.transactions=[];state.games=[];state.completedGameIds=new Set();sessionStorage.removeItem('zipSession');}

function historyState(route,extra={}){return {zipMarket:true,route,...extra};}
function routeUrl(route,modal){return `#/${route.replace('user-','user/')}${modal?`/${modal}`:''}`;}
function navigate(route,extra={},replace=false){const value=historyState(route,extra);history[replace?'replaceState':'pushState'](value,'',routeUrl(route,extra.modal));applyRoute(value);}
function applyRoute(hs={route:'login'}){
 state.currentRoute=hs.route||'login';
 const route=state.currentRoute;
 const admin=route==='admin'&&state.role==='admin';
 const user=route.startsWith('user-')&&state.role==='user';
 els.login.classList.toggle('hidden',admin||user);els.user.classList.toggle('hidden',!user);els.admin.classList.toggle('hidden',!admin);els.session.classList.toggle('hidden',!(admin||user));
 els.sessionName.textContent=admin?'관리자':(state.user?.name||'');
 if(user){const games=route==='user-games';els.payPanel.classList.toggle('hidden',games);els.gamesPanel.classList.toggle('hidden',!games);$$('.user-tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.route===route)));renderUser(Boolean(hs.transactionsExpanded));}
 if(admin)renderAdmin();
 if(hs.modal)openModalForState(hs);else hideModal();
 window.scrollTo({top:0,behavior:'instant'});$('#app')?.focus({preventScroll:true});
}
function installHistory(){
 const restored=restoreSession();
 const initial=restored?(state.role==='admin'?'admin':'user-pay'):'login';
 history.replaceState(historyState('login',{sentinel:true}),'',routeUrl('login'));
 history.pushState(historyState(initial),'',routeUrl(initial));
 applyRoute(history.state);
 window.addEventListener('popstate',e=>{
   const hs=e.state;
   if(!hs?.zipMarket||hs.sentinel){const keep=state.role==='admin'?'admin':state.role==='user'?'user-pay':'login';history.pushState(historyState(keep),'',routeUrl(keep));applyRoute(history.state);return;}
   applyRoute(hs);
 });
}

function renderUser(expanded=false){
 if(!state.user)return;
 els.userName.textContent=state.user.name||'';els.userEmployee.textContent=`사번 ${state.user.employeeNo||''}`;els.balance.textContent=`${Number(state.user.creditBalance||0).toLocaleString()} C`;
 els.txCount.textContent=`${state.transactions.length}건`;
 const visible=expanded?state.transactions:state.transactions.slice(0,5);
 els.txList.innerHTML=visible.length?visible.map(t=>{const amount=Number(t.amount||0);return `<article class="transaction-row"><div><p>${escapeHtml(t.description||transactionLabel(t.type))}</p><small>${escapeHtml(formatDate(t.createdAt))}</small></div><strong class="transaction-amount ${amount<0?'negative':'positive'}">${amount>0?'+':''}${amount.toLocaleString()} C</strong></article>`;}).join(''):'<div class="empty-state">아직 사용 내역이 없습니다.</div>';
 els.txToggle.classList.toggle('hidden',state.transactions.length<=5);els.txToggle.setAttribute('aria-expanded',String(expanded));els.txToggle.querySelector('span').textContent=expanded?'내역 접기':'나머지 내역도 보기';
 const completed=state.completedGameIds;els.gameProgress.textContent=`${completed.size}/${state.games.length} 완료`;
 els.gameGrid.innerHTML=state.games.length?state.games.map(g=>{const done=completed.has(String(g.id));const img=safeImage(g.imageUrl,g.name);return `<button class="game-card" type="button" data-game-id="${escapeHtml(g.id)}" aria-label="${escapeHtml(g.name)} ${done?'완료':'QR 스캔'}"><span class="game-image-wrap"><img src="${escapeHtml(img)}" alt="${escapeHtml(g.name)}" width="1200" height="750" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/assets/game-default.webp'"></span><span class="game-copy"><h3>${escapeHtml(g.name)}</h3><span class="game-status ${done?'done':''}">${done?'완료':'QR 스캔'}</span></span></button>`;}).join(''):'<div class="empty-state">등록된 게임이 없습니다.</div>';
}
function transactionLabel(type){return type==='grant'?'크레딧 지급':type==='payment'?'크레딧 결제':'크레딧 변경';}
function safeImage(url,name=''){if(String(name).includes('탁구'))return '/assets/game-pingpong.webp';if(url&&String(url).startsWith('/'))return url;if(url&&/^https:\/\//i.test(url))return url;return '/assets/game-default.webp';}
function hydrateUser(data){state.user=data.user;state.transactions=data.transactions||[];state.games=data.games||[];state.completedGameIds=new Set((data.completedGameIds||[]).map(String));saveSession();renderUser(Boolean(history.state?.transactionsExpanded));}

function renderAdmin(){
 const term=(els.search?.value||'').trim().toLowerCase();const list=state.adminData.participants.filter(p=>!term||String(p.employeeNo).toLowerCase().includes(term)||String(p.name).toLowerCase().includes(term));
 els.participantCount.textContent=`${state.adminData.participants.length}명`;
 els.participantList.innerHTML=list.length?list.map(p=>`<article class="admin-list-row"><div><strong>${escapeHtml(p.name)} · ${escapeHtml(p.employeeNo)}</strong><small>${Number(p.creditBalance||0).toLocaleString()} C</small></div><div class="row-actions"><button class="secondary-button" data-action="grant" data-id="${escapeHtml(p.id)}">+100 C</button><button class="danger-button" data-action="delete-participant" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}">삭제</button></div></article>`).join(''):'<div class="empty-state">조건에 맞는 참가자가 없습니다.</div>';
 els.adminGameCount.textContent=`${state.adminData.games.length}개`;
 els.adminGameList.innerHTML=state.adminData.games.length?state.adminData.games.map(g=>`<article class="admin-list-row"><div><strong>${escapeHtml(g.name)}</strong><small>${escapeHtml(g.imageUrl||'/assets/game-default.webp')}</small></div><div class="row-actions"><button class="secondary-button" data-action="game-qr" data-id="${escapeHtml(g.id)}" data-name="${escapeHtml(g.name)}">완료 QR</button><button class="danger-button" data-action="delete-game" data-id="${escapeHtml(g.id)}" data-name="${escapeHtml(g.name)}">게임 삭제</button></div></article>`).join(''):'<div class="empty-state">등록된 게임이 없습니다.</div>';
}
async function loadAdmin(){const data=await api('/admin/bootstrap');state.adminData=data;renderAdmin();}

function showModal(html){els.modalContent.innerHTML=html;els.modalRoot.classList.remove('hidden');els.modalRoot.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';requestAnimationFrame(()=>els.modalRoot.querySelector('input,button:not(.modal-close)')?.focus());}
async function hideModal(runCleanup=true){if(runCleanup&&state.modalCleanup){try{await state.modalCleanup();}catch{}state.modalCleanup=null;}els.modalRoot.classList.add('hidden');els.modalRoot.setAttribute('aria-hidden','true');els.modalContent.innerHTML='';document.body.style.overflow='';}
function closeModal(){if(history.state?.modal)history.back();else hideModal();}
function openModalForState(hs){
 if(hs.modal==='admin-login')return showAdminLogin();
 if(hs.modal==='payment-scan')return showScanner('크레딧 결제','관리자가 보여주는 결제 QR을 스캔하세요.');
 if(hs.modal==='game-scan')return showScanner('게임 완료','게임 완료 QR을 스캔하세요.');
 if(hs.modal==='qr-display')return showQrDisplay(hs);
}
function showAdminLogin(){showModal(`<h2 id="modalTitle">관리자 로그인</h2><p class="help">ZIP! MARKET 운영자 비밀번호를 입력하세요.</p><form id="adminLoginForm" class="stack-form"><label for="adminPassword"><strong>관리자 비밀번호</strong></label><input id="adminPassword" name="password" type="password" autocomplete="current-password" placeholder="관리자 비밀번호" required><button class="primary-button" type="submit">관리자 페이지 열기</button></form>`);$('#adminLoginForm').addEventListener('submit',adminLogin);}
function showScanner(title,help){showModal(`<h2 id="modalTitle">${escapeHtml(title)}</h2><p class="help">${escapeHtml(help)} iPhone에서는 카메라 허용을 선택하세요.</p><div class="qr-actions"><button id="cameraBtn" class="primary-button" type="button">카메라 시작</button><button id="imageBtn" class="secondary-button" type="button">사진에서 QR 읽기</button></div><input id="qrFile" type="file" accept="image/*" class="hidden"><div id="qr-reader" class="scanner-box"><p style="color:white;text-align:center;padding:90px 15px">카메라 시작 또는 사진 읽기를 선택하세요.</p></div>`);
 let toolsPromise;const tools=()=>toolsPromise||(toolsPromise=import('/qr-tools.min.js?v=5.0.0'));state.modalCleanup=async()=>{if(toolsPromise)(await toolsPromise).stopScanner();};
 $('#cameraBtn').addEventListener('click',async e=>{setBusy(e.currentTarget,true,'카메라 여는 중');try{await (await tools()).startCamera('qr-reader',handleQrDecoded);e.currentTarget.classList.add('hidden');}catch(err){showToast(cameraMessage(err),'error');setBusy(e.currentTarget,false);}});
 $('#imageBtn').addEventListener('click',()=>$('#qrFile').click());$('#qrFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{const text=await (await tools()).scanImageFile('qr-reader',file);handleQrDecoded(text);}catch{showToast('사진에서 QR 코드를 찾지 못했습니다.','error');}});
}
function cameraMessage(e){const s=String(e?.message||e);if(/permission|notallowed/i.test(s))return '카메라 권한이 필요합니다. 브라우저 설정에서 카메라를 허용해 주세요.';return '카메라를 열지 못했습니다. 사진에서 QR 읽기를 이용해 주세요.';}
async function handleQrDecoded(text){try{showToast('QR을 확인하고 있습니다.');const data=await api('/user/redeem',{method:'POST',body:{token:text}});hydrateUser(data);closeModal();showToast(data.message||'처리가 완료되었습니다.');}catch(e){showToast(e.message,'error');}}
async function showQrDisplay(hs){showModal(`<h2 id="modalTitle">${escapeHtml(hs.title||'QR 코드')}</h2><p class="help">참가자가 ZIP! MARKET에서 이 QR을 스캔하도록 보여주세요.</p><div id="qrLoading" class="empty-state loading">QR 생성 중</div>`);try{const {makeQrDataUrl}=await import('/qr-tools.min.js?v=5.0.0');const src=await makeQrDataUrl(hs.qrToken);$('#qrLoading').outerHTML=`<img class="qr-image" src="${src}" alt="${escapeHtml(hs.title||'QR 코드')}"><p class="help" style="text-align:center">QR은 12시간 동안 사용할 수 있습니다.</p>`;}catch(e){$('#qrLoading').textContent='QR 이미지를 만들지 못했습니다.';}}

async function userLogin(e){e.preventDefault();const btn=e.submitter;setBusy(btn,true,'로그인 중');const form=new FormData(e.currentTarget);try{const data=await api('/user/login',{method:'POST',token:null,body:{employeeNo:form.get('employeeNo'),password:form.get('password')}});state.role='user';state.token=data.token;hydrateUser(data);navigate('user-pay');e.currentTarget.reset();showToast(`${state.user.name}님, 환영합니다.`);}catch(err){showToast(err.message,'error');}finally{setBusy(btn,false);}}
async function adminLogin(e){e.preventDefault();const btn=e.submitter;setBusy(btn,true,'확인 중');const form=new FormData(e.currentTarget);try{const data=await api('/admin/login',{method:'POST',token:null,body:{password:form.get('password')}});state.role='admin';state.token=data.token;state.adminData={participants:data.participants||[],games:data.games||[]};saveSession();hideModal();navigate('admin');showToast('관리자 페이지에 로그인했습니다.');}catch(err){showToast(`관리자 로그인 실패: ${err.message}`,'error');}finally{setBusy(btn,false);}}
function logout(){clearSession();hideModal();navigate('login');showToast('로그아웃했습니다.');}

async function participantSubmit(e){e.preventDefault();const btn=e.submitter;setBusy(btn,true,'추가 중');const f=new FormData(e.currentTarget);try{await api('/admin/participants',{method:'POST',body:Object.fromEntries(f)});e.currentTarget.reset();await loadAdmin();showToast('참가자를 추가했습니다.');}catch(err){showToast(err.message,'error');}finally{setBusy(btn,false);}}
async function bulkAdd(){const btn=$('#bulkAddBtn'),lines=$('#bulkParticipants').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);const participants=lines.map(line=>{const [employeeNo,name,password]=line.split(/\t|,/).map(s=>s.trim());return {employeeNo,name,password};}).filter(x=>x.employeeNo&&x.name&&x.password);if(!participants.length)return showToast('등록할 참가자 정보를 붙여넣어 주세요.','error');setBusy(btn,true,'등록 중');try{const data=await api('/admin/participants/bulk',{method:'POST',body:{participants}});$('#bulkParticipants').value='';await loadAdmin();showToast(`${data.created}명을 등록했습니다.`);}catch(e){showToast(e.message,'error');}finally{setBusy(btn,false);}}
async function paymentQrSubmit(e){e.preventDefault();const btn=e.submitter;setBusy(btn,true,'생성 중');const f=new FormData(e.currentTarget);try{const data=await api('/admin/payment-qr',{method:'POST',body:{amount:Number(f.get('amount')),description:f.get('description')}});navigate('admin',{modal:'qr-display',title:`${Number(f.get('amount')).toLocaleString()} C 결제`,qrToken:data.qrToken});}catch(err){showToast(err.message,'error');}finally{setBusy(btn,false);}}
async function gameSubmit(e){e.preventDefault();const btn=e.submitter;setBusy(btn,true,'추가 중');const f=new FormData(e.currentTarget);try{await api('/admin/games',{method:'POST',body:Object.fromEntries(f)});e.currentTarget.reset();await loadAdmin();showToast('게임을 추가했습니다.');}catch(err){showToast(err.message,'error');}finally{setBusy(btn,false);}}
async function passwordSubmit(e){e.preventDefault();const btn=e.submitter;setBusy(btn,true,'변경 중');try{await api('/admin/password',{method:'PUT',body:{password:new FormData(e.currentTarget).get('password')}});e.currentTarget.reset();showToast('관리자 비밀번호를 변경했습니다.');}catch(err){showToast(err.message,'error');}finally{setBusy(btn,false);}}
async function adminListAction(e){const b=e.target.closest('button[data-action]');if(!b)return;const {action,id,name}=b.dataset;try{
 if(action==='grant'){setBusy(b,true,'지급 중');await api(`/admin/participants/${encodeURIComponent(id)}/credit`,{method:'POST',body:{amount:100}});await loadAdmin();showToast('100 C를 지급했습니다.');}
 if(action==='delete-participant'){if(!confirm(`${name} 참가자와 연결된 사용내역을 모두 삭제할까요?`))return;setBusy(b,true,'삭제 중');await api(`/admin/participants/${encodeURIComponent(id)}`,{method:'DELETE'});await loadAdmin();showToast('참가자를 삭제했습니다.');}
 if(action==='game-qr'){setBusy(b,true,'생성 중');const data=await api(`/admin/games/${encodeURIComponent(id)}/qr`,{method:'POST'});navigate('admin',{modal:'qr-display',title:`${name} 완료 QR`,qrToken:data.qrToken});}
 if(action==='delete-game'){if(!confirm(`${name} 게임과 모든 완료 기록을 삭제할까요?`))return;setBusy(b,true,'삭제 중');await api(`/admin/games/${encodeURIComponent(id)}`,{method:'DELETE'});await loadAdmin();showToast('게임을 삭제했습니다.');}
 }catch(err){showToast(err.message,'error');}finally{setBusy(b,false);}}

function wire(){
 $('#userLoginForm').addEventListener('submit',userLogin);$('#openAdminLoginBtn').addEventListener('click',()=>navigate('login',{modal:'admin-login'}));$('#logoutBtn').addEventListener('click',logout);$('#brandBtn').addEventListener('click',()=>navigate(state.role==='admin'?'admin':state.role==='user'?'user-pay':'login'));
 $$('.user-tabs button').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.route!==state.currentRoute)navigate(b.dataset.route);}));$('#openPaymentBtn').addEventListener('click',()=>navigate('user-pay',{modal:'payment-scan'}));
 els.txToggle.addEventListener('click',()=>navigate('user-pay',{transactionsExpanded:els.txToggle.getAttribute('aria-expanded')!=='true'}));els.gameGrid.addEventListener('click',e=>{const card=e.target.closest('[data-game-id]');if(card)navigate('user-games',{modal:'game-scan',gameId:card.dataset.gameId});});
 $('#modalCloseBtn').addEventListener('click',closeModal);els.modalRoot.addEventListener('click',e=>{if(e.target.matches('[data-modal-close]'))closeModal();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!els.modalRoot.classList.contains('hidden'))closeModal();});
 $('#participantForm').addEventListener('submit',participantSubmit);$('#bulkAddBtn').addEventListener('click',bulkAdd);$('#paymentQrForm').addEventListener('submit',paymentQrSubmit);$('#gameForm').addEventListener('submit',gameSubmit);$('#adminPasswordForm').addEventListener('submit',passwordSubmit);$('#participantList').addEventListener('click',adminListAction);$('#adminGameList').addEventListener('click',adminListAction);els.search.addEventListener('input',renderAdmin);$('#resetSearchBtn').addEventListener('click',()=>{els.search.value='';renderAdmin();els.search.focus();});$('#refreshAdminBtn').addEventListener('click',async e=>{setBusy(e.currentTarget,true,'불러오는 중');try{await loadAdmin();showToast('최신 정보로 갱신했습니다.');}catch(err){showToast(err.message,'error');}finally{setBusy(e.currentTarget,false);}});
}
wire();installHistory();
if(state.role==='admin')loadAdmin().catch(e=>showToast(e.message,'error'));
console.info(`ZIP! MARKET ${VERSION}`);
})();
