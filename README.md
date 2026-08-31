# Shopee Payout v1.13.0

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
- Halaman **Siap Dicairkan** menampilkan Estimasi, Pembayaran Final Shopee, dan Selisih Final − Estimasi per No. Pesanan.
- Ringkasan menampilkan Total Estimasi, Final Shopee, dan Selisih pada hasil filter.
- Sumber estimasi tetap diberi label **HTML Shopee** atau **Manual**.
- Estimasi hanya informasi/acuan; Batch Final tetap memakai Income final Shopee.
- Pengaman anti-double-payout: order yang sudah masuk Batch Estimasi tidak ikut Batch Final lagi ketika Income masuk. Selisihnya diselesaikan melalui saldo koreksi batch berikutnya.
- Snapshot Batch Final menyimpan estimasi dan selisih sebagai audit.
