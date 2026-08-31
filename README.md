# Shopee Payout Manager v2.0.4

# Shopee Payout Manager — v2.0 Clean Rebuild

Rebuild dari nol. Versi ini tidak menambal kode v1.x.

## Hukum utama

1. **Order Excel** = sumber final untuk data order/produk/status yang dibawanya.
2. **Income Excel** = sumber final untuk status pembayaran & nominal pembayaran Shopee.
3. **HTML Pending / input manual** = estimasi sementara saja. Hanya aktif jika No. Pesanan belum ada di Income.
4. Begitu Income Excel memuat No. Pesanan yang sama, estimasi aktif dipindah ke histori lalu **dihapus dari alur aktif**.
5. **Siap Dicairkan murni Income Excel**. Tidak ada estimasi HTML/manual di halaman itu.
6. **Batch immutable/snapshot permanen**. Upload berikutnya tidak mengubah nominal yang sudah dicairkan.
7. Koreksi hanya berasal dari perbedaan **Final Income terkini - nominal yang benar-benar pernah dicairkan**, dikurangi koreksi yang sudah diterapkan.
8. Satu No. Pesanan dengan banyak produk tetap satu pembayaran dan satu lock pencairan.
9. Baris Income `Order` adalah total resmi. Baris `Sku` hanya detail.
10. Pesanan Batal + Income dan Income tanpa Order ditahan, tidak masuk Siap Dicairkan.

## Alur

- Upload Order Excel → merge Master Order.
- Jika belum ada Income → boleh import HTML Pending atau edit estimasi manual per item.
- Pencairan awal estimasi dilakukan dari halaman Pending melalui Batch Estimasi.
- Upload Income Excel terbaru → estimasi aktif dengan No. Pesanan yang sama otomatis dibersihkan; Final Excel menang.
- Jika belum pernah dicairkan → Final Income masuk Siap Dicairkan.
- Jika sudah pernah dicairkan estimasi → tidak dicairkan lagi sebagai nominal utama; selisih masuk saldo koreksi batch berikutnya.
- Jika Final Income pernah dicairkan lalu Excel final berubah pada upload berikutnya, selisih juga terdeteksi karena Batch tetap snapshot permanen.

## Firestore

Collections utama:
- `orders`
- `incomes`
- `batches`
- `uploads`
- `correction_ledger`

Rules admin lama dengan wildcard tetap kompatibel.

## Deploy GitHub Pages

Upload/replace file berikut di root repository:
- `index.html`
- `styles.css`
- `core.js`
- `app.js`

Lalu tunggu GitHub Pages deploy dan lakukan hard refresh (`Ctrl+F5`).


## v2.0.1 UI Hotfix
- Summary strip mengikuti jumlah kartu, tanpa area abu-abu kosong.
- Filter mobile responsif tanpa horizontal/nested scroll.
- Tabel large di mobile memakai page scroll vertikal; hanya tabel yang boleh geser horizontal bila kolom banyak.
- Bottom navigation fixed di viewport dan tetap terlihat saat halaman discroll.
- Safe bottom padding mencegah konten tertutup bottom navigation.


## v2.0.4 — Filter Produk Laporan Gabungan

- Menambahkan filter produk checkbox multi-select pada Laporan Gabungan.
- Filter produk bersifat exact product.
- Jika salah satu produk pada satu No. Pesanan cocok, seluruh order tetap ditampilkan agar nominal Income/order tidak terpecah atau double count.
- Daftar produk menyesuaikan filter tanggal, status, dan pencarian yang sedang aktif.
- Reset Laporan Gabungan juga mengosongkan pilihan produk.
- Export Excel mengikuti hasil filter produk.


## v2.0.4 — Total Gabungan Laporan
- Menambahkan KPI **Total Final + Estimasi Aktif**.
- Final Income selalu menang; estimasi hanya dihitung bila order belum mempunyai Income.
- Ringkasan Estimasi menghitung estimasi aktif saja. Riwayat estimasi tetap terlihat per order di tabel tetapi tidak didouble-count saat Final Income sudah ada.
