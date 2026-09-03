# QA v2.1.7

- [x] Syntax seluruh JS valid.
- [x] Riwayat hanya menampilkan batch `status=active`.
- [x] Tombol Hapus Batch tersedia untuk Estimasi dan Final.
- [x] Penghapusan Estimasi melepas `payoutLock` dan tidak menghidupkan estimasi lama.
- [x] Penghapusan Final melepas `payoutBatchId` / `batchId` Income.
- [x] Batch tombstone tetap tersinkron melalui manual sync.
- [x] Batch terhapus tidak masuk export/rekonsiliasi/payout map.
- [x] Dependensi koreksi antar-batch diblokir agar pembukuan tidak rusak.
