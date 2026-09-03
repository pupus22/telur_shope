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

function show(text,type='info'){
  const el=$('loginMessage');
  if(!el)return;
  el.className=`message ${type}`;
  el.innerHTML=text;
}
function busy(v){
  const b=$('loginBtn');
  if(!b)return;
  b.disabled=v;
  b.textContent=v?'Memeriksa...':'Login';
}
function explain(err){
  const code=err?.code||'auth/unknown';
  const map={
    'auth/invalid-credential':'Email atau password tidak cocok.',
    'auth/invalid-login-credentials':'Email atau password tidak cocok.',
    'auth/user-disabled':'Akun Firebase dinonaktifkan.',
    'auth/too-many-requests':'Terlalu banyak percobaan login. Tunggu sebentar lalu coba lagi.',
    'auth/network-request-failed':'Tidak dapat menghubungi Firebase Authentication.',
    'auth/operation-not-allowed':'Email/Password belum diaktifkan di Firebase Authentication.',
    'auth/unauthorized-domain':'Domain GitHub Pages belum diizinkan di Firebase Authentication.'
  };
  return `${map[code]||err?.message||'Login gagal.'}<br><small>Kode: ${esc(code)}</small>`;
}

let auth;
try{
  const app=initializeApp(FIREBASE_CONFIG);
  auth=getAuth(app);
  await setPersistence(auth,browserLocalPersistence);
  show('Firebase Auth siap. Silakan login.','info');
}catch(err){
  show(`Firebase Auth gagal dimuat.<br><small>${esc(err?.message||String(err))}</small>`,'warning');
  console.error('AUTH_INIT_ERROR',err);
}

$('loginForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!auth){show('Firebase Auth belum siap. Refresh halaman ini.','warning');return;}
  busy(true);show('Memeriksa akun admin...','info');
  try{
    const cred=await signInWithEmailAndPassword(auth,$('loginEmail').value.trim(),$('loginPassword').value);
    if(cred.user.uid!==ADMIN_UID){
      await signOut(auth);
      const er=new Error('Akun valid, tetapi bukan admin aplikasi.');
      er.code='auth/not-admin';
      throw er;
    }
    show('Login berhasil. Membuka aplikasi...','success');
    location.replace('./index.html');
  }catch(err){
    console.error('LOGIN_ERROR',err);
    show(explain(err),'warning');
  }finally{busy(false);}
});

if(auth){
  onAuthStateChanged(auth,async user=>{
    if(user?.uid===ADMIN_UID){
      show('Sesi admin sudah aktif. Membuka aplikasi...','success');
      location.replace('./index.html');
    }else if(user){
      await signOut(auth);
      show('Sesi sebelumnya bukan akun admin. Silakan login ulang.','warning');
    }
  });
}
