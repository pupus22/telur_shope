# Shopee Payout Manager v2.1.2

## Login architecture fix
- Firebase Authentication dipisahkan ke `auth.js`.
- `app.js` baru dimuat setelah UID admin lolos.
- Firestore SDK tidak dimuat saat login; baru dimuat ketika tombol Sinkronkan Sekarang dipakai.
- Login menampilkan kode error Firebase yang sebenarnya jika gagal.
- Persistence Auth dipaksa `browserLocalPersistence`.
- Local-first/manual-sync tetap dipertahankan.

Deploy: index.html, auth.js, app.js, core.js, styles.css.
