# Shopee Payout Manager v2.1.6

Perubahan utama:
- Laporan Gabungan mengikuti aturan **Excel final selalu menang**.
- Jika suatu No. Pesanan sudah memiliki Final Income Excel, kolom **Estimasi / Riwayat** menampilkan `-` dan HTML Shopee tidak lagi ditampilkan sebagai acuan aktif.
- Data estimasi lama tetap disimpan secara internal untuk kebutuhan audit, snapshot Batch Estimasi, dan perhitungan koreksi; hanya tampilan Laporan Gabungan yang dibersihkan.
- Export Laporan Gabungan juga mengosongkan kolom Estimasi / Sumber Estimasi / Status Pending HTML jika Final Income sudah tersedia.
- Local-first, login terpisah, dan manual sync tetap dipertahankan.


## v2.1.6
Laporan Gabungan menambahkan filter checkbox Status Pencairan: Pending, Siap Dicairkan, dan Sudah Dicairkan. Checkbox kosong berarti semua. Filter dapat dikombinasikan dengan tanggal, Status Order Excel, produk, dan pencarian.
