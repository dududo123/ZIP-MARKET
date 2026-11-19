(() => {
  'use strict';
  const VERSION = '8.5.0';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const views = { login: $('#login-view'), participant: $('#participant-view'), admin: $('#admin-view') };
  const participantPages = { home: $('#participant-home'), payments: $('#payments-page'), games: $('#games-page') };
  const state = {
    token: localStorage.getItem('zipMarketToken') || '', role: localStorage.getItem('zipMarketRole') || '',
    dashboard: null, admin: { participants: [], games: [] }, historyExpanded: false,
    modal: null, pendingAmount: 0, scanner: null, qrLibraryLoading: null
  };

  let toastTimer;
  function toast(message, isError = false) {
    const el = $('#toast');
    el.textContent = message; el.style.background = isError ? '#a92f29' : '#172233'; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }
  function errorMessage(error) { return error?.message || '요청을 처리하지 못했습니다.'; }
  function setBusy(button, busy, label = '처리 중…') {
    if (!button) return; if (busy) { button.dataset.oldText = button.textContent; button.textContent = label; button.disabled = true; }
    else { button.textContent = button.dataset.oldText || button.textContent; button.disabled = false; }
  }
  function resetFormSafely(form, focusSelector) {
    if (!(form instanceof HTMLFormElement)) return false;
    form.reset();
    if (focusSelector) form.querySelector(focusSelector)?.focus();
    return true;
  }
  function parseBulkParticipants(text) {
    const lines = String(text || '').split(/\r?\n/);
    const participants = [];
    const errors = [];
    const seen = new Map();
    lines.forEach((raw, index) => {
      if (!raw.trim()) return;
      const row = index + 1;
      const columns = raw.includes('\t') ? raw.split('\t') : raw.split(/\s{2,}|,/);
      const [employeeNoRaw='', nameRaw='', passwordRaw='', creditRaw=''] = columns.map(value => String(value).trim());
      const employeeNo = employeeNoRaw, name = nameRaw, password = passwordRaw;
      if (columns.length < 4) errors.push(`${row}행: 사번·이름·비밀번호·크레딧 4개 열이 필요합니다.`);
      else if (!employeeNo) errors.push(`${row}행: 사번이 없습니다.`);
      else if (!name) errors.push(`${row}행: 이름이 없습니다.`);
      else if (!password) errors.push(`${row}행: 비밀번호가 없습니다.`);
      else if (!/^(0|[1-9]\d*)$/.test(creditRaw)) errors.push(`${row}행: 초기 크레딧은 0 이상의 정수여야 합니다.`);
      else if (seen.has(employeeNo)) errors.push(`${row}행: ${seen.get(employeeNo)}행과 사번이 중복됩니다. (${employeeNo})`);
      else { seen.set(employeeNo,row); participants.push({employeeNo,name,password,initialCredit:Number(creditRaw)}); }
    });
    if (!participants.length && !errors.length) errors.push('등록할 데이터를 붙여넣어 주세요.');
    return { participants, errors };
  }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function formatDate(value) { try { return new Intl.DateTimeFormat('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)); } catch { return ''; } }

  async function api(path, options = {}) {
    const { readApiResponse } = globalThis.ZipMarketApiResponse || {};
    if (!readApiResponse) throw new Error('API 응답 처리 모듈을 불러오지 못했습니다. 새로고침해 주세요.');

    const request = async (base) => {
      const hasBody = options.body !== undefined;
      const headers = {
        accept: 'application/json',
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        ...(state.token ? { authorization: `Bearer ${state.token}` } : {})
      };
      const res = await fetch(`${base}${path}`, {
        method: options.method || 'GET',
        headers,
        cache: 'no-store',
        body: hasBody ? JSON.stringify(options.body) : undefined
      });
      return readApiResponse(res);
    };

    try { return await request('/api'); }
    catch (error) {
      if (error?.retryable || ['NON_JSON_RESPONSE', 'INVALID_API_SHAPE'].includes(error?.code) || /Failed to fetch/i.test(error?.message || '')) {
        return request('/.netlify/functions/api');
      }
      throw error;
    }
  }

  function saveSession(role, token) { state.role = role; state.token = token; localStorage.setItem('zipMarketRole', role); localStorage.setItem('zipMarketToken', token); }
  function clearSession() { state.role = ''; state.token = ''; state.dashboard = null; localStorage.removeItem('zipMarketRole'); localStorage.removeItem('zipMarketToken'); }

  function showView(name) { Object.entries(views).forEach(([key, el]) => el.classList.toggle('hidden', key !== name)); window.scrollTo({top:0}); }
  function showParticipantPage(name, push = true) {
    Object.entries(participantPages).forEach(([key, el]) => el.classList.toggle('hidden', key !== name));
    if (push) history.pushState({ zipMarket:true, view:'participant', page:name }, '', `#${name}`);
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function initializeHistory() {
    history.replaceState({ zipMarket:true, guard:true }, '', location.pathname);
    history.pushState({ zipMarket:true, view: state.role || 'login', page:'home' }, '', location.pathname);
  }
  function currentHistoryState() { return { zipMarket:true, view: state.role || 'login', page: $('.participant-page:not(.hidden)')?.id?.replace('-page','').replace('participant-','') || 'home' }; }

  function openModal(id, push = true) {
    if (state.modal && state.modal !== id) closeModal(false);
    const el = $(`#${id}`); if (!el) return;
    el.classList.remove('hidden'); state.modal = id;
    if (push) history.pushState({ ...currentHistoryState(), modal:id }, '', `#${id}`);
    setTimeout(() => $('input,button', el)?.focus(), 20);
  }
  async function closeModal(useBack = true) {
    if (!state.modal) return;
    const id = state.modal; const el = $(`#${id}`); state.modal = null; el?.classList.add('hidden');
    if (id === 'scanner-modal') await stopScanner();
    if (useBack && history.state?.modal === id) history.back();
  }

  window.addEventListener('popstate', async (event) => {
    if (state.modal) { await closeModal(false); return; }
    const s = event.state;
    if (!s || s.guard) { history.pushState({ ...currentHistoryState() }, '', location.pathname); if (state.role === 'participant') showParticipantPage('home', false); else showView(state.role || 'login'); return; }
    if (s.modal) { openModal(s.modal, false); return; }
    if (s.view === 'participant' && state.role === 'participant') { showView('participant'); showParticipantPage(s.page || 'home', false); }
    else if (s.view === 'admin' && state.role === 'admin') showView('admin');
    else showView('login');
  });

  function renderParticipant(data) {
    state.dashboard = data;
    $('#participant-name').textContent = data.participant?.name || '';
    $('#participant-credit').textContent = `${Number(data.participant?.credit_balance || 0).toLocaleString()} C`;
    renderTransactions(); renderParticipantGames();
  }
  function renderTransactions() {
    const list = state.dashboard?.transactions || []; const visible = state.historyExpanded ? list : list.slice(0,5);
    $('#history-count').textContent = `${list.length}건`;
    $('#transaction-list').innerHTML = visible.length ? visible.map(item => `<div class="transaction-row"><strong>${escapeHtml(item.description || (item.amount >= 0 ? '크레딧 지급' : '크레딧 결제'))}</strong><small>${formatDate(item.created_at)}</small><span class="amount ${item.amount >= 0 ? 'plus':'minus'}">${item.amount >= 0 ? '+' : ''}${Number(item.amount).toLocaleString()} C</span></div>`).join('') : '<div class="empty">아직 사용내역이 없습니다.</div>';
    const toggle = $('#history-toggle'); toggle.classList.toggle('hidden', list.length <= 5); toggle.classList.toggle('open', state.historyExpanded);
    $('span', toggle).textContent = state.historyExpanded ? '간단히 보기' : '나머지 내역도 보기';
  }
  function renderParticipantGames() {
    const games = state.dashboard?.games || []; const completed = new Set((state.dashboard?.completions || []).map(x => x.game_id));
    $('#participant-games').innerHTML = games.length ? games.map(game => `<article class="image-card"><div class="image-frame"><img src="${escapeHtml(game.image_url || '/assets/game-default.svg')}" alt="${escapeHtml(game.name)}" onerror="this.src='/assets/game-default.svg'"></div><div class="card-body"><strong>${escapeHtml(game.name)}</strong><p class="${completed.has(game.id)?'status-complete':'status-pending'}">${completed.has(game.id)?'✓ 완료':'QR을 스캔해 완료하세요'}</p></div></article>`).join('') : '<div class="empty">등록된 게임이 없습니다.</div>';
  }

  async function loadParticipant() {
    const data = await api('/participant/dashboard'); renderParticipant(data); showView('participant'); showParticipantPage('home', false);
  }
  async function loadAdmin(search = '') {
    const data = await api(`/admin/dashboard${search ? `?search=${encodeURIComponent(search)}`:''}`); state.admin = data; renderAdmin();
  }
  function renderAdmin() {
    const people = state.admin.participants || [], games = state.admin.games || [];
    $('#participant-total').textContent = `${people.length}명`;
    $('#admin-participants').innerHTML = people.length ? people.map(person => `<article class="participant-item"><div><strong>${escapeHtml(person.name)}</strong><div class="participant-meta"><span>사번 ${escapeHtml(person.employee_no)}</span><span>${Number(person.credit_balance||0).toLocaleString()} C</span></div></div><div class="participant-actions"><button class="secondary small grant-credit" data-id="${person.id}" type="button">+100 C</button><button class="danger delete-participant" data-id="${person.id}" data-name="${escapeHtml(person.name)}" type="button">삭제</button></div></article>`).join('') : '<div class="empty">참가자가 없습니다.</div>';
    $('#admin-games').innerHTML = games.length ? games.map(game => `<article class="image-card"><div class="image-frame"><img src="${escapeHtml(game.image_url || '/assets/game-default.svg')}" alt="${escapeHtml(game.name)}" onerror="this.src='/assets/game-default.svg'"></div><div class="card-body"><strong>${escapeHtml(game.name)}</strong></div><div class="game-admin-actions"><button class="secondary game-qr" data-id="${game.id}" data-name="${escapeHtml(game.name)}" type="button">완료 QR</button><button class="danger delete-game" data-id="${game.id}" data-name="${escapeHtml(game.name)}" type="button">삭제</button></div></article>`).join('') : '<div class="empty">등록된 게임이 없습니다.</div>';
  }
  function switchAdminTab(name) {
    $$('.admin-tab').forEach(el => el.classList.toggle('hidden', el.id !== `${name}-tab`));
    $$('[data-admin-tab]').forEach(el => el.classList.toggle('active', el.dataset.adminTab === name));
    history.pushState({zipMarket:true,view:'admin',tab:name},'',`#${name}`);
  }

  async function participantLogin(event) {
    event.preventDefault(); const button = $('button[type=submit]', event.currentTarget); setBusy(button,true,'로그인 중…');
    try { const data = await api('/auth/participant',{method:'POST',body:{employeeNo:$('#employee-no').value.trim(),password:$('#participant-password').value}}); if(!data?.token||!data?.participant)throw new Error('사용자 로그인 응답 형식이 올바르지 않습니다.'); saveSession('participant',data.token); renderParticipant(data); showView('participant'); showParticipantPage('home',false); history.pushState({zipMarket:true,view:'participant',page:'home'},'','#home'); }
    catch(error){ toast(errorMessage(error),true); } finally { setBusy(button,false); }
  }
  async function adminLogin(event) {
    event.preventDefault(); const button = $('button[type=submit]',event.currentTarget); const password=$('#admin-password')?.value || ''; if(!password){toast('관리자 비밀번호를 입력해 주세요.',true);return;}
    setBusy(button,true,'로그인 중…');
    try { const data=await api('/auth/admin',{method:'POST',body:{password}}); if(!data?.token)throw new Error('관리자 로그인 응답에 인증 정보가 없습니다. API 배포 상태를 확인해 주세요.'); saveSession('admin',data.token); await closeModal(false); showView('admin'); await loadAdmin(); switchAdminTab('participants'); $('#admin-password').value=''; }
    catch(error){toast(errorMessage(error),true);} finally{setBusy(button,false);}
  }
  function logout(){ clearSession(); showView('login'); history.pushState({zipMarket:true,view:'login'},'',location.pathname); toast('로그아웃했습니다.'); }

  async function pay(amount, description) {
    const data=await api('/participant/pay',{method:'POST',body:{amount,description}}); renderParticipant(data); toast(`${amount.toLocaleString()} C 결제가 완료되었습니다.`);
  }
  function showPaymentConfirm(amount){state.pendingAmount=amount;$('#payment-modal-amount').textContent=`${amount.toLocaleString()} C`;openModal('payment-modal');}

  async function loadQrLibrary(type) {
    const ready = type==='scan' ? window.Html5Qrcode : window.QRCode; if(ready) return ready;
    const source = type==='scan' ? 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js' : 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
    await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=source;script.onload=resolve;script.onerror=()=>reject(new Error('QR 라이브러리를 불러오지 못했습니다. 네트워크를 확인해 주세요.'));document.head.appendChild(script);});
    return type==='scan' ? window.Html5Qrcode : window.QRCode;
  }
  async function startScanner() {
    try {
      const Html5Qrcode=await loadQrLibrary('scan'); if(!Html5Qrcode) throw new Error('이 브라우저에서 QR 스캔을 시작할 수 없습니다.');
      if(state.scanner) await stopScanner(); state.scanner=new Html5Qrcode('qr-reader');
      await state.scanner.start({facingMode:'environment'},{fps:10,qrbox:(w,h)=>({width:Math.min(w,h)*.72,height:Math.min(w,h)*.72}),aspectRatio:1},handleQr,()=>{});
      $('#camera-start').textContent='카메라 실행 중'; $('#camera-start').disabled=true;
    } catch(error){toast(errorMessage(error),true);$('#scanner-help').textContent='카메라를 사용할 수 없습니다. 아래에서 QR 사진을 선택해 주세요.';}
  }
  async function stopScanner(){ if(state.scanner){try{if(state.scanner.isScanning)await state.scanner.stop();await state.scanner.clear();}catch{}state.scanner=null;}const b=$('#camera-start');if(b){b.textContent='카메라 시작';b.disabled=false;} }
  async function scanFile(file){try{const Html5Qrcode=await loadQrLibrary('scan');const temp=new Html5Qrcode('qr-reader');const text=await temp.scanFile(file,true);await temp.clear();await handleQr(text);}catch(error){toast('QR을 읽지 못했습니다. 선명한 사진으로 다시 시도해 주세요.',true);}}
  async function handleQr(text){
    try{let payload;try{payload=JSON.parse(text);}catch{throw new Error('ZIP! MARKET QR 코드가 아닙니다.');}if(payload.app!=='zip-market')throw new Error('ZIP! MARKET QR 코드가 아닙니다.');await closeModal(false);
      if(payload.type==='payment'){showPaymentConfirm(Number(payload.amount));return;}if(payload.type==='game'){const data=await api('/participant/complete-game',{method:'POST',body:{gameId:payload.gameId}});renderParticipant(data);toast('게임 완료가 저장되었습니다.');showParticipantPage('games');return;}throw new Error('지원하지 않는 QR 코드입니다.');
    }catch(error){toast(errorMessage(error),true);}
  }
  async function showQr(payload,title,description){try{const QRCode=await loadQrLibrary('display');$('#qr-display-title').textContent=title;$('#qr-display-description').textContent=description;const output=$('#qr-output');output.innerHTML='';new QRCode(output,{text:JSON.stringify(payload),width:256,height:256,colorDark:'#172233',colorLight:'#ffffff',correctLevel:window.QRCode?.CorrectLevel?.H});openModal('qr-display-modal');}catch(error){toast(errorMessage(error),true);}}

  $('#participant-login-form').addEventListener('submit',participantLogin);$('#admin-login-form').addEventListener('submit',adminLogin);$('#open-admin-login').addEventListener('click',()=>openModal('admin-login-modal'));
  $$('.logout').forEach(b=>b.addEventListener('click',logout));$$('[data-close-modal]').forEach(b=>b.addEventListener('click',()=>closeModal()));$$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal();}));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.modal)closeModal();});
  $$('[data-go]').forEach(b=>b.addEventListener('click',()=>showParticipantPage(b.dataset.go)));$$('[data-back]').forEach(b=>b.addEventListener('click',()=>history.back()));
  $('#history-toggle').addEventListener('click',()=>{state.historyExpanded=!state.historyExpanded;renderTransactions();});
  $$('.payment-option').forEach(b=>b.addEventListener('click',()=>showPaymentConfirm(Number(b.dataset.amount))));
  $('#payment-confirm').addEventListener('click',async e=>{const amount=state.pendingAmount;setBusy(e.currentTarget,true,'결제 중…');try{await pay(amount,`${amount}C 결제`);await closeModal();showParticipantPage('home');}catch(error){toast(errorMessage(error),true);}finally{setBusy(e.currentTarget,false);}});
  $('#open-scanner').addEventListener('click',()=>openModal('scanner-modal'));$('#camera-start').addEventListener('click',startScanner);$('#qr-file').addEventListener('change',e=>{if(e.target.files?.[0])scanFile(e.target.files[0]);e.target.value='';});
  $$('[data-admin-tab]').forEach(b=>b.addEventListener('click',()=>switchAdminTab(b.dataset.adminTab)));

  $('#participant-create-form')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const formElement=event.currentTarget;
    if(!(formElement instanceof HTMLFormElement)){toast('참가자 등록 폼을 찾을 수 없습니다. 새로고침해 주세요.',true);return;}
    const button=$('button[type=submit]',formElement),form=new FormData(formElement);
    setBusy(button,true);
    try{
      await api('/admin/participants',{method:'POST',body:{employeeNo:String(form.get('employeeNo')||'').trim(),name:String(form.get('name')||'').trim(),password:String(form.get('password')||''),initialCredit:Number(form.get('initialCredit')||0)}});
      resetFormSafely(formElement,'[name="employeeNo"]');
      await loadAdmin();
      toast('참가자를 등록했습니다.');
    }catch(error){toast(errorMessage(error),true);}finally{setBusy(button,false);}
  });
  $('#participant-bulk-form')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const formElement=event.currentTarget;
    if(!(formElement instanceof HTMLFormElement)){toast('Excel 등록 폼을 찾을 수 없습니다. 새로고침해 주세요.',true);return;}
    const button=$('button[type=submit]',formElement),form=new FormData(formElement);
    const {participants,errors}=parseBulkParticipants(form.get('bulk'));
    if(errors.length){toast(errors.slice(0,3).join(' / '),true);return;}
    setBusy(button,true);
    try{
      const result=await api('/admin/participants/bulk',{method:'POST',body:{participants}});
      resetFormSafely(formElement,'textarea[name="bulk"]');
      await loadAdmin();
      toast(`${Number(result.createdCount||participants.length)}명을 모두 등록했습니다.`);
    }catch(error){toast(errorMessage(error),true);}finally{setBusy(button,false);}
  });
  $('#participant-search-button').addEventListener('click',()=>loadAdmin($('#participant-search').value.trim()).catch(e=>toast(errorMessage(e),true)));$('#participant-search').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#participant-search-button').click();}});$('#participant-search-reset').addEventListener('click',()=>{$('#participant-search').value='';loadAdmin().catch(e=>toast(errorMessage(e),true));});
  $('#admin-participants').addEventListener('click',async e=>{const grant=e.target.closest('.grant-credit'),del=e.target.closest('.delete-participant');try{if(grant){setBusy(grant,true);await api(`/admin/participants/${grant.dataset.id}/credit`,{method:'POST',body:{amount:100}});await loadAdmin();toast('100 C를 지급했습니다.');}if(del&&confirm(`${del.dataset.name} 참가자와 관련 내역을 모두 삭제할까요?`)){setBusy(del,true,'삭제 중…');await api(`/admin/participants/${del.dataset.id}`,{method:'DELETE'});await loadAdmin();toast('참가자를 삭제했습니다.');}}catch(error){toast(errorMessage(error),true);if(grant)setBusy(grant,false);if(del)setBusy(del,false);}});
  $('#payment-qr-form').addEventListener('submit',e=>{e.preventDefault();const form=new FormData(e.currentTarget),amount=Number(form.get('amount')),description=String(form.get('description')||`${amount}C 결제`);showQr({app:'zip-market',v:1,type:'payment',amount,description},`${amount} C 결제 QR`,description);});
  $('#game-create-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('button[type=submit]',e.currentTarget),form=new FormData(e.currentTarget);setBusy(button,true);try{await api('/admin/games',{method:'POST',body:{name:form.get('name'),imageUrl:form.get('imageUrl')}});e.currentTarget.reset();await loadAdmin();toast('게임을 추가했습니다.');}catch(error){toast(errorMessage(error),true);}finally{setBusy(button,false);}});
  $('#admin-games').addEventListener('click',async e=>{const qr=e.target.closest('.game-qr'),del=e.target.closest('.delete-game');try{if(qr)showQr({app:'zip-market',v:1,type:'game',gameId:qr.dataset.id},`${qr.dataset.name} 완료 QR`,'참가자가 스캔하면 게임 완료로 기록됩니다.');if(del&&confirm(`${del.dataset.name} 게임과 참가자 완료 기록을 삭제할까요?`)){setBusy(del,true,'삭제 중…');await api(`/admin/games/${del.dataset.id}`,{method:'DELETE'});await loadAdmin();toast('게임을 삭제했습니다.');}}catch(error){toast(errorMessage(error),true);if(del)setBusy(del,false);}});
  $('#admin-password-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('button[type=submit]',e.currentTarget),form=new FormData(e.currentTarget),password=String(form.get('password')),confirmPassword=String(form.get('confirmPassword'));if(password!==confirmPassword){toast('새 비밀번호가 서로 다릅니다.',true);return;}setBusy(button,true);try{await api('/admin/password',{method:'POST',body:{password}});e.currentTarget.reset();toast('관리자 비밀번호를 변경했습니다.');}catch(error){toast(errorMessage(error),true);}finally{setBusy(button,false);}});

  async function restoreSession(){initializeHistory();if(!state.token||!state.role){showView('login');return;}try{if(state.role==='participant')await loadParticipant();else if(state.role==='admin'){showView('admin');await loadAdmin();}else throw new Error('invalid role');}catch{clearSession();showView('login');}}
  restoreSession(); console.info(`ZIP! MARKET v${VERSION}`);
})();
