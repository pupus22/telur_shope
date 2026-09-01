# Shopee Payout Manager v2.0.7 — Free-tier Mode

Versi ini mengurangi pemakaian Firestore agar cocok untuk paket gratis.

Perubahan utama:
- Login memakai cache lokal bila tersedia, tanpa membaca ulang seluruh Firestore.
- Full server read hanya saat cache belum pernah dibuat atau tombol Refresh ditekan.
- Upload Order/Income Excel memperbarui state lokal setelah write, tanpa `loadAll()`.
- Baris Order/Income yang isinya tidak berubah tidak ditulis ulang ke Firestore.
- Import HTML Pending memakai state lokal + batched writes, tanpa membaca 2 dokumen per order.
- Estimasi HTML yang sama persis tidak ditulis ulang.
- Edit estimasi manual tidak full reload.
- Selesai membuat Batch tidak full reload; snapshot langsung masuk state lokal.
- Riwayat upload dari server dibatasi 30 terbaru.
- Collection correction ledger tidak dibaca massal saat login.
- Cleanup estimasi tidak dijalankan setiap Refresh; Income upload tetap menghapus estimasi aktif berdasarkan No. Pesanan.

Deploy: index.html, app.js, core.js, styles.css.
