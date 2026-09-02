# QA v2.1.6

- [x] Final Income ada -> Estimasi/Riwayat tidak tampil di Laporan Gabungan.
- [x] Final Income ada -> Status Pending HTML tidak ikut Export Laporan Gabungan.
- [x] Belum ada Final Income -> HTML/manual tetap tampil sebagai estimasi.
- [x] Snapshot Batch Estimasi dan koreksi tidak dihapus.
- [x] File asset menggunakan nama v2.1.6 untuk menghindari cache versi lama.
- [x] Syntax semua JS diperiksa sebagai ES module.


- Filter Status Pencairan: kosong=semua; Pending/Siap Dicairkan/Sudah Dicairkan bersifat OR antar-checkbox dan AND dengan filter tanggal/status order/produk/pencarian.
- Sudah Dicairkan ditentukan dari snapshot Batch (`paidBatchId`), termasuk Batch Estimasi yang masih menunggu Final Excel.
