# Shopee Payout Manager v2.1.4 — Full Fix

Versi ini memperbaiki kegagalan startup setelah login pada v2.1.3.

File deploy wajib:

- `login.html`
- `login-2.1.4.js`
- `index.html`
- `bootstrap-2.1.4.js`
- `app-2.1.4.js`
- `core-2.1.4.js`
- `styles-2.1.4.css`

Login dan aplikasi tetap dipisah. Firebase Authentication digunakan pada halaman login/index, sedangkan Firestore hanya diakses saat tombol **Sinkronkan Sekarang** di Pengaturan ditekan. Upload Excel/HTML, filter, laporan, dan Batch tetap local-first.
