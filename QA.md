# QA v2.1.4 — Full Fix

Temuan nyata dari v2.1.3:

1. `dirtySnapshot()` kehilangan satu kurung siku `]`, sehingga browser gagal mengimpor `app-2.1.3.js` dengan `SyntaxError: Unexpected token ')'`.
2. Setelah syntax diperbaiki, ditemukan `openDrawer`, `closeDrawer`, `switchView`, dan `titles` hilang saat refactor, sehingga startup berikutnya akan gagal dengan `ReferenceError`.

Perbaikan v2.1.4:

- Memperbaiki syntax `dirtySnapshot()`.
- Mengembalikan fungsi navigasi/drawer dan mapping judul halaman.
- Login tetap di `login.html` terpisah.
- Firestore tetap hanya dipanggil ketika `Sinkronkan Sekarang` ditekan.
- Cache localStorage tetap memakai key yang sama agar data lokal versi sebelumnya tetap terbaca.
- Pesan boot sekarang menampilkan detail stack/line bila aplikasi gagal dimuat lagi.

Pengujian yang dijalankan:

- Dynamic ESM import `core-2.1.4.js`: PASS.
- Dynamic ESM import `app-2.1.4.js`: PASS.
- `startApp()` dengan cache kosong: PASS.
- `startApp()` dengan sample Pending + Final + Batal: PASS.
- Event dasar filter/reset/drawer/import tanpa file: PASS.
- Membuat Batch Estimasi lokal melalui event: PASS.
- Membuat Batch Final lokal melalui event: PASS.
- Cache localStorage setelah Batch: PASS.
- Rule Final Excel sebelum payout => `readyFinal`, tanpa koreksi: PASS.
- Estimasi Rp29.375 sudah dicairkan lalu Final Rp29.292 => koreksi -Rp83: PASS.
- Koreksi negatif tidak membuat payout di bawah Rp0: PASS.
