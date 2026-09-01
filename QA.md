# QA v2.1.3

- Login page terpisah dari aplikasi.
- Login tidak mengimpor app/core/Firestore/XLSX.
- index redirect ke login jika tidak ada sesi.
- UID selain admin ditolak.
- app/core menggunakan nama file unik v2.1.3 untuk mencegah stale cache.
- Data localStorage lama tetap berada pada origin yang sama dan tetap dapat dibaca aplikasi.
