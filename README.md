# Shopee Payout Manager v2.1.3

Perubahan utama: login dipisahkan menjadi `login.html`.

- `login.html` + `login-2.1.3.js`: hanya Firebase Authentication.
- `index.html` + `bootstrap-2.1.3.js`: cek sesi admin lalu baru memuat aplikasi.
- `app-2.1.3.js` + `core-2.1.3.js`: aplikasi utama.
- Firestore tetap hanya digunakan ketika tombol Sinkronkan Sekarang ditekan.
- Nama file versi dibuat unik agar cache GitHub Pages/browser tidak memuat JS lama.
