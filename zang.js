// ================================================================
//   𝒁𝑨𝑵𝑮 𝑿 バンズ — WhatsApp Bot v0.5
//   Pembuat : 𝑽𝑨𝑵𝑺𝑺 X バンズ
//   Script  : Node.js ESM + @whiskeysockets/baileys (latest)
//   Koneksi : Pairing Code (tanpa QR)
// ================================================================

// ════════════════════════════════════════════════════════════
//   SUPPRESS NOISE — wajib paling atas sebelum semua import
// ════════════════════════════════════════════════════════════
const _NOISE = [
  "Closing session","SessionEntry","chainKey","chainType","messageKeys",
  "registrationId","currentRatchet","ephemeralKeyPair","lastRemoteEphemeralKey",
  "previousCounter","rootKey","indexInfo","baseKey","pubKey","privKey",
  "<Buffer","[Object]",
];
const _isNoise = (s) => _NOISE.some((w) => s.includes(w));

const _rawOut = process.stdout.write.bind(process.stdout);
const _rawErr = process.stderr.write.bind(process.stderr);
process.stdout.write = function(c,e,cb) { if(_isNoise(String(c))){ var fn=typeof e==="function"?e:(typeof cb==="function"?cb:null); if(fn)fn(); return true; } return _rawOut(c,e,cb); };
process.stderr.write = function(c,e,cb) { if(_isNoise(String(c))){ var fn=typeof e==="function"?e:(typeof cb==="function"?cb:null); if(fn)fn(); return true; } return _rawErr(c,e,cb); };
const _cl = (...a) => { const s=a.map(String).join(" "); if(!_isNoise(s)) _rawOut(s+"\n"); };
console.log=_cl; console.warn=_cl; console.error=(...a)=>{ const s=a.map(String).join(" "); if(!_isNoise(s)) _rawErr(s+"\n"); };
console.info=_cl; console.debug=()=>{};

// ════════════════════════════════════════════════════════════
//   IMPORTS
// ════════════════════════════════════════════════════════════
import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidGroup,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import pino            from "pino";
import fs              from "fs-extra";
import path            from "path";
import axios           from "axios";
import readline        from "readline";
import { exec }        from "child_process";
import { createRequire }  from "module";
import { fileURLToPath }  from "url";
import { createQRIS, waitForPayment } from "./pakasir.js";

const _req       = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const _pino      = pino({ level: "silent" });
const cfg        = (await import("./config.js")).default;

fs.ensureDirSync(cfg.sessionDir);
fs.ensureDirSync(cfg.tempDir);

// ════════════════════════════════════════════════════════════
//   STATE GLOBAL
// ════════════════════════════════════════════════════════════
let botMode    = cfg.mode;
let antilinkOn = false;
let reactionOn = false;
let sendOn     = false;
let welcomeOn  = cfg.welcomeOn ?? false;
let botOnline  = false;
let vanssOn    = false;   // fitur deteksi pesan dihapus
let activeBots = {};

// Cache pesan untuk fitur vanss (simpan sebelum dihapus)
// key = messageId, value = { jid, sender, name, body, type, mediaBuffer }
const msgCache = new Map();

// ── Persisten (JSON) ─────────────────────────────────────────
const DATA_FILE    = path.join(__dirname, "botData.json");
let botData = { welcomeMap:{}, blacklistUser:[], blacklistGC:[] };
try { if(fs.existsSync(DATA_FILE)) botData = { ...botData, ...JSON.parse(fs.readFileSync(DATA_FILE,"utf8")) }; } catch(_){}
const saveData = () => { try{ fs.writeFileSync(DATA_FILE, JSON.stringify(botData,null,2)); }catch(_){} };

// Shortcut
const welcomeMap   = botData.welcomeMap;    // { groupJid: teks }
const blacklistUser= botData.blacklistUser; // [ jid number string ]
const blacklistGC  = botData.blacklistGC;   // [ groupJid ]

// QRIS aktif per chat
const activeQris = {};

// ════════════════════════════════════════════════════════════
//   HELPERS
// ════════════════════════════════════════════════════════════
const sleep    = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpFile  = (ext) => path.join(cfg.tempDir, `zang_${Date.now()}.${ext}`);
const cleanJid = (jid) => (jid||"").replace(/:[0-9]+@.+|@.+/,"");
const formatRp = (n) => parseInt(n).toLocaleString("id-ID");
const question = (rl,q) => new Promise((r) => rl.question(q,r));

const isAdmin = (jid) => {
  const num = cleanJid(jid);
  return Array.isArray(cfg.adminNumber) ? cfg.adminNumber.includes(num) : num === cfg.adminNumber;
};
const checkOwner = (senderJid, fromMe) => isAdmin(senderJid) || fromMe;

// Apakah user ini di blacklist
const isBlacklisted = (jid) => blacklistUser.includes(cleanJid(jid));
// Apakah grup ini di blacklist
const isGCBlacklisted = (jid) => blacklistGC.includes(jid);

// ════════════════════════════════════════════════════════════
//   MENU
// ════════════════════════════════════════════════════════════
const menuText = (pushName="") => `
𝑺𝑼𝑮𝑬𝑵𝑮 𝑹𝑨𝑾𝑼𝑯 𝑲𝑨𝑵𝑮 𝑴𝑨𝑺 ${pushName}
╔───𖣂 𝙄𝙉𝙁𝙊𝙍𝙈𝘼𝙏𝙄𝙊𝙉𖣂───╗
├ ⌬ 𝙱𝚘𝚝 𝙽𝚊𝚖𝚎      : 𝑩𝑶𝑻 𝑩𝑳𝑨𝑺𝑻
├ ⌬ 𝚅𝚎𝚛𝚜𝚒𝚘𝚗       : 0.5
├ ⌬ 𝙳𝚎𝚟𝚎𝚕𝚘𝚙𝚎𝚛    : 𝑽𝑨𝑵𝑺𝑺 X バンズ
├ ⌬ 𝙾𝚆𝙽𝙴𝚁          : ${Array.isArray(cfg.adminNumber)?cfg.adminNumber[0]:cfg.adminNumber}
├ ⌬ 𝚃𝚎𝚕𝚎𝚐𝚛𝚊𝚖     : t.me/XIXI8778
├ ⌬ 𝚃𝚢𝚙𝚎           : 𝙼𝙳
╚──────────────⪩

╔─── 𝙶𝙴𝙽𝙴𝚁𝘼𝙻 ───╗
↝ zang              : tampilkan menu
↝ ft                : foto → stiker
↝ tt                : stiker → foto
↝ sh                : simpan foto sekali lihat
↝ brat <teks>       : stiker teks (wrap ke bawah)
↝ bratvid <teks>    : stiker animasi mengetik
↝ hd                : foto/video → HD
↝ mp4 <link>        : download TikTok video
↝ mp3 <link>        : download TikTok audio
↝ c <nomer>         : cek nomer WA & operator
↝ pay               : info pembayaran
↝ 600*2 / 600x2     : kalkulator harga
╚──────────────────╝

╔─── 𝘼𝘿𝙈𝙄𝙉 𝙊𝙉𝙇𝙔 ───╗
↝ online / offline  : status bot
↝ self / public     : mode bot
↝ qris <nominal>    : buat QRIS pembayaran
↝ setwelcome <teks> : atur welcome grup (di grup)
↝ cekwelcome        : lihat welcome grup ini
↝ delwelcome        : hapus welcome grup ini
↝ welcome on/off    : toggle fitur welcome
↝ vanss on/off      : deteksi pesan dihapus
↝ antilink on/off   : filter link di grup
↝ reaction on/off   : reaction nomer WA
↝ send on/off       : konfirmasi payment foto
↝ blacklist         : reply chat → blacklist user
↝ unblacklist       : reply chat → hapus blacklist
↝ blacklistgc <link>: blacklist grup dari link
↝ cekbl             : lihat daftar blacklist
↝ kick              : reply chat → kick dari grup
↝ autojoin <link>   : bot join grup/channel
↝ jadibot <62xxx>   : buat bot calone
↝ stopbot <62xxx>   : hentikan bot calone
╚──────────────────╝
`.trim();

// ════════════════════════════════════════════════════════════
//   PRESENCE
// ════════════════════════════════════════════════════════════
const setPresence = async (sock,jid,type) => { try{await sock.sendPresenceUpdate(type,jid);}catch(_){} };
const withTyping  = async (sock,jid,fn,ms=900) => {
  await setPresence(sock,jid,"composing"); await sleep(ms);
  const r = await fn(); await setPresence(sock,jid,"paused"); return r;
};

// ════════════════════════════════════════════════════════════
//   STIKER BRAT — teks wrap ke bawah, font adaptif
// ════════════════════════════════════════════════════════════
async function makeBratSticker(teks) {
  const { createCanvas } = await import("canvas");
  const sharp = (await import("sharp")).default;

  const SIZE    = 512;
  const PADDING = 36;
  const MAX_W   = SIZE - PADDING * 2;
  const canvas  = createCanvas(SIZE, SIZE);
  const ctx     = canvas.getContext("2d");

  // Wrap helper
  const wrapLines = (text, fSize) => {
    ctx.font = `bold ${fSize}px Arial`;
    const words = text.split(/\s+/);
    const lines = []; let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > MAX_W && cur) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  // Cari fontSize supaya semua baris muat
  let fontSize = 80;
  let lines = [];
  while (fontSize >= 14) {
    lines = wrapLines(teks, fontSize);
    const lineH  = fontSize * 1.3;
    const totalH = lines.length * lineH;
    if (totalH <= SIZE - PADDING * 2) break;
    fontSize -= 3;
  }

  const lineH  = fontSize * 1.3;
  const totalH = lines.length * lineH;
  const startY = (SIZE - totalH) / 2 + lineH * 0.5;

  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = "#000000"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `bold ${fontSize}px Arial`;
  lines.forEach((line, i) => ctx.fillText(line, SIZE / 2, startY + i * lineH));

  const out = tmpFile("webp");
  await sharp(canvas.toBuffer("image/png")).webp({ quality: 90 }).toFile(out);
  return out;
}

// ════════════════════════════════════════════════════════════
//   STIKER BRATVID — animasi mengetik per karakter, selalu ada
// ════════════════════════════════════════════════════════════
async function makeBratVidSticker(teks) {
  const { createCanvas } = await import("canvas");
  const GIFEncoder = _req("gif-encoder-2");

  const SIZE    = 512;
  const PADDING = 36;
  const MAX_W   = SIZE - PADDING * 2;

  // Hitung fontSize dan wrap final
  const tmpCanvas = createCanvas(SIZE, SIZE);
  const tmpCtx    = tmpCanvas.getContext("2d");

  const wrapLines = (text, fSize) => {
    tmpCtx.font = `bold ${fSize}px Arial`;
    if (!text.trim()) return [""];
    const words = text.split(/\s+/);
    const lines = []; let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (tmpCtx.measureText(test).width > MAX_W && cur) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  let fontSize = 76;
  while (fontSize >= 14) {
    const lines  = wrapLines(teks, fontSize);
    const lineH  = fontSize * 1.3;
    const totalH = lines.length * lineH;
    if (totalH <= SIZE - PADDING * 2) break;
    fontSize -= 3;
  }
  const lineH = fontSize * 1.3;

  // Gambar frame dengan teks parsial + kursor opsional
  const drawFrame = (partial, showCursor) => {
    const canvas = createCanvas(SIZE, SIZE);
    const ctx    = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = "#000000"; ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";

    const displayed = partial + (showCursor ? "▍" : "");
    const lines  = wrapLines(displayed, fontSize);
    const totalH = lines.length * lineH;
    const startY = (SIZE - totalH) / 2 + lineH * 0.5;
    lines.forEach((line, i) => ctx.fillText(line, SIZE / 2, startY + i * lineH));
    return ctx;
  };

  const gifPath   = tmpFile("gif");
  const encoder   = new GIFEncoder(SIZE, SIZE);
  const gifStream = fs.createWriteStream(gifPath);
  encoder.createReadStream().pipe(gifStream);
  encoder.start();
  encoder.setRepeat(0); // loop terus
  encoder.setQuality(5);

  // Frame awal: kursor berkedip (selalu ada animasi)
  encoder.setDelay(300); encoder.addFrame(drawFrame("", true));
  encoder.setDelay(300); encoder.addFrame(drawFrame("", false));
  encoder.setDelay(300); encoder.addFrame(drawFrame("", true));

  // Mengetik karakter per karakter
  // step = 1 agar animasi selalu terasa mengetik berapapun panjang teks
  const TOTAL = teks.length;
  // Untuk teks sangat panjang, skip beberapa char agar GIF tidak terlalu besar (max ~80 frame)
  const step = Math.max(1, Math.ceil(TOTAL / 80));
  for (let i = step; i <= TOTAL; i += step) {
    encoder.setDelay(i < TOTAL ? 70 : 500);
    encoder.addFrame(drawFrame(teks.slice(0, i), i < TOTAL));
  }
  // Pastikan teks penuh ada
  encoder.setDelay(80); encoder.addFrame(drawFrame(teks, false));

  // Kursor berkedip di akhir (animasi terasa hidup)
  encoder.setDelay(500); encoder.addFrame(drawFrame(teks, true));
  encoder.setDelay(500); encoder.addFrame(drawFrame(teks, false));
  encoder.setDelay(2000); encoder.addFrame(drawFrame(teks, false));

  encoder.finish();
  await new Promise((res) => gifStream.on("finish", res));

  const webpPath = tmpFile("webp");
  await new Promise((res,rej) =>
    exec(`ffmpeg -y -i "${gifPath}" -vcodec libwebp -filter:v fps=15 -lossless 0 -compression_level 6 -q:v 50 -loop 0 -preset default -an -vsync 0 "${webpPath}"`,
      (err) => err ? rej(err) : res())
  );
  fs.removeSync(gifPath);
  return webpPath;
}

// ════════════════════════════════════════════════════════════
//   HD
// ════════════════════════════════════════════════════════════
async function makeHD(buffer, isVideo) {
  const inFile = tmpFile(isVideo?"mp4":"jpg"), outFile = tmpFile(isVideo?"mp4":"png");
  fs.writeFileSync(inFile, buffer);
  if (isVideo) {
    await new Promise((res,rej) =>
      exec(`ffmpeg -y -i "${inFile}" -vf "scale=iw*2:ih*2,fps=120" -c:v libx264 -crf 15 -preset slow -c:a copy "${outFile}"`,
        (err) => err?rej(err):res())
    );
  } else {
    const sharp = (await import("sharp")).default;
    await sharp(buffer).resize({width:3840,withoutEnlargement:false}).sharpen({sigma:2}).toFile(outFile);
  }
  const out = fs.readFileSync(outFile);
  fs.removeSync(inFile); fs.removeSync(outFile);
  return out;
}

// ════════════════════════════════════════════════════════════
//   DOWNLOAD TIKTOK
// ════════════════════════════════════════════════════════════
async function downloadTikTok(sock, jid, msg, url, type="mp4") {
  const { data } = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`,{timeout:20000});
  if (!data||data.code!==0) throw new Error("Gagal ambil data TikTok");
  const mediaUrl = type==="mp3" ? data.data.music : data.data.play;
  const title    = data.data.title || "TikTok";
  const outPath  = tmpFile(type==="mp3"?"mp3":"mp4");
  const bar=(p)=>{ const f=Math.round(p/10); return `⬇️ *Mengunduh ${type.toUpperCase()}...*\n\n[${"█".repeat(f)}${"░".repeat(10-f)}] *${p}%*\n\n🎵 ${title}`; };
  const sentMsg = await sock.sendMessage(jid,{text:bar(0)},{quoted:msg});
  const sentKey = sentMsg?.key;
  let lastPct=0;
  const editBar=async(p)=>{ if(p===lastPct)return; lastPct=p; try{await sock.sendMessage(jid,{text:bar(p),edit:sentKey});}catch(_){} };
  const steps=[10,25,40,60,75,90]; let si=0;
  const resp = await axios.get(mediaUrl,{
    responseType:"arraybuffer", timeout:120000,
    onDownloadProgress:async(e)=>{
      if(!e.total)return;
      const p=Math.round((e.loaded/e.total)*100);
      while(si<steps.length&&p>=steps[si]){await editBar(steps[si]);si++;}
    },
  });
  await editBar(100);
  fs.writeFileSync(outPath, Buffer.from(resp.data));
  try{await sock.sendMessage(jid,{text:`✅ *DONE!*\n\n🎵 ${title}`,edit:sentKey});}catch(_){}
  return { file:outPath, title };
}

// ════════════════════════════════════════════════════════════
//   QRIS PAYMENT
// ════════════════════════════════════════════════════════════
async function handleQRIS(sock, jid, msg, nominal) {
  const amount = parseInt(nominal.replace(/[^0-9]/g,""));
  if (!amount||amount<100) return sock.sendMessage(jid,{text:"❌ Nominal tidak valid! Contoh: *qris 50000*"},{quoted:msg});
  if (!cfg.pakasir?.apiKey||cfg.pakasir.apiKey==="YOUR_PAKASIR_API_KEY")
    return sock.sendMessage(jid,{text:"❌ API Key Pakasir belum diisi di config.js!"},{quoted:msg});
  if (!cfg.pakasir?.project||cfg.pakasir.project==="YOUR_PROJECT_SLUG")
    return sock.sendMessage(jid,{text:"❌ Project slug Pakasir belum diisi di config.js!"},{quoted:msg});

  if (activeQris[jid]){ clearTimeout(activeQris[jid].timer); delete activeQris[jid]; }
  await sock.sendMessage(jid,{text:`⏳ Membuat QRIS *Rp ${formatRp(amount)}*...`},{quoted:msg});

  let qrisData;
  try { qrisData = await createQRIS(amount, cfg.pakasir.apiKey, cfg.pakasir.project); }
  catch(err){ return sock.sendMessage(jid,{text:`❌ Gagal buat QRIS: ${err.message}`},{quoted:msg}); }

  const timeoutMs  = (cfg.pakasir.timeoutMenit||5)*60*1000;
  const intervalMs = (cfg.pakasir.intervalDetik||7)*1000;
  const expLabel   = qrisData.expired_at
    ? new Date(qrisData.expired_at).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})
    : `${cfg.pakasir.timeoutMenit||5} menit`;

  const infoText =
`╔───── QRIS PEMBAYARAN ─────╗
├ 💰 *Nominal*     : Rp ${formatRp(amount)}
├ 💳 *Total Bayar* : Rp ${formatRp(qrisData.total_payment||amount)}
├ 🔖 *Order ID*    : ${qrisData.order_id}
├ ⏰ *Expired*     : ${expLabel}
╚───────────────────────────╝

Scan QRIS di atas lalu tunggu konfirmasi otomatis. ✅`;

  try {
    let QRCode; try{QRCode=_req("qrcode");}catch(_){}
    if (QRCode&&qrisData.payment_number) {
      const qrBuf = await QRCode.toBuffer(qrisData.payment_number,{type:"png",width:512,margin:2,color:{dark:"#000000",light:"#ffffff"}});
      await sock.sendMessage(jid,{image:qrBuf,caption:infoText,mimetype:"image/png"},{quoted:msg});
    } else {
      await sock.sendMessage(jid,{text:infoText},{quoted:msg});
    }
  } catch(_){ await sock.sendMessage(jid,{text:infoText},{quoted:msg}); }

  const expTimer = setTimeout(async()=>{
    if(activeQris[jid]?.orderId===qrisData.order_id){
      delete activeQris[jid];
      await sock.sendMessage(jid,{text:`⌛ *QRIS Kedaluwarsa!*\nKetik *qris ${amount}* untuk buat baru.`}).catch(()=>{});
    }
  }, timeoutMs+5000);
  activeQris[jid] = {orderId:qrisData.order_id, amount, timer:expTimer};

  (async()=>{
    try {
      const adminJid=`${Array.isArray(cfg.adminNumber)?cfg.adminNumber[0]:cfg.adminNumber}@s.whatsapp.net`;
      const {paid} = await waitForPayment(qrisData.order_id, qrisData.total_payment||amount, cfg.pakasir.apiKey, cfg.pakasir.project, timeoutMs, intervalMs);
      if(!activeQris[jid]||activeQris[jid].orderId!==qrisData.order_id) return;
      clearTimeout(activeQris[jid].timer); delete activeQris[jid];
      if (paid) {
        const waktu = new Date().toLocaleString("id-ID",{timeZone:"Asia/Jakarta"});
        await sock.sendMessage(jid,{text:`✅ *SALDO BERHASIL MASUK!*\n\n💰 Nominal  : Rp ${formatRp(amount)}\n🔖 Order ID : ${qrisData.order_id}\n📱 No Bot   : ${cfg.botNumber||"-"}\n🕐 Waktu    : ${waktu}\n\nTerima kasih! 🙏`}).catch(()=>{});
        await sock.sendMessage(adminJid,{text:`🔔 *PEMBAYARAN MASUK!*\n\n💰 Nominal  : Rp ${formatRp(amount)}\n🔖 Order ID : ${qrisData.order_id}\n📞 Dari     : ${cleanJid(jid)}\n📱 No Bot   : ${cfg.botNumber||"-"}\n🕐 Waktu    : ${waktu}`}).catch(()=>{});
      }
    } catch(e){ _rawErr(`[PAKASIR] Error: ${e.message}\n`); }
  })();
}

// ════════════════════════════════════════════════════════════
//   BUAT SOCKET
// ════════════════════════════════════════════════════════════
async function createSock(sessionPath) {
  const {state, saveCreds} = await useMultiFileAuthState(sessionPath);
  const {version} = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version, logger:_pino,
    auth:{ creds:state.creds, keys:makeCacheableSignalKeyStore(state.keys,_pino) },
    printQRInTerminal:false,
    browser:["Ubuntu","Chrome","20.0.04"],
    markOnlineOnConnect:false,
    syncFullHistory:false,
    connectTimeoutMs:60_000,
    defaultQueryTimeoutMs:60_000,
    keepAliveIntervalMs:30_000,
    retryRequestDelayMs:2_000,
    generateHighQualityLinkPreview:false,
  });
  sock.ev.on("creds.update", saveCreds);
  return { sock, state };
}

// ════════════════════════════════════════════════════════════
//   PAIRING CODE
// ════════════════════════════════════════════════════════════
async function requestPairingCode(sock, phoneNumber) {
  if (sock.authState.creds.registered) return null;
  await sleep(2000);
  const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g,""));
  return code?.match(/.{1,4}/g)?.join("-") || code;
}

// ════════════════════════════════════════════════════════════
//   HANDLER PESAN UTAMA
// ════════════════════════════════════════════════════════════
async function handleMessage(sock, msg) {
  const jid = msg.key?.remoteJid;
  if (!jid||jid==="status@broadcast") return;

  const fromMe    = msg.key.fromMe;
  const senderJid = fromMe ? (sock.user?.id||"") : (msg.key.participant||msg.key.remoteJid||"");
  const isGroup   = isJidGroup(jid);
  const ownerFlag = checkOwner(senderJid, fromMe);

  // ── Blacklist check — block sebelum apapun ────────────
  if (!ownerFlag) {
    if (isBlacklisted(senderJid)) return;
    if (isGroup && isGCBlacklisted(jid)) return;
  }

  const m = msg.message;
  if (!m) return;

  const realMsg =
    m.ephemeralMessage?.message ||
    m.viewOnceMessage?.message  ||
    m.viewOnceMessageV2?.message ||
    m.viewOnceMessageV2Extension?.message ||
    m;

  const body = (
    realMsg.conversation ||
    realMsg.extendedTextMessage?.text ||
    realMsg.imageMessage?.caption ||
    realMsg.videoMessage?.caption ||
    ""
  ).trim();
  const lower = body.toLowerCase();

  if (botMode==="self" && !ownerFlag) return;
  if (!botOnline && !ownerFlag) return;

  const reply     = (text) => withTyping(sock, jid, ()=>sock.sendMessage(jid,{text},{quoted:msg}));
  const replyFast = (text) => sock.sendMessage(jid,{text},{quoted:msg});
  const react     = (emoji) => sock.sendMessage(jid,{react:{text:emoji,key:msg.key}});
  const ctxInfo   = m.extendedTextMessage?.contextInfo || null;
  const quotedMsg = ctxInfo?.quotedMessage || null;
  const quotedPart= ctxInfo?.participant || null;

  // ── ONLINE / OFFLINE ─────────────────────────────────
  if (lower==="online"&&ownerFlag)  { botOnline=true;  await sock.sendPresenceUpdate("available");   return replyFast("✅ *Bot ONLINE!*"); }
  if (lower==="offline"&&ownerFlag) { botOnline=false; await sock.sendPresenceUpdate("unavailable"); return replyFast("🔴 *Bot OFFLINE.*"); }

  // ── SEND ON ───────────────────────────────────────────
  if (sendOn&&isGroup&&!fromMe&&realMsg.imageMessage) {
    await setPresence(sock,jid,"composing"); await sleep(600);
    await sock.sendMessage(jid,{text:"DONE ✅ BOSQU"},{quoted:msg});
    await setPresence(sock,jid,"paused"); return;
  }

  // ── REACTION ON ───────────────────────────────────────
  if (reactionOn&&/^(62|08)\d{7,13}$/.test(body)) {
    await react("⌛"); await sleep(20000); await react("✅"); return;
  }

  // ── ANTI-LINK ─────────────────────────────────────────
  if (antilinkOn&&isGroup) {
    const linkRx=/(https?:\/\/|wa\.me\/|chat\.whatsapp\.com\/)[^\s]*/i;
    if (linkRx.test(body)&&!ownerFlag) {
      const meta   = await sock.groupMetadata(jid).catch(()=>null);
      const admins = meta?.participants.filter(p=>p.admin).map(p=>p.id)||[];
      if (!admins.includes(senderJid)) {
        await sock.sendMessage(jid,{delete:msg.key});
        await sock.sendMessage(jid,{text:"⚠️ Link tidak diizinkan!"}); return;
      }
    }
  }

  // ════════════════════════════════════════════════════
  //   COMMANDS
  // ════════════════════════════════════════════════════

  // ── MENU ──────────────────────────────────────────────
  if (lower==="zang") {
    const imgPath = path.join(__dirname,"zang.jpg");
    const pn = msg.pushName||cleanJid(senderJid);
    if (fs.existsSync(imgPath)) {
      await setPresence(sock,jid,"composing"); await sleep(700);
      await sock.sendMessage(jid,{image:fs.readFileSync(imgPath),caption:menuText(pn),mimetype:"image/jpeg"},{quoted:msg});
      await setPresence(sock,jid,"paused");
    } else { await reply(menuText(pn)); }
    return;
  }

  // ── MODE ──────────────────────────────────────────────
  if (lower==="self")   { if(!ownerFlag)return; botMode="self";   return reply("✅ Bot mode *PRIVATE*"); }
  if (lower==="public") { if(!ownerFlag)return; botMode="public"; return reply("✅ Bot mode *PUBLIC*"); }

  // ── TOGGLE FEATURES ───────────────────────────────────
  if (lower==="antilink on")  { if(!ownerFlag)return; antilinkOn=true;  return reply("✅ Anti-link *ON*"); }
  if (lower==="antilink off") { if(!ownerFlag)return; antilinkOn=false; return reply("🔕 Anti-link *OFF*"); }
  if (lower==="reaction on")  { if(!ownerFlag)return; reactionOn=true;  return reply("✅ Reaction *ON*"); }
  if (lower==="reaction off") { if(!ownerFlag)return; reactionOn=false; return reply("🔕 Reaction *OFF*"); }
  if (lower==="send on")      { if(!ownerFlag)return; sendOn=true;      return reply("✅ Send mode *ON*"); }
  if (lower==="send off")     { if(!ownerFlag)return; sendOn=false;     return reply("🔕 Send mode *OFF*"); }
  if (lower==="vanss on")  { if(!ownerFlag)return; vanssOn=true;  return reply("✅ Fitur *Vanss ON* — bot akan kirim pesan yang dihapus ke chat kamu."); }
  if (lower==="vanss off") { if(!ownerFlag)return; vanssOn=false; return reply("🔕 Fitur *Vanss OFF*"); }
  if (lower==="welcome on")   { if(!ownerFlag)return; welcomeOn=true;   return reply("✅ Fitur *Welcome ON*"); }
  if (lower==="welcome off")  { if(!ownerFlag)return; welcomeOn=false;  return reply("🔕 Fitur *Welcome OFF*"); }

  // ── PAY ───────────────────────────────────────────────
  if (lower==="pay") {
    const payPath = path.join(__dirname,"pay.jpg");
    if (fs.existsSync(payPath)) {
      await setPresence(sock,jid,"composing"); await sleep(600);
      await sock.sendMessage(jid,{image:fs.readFileSync(payPath),caption:"💳 *Info Pembayaran*\n\nSilakan transfer ke rekening di atas.",mimetype:"image/jpeg"},{quoted:msg});
      await setPresence(sock,jid,"paused");
    } else {
      await reply("❌ File pay.jpg belum ada. Upload file pay.jpg ke folder bot.");
    }
    return;
  }

  // ── SETWELCOME ────────────────────────────────────────
  if (lower.startsWith("setwelcome ")) {
    if (!ownerFlag) return reply("❌ Hanya admin!");
    const teks = body.slice(11).trim();
    if (!teks) return reply(
      "❌ Contoh:\n*setwelcome* Halo {nama} 👋\nSelamat datang di *{grup}*!\n\n" +
      "Variabel:\n{nama} = nama/nomer member\n{tag} = mention member\n{grup} = nama grup"
    );
    if (!isGroup) return reply("ℹ️ Kirim perintah ini *di dalam grup* yang ingin diset.");
    welcomeMap[jid] = teks;
    saveData();
    return reply(
      `✅ *Welcome grup berhasil diatur!*\n\n📝 Teks:\n${teks}\n\n` +
      `Variabel: *{nama}* *{tag}* *{grup}*\n` +
      `Status welcome: *${welcomeOn?"ON ✅":"OFF ❌"}*` +
      (welcomeOn?"":" — ketik *welcome on* untuk aktifkan")
    );
  }

  if (lower==="cekwelcome") {
    if (!ownerFlag) return;
    if (!isGroup)  return reply("❌ Khusus di dalam grup!");
    const teks = welcomeMap[jid];
    return reply(teks
      ? `✅ *Welcome grup ini:*\n\n${teks}\n\nStatus: *${welcomeOn?"ON ✅":"OFF ❌"}*`
      : `❌ Welcome belum diset.\nKirim: *setwelcome <teks>*`
    );
  }

  if (lower==="delwelcome") {
    if (!ownerFlag) return;
    if (!isGroup)  return reply("❌ Khusus di dalam grup!");
    delete welcomeMap[jid]; saveData();
    return reply("🗑️ Welcome grup ini *dihapus*.");
  }

  // ── BLACKLIST USER ────────────────────────────────────
  if (lower==="blacklist") {
    if (!ownerFlag) return;
    if (!quotedPart) return reply("❌ Reply dulu pesan user yang ingin di-blacklist!");
    const targetNum = cleanJid(quotedPart);
    if (isAdmin(quotedPart)) return reply("❌ Tidak bisa blacklist admin bot!");
    if (blacklistUser.includes(targetNum)) return reply(`⚠️ ${targetNum} sudah ada di blacklist.`);
    blacklistUser.push(targetNum); saveData();
    return reply(`🚫 *${targetNum}* berhasil dimasukkan ke blacklist.\nUser tidak akan direspon bot sama sekali.`);
  }

  if (lower==="unblacklist") {
    if (!ownerFlag) return;
    if (!quotedPart) return reply("❌ Reply dulu pesan user yang ingin dihapus dari blacklist!");
    const targetNum = cleanJid(quotedPart);
    const idx = blacklistUser.indexOf(targetNum);
    if (idx===-1) return reply(`⚠️ ${targetNum} tidak ada di blacklist.`);
    blacklistUser.splice(idx,1); saveData();
    return reply(`✅ *${targetNum}* dihapus dari blacklist.`);
  }

  // ── BLACKLIST GC ──────────────────────────────────────
  if (lower.startsWith("blacklistgc ")) {
    if (!ownerFlag) return;
    const rawLink = body.slice(12).trim();
    // Ekstrak kode dari link: https://chat.whatsapp.com/XXXXX
    const codeMatch = rawLink.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
    if (!codeMatch) return reply("❌ Format link tidak valid!\nContoh: blacklistgc https://chat.whatsapp.com/XXXXX");
    const inviteCode = codeMatch[1];
    // Coba resolve link ke groupId
    try {
      const groupInfo = await sock.groupGetInviteInfo(inviteCode);
      const groupJid  = groupInfo.id;
      if (blacklistGC.includes(groupJid)) return reply(`⚠️ Grup ini sudah di blacklist.`);
      blacklistGC.push(groupJid); saveData();
      return reply(`🚫 *Grup "${groupInfo.subject}"* berhasil diblacklist.\nBot tidak akan merespon pesan dari grup tersebut.`);
    } catch(e) {
      return reply(`❌ Gagal resolve link grup: ${e.message}`);
    }
  }

  // ── CEK BLACKLIST ─────────────────────────────────────
  if (lower==="cekbl") {
    if (!ownerFlag) return;
    const blUsers = blacklistUser.length ? blacklistUser.map((u,i)=>`${i+1}. ${u}`).join("\n") : "Kosong";
    const blGC    = blacklistGC.length   ? blacklistGC.map((g,i)=>`${i+1}. ${g}`).join("\n")   : "Kosong";
    return reply(`🚫 *Daftar Blacklist*\n\n👤 *User (${blacklistUser.length}):*\n${blUsers}\n\n👥 *Grup (${blacklistGC.length}):*\n${blGC}`);
  }

  // ── KICK ──────────────────────────────────────────────
  if (lower==="kick") {
    if (!ownerFlag) return;
    if (!isGroup)  return reply("❌ Khusus di dalam grup!");
    if (!quotedPart) return reply("❌ Reply dulu pesan user yang ingin di-kick!");
    if (isAdmin(quotedPart)) return reply("❌ Tidak bisa kick admin bot!");
    try {
      await sock.groupParticipantsUpdate(jid, [quotedPart], "remove");
      await reply(`✅ *${cleanJid(quotedPart)}* berhasil di-kick dari grup.`);
    } catch(e) { await reply(`❌ Gagal kick: ${e.message}`); }
    return;
  }

  // ── AUTO JOIN GRUP/CHANNEL ────────────────────────────
  if (lower.startsWith("autojoin ")) {
    if (!ownerFlag) return;
    const rawLink = body.slice(9).trim();
    const codeMatch = rawLink.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
    if (!codeMatch) return reply("❌ Format link tidak valid!\nContoh: autojoin https://chat.whatsapp.com/XXXXX");
    const inviteCode = codeMatch[1];
    try {
      await replyFast("⏳ Sedang join...");
      const result = await sock.groupAcceptInvite(inviteCode);
      await reply(`✅ Bot berhasil join!\nGrup ID: ${result}`);
    } catch(e) {
      await reply(`❌ Gagal join: ${e.message}`);
    }
    return;
  }

  // ── QRIS ──────────────────────────────────────────────
  if (lower.startsWith("qris ") || lower==="qris") {
    if (!ownerFlag) return reply("❌ Hanya admin!");
    const nominal = body.slice(5).trim();
    if (!nominal) return replyFast("❌ Contoh: *qris 50000*");
    await handleQRIS(sock, jid, msg, nominal); return;
  }

  // ── KALKULATOR ────────────────────────────────────────
  {
    const cb = body.replace(/[xX]/g,"*").trim();
    const cm = cb.match(/^([\d.,]+)\s*([+\-*/])\s*([\d.,]+)$/);
    if (cm) {
      const p=(s)=>parseFloat(s.replace(/\./g,"").replace(",","."));
      const a=p(cm[1]),op=cm[2],b=p(cm[3]);
      let r=null;
      if(op==="+")r=a+b; else if(op==="-")r=a-b;
      else if(op==="*")r=a*b;
      else if(op==="/"){if(b===0){await reply("❌ Tidak bisa bagi 0!");return;}r=a/b;}
      if(r!==null&&isFinite(r)){
        const fmt=r%1===0?r.toLocaleString("id-ID"):r.toLocaleString("id-ID",{minimumFractionDigits:1,maximumFractionDigits:2});
        await setPresence(sock,jid,"composing"); await sleep(400);
        await sock.sendMessage(jid,{text:`Total Rp ${fmt} Bos✅`},{quoted:msg});
        await setPresence(sock,jid,"paused"); return;
      }
    }
  }

  // ── FT — Foto/Video → Stiker ──────────────────────────
  if (lower === "ft") {
    // Ambil dari quoted atau pesan itu sendiri
    const imgMsg =
      quotedMsg?.imageMessage || quotedMsg?.videoMessage ||
      realMsg.imageMessage    || realMsg.videoMessage;
    if (!imgMsg) return reply("❌ Reply atau kirim foto/video bersama teks *ft*!");
    await react("⏳");
    try {
      const sharp = (await import("sharp")).default;
      // Download media
      const targetMsg = (quotedMsg?.imageMessage || quotedMsg?.videoMessage)
        ? { key:{ ...msg.key, id:ctxInfo?.stanzaId }, message:quotedMsg }
        : msg;
      const buffer = await downloadMediaMessage(targetMsg, "buffer", {}, { logger:_pino, reuploadRequest:sock.updateMediaMessage });
      const isVideo = !!(quotedMsg?.videoMessage || realMsg.videoMessage);

      let stickerBuf;
      if (isVideo) {
        // Video → webp animasi via ffmpeg
        const inFile  = tmpFile("mp4");
        const outFile = tmpFile("webp");
        fs.writeFileSync(inFile, buffer);
        await new Promise((res,rej) =>
          exec(
            `ffmpeg -y -i "${inFile}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2,fps=15,setsar=1" -vcodec libwebp -lossless 0 -compression_level 6 -q:v 50 -loop 0 -preset default -an -vsync 0 -t 8 "${outFile}"`,
            (err) => err ? rej(err) : res()
          )
        );
        stickerBuf = fs.readFileSync(outFile);
        fs.removeSync(inFile); fs.removeSync(outFile);
      } else {
        // Foto → webp statis 512x512 dengan padding transparan
        stickerBuf = await sharp(buffer)
          .resize(512, 512, { fit:"contain", background:{ r:0,g:0,b:0,alpha:0 } })
          .webp({ quality:90 })
          .toBuffer();
      }

      await sock.sendMessage(jid, { sticker: stickerBuf }, { quoted:msg });
      await react("✅");
    } catch(e) { await react("❌"); await replyFast("❌ Gagal buat stiker: " + e.message); }
    return;
  }

  // ── TT — Stiker → Foto ────────────────────────────────
  if (lower === "tt") {
    const stickerMsg = quotedMsg?.stickerMessage || realMsg.stickerMessage;
    if (!stickerMsg) return reply("❌ Reply atau kirim stiker bersama teks *tt*!");
    await react("⏳");
    try {
      const sharp = (await import("sharp")).default;
      const targetMsg = quotedMsg?.stickerMessage
        ? { key:{ ...msg.key, id:ctxInfo?.stanzaId }, message:quotedMsg }
        : msg;
      const buffer = await downloadMediaMessage(targetMsg, "buffer", {}, { logger:_pino, reuploadRequest:sock.updateMediaMessage });

      const isAnimated = stickerMsg.isAnimated;
      if (isAnimated) {
        // Animasi webp → gif → ambil frame pertama sebagai jpg
        const inFile  = tmpFile("webp");
        const outFile = tmpFile("jpg");
        fs.writeFileSync(inFile, buffer);
        await new Promise((res,rej) =>
          exec(
            `ffmpeg -y -i "${inFile}" -vframes 1 "${outFile}"`,
            (err) => err ? rej(err) : res()
          )
        );
        const jpgBuf = fs.readFileSync(outFile);
        fs.removeSync(inFile); fs.removeSync(outFile);
        await sock.sendMessage(jid, { image:jpgBuf, caption:"✅ Stiker → Foto" }, { quoted:msg });
      } else {
        // Statis webp → jpg
        const jpgBuf = await sharp(buffer).jpeg({ quality:95 }).toBuffer();
        await sock.sendMessage(jid, { image:jpgBuf, caption:"✅ Stiker → Foto" }, { quoted:msg });
      }
      await react("✅");
    } catch(e) { await react("❌"); await replyFast("❌ Gagal konversi: " + e.message); }
    return;
  }

  // ── SH ────────────────────────────────────────────────
  if (lower==="sh") {
    if (!quotedMsg) return reply("❌ Reply dulu foto/video sekali lihat!");
    await react("⏳");
    try {
      const voImg = quotedMsg.viewOnceMessage?.message?.imageMessage||quotedMsg.viewOnceMessageV2?.message?.imageMessage||quotedMsg.imageMessage;
      const voVid = quotedMsg.viewOnceMessage?.message?.videoMessage||quotedMsg.viewOnceMessageV2?.message?.videoMessage||quotedMsg.videoMessage;
      if (!voImg&&!voVid) return reply("❌ Bukan foto/video sekali lihat!");
      const fakeMsg={key:{...msg.key,id:ctxInfo?.stanzaId},message:quotedMsg};
      const buffer  = await downloadMediaMessage(fakeMsg,"buffer",{},{logger:_pino,reuploadRequest:sock.updateMediaMessage});
      const selfJid = `${Array.isArray(cfg.adminNumber)?cfg.adminNumber[0]:cfg.adminNumber}@s.whatsapp.net`;
      if(voVid) await sock.sendMessage(selfJid,{video:buffer,mimetype:"video/mp4",caption:"📥 SH — Video"});
      else      await sock.sendMessage(selfJid,{image:buffer,caption:"📥 SH — Foto"});
      await react("✅");
      if(!fromMe) await replyFast("✅ Disimpan ke chat bot!");
    } catch(e){await react("❌");await replyFast("❌ "+e.message);}
    return;
  }

  // ── BRAT ──────────────────────────────────────────────
  if (lower.startsWith("brat ")) {
    const teks = body.slice(5).trim();
    if (!teks) return reply("❌ Contoh: brat Halo Dunia");
    await react("⏳");
    try {
      const file = await makeBratSticker(teks);
      await sock.sendMessage(jid,{sticker:fs.readFileSync(file)},{quoted:msg});
      fs.removeSync(file); await react("✅");
    } catch(e){await react("❌");await replyFast("❌ "+e.message);}
    return;
  }

  // ── BRATVID ───────────────────────────────────────────
  if (lower.startsWith("bratvid ")) {
    const teks = body.slice(8).trim();
    if (!teks) return reply("❌ Contoh: bratvid Zang ganteng banget");
    await react("⏳");
    try {
      const file = await makeBratVidSticker(teks);
      await sock.sendMessage(jid,{sticker:fs.readFileSync(file)},{quoted:msg});
      fs.removeSync(file); await react("✅");
    } catch(e){await react("❌");await replyFast("❌ "+e.message);}
    return;
  }

  // ── HD ────────────────────────────────────────────────
  if (lower==="hd") {
    if (!quotedMsg) return reply("❌ Reply dulu foto atau video!");
    await react("⏳");
    try {
      const isVid  = !!quotedMsg.videoMessage;
      const fakeMsg= {key:{...msg.key,id:ctxInfo?.stanzaId},message:quotedMsg};
      const buffer = await downloadMediaMessage(fakeMsg,"buffer",{},{logger:_pino,reuploadRequest:sock.updateMediaMessage});
      const hdBuf  = await makeHD(buffer, isVid);
      if(isVid) await sock.sendMessage(jid,{video:hdBuf,mimetype:"video/mp4",caption:"✅ Video HD!"},{quoted:msg});
      else      await sock.sendMessage(jid,{image:hdBuf,caption:"✅ Foto HD!"},{quoted:msg});
      await react("✅");
    } catch(e){await react("❌");await replyFast("❌ "+e.message);}
    return;
  }

  // ── MP4 ───────────────────────────────────────────────
  if (lower.startsWith("mp4 ")) {
    const url=body.slice(4).trim(); if(!url)return reply("❌ Masukkan link TikTok!");
    await react("⏳");
    try {
      const {file,title}=await downloadTikTok(sock,jid,msg,url,"mp4");
      await sock.sendMessage(jid,{video:fs.readFileSync(file),mimetype:"video/mp4",caption:`🎬 ${title}`},{quoted:msg});
      fs.removeSync(file); await react("✅");
    } catch(e){await react("❌");await replyFast("❌ "+e.message);}
    return;
  }

  // ── MP3 ───────────────────────────────────────────────
  if (lower.startsWith("mp3 ")) {
    const url=body.slice(4).trim(); if(!url)return reply("❌ Masukkan link TikTok!");
    await react("⏳");
    try {
      const {file,title}=await downloadTikTok(sock,jid,msg,url,"mp3");
      await sock.sendMessage(jid,{audio:fs.readFileSync(file),mimetype:"audio/mpeg",ptt:false},{quoted:msg});
      fs.removeSync(file); await react("✅");
    } catch(e){await react("❌");await replyFast("❌ "+e.message);}
    return;
  }

  // ── JADIBOT ───────────────────────────────────────────
  if (lower.startsWith("jadibot ")) {
    if (!ownerFlag) return reply("❌ Hanya admin!");
    const num = body.slice(8).trim().replace(/[^0-9]/g,"");
    if (!num) return reply("❌ Contoh: jadibot 6281234567890");
    if (activeBots[num]) return reply(`⚠️ Bot ${num} sudah aktif! Ketik *stopbot ${num}* dulu.`);
    await replyFast(`⏳ Menyiapkan bot calone *${num}*...`);
    try {
      const calonSession = path.join(cfg.sessionDir, `calon_${num}`);
      fs.ensureDirSync(calonSession);
      const { sock: calonSock } = await createSock(calonSession);
      activeBots[num] = calonSock;
      let calonPairingDone = false;

      calonSock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        // Request pairing code sekali saja
        if (!calonPairingDone && !calonSock.authState.creds.registered) {
          calonPairingDone = true;
          await sleep(2000);
          try {
            const code = await calonSock.requestPairingCode(num);
            const fmt  = code?.match(/.{1,4}/g)?.join("-") || code;
            await sock.sendMessage(jid, {
              text:
`✅ *Bot Calone ${num} Siap!*

🔑 *Pairing Code:* \`${fmt}\`

📱 Cara pairing di WA:
1. Buka WA → Setelan (⚙️)
2. Perangkat Tertaut
3. Tautkan Perangkat
4. Pilih "Tautkan dengan nomor telepon"
5. Masukkan kode: *${fmt}*

⏳ Kode berlaku ~60 detik. Kalau gagal kirim *stopbot ${num}* lalu *jadibot ${num}* lagi.`,
            }).catch(()=>{});
          } catch(e) {
            await sock.sendMessage(jid, { text:`❌ Gagal buat pairing code: ${e.message}` }).catch(()=>{});
          }
        }

        if (connection === "open") {
          await sock.sendMessage(jid, { text:`✅ *Bot ${num} TERHUBUNG!*\nBot calone siap dipakai.` }).catch(()=>{});
          attachEvents(calonSock, true);
        }

        if (connection === "close") {
          const sc = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = sc !== DisconnectReason.loggedOut;
          if (shouldReconnect) {
            // Reconnect otomatis
            await sleep(4000);
            try {
              const { sock: newCalon } = await createSock(calonSession);
              activeBots[num] = newCalon;
              attachEvents(newCalon, true);
            } catch(_){}
          } else {
            delete activeBots[num];
            await sock.sendMessage(jid, { text:`⚠️ Bot ${num} logged out. Ketik *jadibot ${num}* untuk sambung ulang.` }).catch(()=>{});
          }
        }
      });

      calonSock.ev.on("creds.update", async () => {});

    } catch(e) { await replyFast("❌ Gagal buat bot calone: " + e.message); }
    return;
  }

  // ── STOPBOT ───────────────────────────────────────────
  if (lower.startsWith("stopbot ")) {
    if (!ownerFlag) return reply("❌ Hanya admin!");
    const num=body.slice(8).trim().replace(/[^0-9]/g,"");
    if (!activeBots[num]) return reply(`⚠️ Tidak ada bot aktif untuk ${num}`);
    try {
      activeBots[num].end(undefined);
      delete activeBots[num];
      fs.removeSync(path.join(cfg.sessionDir,`calon_${num}`));
      await reply(`✅ Bot *${num}* dihentikan.`);
    } catch(e){await replyFast("❌ "+e.message);}
    return;
  }

  // ── CEK NOMER ─────────────────────────────────────────
  if (lower.startsWith("c ")) {
    const rawNum=body.slice(2).trim().replace(/[^0-9]/g,"");
    if (!rawNum) return reply("❌ Contoh: c 6281234567890");
    const num=rawNum.startsWith("0")?"62"+rawNum.slice(1):rawNum;
    const waJid=`${num}@s.whatsapp.net`;
    await react("⏳"); await setPresence(sock,jid,"composing");
    try {
      const [result]=await sock.onWhatsApp(waJid);
      const terdaftar=(result?.exists??false)?"✅ Terdaftar":"❌ Tidak Terdaftar";
      const detectOp=(n)=>{
        const p=n.replace(/^62/,"0");
        if(/^(0811|0812|0813|0821|0822|0823|0851|0852|0853)/.test(p)) return "Telkomsel";
        if(/^(0814|0815|0816|0855|0856|0857|0858|0828)/.test(p))      return "Indosat Ooredoo";
        if(/^(0817|0818|0819|0859|0877|0878)/.test(p))                return "XL Axiata";
        if(/^(0831|0832|0833|0838)/.test(p))                          return "Axis";
        if(/^(0881|0882|0883|0884|0885|0886|0887|0888|0889)/.test(p)) return "Smartfren";
        if(/^(0895|0896|0897|0898|0899)/.test(p))                     return "Three (3)";
        return "Tidak dikenali";
      };
      let ppUrl=null; try{ppUrl=await sock.profilePictureUrl(waJid,"image");}catch(_){}
      const caption=`╔───── CEK NOMER ─────╗\n├ 📱 *Nomer*     : +${num}\n├ 📋 *Status*    : ${terdaftar}\n├ 📶 *Operator*  : ${detectOp(num)}\n├ 🖼️ *Foto PP*   : ${ppUrl?"Tersedia ↓":"Privat / Tidak ada"}\n╚─────────────────────╝`;
      if(ppUrl) await sock.sendMessage(jid,{image:{url:ppUrl},caption},{quoted:msg});
      else      await replyFast(caption);
      await react("✅");
    } catch(e){await react("❌");await replyFast("❌ Gagal: "+e.message);}
    await setPresence(sock,jid,"paused"); return;
  }
}

// ════════════════════════════════════════════════════════════
//   ATTACH EVENTS
// ════════════════════════════════════════════════════════════
function attachEvents(sock, isCalon=false) {

  // ── VANSS: Cache pesan masuk sebelum mungkin dihapus ──
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      // Simpan ke cache untuk deteksi hapus
      try {
        const m   = msg.message;
        if (!m || msg.key.fromMe) { /* skip pesan sendiri */ }
        else {
          const jid      = msg.key.remoteJid;
          const sender   = msg.key.participant || msg.key.remoteJid || "";
          const nomer    = sender.replace(/@.+/,"");
          const nama     = msg.pushName || nomer;
          const id       = msg.key.id;

          // Tentukan isi pesan
          const realM =
            m.ephemeralMessage?.message ||
            m.viewOnceMessage?.message  ||
            m.viewOnceMessageV2?.message ||
            m;

          let body = realM.conversation || realM.extendedTextMessage?.text || "";
          let type = "teks";
          let mediaBuffer = null;
          let mediaType   = null;

          if (realM.imageMessage)    { type="foto";   mediaType="imageMessage"; }
          else if (realM.videoMessage)  { type="video";  mediaType="videoMessage"; }
          else if (realM.audioMessage)  { type="audio";  mediaType="audioMessage"; }
          else if (realM.stickerMessage){ type="stiker"; mediaType="stickerMessage"; }
          else if (realM.documentMessage){ type="dokumen"; mediaType="documentMessage"; }

          const caption = realM.imageMessage?.caption || realM.videoMessage?.caption || "";
          if (caption) body = caption;

          // Simpan cache (max 500 entry, hapus yang lama)
          if (msgCache.size > 500) {
            const firstKey = msgCache.keys().next().value;
            msgCache.delete(firstKey);
          }
          msgCache.set(id, { jid, sender, nomer, nama, body, type, mediaType, msg: JSON.parse(JSON.stringify(msg)) });
        }
      } catch(_) {}

      // Auto-join dari undangan masuk admin
      try {
        const m = msg.message;
        const groupInvite =
          m?.groupInviteMessage ||
          m?.extendedTextMessage?.contextInfo?.quotedMessage?.groupInviteMessage;
        if (groupInvite && !msg.key.fromMe) {
          const senderJid = msg.key.participant || msg.key.remoteJid || "";
          if (checkOwner(senderJid, false)) {
            const code = groupInvite.inviteCode;
            if (code) await sock.groupAcceptInvite(code).catch(()=>{});
          }
        }
      } catch(_){}

      await handleMessage(sock, msg).catch((e)=>{ _rawErr(`[ZANG] Error: ${e.message}\n`); });
    }
  });

  // ── VANSS: Deteksi pesan dihapus ──────────────────────
  sock.ev.on("messages.update", async (updates) => {
    if (!vanssOn) return;
    for (const update of updates) {
      try {
        // Pesan dihapus untuk semua orang: protocolMessage type DELETE
        const proto = update.update?.message?.protocolMessage;
        if (!proto || proto.type !== 0) continue; // type 0 = REVOKE (hapus untuk semua)

        const deletedId = proto.key?.id;
        if (!deletedId) continue;

        const cached = msgCache.get(deletedId);
        if (!cached) continue; // tidak ada di cache, skip

        msgCache.delete(deletedId); // hapus dari cache

        const adminJid = `${Array.isArray(cfg.adminNumber)?cfg.adminNumber[0]:cfg.adminNumber}@s.whatsapp.net`;

        // Tentukan asal pesan
        const isGrp    = isJidGroup(cached.jid);
        let   asal     = isGrp ? `Grup` : "Chat Pribadi";
        if (isGrp) {
          try {
            const meta = await sock.groupMetadata(cached.jid);
            asal = `Grup: *${meta.subject}*`;
          } catch(_){}
        }

        const waktu = new Date().toLocaleString("id-ID",{timeZone:"Asia/Jakarta"});

        const notifHeader =
`🔍 *PESAN DIHAPUS TERDETEKSI!*

👤 *Dari*    : ${cached.nama} (+${cached.nomer})
📍 *Di*      : ${asal}
📌 *Tipe*    : ${cached.type}
🕐 *Waktu*   : ${waktu}
─────────────────────`;

        if (cached.type === "teks" || !cached.mediaType) {
          const isiPesan = cached.body || "_(pesan kosong / tidak tertangkap)_";
          await sock.sendMessage(adminJid, {
            text: `${notifHeader}\n💬 *Pesan:*\n${isiPesan}`,
          }).catch(()=>{});
        } else {
          // Ada media — coba kirim ulang media dari cache msg
          try {
            const cachedMsg = cached.msg;
            const realM = cachedMsg.message?.ephemeralMessage?.message || cachedMsg.message;
            const mediaMsg = realM?.[cached.mediaType];

            if (mediaMsg) {
              const buf = await downloadMediaMessage(
                cachedMsg, "buffer", {},
                { logger:_pino, reuploadRequest: sock.updateMediaMessage }
              ).catch(()=>null);

              const notifText = `${notifHeader}\n💬 *Caption:* ${cached.body||"(tidak ada)"}`;

              if (buf) {
                if (cached.type==="foto") {
                  await sock.sendMessage(adminJid,{image:buf,caption:notifText,mimetype:"image/jpeg"}).catch(()=>{});
                } else if (cached.type==="video") {
                  await sock.sendMessage(adminJid,{video:buf,caption:notifText,mimetype:"video/mp4"}).catch(()=>{});
                } else if (cached.type==="stiker") {
                  await sock.sendMessage(adminJid,{sticker:buf}).catch(()=>{});
                  await sock.sendMessage(adminJid,{text:notifText}).catch(()=>{});
                } else if (cached.type==="audio") {
                  await sock.sendMessage(adminJid,{audio:buf,mimetype:"audio/ogg; codecs=opus",ptt:true}).catch(()=>{});
                  await sock.sendMessage(adminJid,{text:notifText}).catch(()=>{});
                } else {
                  await sock.sendMessage(adminJid,{text:notifText+`\n\n_(Media tidak bisa dikirim ulang)_`}).catch(()=>{});
                }
              } else {
                await sock.sendMessage(adminJid,{text:notifText+`\n\n_(Media sudah tidak bisa diunduh)_`}).catch(()=>{});
              }
            } else {
              await sock.sendMessage(adminJid,{text:`${notifHeader}\n_(Isi media tidak tertangkap)_`}).catch(()=>{});
            }
          } catch(e) {
            await sock.sendMessage(adminJid,{text:`${notifHeader}\n_(Gagal ambil media: ${e.message})_`}).catch(()=>{});
          }
        }
      } catch(_){}
    }
  });

  // ── Welcome member baru — benar-benar menyambut ───────
  sock.ev.on("group-participants.update", async ({ id, participants, action }) => {
    if (action !== "add") return;
    if (!welcomeOn) return;
    const teks = welcomeMap[id];
    if (!teks) return;

    // Ambil metadata grup untuk nama grup
    let groupName = id;
    try { const meta = await sock.groupMetadata(id); groupName = meta.subject; } catch(_){}

    for (const p of participants) {
      // Coba ambil nama dari kontak, fallback ke nomer
      const nomer    = p.replace(/@.+/,"");
      let   namaUser = nomer;
      try {
        const contacts = sock.store?.contacts || {};
        const contact  = contacts[p];
        if (contact?.name||contact?.notify) namaUser = contact?.name||contact?.notify;
      } catch(_){}

      const hasMention = /\{tag\}/i.test(teks);
      const pesanFinal = teks
        .replace(/\{nama\}/gi, namaUser)
        .replace(/\{notel\}/gi, nomer)
        .replace(/\{tag\}/gi,   `@${nomer}`)
        .replace(/\{grup\}/gi,  groupName);

      await sock.sendMessage(id, {
        text: pesanFinal,
        ...(hasMention ? { mentions:[p] } : {}),
      }).catch(()=>{});
    }
  });

}

// ════════════════════════════════════════════════════════════
//   START BOT UTAMA
// ════════════════════════════════════════════════════════════
async function startMainBot(phoneNumber) {
  const { sock } = await createSock(cfg.sessionDir);
  let pairingDone = false;

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (!pairingDone && !sock.authState.creds.registered) {
      pairingDone = true;
      try {
        await sleep(1500);
        const code = await requestPairingCode(sock, phoneNumber);
        if (code) {
          _rawOut(`\n╔════════════════════════════════════╗\n`);
          _rawOut(`║   𝒁𝑨𝑵𝑮 𝑿 バンズ — PAIRING CODE    ║\n`);
          _rawOut(`╠════════════════════════════════════╣\n`);
          _rawOut(`║  Kode  : ${String(code).padEnd(26)}║\n`);
          _rawOut(`║  Nomor : ${phoneNumber.padEnd(26)}║\n`);
          _rawOut(`╚════════════════════════════════════╝\n`);
          _rawOut(`\n📱 WA → Setelan → Perangkat Tertaut → Masukkan Kode\n\n`);
        }
      } catch(err){ _rawErr(`[ZANG] ❌ ${err.message}\n`); process.exit(1); }
    }

    if (connection==="open") {
      _rawOut(`[ZANG] ✅ Bot terhubung!\n`);
      await sock.sendPresenceUpdate("unavailable");
      _rawOut(`[ZANG] 🔴 Mode OFFLINE. Kirim 'online' untuk aktifkan.\n`);
      try {
        await sleep(2000);
        const adminJid=`${Array.isArray(cfg.adminNumber)?cfg.adminNumber[0]:cfg.adminNumber}@s.whatsapp.net`;
        const imgPath =path.join(__dirname,"zang.jpg");
        const notifText=`╔───── BOT CONNECT ─────╗\n├ ✅ *Bot berhasil terhubung!*\n├ 📅 Waktu  : ${new Date().toLocaleString("id-ID",{timeZone:"Asia/Jakarta"})}\n├ 📱 BotNum : ${phoneNumber}\n├ 🔴 Status : OFFLINE (kirim *online*)\n╚───────────────────────╝`;
        if(fs.existsSync(imgPath)) await sock.sendMessage(adminJid,{image:fs.readFileSync(imgPath),caption:notifText,mimetype:"image/jpeg"});
        else await sock.sendMessage(adminJid,{text:notifText});
      } catch(_){}
    }

    if (connection==="close") {
      const code=lastDisconnect?.error?.output?.statusCode;
      const reconnect=code!==DisconnectReason.loggedOut;
      _rawOut(`[ZANG] ⚠️  Koneksi terputus (${code}). Reconnect: ${reconnect}\n`);
      if (reconnect){ await sleep(5000); startMainBot(phoneNumber); }
      else { _rawOut(`[ZANG] ❌ Logged out. Hapus folder session/ lalu restart.\n`); process.exit(1); }
    }
  });

  attachEvents(sock);
}

// ════════════════════════════════════════════════════════════
//   ENTRY POINT
// ════════════════════════════════════════════════════════════
_rawOut(`
  ╔───𖣂 𝙄𝙉𝙁𝙊𝙍𝙈𝘼𝙏𝙄𝙊𝙉 𖣂───╗
  ├ ⌬ 𝗕𝗼𝘁 𝗡𝗮𝗺𝗲 : 𝑩𝑶𝑻 𝑩𝑳𝑨𝑺𝑻
  ├ ⌬ 𝗩𝗲𝗿𝘀𝗶𝗼𝗻    : 0.5
  ├ ⌬ 𝗗𝗲𝘃𝗲𝗹𝗼𝗽𝗲𝗿  : 𝑽𝑨𝑵𝑺𝑺 X バンズ
  ├ ⌬ 𝗧𝗲𝗹𝗲𝗴𝗿𝗮𝗻   : @XIXI8778
  ├ ⌬ 𝗣𝗿𝗲𝗳𝗶𝘅     : 𝗠𝗗
  ╚──────────────⪩\n\n`);

const credsPath  = path.join(cfg.sessionDir,"creds.json");
const hasSession = fs.existsSync(credsPath);
const defaultNum = (cfg.botNumber&&cfg.botNumber!=="628xxxxxxxxx")
  ? cfg.botNumber
  : (Array.isArray(cfg.adminNumber)?cfg.adminNumber[0]:cfg.adminNumber);
let phoneNumber  = defaultNum;

if (!hasSession) {
  if (cfg.botNumber&&cfg.botNumber!=="628xxxxxxxxx") {
    _rawOut(`[ZANG] Menggunakan nomor bot dari config: ${phoneNumber}\n`);
  } else {
    const rl    = readline.createInterface({input:process.stdin,output:process.stdout});
    const input = await question(rl,`\nMasukkan nomor WA bot (contoh: 6281234567890) [default: ${defaultNum}]: `);
    rl.close();
    if (input.trim()) phoneNumber=input.trim().replace(/[^0-9]/g,"");
    _rawOut(`[ZANG] Menggunakan nomor: ${phoneNumber}\n`);
  }
} else {
  _rawOut(`[ZANG] Session ditemukan, menghubungkan...\n`);
}

await startMainBot(phoneNumber);
