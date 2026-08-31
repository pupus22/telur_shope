# Shopee Payout v1.9.4 — Firebase

Versi ini memisahkan status operasional Order dari status Pembayaran Shopee dan Pencairan.

## Aturan status

- **Pending Pembayaran (aktif)**: No. Pesanan ada di Order, status bukan Batal, tetapi belum ada di Income.
- **Pesanan Batal**: status Order = Batal. Tidak ikut Pending Pembayaran dan tidak boleh masuk Batch otomatis.
- **Siap Dicairkan**: Order valid/non-batal + sudah ada Income + belum memiliki Batch.
- **Sudah Dicairkan**: Income sudah memiliki Batch ID.
- **Ditahan / Perlu Dicek**: misalnya Pesanan Batal tetapi memiliki Income, atau Income tidak memiliki pasangan Order.

Jika Pesanan Batal memiliki Income, nominal tetap tercatat sebagai Pembayaran Shopee tetapi tidak masuk halaman Siap Dicairkan. Rekonsiliasi menempatkannya ke kategori Ditahan / Perlu Dicek.

## Perubahan v1.9.4

- Pending Pembayaran tidak lagi mencampur Pesanan Batal.
- Menu baru **Pesanan Batal** dengan alasan pembatalan, status pembayaran, dan status pencairan.
- Alasan Pembatalan dari file Order disimpan ke Firestore pada upload berikutnya.
- Pending Pembayaran memiliki filter Tanggal Order, Status Order, dan pencarian.
- Laporan Gabungan memiliki filter Status Order dan status `Ditahan / Perlu Dicek`.
- Siap Dicairkan hanya mengambil pesanan valid/non-batal.
- Sebelum Batch disimpan, Firestore Transaction mengecek ulang Income, Order, dan memastikan status Order tidak Batal.
- Rekonsiliasi menjadi: **Total Pembayaran = Sudah Dicairkan + Siap Dicairkan + Ditahan/Perlu Dicek**.
- Pesanan multi-produk tetap dianggap normal: 1 No. Pesanan = 1 Order, dengan banyak item.

## Deploy GitHub Pages

Replace file berikut secara bersamaan:

- `index.html`
- `app.js`
- `styles.css`

Setelah GitHub Pages selesai deploy, lakukan hard refresh (`Ctrl+F5`). Data Firestore yang sudah ada tidak dihapus oleh update aplikasi ini.

## Catatan data lama

Dokumen Order lama di Firestore sudah memiliki Status Order sehingga pemisahan Batal langsung bekerja. Field **Alasan Pembatalan** baru akan terisi setelah file Order terbaru di-upload ulang atau diedit manual.
