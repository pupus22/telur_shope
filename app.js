import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, getDoc, setDoc, deleteDoc, writeBatch, runTransaction } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

(() => {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDYc-6mcJK4NgMfjFL4Xyew2hSixYv51As",
    authDomain: "shopee-payout-b62c3.firebaseapp.com",
    projectId: "shopee-payout-b62c3",
    storageBucket: "shopee-payout-b62c3.firebasestorage.app",
    messagingSenderId: "472652935238",
    appId: "1:472652935238:web:d49c26f38b471c5e69da47"
  };
  const ADMIN_UID = "ISAloBhuHVQwGKzwVLpOXKMcstn2";
  const firebaseApp = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(firebaseApp);
  const db = getFirestore(firebaseApp);
  const STORES = { orders:'orders', incomes:'incomes', batches:'batches', uploads:'uploads', anomalies:'anomalies', edits:'edits' };
  let cache = { orders:[], incomes:[], batches:[], uploads:[], anomalies:[], edits:[] };
  let editingOrderNo = null;
  let appBound = false;
  let dataLoaded = false;
  const productSelections = { report:null, ready:null };

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const APP_VERSION = '1.9.3';
  function on(id, event, handler){
    const el = $(id);
    if(!el){ console.warn(`[${APP_VERSION}] Elemen #${id} tidak ditemukan.`); return false; }
    el.addEventListener(event, handler);
    return true;
  }
  const money = (n) => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(n)||0);
  const localDateTime = (iso) => iso ? new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(iso)) : '-';
  const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  function todayISO(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function dateOnly(v){
    if(v === null || v === undefined || v === '') return '';
    if(v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
    if(typeof v === 'number' && window.XLSX?.SSF?.parse_date_code){ const d=XLSX.SSF.parse_date_code(v); if(d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`; }
    const str=String(v).trim();
    let m=str.match(/^(\d{4})[-\/]([01]?\d)[-\/]([0-3]?\d)/); if(m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    m=str.match(/^([0-3]?\d)[-\/]([01]?\d)[-\/](\d{4})/); if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    return '';
  }
  function normalizeText(v){ return String(v ?? '').trim(); }
  function parseMoney(v){
    if(typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
    const s=String(v ?? '').trim(); if(!s) return 0;
    const neg=s.includes('-'); const digits=s.replace(/[^0-9]/g,''); const n=digits?Number(digits):0; return neg?-n:n;
  }
  function unique(arr){ return [...new Set(arr.filter(Boolean))]; }
  function uid(prefix='ID'){ return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }

  function assertAdmin(){
    const user=auth.currentUser;
    if(!user) throw new Error('Silakan login terlebih dahulu.');
    if(user.uid!==ADMIN_UID) throw new Error('Akun ini tidak diizinkan mengakses database.');
  }
  function orderDocFromLines(orderNo, lines){
    const first=lines[0]||{};
    return {
      orderNo,
      status:first.status||'',
      orderDate:first.orderDate||'',
      orderDateTime:first.orderDateTime||'',
      lastImportedAt:first.lastImportedAt||new Date().toISOString(),
      lastManualEditAt:first.lastManualEditAt||null,
      items:lines.map(x=>({
        lineKey:x.lineKey||'', product:x.product||'', variation:x.variation||'', skuRef:x.skuRef||'',
        quantity:Number(x.quantity)||0, productCount:Number(x.productCount)||0, subtotal:Number(x.subtotal)||0,
        lastImportedAt:x.lastImportedAt||null, lastManualEditAt:x.lastManualEditAt||null
      }))
    };
  }
  function flattenOrderDoc(data, id){
    const orderNo=data.orderNo||id;
    const items=Array.isArray(data.items)?data.items:[];
    return items.map((item,idx)=>({
      lineKey:item.lineKey||`${orderNo}|item|${idx+1}`, orderNo, product:item.product||'', variation:item.variation||'', skuRef:item.skuRef||'',
      status:data.status||'', orderDate:data.orderDate||'', orderDateTime:data.orderDateTime||'',
      quantity:Number(item.quantity)||0, productCount:Number(item.productCount)||0, subtotal:Number(item.subtotal)||0,
      lastImportedAt:item.lastImportedAt||data.lastImportedAt||null, lastManualEditAt:item.lastManualEditAt||data.lastManualEditAt||null
    }));
  }
  async function getAll(store){
    assertAdmin();
    const snap=await getDocs(collection(db,store));
    if(store===STORES.orders){
      return snap.docs.flatMap(d=>flattenOrderDoc(d.data(),d.id));
    }
    return snap.docs.map(d=>({id:d.id,...d.data()})).map(x=>{
      if(store===STORES.incomes && !x.orderNo) x.orderNo=x.id;
      if(store===STORES.batches && !x.batchId) x.batchId=x.id;
      if(store===STORES.uploads && !x.uploadId) x.uploadId=x.id;
      return x;
    });
  }
  async function putMany(store,rows){
    if(!rows.length) return;
    assertAdmin();
    let docs=[];
    if(store===STORES.orders){
      const groups=new Map();
      for(const row of rows){ if(!groups.has(row.orderNo))groups.set(row.orderNo,[]); groups.get(row.orderNo).push(row); }
      docs=[...groups.entries()].map(([id,lines])=>({id,data:orderDocFromLines(id,lines)}));
    }else{
      const keyField=store===STORES.incomes?'orderNo':store===STORES.batches?'batchId':store===STORES.uploads?'uploadId':'id';
      docs=rows.map(r=>({id:String(r[keyField]||r.id),data:{...r}}));
    }
    for(let i=0;i<docs.length;i+=400){
      const wb=writeBatch(db);
      for(const item of docs.slice(i,i+400)) wb.set(doc(db,store,item.id),item.data,{merge:true});
      await wb.commit();
    }
  }
  async function clearStore(store){
    assertAdmin();
    const snap=await getDocs(collection(db,store));
    const refs=snap.docs.map(d=>d.ref);
    for(let i=0;i<refs.length;i+=400){ const wb=writeBatch(db); refs.slice(i,i+400).forEach(r=>wb.delete(r)); await wb.commit(); }
  }
  async function deleteOne(store,key){ assertAdmin(); await deleteDoc(doc(db,store,String(key))); }
  async function deleteMany(store,keys){
    if(!keys.length)return; assertAdmin();
    if(store===STORES.orders){
      const orderNos=unique(cache.orders.filter(x=>keys.includes(x.lineKey)).map(x=>x.orderNo));
      for(const orderNo of orderNos) await deleteOne(store,orderNo);
      return;
    }
    for(let i=0;i<keys.length;i+=400){ const wb=writeBatch(db); keys.slice(i,i+400).forEach(k=>wb.delete(doc(db,store,String(k)))); await wb.commit(); }
  }
  async function reloadCache(){
    const [orders,incomes,batches,uploads,anomalies,edits]=await Promise.all(Object.values(STORES).map(getAll));
    cache={orders,incomes,batches,uploads,anomalies,edits};
    cache.batches.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    cache.uploads.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    cache.edits.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function orderGroups(){
    const m=new Map();
    for(const r of cache.orders){ if(!m.has(r.orderNo))m.set(r.orderNo,[]); m.get(r.orderNo).push(r); }
    return m;
  }
  function incomeMap(){ return new Map(cache.incomes.map(x=>[x.orderNo,x])); }
  function unionRecords(){
    const og=orderGroups(), im=incomeMap(); const keys=new Set([...og.keys(),...im.keys()]);
    return [...keys].map(orderNo=>{
      const lines=og.get(orderNo)||[], inc=im.get(orderNo)||null;
      const first=lines[0]||{};
      const status=!inc?'pending':!lines.length?'incomeOnly':inc.batchId?'batched':'ready';
      return {orderNo,lines,income:inc,status,orderDate:first.orderDate||inc?.orderCreatedDate||'',orderStatus:first.status||'',releasedDate:inc?.releasedDate||'',amount:inc?.amount||0};
    }).sort((a,b)=>(b.releasedDate||b.orderDate).localeCompare(a.releasedDate||a.orderDate)||b.orderNo.localeCompare(a.orderNo));
  }

  function headerIndex(rows, required){
    for(let i=0;i<Math.min(rows.length,15);i++){
      const row=rows[i].map(x=>normalizeText(x));
      if(required.every(h=>row.includes(h))) return i;
    }
    return -1;
  }
  function colMap(header){ const m={}; header.forEach((h,i)=>m[normalizeText(h)]=i); return m; }
  function val(row,map,name){ const i=map[name]; return i===undefined?'':row[i]; }

  async function readWorkbook(file){
    if(!window.XLSX) throw new Error('Library Excel gagal dimuat. Pastikan internet aktif lalu refresh halaman.');
    const buf=await file.arrayBuffer();
    return XLSX.read(buf,{type:'array',cellDates:false,raw:true});
  }
  function sheetRows(wb,nameHint){
    const name=wb.SheetNames.find(n=>n.toLowerCase()===nameHint.toLowerCase()) || wb.SheetNames[0];
    const ws=wb.Sheets[name]; return XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
  }

  function parseOrders(rows){
    const hi=headerIndex(rows,['No. Pesanan','Nama Produk','Nama Variasi','Waktu Pesanan Dibuat']);
    if(hi<0) throw new Error('Header file Order tidak dikenali.');
    const map=colMap(rows[hi]); const counts=new Map(); const output=[];
    for(const row of rows.slice(hi+1)){
      const orderNo=normalizeText(val(row,map,'No. Pesanan')); if(!orderNo) continue;
      const product=normalizeText(val(row,map,'Nama Produk'));
      const variation=normalizeText(val(row,map,'Nama Variasi'));
      const skuRef=normalizeText(val(row,map,'Nomor Referensi SKU'));
      const base=[orderNo,skuRef,product,variation].join('|'); const occ=(counts.get(base)||0)+1; counts.set(base,occ);
      output.push({
        lineKey:`${base}|${occ}`, orderNo, product, variation, skuRef,
        status:normalizeText(val(row,map,'Status Pesanan')),
        orderDate:dateOnly(val(row,map,'Waktu Pesanan Dibuat')),
        orderDateTime:normalizeText(val(row,map,'Waktu Pesanan Dibuat')),
        quantity:Number(val(row,map,'Jumlah'))||0,
        productCount:Number(val(row,map,'Jumlah Produk di Pesan'))||0,
        subtotal:parseMoney(val(row,map,'Subtotal Pesanan')),
        lastImportedAt:new Date().toISOString()
      });
    }
    return output;
  }

  function parseIncomes(rows){
    const hi=headerIndex(rows,['Lihat berdasarkan','No. Pesanan','Total Penghasilan','Tanggal Dana Dilepaskan']);
    if(hi<0) throw new Error('Header sheet Penghasilan pada file Income tidak dikenali.');
    const map=colMap(rows[hi]); const byOrder=new Map(); let ignoredSku=0, duplicateOrderRows=0;
    for(const row of rows.slice(hi+1)){
      const view=normalizeText(val(row,map,'Lihat berdasarkan')).toLowerCase();
      if(view && view!=='order'){ ignoredSku++; continue; }
      const orderNo=normalizeText(val(row,map,'No. Pesanan')); if(!orderNo) continue;
      const rec={
        orderNo,
        amount:parseMoney(val(row,map,'Total Penghasilan')),
        releasedDate:dateOnly(val(row,map,'Tanggal Dana Dilepaskan')),
        orderCreatedDate:dateOnly(val(row,map,'Waktu Pesanan Dibuat')),
        releaseMethod:normalizeText(val(row,map,'Metode Pelepasan Dana')),
        orderType:normalizeText(val(row,map,'Tipe Pesanan')),
        buyer:normalizeText(val(row,map,'Username (Pembeli)')),
        lastImportedAt:new Date().toISOString()
      };
      if(byOrder.has(orderNo)) duplicateOrderRows++;
      byOrder.set(orderNo,rec);
    }
    return {rows:[...byOrder.values()],ignoredSku,duplicateOrderRows};
  }

  async function importFiles(){
    const of=$('orderFile').files[0], inf=$('incomeFile').files[0];
    if(!of||!inf){ setMessage('importMessage','Pilih file Order dan Income terlebih dahulu.','warning'); return; }
    $('importBtn').disabled=true; setMessage('importMessage','Membaca dan memproses dua file…','info');
    try{
      const [owb,iwb]=await Promise.all([readWorkbook(of),readWorkbook(inf)]);
      const orderRows=sheetRows(owb,'orders');
      const incomeSheetName=iwb.SheetNames.find(n=>n.toLowerCase()==='penghasilan')||iwb.SheetNames[0];
      const incomeRows=XLSX.utils.sheet_to_json(iwb.Sheets[incomeSheetName],{header:1,defval:'',raw:true});
      const parsedOrders=parseOrders(orderRows); const parsedIncome=parseIncomes(incomeRows);

      const existingOrderKeys=new Set(cache.orders.map(x=>x.lineKey));
      const existingIncome=new Map(cache.incomes.map(x=>[x.orderNo,x]));
      const anomalies=[]; let changedAfterBatch=0;
      const mergedIncome=parsedIncome.rows.map(n=>{
        const old=existingIncome.get(n.orderNo);
        if(old?.batchId) n.batchId=old.batchId;
        else n.batchId=old?.batchId||null;
        if(old?.batchId && old.amount!==n.amount){
          changedAfterBatch++;
          anomalies.push({id:uid('ANOM'),type:'Pembayaran berubah setelah Pencairan',orderNo:n.orderNo,description:`Nominal master sebelumnya ${money(old.amount)}, upload terbaru ${money(n.amount)}. Batch ${old.batchId} tetap memakai snapshot lama.`,createdAt:new Date().toISOString()});
        }
        return n;
      });

      await putMany(STORES.orders,parsedOrders);
      await putMany(STORES.incomes,mergedIncome);
      await putMany(STORES.anomalies,anomalies);
      const upload={
        uploadId:uid('UP'),createdAt:new Date().toISOString(),orderFile:of.name,incomeFile:inf.name,
        orderLines:parsedOrders.length,orderUnique:new Set(parsedOrders.map(x=>x.orderNo)).size,
        incomeCount:mergedIncome.length,orderNew:parsedOrders.filter(x=>!existingOrderKeys.has(x.lineKey)).length,
        orderUpdated:parsedOrders.filter(x=>existingOrderKeys.has(x.lineKey)).length,
        incomeNew:mergedIncome.filter(x=>!existingIncome.has(x.orderNo)).length,
        incomeUpdated:mergedIncome.filter(x=>existingIncome.has(x.orderNo)).length,
        ignoredSku:parsedIncome.ignoredSku,incomeDuplicateRows:parsedIncome.duplicateOrderRows,changedAfterBatch
      };
      await putMany(STORES.uploads,[upload]); await reloadCache(); renderAll();
      setMessage('importMessage',`Import berhasil. ${upload.orderNew} baris Order baru, ${upload.orderUpdated} diperbarui; ${upload.incomeNew} Pembayaran baru, ${upload.incomeUpdated} diperbarui. ${parsedIncome.ignoredSku} baris SKU Income diabaikan.`,'success');
    }catch(err){ console.error(err); setMessage('importMessage',err.message||String(err),'error'); }
    finally{$('importBtn').disabled=false;}
  }

  function setMessage(id,text,type='info'){ const e=$(id); e.textContent=text; e.className=`message ${type}`; }
  function productHtml(lines){
    if(!lines.length) return '<span class="muted">Order detail tidak ditemukan</span>';
    return `<div class="product-lines">${lines.map(x=>`<div class="product-line"><b>${esc(x.product||'-')}</b><span class="muted">${esc(x.variation||'')}</span>${x.quantity?`<span class="muted">×${x.quantity}</span>`:''}</div>`).join('')}</div>`;
  }
  function productNames(){
    return unique(cache.orders.map(x=>normalizeText(x.product))).sort((a,b)=>a.localeCompare(b,'id'));
  }
  function productSelection(kind){ return productSelections[kind]; }
  function productLineMatchesSelection(line, selection){
    if(selection===null) return true;
    if(!selection.size) return false;
    return selection.has(normalizeText(line.product));
  }
  function productLinesMatchSelection(lines, selection){
    if(selection===null) return true;
    if(!selection.size) return false;
    return lines.some(line=>productLineMatchesSelection(line,selection));
  }
  function productMixInfo(lines, selection){
    if(selection===null || !lines.length) return {active:false,mixed:false,matched:lines.length,total:lines.length};
    if(!selection.size) return {active:true,mixed:false,matched:0,total:lines.length};
    const matched=lines.filter(x=>productLineMatchesSelection(x,selection)).length;
    return {active:true,mixed:matched>0 && matched<lines.length,matched,total:lines.length};
  }
  function productSelectionSummary(kind){
    const sel=productSelection(kind), names=productNames();
    if(sel===null) return 'Semua Produk';
    if(!sel.size) return 'Tidak ada produk dipilih';
    const arr=[...sel].sort((a,b)=>a.localeCompare(b,'id'));
    if(arr.length<=3) return arr.join(' + ');
    return `${arr.length} produk dipilih`;
  }
  function renderProductChoices(kind){
    const box=$(`${kind}ProductChoices`); if(!box) return;
    const names=productNames(), sel=productSelection(kind);
    if(!names.length){ box.innerHTML='<div class="product-picker-empty">Belum ada produk di Master Order. Upload file Order terlebih dahulu.</div>'; return; }
    box.innerHTML=names.map((name,i)=>`<label class="product-check"><input type="checkbox" class="${kind}-product-check" data-product="${esc(name)}" ${sel===null||sel.has(name)?'checked':''}><span>${esc(name)}</span></label>`).join('');
    $$(`.${kind}-product-check`).forEach(cb=>cb.addEventListener('change',()=>{
      const all=$$(`.${kind}-product-check`), checked=all.filter(x=>x.checked).map(x=>x.dataset.product);
      productSelections[kind]=checked.length===all.length?null:new Set(checked);
      if(kind==='report') renderReport(); else renderReady();
    }));
  }
  function selectAllProducts(kind){ productSelections[kind]=null; renderProductChoices(kind); if(kind==='report')renderReport();else renderReady(); }
  function clearAllProducts(kind){ productSelections[kind]=new Set(); renderProductChoices(kind); if(kind==='report')renderReport();else renderReady(); }
  function paymentBadge(rec){
    return rec.income?'<span class="badge paid">Sudah Dibayar Shopee</span>':'<span class="badge pending">Belum Dibayar Shopee</span>';
  }
  function payoutBadge(rec){
    if(!rec.income)return '<span class="badge neutral">-</span>';
    if(rec.income.batchId)return `<span class="badge done">Sudah Dicairkan · ${esc(rec.income.batchId)}</span>`;
    return '<span class="badge ready">Belum Dicairkan</span>';
  }

  function renderDashboard(){
    const u=unionRecords(), inc=cache.incomes, activeIncomes=inc.filter(x=>x.batchId), ready=inc.filter(x=>!x.batchId);
    const groups=orderGroups();
    $('kpiOrders').textContent=groups.size; $('kpiOrderLines').textContent=`${cache.orders.length} baris produk`;
    $('kpiIncome').textContent=money(inc.reduce((s,x)=>s+x.amount,0)); $('kpiIncomeCount').textContent=`${inc.length} pesanan`;
    $('kpiReady').textContent=money(ready.reduce((s,x)=>s+x.amount,0)); $('kpiReadyCount').textContent=`${ready.length} pesanan`;
    $('kpiBatched').textContent=money(activeIncomes.reduce((s,x)=>s+x.amount,0)); $('kpiBatchedCount').textContent=`${activeIncomes.length} pesanan`;
    const counts={pending:0,ready:0,batched:0,incomeOnly:0}; u.forEach(x=>counts[x.status]++);
    $('dashPending').textContent=counts.pending; $('dashReady').textContent=counts.ready; $('dashDone').textContent=counts.batched; $('dashIncomeOnly').textContent=counts.incomeOnly;
    if(cache.uploads[0]){
      const x=cache.uploads[0]; $('latestUpload').innerHTML=`<div class="status-list"><div><span>Waktu</span><strong>${esc(localDateTime(x.createdAt))}</strong></div><div><span>Order</span><strong>${x.orderUnique} pesanan / ${x.orderLines} baris</strong></div><div><span>Pembayaran</span><strong>${x.incomeCount} pesanan</strong></div><div><span>Data baru</span><strong>${x.orderNew} baris Order / ${x.incomeNew} Pembayaran</strong></div></div>`;
    }else $('latestUpload').textContent='Belum ada upload.';

    const dupGroups=[...groups.values()].filter(v=>v.length>1).length;
    const an=[
      ['Pesanan multi-produk (normal)',dupGroups],['Pembayaran tanpa Order',counts.incomeOnly],['Pembayaran berubah setelah Pencairan',cache.anomalies.filter(x=>x.type==='Pembayaran berubah setelah Pencairan').length],['Anomali tersimpan',cache.anomalies.length]
    ];
    $('anomalyGrid').innerHTML=an.map(([a,b])=>`<div class="anomaly-box"><span>${esc(a)}</span><strong>${b}</strong></div>`).join('');
  }

  function renderUploads(){
    $('uploadHistoryBody').innerHTML=cache.uploads.length?cache.uploads.map(x=>`<tr><td>${esc(localDateTime(x.createdAt))}</td><td>${esc(x.orderFile)}</td><td>${esc(x.incomeFile)}</td><td>${x.orderUnique} unik<br><span class="muted">${x.orderLines} baris</span></td><td>${x.incomeCount}</td><td>Order +${x.orderNew} / ~${x.orderUpdated}<br>Pembayaran +${x.incomeNew} / ~${x.incomeUpdated}</td></tr>`).join(''):'<tr><td colspan="6" class="muted">Belum ada riwayat upload.</td></tr>';
  }

  function reportFilter(rec){
    const rf=$('reportReleaseFrom').value, rt=$('reportReleaseTo').value, of=$('reportOrderFrom').value, ot=$('reportOrderTo').value, ps=$('reportPaymentStatus').value, po=$('reportPayoutStatus').value, products=productSelection('report'), q=$('reportSearch').value.trim().toLowerCase();
    if(rf && (!rec.releasedDate || rec.releasedDate<rf))return false; if(rt && (!rec.releasedDate || rec.releasedDate>rt))return false;
    if(of && (!rec.orderDate || rec.orderDate<of))return false; if(ot && (!rec.orderDate || rec.orderDate>ot))return false;
    if(ps==='unpaid' && rec.income)return false; if(ps==='paid' && !rec.income)return false;
    if(po==='notYet' && (!rec.income || rec.income.batchId))return false; if(po==='batched' && (!rec.income || !rec.income.batchId))return false;
    if(!productLinesMatchSelection(rec.lines,products))return false;
    if(q){ const hay=[rec.orderNo,...rec.lines.flatMap(x=>[x.product,x.variation]),rec.orderStatus].join(' ').toLowerCase(); if(!hay.includes(q))return false; }
    return true;
  }
  function currentReport(){return unionRecords().filter(reportFilter);}
  function renderReport(){
    const rows=currentReport();
    const paid=rows.filter(x=>x.income), ready=rows.filter(x=>x.status==='ready'), batched=rows.filter(x=>x.status==='batched');
    const paidTotal=paid.reduce((s,x)=>s+x.amount,0), readyTotal=ready.reduce((s,x)=>s+x.amount,0), batchedTotal=batched.reduce((s,x)=>s+x.amount,0);
    $('reportCount').textContent=rows.length; $('reportIncomeTotal').textContent=money(paidTotal); $('reportPendingCount').textContent=rows.filter(x=>x.status==='pending').length; $('reportReadyCount').textContent=ready.length; $('reportBatchedCount').textContent=batched.length;
    const productLabel=productSelectionSummary('report');
    setMessage('reportSearchNote',`Hasil pencarian/filter · ${productLabel}: ${rows.length} pesanan · Pembayaran Shopee ${money(paidTotal)} · Belum dicairkan ${money(readyTotal)} · Sudah dicairkan ${money(batchedTotal)}.`,'info');
    $('reportBody').innerHTML=rows.length?rows.map(r=>`<tr><td><b>${esc(r.orderNo)}</b>${r.lines.length>1?`<br><span class="muted">${r.lines.length} item dalam 1 pesanan</span>`:''}</td><td>${productHtml(r.lines)}</td><td>${esc(r.orderStatus||'-')}</td><td>${paymentBadge(r)}</td><td class="num">${r.income?money(r.amount):'-'}</td><td>${esc(r.orderDate||'-')}</td><td>${esc(r.releasedDate||'-')}</td><td>${payoutBadge(r)}</td><td><button class="btn ghost edit-order" data-order="${esc(r.orderNo)}">Edit</button></td></tr>`).join(''):'<tr><td colspan="9" class="muted">Tidak ada data sesuai filter.</td></tr>';
    $$('.edit-order').forEach(b=>b.addEventListener('click',()=>showEditOrder(b.dataset.order)));
  }

  function renderPending(){
    const rows=unionRecords().filter(x=>x.status==='pending'); $('pendingCount').textContent=rows.length; $('pendingLines').textContent=rows.reduce((s,x)=>s+x.lines.length,0);
    $('pendingBody').innerHTML=rows.length?rows.map(r=>`<tr><td><b>${esc(r.orderNo)}</b></td><td>${productHtml(r.lines)}</td><td>${esc(r.orderStatus||'-')}</td><td>${esc(r.orderDate||'-')}</td><td><button class="btn ghost edit-order-pending" data-order="${esc(r.orderNo)}">Edit</button></td></tr>`).join(''):'<tr><td colspan="5" class="muted">Tidak ada pesanan yang menunggu Pembayaran Shopee.</td></tr>';
    $$('.edit-order-pending').forEach(b=>b.addEventListener('click',()=>showEditOrder(b.dataset.order)));
  }

  function readyOrderDate(income,groups){
    const lines=groups.get(income.orderNo)||[];
    return lines[0]?.orderDate||income.orderCreatedDate||'';
  }
  function currentReady(){
    const groups=orderGroups(), from=$('readyFrom').value,to=$('readyTo').value,products=productSelection('ready'),q=$('readySearch').value.trim().toLowerCase();
    return cache.incomes.filter(x=>!x.batchId).filter(x=>{
      const lines=groups.get(x.orderNo)||[];
      const d=readyOrderDate(x,groups);
      if(from && (!d||d<from)) return false;
      if(to && (!d||d>to)) return false;
      if(!productLinesMatchSelection(lines,products)) return false;
      if(q){
        const hay=[x.orderNo,...lines.flatMap(line=>[line.product,line.variation,line.status]),readyOrderDate(x,groups),x.releasedDate].join(' ').toLowerCase();
        if(!hay.includes(q)) return false;
      }
      return true;
    }).sort((a,b)=>{
      const da=readyOrderDate(a,groups)||'';
      const db=readyOrderDate(b,groups)||'';
      return db.localeCompare(da)||b.orderNo.localeCompare(a.orderNo);
    });
  }
  function renderReady(){
    const rows=currentReady(), groups=orderGroups(), total=rows.reduce((s,x)=>s+x.amount,0);
    const basisLabel='Tanggal Order';
    const selection=productSelection('ready');
    const selectedSummary=productSelectionSummary('ready');
    const mixed=rows.filter(x=>productMixInfo(groups.get(x.orderNo)||[],selection).mixed);
    $('readyCount').textContent=rows.length; $('readyAmount').textContent=money(total); $('createBatchBtn').disabled=!rows.length;
    setMessage('readySearchNote',`${rows.length} No. Pesanan siap dicairkan · total ${money(total)} · Acuan tanggal: ${basisLabel} · Produk: ${selectedSummary}. Data yang tampil adalah hasil gabungan Order + Income.`,'info');
    const warning=$('productFilterWarning');
    if(selection!==null && selection.size && mixed.length){
      warning.style.display='block';
      warning.textContent=`Perhatian: ${mixed.length} pesanan berisi produk yang Anda centang sekaligus produk lain dalam No. Pesanan yang sama. Karena Income hanya satu nominal per No. Pesanan, seluruh nominal pesanan tersebut ikut batch.`;
    }else if(selection!==null && !selection.size){
      warning.style.display='block'; warning.textContent='Belum ada produk yang dicentang. Pilih minimal satu produk atau tekan “Pilih Semua”.';
    }else{ warning.style.display='none'; warning.textContent=''; }
    $('readyBody').innerHTML=rows.length?rows.map(x=>{
      const lines=groups.get(x.orderNo)||[], mix=productMixInfo(lines,selection);
      return `<tr><td><b>${esc(x.orderNo)}</b>${mix.mixed?'<br><span class="badge pending">Pesanan campuran</span>':''}</td><td>${productHtml(lines)}</td><td>${esc(readyOrderDate(x,groups)||'-')}</td><td>${esc(x.releasedDate||'-')}</td><td class="num"><b>${money(x.amount)}</b></td><td><span class="badge ready">Belum Dicairkan</span></td><td><button class="btn ghost edit-order-ready" data-order="${esc(x.orderNo)}">Edit</button></td></tr>`;
    }).join(''):'<tr><td colspan="7" class="muted">Tidak ada pembayaran yang siap dicairkan pada filter ini.</td></tr>';
    $$('.edit-order-ready').forEach(b=>b.addEventListener('click',()=>showEditOrder(b.dataset.order)));
  }


  function nextBatchId(){
    const d=todayISO().replaceAll('-','');
    const existing=cache.batches.filter(x=>x.batchId.startsWith(`BATCH-${d}-`)).length+1;
    const suffix=Math.random().toString(36).slice(2,5).toUpperCase();
    return `BATCH-${d}-${String(existing).padStart(3,'0')}-${suffix}`;
  }
  async function makeBatch(){
    const rows=currentReady(); if(!rows.length)return;
    const batchId=nextBatchId(), total=rows.reduce((s,x)=>s+x.amount,0), groups=orderGroups();
    const products=productSelection('ready');
    const selectedProducts=products===null?productNames():[...products];
    const productSummary=productSelectionSummary('ready');
    const basisLabel='Tanggal Order';
    const mixed=rows.filter(x=>productMixInfo(groups.get(x.orderNo)||[],products).mixed);
    $('dialogTitle').textContent='Konfirmasi Batch Pencairan'; $('dialogContent').innerHTML=`<p>Pesanan yang masuk batch akan dikunci agar tidak ikut pencairan berikutnya.</p><div class="dialog-summary"><div><span>ID Batch</span><strong>${esc(batchId)}</strong></div><div><span>Jumlah Pesanan</span><strong>${rows.length}</strong></div><div><span>Total Nominal</span><strong>${money(total)}</strong></div><div><span>Acuan Tanggal</span><strong>${esc(basisLabel)}</strong></div><div><span>Periode Filter</span><strong>${esc($('readyFrom').value||'Semua')} – ${esc($('readyTo').value||'Semua')}</strong></div><div><span>Filter Produk</span><strong>${esc(productSummary)}</strong></div><div><span>Pesanan Campuran</span><strong>${mixed.length}</strong></div></div>${mixed.length?`<div class="message warning">${mixed.length} pesanan memiliki produk yang dicentang dan produk lain dalam No. Pesanan yang sama. Seluruh nominal Income pesanan tersebut akan ikut batch.</div>`:''}`;
    const dlg=$('confirmDialog'); dlg.showModal(); const result=await new Promise(resolve=>{const fn=()=>{dlg.removeEventListener('close',fn);resolve(dlg.returnValue)};dlg.addEventListener('close',fn)}); if(result!=='confirm')return;
    if(rows.length>300){ setMessage('batchMessage','Batch terlalu besar untuk satu transaksi aman. Persempit filter menjadi maksimal 300 pesanan per batch.','warning'); return; }
    const createdAt=new Date().toISOString();
    const batch={batchId,createdAt,status:'active',count:rows.length,totalSnapshot:total,filterSnapshot:{dateBasis:'order',dateFrom:$('readyFrom').value||'',dateTo:$('readyTo').value||'',products:selectedProducts,productSummary:productSummary,search:$('readySearch').value.trim()||''},items:rows.map(x=>({orderNo:x.orderNo,amountSnapshot:x.amount,releasedDate:x.releasedDate,orderDate:readyOrderDate(x,groups),productsSnapshot:(groups.get(x.orderNo)||[]).map(line=>({product:line.product||'',variation:line.variation||'',quantity:Number(line.quantity)||0}))}))};
    try{
      await runTransaction(db,async tx=>{
        const incomeRefs=rows.map(x=>doc(db,STORES.incomes,x.orderNo));
        const snaps=[];
        for(const ref of incomeRefs) snaps.push(await tx.get(ref));
        const conflicts=[];
        snaps.forEach((snap,i)=>{ if(!snap.exists()) conflicts.push(`${rows[i].orderNo} (Income hilang)`); else if(snap.data().batchId) conflicts.push(`${rows[i].orderNo} (${snap.data().batchId})`); });
        if(conflicts.length) throw new Error(`Pencairan dibatalkan karena ${conflicts.length} pesanan sudah berubah/masuk batch: ${conflicts.slice(0,5).join(', ')}${conflicts.length>5?'…':''}`);
        tx.set(doc(db,STORES.batches,batchId),batch);
        snaps.forEach((snap,i)=>tx.update(incomeRefs[i],{batchId,lastBatchAt:createdAt}));
      });
      await reloadCache(); renderAll(); setMessage('batchMessage',`${batchId} berhasil dibuat: ${rows.length} pesanan, total ${money(total)}. Firestore mengunci No. Pesanan agar tidak dapat dicairkan ganda.`,'success');
    }catch(err){ console.error(err); setMessage('batchMessage',err.message||String(err),'error'); }
  }


  function renderHistory(){
    $('batchHistoryBody').innerHTML=cache.batches.length?cache.batches.map(b=>`<tr><td><b>${esc(b.batchId)}</b></td><td>${esc(localDateTime(b.createdAt))}</td><td>${b.status==='active'?'<span class="badge done">Aktif</span>':'<span class="badge cancelled">Dibatalkan</span>'}</td><td>${b.count}</td><td class="num">${money(b.totalSnapshot)}</td><td><button class="btn ghost detail-batch" data-id="${esc(b.batchId)}">Detail</button>${b.status==='active'?` <button class="btn ghost cancel-batch" data-id="${esc(b.batchId)}">Batalkan</button>`:''}</td></tr>`).join(''):'<tr><td colspan="6" class="muted">Belum ada Batch Pencairan.</td></tr>';
    $$('.detail-batch').forEach(x=>x.addEventListener('click',()=>showBatch(x.dataset.id))); $$('.cancel-batch').forEach(x=>x.addEventListener('click',()=>cancelBatch(x.dataset.id)));
  }
  function showBatch(id){
    const b=cache.batches.find(x=>x.batchId===id); if(!b)return; $('detailTitle').textContent=b.batchId;
    const fs=b.filterSnapshot||{};
    // kompatibilitas batch versi lama: source=income dianggap Tanggal Dana Dilepas
    const basis=fs.dateBasis || (fs.source==='order'?'order':'released');
    const basisLabel=basis==='order'?'Tanggal Order':'Tanggal Dana Dilepas';
    const periodFrom=fs.dateFrom||fs.releasedFrom||'Semua', periodTo=fs.dateTo||fs.releasedTo||'Semua';
    $('detailSubtitle').textContent=`${b.status==='active'?'Aktif':'Dibatalkan'} · ${localDateTime(b.createdAt)} · ${b.count} pesanan · ${money(b.totalSnapshot)} · Acuan ${basisLabel}: ${periodFrom} – ${periodTo}${(fs.productSummary||fs.product)?` · Produk ${fs.productSummary||fs.product}`:''}`;
    const groups=orderGroups();
    $('detailBatchBody').innerHTML=(b.items||[]).map(x=>{
      const lines=(Array.isArray(x.productsSnapshot)&&x.productsSnapshot.length)?x.productsSnapshot:(groups.get(x.orderNo)||[]);
      const orderDate=x.orderDate || (groups.get(x.orderNo)?.[0]?.orderDate) || '-';
      return `<tr><td class="batch-order-no"><b>${esc(x.orderNo)}</b>${lines.length>1?`<div class="muted batch-item-count">${lines.length} item dalam 1 pesanan</div>`:''}</td><td>${lines.length?productHtml(lines):'<span class="muted">Detail produk tidak ditemukan di Master Order</span>'}</td><td>${esc(orderDate)}</td><td>${esc(x.releasedDate||'-')}</td><td class="num"><b>${money(x.amountSnapshot)}</b></td></tr>`;
    }).join('');
    $('detailDialog').showModal();
  }

  async function cancelBatch(id){
    const b=cache.batches.find(x=>x.batchId===id); if(!b||b.status!=='active')return;
    $('dialogTitle').textContent='Batalkan Batch'; $('dialogContent').innerHTML=`<p>Batch <b>${esc(id)}</b> akan ditandai <b>DIBATALKAN</b>. No. Pesanan di dalamnya akan kembali menjadi Siap Dicairkan.</p><div class="dialog-summary"><div><span>Pesanan</span><strong>${b.count}</strong></div><div><span>Nominal Snapshot</span><strong>${money(b.totalSnapshot)}</strong></div></div>`;
    const dlg=$('confirmDialog'); dlg.showModal(); const result=await new Promise(resolve=>{const fn=()=>{dlg.removeEventListener('close',fn);resolve(dlg.returnValue)};dlg.addEventListener('close',fn)}); if(result!=='confirm')return;
    const updatedBatch={...b,status:'cancelled',cancelledAt:new Date().toISOString()}; const ids=new Set(b.items.map(x=>x.orderNo)); const incomeUpdates=cache.incomes.filter(x=>ids.has(x.orderNo)&&x.batchId===id).map(x=>({...x,batchId:null})); await putMany(STORES.batches,[updatedBatch]); await putMany(STORES.incomes,incomeUpdates); await reloadCache(); renderAll();
  }

  function recalcBatch(batch){
    const items=batch.items||[];
    return {...batch,count:items.length,totalSnapshot:items.reduce((s,x)=>s+(Number(x.amountSnapshot)||0),0)};
  }
  async function updateBatchMembership(oldOrderNo,newOrderNo,oldBatchId,newBatchId,amount,releasedDate){
    const changed=[];
    for(const b0 of cache.batches){
      let b={...b0,items:(b0.items||[]).map(x=>({...x}))};
      const before=JSON.stringify(b.items);
      b.items=b.items.filter(x=>x.orderNo!==oldOrderNo && x.orderNo!==newOrderNo);
      if(b.batchId===newBatchId){
        const groups=orderGroups();
        const lines=groups.get(newOrderNo)||[];
        b.items.push({orderNo:newOrderNo,amountSnapshot:Number(amount)||0,releasedDate:releasedDate||'',orderDate:lines[0]?.orderDate||'',productsSnapshot:lines.map(line=>({product:line.product||'',variation:line.variation||'',quantity:Number(line.quantity)||0}))});
      }
      if(JSON.stringify(b.items)!==before || b.batchId===oldBatchId || b.batchId===newBatchId){ changed.push(recalcBatch(b)); }
    }
    if(changed.length) await putMany(STORES.batches,changed);
  }
  function showEditOrder(orderNo){
    const rec=unionRecords().find(x=>x.orderNo===orderNo); if(!rec)return;
    editingOrderNo=orderNo;
    $('editOrderNo').value=orderNo;
    $('editOrderStatus').value=rec.orderStatus||'';
    $('editOrderDate').value=rec.orderDate||'';
    $('editIncomeAmount').value=rec.income?rec.amount:'';
    $('editReleasedDate').value=rec.releasedDate||'';
    const active=cache.batches.filter(b=>b.status==='active');
    $('editBatchId').innerHTML='<option value="">Belum Dicairkan</option>'+active.map(b=>`<option value="${esc(b.batchId)}">Sudah Dicairkan · ${esc(b.batchId)}</option>`).join('');
    $('editBatchId').value=rec.income?.batchId||'';
    $('editLines').innerHTML=rec.lines.length?rec.lines.map((line,i)=>`<div class="edit-line" data-key="${esc(line.lineKey)}"><div class="edit-line-no">Item ${i+1}</div><label>Nama Produk<input class="edit-product" type="text" value="${esc(line.product||'')}"></label><label>Variasi<input class="edit-variation" type="text" value="${esc(line.variation||'')}"></label><label>Jumlah<input class="edit-qty" type="number" min="0" step="1" value="${Number(line.quantity)||0}"></label></div>`).join(''):'<div class="message warning">Detail Order belum ada. Anda tetap dapat mengedit Pembayaran dan status Pencairan.</div>';
    setMessage('editMessage','Pembayaran = dana yang dilepas Shopee ke saldo. Pencairan = Batch yang Anda buat. Keduanya disimpan terpisah.','info');
    $('editDialog').showModal();
  }
  async function saveEditOrder(){
    if(!editingOrderNo)return;
    const oldNo=editingOrderNo, newNo=normalizeText($('editOrderNo').value);
    if(!newNo){setMessage('editMessage','No. Pesanan tidak boleh kosong.','error');return;}
    if(newNo!==oldNo && unionRecords().some(x=>x.orderNo===newNo) && !confirm(`No. Pesanan ${newNo} sudah ada. Data akan digabung ke No. Pesanan tersebut. Lanjutkan?`))return;
    const oldLines=cache.orders.filter(x=>x.orderNo===oldNo), oldIncome=cache.incomes.find(x=>x.orderNo===oldNo)||null;
    const lineNodes=[...$('editLines').querySelectorAll('.edit-line')];
    const updatedLines=oldLines.map((line,i)=>{
      const node=lineNodes[i];
      return {...line,orderNo:newNo,status:normalizeText($('editOrderStatus').value),orderDate:$('editOrderDate').value||'',product:node?normalizeText(node.querySelector('.edit-product').value):line.product,variation:node?normalizeText(node.querySelector('.edit-variation').value):line.variation,quantity:node?Math.max(0,Number(node.querySelector('.edit-qty').value)||0):line.quantity,lastManualEditAt:new Date().toISOString()};
    });
    const amountRaw=$('editIncomeAmount').value, released=$('editReleasedDate').value||'', batchId=$('editBatchId').value||null;
    const hasIncome=amountRaw!=='' || released!=='' || !!oldIncome;
    const amount=Math.max(0,Number(amountRaw)||0);
    if(oldIncome && newNo!==oldNo) await deleteOne(STORES.incomes,oldNo);
    let linesToSave=updatedLines;
    if(newNo!==oldNo){
      const targetExisting=cache.orders.filter(x=>x.orderNo===newNo);
      linesToSave=[...targetExisting,...updatedLines.map((x,i)=>({...x,lineKey:x.lineKey.replace(oldNo,newNo)||`${newNo}|manual|${i+1}`}))];
      await deleteOne(STORES.orders,oldNo);
    }
    if(linesToSave.length) await putMany(STORES.orders,linesToSave);
    if(hasIncome){
      const income={...(oldIncome||{}),orderNo:newNo,amount,releasedDate:released,orderCreatedDate:$('editOrderDate').value||oldIncome?.orderCreatedDate||'',batchId,lastManualEditAt:new Date().toISOString()};
      await putMany(STORES.incomes,[income]);
      await updateBatchMembership(oldNo,newNo,oldIncome?.batchId||null,batchId,amount,released);
    }else if(oldIncome){ await deleteOne(STORES.incomes,oldNo); await updateBatchMembership(oldNo,newNo,oldIncome.batchId||null,null,0,''); }
    await putMany(STORES.edits,[{id:uid('EDIT'),createdAt:new Date().toISOString(),orderNoBefore:oldNo,orderNoAfter:newNo,description:`Edit manual master: ${oldLines.length} baris Order; pembayaran ${hasIncome?money(amount):'tidak ada'}; pencairan ${batchId||'belum dicairkan'}.`}]);
    await reloadCache(); renderAll(); $('editDialog').close(); editingOrderNo=null;
  }
  async function deleteEditedOrder(){
    if(!editingOrderNo)return;
    const orderNo=editingOrderNo, lines=cache.orders.filter(x=>x.orderNo===orderNo), inc=cache.incomes.find(x=>x.orderNo===orderNo)||null;
    if(!confirm(`Hapus data master untuk No. Pesanan ${orderNo}? Riwayat edit tetap dicatat.`))return;
    await deleteMany(STORES.orders,lines.map(x=>x.lineKey));
    if(inc){ await deleteOne(STORES.incomes,orderNo); await updateBatchMembership(orderNo,orderNo,inc.batchId||null,null,0,''); }
    await putMany(STORES.edits,[{id:uid('EDIT'),createdAt:new Date().toISOString(),orderNoBefore:orderNo,orderNoAfter:'',description:'Data Order/Pembayaran dihapus manual dari master.'}]);
    await reloadCache();renderAll();$('editDialog').close();editingOrderNo=null;
  }

  function renderRecon(){
    const total=cache.incomes.reduce((s,x)=>s+x.amount,0), bat=cache.incomes.filter(x=>x.batchId), ready=cache.incomes.filter(x=>!x.batchId), batTotal=bat.reduce((s,x)=>s+x.amount,0), readyTotal=ready.reduce((s,x)=>s+x.amount,0), diff=total-batTotal-readyTotal;
    $('reconIncome').textContent=money(total); $('reconIncomeN').textContent=`${cache.incomes.length} pesanan`; $('reconBatched').textContent=money(batTotal); $('reconBatchedN').textContent=`${bat.length} pesanan`; $('reconReady').textContent=money(readyTotal); $('reconReadyN').textContent=`${ready.length} pesanan`; $('reconDiff').textContent=money(diff);
    setMessage('reconMessage',diff===0?'Rekonsiliasi seimbang. Semua Pembayaran terbagi antara Sudah Dicairkan dan Belum Dicairkan.':`Ada selisih ${money(diff)}. Data perlu diperiksa.`,diff===0?'success':'error');
    const union=unionRecords(), rows=[...cache.anomalies]; union.filter(x=>x.status==='incomeOnly').forEach(x=>rows.push({type:'Pembayaran tanpa Order',orderNo:x.orderNo,description:'No. Pesanan ada pada file pembayaran (Income) tetapi detail Order belum ada di master.'}));
    $('anomalyBody').innerHTML=rows.length?rows.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).map(x=>`<tr><td>${esc(x.type)}</td><td>${esc(x.orderNo||'-')}</td><td>${esc(x.description||'-')}</td></tr>`).join(''):'<tr><td colspan="3" class="muted">Tidak ada anomali yang perlu diperiksa.</td></tr>';
  }

  function renderEditHistory(){ const body=$('editHistoryBody'); if(!body)return; body.innerHTML=cache.edits.length?cache.edits.slice(0,100).map(x=>`<tr><td>${esc(localDateTime(x.createdAt))}</td><td>${esc(x.orderNoBefore||'-')}</td><td>${esc(x.orderNoAfter||'-')}</td><td>${esc(x.description||'-')}</td></tr>`).join(''):'<tr><td colspan="4" class="muted">Belum ada edit manual.</td></tr>'; }
  function renderAll(){ renderProductChoices('report');renderProductChoices('ready');renderDashboard();renderUploads();renderReport();renderPending();renderReady();renderHistory();renderRecon();renderEditHistory(); $('dbStatus').textContent=`Master: ${orderGroups().size} order · ${cache.incomes.length} pembayaran`; }

  function exportXlsxReport(){
    if(!window.XLSX){alert('Library Excel belum tersedia.');return;} const rows=currentReport();
    const detail=rows.map(r=>({
      'No. Pesanan':r.orderNo,'Nama Produk':r.lines.map(x=>x.product).join(' | '),'Variasi':r.lines.map(x=>x.variation).join(' | '),'Status':r.orderStatus||'',
      'Pembayaran':r.income?r.amount:'','Tanggal Order':r.orderDate||'','Tanggal Pembayaran / Dana Dilepas':r.releasedDate||'','Status Pencairan':r.income?.batchId|| (r.status==='ready'?'Belum Dicairkan':r.status==='pending'?'Belum Dibayar Shopee':'')
    }));
    const wb=XLSX.utils.book_new(), ws=XLSX.utils.json_to_sheet(detail); XLSX.utils.book_append_sheet(wb,ws,'Laporan'); const sum=XLSX.utils.aoa_to_sheet([['Jumlah Pesanan',rows.length],['Total Penghasilan',rows.reduce((s,x)=>s+x.amount,0)]]); XLSX.utils.book_append_sheet(wb,sum,'Ringkasan'); XLSX.writeFile(wb,`Laporan_Pembayaran_Pencairan_${todayISO()}.xlsx`);
  }
  function exportBatchXlsx(){
    if(!window.XLSX){alert('Library Excel belum tersedia.');return;} const rows=[]; const groups=orderGroups(); cache.batches.forEach(b=>b.items.forEach(i=>{const lines=(Array.isArray(i.productsSnapshot)&&i.productsSnapshot.length)?i.productsSnapshot:(groups.get(i.orderNo)||[]); rows.push({'ID Batch':b.batchId,'Status':b.status,'Dibuat':b.createdAt,'No. Pesanan':i.orderNo,'Produk / Variasi':lines.map(x=>`${x.product||'-'}${x.variation?` | ${x.variation}`:''}${x.quantity?` x${x.quantity}`:''}`).join(' ; '),'Tanggal Order':i.orderDate||lines[0]?.orderDate||'','Tanggal Dana Dilepas':i.releasedDate,'Nominal Snapshot':i.amountSnapshot});})); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Riwayat Batch'); XLSX.writeFile(wb,`Riwayat_Batch_${todayISO()}.xlsx`);
  }

  function downloadJson(name,obj){ const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  function exportBackup(){downloadJson(`backup_shopee_payout_${todayISO()}.json`,{version:1,exportedAt:new Date().toISOString(),data:cache});setMessage('backupMessage','Backup JSON berhasil dibuat. Simpan file ini dengan aman.','success');}
  async function importBackup(file){
    try{const raw=JSON.parse(await file.text());if(!raw?.data)throw new Error('Format backup tidak valid.');for(const [k,store] of Object.entries(STORES)){await clearStore(store);await putMany(store,Array.isArray(raw.data[k])?raw.data[k]:[]);}await reloadCache();renderAll();setMessage('backupMessage','Backup berhasil dipulihkan.','success');}catch(e){setMessage('backupMessage',e.message||String(e),'error');}
  }
  async function resetDb(){
    $('dialogTitle').textContent='Hapus Semua Data Firebase'; $('dialogContent').innerHTML='<p>Semua Order Master, Pembayaran Master, Batch Pencairan, riwayat upload, log edit, dan anomali pada Firestore akan dihapus. Tindakan ini tidak dapat dibatalkan kecuali Anda punya backup JSON.</p>'; const dlg=$('confirmDialog');dlg.showModal();const result=await new Promise(resolve=>{const fn=()=>{dlg.removeEventListener('close',fn);resolve(dlg.returnValue)};dlg.addEventListener('close',fn)});if(result!=='confirm')return;for(const s of Object.values(STORES))await clearStore(s);await reloadCache();renderAll();setMessage('backupMessage','Semua data Firebase sudah dihapus.','warning');
  }

  const viewMeta={dashboard:['Dashboard','Ringkasan Order, Pembayaran Shopee, dan Pencairan.'],upload:['Upload Data','Import snapshot Order dan Income terbaru ke master.'],report:['Laporan Gabungan','Pembayaran dan Pencairan dipisahkan, dengan total mengikuti filter/pencarian.'],pending:['Pending Pembayaran','Order yang belum ditemukan pada file pembayaran (Income).'],ready:['Siap Dicairkan','Pembayaran sudah masuk saldo Shopee tetapi belum masuk Batch Pencairan.'],history:['Riwayat Batch','Audit pencairan dan pembatalan batch.'],recon:['Rekonsiliasi','Pemeriksaan keseimbangan Pembayaran dan Pencairan.'],settings:['Backup & Data','Backup, restore, log edit, dan reset database Firebase.']};
  function switchView(name){ $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`)); $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===name)); $('pageTitle').textContent=viewMeta[name][0]; $('pageSubtitle').textContent=viewMeta[name][1]; window.scrollTo({top:0,behavior:'smooth'}); }

  function bind(){
    $$('.nav-btn').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    $$('[data-go]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.go)));

    on('orderFile','change',()=>{ const f=$('orderFile')?.files?.[0]; if($('orderFileName')) $('orderFileName').textContent=f?.name||'Belum dipilih'; });
    on('incomeFile','change',()=>{ const f=$('incomeFile')?.files?.[0]; if($('incomeFileName')) $('incomeFileName').textContent=f?.name||'Belum dipilih'; });
    on('clearFilesBtn','click',()=>{ if($('orderFile')) $('orderFile').value=''; if($('incomeFile')) $('incomeFile').value=''; if($('orderFileName')) $('orderFileName').textContent='Belum dipilih'; if($('incomeFileName')) $('incomeFileName').textContent='Belum dipilih'; setMessage('importMessage','Pilihan file dikosongkan.','info'); });
    on('importBtn','click',importFiles);

    ['reportReleaseFrom','reportReleaseTo','reportOrderFrom','reportOrderTo','reportPaymentStatus','reportPayoutStatus'].forEach(id=>on(id,'change',renderReport));
    on('reportSearch','input',renderReport);
    on('reportProductAll','click',()=>selectAllProducts('report'));
    on('reportProductNone','click',()=>clearAllProducts('report'));
    on('exportReportBtn','click',exportXlsxReport);

    ['readyFrom','readyTo'].forEach(id=>on(id,'change',renderReady));
    on('readySearch','input',renderReady);
    on('readyProductAll','click',()=>selectAllProducts('ready'));
    on('readyProductNone','click',()=>clearAllProducts('ready'));
    on('resetReadyFilter','click',()=>{ if($('readyFrom')) $('readyFrom').value=''; if($('readyTo')) $('readyTo').value=''; if($('readySearch')) $('readySearch').value=''; productSelections.ready=null; renderProductChoices('ready'); renderReady(); });
    on('createBatchBtn','click',makeBatch);

    on('exportBatchBtn','click',exportBatchXlsx);
    on('closeEditBtn','click',()=>{ $('editDialog')?.close(); editingOrderNo=null; });
    on('saveEditBtn','click',saveEditOrder);
    on('deleteMasterBtn','click',deleteEditedOrder);
    on('exportBackupBtn','click',exportBackup);
    on('importBackupFile','change',e=>e.target.files[0]&&importBackup(e.target.files[0]));
    on('resetDbBtn','click',resetDb);
  }

  function showLogin(message='Silakan masuk dengan akun admin Firebase.'){
    if($('authGate')) $('authGate').hidden=false;
    if($('appShell')) $('appShell').hidden=true;
    if($('loginMessage')) setMessage('loginMessage',message,'info');
  }
  async function loadFirebaseData(user){
    if(!user) return showLogin();
    if(user.uid!==ADMIN_UID){
      await signOut(auth);
      showLogin('Akun ini bukan admin yang diizinkan oleh Firestore Rules.');
      return;
    }
    if($('authGate')) $('authGate').hidden=true;
    if($('appShell')) $('appShell').hidden=false;
    if($('userEmail')) $('userEmail').textContent=user.email||user.uid;
    if(!appBound){ bind(); appBound=true; }
    try{
      if($('dbStatus')) $('dbStatus').textContent='Memuat Firestore…';
      await reloadCache();
      renderAll();
      dataLoaded=true;
      if($('dbStatus')) $('dbStatus').textContent=`Firebase: ${orderGroups().size} order · ${cache.incomes.length} pembayaran · v${APP_VERSION}`;
    }catch(e){
      console.error('Firestore gagal dimuat',e);
      if($('dbStatus')) $('dbStatus').textContent='Firestore gagal dimuat';
      alert('Firestore gagal dimuat: '+(e?.message||e)+'\n\nCek Firestore Rules, koneksi internet, dan Authorized domains.');
    }
  }
  function initAuth(){
    const form=$('loginForm');
    if(form){
      form.addEventListener('submit',async e=>{
        e.preventDefault();
        const email=$('loginEmail').value.trim(), password=$('loginPassword').value;
        if(!email||!password){ setMessage('loginMessage','Email dan password wajib diisi.','warning'); return; }
        $('loginBtn').disabled=true; setMessage('loginMessage','Memeriksa akun Firebase…','info');
        try{
          const cred=await signInWithEmailAndPassword(auth,email,password);
          if(cred.user.uid!==ADMIN_UID){ await signOut(auth); throw new Error('Akun berhasil login tetapi UID bukan admin yang diizinkan.'); }
          setMessage('loginMessage','Login berhasil. Memuat Firestore…','success');
        }catch(err){ console.error(err); setMessage('loginMessage',err.message||String(err),'error'); }
        finally{$('loginBtn').disabled=false;}
      });
    }
    on('logoutBtn','click',async()=>{ await signOut(auth); cache={orders:[],incomes:[],batches:[],uploads:[],anomalies:[],edits:[]}; dataLoaded=false; });
    onAuthStateChanged(auth,user=>{ if(user) loadFirebaseData(user); else showLogin(); });
  }
  function init(){ initAuth(); }

  init();
})();
