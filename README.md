# Shopee Payout v1.9 Firebase

Versi ini menggunakan Firebase Authentication + Cloud Firestore sebagai database utama.

## Firebase yang terpasang
- Project: `shopee-payout-b62c3`
- Firestore: database `(default)`
- Login: Email/Password
- Akses Firestore dikunci ke UID admin melalui Firestore Rules.
- Domain GitHub Pages yang harus ada di Authentication > Settings > Authorized domains: `pupus22.github.io`

## Deploy ke GitHub Pages
1. Replace `index.html`, `app.js`, dan `styles.css` di repository `telur_shope`.
2. Tunggu GitHub Pages selesai deploy.
3. Buka `https://pupus22.github.io/telur_shope/` lalu Ctrl+F5.
4. Login dengan akun Email/Password yang sudah dibuat di Firebase Authentication.
5. Upload file Order + Income. Collection Firestore dibuat otomatis saat import pertama.

## Collection Firestore
- `orders`: 1 dokumen per No. Pesanan; detail produk disimpan dalam array `items`.
- `incomes`: 1 dokumen per No. Pesanan.
- `batches`: Batch Pencairan + snapshot No. Pesanan/nominal.
- `uploads`: riwayat upload.
- `anomalies`: anomali import/data.
- `edits`: audit edit manual.

## Aturan penting
- No. Pesanan berulang di file Order adalah normal: 1 order dapat memiliki banyak produk.
- Income hanya dihitung satu kali per No. Pesanan.
- Halaman Siap Dicairkan difilter berdasarkan Tanggal Order.
- Pembuatan Batch memakai Firestore Transaction dan mengecek ulang `batchId` setiap Income untuk mencegah pencairan ganda.
- File Excel asli tidak di-upload ke Firestore; hanya hasil olah datanya yang disimpan.

## Catatan
Firebase config pada aplikasi web memang dapat berada di client. Keamanan data ditentukan oleh Firebase Authentication + Firestore Security Rules, bukan dengan menyembunyikan `firebaseConfig`.
