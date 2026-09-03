# Shopee Payout Manager v2.1.7

## Hapus Batch
- Riwayat Batch Estimasi dan Final memiliki tombol **Hapus Batch**.
- Penghapusan bersifat local-first; Firebase baru ikut berubah saat **Sinkronkan Sekarang** ditekan.
- Batch yang dihapus disimpan sebagai tombstone `status: deleted` agar perangkat lain ikut mengetahui penghapusan tanpa perlu full delete Firestore.
- Batch Estimasi: payout lock dilepas, estimasi snapshot batch tidak dihidupkan kembali. Jika Final Excel sudah ada, order kembali ke Siap Dicairkan; jika belum, kembali Pending tanpa estimasi.
- Batch Final: payout lock Income dilepas sehingga order kembali ke Siap Dicairkan.
- Koreksi yang berada di batch yang dihapus otomatis kembali belum diterapkan.
- Jika koreksi dari sebuah batch sudah dipakai pada batch lain, batch sumber diblokir dari penghapusan sampai batch koreksi yang bergantung dihapus lebih dulu.
