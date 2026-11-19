const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const views = { login: $('#loginView'), user: $('#userView'), admin: $('#adminView') };
const state = {
  token: localStorage.getItem('zipToken') || '',
  role: localStorage.getItem('zipRole') || '',
  user: null,
  admin: { participants: [], games: [] },
  showAllHistory: false,
  pendingPayment: 0,
  scanner: null,
  scanning: false
};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const formatNumber = value => Number(value || 0).toLocaleString('ko-KR');
const formatDate = value => new Intl.DateTimeFormat('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).format(new Date(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const scriptLoads = new Map();
function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (!scriptLoads.has(src)) scriptLoads.set(src, new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = src; script.async = true;
    script.onload = () => window[globalName] ? resolve(window[globalName]) : reject(new Error(`${globalName} 로드 실패`));
    script.onerror = () => reject(new Error(`${globalName} 네트워크 로드 실패`));
    document.head.append(script);
  }));
  return scriptLoads.get(src);
}
const loadQrScanner = () => loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js','Html5Qrcode');
const loadQrGenerator = () => loadScript('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js','QRCode');

function setLoading(on, label = 'ZIP 여는 중...') {
  $('#loading strong').textContent = label;
  $('#loading').hidden = !on;
  $$('button').forEach(button => { if (on && button.type === 'submit') button.dataset.wasDisabled = String(button.disabled); });
}
let toastTimer;
function toast(message, kind = '') {
  clearTimeout(toastTimer);
  const el = $('#toast'); el.textContent = message; el.className = `toast ${kind}`.trim(); el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 6500 : 3200);
}

async function api(path, options = {}) {
  const headers = { 'content-type':'application/json', ...(options.headers || {}) };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const response = await fetch(`/api${path}`, { method: options.method || 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  let data;
  try { data = await response.json(); } catch { data = { message:`서버 응답을 읽지 못했습니다. (HTTP ${response.status})` }; }
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || '요청을 처리하지 못했습니다.'); error.code = data.code; error.detail = data.detail; error.status = response.status; throw error;
  }
  return data;
}
function friendlyError(error) {
  const map = {
    ENV_MISSING:'Netlify 환경변수가 빠져 있습니다. /api/health의 detail을 확인하세요.',
    DATABASE_ERROR:'Supabase 연결 또는 schema.sql 권한을 확인하세요.',
    LOGIN_FAILED:error.message,
    INSUFFICIENT_CREDIT:'크레딧이 부족합니다.', DUPLICATE_PAYMENT:'이미 사용한 결제 QR입니다.',
    ALREADY_COMPLETED:'이미 완료 보상을 받은 게임입니다.', TOKEN_EXPIRED:'로그인이 만료되었습니다. 다시 로그인해 주세요.',
    INVALID_QR:'유효하지 않거나 만료된 QR입니다.'
  };
  return map[error.code] || error.message || '오류가 발생했습니다.';
}
function saveAuth(token, role) {
  state.token = token; state.role = role;
  localStorage.setItem('zipToken', token); localStorage.setItem('zipRole', role);
}
function clearAuth() {
  state.token = ''; state.role = ''; state.user = null; state.admin = { participants:[], games:[] };
  localStorage.removeItem('zipToken'); localStorage.removeItem('zipRole');
}

function showView(name) {
  Object.entries(views).forEach(([key, view]) => { view.hidden = key !== name; });
  $('#statusBadge').hidden = name === 'login';
  $('#statusBadge').textContent = name === 'admin' ? 'ADMIN' : name === 'user' ? 'MEMBER' : '';
  window.scrollTo({ top:0, behavior:'instant' });
}
function navigate(view, replace = false) {
  const next = { view };
  if (replace) history.replaceState(next, '', location.pathname); else history.pushState(next, '', location.pathname);
  applyHistory(next);
}
function closeAllModals() {
  $$('.modal').forEach(modal => { modal.hidden = true; modal.setAttribute('aria-hidden','true'); });
  stopScanner();
}
function openModal(id, fromHistory = false) {
  closeAllModals();
  const modal = document.getElementById(id); if (!modal) return;
  modal.hidden = false; modal.setAttribute('aria-hidden','false');
  if (!fromHistory) history.pushState({ ...(history.state || { view:'login' }), modal:id }, '', location.pathname);
  requestAnimationFrame(() => modal.querySelector('input,button')?.focus());
}
function closeModal(id) {
  if (history.state?.modal === id) history.back();
  else { document.getElementById(id).hidden = true; stopScanner(); }
}
function applyHistory(entry = {}) {
  closeAllModals();
  let view = entry.view || 'login';
  if (view === 'user' && (!state.token || state.role !== 'user')) view = 'login';
  if (view === 'admin' && (!state.token || state.role !== 'admin')) view = 'login';
  showView(view);
  if (entry.modal) openModal(entry.modal, true);
}
window.addEventListener('popstate', event => applyHistory(event.state || { view:'login' }));

function applyUserSnapshot(data) {
  state.user = { participant:data.participant, transactions:data.transactions || [], games:data.games || [], completedGameIds:data.completedGameIds || [] };
  renderUser();
}
function gameImage(game) {
  const name = String(game.name || '').toLowerCase();
  if (name.includes('탁구') || name.includes('핑퐁') || name.includes('ping')) return '/assets/game-pingpong.webp?v=7';
  if (name.includes('풍선') || name.includes('balloon')) return '/assets/game-balloon.webp?v=7';
  return game.image_url || '/assets/game-default.webp?v=7';
}
function renderUser() {
  const snapshot = state.user; if (!snapshot) return;
  $('#userName').textContent = snapshot.participant.name;
  $('#creditBalance').textContent = `${formatNumber(snapshot.participant.credits)} C`;
  const payments = [100,200,300];
  $('#paymentCards').innerHTML = payments.map(amount => `<article class="image-card"><div class="image-frame"><img src="/assets/pay-${amount}.webp?v=7" alt="${amount} 크레딧 결제" width="900" height="600" loading="lazy"></div><div class="image-card-body"><div><h3>${formatNumber(amount)} C</h3><p>크레딧 결제</p></div><button class="primary" type="button" data-pay="${amount}">결제</button></div></article>`).join('');
  const completed = new Set(snapshot.completedGameIds);
  $('#gameCards').innerHTML = snapshot.games.length ? snapshot.games.map(game => `<article class="image-card ${completed.has(game.id) ? 'completed' : ''}"><div class="image-frame"><img src="${escapeHtml(gameImage(game))}" alt="${escapeHtml(game.name)}" width="900" height="600" loading="lazy" onerror="this.src='/assets/game-default.webp?v=7'"></div><div class="image-card-body"><div><h3>${escapeHtml(game.name)}</h3><p>완료 보상 +${formatNumber(game.reward)} C</p></div>${completed.has(game.id) ? '<span class="completed-label">완료</span>' : '<button class="primary" type="button" data-open-scan="1">QR 스캔</button>'}</div></article>`).join('') : '<div class="empty-state">등록된 게임이 없습니다.</div>';
  renderHistory();
}
function renderHistory() {
  const history = state.user?.transactions || [];
  const shown = state.showAllHistory ? history : history.slice(0,5);
  $('#historyList').innerHTML = shown.length ? shown.map(item => `<article class="history-item"><div><p>${escapeHtml(item.description || item.type)}</p><small>${formatDate(item.created_at)} · 잔액 ${formatNumber(item.balance_after)} C</small></div><strong class="${item.amount >= 0 ? 'positive' : 'negative'}">${item.amount >= 0 ? '+' : ''}${formatNumber(item.amount)} C</strong></article>`).join('') : '<div class="empty-state">아직 사용내역이 없습니다.</div>';
  const toggle = $('#toggleHistory'); toggle.hidden = history.length <= 5;
  toggle.classList.toggle('expanded', state.showAllHistory);
  toggle.innerHTML = state.showAllHistory ? '<span>⌄</span> 내역 접기' : '<span>⌄</span> 나머지 내역도 보기';
}

function applyAdminSnapshot(data) {
  state.admin = { participants:data.participants || [], games:data.games || [] };
  renderAdmin();
}
function renderAdmin() {
  renderParticipants();
  $('#adminGameList').innerHTML = state.admin.games.length ? state.admin.games.map(game => `<article class="admin-row"><div><h3>${escapeHtml(game.name)}</h3><p>완료 보상 ${formatNumber(game.reward)} C</p></div><div class="row-actions"><button class="secondary" type="button" data-game-qr="${game.id}">완료 QR</button><button class="danger" type="button" data-delete-game="${game.id}" data-name="${escapeHtml(game.name)}">삭제</button></div></article>`).join('') : '<div class="empty-state">등록된 게임이 없습니다.</div>';
}
function renderParticipants() {
  const query = ($('#participantSearch')?.value || '').trim().toLowerCase();
  const list = state.admin.participants.filter(person => !query || person.employee_id.toLowerCase().includes(query) || person.name.toLowerCase().includes(query));
  $('#participantList').innerHTML = list.length ? list.map(person => `<article class="admin-row"><div><h3>${escapeHtml(person.name)} <small>(${escapeHtml(person.employee_id)})</small></h3><p>${formatNumber(person.credits)} C</p></div><div class="row-actions"><button class="secondary" type="button" data-credit="${person.id}" data-name="${escapeHtml(person.name)}">크레딧 조정</button><button class="danger" type="button" data-delete-person="${person.id}" data-name="${escapeHtml(person.name)}">삭제</button></div></article>`).join('') : '<div class="empty-state">검색 결과가 없습니다.</div>';
}

async function userLogin(event) {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  setLoading(true, '로그인하는 중...');
  try {
    const data = await api('/login', { method:'POST', body:{ employeeId:form.get('employeeId'), password:form.get('password') } });
    saveAuth(data.token,'user'); applyUserSnapshot(data); event.currentTarget.reset(); navigate('user'); toast('ZIP! MARKET에 입장했어요.','success');
  } catch (error) { toast(`사용자 로그인 실패: ${friendlyError(error)}`,'error'); }
  finally { setLoading(false); }
}
async function adminLogin(event) {
  event.preventDefault(); const password = new FormData(event.currentTarget).get('password');
  setLoading(true, '관리자 로그인 확인 중...');
  try {
    const data = await api('/admin/login', { method:'POST', body:{ password } });
    saveAuth(data.token,'admin'); applyAdminSnapshot(data); event.currentTarget.reset(); closeAllModals(); navigate('admin',true); toast('관리자 페이지를 열었습니다.','success');
  } catch (error) { toast(`관리자 로그인 실패: ${friendlyError(error)}${error.detail ? ` (${error.detail})` : ''}`,'error'); }
  finally { setLoading(false); }
}
function logout() { clearAuth(); closeAllModals(); navigate('login'); toast('로그아웃했습니다.'); }

function openPayment(amount) {
  state.pendingPayment = amount;
  $('#paymentDescription').innerHTML = `<strong>${formatNumber(amount)} C</strong>를 결제할까요?<br><small>결제 확인을 눌렀을 때만 크레딧이 차감됩니다.</small>`;
  openModal('paymentModal');
}
async function confirmPayment() {
  const amount = state.pendingPayment; if (!amount) return;
  setLoading(true, '결제 처리 중...');
  try { const data = await api('/pay', { method:'POST', body:{ amount } }); applyUserSnapshot(data); closeModal('paymentModal'); toast(`${formatNumber(amount)} C 결제 완료`,'success'); }
  catch (error) { toast(friendlyError(error),'error'); }
  finally { state.pendingPayment = 0; setLoading(false); }
}

async function stopScanner() {
  if (!state.scanner) return;
  try { if (state.scanning) await state.scanner.stop(); } catch {}
  try { await state.scanner.clear(); } catch {}
  state.scanning = false;
}
async function ensureScanner() {
  const Scanner = await loadQrScanner();
  if (!state.scanner) state.scanner = new Scanner('qrReader', { verbose:false });
  return state.scanner;
}
async function startCamera() {
  try {
    const Scanner = await loadQrScanner();
    await stopScanner(); state.scanner = new Scanner('qrReader', { verbose:false });
    await state.scanner.start({ facingMode:'environment' }, { fps:10, qrbox:(w,h) => ({ width:Math.min(250,w-24), height:Math.min(250,h-24) }), aspectRatio:1 }, async text => { await stopScanner(); await redeemQr(text); }, () => {});
    state.scanning = true;
  } catch (error) { state.scanning = false; toast('카메라를 시작하지 못했습니다. 카메라 권한을 허용하거나 사진에서 QR 읽기를 이용해 주세요.','error'); }
}
async function scanFile(file) {
  if (!file) return;
  try { const Scanner = await loadQrScanner(); await stopScanner(); state.scanner = new Scanner('qrReader', { verbose:false }); const text = await state.scanner.scanFile(file, true); await redeemQr(text); }
  catch (error) { toast('사진에서 QR을 찾지 못했습니다. QR이 선명하게 보이는 사진을 사용해 주세요.','error'); }
}
async function redeemQr(qrPayload) {
  setLoading(true, 'QR 처리 중...');
  try { const data = await api('/redeem', { method:'POST', body:{ qrPayload } }); applyUserSnapshot(data); closeModal('qrModal'); toast('QR 처리가 완료됐어요.','success'); }
  catch (error) { toast(friendlyError(error),'error'); }
  finally { setLoading(false); }
}

async function submitParticipant(event) {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  setLoading(true,'참가자 등록 중...');
  try { const data = await api('/admin/participants',{method:'POST',body:{employeeId:form.get('employeeId'),name:form.get('name'),password:form.get('password'),credits:Number(form.get('credits'))}}); applyAdminSnapshot(data); event.currentTarget.reset(); toast('참가자를 등록했습니다.','success'); }
  catch(error){ toast(friendlyError(error),'error'); } finally{ setLoading(false); }
}
async function bulkAdd() {
  const lines = $('#bulkParticipants').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const participants = lines.map(line => { const parts=line.split(/\t|,/).map(v=>v.trim()); return {employeeId:parts[0],name:parts[1],password:parts[2],credits:Number(parts[3]||0)}; });
  if (!participants.length || participants.some(p=>!p.employeeId||!p.name||!p.password||!Number.isFinite(p.credits))) return toast('일괄 등록 형식을 확인해 주세요.','error');
  setLoading(true,'참가자 일괄 등록 중...');
  try { const data=await api('/admin/participants',{method:'POST',body:{participants}}); applyAdminSnapshot(data); $('#bulkParticipants').value=''; toast(`${participants.length}명을 등록했습니다.`,'success'); }
  catch(error){ toast(friendlyError(error),'error'); } finally{ setLoading(false); }
}
async function submitGame(event) {
  event.preventDefault(); const form=new FormData(event.currentTarget); setLoading(true,'게임 추가 중...');
  try { const data=await api('/admin/games',{method:'POST',body:{name:form.get('name'),imageUrl:form.get('imageUrl'),reward:Number(form.get('reward'))}}); applyAdminSnapshot(data); event.currentTarget.reset(); toast('게임을 추가했습니다.','success'); }
  catch(error){ toast(friendlyError(error),'error'); } finally{ setLoading(false); }
}
async function showQr(path, body, title) {
  setLoading(true,'QR 생성 중...');
  try { const Generator=await loadQrGenerator(); const data=await api(path,{method:'POST',body}); await Generator.toCanvas($('#generatedQrCanvas'),data.qrPayload,{width:340,margin:2,color:{dark:'#0b2648',light:'#ffffff'},errorCorrectionLevel:'M'}); $('#generatedQrTitle').textContent=title; $('#generatedQrCaption').textContent=data.caption; openModal('generatedQrModal'); }
  catch(error){ toast(friendlyError(error),'error'); } finally{ setLoading(false); }
}
async function submitPaymentQr(event){event.preventDefault();const amount=Number(new FormData(event.currentTarget).get('amount'));await showQr('/admin/payment-qr',{amount},'결제 QR');}
async function changeAdminPassword(event){event.preventDefault();const password=new FormData(event.currentTarget).get('password');setLoading(true,'비밀번호 변경 중...');try{await api('/admin/password',{method:'POST',body:{password}});event.currentTarget.reset();toast('관리자 비밀번호를 변경했습니다.','success');}catch(error){toast(friendlyError(error),'error');}finally{setLoading(false);}}

$('#loginForm').addEventListener('submit',userLogin);
$('#adminLoginForm').addEventListener('submit',adminLogin);
$('#openAdminLogin').addEventListener('click',()=>openModal('adminLoginModal'));
$('#confirmPayment').addEventListener('click',confirmPayment);
$('#openQrScanner').addEventListener('click',()=>openModal('qrModal'));
$('#startCamera').addEventListener('click',startCamera);
$('#qrFile').addEventListener('change',event=>scanFile(event.target.files?.[0]));
$('#toggleHistory').addEventListener('click',()=>{state.showAllHistory=!state.showAllHistory;renderHistory();});
$('#participantForm').addEventListener('submit',submitParticipant);
$('#bulkAddButton').addEventListener('click',bulkAdd);
$('#gameForm').addEventListener('submit',submitGame);
$('#paymentQrForm').addEventListener('submit',submitPaymentQr);
$('#adminPasswordForm').addEventListener('submit',changeAdminPassword);
$('#participantSearch').addEventListener('input',renderParticipants);
$('#resetSearch').addEventListener('click',()=>{$('#participantSearch').value='';renderParticipants();$('#participantSearch').focus();});

document.addEventListener('click',async event=>{
  const target=event.target.closest('button,[data-close-modal]'); if(!target)return;
  if(target.dataset.closeModal){closeModal(target.dataset.closeModal);return;}
  if(target.dataset.action==='logout'){logout();return;}
  if(target.dataset.pay){openPayment(Number(target.dataset.pay));return;}
  if(target.dataset.openScan){openModal('qrModal');return;}
  if(target.dataset.deletePerson){if(!confirm(`${target.dataset.name} 참가자를 삭제할까요? 사용내역도 함께 삭제됩니다.`))return;setLoading(true,'참가자 삭제 중...');try{await api(`/admin/participants/${target.dataset.deletePerson}`,{method:'DELETE'});state.admin.participants=state.admin.participants.filter(p=>p.id!==target.dataset.deletePerson);renderParticipants();toast('참가자를 삭제했습니다.','success');}catch(error){toast(friendlyError(error),'error');}finally{setLoading(false);}return;}
  if(target.dataset.credit){const amount=Number(prompt(`${target.dataset.name}님의 크레딧 조정 금액을 입력하세요. 지급은 양수, 차감은 음수입니다.`,`100`));if(!Number.isSafeInteger(amount)||amount===0)return;setLoading(true,'크레딧 조정 중...');try{const data=await api(`/admin/participants/${target.dataset.credit}/credit`,{method:'POST',body:{amount}});applyAdminSnapshot(data);toast('크레딧을 조정했습니다.','success');}catch(error){toast(friendlyError(error),'error');}finally{setLoading(false);}return;}
  if(target.dataset.deleteGame){if(!confirm(`${target.dataset.name} 게임과 연결된 완료 기록을 삭제할까요?`))return;setLoading(true,'게임 삭제 중...');try{await api(`/admin/games/${target.dataset.deleteGame}`,{method:'DELETE'});state.admin.games=state.admin.games.filter(g=>g.id!==target.dataset.deleteGame);renderAdmin();toast('게임을 삭제했습니다.','success');}catch(error){toast(friendlyError(error),'error');}finally{setLoading(false);}return;}
  if(target.dataset.gameQr){await showQr(`/admin/games/${target.dataset.gameQr}/qr`,{},'게임 완료 QR');}
});

document.addEventListener('keydown',event=>{if(event.key==='Escape'){const modal=$$('.modal').find(item=>!item.hidden);if(modal)closeModal(modal.id);}});

async function restoreSession(){
  history.replaceState({view:'login'},'',location.pathname);
  if(!state.token||!state.role){showView('login');return;}
  setLoading(true,'이전 로그인 복원 중...');
  try{
    if(state.role==='user'){const data=await api('/session');applyUserSnapshot(data);navigate('user',true);}
    else if(state.role==='admin'){const data=await api('/admin/snapshot');applyAdminSnapshot(data);navigate('admin',true);}
    else throw new Error('role');
  }catch{clearAuth();navigate('login',true);}finally{setLoading(false);}
}

restoreSession();
