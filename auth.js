import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
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
function msg(text,type='info'){
  const el=$('loginMessage');if(!el)return;el.className=`message ${type}`;el.innerHTML=text;
}
function setBusy(v){const b=$('loginBtn');if(b){b.disabled=v;b.textContent=v?'Memeriksa...':'Login';}}
function authError(err){
  const code=err?.code||'auth/unknown';
  const map={
    'auth/invalid-credential':'Email atau password tidak cocok.',
    'auth/invalid-login-credentials':'Email atau password tidak cocok.',
    'auth/user-disabled':'Akun Firebase ini dinonaktifkan.',
    'auth/too-many-requests':'Terlalu banyak percobaan login. Tunggu sebentar lalu coba lagi.',
    'auth/network-request-failed':'Browser gagal menghubungi Firebase Authentication. Periksa koneksi/jaringan.',
    'auth/operation-not-allowed':'Login Email/Password belum diaktifkan di Firebase Authentication.',
    'auth/unauthorized-domain':'Domain GitHub Pages belum diizinkan di Firebase Authentication.'
  };
  return `${map[code]||err?.message||'Login gagal.'}<br><small>Kode: ${esc(code)}</small>`;
}

const firebaseApp=initializeApp(FIREBASE_CONFIG);
const auth=getAuth(firebaseApp);
let launched=false;

async function launch(user){
  if(launched)return;
  if(!user||user.uid!==ADMIN_UID)throw new Error('UID akun tidak sesuai admin aplikasi.');
  msg('Auth berhasil. Memuat aplikasi lokal...','success');
  const mod=await import('./app.js?v=2.1.2');
  await mod.startApp({firebaseApp,auth,user,signOut});
  launched=true;
}

$('loginForm')?.addEventListener('submit',async e=>{
  e.preventDefault();setBusy(true);msg('Menghubungi Firebase Authentication...','info');
  try{
    await setPersistence(auth,browserLocalPersistence);
    const cred=await signInWithEmailAndPassword(auth,$('loginEmail').value.trim(),$('loginPassword').value);
    if(cred.user.uid!==ADMIN_UID){await signOut(auth);throw Object.assign(new Error('Akun valid, tetapi UID bukan admin aplikasi.'),{code:'auth/not-admin'});}
    await launch(cred.user);
  }catch(err){msg(authError(err),'warning');console.error('LOGIN_ERROR',err);}
  finally{setBusy(false);}
});

onAuthStateChanged(auth,async user=>{
  try{
    if(user&&user.uid===ADMIN_UID){await launch(user);return;}
    launched=false;$('authGate').hidden=false;$('appShell').hidden=true;
    if(user){await signOut(auth);msg('Akun Firebase terdeteksi tetapi bukan admin aplikasi.','warning');}
    else msg('Auth siap. Masuk menggunakan akun admin Firebase.','info');
  }catch(err){
    launched=false;$('authGate').hidden=false;$('appShell').hidden=true;
    msg(`Auth berhasil tetapi aplikasi gagal dimuat.<br><small>${esc(err?.message||String(err))}</small>`,'warning');
    console.error('APP_BOOT_ERROR',err);
  }
});

window.addEventListener('error',e=>console.error('WINDOW_ERROR',e.error||e.message));
window.addEventListener('unhandledrejection',e=>console.error('UNHANDLED_REJECTION',e.reason));
