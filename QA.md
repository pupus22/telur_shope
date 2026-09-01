# QA v2.1.0

- Login: Firebase Auth saja; tidak ada Firestore read otomatis.
- Upload Order Excel: lokal, dirty queue bertambah, pindah halaman data tetap ada.
- Upload Income Excel: lokal; estimasi aktif order final dibersihkan lokal.
- Import HTML: snapshot lokal; estimasi HTML lama dibersihkan lokal.
- Manual estimate: lokal.
- Batch estimasi/final: snapshot lokal dan dirty queue.
- Refresh topbar dihapus.
- Sinkronisasi Firestore hanya tombol Pengaturan.
- Timestamp sinkron terakhir tampil setelah sukses.
- Sync gagal: dirty queue dan cache lokal tetap ada.
