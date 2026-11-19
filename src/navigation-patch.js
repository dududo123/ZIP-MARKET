/* ZIP! MARKET mobile navigation patch v5.0
 * Merge this into src/app.js or import it at the end of app.js.
 * Assumes existing IDs: payModal, scanModal, adminModal, cancelPay, payAmount
 * and existing helper $ plus .view sections.
 */
let zipCurrentView = document.querySelector('.view.on')?.id || 'login';
const zip$ = id => document.getElementById(id);
const zipViews = () => Array.from(document.querySelectorAll('.view'));

function zipHistory(state, replace=false){
  history[replace ? 'replaceState' : 'pushState'](
    state,
    '',
    location.pathname + location.search + (state.view && state.view !== 'login' ? '#' + state.view : '')
  );
}
function zipShowView(id, push=true){
  zipCurrentView=id;
  zipViews().forEach(v=>v.classList.remove('on'));
  zip$(id)?.classList.add('on');
  zip$('nav')?.classList.toggle('show', id==='pay'||id==='game');
  if(zip$('logout')) zip$('logout').hidden=id==='login';
  if(push) zipHistory({view:id});
}
function zipClosePay(){
  zip$('payModal')?.classList.remove('open');
  if(typeof pending !== 'undefined') pending=0;
}
function zipOpenPayHistory(amount){
  if(typeof pending !== 'undefined') pending=Number(amount);
  if(zip$('payAmount')) zip$('payAmount').textContent=amount;
  zip$('payModal')?.classList.add('open');
  zipHistory({view:zipCurrentView, modal:'pay'});
}

// Ensure there is a safe app state at the current history entry.
if(!history.state?.view) zipHistory({view:zipCurrentView}, true);

// Cancel payment explicitly.
zip$('cancelPay')?.addEventListener('click',()=>history.back());

// Tapping dimmed area outside the payment sheet = cancel.
zip$('payModal')?.addEventListener('click',e=>{
  if(e.target===zip$('payModal')) history.back();
});

// Mobile hardware/browser Back unwinds the in-app state first.
window.addEventListener('popstate', async e=>{
  const state=e.state;
  if(zip$('payModal')?.classList.contains('open')) zipClosePay();
  if(zip$('scanModal')?.classList.contains('open')){
    try{ if(typeof stopScan==='function') await stopScan(); }
    catch{}
    zip$('scanModal')?.classList.remove('open');
  }
  zip$('adminModal')?.classList.remove('open');

  // A null state would normally leave the site. Replace it with the current app screen.
  if(!state?.view){
    zipHistory({view:zipCurrentView || 'login'}, true);
    return;
  }
  zipShowView(state.view,false);
  if(state.modal==='pay') zip$('payModal')?.classList.add('open');
});

window.ZIPNavigation={showView:zipShowView,openPay:zipOpenPayHistory,closePay:zipClosePay};
