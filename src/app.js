const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const state = {
  view: 'login', userTab: 'pay', adminTab: 'participants', modal: null,
  userToken: sessionStorage.getItem('zipUserToken') || '',
  adminToken: sessionStorage.getItem('zipAdminToken') || '',
  dashboard: null, participants: [], adminGames: [], historyExpanded: false,
  pendingAction: null, scanner: null, scanning: false
};
const views = { login: $('#loginView'), user: $('#userView'), admin: $('#adminView') };
const payProducts = [
  { amount: 100, name: 'ZIP 100 C', image: '/assets/pay-100.webp' },
  { amount: 200, name: 'ZIP 200 C', image: '/assets/pay-200.webp' },
  { amount: 300, name: 'ZIP 300 C', image: '/assets/pay-300.webp' }
];

function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function formatDate(value) { try { return new Intl.DateTimeFormat('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)); } catch { return ''; } }
function makeId(){ return globalThis.crypto?.randomUUID?.() || `zm-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function toast(message, type = '') {
  const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = message; $('#toastRegion').append(el);
  setTimeout(() => el.remove(), 3600);
}
function setBusy(button, busy, text = '처리 중') {
  if (!button) return; if (busy) { button.dataset.oldText = button.textContent; button.textContent = text; button.classList.add('loading'); button.disabled = true; }
  else { button.textContent = button.dataset.oldText || button.textContent; button.classList.remove('loading'); button.disabled = false; }
}
async function api(path, { method = 'GET', body, token } = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api${path}`, {
      method, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `요청 실패 (${response.status})`);
    $('#connectionBadge').textContent = 'ONLINE'; return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('서버 응답이 늦습니다. 잠시 후 다시 시도해 주세요.');
    if (!navigator.onLine) $('#connectionBadge').textContent = 'OFFLINE'; throw error;
  } finally { clearTimeout(timer); }
}
function authToken(role) { return role === 'admin' ? state.adminToken : state.userToken; }

function bootstrapHistory() {
  history.replaceState({ zipMarket: true, view: 'login', guard: true }, '', location.pathname);
  history.pushState({ zipMarket: true, view: 'login' }, '', location.pathname);
}
function navigate(view, { replace = false, tab, noFocus = false } = {}) {
  state.view = view; if (view === 'user' && tab) state.userTab = tab; if (view === 'admin' && tab) state.adminTab = tab;
  const payload = { zipMarket: true, view, userTab: state.userTab, adminTab: state.adminTab };
  history[replace ? 'replaceState' : 'pushState'](payload, '', location.pathname); render(); if (!noFocus) $('#app').focus({preventScroll:true});
}
window.addEventListener('popstate', event => {
  if (state.modal) { closeModal(false); return; }
  if (!event.state?.zipMarket) { history.pushState({zipMarket:true,view:state.view},'',location.pathname); toast('ZIP! MARKET 첫 화면입니다.'); return; }
  state.view = event.state.view || 'login'; state.userTab = event.state.userTab || state.userTab; state.adminTab = event.state.adminTab || state.adminTab; render();
});
function render() {
  Object.entries(views).forEach(([name, el]) => el.hidden = name !== state.view);
  if (state.view === 'user') renderUser(); if (state.view === 'admin') renderAdmin();
}

function openModal(name, { push = true } = {}) {
  state.modal = name; $('#modalRoot').hidden = false; $$('.modal').forEach(m => m.hidden = m.id !== name);
  document.body.style.overflow = 'hidden'; if (push) history.pushState({zipMarket:true,view:state.view,modal:name},'',location.pathname);
  setTimeout(() => $(`#${name} input:not([type=file]), #${name} button`)?.focus(), 30);
}
async function closeModal(useHistory = true) {
  if (!state.modal) return; const wasScanner = state.modal === 'scannerModal'; state.modal = null; $('#modalRoot').hidden = true; $$('.modal').forEach(m => m.hidden = true); document.body.style.overflow = '';
  if (wasScanner) await stopScanner(); if (useHistory && history.state?.modal) history.back();
}
$$('[data-close-modal]').forEach(el => el.addEventListener('click', () => closeModal()));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.modal) closeModal(); });

$('#userLoginForm').addEventListener('submit', async e => {
  e.preventDefault(); const button = $('button[type=submit]', e.currentTarget); const body = Object.fromEntries(new FormData(e.currentTarget)); setBusy(button,true,'ZIP 여는 중');
  try { const result = await api('/user/login',{method:'POST',body}); state.userToken = result.token; sessionStorage.setItem('zipUserToken',result.token); state.dashboard = result.dashboard; e.currentTarget.reset(); navigate('user',{tab:'pay'}); toast('ZIP! MARKET에 입장했습니다.','success'); }
  catch (error) { toast(`로그인 실패: ${error.message}`,'error'); }
  finally { setBusy(button,false); }
});
$('#openAdminLogin').addEventListener('click', () => openModal('adminLoginModal'));
$('#adminLoginForm').addEventListener('submit', async e => {
  e.preventDefault(); const button = $('button[type=submit]',e.currentTarget); const password = new FormData(e.currentTarget).get('password'); setBusy(button,true,'확인 중');
  try { const result = await api('/admin/login',{method:'POST',body:{password}}); state.adminToken = result.token; sessionStorage.setItem('zipAdminToken',result.token); await closeModal(false); e.currentTarget.reset(); navigate('admin',{tab:'participants'}); await loadAdminData(); toast('관리자 페이지를 열었습니다.','success'); }
  catch(error){ toast(`관리자 로그인 실패: ${error.message}`,'error'); }
  finally{ setBusy(button,false); }
});
$('#userLogout').addEventListener('click',() => { sessionStorage.removeItem('zipUserToken'); state.userToken=''; state.dashboard=null; navigate('login'); });
$('#adminLogout').addEventListener('click',() => { sessionStorage.removeItem('zipAdminToken'); state.adminToken=''; state.participants=[]; state.adminGames=[]; navigate('login'); });
$$('[data-go="login"]').forEach(b=>b.addEventListener('click',()=>navigate('login')));

function renderUser() {
  if (!state.dashboard) return; const d = state.dashboard; $('#userName').textContent = d.user.name; $('#creditBalance').textContent = `${Number(d.user.credits||0).toLocaleString()} C`;
  $$('.tab[data-user-tab]').forEach(b => b.classList.toggle('active',b.dataset.userTab===state.userTab));
  ['pay','games','history'].forEach(tab => $(`#${tab}Panel`).hidden = tab !== state.userTab);
  renderPay(); renderGames(); renderTransactions();
}
$$('[data-user-tab]').forEach(button => button.addEventListener('click',() => navigate('user',{tab:button.dataset.userTab})));
function renderPay(){
  $('#payGrid').innerHTML = payProducts.map(p => `<article class="shop-card"><div class="image-box"><img src="${p.image}" alt="${p.amount} 크레딧 결제 이미지" width="900" height="600"></div><div class="shop-card-body"><h3>${p.name}</h3><p>ZIP! MARKET에서 ${p.amount} 크레딧을 사용합니다.</p><div class="price">${p.amount} C</div><button class="primary" data-pay="${p.amount}" type="button">결제하기</button></div></article>`).join('');
  $$('[data-pay]').forEach(b => b.addEventListener('click',()=>showPayConfirm(Number(b.dataset.pay))));
}
function showPayConfirm(amount){
  const product=payProducts.find(p=>p.amount===amount); state.pendingAction=async()=>performPayment(amount,`${amount}C 상품 결제`);
  $('#confirmTitle').textContent='크레딧 결제 확인'; $('#confirmBody').innerHTML=`<div class="confirm-product"><img src="${product.image}" alt=""><div><p>${escapeHtml(product.name)}</p><strong>${amount.toLocaleString()} C</strong><p>결제를 진행할까요?</p></div></div>`; $('#confirmAction').textContent='결제 확인'; openModal('confirmModal');
}
$('#confirmAction').addEventListener('click', async e => { if(!state.pendingAction)return; setBusy(e.currentTarget,true,'처리 중'); try{await state.pendingAction(); await closeModal();}catch(error){toast(error.message,'error');}finally{setBusy(e.currentTarget,false);state.pendingAction=null;} });
async function performPayment(amount,description){ const result=await api('/user/pay',{method:'POST',token:state.userToken,body:{amount,description,idempotencyKey:makeId()}}); state.dashboard=result.dashboard; renderUser(); toast(`${amount} C 결제가 완료됐습니다.`,'success'); }
function renderGames(){
  const games=state.dashboard?.games||[], done=new Set(state.dashboard?.completedGames||[]);
  $('#gameGrid').innerHTML=games.length?games.map(g=>`<article class="shop-card"><div class="image-box"><img src="${escapeHtml(g.image_url||'/assets/logo.webp')}" onerror="this.src='/assets/logo.webp'" alt="${escapeHtml(g.name)}" width="900" height="600"></div><div class="shop-card-body"><h3>${escapeHtml(g.name)}</h3><p>완료 시 ${Number(g.reward||0).toLocaleString()} C 지급</p>${done.has(g.code)?'<span class="completed-badge">완료</span>':'<button class="primary" data-scan-game="'+escapeHtml(g.code)+'" type="button">완료 QR 스캔</button>'}</div></article>`).join(''):'<div class="empty">등록된 게임이 없습니다.</div>';
  $$('[data-scan-game]').forEach(b=>b.addEventListener('click',()=>openScanner()));
}
function renderTransactions(){
  const tx=state.dashboard?.transactions||[], visible=state.historyExpanded?tx:tx.slice(0,5); $('#transactionList').innerHTML=visible.length?visible.map(t=>`<li class="transaction-item"><div><p>${escapeHtml(t.description||'크레딧 변동')}</p><time>${formatDate(t.created_at)}</time></div><span class="amount ${Number(t.amount)>=0?'plus':'minus'}">${Number(t.amount)>=0?'+':''}${Number(t.amount).toLocaleString()} C</span></li>`).join(''):'<li class="empty">아직 사용내역이 없습니다.</li>';
  const toggle=$('#toggleHistory'); toggle.hidden=tx.length<=5; toggle.classList.toggle('expanded',state.historyExpanded); $('span',toggle).textContent=state.historyExpanded?'내역 접기':'나머지 내역도 보기';
}
$('#toggleHistory').addEventListener('click',()=>{state.historyExpanded=!state.historyExpanded;renderTransactions();});

$('#openScanner').addEventListener('click',openScanner); $('#startCamera').addEventListener('click',startCamera); $('#qrFile').addEventListener('change',scanFile);
function openScanner(){ openModal('scannerModal'); }
async function startCamera(){
  if(state.scanning)return; const button=$('#startCamera'); setBusy(button,true,'카메라 준비 중');
  try{ if(!window.Html5Qrcode)throw new Error('QR 라이브러리를 불러오지 못했습니다.'); if(!state.scanner)state.scanner=new window.Html5Qrcode('qrReader',{verbose:false}); state.scanning=true; await state.scanner.start({facingMode:'environment'},{fps:10,qrbox:(w,h)=>{const s=Math.floor(Math.min(w,h)*.72);return{width:s,height:s};},aspectRatio:1},onQrDecoded,()=>{}); button.textContent='스캔 중'; }
  catch(error){ state.scanning=false; setBusy(button,false); toast('카메라를 열 수 없습니다. 사진에서 읽기를 사용해 주세요.','error'); }
}
async function stopScanner(){
  try{ if(state.scanner&&state.scanning)await state.scanner.stop(); if(state.scanner)await state.scanner.clear(); }catch{} state.scanner=null;state.scanning=false;setBusy($('#startCamera'),false);$('#startCamera').textContent='카메라 시작';$('#qrReader').innerHTML='';$('#qrFile').value='';
}
async function scanFile(e){ const file=e.target.files?.[0]; if(!file)return; try{if(!window.Html5Qrcode)throw new Error('QR 라이브러리를 불러오지 못했습니다.');if(!state.scanner)state.scanner=new window.Html5Qrcode('qrReader',{verbose:false}); const value=await state.scanner.scanFile(file,true); await onQrDecoded(value);}catch(error){toast('사진에서 QR을 찾지 못했습니다.','error');}}
async function onQrDecoded(decoded){
  if(!state.modal)return; await stopScanner(); let token=decoded;
  try{const u=new URL(decoded);token=u.searchParams.get('token')||decoded;}catch{}
  try{const parsed=JSON.parse(decoded);token=parsed.token||token;}catch{}
  try{const result=await api('/user/scan',{method:'POST',token:state.userToken,body:{token}});state.dashboard=result.dashboard;renderUser();await closeModal();toast(result.message||'QR 처리가 완료됐습니다.','success');}catch(error){toast(error.message,'error');}
}

function renderAdmin(){
  $$('.tab[data-admin-tab]').forEach(b=>b.classList.toggle('active',b.dataset.adminTab===state.adminTab));
  const names={participants:'Participants',games:'Games',payment:'Payment',settings:'Settings'};Object.entries(names).forEach(([key,suffix])=>{$(`#admin${suffix}Panel`).hidden=key!==state.adminTab;});
  renderParticipants(); renderAdminGames();
}
$$('[data-admin-tab]').forEach(button=>button.addEventListener('click',()=>navigate('admin',{tab:button.dataset.adminTab})));
async function loadAdminData(){
  try{const [people,games]=await Promise.all([api('/admin/participants',{token:state.adminToken}),api('/admin/games',{token:state.adminToken})]);state.participants=people.participants||[];state.adminGames=games.games||[];renderAdmin();}catch(error){toast(`관리자 데이터 로딩 실패: ${error.message}`,'error');}
}
function renderParticipants(){
  const q=$('#participantSearch').value.trim().toLowerCase(), rows=state.participants.filter(p=>!q||p.employee_no.toLowerCase().includes(q)||p.name.toLowerCase().includes(q));$('#participantCount').textContent=rows.length;
  $('#participantList').innerHTML=rows.length?rows.map(p=>`<div class="participant-row"><b>${escapeHtml(p.employee_no)}</b><span>${escapeHtml(p.name)}</span><span class="credits">${Number(p.credits||0).toLocaleString()} C</span><div class="participant-actions"><button class="outline small" data-credit="${p.id}" type="button">+100 C</button><button class="outline small danger" data-delete-person="${p.id}" type="button">삭제</button></div></div>`).join(''):'<div class="empty">조건에 맞는 참가자가 없습니다.</div>';
  $$('[data-credit]').forEach(b=>b.addEventListener('click',()=>adminCredit(b.dataset.credit,100)));$$('[data-delete-person]').forEach(b=>b.addEventListener('click',()=>deleteParticipant(b.dataset.deletePerson)));
}
$('#participantSearch').addEventListener('input',renderParticipants);$('#resetSearch').addEventListener('click',()=>{$('#participantSearch').value='';renderParticipants();$('#participantSearch').focus();});
$('#participantForm').addEventListener('submit',async e=>{e.preventDefault();const b=$('button[type=submit]',e.currentTarget);setBusy(b,true,'등록 중');try{await api('/admin/participants',{method:'POST',token:state.adminToken,body:Object.fromEntries(new FormData(e.currentTarget))});e.currentTarget.reset();await loadAdminData();toast('참가자를 등록했습니다.','success');}catch(error){toast(error.message,'error');}finally{setBusy(b,false);}});
$('#bulkForm').addEventListener('submit',async e=>{e.preventDefault();const b=$('button[type=submit]',e.currentTarget),text=new FormData(e.currentTarget).get('rows');const rows=text.split(/\r?\n/).filter(Boolean).map(line=>{const [employeeNo,name,password='1234',credits='0']=line.split(/\t|,/).map(v=>v.trim());return{employeeNo,name,password,credits:Number(credits)||0};});setBusy(b,true,'등록 중');try{const r=await api('/admin/participants/bulk',{method:'POST',token:state.adminToken,body:{rows}});e.currentTarget.reset();await loadAdminData();toast(`${r.created}명을 등록했습니다.`,'success');}catch(error){toast(error.message,'error');}finally{setBusy(b,false);}});
async function adminCredit(id,amount){try{await api(`/admin/participants/${encodeURIComponent(id)}/credit`,{method:'POST',token:state.adminToken,body:{amount,description:'관리자 크레딧 지급'}});await loadAdminData();toast(`${amount} C를 지급했습니다.`,'success');}catch(error){toast(error.message,'error');}}
async function deleteParticipant(id){const p=state.participants.find(x=>x.id===id);if(!confirm(`${p?.name||'참가자'}와 연결된 내역을 모두 삭제할까요?`))return;try{await api(`/admin/participants/${encodeURIComponent(id)}`,{method:'DELETE',token:state.adminToken});await loadAdminData();toast('참가자를 삭제했습니다.','success');}catch(error){toast(error.message,'error');}}

$('#gameForm').addEventListener('submit',async e=>{e.preventDefault();const b=$('button[type=submit]',e.currentTarget);setBusy(b,true,'추가 중');try{await api('/admin/games',{method:'POST',token:state.adminToken,body:Object.fromEntries(new FormData(e.currentTarget))});e.currentTarget.reset();await loadAdminData();toast('게임을 추가했습니다.','success');}catch(error){toast(error.message,'error');}finally{setBusy(b,false);}});
function renderAdminGames(){
  $('#adminGameList').innerHTML=state.adminGames.length?state.adminGames.map(g=>`<article class="shop-card"><div class="image-box"><img src="${escapeHtml(g.image_url||'/assets/logo.webp')}" onerror="this.src='/assets/logo.webp'" alt="${escapeHtml(g.name)}"></div><div class="shop-card-body"><h3>${escapeHtml(g.name)}</h3><p>코드 ${escapeHtml(g.code)} · 보상 ${Number(g.reward||0)} C</p><div class="admin-card-actions"><button class="primary" data-game-qr="${escapeHtml(g.code)}" type="button">완료 QR</button><button class="outline danger" data-delete-game="${escapeHtml(g.code)}" type="button">게임 삭제</button></div></div></article>`).join(''):'<div class="empty">등록된 게임이 없습니다.</div>';
  $$('[data-game-qr]').forEach(b=>b.addEventListener('click',()=>createGameQr(b.dataset.gameQr)));$$('[data-delete-game]').forEach(b=>b.addEventListener('click',()=>deleteGame(b.dataset.deleteGame)));
}
async function createGameQr(code){try{const r=await api(`/admin/games/${encodeURIComponent(code)}/qr`,{method:'POST',token:state.adminToken});await showQr(r.token,`${r.game.name} 완료 QR · ${r.game.reward} C`);}catch(error){toast(error.message,'error');}}
async function deleteGame(code){const g=state.adminGames.find(x=>x.code===code);if(!confirm(`${g?.name||code} 게임과 완료기록을 삭제할까요?`))return;try{await api(`/admin/games/${encodeURIComponent(code)}`,{method:'DELETE',token:state.adminToken});await loadAdminData();toast('게임을 삭제했습니다.','success');}catch(error){toast(error.message,'error');}}
$('#paymentQrForm').addEventListener('submit',async e=>{e.preventDefault();const b=$('button[type=submit]',e.currentTarget);setBusy(b,true,'생성 중');try{const r=await api('/admin/payment-qr',{method:'POST',token:state.adminToken,body:Object.fromEntries(new FormData(e.currentTarget))});await showQr(r.token,`${r.amount} C · ${r.description}`);}catch(error){toast(error.message,'error');}finally{setBusy(b,false);}});
async function showQr(token,caption){
  if(!window.QRCode){toast('QR 생성 라이브러리를 불러오지 못했습니다. 새로고침해 주세요.','error');return;}
  openModal('qrDisplayModal');$('#qrCaption').textContent=caption;const payload=new URL('/?token='+encodeURIComponent(token),location.origin).href, mount=$('#qrCanvas');mount.innerHTML='';
  new window.QRCode(mount,{text:payload,width:420,height:420,colorDark:'#0d294d',colorLight:'#fffdf9',correctLevel:window.QRCode.CorrectLevel.M});
}
$('#adminPasswordForm').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),password=fd.get('password');if(password!==fd.get('confirm')){toast('새 비밀번호가 서로 다릅니다.','error');return;}const b=$('button[type=submit]',e.currentTarget);setBusy(b,true,'변경 중');try{await api('/admin/password',{method:'POST',token:state.adminToken,body:{password}});e.currentTarget.reset();toast('관리자 비밀번호를 변경했습니다.','success');}catch(error){toast(error.message,'error');}finally{setBusy(b,false);}});

window.addEventListener('online',()=>{$('#connectionBadge').textContent='ONLINE';});window.addEventListener('offline',()=>{$('#connectionBadge').textContent='OFFLINE';});
bootstrapHistory();render();
