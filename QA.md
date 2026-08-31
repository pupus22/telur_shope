# QA v2.0 Clean Rebuild

## Sample files checked

- Order Excel sample: 95 order rows / 95 unique No. Pesanan.
- Income Excel sample: 50 `Order` rows / 51 `Sku` rows.
- Total resmi dari 50 baris `Order`: Rp1.786.953.
- HTML Pending sample: 43 No. Pesanan, total `Dana Akan Dilepaskan` Rp1.573.042.
- HTML sample `260831RMRS5V85` terbaca Rp26.750.

## Core rule tests passed

- Pending HTML tanpa Income → `pendingEstimated`.
- Income muncul sebelum pernah dicairkan → estimasi tidak aktif, order → `readyFinal`, tidak ada koreksi.
- Estimasi Rp29.375 sudah dicairkan lalu Final Rp29.292 → koreksi -Rp83.
- Final pernah dicairkan Rp29.292 lalu Income terbaru berubah Rp30.000 → koreksi +Rp708.
- Batal + Income → ditahan.
- Income tanpa Order → ditahan.
- Status Order kosong → ditahan.
- Income ≤ Rp0 → ditahan.
- Koreksi negatif tidak boleh membuat total Batch di bawah Rp0; sisanya dibawa ke batch berikutnya.
- Koreksi pada transaksi yang ditahan tidak diterapkan otomatis.

## Static checks

- `core.js`: JavaScript syntax OK.
- `app.js`: JavaScript syntax OK.
- Tidak ada duplicate HTML IDs.
- Semua ID yang direferensikan `app.js` tersedia di `index.html`.


## v2.0.4 Filter Produk Laporan Gabungan
- [x] reportProductPicker tersedia di DOM.
- [x] pilihan produk tersimpan di state.reportProducts.
- [x] matching berdasarkan nama produk exact dari Master Order.
- [x] satu produk cocok => seluruh No. Pesanan lolos filter.
- [x] filter produk tidak mengubah nominal Income per order.
- [x] Reset menghapus pilihan produk.
- [x] Export menggunakan filteredReport sehingga mengikuti filter produk.
