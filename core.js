export const APP_VERSION = '2.0.4';
export const SCHEMA_VERSION = 2;

export function text(v){ return String(v ?? '').trim(); }
export function num(v){
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const s = text(v);
  if (!s) return 0;
  const negative = /^\s*-/.test(s) || /^\s*\(/.test(s);
  const digits = s.replace(/[^0-9]/g, '');
  const n = digits ? Number(digits) : 0;
  return negative ? -n : n;
}
export function isCancelled(status){
  const s = text(status).toLowerCase();
  return s === 'batal' || s.startsWith('batal ') || s.includes('dibatalkan') || s.includes('cancelled');
}
export function unique(values){ return [...new Set(values.filter(Boolean))]; }
export function safeDateOnly(v){
  if (!v) return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y=v.getFullYear(), m=String(v.getMonth()+1).padStart(2,'0'), d=String(v.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Excel serial date, using UTC avoids timezone drift.
    const utc = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (!Number.isNaN(utc.getTime())) return utc.toISOString().slice(0,10);
  }
  const s=text(v);
  let m=s.match(/^(\d{4})[-\/]([01]?\d)[-\/]([0-3]?\d)/);
  if(m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m=s.match(/^([0-3]?\d)[-\/]([01]?\d)[-\/](\d{4})/);
  if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return '';
}
export function fileEndDate(filename){
  const s=text(filename);
  const all=[...s.matchAll(/(20\d{6})/g)].map(m=>m[1]);
  if(!all.length) return '';
  const x=all[all.length-1];
  return `${x.slice(0,4)}-${x.slice(4,6)}-${x.slice(6,8)}`;
}
export function compareSourceDate(incoming, existing){
  if (!incoming || !existing) return 0; // unknown = allow
  return incoming.localeCompare(existing);
}
export function estimateAmount(est){ return Number(est?.amount)||0; }

export function normalizeIncome(raw={}, id=''){
  return {
    ...raw,
    orderNo: text(raw.orderNo || id),
    amount: Number(raw.amount ?? raw.totalIncome ?? raw['Total Penghasilan']) || 0,
    orderDate: raw.orderDate || raw.orderCreatedDate || '',
    releaseDate: raw.releaseDate || raw.releasedDate || '',
    payoutBatchId: raw.payoutBatchId || raw.batchId || null,
    skuRows: Array.isArray(raw.skuRows) ? raw.skuRows : [],
  };
}

export function legacyEstimateFromOrder(raw={}, hasIncome=false){
  if (raw.pendingEstimate && Number(raw.pendingEstimate.amount)>0) return raw.pendingEstimate;
  const htmlAmount=Number(raw.shopeePendingAmount)||0;
  if (htmlAmount>0) {
    return {
      source:'html', amount:htmlAmount,
      status:raw.shopeePendingStatus||'',
      releaseEstimate:raw.shopeePendingReleaseEstimate||'',
      paymentMethod:raw.shopeePendingPaymentMethod||'',
      updatedAt:raw.shopeePendingImportedAt||raw.lastImportedAt||null,
      sourceFile:raw.shopeePendingSourceFile||'',
      items:[]
    };
  }
  const itemTotal=(Array.isArray(raw.items)?raw.items:[]).reduce((s,x)=>s+(Number(x.estimateSubtotal)||0),0);
  if(itemTotal>0){
    return {source:'manual',amount:itemTotal,updatedAt:raw.lastManualEditAt||raw.lastImportedAt||null,sourceFile:'',items:(raw.items||[]).map(x=>({key:x.lineKey||'',amount:Number(x.estimateSubtotal)||0,unit:Number(x.estimateUnit)||0}))};
  }
  return null;
}

export function normalizeOrder(raw={}, id='', hasIncome=false){
  const orderNo=text(raw.orderNo || id);
  const legacyEstimate=legacyEstimateFromOrder(raw,hasIncome);
  let pendingEstimate=raw.pendingEstimate ?? null;
  let lastEstimate=raw.lastEstimate ?? null;
  let payoutLock=raw.payoutLock ?? null;
  if(!payoutLock && raw.estimateBatchId){
    payoutLock={
      batchId:raw.estimateBatchId,
      source:'estimate',
      amount:Number(raw.estimatePaidAmount)||estimateAmount(legacyEstimate),
      paidAt:raw.estimatePaidAt||null,
      estimateSource:raw.estimatePaidSource||legacyEstimate?.source||'manual',
      estimateSnapshot:legacyEstimate||null
    };
  }
  if(!pendingEstimate && !hasIncome && !isCancelled(raw.status) && !payoutLock && legacyEstimate) pendingEstimate=legacyEstimate;
  if(!lastEstimate && (hasIncome || payoutLock) && legacyEstimate) lastEstimate=legacyEstimate;
  if(isCancelled(raw.status) && pendingEstimate){ if(!lastEstimate) lastEstimate=pendingEstimate; pendingEstimate=null; }
  if(hasIncome) pendingEstimate=null; // FINAL Excel always wins.
  return {
    ...raw,
    orderNo,
    status:text(raw.status),
    cancelReason:text(raw.cancelReason),
    orderDate:raw.orderDate||'',
    orderDateTime:raw.orderDateTime||'',
    items:Array.isArray(raw.items)?raw.items:[],
    pendingEstimate,
    lastEstimate,
    payoutLock,
    schemaVersion:Number(raw.schemaVersion)||1,
  };
}

export function activeEstimate(order, income){
  if(!order || income || isCancelled(order.status) || order.payoutLock) return null;
  const est=order.pendingEstimate;
  return est && Number(est.amount)>0 ? est : null;
}

export function historicalEstimate(order){
  if(!order) return null;
  if(order.payoutLock?.source==='estimate' && order.payoutLock.estimateSnapshot) return order.payoutLock.estimateSnapshot;
  if(order.lastEstimate) return order.lastEstimate;
  if(order.pendingEstimate) return order.pendingEstimate;
  return null;
}

export function normalizeBatch(raw={}, id=''){
  const status=raw.status || 'active';
  const items=(Array.isArray(raw.items)?raw.items:[]).map(x=>({
    orderNo:text(x.orderNo),
    basis:x.basis || (raw.type==='estimate'?'estimate':'final'),
    amount:Number(x.amount ?? x.amountSnapshot)||0,
    orderDate:x.orderDate||'',
    releaseDate:x.releaseDate||x.releasedDate||'',
    products:Array.isArray(x.products)?x.products:(Array.isArray(x.productsSnapshot)?x.productsSnapshot:[]),
    estimateSource:x.estimateSource||x.priorEstimateSourceSnapshot||null,
  }));
  const corrections=(Array.isArray(raw.corrections)?raw.corrections:[]).map(c=>({
    orderNo:text(c.orderNo),
    appliedAmount:Number(c.appliedAmount ?? c.delta)||0,
    finalAmount:Number(c.finalAmount)||0,
    paidAmount:Number(c.paidAmount ?? c.estimatePaidAmount)||0,
  }));
  return {
    ...raw,
    batchId:text(raw.batchId||id),
    status,
    kind:raw.kind || raw.type || (items.some(x=>x.basis==='estimate')?'estimate':'final'),
    items,
    corrections,
    baseAmount:Number(raw.baseAmount ?? raw.baseActiveTotal ?? raw.baseEstimateTotal ?? raw.baseFinalTotal)||items.reduce((s,x)=>s+x.amount,0),
    correctionAmount:Number(raw.correctionAmount ?? raw.correctionTotal)||corrections.reduce((s,x)=>s+x.appliedAmount,0),
    payoutAmount:Number(raw.payoutAmount ?? raw.totalSnapshot)||0,
  };
}

export function buildPayoutItemMap(batches=[]){
  const map=new Map();
  for(const b of batches){
    if(b.status && b.status!=='active') continue;
    for(const item of b.items||[]){
      if(item.orderNo && !map.has(item.orderNo)) map.set(item.orderNo,{...item,batchId:b.batchId,batchCreatedAt:b.createdAt||''});
    }
  }
  return map;
}
export function buildCorrectionAppliedMap(batches=[], orders=new Map(), incomes=new Map()){
  const map=new Map();
  for(const b of batches){
    if(b.status && b.status!=='active') continue;
    for(const c of b.corrections||[]){
      if(!c.orderNo) continue;
      map.set(c.orderNo,(map.get(c.orderNo)||0)+(Number(c.appliedAmount)||0));
    }
  }
  // Legacy fallback: old app could mark correctionSettledBatchId on order without a usable correction row.
  for(const [orderNo,o] of orders){
    if(!o.correctionSettledBatchId || map.has(orderNo)) continue;
    const inc=incomes.get(orderNo);
    const paid=Number(o.estimatePaidAmount || o.payoutLock?.amount)||0;
    if(inc && paid) map.set(orderNo,Number(inc.amount)-paid);
  }
  return map;
}

export function deriveRecord(orderNo, order, income, payoutItem, appliedCorrection=0){
  const cancelled=!!order && isCancelled(order.status);
  const estActive=activeEstimate(order,income);
  const estHistory=historicalEstimate(order);
  const paidSnapshot=payoutItem?.amount ?? (order?.payoutLock?.amount || (income?.payoutBatchId ? income.amount : 0));
  const paidBatchId=payoutItem?.batchId || order?.payoutLock?.batchId || income?.payoutBatchId || null;
  let state='unknown';
  if(!order && income) state='incomeOnly';
  else if(cancelled && income) state='cancelledWithIncome';
  else if(cancelled) state='cancelled';
  else if(order && !text(order.status)) state='orderStatusUnknown';
  else if(income && Number(income.amount)<=0) state='incomeNonPositive';
  else if(payoutItem || order?.payoutLock || income?.payoutBatchId){
    state=income ? 'paidFinalKnown' : 'paidEstimateAwaitingFinal';
  } else if(income) state='readyFinal';
  else if(order && estActive) state='pendingEstimated';
  else if(order) state='pendingUnestimated';
  const originalCorrection=(income && paidBatchId) ? Number(income.amount)-Number(paidSnapshot||0) : 0;
  const remainingCorrection=originalCorrection-Number(appliedCorrection||0);
  return {
    orderNo, order, income, state, cancelled,
    activeEstimate:estActive,
    estimateHistory:estHistory,
    payoutItem:payoutItem||null,
    paidBatchId,
    paidSnapshot:Number(paidSnapshot)||0,
    appliedCorrection:Number(appliedCorrection)||0,
    originalCorrection,
    remainingCorrection,
  };
}

export function recordsFromMaps(orders, incomes, batches){
  const payoutMap=buildPayoutItemMap(batches);
  const appliedMap=buildCorrectionAppliedMap(batches,orders,incomes);
  const keys=new Set([...orders.keys(),...incomes.keys(),...payoutMap.keys()]);
  return [...keys].map(orderNo=>deriveRecord(orderNo,orders.get(orderNo)||null,incomes.get(orderNo)||null,payoutMap.get(orderNo)||null,appliedMap.get(orderNo)||0));
}

export function buildCorrectionPlan(records, baseAmount){
  let available=Math.max(0,Number(baseAmount)||0);
  const apps=[];
  const candidates=records.filter(r=>r.state==='paidFinalKnown' && r.income && r.paidBatchId && Math.round(r.remainingCorrection)!==0)
    .sort((a,b)=>String(a.income?.releaseDate||'').localeCompare(String(b.income?.releaseDate||'')) || a.orderNo.localeCompare(b.orderNo));
  // Positive corrections first, because they increase cash available and cannot make the batch negative.
  for(const r of candidates.filter(r=>r.remainingCorrection>0)){
    const applied=Math.round(r.remainingCorrection);
    apps.push({orderNo:r.orderNo,appliedAmount:applied,remainingBefore:r.remainingCorrection,finalAmount:r.income.amount,paidAmount:r.paidSnapshot,sourceBatchId:r.paidBatchId});
    available+=applied;
  }
  for(const r of candidates.filter(r=>r.remainingCorrection<0)){
    const wanted=Math.round(r.remainingCorrection); // negative
    const applied=Math.max(wanted,-available);
    if(applied===0) continue;
    apps.push({orderNo:r.orderNo,appliedAmount:applied,remainingBefore:r.remainingCorrection,finalAmount:r.income.amount,paidAmount:r.paidSnapshot,sourceBatchId:r.paidBatchId});
    available+=applied;
  }
  return {applications:apps,correctionAmount:apps.reduce((s,x)=>s+x.appliedAmount,0),payoutAmount:available};
}
