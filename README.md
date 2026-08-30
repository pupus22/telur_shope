# Shopee Order · Pembayaran · Pencairan v1.1

Web lokal/GitHub Pages untuk menggabungkan file Order dan Income Shopee.

## Konsep utama
- File Order: No. Pesanan boleh ganda; setiap baris produk/variasi dipertahankan.
- File Income: satu No. Pesanan dipakai satu kali pada baris `Lihat berdasarkan = Order`.
- Pembayaran: dana yang sudah dilepas Shopee ke saldo penjual (berasal dari file Income).
- Pencairan: batch yang dibuat pengguna untuk menandai pembayaran yang sudah dicairkan.
- No. Pesanan yang sudah masuk batch memiliki tanda permanen `Sudah Dicairkan · BATCH-...` dan tidak masuk batch berikutnya.

## v1.1
- Status Pembayaran dan Status Pencairan dipisahkan.
- Ringkasan hasil filter/pencarian: jumlah pesanan, total Pembayaran, belum dicairkan, sudah dicairkan.
- Edit Master dari Laporan Gabungan, Pending Pembayaran, dan Siap Dicairkan.
- Field yang dapat dikoreksi: No. Pesanan, status/tanggal Order, produk, variasi, jumlah, nominal/tanggal Pembayaran, serta keanggotaan Batch Pencairan.
- Perubahan manual dicatat pada Riwayat Edit Manual.
- Batch menyimpan No. Pesanan dan nominal snapshot.
- Batch dapat dibatalkan tanpa menghapus jejak audit.
- Upload harian melakukan insert/update ke IndexedDB; file Excel lama tidak perlu disimpan.
- Backup/restore JSON untuk memindahkan database lokal.

## Menjalankan
1. Ekstrak ZIP.
2. Buka `index.html` (membutuhkan internet saat pertama kali memuat library XLSX).
3. Upload file Order dan Income terbaru.
4. Gunakan Laporan Gabungan untuk memeriksa data.
5. Gunakan Siap Dicairkan untuk filter lalu buat Batch Pencairan.

## GitHub Pages
Upload hanya file aplikasi (`index.html`, `app.js`, `styles.css`, `README.md`). Jangan upload file Excel transaksi/pelanggan ke repository publik.

## Penyimpanan
Versi uji memakai IndexedDB pada browser. Untuk pemakaian lintas perangkat, database dapat dipindahkan ke Firebase pada tahap berikutnya.
