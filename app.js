import {
  APP_VERSION, SCHEMA_VERSION, text, num, isCancelled, safeDateOnly, fileEndDate, compareSourceDate,
  normalizeIncome, normalizeOrder, normalizeBatch, recordsFromMaps, buildPayoutItemMap,
  buildCorrectionAppliedMap, buildCorrectionPlan, historicalEstimate
} from './core.js?v=2.1.2';

const ADMIN_UID='ISAloBhuHVQwGKzwVLpOXKMcstn2';
const C={orders:'orders',incomes:'incomes',batches:'batches',uploads:'uploads',ledger:'correction_ledger'};
let firebaseApp=null, auth=null, authSignOut=null, firestoreDb=null, firestoreApi=null, appBound=false;

async function ensureFirestore(){
  if(!firebaseApp)throw new Error('Firebase App belum siap. Login ulang.');
  if(!firestoreApi){
    firestoreApi=await import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js');
    firestoreDb=firestoreApi.getFirestore(firebaseApp);
  }
  return {...firestoreApi,db:firestoreDb};
}

const state={
  rawOrders:new Map(), rawIncomes:new Map(), orders:new Map(), incomes:new Map(), batches:[], uploads:[], ledger:new Map(), records:[],
  selectedPending:new Set(), selectedReady:new Set(), reportProducts:new Set(), reportOrderStatuses:new Set(), pendingProducts:new Set(), readyProducts:new Set(), editingEstimate:null,
  dirty:{orders:new Set(),incomes:new Set(),batches:new Set(),uploads:new Set(),ledger:new Set()},
  busy:false, cacheLoaded:false, lastServerSync:'', pendingFullReset:false
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
function reconciliationDetails(title,items,{tone='info',showAmount=true,extra=null}={}){
  if(!items?.length)return '';
  const total=showAmount?items.reduce((s,x)=>s+(Number(x.amount)||0),0):0;
  return `<details class="recon-group ${tone}" ${items.length<=3?'open':''}><summary><span>${esc(title)}</span><b>${items.length}${showAmount?` · ${money(total)}`:''}</b></summary><div class="recon-list">${items.map(x=>`<div class="recon-row"><div><b>${esc(x.orderNo||'-')}</b>${x.status?`<span>${esc(x.status)}</span>`:''}${x.note?`<span>${esc(x.note)}</span>`:''}</div>${showAmount?`<strong>${money(x.amount)}</strong>`:''}</div>`).join('')}</div>${extra?`<div class="recon-note">${extra}</div>`:''}</details>`;
}
function renderHtmlReconciliation(r){
  const el=$('htmlReconcile');if(!el)return;
  const groups=[
    reconciliationDetails('Tidak ada di Master Order',r.unmatchedItems,{tone:'warning'}),
    reconciliationDetails('Pending di Master tetapi tidak ada di HTML terbaru',r.pendingMissingItems,{tone:'warning',showAmount:true,extra:'Order ini tetap ada di Master, tetapi tidak muncul pada snapshot HTML terbaru. Jika memang belum dibayar pembeli, kondisi ini normal.'}),
    reconciliationDetails('Estimasi HTML lama yang dibersihkan',r.clearedItems,{tone:'info'}),
    reconciliationDetails('Diabaikan karena Final Excel sudah ada',r.skippedFinalItems,{tone:'success'}),
    reconciliationDetails('Sudah dicairkan berdasarkan estimasi',r.skippedLockedItems,{tone:'info'})
  ].filter(Boolean);
  const eligibleTotal=(Number(r.total)||0)-(Number(r.unmatchedTotal)||0)-(Number(r.skippedFinalTotal)||0)-(Number(r.skippedLockedTotal)||0)-(Number(r.cancelledTotal)||0);
  el.innerHTML=`<div class="recon-head"><div><strong>Rekonsiliasi HTML terbaru</strong><span>Bandingkan snapshot HTML dengan Master Order tanpa menghitung manual.</span></div><div class="recon-metrics"><span>File HTML <b>${money(r.total)}</b></span><span>Eligible ke estimasi <b>${money(eligibleTotal)}</b></span></div></div>${groups.join('')||'<div class="recon-ok">Semua order HTML cocok dengan Master dan tidak ada Pending Master yang hilang dari snapshot.</div>'}`;
  el.hidden=false;
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
function reportHtmlEstimate(r){
  const candidates=[r?.activeEstimate,historicalEstimate(r?.order),r?.order?.lastEstimate,r?.order?.pendingEstimate].filter(Boolean);
  return candidates.find(x=>x?.source==='html')||null;
}
function reportOrderStatusEntries(){
  const statuses=new Set();
  for(const r of state.records){const status=text(r.order?.status);if(status)statuses.add(status);}
  return [...statuses].sort((a,b)=>a.localeCompare(b,'id'));
}
function renderReportOrderStatusPicker(){
  const el=$('reportOrderStatusPicker');if(!el)return;const statuses=reportOrderStatusEntries();
  const allowed=new Set(statuses);for(const x of [...state.reportOrderStatuses])if(!allowed.has(x))state.reportOrderStatuses.delete(x);
  el.innerHTML=`<div class="product-picker-head"><strong>Status Order <span class="muted">· checkbox dari Excel · kosong = semua</span></strong><div><button class="btn ghost picker-none" type="button">Kosongkan</button></div></div><div class="product-checks status-checks">${statuses.map(x=>`<label><input type="checkbox" value="${esc(x)}" ${state.reportOrderStatuses.has(x)?'checked':''}>${esc(x)}</label>`).join('')||'<span class="muted">Belum ada status Order dari Excel.</span>'}</div>`;
  el.querySelectorAll('input[type=checkbox]').forEach(c=>c.addEventListener('change',()=>{c.checked?state.reportOrderStatuses.add(c.value):state.reportOrderStatuses.delete(c.value);renderReport();}));
  el.querySelector('.picker-none')?.addEventListener('click',()=>{state.reportOrderStatuses.clear();renderReport();});
}
function reportMatchesOrderStatus(r){
  if(!state.reportOrderStatuses.size)return true;
  return !!r.order&&state.reportOrderStatuses.has(text(r.order.status));
}
function configureReportDateMode(){
  const mode=$('reportDateMode')?.value||'order',fromLabel=$('reportFromLabel'),toLabel=$('reportToLabel');
  if(fromLabel)fromLabel.firstChild.nodeValue=mode==='final'?'Dana dilepas dari':mode==='combined'?'Order dari':'Order dari';
  if(toLabel)toLabel.firstChild.nodeValue='Sampai';
}
function reportDateForMode(r,mode){
  if(mode==='final')return r.income?.releaseDate||'';
  return r.order?.orderDate||r.income?.orderDate||'';
}
function reportModeIncludes(r,mode){
  if(mode==='final')return !!r.income;
  if(mode==='combined')return !!r.income||!!r.activeEstimate;
  return !!r.order;
}
function configureReportSearch(){
  const mode=$('reportSearchMode')?.value||'all',input=$('reportSearch'),label=$('reportSearchLabel');if(!input)return;
  input.type='search';
  input.placeholder=mode==='orderNo'?'No. Pesanan':mode==='product'?'Nama produk':'No pesanan / produk';
  if(label)label.firstChild.nodeValue='Cari';
}
function reportMatchesSearch(r){
  const mode=$('reportSearchMode')?.value||'all',q=text($('reportSearch')?.value);
  if(!q)return true;
  const needle=q.toLowerCase();
  if(mode==='orderNo')return r.orderNo.toLowerCase().includes(needle);
  if(mode==='product')return productNames(r.order).join(' ').toLowerCase().includes(needle);
  return [r.orderNo,...productNames(r.order)].join(' ').toLowerCase().includes(needle);
}
function sourceLabel(est){if(!est)return '-';return est.source==='html'?'HTML Shopee':est.source==='manual'?'Manual':'Estimasi';}
function activeBatchItems(){return state.batches.filter(b=>b.status==='active').flatMap(b=>(b.items||[]).map(i=>({...i,batchId:b.batchId,batchCreatedAt:b.createdAt})));}
function currentPayoutMap(){return buildPayoutItemMap(state.batches);}
function currentAppliedMap(){return buildCorrectionAppliedMap(state.batches,state.orders,state.incomes);}
function duplicatePayoutSet(){return new Set(duplicatePayoutOrders().map(x=>x.orderNo));}
function correctionEligibleRecords(){const dup=duplicatePayoutSet();return state.records.filter(r=>!dup.has(r.orderNo));}
function correctionBalance(){return correctionEligibleRecords().filter(r=>r.state==='paidFinalKnown').reduce((s,r)=>s+Math.round(r.remainingCorrection||0),0);}

const CACHE_KEY='shopee-payout-v2-cache';
const CACHE_MAX_UPLOADS=30;
const DIRTY_KINDS=['orders','incomes','batches','uploads','ledger'];
function dirtyCount(){return DIRTY_KINDS.reduce((n,k)=>n+state.dirty[k].size,0)+(state.pendingFullReset?1:0);}
function markDirty(kind,id){if(state.dirty[kind]&&id)state.dirty[kind].add(id);}
function clearDirty(){DIRTY_KINDS.forEach(k=>state.dirty[k].clear());state.pendingFullReset=false;}
function dirtySnapshot(){return Object.fromEntries(DIRTY_KINDS.map(k=>[k,[...state.dirty[k]]));}
function restoreDirty(d){DIRTY_KINDS.forEach(k=>state.dirty[k]=new Set(Array.isArray(d?.[k])?d[k]:[]));}
function rebuildState({render=true,save=true}={}){
  state.incomes=new Map([...state.rawIncomes].map(([k,v])=>[k,normalizeIncome(v,k)]));
  state.orders=new Map([...state.rawOrders].map(([k,v])=>[k,normalizeOrder(v,k,state.incomes.has(k))]));
  state.batches=(state.batches||[]).map(x=>normalizeBatch(x,x.batchId||x.id)).sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
  state.uploads=(state.uploads||[]).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,CACHE_MAX_UPLOADS);
  state.records=recordsFromMaps(state.orders,state.incomes,state.batches);
  if(save)saveCache();
  if(render)renderAll();
}
function saveCache(){
  try{
    const payload={schemaVersion:SCHEMA_VERSION,savedAt:nowIso(),lastServerSync:state.lastServerSync||'',pendingFullReset:!!state.pendingFullReset,dirty:dirtySnapshot(),rawOrders:[...state.rawOrders.values()],rawIncomes:[...state.rawIncomes.values()],batches:state.batches,uploads:state.uploads.slice(0,CACHE_MAX_UPLOADS),ledger:[...state.ledger.values()]};
    localStorage.setItem(CACHE_KEY,JSON.stringify(payload));state.cacheLoaded=true;
  }catch(e){state.cacheLoaded=false;console.warn('Cache lokal tidak tersimpan:',e);}
}
function loadCache(){
  try{
    const raw=localStorage.getItem(CACHE_KEY);if(!raw)return false;
    const c=JSON.parse(raw);if(!c||!Array.isArray(c.rawOrders)||!Array.isArray(c.rawIncomes))return false;
    state.rawOrders=new Map(c.rawOrders.map(x=>[x.orderNo||x.id,x]));
    state.rawIncomes=new Map(c.rawIncomes.map(x=>[x.orderNo||x.id,x]));
    state.batches=Array.isArray(c.batches)?c.batches:[];
    state.uploads=Array.isArray(c.uploads)?c.uploads.slice(0,CACHE_MAX_UPLOADS):[];
    state.ledger=new Map((Array.isArray(c.ledger)?c.ledger:[]).map(x=>[x.orderNo||x.id,x]));
    restoreDirty(c.dirty);state.pendingFullReset=!!c.pendingFullReset;
    state.cacheLoaded=true;state.lastServerSync=c.lastServerSync||'';
    rebuildState({render:false,save:false});return true;
  }catch(e){console.warn('Cache lokal rusak:',e);return false;}
}
function clearCache(){try{localStorage.removeItem(CACHE_KEY);}catch{}state.cacheLoaded=false;}
async function readCollection(name){
  assertAdmin();const {getDocs,collection,db}=await ensureFirestore();
  const snap=await getDocs(collection(db,name));return snap.docs.map(d=>({id:d.id,...d.data()}));
}
async function readRecentUploads(){
  assertAdmin();
  try{const {getDocs,collection,query,orderBy,limit,db}=await ensureFirestore();const snap=await getDocs(query(collection(db,C.uploads),orderBy('createdAt','desc'),limit(CACHE_MAX_UPLOADS)));return snap.docs.map(d=>({id:d.id,...d.data()}));}
  catch(e){console.warn('Gagal membaca log terbaru:',e);return [];}
}
async function deleteCollectionServer(name){
  const {getDocs,collection,writeBatch,db}=await ensureFirestore();const snap=await getDocs(collection(db,name));const refs=snap.docs.map(d=>d.ref);
  for(let i=0;i<refs.length;i+=350){const wb=writeBatch(db);refs.slice(i,i+350).forEach(r=>wb.delete(r));await wb.commit();}
}
async function pushDirtyDocs(){
  const {writeBatch,doc,db}=await ensureFirestore();const jobs=[];
  for(const orderNo of state.dirty.orders){const data=state.rawOrders.get(orderNo);if(data)jobs.push({col:C.orders,id:orderNo,data});}
  for(const orderNo of state.dirty.incomes){const data=state.rawIncomes.get(orderNo);if(data)jobs.push({col:C.incomes,id:orderNo,data});}
  for(const batchId of state.dirty.batches){const data=state.batches.find(x=>x.batchId===batchId);if(data)jobs.push({col:C.batches,id:batchId,data});}
  for(const uploadId of state.dirty.uploads){const data=state.uploads.find(x=>(x.uploadId||x.id)===uploadId);if(data)jobs.push({col:C.uploads,id:uploadId,data});}
  for(const orderNo of state.dirty.ledger){const data=state.ledger.get(orderNo);if(data)jobs.push({col:C.ledger,id:orderNo,data});}
  for(let i=0;i<jobs.length;i+=350){const wb=writeBatch(db);jobs.slice(i,i+350).forEach(x=>wb.set(doc(db,x.col,x.id),x.data,{merge:true}));await wb.commit();}
  return jobs.length;
}
function rebuildLedgerLocal(){
  const derived=currentAppliedMap(),keys=new Set([...derived.keys(),...state.ledger.keys()]);
  for(const orderNo of keys){const appliedAmount=Number(derived.get(orderNo)||0),old=state.ledger.get(orderNo);if(Number(old?.appliedAmount||0)===appliedAmount)continue;const row={orderNo,appliedAmount,updatedAt:nowIso(),schemaVersion:SCHEMA_VERSION};state.ledger.set(orderNo,row);markDirty('ledger',orderNo);}
}
async function pullServerIntoLocal(){
  const [ro,ri,rb,ru]=await Promise.all([readCollection(C.orders),readCollection(C.incomes),readCollection(C.batches),readRecentUploads()]);
  state.rawOrders=new Map(ro.map(x=>[x.orderNo||x.id,x]));
  state.rawIncomes=new Map(ri.map(x=>[x.orderNo||x.id,x]));
  state.batches=rb;state.uploads=ru;state.ledger=new Map();
}
async function syncServerNow(){
  if(state.busy)return;assertAdmin();
  try{
    state.busy=true;renderSettings();setMessage('settingsSyncMessage','Sinkronisasi sedang berjalan. Data lokal tetap aman bila server gagal.','info');
    rebuildLedgerLocal();
    const hadLocal=state.cacheLoaded;
    if(state.pendingFullReset){for(const name of [C.orders,C.incomes,C.batches,C.uploads,C.ledger,'anomalies','edits'])await deleteCollectionServer(name);}
    const pushed=await pushDirtyDocs();
    // Pull hanya pada sinkron manual. Ini sekaligus mengambil perubahan server dari perangkat lain.
    await pullServerIntoLocal();
    state.lastServerSync=nowIso();clearDirty();rebuildState({render:true,save:true});
    setMessage('settingsSyncMessage',`Sinkronisasi berhasil ${dt(state.lastServerSync)}. ${pushed} perubahan lokal dikirim ke Firebase${hadLocal?' dan data server diperbarui ke cache lokal':'. Cache lokal dibuat dari server'}.`,'success');
    flash('Sinkronisasi Firebase selesai.','success');
  }catch(e){saveCache();renderSettings();setMessage('settingsSyncMessage',`Sinkronisasi gagal: ${esc(e.message)}. Perubahan lokal tetap tersimpan dan akan dicoba lagi saat tombol Sinkronkan ditekan.`,'warning');flash('Sinkronisasi gagal; data lokal tetap aman.','error');}
  finally{state.busy=false;renderSettings();}
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
  const from=$('reportFrom').value,to=$('reportTo').value,mode=$('reportDateMode')?.value||'order';
  return state.records.filter(r=>{
    if(!reportModeIncludes(r,mode))return false;
    const d=reportDateForMode(r,mode);
    if((from||to)&&!d)return false;
    if(from&&d<from)return false;if(to&&d>to)return false;
    if(!reportMatchesOrderStatus(r))return false;
    if(!reportMatchesSearch(r))return false;
    return true;
  });
}
function filteredReport(){
  const mode=$('reportDateMode')?.value||'order';
  return reportBaseFilteredRecords().filter(r=>orderMatchesProducts(r.order,state.reportProducts))
    .sort((a,b)=>String(reportDateForMode(b,mode)).localeCompare(String(reportDateForMode(a,mode)))||b.orderNo.localeCompare(a.orderNo));
}
function estimateForReport(r){return r.activeEstimate||historicalEstimate(r.order)||null;}
function renderReport(){
  configureReportDateMode();configureReportSearch();renderReportOrderStatusPicker();
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
    const mode=$('reportDateMode')?.value||'order',basisDate=reportDateForMode(r,mode);return `<tr><td><b>${esc(r.orderNo)}</b><br><span class="muted">${esc(basisDate||'-')}</span></td><td>${productsHtml(r.order)}</td><td>${esc(r.order?.status||'-')}</td><td>${est?`<b>${money(est.amount)}</b><br><span class="badge estimate">${esc(sourceLabel(est))}</span>${est.source==='html'&&text(est.status)?`<br><span class="muted">${esc(est.status)}</span>`:''}`:'-'}</td><td class="num">${r.income?`<b>${money(r.income.amount)}</b><br><span class="muted">${esc(r.income.releaseDate||'-')}</span>`:'-'}</td><td>${payout}</td><td class="num">${corr}</td><td>${stateBadge(r)}</td></tr>`;
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
function renderSettings(){
  $('settingsFirebase').textContent=auth.currentUser?'Login aktif':'Tidak terhubung';
  const c=$('settingsCache');if(c)c.textContent=state.cacheLoaded?'Aktif · lokal':'Belum ada';
  const ls=$('settingsLastSync');if(ls)ls.textContent=state.lastServerSync?dt(state.lastServerSync):'Belum pernah';
  const dc=$('settingsDirtyCount');if(dc)dc.textContent=state.pendingFullReset?'RESET server tertunda':`${dirtyCount()} perubahan`;
  const btn=$('syncNowBtn');if(btn){btn.disabled=state.busy;btn.textContent=state.busy?'Menyinkronkan...':'Sinkronkan Sekarang';}
  const fs=$('firebaseStatus');if(fs&&!state.busy)fs.textContent=dirtyCount()?`Lokal · ${dirtyCount()} belum sinkron`:(state.lastServerSync?'Lokal · sinkron':'Lokal · belum sinkron');
}
function renderAll(){state.records=recordsFromMaps(state.orders,state.incomes,state.batches);renderDashboard();renderUploads();renderReport();renderPending();renderCancelled();renderReady();renderHistory();renderRecon();renderSettings();}

function findHeader(rows,required){for(let i=0;i<Math.min(rows.length,30);i++){const hdr=rows[i].map(x=>text(x));if(required.every(r=>hdr.includes(r)))return i;}return -1;}
function rowsAsObjects(rows,headerIndex){const headers=rows[headerIndex].map(x=>text(x));return rows.slice(headerIndex+1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));}
async function workbookRows(file){const ab=await file.arrayBuffer(),wb=XLSX.read(ab,{type:'array',cellDates:true});return {wb,sheets:wb.SheetNames.map(n=>({name:n,rows:XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,defval:'',raw:true})}))};}
function chooseSheet(sheets,required){for(const s of sheets){const hi=findHeader(s.rows,required);if(hi>=0)return {...s,headerIndex:hi};}return null;}
function sameData(a,b,keys){return keys.every(k=>JSON.stringify(a?.[k]??null)===JSON.stringify(b?.[k]??null));}

async function importOrderExcel(file){
  const {sheets}=await workbookRows(file),sheet=chooseSheet(sheets,['No. Pesanan','Nama Produk','Status Pesanan']);if(!sheet)throw new Error('Header Order Excel tidak ditemukan. Pastikan file export Order Shopee.');
  const objs=rowsAsObjects(sheet.rows,sheet.headerIndex),groups=new Map();for(const r of objs){const orderNo=text(r['No. Pesanan']);if(!orderNo)continue;if(!groups.has(orderNo))groups.set(orderNo,[]);groups.get(orderNo).push(r);}
  const sourceEnd=fileEndDate(file.name),timestamp=nowIso();let inserted=0,updated=0,stale=0,unchanged=0;const payload=[];
  for(const [orderNo,lines] of groups){const old=state.orders.get(orderNo);if(old?.orderSourceEndDate&&sourceEnd&&compareSourceDate(sourceEnd,old.orderSourceEndDate)<0){stale++;continue;}
    const first=lines[0],status=text(first['Status Pesanan']),cancelReason=text(first['Alasan Pembatalan']);const occurrence=new Map();
    const items=lines.map((r,idx)=>{const product=text(r['Nama Produk']),variation=text(r['Nama Variasi']),skuRef=text(r['Nomor Referensi SKU']),sig=`${skuRef}|${product}|${variation}`;occurrence.set(sig,(occurrence.get(sig)||0)+1);return {key:`${sig}|${occurrence.get(sig)}`,product,variation,skuRef,quantity:num(r['Jumlah']),subtotal:num(r['Subtotal Pesanan']),productCount:num(r['Jumlah Produk di Pesan'])};});
    const data={schemaVersion:SCHEMA_VERSION,orderNo,status,cancelReason,orderDate:safeDateOnly(first['Waktu Pesanan Dibuat']),orderDateTime:text(first['Waktu Pesanan Dibuat']),items,orderSourceFile:file.name,orderSourceEndDate:sourceEnd,orderImportedAt:timestamp};
    if(isCancelled(status)){if(old?.pendingEstimate)data.lastEstimate=old.pendingEstimate;data.pendingEstimate=null;data.shopeePendingAmount=0;data.shopeePendingStatus='';data.shopeePendingReleaseEstimate='';data.shopeePendingPaymentMethod='';data.shopeePendingSourceFile='';}
    const rawOld=state.rawOrders.get(orderNo),needsCleanup=isCancelled(status)&&!!(rawOld?.pendingEstimate||Number(rawOld?.shopeePendingAmount)>0);
    if(old&&!needsCleanup&&sameData(old,data,['status','cancelReason','orderDate','orderDateTime','items'])){unchanged++;continue;}
    payload.push({orderNo,data});old?updated++:inserted++;
  }
  for(const x of payload){const prev=state.rawOrders.get(x.orderNo)||{orderNo:x.orderNo};state.rawOrders.set(x.orderNo,{...prev,...x.data});markDirty('orders',x.orderNo);}
  rebuildState({render:false,save:false});
  await logUpload({kind:'Order Excel',fileName:file.name,rows:groups.size,summary:`${inserted} baru, ${updated} berubah, ${unchanged} tidak berubah, ${stale} dilewati karena file lebih lama`});return {rows:groups.size,inserted,updated,unchanged,stale};
}

async function importIncomeExcel(file){
  const {sheets}=await workbookRows(file),sheet=chooseSheet(sheets,['Lihat berdasarkan','No. Pesanan','Total Penghasilan']);if(!sheet)throw new Error('Sheet Penghasilan / header Income tidak ditemukan.');
  const objs=rowsAsObjects(sheet.rows,sheet.headerIndex),orderRowsRaw=objs.filter(r=>text(r['Lihat berdasarkan']).toLowerCase()==='order'&&text(r['No. Pesanan'])),skuRows=objs.filter(r=>text(r['Lihat berdasarkan']).toLowerCase()==='sku'&&text(r['No. Pesanan']));
  const orderRowMap=new Map();for(const r of orderRowsRaw)orderRowMap.set(text(r['No. Pesanan']),r);const orderRows=[...orderRowMap.values()];
  const skuMap=new Map();for(const r of skuRows){const no=text(r['No. Pesanan']);if(!skuMap.has(no))skuMap.set(no,[]);skuMap.get(no).push({productId:text(r['ID Produk']),product:text(r['Nama Produk']),amount:num(r['Total Penghasilan'])});}
  const sourceEnd=fileEndDate(file.name),timestamp=nowIso();let inserted=0,updated=0,stale=0,cleared=0,unchanged=0;const incomePayload=[],orderUpdates=[];
  for(const r of orderRows){const orderNo=text(r['No. Pesanan']),old=state.incomes.get(orderNo);if(old?.incomeSourceEndDate&&sourceEnd&&compareSourceDate(sourceEnd,old.incomeSourceEndDate)<0){stale++;continue;}
    const data={schemaVersion:SCHEMA_VERSION,orderNo,amount:num(r['Total Penghasilan']),orderDate:safeDateOnly(r['Waktu Pesanan Dibuat']),releaseDate:safeDateOnly(r['Tanggal Dana Dilepaskan']),releaseMethod:text(r['Metode Pelepasan Dana']),paymentMethod:text(r['Metode pembayaran pembeli']),orderType:text(r['Tipe Pesanan']),skuRows:skuMap.get(orderNo)||[],incomeSourceFile:file.name,incomeSourceEndDate:sourceEnd,incomeImportedAt:timestamp};
    if(old&&sameData(old,data,['amount','orderDate','releaseDate','releaseMethod','paymentMethod','orderType','skuRows']))unchanged++;else{incomePayload.push({orderNo,data});old?updated++:inserted++;}
    const o=state.orders.get(orderNo),rawO=state.rawOrders.get(orderNo);if(o&&rawO&&(rawO.pendingEstimate||Number(rawO.shopeePendingAmount)>0)){const visibleBeforeFinal=normalizeOrder(rawO,orderNo,false),hist=visibleBeforeFinal.pendingEstimate||o.lastEstimate||(!o.lastEstimate&&o.payoutLock?.source==='estimate'?o.payoutLock.estimateSnapshot:null);const upd={schemaVersion:SCHEMA_VERSION,pendingEstimate:null,shopeePendingAmount:0,shopeePendingStatus:'',shopeePendingReleaseEstimate:'',shopeePendingPaymentMethod:'',shopeePendingSourceFile:''};if(hist&&!rawO.lastEstimate)upd.lastEstimate=hist;orderUpdates.push({orderNo,data:upd});cleared++;}
  }
  for(const x of incomePayload){const prev=state.rawIncomes.get(x.orderNo)||{orderNo:x.orderNo};state.rawIncomes.set(x.orderNo,{...prev,...x.data});markDirty('incomes',x.orderNo);}
  for(const x of orderUpdates){const prev=state.rawOrders.get(x.orderNo)||{orderNo:x.orderNo};state.rawOrders.set(x.orderNo,{...prev,...x.data});markDirty('orders',x.orderNo);}
  rebuildState({render:false,save:false});
  const duplicates=orderRowsRaw.length-orderRows.length;await logUpload({kind:'Income Excel',fileName:file.name,rows:orderRows.length,summary:`${inserted} baru, ${updated} berubah, ${unchanged} tidak berubah, ${cleared} estimasi aktif dibersihkan, ${stale} file lama dilewati${duplicates?`, ${duplicates} duplikat Order digabung`:''}`});return {rows:orderRows.length,inserted,updated,unchanged,cleared,stale,duplicates};
}
async function logUpload(data){const uploadId=id('UP'),row={uploadId,createdAt:nowIso(),schemaVersion:SCHEMA_VERSION,...data};state.uploads=[row,...state.uploads].slice(0,CACHE_MAX_UPLOADS);markDirty('uploads',uploadId);saveCache();}

async function importPendingHtml(file){
  const raw=await file.text();if(!raw.includes('portal/finance/income')&&!raw.includes('Dana Akan Dilepaskan'))throw new Error('HTML bukan halaman Penghasilan Saya → Pending Shopee.');
  const parsed=new DOMParser().parseFromString(raw,'text/html'),found=[];
  parsed.querySelectorAll('.grid-table-row').forEach(row=>{const oid=row.querySelector('.order-id'),amt=row.querySelector('.transaction-amount');if(!oid||!amt)return;const m=text(oid.textContent).match(/\b\d{6}[A-Z0-9]{6,}\b/);if(!m)return;const cells=[...row.children];found.push({orderNo:m[0],amount:num(amt.textContent),releaseEstimate:text(cells[1]?.textContent),status:text(cells[2]?.textContent),paymentMethod:text(cells[3]?.textContent)});});
  const uniqueMap=new Map(found.map(x=>[x.orderNo,x]));
  const incomingIds=new Set([...uniqueMap.values()].filter(x=>Number(x.amount)>0).map(x=>x.orderNo));
  let matched=0,unchanged=0,unmatched=0,skippedFinal=0,skippedLocked=0,cancelled=0,clearedOldHtml=0;
  const timestamp=nowIso(),updates=[],clears=[];
  const unmatchedItems=[],skippedFinalItems=[],skippedLockedItems=[],cancelledItems=[],clearedItems=[];

  // HTML Pending adalah snapshot terbaru. Estimasi HTML aktif yang tidak lagi ada
  // di snapshot terbaru harus hilang. Manual dan snapshot Batch tidak disentuh.
  for(const [orderNo,o] of state.orders){
    const current=o?.pendingEstimate;
    if(!current||current.source!=='html')continue;
    if(o.payoutLock||o.estimateBatchId)continue;
    if(incomingIds.has(orderNo)&&!state.incomes.has(orderNo)&&!isCancelled(o.status))continue;
    const rawOld=state.rawOrders.get(orderNo)||{};
    const patch={
      schemaVersion:SCHEMA_VERSION,
      pendingEstimate:null,
      shopeePendingAmount:0,
      shopeePendingStatus:'',
      shopeePendingReleaseEstimate:'',
      shopeePendingPaymentMethod:'',
      shopeePendingSourceFile:'',
      shopeePendingImportedAt:''
    };
    if(!rawOld.lastEstimate)patch.lastEstimate=current;
    clears.push({orderNo,patch});clearedOldHtml++;
    clearedItems.push({orderNo,amount:Number(current.amount)||0,status:text(o.status),note:'Tidak ada lagi pada HTML terbaru'});
  }

  for(const x of uniqueMap.values()){
    const o=state.orders.get(x.orderNo),inc=state.incomes.get(x.orderNo);
    if(inc){skippedFinal++;skippedFinalItems.push({orderNo:x.orderNo,amount:x.amount,status:x.status,note:`Final Excel ${money(inc.amount)}`});continue;}
    if(!o){unmatched++;unmatchedItems.push({orderNo:x.orderNo,amount:x.amount,status:x.status,note:'Tidak ditemukan di Master Order'});continue;}
    if(isCancelled(o.status)){cancelled++;cancelledItems.push({orderNo:x.orderNo,amount:x.amount,status:o.status,note:'Status Order batal'});continue;}
    if(o.payoutLock||o.estimateBatchId){skippedLocked++;skippedLockedItems.push({orderNo:x.orderNo,amount:x.amount,status:o.status,note:o.payoutLock?.batchId||o.estimateBatchId||'Sudah dicairkan'});continue;}
    if(x.amount<=0)continue;
    const current=o.pendingEstimate;
    if(current?.source==='html'&&Number(current.amount)===Number(x.amount)&&text(current.status)===text(x.status)&&text(current.releaseEstimate)===text(x.releaseEstimate)&&text(current.paymentMethod)===text(x.paymentMethod)){matched++;unchanged++;continue;}
    const patch={
      schemaVersion:SCHEMA_VERSION,
      pendingEstimate:{source:'html',amount:x.amount,status:x.status,releaseEstimate:x.releaseEstimate,paymentMethod:x.paymentMethod,updatedAt:timestamp,sourceFile:file.name,items:[]},
      shopeePendingAmount:0,
      shopeePendingStatus:'',
      shopeePendingReleaseEstimate:'',
      shopeePendingPaymentMethod:'',
      shopeePendingSourceFile:'',
      shopeePendingImportedAt:''
    };
    updates.push({orderNo:x.orderNo,patch});matched++;
  }

  const writes=[...clears,...updates];
  for(const x of writes){const rawOld=state.rawOrders.get(x.orderNo)||{orderNo:x.orderNo};state.rawOrders.set(x.orderNo,{...rawOld,...x.patch});markDirty('orders',x.orderNo);}
  rebuildState({render:false,save:false});

  // Sesudah snapshot diterapkan, cari Master Pending yang tidak muncul pada HTML terbaru.
  const pendingMissingItems=state.records
    .filter(r=>(r.state==='pendingEstimated'||r.state==='pendingUnestimated')&&!incomingIds.has(r.orderNo))
    .map(r=>({orderNo:r.orderNo,amount:Number(r.activeEstimate?.amount)||0,status:text(r.order?.status),note:r.activeEstimate?`Estimasi aktif: ${sourceLabel(r.activeEstimate)}`:'Belum ada estimasi'}))
    .sort((a,b)=>a.orderNo.localeCompare(b.orderNo));

  await logUpload({kind:'HTML Pending',fileName:file.name,rows:uniqueMap.size,summary:`Snapshot terbaru: ${matched} cocok (${unchanged} tidak berubah), ${clearedOldHtml} estimasi HTML lama dibersihkan, ${unmatched} tanpa Order, ${skippedFinal} sudah Final Excel, ${skippedLocked} sudah dicairkan estimasi, ${pendingMissingItems.length} Pending Master tidak ada di HTML`});
  rebuildState({render:true,save:true});
  const sum=arr=>arr.reduce((s,x)=>s+(Number(x.amount)||0),0);
  return {
    rows:uniqueMap.size,matched,unchanged,clearedOldHtml,unmatched,skippedFinal,skippedLocked,cancelled,
    total:[...uniqueMap.values()].reduce((s,x)=>s+x.amount,0),
    unmatchedItems,pendingMissingItems,clearedItems,skippedFinalItems,skippedLockedItems,cancelledItems,
    unmatchedTotal:sum(unmatchedItems),skippedFinalTotal:sum(skippedFinalItems),skippedLockedTotal:sum(skippedLockedItems),cancelledTotal:sum(cancelledItems)
  };
}

function openEstimateDialog(orderNo){const r=state.records.find(x=>x.orderNo===orderNo);if(!r||!r.order||r.income||r.order.payoutLock)return;state.editingEstimate=orderNo;$('estimateOrderNo').textContent=orderNo;const current=r.activeEstimate;setMessage('estimateMessage',current?.source==='html'?`Estimasi HTML saat ini <b>${money(current.amount)}</b>. Menyimpan manual akan mengganti estimasi aktif. Upload HTML berikutnya dapat memperbaruinya lagi.`:'Masukkan estimasi per unit. Nilai ini hanya sementara sampai Income Excel muncul.','info');
  const manualItems=current?.source==='manual'&&Array.isArray(current.items)?new Map(current.items.map(x=>[x.key,x])):new Map();$('estimateItemsBody').innerHTML=r.order.items.map((x,i)=>{const old=manualItems.get(x.key)||{},unit=Number(old.unit)||0;return `<tr><td><b>${esc(x.product||'-')}</b><br><span class="muted">${esc(x.variation||'-')}</span></td><td class="num">${Number(x.quantity)||1}</td><td class="num"><input class="estimate-unit" data-index="${i}" data-key="${esc(x.key||String(i))}" data-qty="${Number(x.quantity)||1}" type="number" min="0" step="1" value="${unit||''}" placeholder="0"></td><td class="num"><b class="estimate-subtotal">${money(unit*(Number(x.quantity)||1))}</b></td></tr>`;}).join('');$$('.estimate-unit').forEach(x=>x.addEventListener('input',recalcEstimateDialog));recalcEstimateDialog();$('estimateDialog').showModal();}
function recalcEstimateDialog(){let total=0;$$('.estimate-unit').forEach((x,i)=>{const sub=Math.max(0,Number(x.value)||0)*(Number(x.dataset.qty)||1);total+=sub;document.querySelectorAll('.estimate-subtotal')[i].textContent=money(sub);});$('estimateGrandTotal').textContent=money(total);}
async function saveManualEstimate(){
  const orderNo=state.editingEstimate;if(!orderNo)return;
  const inputs=$$('.estimate-unit'),items=inputs.map(x=>({key:x.dataset.key,unit:Math.max(0,Number(x.value)||0),amount:Math.max(0,Number(x.value)||0)*(Number(x.dataset.qty)||1)})),amount=items.reduce((s,x)=>s+x.amount,0),timestamp=nowIso();
  if(amount===0&&!confirm('Total estimasi Rp0. Kosongkan estimasi manual/HTML untuk order ini?'))return;
  const o=state.orders.get(orderNo);if(!o){setMessage('estimateMessage','Order sudah tidak ada.','warning');return;}if(state.incomes.has(orderNo)){setMessage('estimateMessage','Income final sudah tersedia. Estimasi tidak boleh diedit lagi.','warning');return;}if(isCancelled(o.status)||o.payoutLock||o.estimateBatchId){setMessage('estimateMessage','Order tidak dapat diedit karena Batal atau sudah dicairkan.','warning');return;}
  try{
    state.busy=true;
    const patch={schemaVersion:SCHEMA_VERSION,pendingEstimate:amount?{source:'manual',amount,items,updatedAt:timestamp,sourceFile:''}:null};
    const rawOld=state.rawOrders.get(orderNo)||{orderNo};state.rawOrders.set(orderNo,{...rawOld,...patch});markDirty('orders',orderNo);
    $('estimateDialog').close();rebuildState({render:true,save:true});
    flash(amount?`Estimasi manual ${orderNo} disimpan lokal ${money(amount)}.`:`Estimasi ${orderNo} dikosongkan secara lokal.`,'success');
  }catch(e){setMessage('estimateMessage',esc(e.message),'warning');}finally{state.busy=false;}
}

function buildBatchId(kind){const d=new Date(),pad=n=>String(n).padStart(2,'0');return `BATCH-${kind==='estimate'?'EST':'FIN'}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2,5).toUpperCase()}`;}
function selectedPendingRecords(){return filteredPending().filter(r=>state.selectedPending.has(r.orderNo)&&r.state==='pendingEstimated');}
function selectedReadyRecords(){return filteredReady().filter(r=>state.selectedReady.has(r.orderNo));}
function snapshotProducts(order){return (order?.items||[]).map(x=>({product:x.product||'',variation:x.variation||'',quantity:Number(x.quantity)||0,skuRef:x.skuRef||''}));}
async function createBatch(kind){
  if(state.busy)return;const rows=kind==='estimate'?selectedPendingRecords():selectedReadyRecords();if(!rows.length)return;
  const base=rows.reduce((s,r)=>s+(kind==='estimate'?r.activeEstimate.amount:r.income.amount),0),plan=buildCorrectionPlan(correctionEligibleRecords(),base),batchId=buildBatchId(kind),createdAt=nowIso();
  const localItems=rows.map(r=>({orderNo:r.orderNo,basis:kind,amount:kind==='estimate'?Number(r.activeEstimate.amount):Number(r.income.amount),orderDate:r.order?.orderDate||r.income?.orderDate||'',releaseDate:r.income?.releaseDate||'',products:snapshotProducts(r.order),estimateSource:kind==='estimate'?r.activeEstimate.source:null}));
  const note=`Dasar ${money(base)} ${plan.correctionAmount?`+ koreksi ${plan.correctionAmount>0?'+':''}${money(plan.correctionAmount)}`:''} = pencairan ${money(plan.payoutAmount)}.`;
  if(!confirm(`${kind==='estimate'?'Buat Batch Estimasi':'Buat Batch Final'} ${batchId}?

${note}

Batch disimpan lokal dan baru dikirim ke Firebase saat Sinkronkan Sekarang ditekan.`))return;
  try{
    state.busy=true;
    for(const r of rows){
      const o=state.orders.get(r.orderNo);if(!o)throw new Error(`${r.orderNo}: Order tidak ditemukan di data lokal.`);if(isCancelled(o.status))throw new Error(`${r.orderNo}: status Batal.`);if(o.payoutLock||o.estimateBatchId)throw new Error(`${r.orderNo}: sudah pernah dicairkan.`);
      if(kind==='estimate'){if(state.incomes.has(r.orderNo))throw new Error(`${r.orderNo}: Final Income sudah ada di data lokal.`);if(!r.activeEstimate||Number(r.activeEstimate.amount)<=0)throw new Error(`${r.orderNo}: estimasi tidak tersedia.`);}
      else{const inc=state.incomes.get(r.orderNo);if(!inc)throw new Error(`${r.orderNo}: Income final tidak tersedia.`);if(inc.payoutBatchId||inc.batchId)throw new Error(`${r.orderNo}: sudah masuk Batch.`);}
    }
    const batchDoc={schemaVersion:SCHEMA_VERSION,batchId,createdAt,status:'active',kind,baseAmount:base,correctionAmount:plan.correctionAmount,payoutAmount:plan.payoutAmount,items:localItems,corrections:plan.applications,filterSnapshot:kind==='estimate'?{from:$('pendingFrom').value,to:$('pendingTo').value,products:[...state.pendingProducts]}:{from:$('readyFrom').value,to:$('readyTo').value,products:[...state.readyProducts]}};
    state.batches.push(normalizeBatch(batchDoc,batchId));markDirty('batches',batchId);
    rows.forEach(r=>{
      if(kind==='estimate'){
        const prev=state.rawOrders.get(r.orderNo)||{orderNo:r.orderNo};state.rawOrders.set(r.orderNo,{...prev,payoutLock:{batchId,source:'estimate',amount:Number(r.activeEstimate.amount),paidAt:createdAt,estimateSource:r.activeEstimate.source,estimateSnapshot:r.activeEstimate},lastEstimate:r.activeEstimate});markDirty('orders',r.orderNo);
      }else{
        const prev=state.rawIncomes.get(r.orderNo)||{orderNo:r.orderNo};state.rawIncomes.set(r.orderNo,{...prev,payoutBatchId:batchId,payoutLockedAt:createdAt});markDirty('incomes',r.orderNo);
      }
    });
    rebuildState({render:false,save:false});
    plan.applications.forEach(a=>{const row={orderNo:a.orderNo,appliedAmount:Number(currentAppliedMap().get(a.orderNo)||0),lastBatchId:batchId,updatedAt:createdAt,schemaVersion:SCHEMA_VERSION};state.ledger.set(a.orderNo,row);markDirty('ledger',a.orderNo);});
    await logUpload({kind:`Batch ${kind==='estimate'?'Estimasi':'Final'}`,fileName:batchId,rows:rows.length,summary:note});
    state.selectedPending.clear();state.selectedReady.clear();rebuildState({render:true,save:true});flash(`${batchId} dibuat lokal. Total ${money(plan.payoutAmount)} · belum disinkronkan ke Firebase.`,'success');
  }catch(e){flash(e.message,'error');}finally{state.busy=false;renderSettings();}
}

function openBatchDetail(batchId){const b=state.batches.find(x=>x.batchId===batchId);if(!b)return;$('batchDetailTitle').textContent=b.batchId;$('batchDetailMeta').textContent=`${dt(b.createdAt)} · ${b.kind}`;const payout=b.payoutAmount||b.baseAmount+b.correctionAmount;$('batchDetailBody').innerHTML=`<div class="batch-detail-summary"><div><span>Dasar</span><strong>${money(b.baseAmount)}</strong></div><div><span>Koreksi</span><strong>${b.correctionAmount>0?'+':''}${money(b.correctionAmount)}</strong></div><div><span>Total Pencairan</span><strong>${money(payout)}</strong></div><div><span>Pesanan</span><strong>${b.items.length}</strong></div></div><h3>Pesanan</h3><div class="table-wrap"><table><thead><tr><th>No. Pesanan</th><th>Basis</th><th>Produk</th><th class="num">Snapshot</th></tr></thead><tbody>${b.items.map(i=>`<tr><td><b>${esc(i.orderNo)}</b></td><td><span class="badge ${i.basis==='estimate'?'estimate':'final'}">${esc(i.basis)}</span></td><td>${(i.products||[]).map(p=>`${esc(p.product||'-')} ${p.variation?`· ${esc(p.variation)}`:''}`).join('<br>')}</td><td class="num"><b>${money(i.amount)}</b></td></tr>`).join('')}</tbody></table></div>${b.corrections.length?`<h3>Koreksi yang diterapkan</h3><div class="table-wrap"><table><thead><tr><th>No. Pesanan</th><th class="num">Diterapkan</th></tr></thead><tbody>${b.corrections.map(c=>`<tr><td>${esc(c.orderNo)}</td><td class="num"><b class="${c.appliedAmount>0?'money-positive':'money-negative'}">${c.appliedAmount>0?'+':''}${money(c.appliedAmount)}</b></td></tr>`).join('')}</tbody></table></div>`:''}`;$('batchDetailDialog').showModal();}

function exportReport(){const rows=filteredReport().map(r=>{const est=estimateForReport(r);return {'No. Pesanan':r.orderNo,'Produk / Variasi':(r.order?.items||[]).map(x=>`${x.product}${x.variation?` | ${x.variation}`:''}`).join(' ; '),'Status Order (Excel)':r.order?.status||'','Status Pending (HTML)':reportHtmlEstimate(r)?.status||'','Estimasi':est?.amount||'','Sumber Estimasi':sourceLabel(est),'Final Income':r.income?.amount||'','Tanggal Dana Dilepas':r.income?.releaseDate||'','Batch':r.paidBatchId||'','Nominal Dicairkan':r.paidSnapshot||'','Koreksi Asli':r.originalCorrection||'','Koreksi Sudah Diterapkan':r.appliedCorrection||'','Sisa Koreksi':r.remainingCorrection||'','Status':r.state};});downloadXlsx(rows,`Laporan_Gabungan_${today()}.xlsx`,'Laporan');}
function exportBatches(){const rows=[];for(const b of state.batches){for(const i of b.items)rows.push({'Batch':b.batchId,'Waktu':b.createdAt,'Jenis':b.kind,'Jenis Baris':'Pesanan','No. Pesanan':i.orderNo,'Basis':i.basis,'Nominal':i.amount,'Koreksi':'','Total Pencairan':b.payoutAmount||b.baseAmount+b.correctionAmount});for(const c of b.corrections)rows.push({'Batch':b.batchId,'Waktu':b.createdAt,'Jenis':b.kind,'Jenis Baris':'Koreksi','No. Pesanan':c.orderNo,'Basis':'koreksi','Nominal':'','Koreksi':c.appliedAmount,'Total Pencairan':b.payoutAmount||b.baseAmount+b.correctionAmount});}downloadXlsx(rows,`Riwayat_Batch_${today()}.xlsx`,'Batch');}
function downloadXlsx(rows,filename,sheet){if(!rows.length){flash('Tidak ada data untuk diexport.','error');return;}const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,sheet);XLSX.writeFile(wb,filename);}

async function resetDatabase(){
  if($('resetPhrase').value!=='HAPUS SEMUA'){setMessage('settingsMessage','Ketik persis HAPUS SEMUA untuk mengaktifkan reset.','warning');return;}
  if(!confirm('Kosongkan seluruh data LOKAL aplikasi? Firebase belum akan berubah sampai tombol Sinkronkan Sekarang ditekan.'))return;
  state.rawOrders.clear();state.rawIncomes.clear();state.orders.clear();state.incomes.clear();state.batches=[];state.uploads=[];state.ledger.clear();DIRTY_KINDS.forEach(k=>state.dirty[k].clear());state.pendingFullReset=true;$('resetPhrase').value='';rebuildState({render:true,save:true});setMessage('settingsMessage','Data lokal sudah kosong. Reset Firebase masih TERTUNDA sampai Sinkronkan Sekarang ditekan.','warning');
}


function bind(){
  $('logoutBtn').addEventListener('click',()=>authSignOut?.(auth));

  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
  $('drawerOpen').addEventListener('click',openDrawer);
  $('drawerClose').addEventListener('click',closeDrawer);
  $('drawerBackdrop').addEventListener('click',closeDrawer);
  $('bottomMore').addEventListener('click',openDrawer);

  $('orderFile').addEventListener('change',e=>$('orderFileName').textContent=e.target.files[0]?.name||'Belum dipilih');
  $('incomeFile').addEventListener('change',e=>$('incomeFileName').textContent=e.target.files[0]?.name||'Belum dipilih');
  $('clearExcelBtn').addEventListener('click',()=>{
    $('orderFile').value='';$('incomeFile').value='';
    $('orderFileName').textContent='Belum dipilih';$('incomeFileName').textContent='Belum dipilih';
  });
  $('importExcelBtn').addEventListener('click',async()=>{
    const of=$('orderFile').files[0],inf=$('incomeFile').files[0];
    if(!of&&!inf){setMessage('excelMessage','Pilih minimal satu file Excel.','warning');return;}
    try{
      state.busy=true;setMessage('excelMessage','Memproses Excel ke penyimpanan lokal...','info');
      const parts=[];
      if(of){const r=await importOrderExcel(of);parts.push(`Order: ${r.rows} pesanan`);}
      if(inf){const r=await importIncomeExcel(inf);parts.push(`Income: ${r.rows} final, ${r.cleared} estimasi dibersihkan`);}
      rebuildState({render:true,save:true});
      setMessage('excelMessage',`${parts.join(' · ')}. Disimpan lokal. Firebase belum disentuh; gunakan Pengaturan → Sinkronkan Sekarang bila diperlukan.`,'success');
    }catch(e){setMessage('excelMessage',esc(e.message),'warning');}
    finally{state.busy=false;renderSettings();}
  });

  $('pendingHtmlFile').addEventListener('change',e=>{
    $('importHtmlBtn').disabled=!e.target.files[0];
    if(e.target.files[0])setMessage('htmlMessage',`Siap import lokal: <b>${esc(e.target.files[0].name)}</b>`,'info');
  });
  $('importHtmlBtn').addEventListener('click',async()=>{
    const f=$('pendingHtmlFile').files[0];if(!f)return;
    try{
      state.busy=true;
      const r=await importPendingHtml(f);
      setMessage('htmlMessage',`HTML snapshot dibaca ${r.rows} order: <b>${r.matched} cocok</b>, <b>${r.clearedOldHtml} estimasi HTML lama dibersihkan</b>, ${r.skippedFinal} diabaikan karena Final Excel sudah ada, ${r.skippedLocked} sudah dicairkan estimasi, ${r.unmatched} tidak ada di Master Order, <b>${r.pendingMissingItems.length} Pending Master tidak ada di HTML terbaru</b>. Total nominal file HTML ${money(r.total)}. Semua perubahan masih lokal.`,'success');
      renderHtmlReconciliation(r);
    }catch(e){setMessage('htmlMessage',esc(e.message),'warning');const x=$('htmlReconcile');if(x)x.hidden=true;}
    finally{state.busy=false;renderSettings();}
  });

  ['reportFrom','reportTo','reportSearch'].forEach(x=>$(x).addEventListener('input',renderReport));
  $('reportDateMode').addEventListener('change',()=>{configureReportDateMode();renderReport();});
  $('reportSearchMode').addEventListener('change',()=>{const input=$('reportSearch');input.value='';configureReportSearch();renderReport();});
  $('reportReset').addEventListener('click',()=>{
    $('reportDateMode').value='order';$('reportFrom').value='';$('reportTo').value='';$('reportSearchMode').value='all';$('reportSearch').value='';
    state.reportProducts.clear();state.reportOrderStatuses.clear();configureReportDateMode();configureReportSearch();renderReport();
  });
  $('exportReportBtn').addEventListener('click',exportReport);

  ['pendingFrom','pendingTo','pendingSearch'].forEach(x=>$(x).addEventListener('input',renderPending));
  $('pendingReset').addEventListener('click',()=>{$('pendingFrom').value='';$('pendingTo').value='';$('pendingSearch').value='';state.pendingProducts.clear();state.selectedPending.clear();renderPending();});
  $('pendingSelectAll').addEventListener('change',e=>{const rows=filteredPending().filter(r=>r.state==='pendingEstimated');rows.forEach(r=>e.target.checked?state.selectedPending.add(r.orderNo):state.selectedPending.delete(r.orderNo));renderPending();});
  $('createEstimateBatchBtn').addEventListener('click',()=>createBatch('estimate'));

  ['readyFrom','readyTo','readySearch'].forEach(x=>$(x).addEventListener('input',renderReady));
  $('readyReset').addEventListener('click',()=>{$('readyFrom').value='';$('readyTo').value='';$('readySearch').value='';state.readyProducts.clear();state.selectedReady.clear();renderReady();});
  $('readySelectAll').addEventListener('change',e=>{filteredReady().forEach(r=>e.target.checked?state.selectedReady.add(r.orderNo):state.selectedReady.delete(r.orderNo));renderReady();});
  $('createFinalBatchBtn').addEventListener('click',()=>createBatch('final'));

  $('saveEstimateBtn').addEventListener('click',saveManualEstimate);
  $('exportBatchBtn').addEventListener('click',exportBatches);
  $('syncNowBtn').addEventListener('click',syncServerNow);
  $('resetDbBtn').addEventListener('click',resetDatabase);
}


export async function startApp(ctx){
  firebaseApp=ctx?.firebaseApp||null;auth=ctx?.auth||null;authSignOut=ctx?.signOut||null;
  const user=ctx?.user||auth?.currentUser;
  if(!user||user.uid!==ADMIN_UID)throw new Error('Sesi admin tidak valid.');
  if(!appBound){bind();appBound=true;}
  $('authGate').hidden=true;$('appShell').hidden=false;$('accountEmail').textContent=user.email||user.uid;
  const cached=loadCache();
  if(cached){$('firebaseStatus').textContent=dirtyCount()?`Lokal · ${dirtyCount()} belum sinkron`:'Lokal · tersimpan';renderAll();flash('Data dibuka dari penyimpanan lokal. Firebase hanya digunakan saat Sinkronkan Sekarang ditekan.','success');}
  else{$('firebaseStatus').textContent='Lokal kosong · belum sinkron';renderAll();flash('Belum ada data lokal. Buka Pengaturan → Sinkronkan Sekarang untuk mengambil data Firebase, atau upload Excel untuk mulai lokal.','success');}
}
