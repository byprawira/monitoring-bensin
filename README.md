# Monitoring Bensin APK

Android APK wrapper untuk Google Apps Script web app Monitoring Bensin.

## Struktur

- `app/` Android WebView app.
- `gas/Code.gs` backend Google Apps Script dari source terbaru.
- `gas/index.html` frontend Google Apps Script dari source terbaru.
- `.github/workflows/build-apk.yml` workflow GitHub Actions untuk build APK.

## Cara Pakai

1. Deploy `gas/Code.gs` dan `gas/index.html` ke Google Apps Script sebagai Web App.
2. Pastikan akses Web App sesuai kebutuhan, misalnya akun sendiri atau siapa pun yang punya link.
3. Copy URL deployment Web App, formatnya biasanya:

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

4. Upload folder ini ke repository GitHub.
5. Buka tab `Actions` di GitHub.
6. Jalankan workflow `Build APK` dengan tombol `Run workflow`.
7. Isi input `webapp_url` dengan URL Web App.
8. Setelah workflow selesai, download artifact `monitoring-bensin-debug-apk`.

## Build Lokal Opsional

```bash
gradle assembleDebug -PWEBAPP_URL="https://script.google.com/macros/s/DEPLOYMENT_ID/exec"
```

APK debug akan ada di:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Catatan

APK ini adalah WebView wrapper. Fitur `google.script.run` tetap berjalan karena halaman yang dibuka adalah URL deployment Google Apps Script, bukan file HTML lokal.
