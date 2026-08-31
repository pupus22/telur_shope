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
  let estimatingOrderNo = null;
  let appBound = false;
  let dataLoaded = false;
  const productSelections = { report:null, pending:null, ready:null };

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const APP_VERSION = '1.13.2';
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
      cancelReason:first.cancelReason||'',
      orderDate:first.orderDate||'',
      orderDateTime:first.orderDateTime||'',
      lastImportedAt:first.lastImportedAt||new Date().toISOString(),
      lastManualEditAt:first.lastManualEditAt||null,
      estimateBatchId:first.estimateBatchId||null,
      estimatePaidAmount:Number(first.estimatePaidAmount)||0,
      estimatePaidAt:first.estimatePaidAt||null,
      estimatePaidSource:first.estimatePaidSource||null,
      correctionSettledBatchId:first.correctionSettledBatchId||null,
      shopeePendingAmount:Number(first.shopeePendingAmount)||0,
      shopeePendingStatus:first.shopeePendingStatus||'',
      shopeePendingReleaseEstimate:first.shopeePendingReleaseEstimate||'',
      shopeePendingPaymentMethod:first.shopeePendingPaymentMethod||'',
      shopeePendingImportedAt:first.shopeePendingImportedAt||null,
      shopeePendingSourceFile:first.shopeePendingSourceFile||'',
      items:lines.map(x=>({
        lineKey:x.lineKey||'', product:x.product||'', variation:x.variation||'', skuRef:x.skuRef||'',
        quantity:Number(x.quantity)||0, productCount:Number(x.productCount)||0, subtotal:Number(x.subtotal)||0,
        estimateUnit:Number(x.estimateUnit)||0, estimateSubtotal:Number(x.estimateSubtotal)||0,
        estimateUpdatedAt:x.estimateUpdatedAt||null,
        lastImportedAt:x.lastImportedAt||null, lastManualEditAt:x.lastManualEditAt||null
      }))
    };
  }
  function flattenOrderDoc(data, id){
    const orderNo=data.orderNo||id;
    const items=Array.isArray(data.items)?data.items:[];
    return items.map((item,idx)=>({
      lineKey:item.lineKey||`${orderNo}|item|${idx+1}`, orderNo, product:item.product||'', variation:item.variation||'', skuRef:item.skuRef||'',
      status:data.status||'', cancelReason:data.cancelReason||'', orderDate:data.orderDate||'', orderDateTime:data.orderDateTime||'',
      quantity:Number(item.quantity)||0, productCount:Number(item.productCount)||0, subtotal:Number(item.subtotal)||0,
      estimateUnit:Number(item.estimateUnit)||0, estimateSubtotal:Number(item.estimateSubtotal)||0, estimateUpdatedAt:item.estimateUpdatedAt||null,
      estimateBatchId:data.estimateBatchId||null, estimatePaidAmount:Number(data.estimatePaidAmount)||0, estimatePaidAt:data.estimatePaidAt||null,
      estimatePaidSource:data.estimatePaidSource||null,
      correctionSettledBatchId:data.correctionSettledBatchId||null,
      shopeePendingAmount:Number(data.shopeePendingAmount)||0,
      shopeePendingStatus:data.shopeePendingStatus||'',
      shopeePendingReleaseEstimate:data.shopeePendingReleaseEstimate||'',
      shopeePendingPaymentMethod:data.shopeePendingPaymentMethod||'',
      shopeePendingImportedAt:data.shopeePendingImportedAt||null,
      shopeePendingSourceFile:data.shopeePendingSourceFile||'',
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
  function isCancelledStatus(status){
    const s=normalizeText(status).toLowerCase();
    return s==='batal' || s.startsWith('batal ') || s.includes('dibatalkan');
  }
  function unionRecords(){
    const og=orderGroups(), im=incomeMap(); const keys=new Set([...og.keys(),...im.keys()]);
    return [...keys].map(orderNo=>{
      const lines=og.get(orderNo)||[], inc=im.get(orderNo)||null;
      const first=lines[0]||{};
      const orderStatus=first.status||'';
      const isCancelled=!!lines.length && isCancelledStatus(orderStatus);
      let status;
      if(!lines.length && inc) status='incomeOnly';
      else if(isCancelled) status='cancelled';
      else if(!inc) status='pending';
      else if(inc.batchId) status='batched';
      else status='ready';
      const manualEstimateTotal=lines.reduce((sum,line)=>sum+(Number(line.estimateSubtotal)||0),0);
      const manualEstimateComplete=!!lines.length && lines.every(line=>(Number(line.estimateSubtotal)||0)>0);
      const shopeePendingAmount=Number(first.shopeePendingAmount)||0;
      const hasShopeePending=!!first.shopeePendingImportedAt && shopeePendingAmount>0;
      const estimateTotal=hasShopeePending?shopeePendingAmount:manualEstimateTotal;
      const estimateComplete=hasShopeePending || manualEstimateComplete;
      const estimateSource=hasShopeePending?'shopeeHtml':(manualEstimateTotal>0?'manual':null);
      const estimateBatchId=first.estimateBatchId||null;
      const estimatePaidAmount=Number(first.estimatePaidAmount)||0;
      const estimatePaidSource=first.estimatePaidSource||null;
      const correctionDelta=(inc && estimatePaidAmount)?(Number(inc.amount)||0)-estimatePaidAmount:0;
      const correctionSettledBatchId=first.correctionSettledBatchId||null;
      return {orderNo,lines,income:inc,status,isCancelled,orderDate:first.orderDate||inc?.orderCreatedDate||'',orderStatus,cancelReason:first.cancelReason||'',releasedDate:inc?.releasedDate||'',amount:inc?.amount||0,manualEstimateTotal,manualEstimateComplete,shopeePendingAmount,shopeePendingStatus:first.shopeePendingStatus||'',shopeePendingReleaseEstimate:first.shopeePendingReleaseEstimate||'',shopeePendingPaymentMethod:first.shopeePendingPaymentMethod||'',shopeePendingImportedAt:first.shopeePendingImportedAt||null,shopeePendingSourceFile:first.shopeePendingSourceFile||'',estimateTotal,estimateComplete,estimateSource,estimateBatchId,estimatePaidAmount,estimatePaidSource,estimatePaidAt:first.estimatePaidAt||null,correctionDelta,correctionSettledBatchId};
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
        cancelReason:normalizeText(val(row,map,'Alasan Pembatalan')),
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
    const map=colMap(rows[hi]); const byOrder=new Map(); const skuByOrder=new Map(); let skuCount=0, duplicateOrderRows=0;
    for(const row of rows.slice(hi+1)){
      const view=normalizeText(val(row,map,'Lihat berdasarkan')).toLowerCase();
      const orderNo=normalizeText(val(row,map,'No. Pesanan')); if(!orderNo) continue;
      if(view==='sku'){
        skuCount++;
        if(!skuByOrder.has(orderNo)) skuByOrder.set(orderNo,[]);
        skuByOrder.get(orderNo).push({
          productId:normalizeText(val(row,map,'ID Produk')),
          product:normalizeText(val(row,map,'Nama Produk')),
          amount:parseMoney(val(row,map,'Total Penghasilan')),
          productPrice:parseMoney(val(row,map,'Harga Produk'))
        });
        continue;
      }
      if(view && view!=='order') continue;
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
    for(const [orderNo,details] of skuByOrder){
      const rec=byOrder.get(orderNo);
      if(rec) rec.skuDetails=details;
    }
    return {rows:[...byOrder.values()],skuCount,duplicateOrderRows};
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
      const existingByLine=new Map(cache.orders.map(x=>[x.lineKey,x]));
      const existingGroups=orderGroups();
      const usedEstimateLineKeys=new Set();
      const mergedOrders=parsedOrders.map(n=>{
        let old=existingByLine.get(n.lineKey);
        if(old) usedEstimateLineKeys.add(old.lineKey);
        if(!old){
          old=(existingGroups.get(n.orderNo)||[]).find(x=>!usedEstimateLineKeys.has(x.lineKey) && normalizeText(x.product)===normalizeText(n.product) && normalizeText(x.variation)===normalizeText(n.variation) && normalizeText(x.skuRef)===normalizeText(n.skuRef));
          if(old) usedEstimateLineKeys.add(old.lineKey);
        }
        const state=(existingGroups.get(n.orderNo)||[])[0]||{};
        return {...n,
          estimateUnit:Number(old?.estimateUnit)||0,
          estimateSubtotal:Number(old?.estimateSubtotal)||0,
          estimateUpdatedAt:old?.estimateUpdatedAt||null,
          estimateBatchId:state.estimateBatchId||null,
          estimatePaidAmount:Number(state.estimatePaidAmount)||0,
          estimatePaidAt:state.estimatePaidAt||null,
          estimatePaidSource:state.estimatePaidSource||null,
          correctionSettledBatchId:state.correctionSettledBatchId||null,
          shopeePendingAmount:Number(state.shopeePendingAmount)||0,
          shopeePendingStatus:state.shopeePendingStatus||'',
          shopeePendingReleaseEstimate:state.shopeePendingReleaseEstimate||'',
          shopeePendingPaymentMethod:state.shopeePendingPaymentMethod||'',
          shopeePendingImportedAt:state.shopeePendingImportedAt||null,
          shopeePendingSourceFile:state.shopeePendingSourceFile||''
        };
      });
      const mergedOrderGroups=new Map();
      for(const r of mergedOrders){if(!mergedOrderGroups.has(r.orderNo))mergedOrderGroups.set(r.orderNo,[]);mergedOrderGroups.get(r.orderNo).push(r);}

      const existingIncome=new Map(cache.incomes.map(x=>[x.orderNo,x]));
      const anomalies=[]; let changedAfterBatch=0;
      const mergedIncome=parsedIncome.rows.map(n=>{
        const old=existingIncome.get(n.orderNo);
        const orderState=(mergedOrderGroups.get(n.orderNo)||existingGroups.get(n.orderNo)||[])[0]||{};
        if(old?.batchId) n.batchId=old.batchId;
        else if(orderState.estimateBatchId) n.batchId=orderState.estimateBatchId;
        else n.batchId=null;
        if(old?.batchId && old.amount!==n.amount){
          changedAfterBatch++;
          anomalies.push({id:uid('ANOM'),type:'Pembayaran berubah setelah Pencairan',orderNo:n.orderNo,description:`Nominal master sebelumnya ${money(old.amount)}, upload terbaru ${money(n.amount)}. Batch ${old.batchId} tetap memakai snapshot lama.`,createdAt:new Date().toISOString()});
        }
        return n;
      });

      await putMany(STORES.orders,mergedOrders);
      await putMany(STORES.incomes,mergedIncome);
      await putMany(STORES.anomalies,anomalies);
      const upload={
        uploadId:uid('UP'),createdAt:new Date().toISOString(),orderFile:of.name,incomeFile:inf.name,
        orderLines:mergedOrders.length,orderUnique:new Set(mergedOrders.map(x=>x.orderNo)).size,
        incomeCount:mergedIncome.length,orderNew:mergedOrders.filter(x=>!existingOrderKeys.has(x.lineKey)).length,
        orderUpdated:mergedOrders.filter(x=>existingOrderKeys.has(x.lineKey)).length,
        incomeNew:mergedIncome.filter(x=>!existingIncome.has(x.orderNo)).length,
        incomeUpdated:mergedIncome.filter(x=>existingIncome.has(x.orderNo)).length,
        skuDetailRows:parsedIncome.skuCount,incomeDuplicateRows:parsedIncome.duplicateOrderRows,changedAfterBatch
      };
      await putMany(STORES.uploads,[upload]); await reloadCache(); renderAll();
      setMessage('importMessage',`Import berhasil. ${upload.orderNew} baris Order baru, ${upload.orderUpdated} diperbarui; ${upload.incomeNew} Pembayaran baru, ${upload.incomeUpdated} diperbarui. ${parsedIncome.skuCount} baris SKU Income disimpan sebagai rincian final per produk.`,'success');
    }catch(err){ console.error(err); setMessage('importMessage',err.message||String(err),'error'); }
    finally{$('importBtn').disabled=false;}
  }

  function setMessage(id,text,type='info'){ const e=$(id); e.textContent=text; e.className=`message ${type}`; }
  function productHtml(lines){
    if(!lines.length) return '<span class="muted">Order detail tidak ditemukan</span>';
    return `<div class="product-lines">${lines.map(x=>`<div class="product-line"><b>${esc(x.product||'-')}</b><span class="muted">${esc(x.variation||'')}</span>${x.quantity?`<span class="muted">×${x.quantity}</span>`:''}</div>`).join('')}</div>`;
  }
  function estimateProductHtml(lines){
    if(!lines.length) return '<span class="muted">Order detail tidak ditemukan</span>';
    return `<div class="product-lines">${lines.map(x=>`<div class="product-line pending-product-line"><b>${esc(x.product||'-')}</b><span class="muted">${esc(x.variation||'')}</span>${x.quantity?`<span class="muted">×${x.quantity}</span>`:''}<span class="line-estimate ${Number(x.estimateSubtotal)>0?'has-estimate':''}">${Number(x.estimateSubtotal)>0?`Est. ${money(x.estimateSubtotal)}`:'Belum estimasi'}</span></div>`).join('')}</div>`;
  }
  function estimateOrderTotal(lines){ return (lines||[]).reduce((sum,line)=>sum+(Number(line.estimateSubtotal)||0),0); }
  function estimateIsComplete(lines){ return !!(lines||[]).length && lines.every(line=>(Number(line.estimateSubtotal)||0)>0); }
  function estimateStatusBadge(rec){
    if(rec.estimateBatchId) return `<span class="badge done">Sudah Dicairkan Estimasi · ${esc(rec.estimateBatchId)}</span>`;
    if(rec.estimateSource==='shopeeHtml') return `<span class="badge paid">HTML Shopee</span>${rec.shopeePendingStatus?`<br><span class="muted">${esc(rec.shopeePendingStatus)}</span>`:''}`;
    if(rec.estimateComplete) return '<span class="badge paid">Manual Lengkap</span>';
    if(rec.estimateTotal>0) return '<span class="badge review">Manual Belum Lengkap</span>';
    return '<span class="badge neutral">Belum Diestimasi</span>';
  }
  function outstandingCorrections(){
    return unionRecords().filter(r=>r.estimateBatchId && r.income && !r.correctionSettledBatchId && r.correctionDelta!==0);
  }
  function normalizeProductKey(v){ return normalizeText(v).toLowerCase(); }
  function estimateFinalBreakdown(rec){
    if(rec.estimatePaidSource==='shopeeHtml'){
      return [{product:'Total Order · HTML Shopee',estimate:Number(rec.estimatePaidAmount)||0,final:Number(rec.amount)||0,diff:(Number(rec.amount)||0)-(Number(rec.estimatePaidAmount)||0),orderLevel:true}];
    }
    const est=new Map(), fin=new Map(), labels=new Map();
    for(const line of rec.lines||[]){
      const key=normalizeProductKey(line.product||'-'); labels.set(key,line.product||'-');
      est.set(key,(est.get(key)||0)+(Number(line.estimateSubtotal)||0));
    }
    for(const sku of rec.income?.skuDetails||[]){
      const key=normalizeProductKey(sku.product||'-'); labels.set(key,sku.product||'-');
      fin.set(key,(fin.get(key)||0)+(Number(sku.amount)||0));
    }
    return [...new Set([...est.keys(),...fin.keys()])].map(key=>({product:labels.get(key)||key,estimate:est.get(key)||0,final:fin.get(key)||0,diff:(fin.get(key)||0)-(est.get(key)||0)}));
  }
  function correctionDetailHtml(rec){
    const details=estimateFinalBreakdown(rec);
    if(!details.length) return '<span class="muted">Rincian SKU final belum tersedia.</span>';
    const html=`<div class="correction-product-list">${details.map(x=>`<div><b>${esc(x.product)}</b><span>${money(x.estimate)} → ${money(x.final)}</span><strong class="${x.diff>0?'diff-plus':x.diff<0?'diff-minus':''}">${x.diff>0?'+':''}${money(x.diff)}</strong></div>`).join('')}</div>`;
    return rec.estimatePaidSource==='shopeeHtml'?html+'<div class="muted correction-note">HTML Pending Shopee menyediakan nominal total per No. Pesanan; pembagian estimasi per produk tidak ditebak.</div>':html;
  }

  function productNames(){
    return unique(cache.orders.map(x=>normalizeText(x.product))).sort((a,b)=>a.localeCompare(b,'id'));
  }
  function pendingProductNames(){
    return unique(pendingBaseRecords().flatMap(r=>(r.lines||[]).map(x=>normalizeText(x.product))).filter(Boolean)).sort((a,b)=>a.localeCompare(b,'id'));
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
    const sel=productSelection(kind), names=kind==='pending'?pendingProductNames():productNames();
    if(sel===null) return 'Semua Produk';
    if(!sel.size) return 'Tidak ada produk dipilih';
    const arr=[...sel].sort((a,b)=>a.localeCompare(b,'id'));
    if(arr.length<=3) return arr.join(' + ');
    return `${arr.length} produk dipilih`;
  }
  function renderProductChoices(kind){
    const box=$(`${kind}ProductChoices`); if(!box) return;
    const names=kind==='pending'?pendingProductNames():productNames(), sel=productSelection(kind);
    if(!names.length){ box.innerHTML='<div class="product-picker-empty">Belum ada produk di Master Order. Upload file Order terlebih dahulu.</div>'; return; }
    box.innerHTML=names.map((name,i)=>`<label class="product-check"><input type="checkbox" class="${kind}-product-check" data-product="${esc(name)}" ${sel===null||sel.has(name)?'checked':''}><span>${esc(name)}</span></label>`).join('');
    $$(`.${kind}-product-check`).forEach(cb=>cb.addEventListener('change',()=>{
      const all=$$(`.${kind}-product-check`), checked=all.filter(x=>x.checked).map(x=>x.dataset.product);
      productSelections[kind]=checked.length===all.length?null:new Set(checked);
      if(kind==='report') renderReport(); else if(kind==='pending') renderPending(); else renderReady();
    }));
  }
  function rerenderProductView(kind){ if(kind==='report')renderReport(); else if(kind==='pending')renderPending(); else renderReady(); }
  function selectAllProducts(kind){ productSelections[kind]=null; renderProductChoices(kind); rerenderProductView(kind); }
  function clearAllProducts(kind){ productSelections[kind]=new Set(); renderProductChoices(kind); rerenderProductView(kind); }
  function paymentBadge(rec){
    if(rec.isCancelled){
      return rec.income?'<span class="badge review">Ada Pembayaran · Perlu Dicek</span>':'<span class="badge cancelled">Tidak Ada Pembayaran</span>';
    }
    return rec.income?'<span class="badge paid">Sudah Dibayar Shopee</span>':'<span class="badge pending">Belum Dibayar Shopee</span>';
  }
  function payoutBadge(rec){
    if(!rec.income && rec.estimateBatchId)return `<span class="badge done">Dicairkan Estimasi · ${esc(rec.estimateBatchId)}</span>`;
    if(!rec.income)return '<span class="badge neutral">-</span>';
    if(rec.income.batchId)return `<span class="badge done">Sudah Dicairkan · ${esc(rec.income.batchId)}</span>`;
    if(rec.estimateBatchId)return `<span class="badge done">Dicairkan Estimasi · ${esc(rec.estimateBatchId)}</span>`;
    if(rec.isCancelled || rec.status==='incomeOnly') return '<span class="badge review">Ditahan / Perlu Dicek</span>';
    return '<span class="badge ready">Belum Dicairkan</span>';
  }

  function renderDashboard(){
    const u=unionRecords(), inc=cache.incomes, groups=orderGroups();
    const readyRecords=u.filter(x=>x.status==='ready' && !x.estimateBatchId);
    const ready=readyRecords.map(x=>x.income).filter(Boolean);
    const activeIncomes=inc.filter(x=>x.batchId);
    const activeBatches=cache.batches.filter(b=>b.status==='active');
    const batchOrderNos=new Set(activeBatches.flatMap(b=>(b.items||[]).map(i=>i.orderNo)));
    const actualBatchTotal=activeBatches.reduce((sum,b)=>sum+(Number(b.totalSnapshot)||0),0);
    const cancelled=u.filter(x=>x.status==='cancelled');
    const cancelledWithIncome=cancelled.filter(x=>x.income);
    $('kpiOrders').textContent=groups.size; $('kpiOrderLines').textContent=`${cache.orders.length} baris produk`;
    $('kpiIncome').textContent=money(inc.reduce((s,x)=>s+x.amount,0)); $('kpiIncomeCount').textContent=`${inc.length} pesanan`;
    $('kpiReady').textContent=money(ready.reduce((s,x)=>s+x.amount,0)); $('kpiReadyCount').textContent=`${ready.length} pesanan valid`;
    $('kpiBatched').textContent=money(actualBatchTotal); $('kpiBatchedCount').textContent=`${batchOrderNos.size} pesanan pada batch aktif`;
    const counts={pending:0,ready:0,batched:0,incomeOnly:0,cancelled:0}; u.forEach(x=>{ if(counts[x.status]!==undefined) counts[x.status]++; });
    $('dashPending').textContent=counts.pending; $('dashCancelled').textContent=counts.cancelled; $('dashReady').textContent=readyRecords.length; $('dashDone').textContent=batchOrderNos.size; $('dashIncomeOnly').textContent=counts.incomeOnly;
    if(cache.uploads[0]){
      const x=cache.uploads[0]; $('latestUpload').innerHTML=`<div class="status-list"><div><span>Waktu</span><strong>${esc(localDateTime(x.createdAt))}</strong></div><div><span>Order</span><strong>${x.orderUnique} pesanan / ${x.orderLines} baris</strong></div><div><span>Pembayaran</span><strong>${x.incomeCount} pesanan</strong></div><div><span>Data baru</span><strong>${x.orderNew} baris Order / ${x.incomeNew} Pembayaran</strong></div></div>`;
    }else $('latestUpload').textContent='Belum ada upload.';

    const multiProduct=[...groups.values()].filter(v=>v.length>1).length;
    const an=[
      ['Pesanan multi-produk (normal)',multiProduct],
      ['Pesanan Batal + ada Pembayaran',cancelledWithIncome.length],
      ['Pembayaran tanpa Order',counts.incomeOnly],
      ['Pembayaran berubah setelah Pencairan',cache.anomalies.filter(x=>x.type==='Pembayaran berubah setelah Pencairan').length],
      ['Saldo koreksi estimasi',`${outstandingCorrections().reduce((sum,r)=>sum+r.correctionDelta,0)>0?'+':''}${money(outstandingCorrections().reduce((sum,r)=>sum+r.correctionDelta,0))}`]
    ];
    $('anomalyGrid').innerHTML=an.map(([a,b])=>`<div class="anomaly-box"><span>${esc(a)}</span><strong>${b}</strong></div>`).join('');
  }
  function renderUploads(){
    $('uploadHistoryBody').innerHTML=cache.uploads.length?cache.uploads.map(x=>`<tr><td>${esc(localDateTime(x.createdAt))}</td><td>${esc(x.orderFile)}</td><td>${esc(x.incomeFile)}</td><td>${x.orderUnique} unik<br><span class="muted">${x.orderLines} baris</span></td><td>${x.incomeCount}</td><td>Order +${x.orderNew} / ~${x.orderUpdated}<br>Pembayaran +${x.incomeNew} / ~${x.incomeUpdated}</td></tr>`).join(''):'<tr><td colspan="6" class="muted">Belum ada riwayat upload.</td></tr>';
  }

  function reportFilter(rec){
    const rf=$('reportReleaseFrom').value, rt=$('reportReleaseTo').value, of=$('reportOrderFrom').value, ot=$('reportOrderTo').value, ps=$('reportPaymentStatus').value, po=$('reportPayoutStatus').value, os=$('reportOrderStatus').value, products=productSelection('report'), q=$('reportSearch').value.trim().toLowerCase();
    if(rf && (!rec.releasedDate || rec.releasedDate<rf))return false; if(rt && (!rec.releasedDate || rec.releasedDate>rt))return false;
    if(of && (!rec.orderDate || rec.orderDate<of))return false; if(ot && (!rec.orderDate || rec.orderDate>ot))return false;
    if(ps==='unpaid' && rec.income)return false; if(ps==='paid' && !rec.income)return false;
    if(os!=='all' && rec.orderStatus!==os)return false;
    if(po==='notYet' && (rec.status!=='ready' || rec.estimateBatchId))return false; if(po==='batched' && (!rec.income || (!rec.income.batchId && !rec.estimateBatchId)))return false; if(po==='held' && !(rec.income && !rec.income.batchId && !rec.estimateBatchId && (rec.isCancelled || rec.status==='incomeOnly')))return false;
    if(!productLinesMatchSelection(rec.lines,products))return false;
    if(q){ const hay=[rec.orderNo,...rec.lines.flatMap(x=>[x.product,x.variation]),rec.orderStatus,rec.cancelReason].join(' ').toLowerCase(); if(!hay.includes(q))return false; }
    return true;
  }
  function renderReportOrderStatusOptions(){
    const el=$('reportOrderStatus'); if(!el)return;
    const current=el.value||'all';
    const statuses=unique(cache.orders.map(x=>normalizeText(x.status))).sort((a,b)=>a.localeCompare(b,'id'));
    el.innerHTML='<option value="all">Semua Status Order</option>'+statuses.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
    el.value=statuses.includes(current)?current:'all';
  }
  function currentReport(){return unionRecords().filter(reportFilter);}
  function renderReport(){
    const rows=currentReport();
    const paid=rows.filter(x=>x.income), ready=rows.filter(x=>x.status==='ready' && !x.estimateBatchId), batched=rows.filter(x=>x.income && (x.income.batchId || x.estimateBatchId));
    const paidTotal=paid.reduce((s,x)=>s+x.amount,0), readyTotal=ready.reduce((s,x)=>s+x.amount,0), batchedTotal=batched.reduce((s,x)=>s+x.amount,0);
    $('reportCount').textContent=rows.length; $('reportIncomeTotal').textContent=money(paidTotal); $('reportPendingCount').textContent=rows.filter(x=>x.status==='pending').length; $('reportCancelledCount').textContent=rows.filter(x=>x.status==='cancelled').length; $('reportReadyCount').textContent=ready.length; $('reportBatchedCount').textContent=batched.length;
    const productLabel=productSelectionSummary('report');
    setMessage('reportSearchNote',`Hasil pencarian/filter · ${productLabel}: ${rows.length} pesanan · Pembayaran Shopee ${money(paidTotal)} · Belum dicairkan ${money(readyTotal)} · Sudah dicairkan ${money(batchedTotal)}.`,'info');
    $('reportBody').innerHTML=rows.length?rows.map(r=>`<tr><td><b>${esc(r.orderNo)}</b>${r.lines.length>1?`<br><span class="muted">${r.lines.length} item dalam 1 pesanan</span>`:''}</td><td>${productHtml(r.lines)}</td><td>${esc(r.orderStatus||'-')}</td><td>${paymentBadge(r)}</td><td class="num">${r.income?money(r.amount):'-'}</td><td>${esc(r.orderDate||'-')}</td><td>${esc(r.releasedDate||'-')}</td><td>${payoutBadge(r)}</td><td><button class="btn ghost edit-order" data-order="${esc(r.orderNo)}">Edit</button></td></tr>`).join(''):'<tr><td colspan="9" class="muted">Tidak ada data sesuai filter.</td></tr>';
    $$('.edit-order').forEach(b=>b.addEventListener('click',()=>showEditOrder(b.dataset.order)));
  }

  function pendingBaseRecords(){ return unionRecords().filter(x=>x.status==='pending'); }
  function parsePendingShopeeHtml(htmlText){
    const parser=new DOMParser();
    const docHtml=parser.parseFromString(String(htmlText||''),'text/html');
    const bodyText=docHtml.body?.textContent||'';
    if(!/Dana Akan Dilepaskan/i.test(bodyText) || !/Pending/i.test(bodyText)){
      throw new Error('File bukan halaman Shopee Penghasilan Saya → Pending, atau data tabel belum ikut tersimpan.');
    }
    const rows=[...docHtml.querySelectorAll('.grid-table-body .grid-table-row')];
    const out=[];
    for(const row of rows){
      const orderEl=row.querySelector('.order-id');
      const amountEl=row.querySelector('.transaction-amount');
      if(!orderEl||!amountEl) continue;
      const orderMatch=(orderEl.textContent||'').toUpperCase().match(/\b\d{6}[A-Z0-9]{6,}\b/);
      if(!orderMatch) continue;
      const cells=[...row.children];
      const orderNo=orderMatch[0];
      const amount=parseMoney(amountEl.textContent||'');
      const releaseEstimate=normalizeText(cells[1]?.textContent||'');
      const status=normalizeText(cells[2]?.textContent||'');
      const paymentMethod=normalizeText(cells[3]?.textContent||'');
      out.push({orderNo,amount,releaseEstimate,status,paymentMethod});
    }
    const byOrder=new Map();
    for(const r of out) byOrder.set(r.orderNo,r);
    return [...byOrder.values()];
  }
  function resetPendingHtmlSummary(){
    if($('pendingHtmlRows')) $('pendingHtmlRows').textContent='0';
    if($('pendingHtmlMatched')) $('pendingHtmlMatched').textContent='0';
    if($('pendingHtmlUnmatched')) $('pendingHtmlUnmatched').textContent='0';
    if($('pendingHtmlTotal')) $('pendingHtmlTotal').textContent=money(0);
  }
  async function importPendingShopeeHtml(){
    const file=$('pendingHtmlFile')?.files?.[0];
    if(!file){setMessage('pendingHtmlMessage','Pilih file HTML Shopee terlebih dahulu.','warning');return;}
    const btn=$('importPendingHtmlBtn'); if(btn)btn.disabled=true;
    setMessage('pendingHtmlMessage','Membaca HTML dan mencocokkan No. Pesanan dengan Master Order…','info');
    try{
      const htmlText=await file.text();
      const parsed=parsePendingShopeeHtml(htmlText);
      if(!parsed.length) throw new Error('Tidak ditemukan pasangan No. Pesanan + Dana Akan Dilepaskan di HTML ini. Pastikan daftar Pending sudah tampil sebelum Ctrl+S.');
      const groups=orderGroups();
      const currentByOrder=new Map(unionRecords().map(r=>[r.orderNo,r]));
      const now=new Date().toISOString();
      const updates=[]; const unmatched=[]; const skippedFinal=[];
      let matched=0, total=0;
      for(const row of parsed){
        total+=Number(row.amount)||0;
        const lines=groups.get(row.orderNo)||[];
        if(!lines.length){unmatched.push(row.orderNo);continue;}
        const rec=currentByOrder.get(row.orderNo);
        if(rec?.income){skippedFinal.push(row.orderNo);continue;}
        matched++;
        for(const line of lines){
          updates.push({...line,
            shopeePendingAmount:Number(row.amount)||0,
            shopeePendingStatus:row.status||'',
            shopeePendingReleaseEstimate:row.releaseEstimate||'',
            shopeePendingPaymentMethod:row.paymentMethod||'',
            shopeePendingImportedAt:now,
            shopeePendingSourceFile:file.name
          });
        }
      }
      if(updates.length) await putMany(STORES.orders,updates);
      await putMany(STORES.edits,[{id:uid('EDIT'),createdAt:now,orderNoBefore:'',orderNoAfter:'',description:`Import HTML Pending Shopee ${file.name}: ${parsed.length} baris, ${matched} cocok Master, ${unmatched.length} tidak cocok, ${skippedFinal.length} sudah punya Income final, total HTML ${money(total)}.`}]);
      await reloadCache(); renderAll();
      if($('pendingHtmlRows')) $('pendingHtmlRows').textContent=parsed.length;
      if($('pendingHtmlMatched')) $('pendingHtmlMatched').textContent=matched;
      if($('pendingHtmlUnmatched')) $('pendingHtmlUnmatched').textContent=unmatched.length;
      if($('pendingHtmlTotal')) $('pendingHtmlTotal').textContent=money(total);
      const extra=[];
      if(unmatched.length) extra.push(`${unmatched.length} No. Pesanan tidak ditemukan di Master`);
      if(skippedFinal.length) extra.push(`${skippedFinal.length} sudah memiliki Income final dan dilewati`);
      setMessage('pendingHtmlMessage',`Import selesai: ${matched} pesanan cocok. Total nominal pada HTML ${money(total)}.${extra.length?' '+extra.join(' · ')+'.':''} HTML mentah tidak disimpan; hanya hasil ekstraksi yang masuk Firebase.`,'success');
    }catch(err){
      console.error(err); resetPendingHtmlSummary();
      setMessage('pendingHtmlMessage',err.message||String(err),'error');
    }finally{if(btn)btn.disabled=!$('pendingHtmlFile')?.files?.[0];}
  }
  function renderPendingStatusOptions(baseRows){
    const el=$('pendingStatus'); if(!el)return;
    const current=el.value||'all';
    const statuses=unique(baseRows.map(x=>x.orderStatus)).sort((a,b)=>a.localeCompare(b,'id'));
    el.innerHTML='<option value="all">Semua Status Aktif</option>'+statuses.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
    el.value=statuses.includes(current)?current:'all';
  }
  function currentPending(){
    const base=pendingBaseRecords(); renderPendingStatusOptions(base);
    const from=$('pendingFrom').value,to=$('pendingTo').value,status=$('pendingStatus').value,products=productSelection('pending'),q=$('pendingSearch').value.trim().toLowerCase();
    return base.filter(r=>{
      if(from && (!r.orderDate||r.orderDate<from))return false;
      if(to && (!r.orderDate||r.orderDate>to))return false;
      if(status!=='all' && r.orderStatus!==status)return false;
      if(!productLinesMatchSelection(r.lines||[],products))return false;
      if(q){const hay=[r.orderNo,r.orderStatus,...r.lines.flatMap(x=>[x.product,x.variation])].join(' ').toLowerCase();if(!hay.includes(q))return false;}
      return true;
    });
  }
  function renderPending(){
    const rows=currentPending();
    const estimated=rows.filter(r=>r.estimateTotal>0);
    const eligible=rows.filter(r=>!r.estimateBatchId && r.estimateComplete);
    const estimateTotal=rows.reduce((sum,r)=>sum+r.estimateTotal,0);
    const eligibleTotal=eligible.reduce((sum,r)=>sum+r.estimateTotal,0);
    const correctionNet=outstandingCorrections().reduce((sum,r)=>sum+r.correctionDelta,0);
    const pendingSelection=productSelection('pending');
    const mixedEligible=eligible.filter(r=>productMixInfo(r.lines||[],pendingSelection).mixed);
    $('pendingCount').textContent=rows.length;
    $('pendingLines').textContent=rows.reduce((s,x)=>s+x.lines.length,0);
    if($('pendingEstimatedCount')) $('pendingEstimatedCount').textContent=estimated.length;
    if($('pendingEstimateTotal')) $('pendingEstimateTotal').textContent=money(estimateTotal);
    if($('createEstimateBatchBtn')) $('createEstimateBatchBtn').disabled=!eligible.length;
    if($('pendingEstimateNote')){
      const correctionText=correctionNet===0?'tidak ada saldo koreksi':`saldo koreksi ${correctionNet>0?'+':''}${money(correctionNet)}`;
      setMessage('pendingEstimateNote',`${eligible.length} pesanan siap Batch Estimasi · dasar estimasi ${money(eligibleTotal)} · ${correctionText}.${mixedEligible.length?` ${mixedEligible.length} pesanan campuran akan memakai total seluruh item dalam No. Pesanan.`:''} Total batch berikutnya otomatis memasukkan koreksi yang belum diselesaikan.`,'info');
    }
    const breakdown=Object.entries(rows.reduce((m,r)=>(m[r.orderStatus||'Tanpa Status']=(m[r.orderStatus||'Tanpa Status']||0)+1,m),{})).sort((a,b)=>a[0].localeCompare(b[0],'id'));
    $('pendingStatusSummary').innerHTML=breakdown.length?breakdown.map(([k,v])=>`<span class="mini-chip"><b>${esc(k)}</b> ${v}</span>`).join(''):'<span class="muted">Tidak ada pending aktif pada filter ini.</span>';
    $('pendingBody').innerHTML=rows.length?rows.map(r=>`<tr><td><b>${esc(r.orderNo)}</b>${r.lines.length>1?`<br><span class="muted">${r.lines.length} item</span>`:''}</td><td>${estimateProductHtml(r.lines)}</td><td>${esc(r.orderStatus||'-')}</td><td>${esc(r.orderDate||'-')}</td><td class="num"><b>${r.estimateTotal?money(r.estimateTotal):'-'}</b>${r.estimateSource==='shopeeHtml'?`<br><span class="estimate-source shopee">HTML Shopee</span>${r.shopeePendingPaymentMethod?`<br><span class="muted">${esc(r.shopeePendingPaymentMethod)}</span>`:''}`:r.estimateSource==='manual'?'<br><span class="estimate-source manual">Manual</span>':''}</td><td>${estimateStatusBadge(r)}</td><td><div class="quick-actions"><button class="btn primary small quick-estimate" data-order="${esc(r.orderNo)}">Harga Cepat</button><button class="btn ghost small edit-order-pending" data-order="${esc(r.orderNo)}">Edit</button></div></td></tr>`).join(''):'<tr><td colspan="7" class="muted">Tidak ada pesanan aktif yang menunggu Pembayaran Shopee.</td></tr>';
    $$('.quick-estimate').forEach(b=>b.addEventListener('click',()=>showEstimateOrder(b.dataset.order)));
    $$('.edit-order-pending').forEach(b=>b.addEventListener('click',()=>showEditOrder(b.dataset.order)));
  }


  function currentCancelled(){
    const from=$('cancelledFrom').value,to=$('cancelledTo').value,pay=$('cancelledPayment').value,q=$('cancelledSearch').value.trim().toLowerCase();
    return unionRecords().filter(x=>x.status==='cancelled').filter(r=>{
      if(from && (!r.orderDate||r.orderDate<from))return false; if(to && (!r.orderDate||r.orderDate>to))return false;
      if(pay==='none' && r.income)return false; if(pay==='withIncome' && !r.income)return false; if(pay==='batched' && !r.income?.batchId)return false;
      if(q){const hay=[r.orderNo,r.orderStatus,r.cancelReason,...r.lines.flatMap(x=>[x.product,x.variation])].join(' ').toLowerCase();if(!hay.includes(q))return false;}
      return true;
    });
  }
  function renderCancelled(){
    const rows=currentCancelled(), withIncome=rows.filter(x=>x.income), batched=rows.filter(x=>x.income?.batchId);
    $('cancelledCount').textContent=rows.length; $('cancelledWithIncome').textContent=withIncome.length; $('cancelledBatched').textContent=batched.length;
    $('cancelledBody').innerHTML=rows.length?rows.map(r=>`<tr><td><b>${esc(r.orderNo)}</b></td><td>${productHtml(r.lines)}</td><td>${esc(r.cancelReason||'-')}</td><td>${esc(r.orderDate||'-')}</td><td>${paymentBadge(r)}</td><td class="num">${r.income?money(r.amount):'-'}</td><td>${payoutBadge(r)}</td><td><button class="btn ghost edit-order-cancelled" data-order="${esc(r.orderNo)}">Edit</button></td></tr>`).join(''):'<tr><td colspan="8" class="muted">Tidak ada pesanan batal pada filter ini.</td></tr>';
    $$('.edit-order-cancelled').forEach(b=>b.addEventListener('click',()=>showEditOrder(b.dataset.order)));
  }

  function readyOrderDate(income,groups){
    const lines=groups.get(income.orderNo)||[];
    return lines[0]?.orderDate||income.orderCreatedDate||'';
  }
  function readyActiveBasis(rec){
    if(rec.income) return {kind:'final',amount:Number(rec.amount)||0,label:'Final Income'};
    return {kind:'estimate',amount:Number(rec.estimateTotal)||0,label:rec.estimateSource==='shopeeHtml'?'Estimasi HTML Shopee':'Estimasi Manual'};
  }
  function currentReady(){
    const groups=orderGroups(), from=$('readyFrom').value,to=$('readyTo').value,products=productSelection('ready'),q=$('readySearch').value.trim().toLowerCase();
    // Siap Dicairkan mencakup dua sumber:
    // 1) Income final yang belum pernah dicairkan; 2) Pending dengan estimasi lengkap yang belum dicairkan.
    // Bila Income sudah ada, Final Income selalu menang dan estimasi hanya menjadi referensi lama.
    return unionRecords().filter(r=>{
      if(r.estimateBatchId) return false;
      if(r.status==='ready' && r.income) return true;
      return r.status==='pending' && !r.income && r.estimateComplete && (Number(r.estimateTotal)||0)>0;
    }).filter(r=>{
      const lines=r.lines||[], d=r.orderDate||r.income?.orderCreatedDate||'';
      if(from && (!d||d<from)) return false;
      if(to && (!d||d>to)) return false;
      if(!productLinesMatchSelection(lines,products)) return false;
      if(q){
        const hay=[r.orderNo,...lines.flatMap(line=>[line.product,line.variation,line.status]),d,r.releasedDate,r.shopeePendingPaymentMethod].join(' ').toLowerCase();
        if(!hay.includes(q)) return false;
      }
      return true;
    }).sort((a,b)=>{
      const da=a.orderDate||a.income?.orderCreatedDate||'', db=b.orderDate||b.income?.orderCreatedDate||'';
      return db.localeCompare(da)||b.orderNo.localeCompare(a.orderNo);
    });
  }
  function renderReady(){
    const rows=currentReady(), groups=orderGroups();
    const basisLabel='Tanggal Order';
    const selection=productSelection('ready');
    const selectedSummary=productSelectionSummary('ready');
    const mixed=rows.filter(x=>productMixInfo(groups.get(x.orderNo)||[],selection).mixed);
    const finalRows=rows.filter(r=>!!r.income);
    const estimateRows=rows.filter(r=>!r.income);
    const finalTotal=finalRows.reduce((s,r)=>s+(Number(r.amount)||0),0);
    const estimateTotal=estimateRows.reduce((s,r)=>s+(Number(r.estimateTotal)||0),0);
    const activeTotal=finalTotal+estimateTotal;
    const finalWithOldEstimate=finalRows.filter(r=>(Number(r.estimateTotal)||0)>0);
    const oldEstimateTotal=finalWithOldEstimate.reduce((s,r)=>s+(Number(r.estimateTotal)||0),0);
    $('readyCount').textContent=rows.length;
    $('readyAmount').textContent=money(activeTotal);
    if($('readyFinalAmount')) $('readyFinalAmount').textContent=money(finalTotal);
    if($('readyFinalCount')) $('readyFinalCount').textContent=`${finalRows.length} pesanan`;
    if($('readyEstimateAmount')) $('readyEstimateAmount').textContent=money(estimateTotal);
    if($('readyEstimateCount')) $('readyEstimateCount').textContent=`${estimateRows.length} pesanan`;
    $('createBatchBtn').disabled=!rows.length;
    setMessage('readySearchNote',`${rows.length} No. Pesanan siap dicairkan · dasar aktif ${money(activeTotal)} = Final Income ${money(finalTotal)} + Pending Estimasi ${money(estimateTotal)} · Acuan tanggal: ${basisLabel} · Produk: ${selectedSummary}.`,'info');
    if($('readyEstimateNote')){
      const history=finalWithOldEstimate.length?` ${finalWithOldEstimate.length} order final masih memiliki estimasi lama ${money(oldEstimateTotal)} sebagai riwayat; estimasi lama tersebut tidak dipakai.`:'';
      setMessage('readyEstimateNote',`Prioritas nominal: jika Income Excel sudah ada, gunakan Final Income. Jika Income belum ada tetapi estimasi HTML/manual lengkap, estimasi boleh menjadi dasar pencairan awal.${history} Jika order estimasi sudah dicairkan lalu Income masuk belakangan, hanya selisihnya yang menjadi koreksi batch berikutnya.`,'info');
    }
    const correctionNet=outstandingCorrections().reduce((s,r)=>s+r.correctionDelta,0);
    if($('batchMessage')) setMessage('batchMessage',`Nominal aktif ${money(activeTotal)}${correctionNet?` · saldo koreksi lama ${correctionNet>0?'+':''}${money(correctionNet)} · total batch jika dibuat ${money(activeTotal+correctionNet)}`:' · tidak ada saldo koreksi dari Batch Estimasi lama.'}`,correctionNet?'warning':'info');
    const warning=$('productFilterWarning');
    if(selection!==null && selection.size && mixed.length){
      warning.style.display='block';
      warning.textContent=`Perhatian: ${mixed.length} pesanan berisi produk yang Anda centang sekaligus produk lain dalam No. Pesanan yang sama. Seluruh nominal aktif No. Pesanan tersebut ikut batch.`;
    }else if(selection!==null && !selection.size){
      warning.style.display='block'; warning.textContent='Belum ada produk yang dicentang. Pilih minimal satu produk atau tekan “Pilih Semua”.';
    }else{ warning.style.display='none'; warning.textContent=''; }
    $('readyBody').innerHTML=rows.length?rows.map(r=>{
      const lines=groups.get(r.orderNo)||[], mix=productMixInfo(lines,selection);
      const estimate=Number(r.estimateTotal)||0;
      const source=r.estimateSource==='shopeeHtml'?'<span class="estimate-source shopee">HTML Shopee</span>':r.estimateSource==='manual'?'<span class="estimate-source manual">Manual</span>':'';
      if(r.income){
        const oldEstimateHtml=estimate?`<span class="prior-estimate-amount">${money(estimate)}</span>${source?`<br>${source}`:''}<br><span class="estimate-disabled-note">Referensi · tidak digunakan</span>`:'<span class="muted">-</span>';
        return `<tr><td><b>${esc(r.orderNo)}</b>${mix.mixed?'<br><span class="badge pending">Pesanan campuran</span>':''}</td><td>${productHtml(lines)}</td><td>${esc(r.orderDate||'-')}</td><td>${esc(r.releasedDate||'-')}</td><td class="num"><b>${money(r.amount)}</b><br><span class="final-source final-active">Final Income · Aktif</span></td><td class="num ready-estimate-cell">${oldEstimateHtml}</td><td><span class="badge ready">Siap · Final</span></td><td><button class="btn ghost edit-order-ready" data-order="${esc(r.orderNo)}">Edit</button></td></tr>`;
      }
      const pendingEstimateHtml=`<b>${money(estimate)}</b>${source?`<br>${source}`:''}<br><span class="estimate-active-note">Estimasi · Aktif</span>`;
      return `<tr class="ready-estimate-row"><td><b>${esc(r.orderNo)}</b>${mix.mixed?'<br><span class="badge pending">Pesanan campuran</span>':''}</td><td>${productHtml(lines)}</td><td>${esc(r.orderDate||'-')}</td><td><span class="muted">Belum ada Income</span></td><td class="num"><span class="muted">-</span><br><span class="final-source">Menunggu Final Income</span></td><td class="num ready-estimate-cell">${pendingEstimateHtml}</td><td><span class="badge pending">Siap · Estimasi</span></td><td><button class="btn ghost edit-order-ready" data-order="${esc(r.orderNo)}">Edit</button></td></tr>`;
    }).join(''):'<tr><td colspan="8" class="muted">Tidak ada pesanan yang siap dicairkan pada filter ini.</td></tr>';
    $$('.edit-order-ready').forEach(b=>b.addEventListener('click',()=>showEditOrder(b.dataset.order)));
  }

  function currentEstimateBatchRows(){ return currentPending().filter(r=>!r.estimateBatchId && r.estimateComplete); }
  async function makeEstimateBatch(){
    const rows=currentEstimateBatchRows(); if(!rows.length)return;
    const corrections=outstandingCorrections();
    const baseTotal=rows.reduce((sum,r)=>sum+r.estimateTotal,0);
    const correctionTotal=corrections.reduce((sum,r)=>sum+r.correctionDelta,0);
    const payoutTotal=baseTotal+correctionTotal;
    if(payoutTotal<0){
      setMessage('pendingEstimateNote',`Batch belum dapat dibuat. Estimasi baru ${money(baseTotal)} masih lebih kecil dari koreksi negatif ${money(correctionTotal)}. Tambahkan pesanan estimasi sampai total pencairan minimal Rp0.`,'warning');
      return;
    }
    const batchId=nextBatchId();
    const products=productSelection('pending');
    const productSummary=productSelectionSummary('pending');
    const mixed=rows.filter(r=>productMixInfo(r.lines||[],products).mixed);
    $('dialogTitle').textContent='Konfirmasi Batch Estimasi';
    $('dialogContent').innerHTML=`<p>Batch ini mencairkan dana <b>sebelum Income final masuk</b>, menggunakan estimasi Shopee dari HTML jika tersedia; jika tidak, estimasi manual per item. Saat Income final datang, selisih akan dihitung otomatis.</p><div class="dialog-summary"><div><span>ID Batch</span><strong>${esc(batchId)}</strong></div><div><span>Pesanan Estimasi</span><strong>${rows.length}</strong></div><div><span>Dasar Estimasi</span><strong>${money(baseTotal)}</strong></div><div><span>Koreksi Sebelumnya</span><strong>${correctionTotal>0?'+':''}${money(correctionTotal)}</strong></div><div><span>Total Pencairan</span><strong>${money(payoutTotal)}</strong></div><div><span>Produk</span><strong>${esc(productSummary)}</strong></div></div>${mixed.length?`<div class="message warning">${mixed.length} pesanan mengandung produk terpilih dan produk lain. Karena pencairan dikunci per No. Pesanan, total estimasi seluruh item dalam pesanan tersebut ikut batch.</div>`:''}${corrections.length?`<div class="message info">${corrections.length} selisih order lama ikut diselesaikan pada batch ini dengan nilai net ${correctionTotal>0?'+':''}${money(correctionTotal)}.</div>`:''}`;
    const dlg=$('confirmDialog'); dlg.showModal();
    const result=await new Promise(resolve=>{const fn=()=>{dlg.removeEventListener('close',fn);resolve(dlg.returnValue)};dlg.addEventListener('close',fn)}); if(result!=='confirm')return;
    if(rows.length>250){setMessage('pendingEstimateNote','Batch estimasi terlalu besar. Persempit filter menjadi maksimal 250 pesanan per batch.','warning');return;}
    const createdAt=new Date().toISOString();
    const batch={
      batchId,createdAt,status:'active',type:'estimate',count:rows.length,totalSnapshot:payoutTotal,baseEstimateTotal:baseTotal,correctionTotal,
      filterSnapshot:{dateBasis:'order',dateFrom:$('pendingFrom').value||'',dateTo:$('pendingTo').value||'',products:products===null?pendingProductNames():[...products],productSummary,search:$('pendingSearch').value.trim()||''},
      items:rows.map(r=>({orderNo:r.orderNo,amountSnapshot:r.estimateTotal,estimateSnapshot:r.estimateTotal,estimateSource:r.estimateSource||'manual',shopeePendingAmount:Number(r.shopeePendingAmount)||0,releasedDate:'',orderDate:r.orderDate,productsSnapshot:r.lines.map(line=>({product:line.product||'',variation:line.variation||'',quantity:Number(line.quantity)||0,estimateUnit:Number(line.estimateUnit)||0,estimateSubtotal:Number(line.estimateSubtotal)||0}))})),
      corrections:corrections.map(r=>({orderNo:r.orderNo,estimatePaidAmount:r.estimatePaidAmount,finalAmount:r.amount,delta:r.correctionDelta}))
    };
    try{
      await runTransaction(db,async tx=>{
        const orderRefs=rows.map(r=>doc(db,STORES.orders,r.orderNo));
        const incomeRefs=rows.map(r=>doc(db,STORES.incomes,r.orderNo));
        const correctionRefs=corrections.map(r=>doc(db,STORES.orders,r.orderNo));
        const orderSnaps=[],incomeSnaps=[],correctionSnaps=[];
        for(const ref of orderRefs) orderSnaps.push(await tx.get(ref));
        for(const ref of incomeRefs) incomeSnaps.push(await tx.get(ref));
        for(const ref of correctionRefs) correctionSnaps.push(await tx.get(ref));
        const conflicts=[];
        orderSnaps.forEach((snap,i)=>{const d=snap.data()||{};if(!snap.exists())conflicts.push(`${rows[i].orderNo} (Order hilang)`);else if(isCancelledStatus(d.status||''))conflicts.push(`${rows[i].orderNo} (Batal)`);else if(d.estimateBatchId)conflicts.push(`${rows[i].orderNo} (${d.estimateBatchId})`);});
        incomeSnaps.forEach((snap,i)=>{if(snap.exists())conflicts.push(`${rows[i].orderNo} (Income sudah masuk)`);});
        correctionSnaps.forEach((snap,i)=>{const d=snap.data()||{};if(!snap.exists()||d.correctionSettledBatchId)conflicts.push(`${corrections[i].orderNo} (koreksi berubah)`);});
        if(conflicts.length) throw new Error(`Batch dibatalkan karena data berubah: ${conflicts.slice(0,6).join(', ')}${conflicts.length>6?'…':''}`);
        tx.set(doc(db,STORES.batches,batchId),batch);
        orderSnaps.forEach((snap,i)=>tx.update(orderRefs[i],{estimateBatchId:batchId,estimatePaidAmount:rows[i].estimateTotal,estimatePaidSource:rows[i].estimateSource||'manual',estimatePaidAt:createdAt}));
        correctionSnaps.forEach((snap,i)=>tx.update(correctionRefs[i],{correctionSettledBatchId:batchId}));
      });
      await reloadCache(); renderAll();
      setMessage('pendingEstimateNote',`${batchId} berhasil dibuat. Dasar estimasi ${money(baseTotal)} ${correctionTotal?`+ koreksi ${correctionTotal>0?'+':''}${money(correctionTotal)} `:''}= total pencairan ${money(payoutTotal)}.`,'success');
    }catch(err){console.error(err);setMessage('pendingEstimateNote',err.message||String(err),'error');}
  }

  function nextBatchId(){
    const d=todayISO().replaceAll('-','');
    const existing=cache.batches.filter(x=>x.batchId.startsWith(`BATCH-${d}-`)).length+1;
    const suffix=Math.random().toString(36).slice(2,5).toUpperCase();
    return `BATCH-${d}-${String(existing).padStart(3,'0')}-${suffix}`;
  }
  async function makeBatch(){
    const rows=currentReady(); if(!rows.length)return;
    const batchId=nextBatchId(), groups=orderGroups();
    const finalRows=rows.filter(r=>!!r.income), estimateRows=rows.filter(r=>!r.income);
    const finalTotal=finalRows.reduce((s,r)=>s+(Number(r.amount)||0),0);
    const estimateTotal=estimateRows.reduce((s,r)=>s+(Number(r.estimateTotal)||0),0);
    const baseTotal=finalTotal+estimateTotal;
    const corrections=outstandingCorrections();
    const correctionTotal=corrections.reduce((s,r)=>s+r.correctionDelta,0);
    const total=baseTotal+correctionTotal;
    if(total<0){setMessage('batchMessage',`Batch belum dapat dibuat. Nominal aktif ${money(baseTotal)} lebih kecil dari koreksi negatif ${money(correctionTotal)}. Tambahkan lebih banyak pesanan ke filter.`,'warning');return;}
    const products=productSelection('ready');
    const selectedProducts=products===null?productNames():[...products];
    const productSummary=productSelectionSummary('ready');
    const basisLabel='Tanggal Order';
    const mixed=rows.filter(x=>productMixInfo(groups.get(x.orderNo)||[],products).mixed);
    $('dialogTitle').textContent='Konfirmasi Batch Pencairan';
    $('dialogContent').innerHTML=`<p>Batch dapat berisi <b>Final Income</b> dan <b>Pending Estimasi</b>. Jika Income sudah tersedia, Final selalu menjadi dasar. Pending Estimasi hanya dipakai bila Income belum tersedia.</p><div class="dialog-summary"><div><span>ID Batch</span><strong>${esc(batchId)}</strong></div><div><span>Jumlah Pesanan</span><strong>${rows.length}</strong></div><div><span>Final Income</span><strong>${finalRows.length} · ${money(finalTotal)}</strong></div><div><span>Pending Estimasi</span><strong>${estimateRows.length} · ${money(estimateTotal)}</strong></div><div><span>Koreksi Sebelumnya</span><strong>${correctionTotal>0?'+':''}${money(correctionTotal)}</strong></div><div><span>Total Pencairan</span><strong>${money(total)}</strong></div><div><span>Periode</span><strong>${esc($('readyFrom').value||'Semua')} – ${esc($('readyTo').value||'Semua')}</strong></div><div><span>Produk</span><strong>${esc(productSummary)}</strong></div></div>${estimateRows.length?`<div class="message warning">${estimateRows.length} pesanan belum mempunyai Income final dan akan dicairkan berdasarkan estimasi. Ketika Income masuk nanti, selisih otomatis menjadi koreksi.</div>`:''}${mixed.length?`<div class="message warning">${mixed.length} pesanan campuran ikut dengan seluruh nominal aktif No. Pesanan.</div>`:''}${corrections.length?`<div class="message info">${corrections.length} selisih estimasi lama ikut diselesaikan pada batch ini, net ${correctionTotal>0?'+':''}${money(correctionTotal)}.</div>`:''}`;
    const dlg=$('confirmDialog'); dlg.showModal(); const result=await new Promise(resolve=>{const fn=()=>{dlg.removeEventListener('close',fn);resolve(dlg.returnValue)};dlg.addEventListener('close',fn)}); if(result!=='confirm')return;
    if(rows.length>300){ setMessage('batchMessage','Batch terlalu besar untuk satu transaksi aman. Persempit filter menjadi maksimal 300 pesanan per batch.','warning'); return; }
    const createdAt=new Date().toISOString();
    const batchType=finalRows.length&&estimateRows.length?'mixed':estimateRows.length?'estimate':'final';
    const batch={batchId,createdAt,status:'active',type:batchType,count:rows.length,totalSnapshot:total,baseActiveTotal:baseTotal,baseFinalTotal:finalTotal,baseEstimateTotal:estimateTotal,correctionTotal,filterSnapshot:{dateBasis:'order',dateFrom:$('readyFrom').value||'',dateTo:$('readyTo').value||'',products:selectedProducts,productSummary:productSummary,search:$('readySearch').value.trim()||''},items:rows.map(x=>{const basis=readyActiveBasis(x);return {orderNo:x.orderNo,basis:basis.kind,amountSnapshot:basis.amount,releasedDate:x.releasedDate||'',orderDate:x.orderDate||'',productsSnapshot:(groups.get(x.orderNo)||[]).map(line=>({product:line.product||'',variation:line.variation||'',quantity:Number(line.quantity)||0,estimateUnit:Number(line.estimateUnit)||0,estimateSubtotal:Number(line.estimateSubtotal)||0})),estimateSource:x.estimateSource||null,priorEstimateSnapshot:Number(x.estimateTotal)||0,priorEstimateSourceSnapshot:x.estimateSource||null,priorEstimateUsed:basis.kind==='estimate'};}),corrections:corrections.map(r=>({orderNo:r.orderNo,estimatePaidAmount:r.estimatePaidAmount,finalAmount:r.amount,delta:r.correctionDelta}))};
    try{
      await runTransaction(db,async tx=>{
        const orderRefs=rows.map(x=>doc(db,STORES.orders,x.orderNo));
        const incomeRefs=rows.map(x=>doc(db,STORES.incomes,x.orderNo));
        const correctionRefs=corrections.map(r=>doc(db,STORES.orders,r.orderNo));
        const orderSnaps=[], incomeSnaps=[], correctionSnaps=[];
        for(const ref of orderRefs) orderSnaps.push(await tx.get(ref));
        for(const ref of incomeRefs) incomeSnaps.push(await tx.get(ref));
        for(const ref of correctionRefs) correctionSnaps.push(await tx.get(ref));
        const conflicts=[];
        orderSnaps.forEach((snap,i)=>{
          const row=rows[i], d=snap.data()||{};
          if(!snap.exists()) return conflicts.push(`${row.orderNo} (Order hilang)`);
          if(isCancelledStatus(d.status||'')) return conflicts.push(`${row.orderNo} (Status Batal)`);
          if(d.estimateBatchId) return conflicts.push(`${row.orderNo} (sudah ${d.estimateBatchId})`);
          if(!row.income){
            const items=Array.isArray(d.items)?d.items:[];
            const htmlEst=Number(d.shopeePendingAmount)||0;
            const manualComplete=!!items.length && items.every(it=>(Number(it.estimateSubtotal)||0)>0);
            const currentEstimate=htmlEst>0?htmlEst:items.reduce((sum,it)=>sum+(Number(it.estimateSubtotal)||0),0);
            if(!(htmlEst>0||manualComplete) || currentEstimate!==Number(row.estimateTotal||0)) conflicts.push(`${row.orderNo} (estimasi berubah)`);
          }
        });
        incomeSnaps.forEach((snap,i)=>{
          const row=rows[i];
          if(row.income){
            if(!snap.exists()) conflicts.push(`${row.orderNo} (Income hilang)`);
            else if(snap.data().batchId) conflicts.push(`${row.orderNo} (${snap.data().batchId})`);
            else if(Number(snap.data().amount)||0 !== Number(row.amount)||0) conflicts.push(`${row.orderNo} (Final Income berubah)`);
          }else if(snap.exists()){
            conflicts.push(`${row.orderNo} (Income baru sudah masuk; refresh agar Final Income dipakai)`);
          }
        });
        correctionSnaps.forEach((snap,i)=>{const d=snap.data()||{};if(!snap.exists()||d.correctionSettledBatchId)conflicts.push(`${corrections[i].orderNo} (koreksi berubah)`);});
        if(conflicts.length) throw new Error(`Pencairan dibatalkan karena ${conflicts.length} data berubah: ${conflicts.slice(0,5).join(', ')}${conflicts.length>5?'…':''}`);
        tx.set(doc(db,STORES.batches,batchId),batch);
        rows.forEach((row,i)=>{
          if(row.income){
            tx.update(incomeRefs[i],{batchId,lastBatchAt:createdAt});
          }else{
            tx.update(orderRefs[i],{estimateBatchId:batchId,estimatePaidAmount:Number(row.estimateTotal)||0,estimatePaidSource:row.estimateSource||'manual',estimatePaidAt:createdAt});
          }
        });
        correctionSnaps.forEach((snap,i)=>tx.update(correctionRefs[i],{correctionSettledBatchId:batchId}));
      });
      await reloadCache(); renderAll(); setMessage('batchMessage',`${batchId} berhasil dibuat: Final ${money(finalTotal)} + Estimasi ${money(estimateTotal)} ${correctionTotal?`+ koreksi ${correctionTotal>0?'+':''}${money(correctionTotal)} `:''}= total ${money(total)}.`,'success');
    }catch(err){ console.error(err); setMessage('batchMessage',err.message||String(err),'error'); }
  }


  function renderHistory(){
    $('batchHistoryBody').innerHTML=cache.batches.length?cache.batches.map(b=>`<tr><td><b>${esc(b.batchId)}</b></td><td>${esc(localDateTime(b.createdAt))}</td><td>${b.status==='active'?'<span class="badge done">Aktif</span>':'<span class="badge cancelled">Dibatalkan</span>'}${b.type==='estimate'?' <span class="badge pending">Estimasi</span>':b.type==='mixed'?' <span class="badge review">Campuran</span>':''}</td><td>${b.count}</td><td class="num">${money(b.totalSnapshot)}</td><td><button class="btn ghost detail-batch" data-id="${esc(b.batchId)}">Detail</button>${b.status==='active'?` <button class="btn ghost cancel-batch" data-id="${esc(b.batchId)}">Batalkan</button>`:''}</td></tr>`).join(''):'<tr><td colspan="6" class="muted">Belum ada Batch Pencairan.</td></tr>';
    $$('.detail-batch').forEach(x=>x.addEventListener('click',()=>showBatch(x.dataset.id))); $$('.cancel-batch').forEach(x=>x.addEventListener('click',()=>cancelBatch(x.dataset.id)));
  }
  function showBatch(id){
    const b=cache.batches.find(x=>x.batchId===id); if(!b)return; $('detailTitle').textContent=b.batchId;
    const fs=b.filterSnapshot||{};
    // kompatibilitas batch versi lama: source=income dianggap Tanggal Dana Dilepas
    const basis=fs.dateBasis || (fs.source==='order'?'order':'released');
    const basisLabel=basis==='order'?'Tanggal Order':'Tanggal Dana Dilepas';
    const periodFrom=fs.dateFrom||fs.releasedFrom||'Semua', periodTo=fs.dateTo||fs.releasedTo||'Semua';
    $('detailSubtitle').textContent=`${b.status==='active'?'Aktif':'Dibatalkan'} · ${b.type==='estimate'?'Batch Estimasi':b.type==='mixed'?'Batch Campuran':'Batch Final'} · ${localDateTime(b.createdAt)} · ${b.count} pesanan · ${money(b.totalSnapshot)}${b.type==='estimate'?` (estimasi ${money(b.baseEstimateTotal||0)} ${b.correctionTotal?`+ koreksi ${b.correctionTotal>0?'+':''}${money(b.correctionTotal)}`:''})`:b.type==='mixed'?` (final ${money(b.baseFinalTotal||0)} + estimasi ${money(b.baseEstimateTotal||0)}${b.correctionTotal?` + koreksi ${b.correctionTotal>0?'+':''}${money(b.correctionTotal)}`:''})`:''} · Acuan ${basisLabel}: ${periodFrom} – ${periodTo}${(fs.productSummary||fs.product)?` · Produk ${fs.productSummary||fs.product}`:''}`;
    const groups=orderGroups();
    const itemRows=(b.items||[]).map(x=>{
      const lines=(Array.isArray(x.productsSnapshot)&&x.productsSnapshot.length)?x.productsSnapshot:(groups.get(x.orderNo)||[]);
      const orderDate=x.orderDate || (groups.get(x.orderNo)?.[0]?.orderDate) || '-';
      const source=x.basis==='final'?'<br><span class="final-source final-active">Final Income</span>':x.estimateSource==='shopeeHtml'?'<br><span class="estimate-source shopee">Estimasi HTML Shopee</span>':x.estimateSource==='manual'?'<br><span class="estimate-source manual">Estimasi Manual</span>':b.type==='estimate'?'<br><span class="estimate-source manual">Estimasi</span>':'';
      return `<tr><td class="batch-order-no"><b>${esc(x.orderNo)}</b>${lines.length>1?`<div class="muted batch-item-count">${lines.length} item dalam 1 pesanan</div>`:''}</td><td>${lines.length?productHtml(lines):'<span class="muted">Detail produk tidak ditemukan di Master Order</span>'}</td><td>${esc(orderDate)}</td><td>${esc(x.releasedDate||'-')}</td><td class="num"><b>${money(x.amountSnapshot)}</b>${source}</td></tr>`;
    }).join('');
    const correctionRows=(b.corrections||[]).map(c=>`<tr class="correction-batch-row"><td><b>Koreksi · ${esc(c.orderNo)}</b></td><td><span class="muted">Final Shopee ${money(c.finalAmount)} − Estimasi dicairkan ${money(c.estimatePaidAmount)}</span></td><td>-</td><td>-</td><td class="num"><b class="${c.delta>0?'diff-plus':c.delta<0?'diff-minus':''}">${c.delta>0?'+':''}${money(c.delta)}</b></td></tr>`).join('');
    $('detailBatchBody').innerHTML=itemRows+correctionRows+`<tr class="batch-total-row"><td colspan="4"><b>TOTAL BATCH</b></td><td class="num"><b>${money(b.totalSnapshot)}</b></td></tr>`;
    $('detailDialog').showModal();
  }

  async function cancelBatch(id){
    const b=cache.batches.find(x=>x.batchId===id); if(!b||b.status!=='active')return;
    $('dialogTitle').textContent='Batalkan Batch'; $('dialogContent').innerHTML=`<p>Batch <b>${esc(id)}</b> akan ditandai <b>DIBATALKAN</b>. ${b.type==='estimate'?'Estimasi pada pesanan tetap tersimpan, tetapi tanda sudah dicairkan estimasi dan koreksi batch ini akan dilepas.':b.type==='mixed'?'Item Final dan Estimasi akan sama-sama dikembalikan menjadi Siap Dicairkan sesuai sumber aktifnya.':'No. Pesanan di dalamnya akan kembali menjadi Siap Dicairkan.'}</p><div class="dialog-summary"><div><span>Pesanan</span><strong>${b.count}</strong></div><div><span>Nominal Snapshot</span><strong>${money(b.totalSnapshot)}</strong></div></div>`;
    const dlg=$('confirmDialog'); dlg.showModal(); const result=await new Promise(resolve=>{const fn=()=>{dlg.removeEventListener('close',fn);resolve(dlg.returnValue)};dlg.addEventListener('close',fn)}); if(result!=='confirm')return;
    const updatedBatch={...b,status:'cancelled',cancelledAt:new Date().toISOString()};
    const ids=new Set((b.items||[]).map(x=>x.orderNo));
    const incomeUpdates=cache.incomes.filter(x=>ids.has(x.orderNo)&&x.batchId===id).map(x=>({...x,batchId:null}));
    await putMany(STORES.batches,[updatedBatch]);
    if(incomeUpdates.length) await putMany(STORES.incomes,incomeUpdates);
    const groups=orderGroups(); const orderUpdates=[];
    const estimateIds=new Set((b.items||[]).filter(x=>x.basis==='estimate' || (!x.basis && b.type==='estimate')).map(x=>x.orderNo));
    for(const orderNo of estimateIds){
      const lines=groups.get(orderNo)||[];
      if(lines[0]?.estimateBatchId===id) orderUpdates.push(...lines.map(line=>({...line,estimateBatchId:null,estimatePaidAmount:0,estimatePaidSource:null,estimatePaidAt:null})));
    }
    const correctionOrders=new Set((b.corrections||[]).map(x=>x.orderNo));
    for(const orderNo of correctionOrders){
      const lines=groups.get(orderNo)||[];
      if(lines[0]?.correctionSettledBatchId===id) orderUpdates.push(...lines.map(line=>({...line,correctionSettledBatchId:null})));
    }
    if(orderUpdates.length) await putMany(STORES.orders,orderUpdates);
    await reloadCache(); renderAll();
  }


  function recalcBatch(batch){
    const items=batch.items||[];
    return {...batch,count:items.length,totalSnapshot:items.reduce((s,x)=>s+(Number(x.amountSnapshot)||0),0)+(Number(batch.correctionTotal)||0)};
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
  function recalcEstimateDialog(){
    const nodes=$$('#estimateLines .estimate-line');
    let total=0;
    nodes.forEach(node=>{
      const qty=Math.max(1,Number(node.dataset.qty)||1);
      const unit=Math.max(0,Number(node.querySelector('.estimate-unit')?.value)||0);
      const subtotal=Math.round(unit*qty);
      const out=node.querySelector('.estimate-subtotal');
      if(out) out.textContent=money(subtotal);
      total+=subtotal;
    });
    if($('estimateOrderTotal')) $('estimateOrderTotal').textContent=money(total);
    return total;
  }
  function showEstimateOrder(orderNo){
    const rec=unionRecords().find(x=>x.orderNo===orderNo); if(!rec)return;
    estimatingOrderNo=orderNo;
    if($('estimateSubtitle')) $('estimateSubtitle').textContent=`No. Pesanan ${orderNo} · ${rec.lines.length} item. Isi estimasi per unit; subtotal dihitung otomatis sesuai qty.`;
    $('estimateLines').innerHTML=rec.lines.map((line,i)=>{
      const qty=Math.max(1,Number(line.quantity)||1);
      const unit=Number(line.estimateUnit)||((Number(line.estimateSubtotal)||0)/qty)||0;
      return `<div class="estimate-line" data-key="${esc(line.lineKey)}" data-qty="${qty}"><div class="estimate-line-index">Item ${i+1}</div><div class="estimate-product"><b>${esc(line.product||'-')}</b><span>${esc(line.variation||'-')} · Qty ${qty}</span></div><label>Estimasi / unit<input class="estimate-unit" type="number" min="0" step="1" value="${unit?Math.round(unit):''}" placeholder="0"></label><div class="estimate-line-total"><span>Subtotal</span><strong class="estimate-subtotal">${money(Number(line.estimateSubtotal)||0)}</strong></div></div>`;
    }).join('');
    $$('#estimateLines .estimate-unit').forEach(inp=>inp.addEventListener('input',recalcEstimateDialog));
    const locked=!!rec.estimateBatchId;
    $('saveEstimateBtn').disabled=locked;
    $('clearEstimateBtn').disabled=locked;
    const sourceNote=rec.estimateSource==='shopeeHtml'?`Estimasi Shopee ${money(rec.shopeePendingAmount)} dari HTML menjadi acuan Batch untuk order ini. Input manual di bawah tetap tersimpan sebagai rincian/fallback, tetapi tidak mengganti total HTML Shopee.`:'Estimasi manual disimpan terpisah dari data asli Shopee dan tidak akan ditimpa upload Excel berikutnya.';
    setMessage('estimateMessage',locked?`Estimasi ini sudah dipakai pada ${rec.estimateBatchId}. Nilai dikunci agar snapshot pencairan tidak berubah.`:sourceNote,locked?'warning':'info');
    recalcEstimateDialog();
    $('estimateDialog').showModal();
  }
  async function saveEstimateOrder(){
    if(!estimatingOrderNo)return;
    const rec=unionRecords().find(x=>x.orderNo===estimatingOrderNo); if(!rec)return;
    if(rec.estimateBatchId){setMessage('estimateMessage','Estimasi sudah dipakai dalam Batch dan tidak dapat diubah.','warning');return;}
    const values=new Map();
    $$('#estimateLines .estimate-line').forEach(node=>{
      const qty=Math.max(1,Number(node.dataset.qty)||1);
      const unit=Math.max(0,Number(node.querySelector('.estimate-unit')?.value)||0);
      values.set(node.dataset.key,{unit:Math.round(unit),subtotal:Math.round(unit*qty)});
    });
    const now=new Date().toISOString();
    const lines=cache.orders.filter(x=>x.orderNo===estimatingOrderNo).map(line=>{
      const v=values.get(line.lineKey)||{unit:Number(line.estimateUnit)||0,subtotal:Number(line.estimateSubtotal)||0};
      return {...line,estimateUnit:v.unit,estimateSubtotal:v.subtotal,estimateUpdatedAt:now,lastManualEditAt:now};
    });
    await putMany(STORES.orders,lines);
    await putMany(STORES.edits,[{id:uid('EDIT'),createdAt:now,orderNoBefore:estimatingOrderNo,orderNoAfter:estimatingOrderNo,description:`Estimasi pending per item diperbarui. Total estimasi ${money(lines.reduce((s,x)=>s+(Number(x.estimateSubtotal)||0),0))}.`}]);
    await reloadCache(); renderAll(); $('estimateDialog').close(); estimatingOrderNo=null;
  }
  async function clearEstimateOrder(){
    if(!estimatingOrderNo)return;
    const rec=unionRecords().find(x=>x.orderNo===estimatingOrderNo); if(!rec||rec.estimateBatchId)return;
    const now=new Date().toISOString();
    const lines=cache.orders.filter(x=>x.orderNo===estimatingOrderNo).map(line=>({...line,estimateUnit:0,estimateSubtotal:0,estimateUpdatedAt:now,lastManualEditAt:now}));
    await putMany(STORES.orders,lines); await reloadCache(); renderAll(); $('estimateDialog').close(); estimatingOrderNo=null;
  }

  function showEditOrder(orderNo){
    const rec=unionRecords().find(x=>x.orderNo===orderNo); if(!rec)return;
    editingOrderNo=orderNo;
    $('editOrderNo').value=orderNo;
    $('editOrderStatus').value=rec.orderStatus||'';
    $('editCancelReason').value=rec.cancelReason||'';
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
    if(oldLines[0]?.estimateBatchId && newNo!==oldNo){setMessage('editMessage',`No. Pesanan sudah terkunci pada Batch Estimasi ${oldLines[0].estimateBatchId}. Batalkan batch tersebut terlebih dahulu sebelum mengubah No. Pesanan.`,'warning');return;}
    const lineNodes=[...$('editLines').querySelectorAll('.edit-line')];
    const updatedLines=oldLines.map((line,i)=>{
      const node=lineNodes[i];
      return {...line,orderNo:newNo,status:normalizeText($('editOrderStatus').value),cancelReason:normalizeText($('editCancelReason').value),orderDate:$('editOrderDate').value||'',product:node?normalizeText(node.querySelector('.edit-product').value):line.product,variation:node?normalizeText(node.querySelector('.edit-variation').value):line.variation,quantity:node?Math.max(0,Number(node.querySelector('.edit-qty').value)||0):line.quantity,lastManualEditAt:new Date().toISOString()};
    });
    const amountRaw=$('editIncomeAmount').value, released=$('editReleasedDate').value||'', batchId=$('editBatchId').value||null;
    const newStatus=normalizeText($('editOrderStatus').value);
    if(isCancelledStatus(newStatus) && batchId && !confirm(`Status Order adalah Batal tetapi pesanan akan tetap ditautkan ke ${batchId}. Ini akan ditandai sebagai kondisi yang perlu diperiksa. Lanjutkan?`)) return;
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
    const union=unionRecords(), total=cache.incomes.reduce((s,x)=>s+x.amount,0);
    const batFinal=union.filter(x=>x.income && (x.income.batchId || x.estimateBatchId)).map(x=>x.income), readyRecs=union.filter(x=>x.status==='ready' && !x.estimateBatchId), ready=readyRecs.map(x=>x.income).filter(Boolean);
    const heldRecs=union.filter(x=>x.income && !x.income.batchId && !x.estimateBatchId && (x.status==='cancelled' || x.status==='incomeOnly')), held=heldRecs.map(x=>x.income);
    const batTotal=batFinal.reduce((s,x)=>s+x.amount,0), readyTotal=ready.reduce((s,x)=>s+x.amount,0), heldTotal=held.reduce((s,x)=>s+x.amount,0), diff=total-batTotal-readyTotal-heldTotal;
    $('reconIncome').textContent=money(total); $('reconIncomeN').textContent=`${cache.incomes.length} pesanan`; $('reconBatched').textContent=money(batTotal); $('reconBatchedN').textContent=`${batFinal.length} pesanan`; $('reconReady').textContent=money(readyTotal); $('reconReadyN').textContent=`${ready.length} pesanan`; $('reconHeld').textContent=money(heldTotal); $('reconHeldN').textContent=`${held.length} pesanan`;
    setMessage('reconMessage',diff===0?'Rekonsiliasi final Shopee seimbang. Semua Pembayaran terbagi menjadi Sudah Dicairkan, Siap Dicairkan, atau Ditahan untuk diperiksa.':`Ada selisih ${money(diff)} yang belum terklasifikasi. Data perlu diperiksa.`,diff===0?'success':'error');

    const estimatedFinal=union.filter(r=>r.estimateBatchId && r.income).sort((a,b)=>(b.releasedDate||'').localeCompare(a.releasedDate||''));
    const estPaid=estimatedFinal.reduce((sum,r)=>sum+r.estimatePaidAmount,0);
    const finalPaid=estimatedFinal.reduce((sum,r)=>sum+r.amount,0);
    const open=estimatedFinal.filter(r=>r.correctionDelta!==0 && !r.correctionSettledBatchId);
    const openTotal=open.reduce((sum,r)=>sum+r.correctionDelta,0);
    if($('reconEstimatePaid')) $('reconEstimatePaid').textContent=money(estPaid);
    if($('reconEstimateFinal')) $('reconEstimateFinal').textContent=money(finalPaid);
    if($('reconCorrectionOpen')) $('reconCorrectionOpen').textContent=`${openTotal>0?'+':''}${money(openTotal)}`;
    if($('reconCorrectionCount')) $('reconCorrectionCount').textContent=open.length;
    if($('correctionMessage')){
      if(!estimatedFinal.length) setMessage('correctionMessage','Belum ada Batch Estimasi yang sudah mendapatkan Income final.','info');
      else if(openTotal===0 && !open.length) setMessage('correctionMessage','Semua estimasi yang sudah final sudah klop atau koreksinya sudah diterapkan ke batch berikutnya.','success');
      else setMessage('correctionMessage',`Saldo koreksi belum dipakai: ${openTotal>0?'+':''}${money(openTotal)} dari ${open.length} order. Nilai ini otomatis masuk Batch Estimasi berikutnya.`,'warning');
    }
    if($('estimateReconBody')) $('estimateReconBody').innerHTML=estimatedFinal.length?estimatedFinal.map(r=>`<tr><td><b>${esc(r.orderNo)}</b><br><span class="muted">${esc(r.estimateBatchId)}</span></td><td>${correctionDetailHtml(r)}</td><td class="num">${money(r.estimatePaidAmount)}</td><td class="num">${money(r.amount)}</td><td class="num"><b class="${r.correctionDelta>0?'diff-plus':r.correctionDelta<0?'diff-minus':''}">${r.correctionDelta>0?'+':''}${money(r.correctionDelta)}</b></td><td>${r.correctionDelta===0?'<span class="badge paid">Klop</span>':r.correctionSettledBatchId?`<span class="badge done">Dikoreksi · ${esc(r.correctionSettledBatchId)}</span>`:'<span class="badge review">Belum Dikoreksi</span>'}</td></tr>`).join(''):'<tr><td colspan="6" class="muted">Belum ada data estimasi yang sudah mendapatkan final Shopee.</td></tr>';

    const rows=[...cache.anomalies];
    union.filter(x=>x.status==='incomeOnly').forEach(x=>rows.push({type:'Pembayaran tanpa Order',orderNo:x.orderNo,description:'No. Pesanan ada pada file Income tetapi detail Order belum ada di master. Pembayaran ditahan dari Batch otomatis.'}));
    union.filter(x=>x.status==='cancelled' && x.income).forEach(x=>rows.push({type:'Pesanan Batal memiliki Pembayaran',orderNo:x.orderNo,description:x.income.batchId?`Pesanan berstatus Batal tetapi sudah masuk ${x.income.batchId}. Periksa riwayat dan alasan pembatalan.`:`Pesanan berstatus Batal tetapi memiliki Pembayaran ${money(x.amount)}. Pembayaran ditahan dan tidak masuk Siap Dicairkan.`}));
    $('anomalyBody').innerHTML=rows.length?rows.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).map(x=>`<tr><td>${esc(x.type)}</td><td>${esc(x.orderNo||'-')}</td><td>${esc(x.description||'-')}</td></tr>`).join(''):'<tr><td colspan="3" class="muted">Tidak ada anomali yang perlu diperiksa.</td></tr>';
  }

  function renderEditHistory(){ const body=$('editHistoryBody'); if(!body)return; body.innerHTML=cache.edits.length?cache.edits.slice(0,100).map(x=>`<tr><td>${esc(localDateTime(x.createdAt))}</td><td>${esc(x.orderNoBefore||'-')}</td><td>${esc(x.orderNoAfter||'-')}</td><td>${esc(x.description||'-')}</td></tr>`).join(''):'<tr><td colspan="4" class="muted">Belum ada edit manual.</td></tr>'; }
  function renderAll(){ renderProductChoices('report');renderProductChoices('pending');renderProductChoices('ready');renderReportOrderStatusOptions();renderDashboard();renderUploads();renderReport();renderPending();renderCancelled();renderReady();renderHistory();renderRecon();renderEditHistory(); $('dbStatus').textContent=`Master: ${orderGroups().size} order · ${cache.incomes.length} pembayaran`; }

  function exportXlsxReport(){
    if(!window.XLSX){alert('Library Excel belum tersedia.');return;} const rows=currentReport();
    const detail=rows.map(r=>({
      'No. Pesanan':r.orderNo,'Nama Produk':r.lines.map(x=>x.product).join(' | '),'Variasi':r.lines.map(x=>x.variation).join(' | '),'Status':r.orderStatus||'',
      'Estimasi Saat Ini':r.estimateTotal||'','Estimasi Sudah Dicairkan':r.estimatePaidAmount||'','Pembayaran Final Shopee':r.income?r.amount:'','Selisih Final - Estimasi':r.estimateBatchId&&r.income?r.correctionDelta:'',
      'Tanggal Order':r.orderDate||'','Tanggal Pembayaran / Dana Dilepas':r.releasedDate||'','Status Pencairan':r.income?.batchId||r.estimateBatchId|| (r.status==='ready'?'Belum Dicairkan':r.status==='pending'?'Belum Dibayar Shopee':r.status==='cancelled'&&r.income?'Ditahan / Perlu Dicek':r.status==='cancelled'?'Pesanan Batal':r.status==='incomeOnly'?'Ditahan / Pembayaran tanpa Order':'')
    }));
    const wb=XLSX.utils.book_new(), ws=XLSX.utils.json_to_sheet(detail); XLSX.utils.book_append_sheet(wb,ws,'Laporan'); const sum=XLSX.utils.aoa_to_sheet([['Jumlah Pesanan',rows.length],['Total Penghasilan',rows.reduce((s,x)=>s+x.amount,0)]]); XLSX.utils.book_append_sheet(wb,sum,'Ringkasan'); XLSX.writeFile(wb,`Laporan_Pembayaran_Pencairan_${todayISO()}.xlsx`);
  }
  function exportBatchXlsx(){
    if(!window.XLSX){alert('Library Excel belum tersedia.');return;}
    const rows=[]; const groups=orderGroups();
    cache.batches.forEach(b=>{
      (b.items||[]).forEach(i=>{
        const lines=(Array.isArray(i.productsSnapshot)&&i.productsSnapshot.length)?i.productsSnapshot:(groups.get(i.orderNo)||[]);
        rows.push({'ID Batch':b.batchId,'Jenis Batch':b.type==='estimate'?'Estimasi':'Final','Status':b.status,'Dibuat':b.createdAt,'No. Pesanan':i.orderNo,'Jenis Baris':'Pesanan','Produk / Variasi':lines.map(x=>`${x.product||'-'}${x.variation?` | ${x.variation}`:''}${x.quantity?` x${x.quantity}`:''}`).join(' ; '),'Tanggal Order':i.orderDate||lines[0]?.orderDate||'','Tanggal Dana Dilepas':i.releasedDate,'Nominal Snapshot':i.amountSnapshot});
      });
      (b.corrections||[]).forEach(c=>rows.push({'ID Batch':b.batchId,'Jenis Batch':'Estimasi','Status':b.status,'Dibuat':b.createdAt,'No. Pesanan':c.orderNo,'Jenis Baris':'Koreksi','Produk / Variasi':'Selisih Final Shopee - Estimasi','Tanggal Order':'','Tanggal Dana Dilepas':'','Nominal Snapshot':c.delta}));
    });
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Riwayat Batch'); XLSX.writeFile(wb,`Riwayat_Batch_${todayISO()}.xlsx`);
  }


  function downloadJson(name,obj){ const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  function exportBackup(){downloadJson(`backup_shopee_payout_${todayISO()}.json`,{version:1,exportedAt:new Date().toISOString(),data:cache});setMessage('backupMessage','Backup JSON berhasil dibuat. Simpan file ini dengan aman.','success');}
  async function importBackup(file){
    try{const raw=JSON.parse(await file.text());if(!raw?.data)throw new Error('Format backup tidak valid.');for(const [k,store] of Object.entries(STORES)){await clearStore(store);await putMany(store,Array.isArray(raw.data[k])?raw.data[k]:[]);}await reloadCache();renderAll();setMessage('backupMessage','Backup berhasil dipulihkan.','success');}catch(e){setMessage('backupMessage',e.message||String(e),'error');}
  }
  async function resetDb(){
    $('dialogTitle').textContent='Hapus Semua Data Firebase'; $('dialogContent').innerHTML='<p>Semua Order Master, Pembayaran Master, Batch Pencairan, riwayat upload, log edit, dan anomali pada Firestore akan dihapus. Tindakan ini tidak dapat dibatalkan kecuali Anda punya backup JSON.</p>'; const dlg=$('confirmDialog');dlg.showModal();const result=await new Promise(resolve=>{const fn=()=>{dlg.removeEventListener('close',fn);resolve(dlg.returnValue)};dlg.addEventListener('close',fn)});if(result!=='confirm')return;for(const s of Object.values(STORES))await clearStore(s);await reloadCache();renderAll();setMessage('backupMessage','Semua data Firebase sudah dihapus.','warning');
  }

  const viewMeta={dashboard:['Dashboard','Ringkasan Order, Pembayaran Shopee, dan Pencairan.'],upload:['Upload Data','Import snapshot Order dan Income terbaru ke master.'],report:['Laporan Gabungan','Pembayaran dan Pencairan dipisahkan, dengan total mengikuti filter/pencarian.'],pending:['Pending Pembayaran','Pesanan aktif/non-batal yang belum ditemukan pada file pembayaran (Income).'],cancelled:['Pesanan Batal','Pesanan berstatus Batal dipisahkan dari Pending Pembayaran dan Siap Dicairkan.'],ready:['Siap Dicairkan','Pembayaran sudah masuk saldo Shopee tetapi belum masuk Batch Pencairan.'],history:['Riwayat Batch','Audit pencairan dan pembatalan batch.'],recon:['Rekonsiliasi','Pemeriksaan keseimbangan Pembayaran dan Pencairan.'],settings:['Backup & Data','Backup, restore, log edit, dan reset database Firebase.']};
  function setMobileNav(open){
    document.body.classList.toggle('mobile-nav-open', !!open);
  }
  function closeMobileNav(){ setMobileNav(false); }
  function switchView(name){
    $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
    $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
    $('pageTitle').textContent=viewMeta[name][0];
    $('pageSubtitle').textContent=viewMeta[name][1];
    closeMobileNav();
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function bind(){
    $$('.nav-btn').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    $$('[data-go]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.go)));
    on('mobileMenuBtn','click',()=>setMobileNav(true));
    on('mobileMenuClose','click',closeMobileNav);
    on('sidebarBackdrop','click',closeMobileNav);
    on('mobileMoreBtn','click',()=>setMobileNav(true));
    window.addEventListener('resize',()=>{ if(window.innerWidth>760) closeMobileNav(); });

    on('orderFile','change',()=>{ const f=$('orderFile')?.files?.[0]; if($('orderFileName')) $('orderFileName').textContent=f?.name||'Belum dipilih'; });
    on('incomeFile','change',()=>{ const f=$('incomeFile')?.files?.[0]; if($('incomeFileName')) $('incomeFileName').textContent=f?.name||'Belum dipilih'; });
    on('clearFilesBtn','click',()=>{ if($('orderFile')) $('orderFile').value=''; if($('incomeFile')) $('incomeFile').value=''; if($('orderFileName')) $('orderFileName').textContent='Belum dipilih'; if($('incomeFileName')) $('incomeFileName').textContent='Belum dipilih'; setMessage('importMessage','Pilihan file dikosongkan.','info'); });
    on('importBtn','click',importFiles);

    ['reportReleaseFrom','reportReleaseTo','reportOrderFrom','reportOrderTo','reportPaymentStatus','reportPayoutStatus','reportOrderStatus'].forEach(id=>on(id,'change',renderReport));
    on('reportSearch','input',renderReport);
    on('reportProductAll','click',()=>selectAllProducts('report'));
    on('reportProductNone','click',()=>clearAllProducts('report'));
    on('exportReportBtn','click',exportXlsxReport);


    ['pendingFrom','pendingTo','pendingStatus'].forEach(id=>on(id,'change',renderPending));
    on('pendingSearch','input',renderPending);
    on('pendingHtmlFile','change',()=>{
      const file=$('pendingHtmlFile')?.files?.[0];
      if($('pendingHtmlFileName')) $('pendingHtmlFileName').textContent=file?file.name:'Belum ada file HTML dipilih.';
      if($('importPendingHtmlBtn')) $('importPendingHtmlBtn').disabled=!file;
      resetPendingHtmlSummary();
      setMessage('pendingHtmlMessage',file?`File ${file.name} siap dibaca. Klik Import & Cocokkan.`:'No. Pesanan pada HTML akan dicocokkan dengan Master Order. Nominal “Dana Akan Dilepaskan” menjadi estimasi Shopee dan lebih diprioritaskan daripada estimasi manual.','info');
    });
    on('importPendingHtmlBtn','click',importPendingShopeeHtml);
    on('pendingProductAll','click',()=>selectAllProducts('pending'));
    on('pendingProductNone','click',()=>clearAllProducts('pending'));
    on('createEstimateBatchBtn','click',makeEstimateBatch);
    on('resetPendingFilter','click',()=>{ $('pendingFrom').value=''; $('pendingTo').value=''; $('pendingStatus').value='all'; $('pendingSearch').value=''; productSelections.pending=null; renderProductChoices('pending'); renderPending(); });
    ['cancelledFrom','cancelledTo','cancelledPayment'].forEach(id=>on(id,'change',renderCancelled));
    on('cancelledSearch','input',renderCancelled);
    on('resetCancelledFilter','click',()=>{ $('cancelledFrom').value=''; $('cancelledTo').value=''; $('cancelledPayment').value='all'; $('cancelledSearch').value=''; renderCancelled(); });
    ['readyFrom','readyTo'].forEach(id=>on(id,'change',renderReady));
    on('readySearch','input',renderReady);
    on('readyProductAll','click',()=>selectAllProducts('ready'));
    on('readyProductNone','click',()=>clearAllProducts('ready'));
    on('resetReadyFilter','click',()=>{ if($('readyFrom')) $('readyFrom').value=''; if($('readyTo')) $('readyTo').value=''; if($('readySearch')) $('readySearch').value=''; productSelections.ready=null; renderProductChoices('ready'); renderReady(); });
    on('createBatchBtn','click',makeBatch);

    on('exportBatchBtn','click',exportBatchXlsx);
    on('closeEstimateBtn','click',()=>{ $('estimateDialog')?.close(); estimatingOrderNo=null; });
    on('saveEstimateBtn','click',saveEstimateOrder);
    on('clearEstimateBtn','click',clearEstimateOrder);
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
