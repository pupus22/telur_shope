# Shopee Payout v1.13.2



- Halaman **Siap Dicairkan** sekarang menggabungkan dua sumber aktif: **Final Income** dan **Pending Estimasi**.
- Jika Income sudah ada, **Final Income selalu menang** dan estimasi hanya referensi.
- Jika Income belum ada tetapi estimasi HTML/manual lengkap, estimasi tampil sebagai **Siap · Estimasi** dan bisa masuk Batch Pencairan.
- Satu Batch dapat berisi kombinasi Final + Estimasi (`type: mixed`).
- Saat Income muncul setelah estimasi sudah dicairkan, hanya selisih Final - Estimasi yang menjadi koreksi.
- Transaction guard membatalkan batch bila Income baru masuk di tengah proses, agar nilai estimasi tidak dipakai saat Final sudah tersedia.

## Perbaikan v1.13.2 — Pending Estimasi masuk Siap Dicairkan
- Jika **Income Excel sudah tersedia** dan order **belum pernah dicairkan**, Final Income menjadi **satu-satunya dasar pencairan**.
- Estimasi HTML Shopee/manual yang lama tetap tersimpan hanya sebagai **riwayat/referensi** dan diberi label **Tidak digunakan**.
- Mismatch antara estimasi lama dan Final Income pada order yang **Belum Dicairkan** tidak lagi dihitung sebagai selisih/koreksi.
- Selisih/koreksi hanya dibuat untuk order yang **benar-benar sudah dicairkan melalui Batch Estimasi** sebelum Income final masuk.
- Ringkasan dan tabel Siap Dicairkan sekarang menonjolkan **Final Shopee · Dasar Aktif**.

## Tambahan v1.13.0
- Import HTML dari Shopee Seller Centre **Penghasilan Saya → Pending**.
- Parser lokal mengambil No. Pesanan, Dana Akan Dilepaskan, status, metode pembayaran, dan perkiraan pelepasan dana.
- No. Pesanan dicocokkan ke Master Order; HTML mentah tidak disimpan ke Firebase.
- Nominal HTML Shopee menjadi estimasi utama untuk Batch Estimasi; input manual tetap tersedia sebagai fallback/rincian.
- Upload Excel berikutnya tetap mempertahankan estimasi HTML yang tersimpan.
- Saat Income final masuk, koreksi dihitung dari nominal estimasi yang benar-benar sudah dicairkan.
- Jika estimasi berasal dari HTML, rekonsiliasi tidak mengarang pembagian per produk karena HTML Pending menyediakan total per No. Pesanan.

# Shopee Payout v1.11.0 — Firebase + Estimasi Pending

Versi ini menambahkan alur pencairan lebih awal berdasarkan estimasi manual dari web Shopee, lalu merekonsiliasinya dengan Income final dari Excel Shopee.

## Fitur utama baru

- Pending Pembayaran memiliki **Harga Cepat** per No. Pesanan.
- Estimasi diisi **per item / per unit**, subtotal otomatis mengikuti Qty.
- Total estimasi per order dan total estimasi hasil filter tampil otomatis.
- Estimasi manual disimpan di Firestore dan **tidak ditimpa upload Excel Shopee berikutnya**.
- Tombol **Buat Batch Estimasi** mencairkan order pending yang estimasinya lengkap.
- Batch Estimasi dapat otomatis membawa saldo koreksi dari order lama.
- Saat Income final masuk, aplikasi menghubungkannya ke Batch Estimasi lama sehingga order tidak dicairkan penuh dua kali.
- Baris `Order` pada Income tetap menjadi nilai final resmi per No. Pesanan.
- Baris `Sku` pada Income sekarang disimpan sebagai rincian final per produk untuk membandingkan estimasi.
- Rekonsiliasi menampilkan **Estimasi vs Final Shopee**, selisih per produk, total selisih per order, dan status koreksi.
- Selisih positif menambah Batch Estimasi berikutnya; selisih negatif mengurangi Batch Estimasi berikutnya.
- Koreksi yang sudah digunakan ditandai dengan ID Batch agar tidak digunakan dua kali.

## Rumus koreksi

`Selisih = Final Shopee - Estimasi yang sudah dicairkan`

- Positif: batch berikutnya ditambah.
- Negatif: batch berikutnya dikurangi.
- Nol: klop.

`Total Batch Estimasi Baru = Total estimasi order baru + saldo koreksi belum dipakai`

Jika koreksi negatif lebih besar daripada estimasi batch baru, batch diblokir agar tidak menghasilkan pencairan negatif. Tambahkan lebih banyak order estimasi ke filter.

## Sumber data

- **Order Excel Shopee**: status, tanggal order, produk, variasi, qty.
- **Input manual web**: estimasi pending per item.
- **Income Excel Shopee – Order**: nominal final resmi per No. Pesanan.
- **Income Excel Shopee – Sku**: rincian final per produk untuk rekonsiliasi.
- **Firestore**: master, estimasi, batch, koreksi, riwayat upload dan audit.

## Setelah deploy v1.11.0

Upload ulang file Order + Income terbaru sekali. Ini diperlukan agar data Income lama di Firestore mendapatkan `skuDetails` untuk tampilan selisih per produk. Total final tetap berasal dari baris Order, sehingga tidak terjadi double count.

## Deploy GitHub Pages

Replace `index.html`, `app.js`, dan `styles.css` sekaligus. Tunggu GitHub Pages selesai deploy, lalu lakukan hard refresh (`Ctrl+F5`) pada desktop atau reload halaman pada ponsel.


## v1.13.0
- Menambahkan tampilan estimasi lama di halaman **Siap Dicairkan** sebagai referensi awal.
- Pengaman anti-double-payout: order yang sudah masuk Batch Estimasi tidak ikut Batch Final lagi ketika Income masuk.
- Pada v1.13.1, mismatch estimasi vs Final pada order yang belum dicairkan tidak lagi dianggap koreksi.
