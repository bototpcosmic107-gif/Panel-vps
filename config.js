// ================================================
//   CONFIG BOT — ZANG X バンズ
//   Edit sesuai kebutuhan
// ================================================

export default {
  // Nama bot
  botName: "𝑩𝑶𝑻 𝑩𝑳𝑨𝑺𝑻",

  // Nama pembuat
  makerName: "𝑽𝑨𝑵𝑺𝑺 X バンズ",

  // ── NOMOR BOT (nomor WA yang dipasangi bot) ──────────────────
  // Isi nomor WA bot kamu agar tidak perlu input saat start
  // Format internasional tanpa + contoh: "628xxx"
  // Biarkan "" kalau mau tetap diminta input saat pertama run
  botNumber: "6283892978340",

  // Nomor Admin — bisa 1 nomer (string) atau beberapa nomer (array)
  // Admin bisa menggunakan SEMUA perintah bot tanpa batasan
  // Format internasional tanpa + contoh: "628xxx" atau ["628xxx", "628yyy"]
  adminNumber: "6287752910121",
  // adminNumber: ["6287752910121", "628xxxxxxxxx"],  // kalau mau multi-admin

  // Mode awal: "self" = hanya admin | "public" = semua orang
  mode: "self",

  // Folder penyimpanan session utama
  sessionDir: "./session",

  // Folder temp file download
  tempDir: "./temp",

  // ── QRIS PAKASIR ─────────────────────────────────────────────
  pakasir: {
    // API Key dari halaman detail Proyek di Pakasir
    // Daftar di: https://app.pakasir.com
    apiKey: "EVH6zAY2BAoDar4pG8qxVNjqoIr3EJ9I",

    // Slug proyek kamu (terlihat di URL dashboard Pakasir, contoh: "depodomain")
    project: "jual-script-bot-wa",

    // Timeout pembayaran dalam menit (default 5 menit)
    timeoutMenit: 5,

    // Interval cek status pembayaran dalam detik (default 7 detik)
    intervalDetik: 7,
  },

  // ── WELCOME GRUP ─────────────────────────────────────────────
  // Status awal fitur welcome: true = aktif, false = nonaktif
  welcomeOn: false,
};
