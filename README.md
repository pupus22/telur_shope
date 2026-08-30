# Shopee Order · Pembayaran · Pencairan v1.3

Web uji lokal untuk menggabungkan snapshot Excel Order dan Income Shopee, menyimpan master di IndexedDB browser, serta membuat Batch Pencairan tanpa mencairkan No. Pesanan yang sama dua kali.

## Aturan utama
- File Order: No. Pesanan boleh ganda karena satu pesanan dapat memiliki beberapa produk/SKU/variasi.
- File Income: aplikasi memakai baris `Lihat berdasarkan = Order`, sehingga satu No. Pesanan memiliki satu nominal Pembayaran Shopee.
- Pembayaran Shopee berbeda dengan Pencairan. Pembayaran = dana dilepas Shopee ke saldo. Pencairan = No. Pesanan dimasukkan ke Batch Pencairan aplikasi.
- Batch mengunci No. Pesanan dan tetap dikenali pada upload harian berikutnya.

## Baru di v1.3
- Filter Produk pada Laporan Gabungan.
- Filter Produk pada menu Siap Dicairkan.
- Filter produk menggunakan pencarian sebagian teks, misalnya `telur`, `omega`, atau `horn`.
- Daftar saran produk diambil otomatis dari Master Order.
- Jumlah pesanan dan nominal siap dicairkan mengikuti filter tanggal + produk.
- Filter yang digunakan disimpan sebagai snapshot di Batch.
- Pesanan campuran diberi peringatan. Jika satu No. Pesanan berisi produk yang cocok dengan filter dan produk lain, seluruh nominal Income order tetap ikut batch karena Income hanya satu nominal per No. Pesanan.

## Penyimpanan
Versi uji menyimpan master di IndexedDB browser. File Excel asli tidak disimpan oleh aplikasi. Untuk pemakaian lintas perangkat, database akan lebih aman dipindahkan ke Firebase.


## Tambahan v1.3
- Halaman **Siap Dicairkan** memiliki pilihan dasar tanggal: **Tanggal Dana Dilepas** atau **Tanggal Order**.
- Rentang Dari/Sampai mengikuti dasar tanggal yang dipilih.
- Snapshot batch menyimpan dasar tanggal dan periode filter agar riwayat pencairan dapat diaudit.
