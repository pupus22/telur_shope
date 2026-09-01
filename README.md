# Shopee Payout Manager v2.1.0 — Local First / Manual Sync

Semua upload Excel, HTML Pending, estimasi manual, dan Batch disimpan ke localStorage terlebih dahulu. Tidak ada read/write Firestore otomatis setelah login. Satu-satunya sinkronisasi data Firestore dilakukan lewat tombol **Sinkronkan Sekarang** di Pengaturan.

Sinkron manual mengirim perubahan lokal yang tertunda, lalu mengambil snapshot server terbaru dan mencatat tanggal/jam sinkron terakhir. Bila sinkron gagal/quota habis, perubahan lokal tetap tersimpan.
