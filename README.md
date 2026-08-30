# Shopee Payout Web v1.7

Hotfix untuk error GitHub Pages `Cannot read properties of null (reading addEventListener)`.

## Perubahan v1.7

Halaman **Siap Dicairkan** sekarang dipatenkan menggunakan **Tanggal Order** sebagai satu-satunya dasar filter periode. Tidak ada lagi dropdown pilihan Tanggal Dana Dilepas / Tanggal Order. Kolom Tanggal Dana Dilepas tetap tampil sebagai informasi dari Income. Batch baru selalu menyimpan `dateBasis: order`.

## Deploy
Upload **semua file** dari folder ini bersamaan: `index.html`, `app.js`, `styles.css`. Jangan hanya mengganti satu file. Setelah GitHub Pages selesai deploy, lakukan hard refresh (`Ctrl+F5`).

Database tetap menggunakan IndexedDB browser. Hotfix ini juga membedakan error database dari error antarmuka.

# Shopee Order · Pembayaran · Pencairan v1.7

Web uji lokal untuk menggabungkan snapshot Excel Order dan Income Shopee, menyimpan master di IndexedDB browser, serta membuat Batch Pencairan tanpa mencairkan No. Pesanan yang sama dua kali.

## Aturan utama
- File Order: No. Pesanan boleh ganda karena satu pesanan dapat memiliki beberapa produk/SKU/variasi.
- File Income: aplikasi memakai baris `Lihat berdasarkan = Order`, sehingga satu No. Pesanan memiliki satu nominal Pembayaran Shopee.
- Pembayaran Shopee berbeda dengan Pencairan. Pembayaran = dana dilepas Shopee ke saldo. Pencairan = No. Pesanan dimasukkan ke Batch Pencairan aplikasi.
- Batch mengunci No. Pesanan dan tetap dikenali pada upload harian berikutnya.

## Filter sumber pada Siap Dicairkan
- **ORDER / file Order**: penyaringan dimulai dari Master Order. Tanggal memakai Tanggal Order. Produk berasal langsung dari `Nama Produk` pada Order. Hasil No. Pesanan kemudian dicocokkan ke Income.
- **INCOME / file Income**: penyaringan dimulai dari Master Income. Tanggal memakai Tanggal Dana Dilepas. Filter produk tidak digunakan karena kolom produk tidak berasal dari file Income.

## Baru di v1.6 — pilihan produk centang
- Filter produk tidak lagi diketik manual.
- Nama produk dimuat otomatis dan persis dari kolom `Nama Produk` pada Master Order.
- Tersedia checkbox untuk memilih satu atau beberapa produk sekaligus.
- Tombol **Pilih Semua** memilih seluruh produk.
- Tombol **Kosongkan** menghapus seluruh pilihan; hasil ORDER menjadi 0 sampai minimal satu produk dicentang.
- Laporan Gabungan juga memakai daftar checkbox produk yang sama.
- Snapshot Batch menyimpan daftar produk yang dipilih, sumber ORDER/INCOME, periode tanggal, dan pencarian No. Pesanan.
- Bila satu No. Pesanan berisi produk terpilih sekaligus produk lain, aplikasi memberi tanda **Pesanan campuran**. Seluruh Income No. Pesanan tetap ikut batch karena Income hanya satu nominal per No. Pesanan.

## Penyimpanan
Versi uji menyimpan master di IndexedDB browser. File Excel asli tidak disimpan. Untuk pemakaian lintas perangkat, database sebaiknya dipindahkan ke Firebase.


## Perubahan v1.6
- Halaman Siap Dicairkan tidak lagi memilih sumber file ORDER/INCOME.
- Order dan Income selalu diperlakukan sebagai data gabungan berdasarkan No. Pesanan.
- Filter tanggal hanya memilih acuan: Tanggal Dana Dilepas atau Tanggal Order.
- Filter produk selalu tersedia dari Master Order dan hasil tetap dicocokkan ke Income.
- Tabel Siap Dicairkan selalu menampilkan data gabungan: produk, variasi, tanggal order, tanggal dana dilepas, nominal pembayaran, dan status pencairan.
