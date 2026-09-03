import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signOut,
  setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';

const FIREBASE_CONFIG={
  apiKey:'AIzaSyDYc-6mcJK4NgMfjFL4Xyew2hSixYv51As',
  authDomain:'shopee-payout-b62c3.firebaseapp.com',
  projectId:'shopee-payout-b62c3',
  storageBucket:'shopee-payout-b62c3.firebasestorage.app',
  messagingSenderId:'472652935238',
  appId:'1:472652935238:web:d49c26f38b471c5e69da47'
};
const ADMIN_UID='ISAloBhuHVQwGKzwVLpOXKMcstn2';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function bootMessage(text,type='info',showLogin=false){
  const el=$('bootMessage');
  if(el){el.className=`message ${type}`;el.innerHTML=text;}
  const link=$('backLoginLink');
  if(link)link.hidden=!showLogin;
}

let auth;
let launched=false;
try{
  const firebaseApp=initializeApp(FIREBASE_CONFIG);
  auth=getAuth(firebaseApp);
  await setPersistence(auth,browserLocalPersistence);
  bootMessage('Memeriksa sesi admin...','info');

  onAuthStateChanged(auth,async user=>{
    if(launched)return;
    if(!user){location.replace('./login.html');return;}
    if(user.uid!==ADMIN_UID){
      await signOut(auth);
      location.replace('./login.html?reason=not-admin');
      return;
    }
    launched=true;
    try{
      bootMessage('Sesi valid. Memuat aplikasi lokal...','success');
      const mod=await import('./app-2.1.7.js');
      await mod.startApp({firebaseApp,auth,user,signOut});
      $('bootGate').hidden=true;
      $('appShell').hidden=false;
    }catch(err){
      launched=false;
      console.error('APP_BOOT_ERROR',err);
      $('appShell').hidden=true;
      $('bootGate').hidden=false;
      const detail=esc(err?.stack||'');
      bootMessage(`Login berhasil, tetapi aplikasi gagal dimuat.<br><b>${esc(err?.message||String(err))}</b><br><small>Ini bukan error password/Auth.</small>${detail?`<details class="boot-detail"><summary>Detail teknis</summary><pre>${detail}</pre></details>`:''}`,'warning',true);
    }
  });
}catch(err){
  console.error('BOOT_AUTH_ERROR',err);
  bootMessage(`Firebase Authentication gagal dimuat.<br><b>${esc(err?.message||String(err))}</b>`,'warning',true);
}
