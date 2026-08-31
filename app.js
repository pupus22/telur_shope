import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFirestore, collection, doc, getDocs, getDoc, setDoc, writeBatch, runTransaction } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import {
  APP_VERSION, SCHEMA_VERSION, text, num, isCancelled, safeDateOnly, fileEndDate, compareSourceDate,
  normalizeIncome, normalizeOrder, normalizeBatch, recordsFromMaps, buildPayoutItemMap,
  buildCorrectionAppliedMap, buildCorrectionPlan, historicalEstimate
} from './core.js';

const FIREBASE_CONFIG={
  apiKey:'AIzaSyDYc-6mcJK4NgMfjFL4Xyew2hSixYv51As',
  authDomain:'shopee-payout-b62c3.firebaseapp.com',
  projectId:'shopee-payout-b62c3',
  storageBucket:'shopee-payout-b62c3.firebasestorage.app',
  messagingSenderId:'472652935238',
  appId:'1:472652935238:web:d49c26f38b471c5e69da47'
};
const ADMIN_UID='ISAloBhuHVQwGKzwVLpOXKMcstn2';
const C={orders:'orders',incomes:'incomes',batches:'batches',uploads:'uploads',ledger:'correction_ledger'};
const firebaseApp=initializeApp(FIREBASE_CONFIG), auth=getAuth(firebaseApp), db=getFirestore(firebaseApp);

const state={
  rawOrders:new Map(), rawIncomes:new Map(), orders:new Map(), incomes:new Map(), batches:[], uploads:[], ledger:new Map(), records:[],
  selectedPending:new Set(), selectedReady:new Set(), reportProducts:new Set(), pendingProducts:new Set(), readyProducts:new Set(), editingEstimate:null,
  busy:false
};
const $=id=>document.getElementById(id);
const $$=sel=>[...document.querySelectorAll(sel)];
const money=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(n)||0);
const dt=iso=>iso?new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(iso)):'-';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nowIso=()=>new Date().toISOString();
const today=()=>new Date().toISOString().slice(0,10);
const id=prefix=>`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;

function setMessage(target,msg,type='info'){
  const el=typeof target==='string'?$(target):target;if(!el)return;
  el.className=`message ${type}`;el.innerHTML=msg;
}
function flash(msg,type='info'){
  const el=$('globalMessage');el.hidden=false;el.textContent=msg;
  el.style.background=type==='error'?'#8f1d18':type==='success'?'#0b6b42':'#162033';
  clearTimeout(flash.t);flash.t=setTimeout(()=>{el.hidden=true;},4500);
}
function assertAdmin(){if(!auth.currentUser||auth.currentUser.uid!==ADMIN_UID)throw new Error('Akun tidak diizinkan.');}
function productsHtml(order){
  if(!order?.items?.length)return '<span class="muted">Order belum tersedia</span>';
  return `<div class="product-lines">${order.items.map(x=>`<b>${esc(x.product||'-')}</b><span>${esc(x.variation||'-')}${Number(x.quantity)?` · x${Number(x.quantity)}`:''}</span>`).join('')}</div>`;
}
function productNames(order){return [...new Set((order?.items||[]).map(x=>text(x.product)).filter(Boolean))];}
function orderMatchesProducts(order,selected){if(!selected.size)return true;return productNames(order).some(p=>selected.has(p));}
function stateBadge(r){
  const map={
    pendingEstimated:['estimate','Pending · Estimasi'],pendingUnestimated:['held','Pending · Belum Estimasi'],readyFinal:['final','Siap · Final Excel'],
    paidEstimateAwaitingFinal:['done','Dicairkan Estimasi · Menunggu Final'],paidFinalKnown:['done','Sudah Dicairkan'],cancelled:['cancelled','Batal'],
    cancelledWithIncome:['held','Batal + Income · Ditahan'],incomeOnly:['held','Income tanpa Order · Ditahan'],orderStatusUnknown:['held','Status Order Kosong · Ditahan'],incomeNonPositive:['held','Income ≤ Rp0 · Ditahan']
  };
  const [c,l]=map[r.state]||['held',r.state];return `<span class="badge ${c}">${esc(l)}</span>`;
}
function reportCategory(r){
  if(r.state.startsWith('pending'))return 'pending';
  if(r.state==='readyFinal')return 'readyFinal';
  if(r.state.startsWith('paid'))return 'paid';
  if(r.state==='cancelled')return 'cancelled';
  if(r.state==='cancelledWithIncome'||r.state==='incomeOnly'||r.state==='orderStatusUnknown'||r.state==='incomeNonPositive')return 'held';return 'other';
}
function sourceLabel(est){if(!est)return '-';return est.source==='html'?'HTML Shopee':est.source==='manual'?'Manual':'Estimasi';}
function activeBatchItems(){return state.batches.filter(b=>b.status==='active').flatMap(b=>(b.items||[]).map(i=>({...i,batchId:b.batchId,batchCreatedAt:b.createdAt})));}
function currentPayoutMap(){return buildPayoutItemMap(state.batches);}
function currentAppliedMap(){return buildCorrectionAppliedMap(state.batches,state.orders,state.incomes);}
function duplicatePayoutSet(){return new Set(duplicatePayoutOrders().map(x=>x.orderNo));}
function correctionEligibleRecords(){const dup=duplicatePayoutSet();return state.records.filter(r=>!dup.has(r.orderNo));}
function correctionBalance(){return correctionEligibleRecords().filter(r=>r.state==='paidFinalKnown').reduce((s,r)=>s+Math.round(r.remainingCorrection||0),0);}

async function readCollection(name){assertAdmin();const snap=await getDocs(collection(db,name));return snap.docs.map(d=>({id:d.id,...d.data()}));}
async function loadAll({syncLedger=true}={}){
  assertAdmin();
  const [ro,ri,rb,ru,rl]=await Promise.all([readCollection(C.orders),readCollection(C.incomes),readCollection(C.batches),readCollection(C.uploads),readCollection(C.ledger)]);
  state.rawOrders=new Map(ro.map(x=>[x.orderNo||x.id,x]));
  state.rawIncomes=new Map(ri.map(x=>[x.orderNo||x.id,x]));
  state.incomes=new Map([...state.rawIncomes].map(([k,v])=>[k,normalizeIncome(v,k)]));
  state.orders=new Map([...state.rawOrders].map(([k,v])=>[k,normalizeOrder(v,k,state.incomes.has(k))]));
  state.batches=rb.map(x=>normalizeBatch(x,x.batchId||x.id)).sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
  state.uploads=ru.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  state.ledger=new Map(rl.map(x=>[x.orderNo||x.id,{...x,orderNo:x.orderNo||x.id,appliedAmount:Number(x.appliedAmount)||0}]));
  state.records=recordsFromMaps(state.orders,state.incomes,state.batches);
  await cleanupFinalAndCancelledEstimates();
  renderAll();
}
async function ledgerNeedsSync(){
  const derived=currentAppliedMap();const keys=new Set([...derived.keys(),...state.ledger.keys()]);
  for(const k of keys)if(Math.round(derived.get(k)||0)!==Math.round(state.ledger.get(k)?.appliedAmount||0))return true;
  return false;
}
async function cleanupFinalAndCancelledEstimates(){
  const updates=[];
  for(const [orderNo,raw] of state.rawOrders){
    const hasIncome=state.incomes.has(orderNo),cancelled=isCancelled(raw.status);if(!hasIncome&&!cancelled)continue;
    const normalized=normalizeOrder(raw,orderNo,hasIncome);const hasActiveRaw=raw.pendingEstimate!=null||Number(raw.shopeePendingAmount)>0;
    if(!hasActiveRaw)continue;
    const data={pendingEstimate:null,shopeePendingAmount:0,shopeePendingStatus:'',shopeePendingReleaseEstimate:'',shopeePendingPaymentMethod:'',shopeePendingSourceFile:'',schemaVersion:SCHEMA_VERSION};if(!raw.lastEstimate&&normalized.lastEstimate)data.lastEstimate=normalized.lastEstimate;updates.push({orderNo,data});
  }
  for(let i=0;i<updates.length;i+=350){const wb=writeBatch(db);updates.slice(i,i+350).forEach(x=>wb.set(doc(db,C.orders,x.orderNo),x.data,{merge:true}));await wb.commit();}
  return updates.length;
}
async function syncCorrectionLedger(show=true){
  assertAdmin();const derived=currentAppliedMap(),keys=new Set([...derived.keys(),...state.ledger.keys()]);
  const arr=[...keys];for(let i=0;i<arr.length;i+=400){const wb=writeBatch(db);for(const orderNo of arr.slice(i,i+400))wb.set(doc(db,C.ledger,orderNo),{orderNo,appliedAmount:Number(derived.get(orderNo)||0),updatedAt:nowIso(),schemaVersion:SCHEMA_VERSION},{merge:true});await wb.commit();}
  state.ledger=new Map([...keys].map(k=>[k,{orderNo:k,appliedAmount:Number(derived.get(k)||0)}]));
  if(show)flash('Ledger koreksi sudah disinkronkan dari riwayat Batch.','success');
}

function allProducts(records){return [...new Set(records.flatMap(r=>productNames(r.order)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'id'));}
function renderProductPicker(containerId,records,selected,onChange){
  const el=$(containerId);if(!el)return;const products=allProducts(records);
  const allowed=new Set(products);for(const x of [...selected])if(!allowed.has(x))selected.delete(x);
  el.innerHTML=`<div class="product-picker-head"><strong>Filter Produk <span class="muted">· kosong = semua</span></strong><div><button class="btn ghost picker-none" type="button">Kosongkan</button></div></div><div class="product-checks">${products.map(p=>`<label><input type="checkbox" value="${esc(p)}" ${selected.has(p)?'checked':''}>${esc(p)}</label>`).join('')||'<span class="muted">Belum ada produk.</span>'}</div>`;
  el.querySelectorAll('input[type=checkbox]').forEach(c=>c.addEventListener('change',()=>{c.checked?selected.add(c.value):selected.delete(c.value);onChange();}));
  el.querySelector('.picker-none')?.addEventListener('click',()=>{selected.clear();onChange();});
}

function renderDashboard(){
  const orderCount=state.orders.size,incomes=[...state.incomes.values()],pending=state.records.filter(r=>r.state==='pendingEstimated'||r.state==='pendingUnestimated'||r.state==='paidEstimateAwaitingFinal');
  const ready=state.records.filter(r=>r.state==='readyFinal');const payouts=activeBatchItems();
  $('kpiOrders').textContent=orderCount;$('kpiIncome').textContent=money(incomes.reduce((s,x)=>s+x.amount,0));$('kpiIncomeCount').textContent=`${incomes.length} pesanan`;
  $('kpiPending').textContent=pending.length;$('kpiEstimated').textContent=`${pending.filter(r=>r.state==='pendingEstimated'||r.state==='paidEstimateAwaitingFinal').length} sudah estimasi`;
  $('kpiReady').textContent=money(ready.reduce((s,r)=>s+r.income.amount,0));$('kpiReadyCount').textContent=`${ready.length} pesanan final`;
  const cashPaid=state.batches.filter(b=>b.status==='active').reduce((s,b)=>s+(Number(b.payoutAmount)||Number(b.baseAmount)+Number(b.correctionAmount)||0),0);$('kpiPaid').textContent=money(cashPaid);$('kpiPaidCount').textContent=`${payouts.length} pesanan dalam batch`;$('kpiCorrection').textContent=money(correctionBalance());
  const incomeOnly=state.records.filter(r=>r.state==='incomeOnly').length,cancelInc=state.records.filter(r=>r.state==='cancelledWithIncome').length,unknown=state.records.filter(r=>r.state==='orderStatusUnknown'||r.state==='incomeNonPositive').length;
  const dup=duplicatePayoutOrders().length,changedPaid=state.records.filter(r=>r.paidBatchId&&r.income&&r.originalCorrection!==0).length;
  $('riskSummary').innerHTML=`<div><span>Income tanpa Order</span><strong>${incomeOnly}</strong></div><div><span>Pesanan Batal + Income</span><strong>${cancelInc}</strong></div><div><span>Status/Income tidak valid</span><strong>${unknown}</strong></div><div><span>Order tercatat >1 Batch</span><strong>${dup}</strong></div><div><span>Pencairan berbeda dari Final terkini</span><strong>${changedPaid}</strong></div>`;
  const u=state.uploads[0];$('latestUpload').innerHTML=u?`<b>${esc(u.kind||'Import')}</b> · ${esc(u.fileName||u.files||'-')}<br><span class="muted">${esc(dt(u.createdAt))} · ${esc(u.summary||'')}</span>`:'Belum ada log upload.';
}
function duplicatePayoutOrders(){const c=new Map();for(const i of activeBatchItems())c.set(i.orderNo,(c.get(i.orderNo)||0)+1);return [...c].filter(([,n])=>n>1).map(([orderNo,count])=>({orderNo,count}));}
function renderUploads(){
  $('uploadHistoryBody').innerHTML=state.uploads.length?state.uploads.slice(0,100).map(u=>`<tr><td>${esc(dt(u.createdAt))}</td><td>${esc(u.kind||'-')}</td><td>${esc(u.fileName||u.files||'-')}</td><td>${esc(u.rows??'-')}</td><td>${esc(u.summary||'-')}</td></tr>`).join(''):'<tr><td colspan="5" class="muted">Belum ada import.</td></tr>';
}
function reportBaseFilteredRecords(){
  const from=$('reportFrom').value,to=$('reportTo').value,q=text($('reportSearch').value).toLowerCase(),cat=$('reportState').value;
  return state.records.filter(r=>{
    const d=r.order?.orderDate||r.income?.orderDate||'';if(from&&d<from)return false;if(to&&d>to)return false;if(cat!=='all'&&reportCategory(r)!==cat)return false;
    const hay=[r.orderNo,r.order?.status,...productNames(r.order)].join(' ').toLowerCase();if(q&&!hay.includes(q))return false;return true;
  });
}
function filteredReport(){
  return reportBaseFilteredRecords().filter(r=>orderMatchesProducts(r.order,state.reportProducts))
    .sort((a,b)=>String(b.order?.orderDate||b.income?.orderDate||'').localeCompare(String(a.order?.orderDate||a.income?.orderDate||''))||b.orderNo.localeCompare(a.orderNo));
}
function estimateForReport(r){return r.activeEstimate||historicalEstimate(r.order)||null;}
function renderReport(){
  const productScope=reportBaseFilteredRecords();renderProductPicker('reportProductPicker',productScope,state.reportProducts,renderReport);
  const rows=filteredReport();$('reportCount').textContent=rows.length;
  const activeEstimateTotal=rows.reduce((s,r)=>s+(!r.income?(r.activeEstimate?.amount||0):0),0);
  const finalTotal=rows.reduce((s,r)=>s+(r.income?.amount||0),0);
  // Total nilai berjalan: keberadaan Income Excel selalu menang, termasuk bila nominalnya 0/ditahan.
  const combinedTotal=rows.reduce((s,r)=>s+(r.income?Number(r.income.amount||0):Number(r.activeEstimate?.amount||0)),0);
  $('reportEstimateTotal').textContent=money(activeEstimateTotal);
  $('reportFinalTotal').textContent=money(finalTotal);
  $('reportCombinedTotal').textContent=money(combinedTotal);
  $('reportPaidTotal').textContent=money(rows.reduce((s,r)=>s+(r.paidSnapshot||0),0));$('reportCorrectionTotal').textContent=money(rows.reduce((s,r)=>s+(r.remainingCorrection||0),0));
  $('reportBody').innerHTML=rows.length?rows.map(r=>{
    const est=estimateForReport(r),payout=r.paidBatchId?`${money(r.paidSnapshot)}<br><span class="muted">${esc(r.paidBatchId)}</span>`:'-';
    const corr=r.paidBatchId&&r.income?`<b class="${r.remainingCorrection>0?'money-positive':r.remainingCorrection<0?'money-negative':''}">${r.remainingCorrection>0?'+':''}${money(r.remainingCorrection)}</b>`:'-';
    return `<tr><td><b>${esc(r.orderNo)}</b><br><span class="muted">${esc(r.order?.orderDate||r.income?.orderDate||'-')}</span></td><td>${productsHtml(r.order)}</td><td>${esc(r.order?.status||'-')}</td><td>${est?`<b>${money(est.amount)}</b><br><span class="badge estimate">${esc(sourceLabel(est))}</span>`:'-'}</td><td class="num">${r.income?`<b>${money(r.income.amount)}</b><br><span class="muted">${esc(r.income.releaseDate||'-')}</span>`:'-'}</td><td>${payout}</td><td class="num">${corr}</td><td>${stateBadge(r)}</td></tr>`;
  }).join(''):'<tr><td colspan="8" class="muted">Tidak ada data.</td></tr>';
}

function pendingRecords(){return state.records.filter(r=>r.state==='pendingEstimated'||r.state==='pendingUnestimated'||r.state==='paidEstimateAwaitingFinal');}
function filteredPending(){
  const from=$('pendingFrom').value,to=$('pendingTo').value,q=text($('pendingSearch').value).toLowerCase();
  return pendingRecords().filter(r=>{const d=r.order?.orderDate||'';if(from&&d<from)return false;if(to&&d>to)return false;if(q&&!([r.orderNo,...productNames(r.order),r.order?.status].join(' ').toLowerCase().includes(q)))return false;if(!orderMatchesProducts(r.order,state.pendingProducts))return false;return true;}).sort((a,b)=>String(b.order?.orderDate||'').localeCompare(String(a.order?.orderDate||''))||b.orderNo.localeCompare(a.orderNo));
}
function pendingEstimateDisplay(r){
  if(r.state==='paidEstimateAwaitingFinal')return {amount:r.paidSnapshot||r.order?.payoutLock?.amount||0,source:r.order?.payoutLock?.estimateSource||'estimate',locked:true};
  if(r.activeEstimate)return {amount:r.activeEstimate.amount,source:r.activeEstimate.source,locked:false};return null;
}
function renderPending(){
  const all=pendingRecords(),rows=filteredPending();renderProductPicker('pendingProductPicker',all,state.pendingProducts,renderPending);
  $('pendingCount').textContent=all.length;$('pendingEstimatedCount').textContent=all.filter(r=>r.state==='pendingEstimated'||r.state==='paidEstimateAwaitingFinal').length;$('pendingNoEstimateCount').textContent=all.filter(r=>r.state==='pendingUnestimated').length;
  $('pendingEstimateTotal').textContent=money(all.filter(r=>r.state==='pendingEstimated').reduce((s,r)=>s+(r.activeEstimate?.amount||0),0));
  const eligible=new Set(rows.filter(r=>r.state==='pendingEstimated').map(r=>r.orderNo));state.selectedPending=new Set([...state.selectedPending].filter(x=>eligible.has(x)));
  $('pendingBody').innerHTML=rows.length?rows.map(r=>{const e=pendingEstimateDisplay(r),selectable=r.state==='pendingEstimated';return `<tr><td>${selectable?`<input class="pending-check" type="checkbox" data-id="${esc(r.orderNo)}" ${state.selectedPending.has(r.orderNo)?'checked':''}>`:''}</td><td><b>${esc(r.orderNo)}</b></td><td>${productsHtml(r.order)}</td><td>${r.state==='paidEstimateAwaitingFinal'?`<span class="badge done">Sudah Dicairkan Estimasi</span><br><span class="muted">${esc(r.paidBatchId||'')}</span>`:`<span class="badge ${e?'estimate':'held'}">${e?'Sudah Estimasi':'Belum Estimasi'}</span>`}</td><td>${esc(r.order?.orderDate||'-')}</td><td class="num">${e?`<b>${money(e.amount)}</b>`:'-'}</td><td>${e?`<span class="badge estimate">${esc(e.source==='html'?'HTML Shopee':e.source==='manual'?'Manual':e.source)}</span>`:'-'}</td><td><button class="btn ghost edit-estimate" type="button" data-id="${esc(r.orderNo)}" ${r.state==='paidEstimateAwaitingFinal'?'disabled':''}>Edit Manual</button></td></tr>`;}).join(''):'<tr><td colspan="8" class="muted">Tidak ada Pending.</td></tr>';
  $$('.pending-check').forEach(c=>c.addEventListener('change',()=>{c.checked?state.selectedPending.add(c.dataset.id):state.selectedPending.delete(c.dataset.id);updatePendingSelection(rows);}));
  $$('.edit-estimate').forEach(b=>b.addEventListener('click',()=>openEstimateDialog(b.dataset.id)));
  const allVisibleEligible=rows.filter(r=>r.state==='pendingEstimated');$('pendingSelectAll').checked=allVisibleEligible.length>0&&allVisibleEligible.every(r=>state.selectedPending.has(r.orderNo));updatePendingSelection(rows);
}
function updatePendingSelection(rows=filteredPending()){
  const selected=rows.filter(r=>state.selectedPending.has(r.orderNo)&&r.state==='pendingEstimated');const total=selected.reduce((s,r)=>s+(r.activeEstimate?.amount||0),0);$('pendingSelectedCount').textContent=`${selected.length} dipilih`;$('pendingSelectedTotal').textContent=`${money(total)} estimasi`;$('createEstimateBatchBtn').disabled=!selected.length;
}

function cancelledRecords(){return state.records.filter(r=>r.state==='cancelled'||r.state==='cancelledWithIncome');}
function renderCancelled(){const rows=cancelledRecords().sort((a,b)=>String(b.order?.orderDate||'').localeCompare(String(a.order?.orderDate||'')));$('cancelledCount').textContent=rows.length;$('cancelledIncomeCount').textContent=rows.filter(r=>r.income).length;$('cancelledBody').innerHTML=rows.length?rows.map(r=>`<tr><td><b>${esc(r.orderNo)}</b></td><td>${productsHtml(r.order)}</td><td>${esc(r.order?.cancelReason||'-')}</td><td class="num">${r.income?money(r.income.amount):'-'}</td><td>${stateBadge(r)}</td></tr>`).join(''):'<tr><td colspan="5" class="muted">Tidak ada pesanan batal.</td></tr>';}

function readyRecords(){return state.records.filter(r=>r.state==='readyFinal');}
function filteredReady(){const from=$('readyFrom').value,to=$('readyTo').value,q=text($('readySearch').value).toLowerCase();return readyRecords().filter(r=>{const d=r.order?.orderDate||r.income?.orderDate||'';if(from&&d<from)return false;if(to&&d>to)return false;if(q&&!([r.orderNo,...productNames(r.order),r.order?.status].join(' ').toLowerCase().includes(q)))return false;if(!orderMatchesProducts(r.order,state.readyProducts))return false;return true;}).sort((a,b)=>String(b.order?.orderDate||'').localeCompare(String(a.order?.orderDate||''))||b.orderNo.localeCompare(a.orderNo));}
function renderReady(){
  const all=readyRecords(),rows=filteredReady();renderProductPicker('readyProductPicker',all,state.readyProducts,renderReady);const totalAll=all.reduce((s,r)=>s+r.income.amount,0);$('readyCount').textContent=all.length;$('readyTotal').textContent=money(totalAll);$('readyCorrection').textContent=money(correctionBalance());
  const eligible=new Set(rows.map(r=>r.orderNo));state.selectedReady=new Set([...state.selectedReady].filter(x=>eligible.has(x)));
  $('readyBody').innerHTML=rows.length?rows.map(r=>`<tr><td><input class="ready-check" type="checkbox" data-id="${esc(r.orderNo)}" ${state.selectedReady.has(r.orderNo)?'checked':''}></td><td><b>${esc(r.orderNo)}</b></td><td>${productsHtml(r.order)}</td><td>${esc(r.order?.status||'-')}</td><td>${esc(r.order?.orderDate||r.income?.orderDate||'-')}</td><td>${esc(r.income?.releaseDate||'-')}</td><td class="num"><b>${money(r.income.amount)}</b></td><td><span class="badge final">Final Income Excel</span></td></tr>`).join(''):'<tr><td colspan="8" class="muted">Tidak ada pembayaran final yang siap dicairkan.</td></tr>';
  $$('.ready-check').forEach(c=>c.addEventListener('change',()=>{c.checked?state.selectedReady.add(c.dataset.id):state.selectedReady.delete(c.dataset.id);updateReadySelection(rows);}));const allVisible=rows;$('readySelectAll').checked=allVisible.length>0&&allVisible.every(r=>state.selectedReady.has(r.orderNo));updateReadySelection(rows);
}
function updateReadySelection(rows=filteredReady()){
  const selected=rows.filter(r=>state.selectedReady.has(r.orderNo));const base=selected.reduce((s,r)=>s+r.income.amount,0),plan=buildCorrectionPlan(correctionEligibleRecords(),base);$('readySelectedCount').textContent=`${selected.length} dipilih`;$('readySelectedTotal').textContent=`${money(base)} final`;$('readyPayoutPreview').textContent=money(plan.payoutAmount);$('createFinalBatchBtn').disabled=!selected.length;
}

function renderHistory(){const rows=[...state.batches].reverse();$('batchBody').innerHTML=rows.length?rows.map(b=>`<tr><td><b>${esc(b.batchId)}</b></td><td>${esc(dt(b.createdAt))}</td><td><span class="badge ${b.kind==='estimate'?'estimate':'final'}">${esc(b.kind==='estimate'?'Estimasi':b.kind==='mixed'?'Legacy Campuran':'Final')}</span></td><td>${b.items.length}</td><td class="num">${money(b.baseAmount)}</td><td class="num"><b class="${b.correctionAmount>0?'money-positive':b.correctionAmount<0?'money-negative':''}">${b.correctionAmount>0?'+':''}${money(b.correctionAmount)}</b></td><td class="num"><b>${money(b.payoutAmount||b.baseAmount+b.correctionAmount)}</b></td><td><button class="btn ghost batch-detail" data-id="${esc(b.batchId)}" type="button">Detail</button></td></tr>`).join(''):'<tr><td colspan="8" class="muted">Belum ada Batch.</td></tr>';
  $$('.batch-detail').forEach(b=>b.addEventListener('click',()=>openBatchDetail(b.dataset.id)));
}
function renderRecon(){
  const incomes=[...state.incomes.values()],ready=readyRecords(),payouts=activeBatchItems();const cashPaid=state.batches.filter(b=>b.status==='active').reduce((s,b)=>s+(Number(b.payoutAmount)||Number(b.baseAmount)+Number(b.correctionAmount)||0),0);$('reconIncome').textContent=money(incomes.reduce((s,x)=>s+x.amount,0));$('reconReady').textContent=money(ready.reduce((s,r)=>s+r.income.amount,0));$('reconPaid').textContent=money(cashPaid);$('reconCorrection').textContent=money(correctionBalance());
  const corr=state.records.filter(r=>r.income&&r.paidBatchId&&(r.originalCorrection!==0||r.appliedCorrection!==0)).sort((a,b)=>Math.abs(b.remainingCorrection)-Math.abs(a.remainingCorrection));
  $('correctionBody').innerHTML=corr.length?corr.map(r=>`<tr><td><b>${esc(r.orderNo)}</b></td><td>${esc(r.paidBatchId)}</td><td class="num">${money(r.paidSnapshot)}</td><td class="num">${money(r.income.amount)}</td><td class="num"><b class="${r.originalCorrection>0?'money-positive':r.originalCorrection<0?'money-negative':''}">${r.originalCorrection>0?'+':''}${money(r.originalCorrection)}</b></td><td class="num">${r.appliedCorrection>0?'+':''}${money(r.appliedCorrection)}</td><td class="num"><b class="${r.remainingCorrection>0?'money-positive':r.remainingCorrection<0?'money-negative':''}">${r.remainingCorrection>0?'+':''}${money(r.remainingCorrection)}</b></td></tr>`).join(''):'<tr><td colspan="7" class="muted">Belum ada selisih dari pencairan nyata.</td></tr>';
  const held=[];state.records.filter(r=>r.state==='incomeOnly').forEach(r=>held.push({title:`${r.orderNo} · Income tanpa Order`,desc:`Final Income ${money(r.income.amount)} ditahan sampai Master Order tersedia.`}));state.records.filter(r=>r.state==='cancelledWithIncome').forEach(r=>held.push({title:`${r.orderNo} · Pesanan Batal memiliki Income`,desc:`Income ${money(r.income.amount)} tidak masuk Siap Dicairkan.`}));state.records.filter(r=>r.state==='orderStatusUnknown').forEach(r=>held.push({title:`${r.orderNo} · Status Order kosong`,desc:'Order ditahan agar tidak masuk Pending/Siap Dicairkan secara salah.'}));state.records.filter(r=>r.state==='incomeNonPositive').forEach(r=>held.push({title:`${r.orderNo} · Final Income tidak positif`,desc:`Nominal ${money(r.income?.amount||0)} ditahan untuk pemeriksaan.`}));duplicatePayoutOrders().forEach(x=>held.push({title:`${x.orderNo} · Terdapat ${x.count} snapshot Batch`,desc:'Kemungkinan data legacy pernah tercatat lebih dari satu pencairan. Periksa Riwayat Batch.'}));
  $('heldList').innerHTML=held.length?held.map(x=>`<div class="anomaly"><b>${esc(x.title)}</b><span>${esc(x.desc)}</span></div>`).join(''):'<div class="empty-state">Tidak ada data ditahan.</div>';
}
function renderSettings(){$('settingsFirebase').textContent=auth.currentUser?'Terhubung':'Tidak terhubung';}
function renderAll(){state.records=recordsFromMaps(state.orders,state.incomes,state.batches);renderDashboard();renderUploads();renderReport();renderPending();renderCancelled();renderReady();renderHistory();renderRecon();renderSettings();}

function findHeader(rows,required){for(let i=0;i<Math.min(rows.length,30);i++){const hdr=rows[i].map(x=>text(x));if(required.every(r=>hdr.includes(r)))return i;}return -1;}
function rowsAsObjects(rows,headerIndex){const headers=rows[headerIndex].map(x=>text(x));return rows.slice(headerIndex+1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));}
async function workbookRows(file){const ab=await file.arrayBuffer(),wb=XLSX.read(ab,{type:'array',cellDates:true});return {wb,sheets:wb.SheetNames.map(n=>({name:n,rows:XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,defval:'',raw:true})}))};}
function chooseSheet(sheets,required){for(const s of sheets){const hi=findHeader(s.rows,required);if(hi>=0)return {...s,headerIndex:hi};}return null;}

async function importOrderExcel(file){
  const {sheets}=await workbookRows(file),sheet=chooseSheet(sheets,['No. Pesanan','Nama Produk','Status Pesanan']);if(!sheet)throw new Error('Header Order Excel tidak ditemukan. Pastikan file export Order Shopee.');
  const objs=rowsAsObjects(sheet.rows,sheet.headerIndex),groups=new Map();for(const r of objs){const orderNo=text(r['No. Pesanan']);if(!orderNo)continue;if(!groups.has(orderNo))groups.set(orderNo,[]);groups.get(orderNo).push(r);}
  const sourceEnd=fileEndDate(file.name),timestamp=nowIso();let inserted=0,updated=0,stale=0;const payload=[];
  for(const [orderNo,lines] of groups){const old=state.orders.get(orderNo);if(old?.orderSourceEndDate&&sourceEnd&&compareSourceDate(sourceEnd,old.orderSourceEndDate)<0){stale++;continue;}
    const first=lines[0],status=text(first['Status Pesanan']),cancelReason=text(first['Alasan Pembatalan']);const occurrence=new Map();
    const items=lines.map((r,idx)=>{const product=text(r['Nama Produk']),variation=text(r['Nama Variasi']),skuRef=text(r['Nomor Referensi SKU']),sig=`${skuRef}|${product}|${variation}`;occurrence.set(sig,(occurrence.get(sig)||0)+1);return {key:`${sig}|${occurrence.get(sig)}`,product,variation,skuRef,quantity:num(r['Jumlah']),subtotal:num(r['Subtotal Pesanan']),productCount:num(r['Jumlah Produk di Pesan'])};});
    const data={schemaVersion:SCHEMA_VERSION,orderNo,status,cancelReason,orderDate:safeDateOnly(first['Waktu Pesanan Dibuat']),orderDateTime:text(first['Waktu Pesanan Dibuat']),items,orderSourceFile:file.name,orderSourceEndDate:sourceEnd,orderImportedAt:timestamp};
    if(isCancelled(status)){if(old?.pendingEstimate)data.lastEstimate=old.pendingEstimate;data.pendingEstimate=null;data.shopeePendingAmount=0;data.shopeePendingStatus='';data.shopeePendingReleaseEstimate='';data.shopeePendingPaymentMethod='';data.shopeePendingSourceFile='';}
    payload.push({orderNo,data});old?updated++:inserted++;
  }
  for(let i=0;i<payload.length;i+=350){const wb=writeBatch(db);payload.slice(i,i+350).forEach(x=>wb.set(doc(db,C.orders,x.orderNo),x.data,{merge:true}));await wb.commit();}
  await logUpload({kind:'Order Excel',fileName:file.name,rows:groups.size,summary:`${inserted} baru, ${updated} update, ${stale} dilewati karena file lebih lama`});return {rows:groups.size,inserted,updated,stale};
}

async function importIncomeExcel(file){
  const {sheets}=await workbookRows(file),sheet=chooseSheet(sheets,['Lihat berdasarkan','No. Pesanan','Total Penghasilan']);if(!sheet)throw new Error('Sheet Penghasilan / header Income tidak ditemukan.');
  const objs=rowsAsObjects(sheet.rows,sheet.headerIndex),orderRowsRaw=objs.filter(r=>text(r['Lihat berdasarkan']).toLowerCase()==='order'&&text(r['No. Pesanan'])),skuRows=objs.filter(r=>text(r['Lihat berdasarkan']).toLowerCase()==='sku'&&text(r['No. Pesanan']));
  const orderRowMap=new Map();for(const r of orderRowsRaw)orderRowMap.set(text(r['No. Pesanan']),r);const orderRows=[...orderRowMap.values()];
  const skuMap=new Map();for(const r of skuRows){const no=text(r['No. Pesanan']);if(!skuMap.has(no))skuMap.set(no,[]);skuMap.get(no).push({productId:text(r['ID Produk']),product:text(r['Nama Produk']),amount:num(r['Total Penghasilan'])});}
  const sourceEnd=fileEndDate(file.name),timestamp=nowIso();let inserted=0,updated=0,stale=0,cleared=0;const incomePayload=[],orderUpdates=[];
  for(const r of orderRows){const orderNo=text(r['No. Pesanan']),old=state.incomes.get(orderNo);if(old?.incomeSourceEndDate&&sourceEnd&&compareSourceDate(sourceEnd,old.incomeSourceEndDate)<0){stale++;continue;}
    incomePayload.push({orderNo,data:{schemaVersion:SCHEMA_VERSION,orderNo,amount:num(r['Total Penghasilan']),orderDate:safeDateOnly(r['Waktu Pesanan Dibuat']),releaseDate:safeDateOnly(r['Tanggal Dana Dilepaskan']),releaseMethod:text(r['Metode Pelepasan Dana']),paymentMethod:text(r['Metode pembayaran pembeli']),orderType:text(r['Tipe Pesanan']),skuRows:skuMap.get(orderNo)||[],incomeSourceFile:file.name,incomeSourceEndDate:sourceEnd,incomeImportedAt:timestamp}});old?updated++:inserted++;
    const o=state.orders.get(orderNo);if(o){const hist=o.pendingEstimate||(!o.lastEstimate&&o.payoutLock?.source==='estimate'?o.payoutLock.estimateSnapshot:null);const upd={schemaVersion:SCHEMA_VERSION,pendingEstimate:null,shopeePendingAmount:0,shopeePendingStatus:'',shopeePendingReleaseEstimate:'',shopeePendingPaymentMethod:'',shopeePendingSourceFile:''};if(hist)upd.lastEstimate=hist;orderUpdates.push({orderNo,data:upd});if(o.pendingEstimate)cleared++;}
  }
  for(let i=0;i<incomePayload.length;i+=300){const wb=writeBatch(db);incomePayload.slice(i,i+300).forEach(x=>wb.set(doc(db,C.incomes,x.orderNo),x.data,{merge:true}));await wb.commit();}
  for(let i=0;i<orderUpdates.length;i+=300){const wb=writeBatch(db);orderUpdates.slice(i,i+300).forEach(x=>wb.set(doc(db,C.orders,x.orderNo),x.data,{merge:true}));await wb.commit();}
  const duplicates=orderRowsRaw.length-orderRows.length;await logUpload({kind:'Income Excel',fileName:file.name,rows:orderRows.length,summary:`${inserted} baru, ${updated} update, ${cleared} estimasi aktif dibersihkan, ${stale} file lama dilewati${duplicates?`, ${duplicates} duplikat Order digabung`:''}`});return {rows:orderRows.length,inserted,updated,cleared,stale,duplicates};
}
async function logUpload(data){const uploadId=id('UP');await setDoc(doc(db,C.uploads,uploadId),{uploadId,createdAt:nowIso(),schemaVersion:SCHEMA_VERSION,...data});}

async function importPendingHtml(file){
  const raw=await file.text();if(!raw.includes('portal/finance/income')&&!raw.includes('Dana Akan Dilepaskan'))throw new Error('HTML bukan halaman Penghasilan Saya → Pending Shopee.');const parsed=new DOMParser().parseFromString(raw,'text/html');const found=[];
  parsed.querySelectorAll('.grid-table-row').forEach(row=>{const oid=row.querySelector('.order-id'),amt=row.querySelector('.transaction-amount');if(!oid||!amt)return;const m=text(oid.textContent).match(/\b\d{6}[A-Z0-9]{6,}\b/);if(!m)return;const cells=[...row.children];found.push({orderNo:m[0],amount:num(amt.textContent),releaseEstimate:text(cells[1]?.textContent),status:text(cells[2]?.textContent),paymentMethod:text(cells[3]?.textContent)});});
  const uniqueMap=new Map(found.map(x=>[x.orderNo,x]));let matched=0,unmatched=0,skippedFinal=0,skippedLocked=0,cancelled=0;const timestamp=nowIso();
  const candidates=[];for(const x of uniqueMap.values()){const o=state.orders.get(x.orderNo),inc=state.incomes.get(x.orderNo);if(inc){skippedFinal++;continue;}if(!o){unmatched++;continue;}if(isCancelled(o.status)){cancelled++;continue;}if(o.payoutLock){skippedLocked++;continue;}if(x.amount>0)candidates.push(x);}
  if(candidates.length){const result=await runTransaction(db,async tx=>{const snaps=[];for(const x of candidates)snaps.push({x,order:await tx.get(doc(db,C.orders,x.orderNo)),income:await tx.get(doc(db,C.incomes,x.orderNo))});const local={matched:0,unmatched:0,skippedFinal:0,skippedLocked:0,cancelled:0};for(const s of snaps){if(!s.order.exists()){local.unmatched++;continue;}if(s.income.exists()){local.skippedFinal++;continue;}const o=s.order.data();if(isCancelled(o.status)){local.cancelled++;continue;}if(o.payoutLock||o.estimateBatchId){local.skippedLocked++;continue;}tx.set(doc(db,C.orders,s.x.orderNo),{schemaVersion:SCHEMA_VERSION,pendingEstimate:{source:'html',amount:s.x.amount,status:s.x.status,releaseEstimate:s.x.releaseEstimate,paymentMethod:s.x.paymentMethod,updatedAt:timestamp,sourceFile:file.name,items:[]},shopeePendingAmount:0},{merge:true});local.matched++;}return local;});matched+=result.matched;unmatched+=result.unmatched;skippedFinal+=result.skippedFinal;skippedLocked+=result.skippedLocked;cancelled+=result.cancelled;}
  await logUpload({kind:'HTML Pending',fileName:file.name,rows:uniqueMap.size,summary:`${matched} cocok, ${unmatched} tanpa Order, ${skippedFinal} sudah Final Excel, ${skippedLocked} sudah dicairkan estimasi`});
  return {rows:uniqueMap.size,matched,unmatched,skippedFinal,skippedLocked,cancelled,total:[...uniqueMap.values()].reduce((s,x)=>s+x.amount,0)};
}

function openEstimateDialog(orderNo){const r=state.records.find(x=>x.orderNo===orderNo);if(!r||!r.order||r.income||r.order.payoutLock)return;state.editingEstimate=orderNo;$('estimateOrderNo').textContent=orderNo;const current=r.activeEstimate;setMessage('estimateMessage',current?.source==='html'?`Estimasi HTML saat ini <b>${money(current.amount)}</b>. Menyimpan manual akan mengganti estimasi aktif. Upload HTML berikutnya dapat memperbaruinya lagi.`:'Masukkan estimasi per unit. Nilai ini hanya sementara sampai Income Excel muncul.','info');
  const manualItems=current?.source==='manual'&&Array.isArray(current.items)?new Map(current.items.map(x=>[x.key,x])):new Map();$('estimateItemsBody').innerHTML=r.order.items.map((x,i)=>{const old=manualItems.get(x.key)||{},unit=Number(old.unit)||0;return `<tr><td><b>${esc(x.product||'-')}</b><br><span class="muted">${esc(x.variation||'-')}</span></td><td class="num">${Number(x.quantity)||1}</td><td class="num"><input class="estimate-unit" data-index="${i}" data-key="${esc(x.key||String(i))}" data-qty="${Number(x.quantity)||1}" type="number" min="0" step="1" value="${unit||''}" placeholder="0"></td><td class="num"><b class="estimate-subtotal">${money(unit*(Number(x.quantity)||1))}</b></td></tr>`;}).join('');$$('.estimate-unit').forEach(x=>x.addEventListener('input',recalcEstimateDialog));recalcEstimateDialog();$('estimateDialog').showModal();}
function recalcEstimateDialog(){let total=0;$$('.estimate-unit').forEach((x,i)=>{const sub=Math.max(0,Number(x.value)||0)*(Number(x.dataset.qty)||1);total+=sub;document.querySelectorAll('.estimate-subtotal')[i].textContent=money(sub);});$('estimateGrandTotal').textContent=money(total);}
async function saveManualEstimate(){const orderNo=state.editingEstimate;if(!orderNo)return;const inputs=$$('.estimate-unit'),items=inputs.map(x=>({key:x.dataset.key,unit:Math.max(0,Number(x.value)||0),amount:Math.max(0,Number(x.value)||0)*(Number(x.dataset.qty)||1)})),amount=items.reduce((s,x)=>s+x.amount,0),orderRef=doc(db,C.orders,orderNo),incomeRef=doc(db,C.incomes,orderNo),timestamp=nowIso();
  if(amount===0&&!confirm('Total estimasi Rp0. Kosongkan estimasi manual/HTML untuk order ini?'))return;
  try{state.busy=true;await runTransaction(db,async tx=>{const [oSnap,iSnap]=await Promise.all([tx.get(orderRef),tx.get(incomeRef)]);if(!oSnap.exists())throw new Error('Order sudah tidak ada.');if(iSnap.exists())throw new Error('Income final sudah tersedia. Estimasi tidak boleh diedit lagi.');const o=oSnap.data();if(isCancelled(o.status))throw new Error('Pesanan sudah Batal.');if(o.payoutLock||o.estimateBatchId)throw new Error('Order sudah pernah dicairkan.');tx.set(orderRef,{schemaVersion:SCHEMA_VERSION,pendingEstimate:amount?{source:'manual',amount,items,updatedAt:timestamp,sourceFile:''}:null},{merge:true});});$('estimateDialog').close();await loadAll();flash(amount?`Estimasi manual ${orderNo} disimpan ${money(amount)}.`:`Estimasi ${orderNo} dikosongkan.`,'success');}catch(e){setMessage('estimateMessage',esc(e.message),'warning');}finally{state.busy=false;}}

function buildBatchId(kind){const d=new Date(),pad=n=>String(n).padStart(2,'0');return `BATCH-${kind==='estimate'?'EST':'FIN'}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2,5).toUpperCase()}`;}
function selectedPendingRecords(){return filteredPending().filter(r=>state.selectedPending.has(r.orderNo)&&r.state==='pendingEstimated');}
function selectedReadyRecords(){return filteredReady().filter(r=>state.selectedReady.has(r.orderNo));}
function snapshotProducts(order){return (order?.items||[]).map(x=>({product:x.product||'',variation:x.variation||'',quantity:Number(x.quantity)||0,skuRef:x.skuRef||''}));}
async function createBatch(kind){
  if(state.busy)return;const rows=kind==='estimate'?selectedPendingRecords():selectedReadyRecords();if(!rows.length)return;const base=rows.reduce((s,r)=>s+(kind==='estimate'?r.activeEstimate.amount:r.income.amount),0),plan=buildCorrectionPlan(correctionEligibleRecords(),base),batchId=buildBatchId(kind),createdAt=nowIso();
  const note=`Dasar ${money(base)} ${plan.correctionAmount?`+ koreksi ${plan.correctionAmount>0?'+':''}${money(plan.correctionAmount)}`:''} = pencairan ${money(plan.payoutAmount)}.`;if(!confirm(`${kind==='estimate'?'Buat Batch Estimasi':'Buat Batch Final'} ${batchId}?\n\n${note}\n\nBatch adalah snapshot permanen.`))return;
  const orderRefs=rows.map(r=>doc(db,C.orders,r.orderNo)),incomeRefs=rows.map(r=>doc(db,C.incomes,r.orderNo));const corrRefs=plan.applications.map(a=>({ledger:doc(db,C.ledger,a.orderNo),income:doc(db,C.incomes,a.orderNo),order:doc(db,C.orders,a.orderNo)}));
  try{state.busy=true;await runTransaction(db,async tx=>{
      const selectedOrderSnaps=[];for(const ref of orderRefs)selectedOrderSnaps.push(await tx.get(ref));const selectedIncomeSnaps=[];for(const ref of incomeRefs)selectedIncomeSnaps.push(await tx.get(ref));const corrSnaps=[];for(const refs of corrRefs)corrSnaps.push({ledger:await tx.get(refs.ledger),income:await tx.get(refs.income),order:await tx.get(refs.order)});
      rows.forEach((r,i)=>{const oSnap=selectedOrderSnaps[i],iSnap=selectedIncomeSnaps[i];if(!oSnap.exists())throw new Error(`${r.orderNo}: Order hilang.`);const o=oSnap.data();if(isCancelled(o.status))throw new Error(`${r.orderNo}: status Batal.`);if(o.payoutLock||o.estimateBatchId)throw new Error(`${r.orderNo}: sudah pernah dicairkan.`);
        if(kind==='estimate'){if(iSnap.exists())throw new Error(`${r.orderNo}: Income final baru saja masuk. Refresh lalu gunakan Final Excel.`);const current=o.pendingEstimate;if(!current||Number(current.amount)<=0||Number(current.amount)!==Number(r.activeEstimate.amount))throw new Error(`${r.orderNo}: estimasi berubah. Refresh terlebih dahulu.`);}else{if(!iSnap.exists())throw new Error(`${r.orderNo}: Income tidak ditemukan.`);const inc=iSnap.data();if(inc.payoutBatchId||inc.batchId)throw new Error(`${r.orderNo}: sudah masuk Batch.`);if(Number(inc.amount)!==Number(r.income.amount))throw new Error(`${r.orderNo}: nominal Income berubah. Refresh.`);}
      });
      plan.applications.forEach((a,i)=>{const snaps=corrSnaps[i];if(!snaps.income.exists())throw new Error(`${a.orderNo}: Income koreksi berubah/hilang.`);const currentFinal=Number(snaps.income.data().amount)||0;if(currentFinal!==Number(a.finalAmount))throw new Error(`${a.orderNo}: Final Income koreksi berubah. Refresh.`);const expected=Number(currentAppliedMap().get(a.orderNo)||0),ledgerApplied=snaps.ledger.exists()?Number(snaps.ledger.data()?.appliedAmount)||0:expected;if(Math.round(expected)!==Math.round(ledgerApplied))throw new Error(`${a.orderNo}: ledger koreksi berubah. Buka Pengaturan → Sinkronkan Ledger, lalu refresh.`);});
      const items=rows.map(r=>({orderNo:r.orderNo,basis:kind,amount:kind==='estimate'?Number(r.activeEstimate.amount):Number(r.income.amount),orderDate:r.order?.orderDate||r.income?.orderDate||'',releaseDate:r.income?.releaseDate||'',products:snapshotProducts(r.order),estimateSource:kind==='estimate'?r.activeEstimate.source:null}));
      tx.set(doc(db,C.batches,batchId),{schemaVersion:SCHEMA_VERSION,batchId,createdAt,status:'active',kind,baseAmount:base,correctionAmount:plan.correctionAmount,payoutAmount:plan.payoutAmount,items,corrections:plan.applications,filterSnapshot:kind==='estimate'?{from:$('pendingFrom').value,to:$('pendingTo').value,products:[...state.pendingProducts]}:{from:$('readyFrom').value,to:$('readyTo').value,products:[...state.readyProducts]}});
      rows.forEach((r,i)=>{if(kind==='estimate')tx.set(orderRefs[i],{payoutLock:{batchId,source:'estimate',amount:Number(r.activeEstimate.amount),paidAt:createdAt,estimateSource:r.activeEstimate.source,estimateSnapshot:r.activeEstimate},lastEstimate:r.activeEstimate},{merge:true});else tx.set(incomeRefs[i],{payoutBatchId:batchId,payoutLockedAt:createdAt},{merge:true});});
      plan.applications.forEach((a,i)=>{const current=Number(corrSnaps[i].ledger.data()?.appliedAmount)||0;tx.set(corrRefs[i].ledger,{orderNo:a.orderNo,appliedAmount:current+a.appliedAmount,lastBatchId:batchId,updatedAt:createdAt,schemaVersion:SCHEMA_VERSION},{merge:true});});
    });
    await logUpload({kind:`Batch ${kind==='estimate'?'Estimasi':'Final'}`,fileName:batchId,rows:rows.length,summary:note});state.selectedPending.clear();state.selectedReady.clear();await loadAll({syncLedger:false});flash(`${batchId} berhasil dibuat. Total pencairan ${money(plan.payoutAmount)}.`,'success');
  }catch(e){flash(e.message,'error');await loadAll();}finally{state.busy=false;}
}

function openBatchDetail(batchId){const b=state.batches.find(x=>x.batchId===batchId);if(!b)return;$('batchDetailTitle').textContent=b.batchId;$('batchDetailMeta').textContent=`${dt(b.createdAt)} · ${b.kind}`;const payout=b.payoutAmount||b.baseAmount+b.correctionAmount;$('batchDetailBody').innerHTML=`<div class="batch-detail-summary"><div><span>Dasar</span><strong>${money(b.baseAmount)}</strong></div><div><span>Koreksi</span><strong>${b.correctionAmount>0?'+':''}${money(b.correctionAmount)}</strong></div><div><span>Total Pencairan</span><strong>${money(payout)}</strong></div><div><span>Pesanan</span><strong>${b.items.length}</strong></div></div><h3>Pesanan</h3><div class="table-wrap"><table><thead><tr><th>No. Pesanan</th><th>Basis</th><th>Produk</th><th class="num">Snapshot</th></tr></thead><tbody>${b.items.map(i=>`<tr><td><b>${esc(i.orderNo)}</b></td><td><span class="badge ${i.basis==='estimate'?'estimate':'final'}">${esc(i.basis)}</span></td><td>${(i.products||[]).map(p=>`${esc(p.product||'-')} ${p.variation?`· ${esc(p.variation)}`:''}`).join('<br>')}</td><td class="num"><b>${money(i.amount)}</b></td></tr>`).join('')}</tbody></table></div>${b.corrections.length?`<h3>Koreksi yang diterapkan</h3><div class="table-wrap"><table><thead><tr><th>No. Pesanan</th><th class="num">Diterapkan</th></tr></thead><tbody>${b.corrections.map(c=>`<tr><td>${esc(c.orderNo)}</td><td class="num"><b class="${c.appliedAmount>0?'money-positive':'money-negative'}">${c.appliedAmount>0?'+':''}${money(c.appliedAmount)}</b></td></tr>`).join('')}</tbody></table></div>`:''}`;$('batchDetailDialog').showModal();}

function exportReport(){const rows=filteredReport().map(r=>{const est=estimateForReport(r);return {'No. Pesanan':r.orderNo,'Produk / Variasi':(r.order?.items||[]).map(x=>`${x.product}${x.variation?` | ${x.variation}`:''}`).join(' ; '),'Status Order':r.order?.status||'','Estimasi':est?.amount||'','Sumber Estimasi':sourceLabel(est),'Final Income':r.income?.amount||'','Tanggal Dana Dilepas':r.income?.releaseDate||'','Batch':r.paidBatchId||'','Nominal Dicairkan':r.paidSnapshot||'','Koreksi Asli':r.originalCorrection||'','Koreksi Sudah Diterapkan':r.appliedCorrection||'','Sisa Koreksi':r.remainingCorrection||'','Status':r.state};});downloadXlsx(rows,`Laporan_Gabungan_${today()}.xlsx`,'Laporan');}
function exportBatches(){const rows=[];for(const b of state.batches){for(const i of b.items)rows.push({'Batch':b.batchId,'Waktu':b.createdAt,'Jenis':b.kind,'Jenis Baris':'Pesanan','No. Pesanan':i.orderNo,'Basis':i.basis,'Nominal':i.amount,'Koreksi':'','Total Pencairan':b.payoutAmount||b.baseAmount+b.correctionAmount});for(const c of b.corrections)rows.push({'Batch':b.batchId,'Waktu':b.createdAt,'Jenis':b.kind,'Jenis Baris':'Koreksi','No. Pesanan':c.orderNo,'Basis':'koreksi','Nominal':'','Koreksi':c.appliedAmount,'Total Pencairan':b.payoutAmount||b.baseAmount+b.correctionAmount});}downloadXlsx(rows,`Riwayat_Batch_${today()}.xlsx`,'Batch');}
function downloadXlsx(rows,filename,sheet){if(!rows.length){flash('Tidak ada data untuk diexport.','error');return;}const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,sheet);XLSX.writeFile(wb,filename);}

async function resetDatabase(){if($('resetPhrase').value!=='HAPUS SEMUA'){setMessage('settingsMessage','Ketik persis HAPUS SEMUA untuk mengaktifkan reset.','warning');return;}if(!confirm('Semua Master Order, Income, Batch, Upload Log, dan Ledger akan dihapus permanen. Lanjutkan?'))return;const cols=[C.orders,C.incomes,C.batches,C.uploads,C.ledger,'anomalies','edits'];try{state.busy=true;for(const name of cols){const snap=await getDocs(collection(db,name));const refs=snap.docs.map(d=>d.ref);for(let i=0;i<refs.length;i+=400){const wb=writeBatch(db);refs.slice(i,i+400).forEach(r=>wb.delete(r));await wb.commit();}}$('resetPhrase').value='';await loadAll({syncLedger:false});setMessage('settingsMessage','Database aplikasi sudah kosong.','success');}catch(e){setMessage('settingsMessage',esc(e.message),'warning');}finally{state.busy=false;}}

const titles={dashboard:['Dashboard','Ringkasan master terbaru.'],upload:['Upload Excel','Order dan Income Excel Shopee.'],report:['Laporan Gabungan','Estimasi, final, pencairan, dan koreksi dalam satu laporan.'],pending:['Pending Pembayaran','Estimasi sementara sebelum Income Excel tersedia.'],cancelled:['Pesanan Batal','Dipisahkan dari alur pencairan.'],ready:['Siap Dicairkan','Murni pembayaran final dari Income Excel.'],history:['Riwayat Batch','Snapshot pencairan permanen.'],recon:['Rekonsiliasi','Periksa klop antara Final Excel dan pencairan nyata.'],settings:['Pengaturan','Status sistem dan tindakan administratif.']};
function switchView(view){$$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));$$('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('pageTitle').textContent=titles[view]?.[0]||view;$('pageSub').textContent=titles[view]?.[1]||'';closeDrawer();if(view==='report')renderReport();if(view==='pending')renderPending();if(view==='ready')renderReady();if(view==='recon')renderRecon();}
function openDrawer(){$('sidebar').classList.add('open');$('drawerBackdrop').hidden=false;}function closeDrawer(){$('sidebar').classList.remove('open');$('drawerBackdrop').hidden=true;}

function bind(){
  $('loginForm').addEventListener('submit',async e=>{e.preventDefault();setMessage('loginMessage','Memeriksa akun...','info');try{const cred=await signInWithEmailAndPassword(auth,$('loginEmail').value.trim(),$('loginPassword').value);if(cred.user.uid!==ADMIN_UID){await signOut(auth);throw new Error('Akun ini bukan admin aplikasi.');}}catch(err){setMessage('loginMessage',esc(err.message),'warning');}});
  $('logoutBtn').addEventListener('click',()=>signOut(auth));$('refreshBtn').addEventListener('click',()=>loadAll().then(()=>flash('Data diperbarui.','success')).catch(e=>flash(e.message,'error')));
  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));$('drawerOpen').addEventListener('click',openDrawer);$('drawerClose').addEventListener('click',closeDrawer);$('drawerBackdrop').addEventListener('click',closeDrawer);$('bottomMore').addEventListener('click',openDrawer);
  $('orderFile').addEventListener('change',e=>$('orderFileName').textContent=e.target.files[0]?.name||'Belum dipilih');$('incomeFile').addEventListener('change',e=>$('incomeFileName').textContent=e.target.files[0]?.name||'Belum dipilih');
  $('clearExcelBtn').addEventListener('click',()=>{$('orderFile').value='';$('incomeFile').value='';$('orderFileName').textContent='Belum dipilih';$('incomeFileName').textContent='Belum dipilih';});
  $('importExcelBtn').addEventListener('click',async()=>{const of=$('orderFile').files[0],inf=$('incomeFile').files[0];if(!of&&!inf){setMessage('excelMessage','Pilih minimal satu file Excel.','warning');return;}try{state.busy=true;setMessage('excelMessage','Memproses Excel...','info');let parts=[];if(of){const r=await importOrderExcel(of);parts.push(`Order: ${r.rows} pesanan`);await loadAll({syncLedger:false});}if(inf){const r=await importIncomeExcel(inf);parts.push(`Income: ${r.rows} final, ${r.cleared} estimasi dibersihkan`);}await loadAll();setMessage('excelMessage',`${parts.join(' · ')}. Master berhasil diperbarui.`,'success');}catch(e){setMessage('excelMessage',esc(e.message),'warning');}finally{state.busy=false;}});
  $('pendingHtmlFile').addEventListener('change',e=>{$('importHtmlBtn').disabled=!e.target.files[0];if(e.target.files[0])setMessage('htmlMessage',`Siap import: <b>${esc(e.target.files[0].name)}</b>`,'info');});
  $('importHtmlBtn').addEventListener('click',async()=>{const f=$('pendingHtmlFile').files[0];if(!f)return;try{state.busy=true;const r=await importPendingHtml(f);await loadAll();setMessage('htmlMessage',`HTML dibaca ${r.rows} order: <b>${r.matched} cocok</b>, ${r.skippedFinal} diabaikan karena Final Excel sudah ada, ${r.skippedLocked} sudah dicairkan estimasi, ${r.unmatched} tidak ada di Master Order. Total nominal di HTML ${money(r.total)}.`,'success');}catch(e){setMessage('htmlMessage',esc(e.message),'warning');}finally{state.busy=false;}});
  ['reportFrom','reportTo','reportState','reportSearch'].forEach(x=>$(x).addEventListener('input',renderReport));$('reportReset').addEventListener('click',()=>{$('reportFrom').value='';$('reportTo').value='';$('reportState').value='all';$('reportSearch').value='';state.reportProducts.clear();renderReport();});$('exportReportBtn').addEventListener('click',exportReport);
  ['pendingFrom','pendingTo','pendingSearch'].forEach(x=>$(x).addEventListener('input',renderPending));$('pendingReset').addEventListener('click',()=>{$('pendingFrom').value='';$('pendingTo').value='';$('pendingSearch').value='';state.pendingProducts.clear();state.selectedPending.clear();renderPending();});$('pendingSelectAll').addEventListener('change',e=>{const rows=filteredPending().filter(r=>r.state==='pendingEstimated');rows.forEach(r=>e.target.checked?state.selectedPending.add(r.orderNo):state.selectedPending.delete(r.orderNo));renderPending();});$('createEstimateBatchBtn').addEventListener('click',()=>createBatch('estimate'));
  ['readyFrom','readyTo','readySearch'].forEach(x=>$(x).addEventListener('input',renderReady));$('readyReset').addEventListener('click',()=>{$('readyFrom').value='';$('readyTo').value='';$('readySearch').value='';state.readyProducts.clear();state.selectedReady.clear();renderReady();});$('readySelectAll').addEventListener('change',e=>{filteredReady().forEach(r=>e.target.checked?state.selectedReady.add(r.orderNo):state.selectedReady.delete(r.orderNo));renderReady();});$('createFinalBatchBtn').addEventListener('click',()=>createBatch('final'));
  $('saveEstimateBtn').addEventListener('click',saveManualEstimate);$('exportBatchBtn').addEventListener('click',exportBatches);$('syncLedgerBtn').addEventListener('click',()=>syncCorrectionLedger(true).catch(e=>flash(e.message,'error')));$('resetDbBtn').addEventListener('click',resetDatabase);
}

bind();
onAuthStateChanged(auth,async user=>{
  if(user&&user.uid===ADMIN_UID){$('authGate').hidden=true;$('appShell').hidden=false;$('accountEmail').textContent=user.email||user.uid;$('firebaseStatus').textContent='Terhubung';try{await loadAll();}catch(e){flash(e.message,'error');}}
  else{$('authGate').hidden=false;$('appShell').hidden=true;if(user)await signOut(auth);}
});
