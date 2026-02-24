'use strict';
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         🌙 CELESTIAPANEL BOT v14 — ULTRA STABLE             ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  ✅ Hosting Bot WA 24/7 — Support semua script Baileys      ║
 * ║  ✅ Terima SEMUA jenis file (.js .py .java .zip dll)        ║
 * ║  ✅ Auto-detect runtime + saran command cerdas              ║
 * ║  ✅ QRIS generate otomatis dari qr_string                   ║
 * ║  ✅ Payment Atlantic H2H — hapus QR otomatis setelah bayar  ║
 * ║  ✅ Auto-restart proses kalau crash                         ║
 * ║  ✅ Statistik CPU / RAM / Uptime server                     ║
 * ║  ✅ Broadcast pesan ke semua user (admin)                   ║
 * ║  ✅ Program Referral — bonus hari gratis                    ║
 * ║  ✅ Banner foto saat /start                                 ║
 * ║  ✅ DB atomic write — tidak pernah corrupt                  ║
 * ╚══════════════════════════════════════════════════════════════╝
 * ENV:
 *   BOT_TOKEN         = token @BotFather
 *   ADMIN_ID          = ID Telegram admin
 *   ATLANTIC_API_KEY  = API Key dari dashboard Atlantic H2H
 *   ATLANTIC_METODE   = metode pembayaran (default: qris)
 *   ATLANTIC_TYPE     = tipe deposit (default: ewallet)
 */

const TelegramBot = require('node-telegram-bot-api');
const { spawn }   = require('child_process');
const fs          = require('fs');
const path        = require('path');
const https       = require('https');
const http        = require('http');
const pay         = require('./payment');

// ══════════════════════════════════════════
//  KONFIGURASI
// ══════════════════════════════════════════
const BOT_TOKEN = process.env.BOT_TOKEN || '8219268200:AAGNF8otuDit6Ojd01ofDD8lL2wRJx1UDl4';
const ADMIN_ID  = parseInt(process.env.ADMIN_ID || '8496726839', 10);

if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN belum diset!'); process.exit(1); }

const BASE_DIR  = path.join(__dirname, 'servers');
const DATA_FILE = path.join(__dirname, 'data.json');
const TMP_DIR   = path.join(__dirname, '_tmp');
const LOG_MAX       = 50_000;
const POLL_MS       = 5_000;
const AUTO_RESTART  = true;   // 🆕 auto restart proses kalau crash
const MAX_RESTART   = 10;     // max restart berturut-turut
const RESTART_DELAY = 3_000;  // jeda sebelum restart (ms)

// ── REFERRAL CONFIG ─────────────────────────────────────────
const REF_BONUS = [
  { ajak:1,  bonus:1,  label:'1 teman → +1 hari'   },
  { ajak:3,  bonus:5,  label:'3 teman → +5 hari'   },
  { ajak:5,  bonus:10, label:'5 teman → +10 hari'  },
  { ajak:10, bonus:20, label:'10 teman → +20 hari' },
];

for (const d of [BASE_DIR, TMP_DIR])
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

// ══════════════════════════════════════════
//  DATABASE — atomic write
// ══════════════════════════════════════════
let DB = { users:{}, servers:{}, invoices:{} };
let _dbT = null;

function loadDB() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const p = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      DB = { users:p.users||{}, servers:p.servers||{}, invoices:p.invoices||{} };
    }
  } catch(e) { console.error('[DB load]', e.message); }
}

function saveDB() {
  if (_dbT) return;
  _dbT = setTimeout(() => {
    _dbT = null;
    try {
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(DB, null, 2));
      fs.renameSync(tmp, DATA_FILE);
    } catch(e) { console.error('[DB save]', e.message); }
  }, 800);
}
loadDB();

// ══════════════════════════════════════════
//  PAKET
// ══════════════════════════════════════════
const PLANS = {
  p15: { id:'p15', nama:'Premium 15 Hari', emoji:'💎', harga:5000,  hari:15,  role:'premium', maxSrv:1 },
  p30: { id:'p30', nama:'Premium 30 Hari', emoji:'💎', harga:10000, hari:30,  role:'premium', maxSrv:1 },
  own: { id:'own', nama:'Owner 1 Tahun',   emoji:'👑', harga:50000, hari:365, role:'owner',   maxSrv:5 },
};

// ══════════════════════════════════════════
//  USER SYSTEM
// ══════════════════════════════════════════
function getUser(id) {
  const uid = String(id);
  if (!DB.users[uid]) {
    DB.users[uid] = {
      id:uid, role:'trial', expiry:Date.now()+86400_000, maxSrv:1,
      joinedAt:Date.now(),
      refCode   : uid,          // kode referral = user ID sendiri
      refBy     : null,         // siapa yang ajak
      refCount  : 0,            // total berhasil ajak
      refClaimed: [],           // milestone yang sudah diklaim [1,3,5,10]
    };
    saveDB();
  }
  // Tambah field referral ke user lama yang belum punya
  const u = DB.users[uid];
  if (!u.refCode)    { u.refCode    = uid; saveDB(); }
  if (!u.refClaimed) { u.refClaimed = [];  saveDB(); }
  if (u.refCount === undefined) { u.refCount = 0; saveDB(); }
  return u;
}

const isAdmin   = id => id === ADMIN_ID;
const isExpired = u  => isAdmin(+u.id) ? false : Date.now() > u.expiry;
const canUse    = id => isAdmin(id) || !isExpired(getUser(id));
const isOwner   = id => isAdmin(id) || getUser(id).role === 'owner';
const getMaxSrv = id => isAdmin(id) ? 999 : (getUser(id).maxSrv || 1);
const BADGE     = { trial:'🆓 Trial', premium:'💎 Premium', owner:'👑 Owner' };

function sisaWaktu(u) {
  if (isAdmin(+u.id)) return '♾️ Selamanya';
  const ms = u.expiry - Date.now();
  if (ms <= 0) return '❌ Expired';
  const d=Math.floor(ms/86400_000), h=Math.floor((ms%86400_000)/3600_000), m=Math.floor((ms%3600_000)/60_000);
  return d>0 ? `${d}hr ${h}j` : h>0 ? `${h}j ${m}m` : `${m}mnt`;
}

function upgradeUser(userId, planId) {
  const plan = PLANS[planId]; if (!plan) return null;
  const u = getUser(userId);
  u.role = plan.role; u.expiry = Date.now() + plan.hari*86400_000; u.maxSrv = plan.maxSrv;
  saveDB(); return plan;
}

// ══════════════════════════════════════════
//  REFERRAL SYSTEM
// ══════════════════════════════════════════

// Proses referral saat user baru join
function processReferral(newUserId, refCode) {
  if (!refCode) return null;
  const refId = String(refCode).trim();

  // Tidak bisa ref diri sendiri
  if (refId === String(newUserId)) return null;

  // Referrer harus ada di DB
  const refUser = DB.users[refId];
  if (!refUser) return null;

  const newUser = getUser(newUserId);

  // User baru tidak boleh sudah punya refBy
  if (newUser.refBy) return null;

  // Catat referral
  newUser.refBy = refId;
  refUser.refCount = (refUser.refCount || 0) + 1;
  saveDB();

  // Cek milestone bonus
  checkRefBonus(refId);

  return refUser;
}

// Cek & kasih bonus milestone
function checkRefBonus(refId) {
  const u = DB.users[refId];
  if (!u) return;

  const count = u.refCount || 0;
  if (!u.refClaimed) u.refClaimed = [];

  // Cek setiap milestone dari besar ke kecil
  for (const tier of [...REF_BONUS].reverse()) {
    if (count >= tier.ajak && !u.refClaimed.includes(tier.ajak)) {
      // Kasih bonus hari
      u.refClaimed.push(tier.ajak);
      const bonusMs = tier.bonus * 86400_000;

      // Kalau expired → extend dari sekarang, kalau belum → extend dari expiry
      const base = Math.max(u.expiry, Date.now());
      u.expiry = base + bonusMs;

      // Kalau masih trial → upgrade ke premium otomatis
      if (u.role === 'trial') {
        u.role   = 'premium';
        u.maxSrv = 1;
      }

      saveDB();
      console.log(`[REF] 🎁 ${refId} dapat bonus +${tier.bonus} hari (${tier.ajak} referral)`);

      // Notif ke referrer
      bot.sendMessage(+refId,
        `🐉 *Bonus Referral!*\n\n` +
        `👥 Kamu sudah mengajak *${count} orang!*\n` +
        `🎁 Bonus: *+${tier.bonus} hari gratis*\n\n` +
        `⏰ Masa aktif diperpanjang!\n` +
        `Sisa: *${sisaWaktu(u)}*`,
        { parse_mode:'Markdown', reply_markup:{ inline_keyboard:[
          [{ text:'👤 Lihat Akun', callback_data:'akun' }],
        ]}}
      ).catch(()=>{});

      break; // kasih satu bonus per trigger
    }
  }
}

// Hitung milestone berikutnya
function nextRefMilestone(u) {
  const count = u.refCount || 0;
  const claimed = u.refClaimed || [];
  for (const tier of REF_BONUS) {
    if (count < tier.ajak && !claimed.includes(tier.ajak)) return tier;
  }
  return null;
}

// Text info referral user
function refTxt(id) {
  const u    = getUser(id);
  const link = `https://t.me/${BOT_USERNAME}?start=ref_${u.id}`;
  const next = nextRefMilestone(u);
  const count = u.refCount || 0;

  let milestoneTxt = REF_BONUS.map(t => {
    const done = (u.refClaimed||[]).includes(t.ajak);
    const cur  = count >= t.ajak;
    return `${done?'✅':cur?'🔓':'🔒'} ${t.label}`;
  }).join('\n');

  return (
    `╔══════════════════════════════╗\n` +
    `║  🔗 *PROGRAM REFERRAL*       ║\n` +
    `╠══════════════════════════════╣\n` +
    `║  👥 Teman diajak : *${String(count).padEnd(8)}*║\n` +
    `║  🎁 Bonus didapat: *${String((u.refClaimed||[]).length).padEnd(8)}*║\n` +
    `╠══════════════════════════════╣\n` +
    `║  🎯 *MILESTONE BONUS:*       ║\n` +
    `║  ${milestoneTxt.split('\n').join('\n║  ')}\n` +
    `╠══════════════════════════════╣\n` +
    `${next ? `║  ⏭ Berikutnya: ajak *${next.ajak-count}* lagi  ║\n` : `║  🏆 Semua milestone selesai! ║\n`}` +
    `╚══════════════════════════════╝\n\n` +
    `🔗 *Link Referral kamu:*\n` +
    `\`${link}\`\n\n` +
    `_Bagikan link ini ke teman!_\n` +
    `_Setiap teman join = bonus hari gratis!_ 🎁`
  );
}

// ══════════════════════════════════════════
//  BOT
// ══════════════════════════════════════════
const bot = new TelegramBot(BOT_TOKEN, {
  polling: { interval:300, autoStart:true, params:{ timeout:10 } }
});

let BOT_USERNAME = 'CelestiaPanelBot'; // akan diupdate saat startup

// ══════════════════════════════════════════
//  RUNTIME STATE
// ══════════════════════════════════════════
const procs       = {};  // sid -> { proc, logs, command, startedAt, restartCount, autoRestart }
const uploadQ     = {};  // chatId -> { serverId, pendingMsg, files[], timer }
const awaitCmd    = {};  // chatId -> sid
const waSt        = {};  // sid -> { chatId, phoneAsked, phoneSent, codeSent, lastCode, codeTimer }
const adminSt     = {};  // chatId -> { step, role, targetId }
const payWatch    = {};  // orderId -> { poller, timer }
const broadcastSt = {};  // chatId -> { step, msg }

// ══════════════════════════════════════════
//  SERVER HELPERS
// ══════════════════════════════════════════
const srvDir      = id  => path.join(BASE_DIR, id);
const getUserSrvs = uid => Object.values(DB.servers).filter(s => s.ownerId === String(uid));

function srvFiles(sid) {
  const d = srvDir(sid);
  if (!fs.existsSync(d)) return [];
  try { return fs.readdirSync(d).filter(f => { try { return fs.statSync(path.join(d,f)).isFile(); } catch(_){return false;} }); }
  catch(_) { return []; }
}

function mkServer(ownerId, name) {
  const id = 's' + Date.now();
  fs.mkdirSync(srvDir(id), { recursive:true });
  DB.servers[id] = { id, name, ownerId:String(ownerId), at:Date.now() };
  saveDB(); return DB.servers[id];
}

// ══════════════════════════════════════════
//  FILE ICONS & SMART COMMAND DETECT
// ══════════════════════════════════════════
const ICONS = {
  js:'🟨', mjs:'🟨', cjs:'🟨', jsx:'🟨', ts:'🟦', tsx:'🟦',
  py:'🐍', pyw:'🐍',
  java:'☕', jar:'☕', class:'☕',
  go:'🔵', rs:'🦀', rb:'💎', php:'🟣',
  sh:'⚙️', bash:'⚙️', zsh:'⚙️',
  json:'📋', env:'🔒', yml:'📄', yaml:'📄', toml:'📄', ini:'📄', cfg:'📄',
  txt:'📝', md:'📝',
  jpg:'🖼', jpeg:'🖼', png:'🖼', gif:'🎞', webp:'🖼', svg:'🎨', ico:'🖼',
  mp4:'🎬', mkv:'🎬', mp3:'🎵', wav:'🎵', ogg:'🎵', m4a:'🎵',
  zip:'📦', rar:'📦', zip:'📦',
};

const icon = name => ICONS[(name.split('.').pop()||'').toLowerCase()] || '📄';
const fmtSz = b => !b ? '' : b<1024 ? `${b}B` : b<1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(1)}MB`;

function detectCmds(sid) {
  const files = srvFiles(sid);
  const low   = files.map(f => f.toLowerCase());
  const hasF  = n => low.includes(n);
  const hasE  = e => low.some(f => f.endsWith('.'+e));
  const cmds  = [];

  // Node.js
  if (hasF('package.json')) {
    cmds.push({ label:'📦 npm start',      cmd:'npm start'    });
    cmds.push({ label:'🔧 npm run dev',    cmd:'npm run dev'  });
  }
  if (hasE('js')||hasE('mjs')) {
    const e = ['index.js','bot.js','main.js','app.js','server.js','start.js'].find(hasF)
           || files.find(f=>f.endsWith('.js')) || 'index.js';
    cmds.push({ label:`🟨 node ${e}`, cmd:`node ${e}` });
  }
  if (hasE('ts')) cmds.push({ label:'🟦 npx ts-node index.ts', cmd:'npx ts-node index.ts' });

  // Python
  if (hasE('py')) {
    const e = ['main.py','bot.py','app.py','run.py','index.py'].find(hasF)
           || files.find(f=>f.endsWith('.py')) || 'main.py';
    cmds.push({ label:`🐍 python3 ${e}`, cmd:`python3 ${e}` });
    if (hasF('requirements.txt')) cmds.push({ label:'📥 pip install -r requirements.txt', cmd:'pip3 install -r requirements.txt' });
  }

  // Java
  if (hasE('jar')) { const j=files.find(f=>f.endsWith('.jar')); cmds.push({ label:`☕ java -jar ${j}`, cmd:`java -jar ${j}` }); }
  if (hasE('java')) cmds.push({ label:'☕ javac & java Main', cmd:'find . -name "*.java"|xargs javac && java Main' });

  // PHP
  if (hasE('php')) { const e=['index.php','bot.php','main.php'].find(hasF)||files.find(f=>f.endsWith('.php'))||'index.php'; cmds.push({ label:`🟣 php ${e}`, cmd:`php ${e}` }); }

  // Go
  if (hasE('go')||hasF('go.mod')) cmds.push({ label:'🔵 go run .', cmd:'go run .' });

  // Ruby
  if (hasE('rb')) { const e=files.find(f=>f.endsWith('.rb'))||'main.rb'; cmds.push({ label:`💎 ruby ${e}`, cmd:`ruby ${e}` }); }

  // Rust
  if (hasE('rs')||hasF('cargo.toml')) cmds.push({ label:'🦀 cargo run', cmd:'cargo run' });

  // Lua
  if (hasE('lua')) { const e=files.find(f=>f.endsWith('.lua'))||'main.lua'; cmds.push({ label:`🌙 lua ${e}`, cmd:`lua ${e}` }); }

  // Shell
  const sh = ['run.sh','start.sh','bot.sh'].find(hasF)||files.find(f=>f.endsWith('.sh'));
  if (sh) cmds.push({ label:`⚙️ bash ${sh}`, cmd:`bash ${sh}` });

  // Custom selalu ada
  cmds.push({ label:'⌨️ Custom Command', cmd:'custom' });

  // Dedupe
  const seen = new Set();
  return cmds.filter(c => { if(seen.has(c.cmd)) return false; seen.add(c.cmd); return true; });
}

// ══════════════════════════════════════════
//  DOWNLOAD FILE — support file besar
// ══════════════════════════════════════════
function dlFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive:true });
    const out = fs.createWriteStream(dest);
    const cl  = url.startsWith('https') ? https : http;
    // Timeout 10 menit untuk file besar
    const timer = setTimeout(() => {
      try { req.destroy(); } catch(_) {}
      safeUnlink(dest);
      reject(new Error('Timeout download (>10 menit)'));
    }, 10 * 60_000);

    const req = cl.get(url, res => {
      clearTimeout(timer);
      if (res.statusCode !== 200) {
        out.destroy(); safeUnlink(dest);
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        if (onProgress && total > 0) onProgress(received, total);
      });
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error',  e => { safeUnlink(dest); reject(e); });
    });
    req.on('error', e => { clearTimeout(timer); safeUnlink(dest); reject(e); });
  });
}

function safeUnlink(p) { try { if(p&&fs.existsSync(p)) fs.unlinkSync(p); } catch(_){} }

// ══════════════════════════════════════════
//  EXTRACT ARSIP — streaming, hemat RAM, support ZIP besar
// ══════════════════════════════════════════
function extractArchive(src, dest, onProgress) {
  const low = src.toLowerCase();

  // ZIP → yauzl streaming (tidak load ke RAM semua)
  if (low.endsWith('.zip')) {
    return new Promise((resolve, reject) => {
      let yauzl;
      try { yauzl = require('yauzl'); } catch(_) { yauzl = null; }

      if (yauzl) {
        // lazyEntries + autoClose: baca satu per satu, hemat RAM
        yauzl.open(src, { lazyEntries: true, autoClose: true }, (err, zf) => {
          if (err) return reject(err);
          let total   = zf.entryCount || 0;
          let done    = 0;
          let hasErr  = false;
          let active  = 0;          // concurrent streams
          const MAX_C = 3;          // max 3 file ditulis bersamaan

          function readNext() {
            if (active < MAX_C) zf.readEntry();
          }

          zf.readEntry();

          zf.on('entry', entry => {
            const outPath = path.join(dest, entry.fileName);

            // Direktori
            if (/\/$/.test(entry.fileName)) {
              try { fs.mkdirSync(outPath, { recursive:true }); } catch(_) {}
              done++;
              if (onProgress) onProgress(done, total);
              readNext();
              return;
            }

            // File
            try { fs.mkdirSync(path.dirname(outPath), { recursive:true }); } catch(_) {}
            active++;
            zf.openReadStream(entry, (err2, stream) => {
              if (err2) {
                active--;
                done++;
                if (onProgress) onProgress(done, total);
                readNext();
                return;
              }
              const out = fs.createWriteStream(outPath);
              stream.pipe(out);
              out.on('close', () => {
                active--;
                done++;
                if (onProgress) onProgress(done, total);
                readNext();
              });
              out.on('error', () => {
                active--;
                done++;
                readNext();
              });
            });
          });

          zf.on('end',   () => { if (!hasErr) resolve(`${done} file diekstrak`); });
          zf.on('error', e  => { hasErr = true; reject(e); });
        });
      } else {
        // Fallback: unzip system
        const c = spawn('unzip', ['-o', src, '-d', dest], { stdio: ['ignore','pipe','pipe'] });
        let out = '';
        c.stdout.on('data', d => out += d);
        c.stderr.on('data', d => out += d);
        c.on('close', code => (code === 0 || code === 1)
          ? resolve(out)
          : reject(new Error(`unzip exit ${code}: ${out.slice(-300)}`))
        );
        c.on('error', e => reject(new Error(`unzip tidak tersedia: ${e.message}`)));
      }
    });
  }

  // TAR — gunakan streaming juga
  let args;
  if      (low.endsWith('.tar.gz') || low.endsWith('.tgz')) args = ['tar','-xzf',src,'-C',dest];
  else if (low.endsWith('.tar.bz2'))                        args = ['tar','-xjf',src,'-C',dest];
  else if (low.endsWith('.tar.xz'))                         args = ['tar','-xJf',src,'-C',dest];
  else if (low.endsWith('.tar'))                            args = ['tar','-xf', src,'-C',dest];
  else return Promise.reject(new Error('Format arsip tidak didukung (.zip .tar.gz .tar.bz2 .tar.xz .tar)'));

  return new Promise((resolve, reject) => {
    const [cmd, ...a] = args;
    const c = spawn(cmd, a, { stdio: ['ignore','pipe','pipe'] });
    let out = '';
    c.stdout.on('data', d => out += d);
    c.stderr.on('data', d => out += d);
    c.on('close', code => (code === 0 || code === 1)
      ? resolve(out || 'OK')
      : reject(new Error(`${cmd} exit ${code}: ${out.slice(-300)}`))
    );
    c.on('error', e => reject(new Error(`${cmd} tidak tersedia: ${e.message}`)));
  });
}

// ══════════════════════════════════════════
//  EXEC COMMAND — crash-safe
// ══════════════════════════════════════════
function buildPATH(dir) {
  return [
    process.env.PATH,
    '/usr/local/bin','/usr/local/sbin','/usr/bin','/usr/sbin','/bin','/sbin',
    path.join(dir, 'node_modules','.bin'),
    path.join(__dirname, 'node_modules','.bin'),
    path.join(process.env.HOME||'/root','.local','bin'),
    '/home/container/.local/bin',
  ].filter(Boolean).join(':');
}

function killProc(sid) {
  const p = procs[sid]?.proc;
  if (!p||p.killed) return;
  try { process.kill(-p.pid,'SIGTERM'); } catch(_){}
  setTimeout(() => { try { if(!p.killed) p.kill('SIGKILL'); } catch(_){} }, 3000);
}

function execCmd(sid, command, chatId) {
  const dir = srvDir(sid);
  killProc(sid);
  if (!procs[sid]) procs[sid] = { restartCount:0 };
  Object.assign(procs[sid], { proc:null, logs:`$ ${command}\n${'─'.repeat(40)}\n`, command, startedAt:Date.now() });
  // Reset WA state
  waSt[sid] = { chatId, phoneAsked:false, phoneSent:false, codeSent:false, lastCode:'', codeTimer:null };

  const child = spawn(command, [], {
    cwd: dir, shell: true,
    env: {
      ...process.env,
      PATH: buildPATH(dir),
      NODE_ENV: 'production',
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: 'true',
      JAVA_TOOL_OPTIONS: '-Dfile.encoding=UTF-8',
      FORCE_COLOR: '0',
    },
    stdio: ['pipe','pipe','pipe'],
  });

  procs[sid].proc = child;

  function pushLog(t) {
    procs[sid].logs += t;
    if (procs[sid].logs.length > LOG_MAX)
      procs[sid].logs = '...[dipotong]\n' + procs[sid].logs.slice(-LOG_MAX);
  }

  child.stdout.on('data', buf => { const t=buf.toString(); pushLog(t); detectWA(sid,t); });
  child.stderr.on('data', buf => { const t=buf.toString(); pushLog(t); detectWA(sid,t); });
  child.on('error', e => { pushLog(`\n[SPAWN ERROR] ${e.message}\n`); if(procs[sid]?.proc===child){procs[sid].proc=null;procs[sid].startedAt=null;} });
  child.on('close', (code,sig) => {
    pushLog(`\n${'─'.repeat(40)}\n[EXIT] code=${code??'?'} signal=${sig??'-'}\n`);
    if(procs[sid]?.proc===child){procs[sid].proc=null;procs[sid].startedAt=null;}

    // 🆕 AUTO RESTART — hanya kalau bukan intentional stop
    const ps = procs[sid];
    if (AUTO_RESTART && ps && ps.autoRestart && sig !== 'SIGTERM' && sig !== 'SIGKILL') {
      if ((ps.restartCount||0) >= MAX_RESTART) {
        pushLog(`[AUTO-RESTART] Batas ${MAX_RESTART}× tercapai. Berhenti.\n`);
        ps.autoRestart = false;
        bot.sendMessage(chatId,
          `⚠️ *Server "${DB.servers[sid]?.name}" berhenti!*\n\nAuto-restart sudah ${MAX_RESTART}× — dihentikan.\nCek log untuk detail.`,
          { parse_mode:'Markdown', reply_markup:{ inline_keyboard:[[{text:'📋 Lihat Log',callback_data:`lg:${sid}`},{text:'🖥 Panel',callback_data:`op:${sid}`}]] }}
        ).catch(()=>{});
        return;
      }
      ps.restartCount = (ps.restartCount||0) + 1;
      pushLog(`[AUTO-RESTART] Mencoba restart ke-${ps.restartCount}... (${RESTART_DELAY/1000}d)\n`);
      // Notif admin
      bot.sendMessage(chatId,
        `🔄 *Auto-restart #${ps.restartCount}*\nServer: *${DB.servers[sid]?.name||sid}*\nCommand: \`${ps.command}\``,
        { parse_mode:'Markdown' }
      ).catch(()=>{});
      setTimeout(() => {
        if (!procs[sid]?.autoRestart) return; // sudah di-stop manual
        execCmd(sid, ps.command, chatId);
      }, RESTART_DELAY);
    }
  });
}

const isRunning = sid => { const p=procs[sid]?.proc; return !!(p&&!p.killed&&p.pid); };

// ══════════════════════════════════════════
//  BAILEYS WA PAIRING — ANTI ERROR, FIX TERBARU
//  Support: @whiskeysockets/baileys, @adiwajsuma/baileys,
//           md-wa, baileys-md, baileys-lama, dan fork apapun
// ══════════════════════════════════════════

// Regex PHONE REQUEST — cover semua varian output Baileys
const RE_PHONE = [
  /please\s+enter\s+(your\s+)?phone/i,
  /enter\s+(your\s+)?phone\s*number/i,
  /masukkan\s+nomor\s*(hp|wa|telepon|phone)/i,
  /enter\s+phone\s*:/i,
  /input\s+(your\s+)?phone/i,
  /phone\s*number\s*(required|needed)/i,
  /nomor\s*(wa|whatsapp|hp)\s*(kamu|anda)?/i,
  /ketik\s+nomor/i,
  /scan\s+qr\s+or\s+enter/i,        // beberapa fork
  /use\s+pairing\s+code/i,
  /pairing\s+code\s+(for|request)/i,
  /request.*pairing.*code/i,
  /send\s+pairing\s+request/i,
];

// Regex PAIRING CODE — cover format: XXXX-YYYY dan XXXXXXXX (8 char tanpa dash)
const RE_CODE_DASH = /\b([A-Z0-9]{4}[-–—][A-Z0-9]{4})\b/;
const RE_CODE_BARE = /\bpairing\s+code[:\s]+([A-Z0-9]{8})\b/i;
const RE_CODE_LOG  = /\bcode[:\s]+([A-Z0-9]{4}[-–—]?[A-Z0-9]{4})\b/i;

// Regex CONNECTED — bot WA sudah online
const RE_CONNECTED = /connection.*open|credentials.*saved|connected\b|logged[\s-]in|terhubung|session.*saved|bot.*ready|authenticated|restored\s+session/i;

// Regex DISCONNECTED / ERROR — perlu retry
const RE_DISCONN = /connection.*closed|connection.*lost|stream\s+errored|logged\s+out|qr\s+expired|timeout.*auth/i;

function detectWA(sid, raw) {
  const ws = waSt[sid];
  if (!ws?.chatId) return;

  // Bersihkan ANSI escape codes
  const txt = raw.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g,'');

  // ── 1. Minta nomor HP ────────────────────────────────
  if (!ws.phoneAsked && RE_PHONE.some(r => r.test(txt))) {
    ws.phoneAsked = true;
    bot.sendMessage(ws.chatId,
      `📱 *Bot minta nomor HP*\n\n` +
      `Balas dengan format internasional:\n` +
      `\`628xxxxxxxxxx\`\n\n` +
      `_Contoh: 6281234567890_\n` +
      `_(tanpa + atau spasi)_`,
      {
        parse_mode  : 'Markdown',
        reply_markup: { inline_keyboard: [[{ text:'❌ Batal', callback_data:`cw:${sid}` }]] }
      }
    ).catch(() => {});
  }

  // ── 2. Kirim pairing code ────────────────────────────
  // Coba berbagai format
  const mDash = txt.match(RE_CODE_DASH);
  const mBare = txt.match(RE_CODE_BARE);
  const mLog  = txt.match(RE_CODE_LOG);
  const rawCode = (mDash?.[1] || mBare?.[1] || mLog?.[1] || '').replace(/[-–—]/g,'').toUpperCase();

  if (rawCode.length === 8 && rawCode !== ws.lastCode) {
    ws.lastCode = rawCode;

    // Format: XXXX-YYYY
    const display = rawCode.slice(0,4) + '-' + rawCode.slice(4);

    // Debounce 1 detik — hindari kirim duplikat kalau log muncul berulang
    if (ws.codeTimer) clearTimeout(ws.codeTimer);
    ws.codeTimer = setTimeout(() => {
      if (ws.codeSent && ws.lastCode === rawCode) return; // sudah kirim kode ini
      ws.codeSent = true;
      bot.sendMessage(ws.chatId,
        `🔑 *Pairing Code WhatsApp:*\n\n` +
        `┌──────────────────┐\n` +
        `│   \`${display}\`   │\n` +
        `└──────────────────┘\n\n` +
        `*Cara pairing:*\n` +
        `1. Buka WhatsApp di HP\n` +
        `2. Ketuk ⋮ → *Perangkat Tertaut*\n` +
        `3. Ketuk *Tautkan Perangkat*\n` +
        `4. Pilih *Tautkan dengan Nomor Telepon*\n` +
        `5. Masukkan kode di atas ✅\n\n` +
        `⏳ _Kode valid beberapa menit saja!_`,
        { parse_mode:'Markdown' }
      ).catch(() => {});
    }, 1000);
  }

  // ── 3. Berhasil konek ────────────────────────────────
  if (RE_CONNECTED.test(txt)) {
    // Reset state siap pairing ulang kalau perlu
    if (ws.codeTimer) clearTimeout(ws.codeTimer);
    Object.assign(ws, { phoneAsked:false, phoneSent:false, codeSent:false, lastCode:'', codeTimer:null });
    bot.sendMessage(ws.chatId,
      `✅ *WhatsApp berhasil terhubung!* 🐉\n\nBot kamu sudah online!`,
      { parse_mode:'Markdown' }
    ).catch(() => {});
  }

  // ── 4. Koneksi putus / expired ───────────────────────
  if (RE_DISCONN.test(txt)) {
    if (ws.codeTimer) clearTimeout(ws.codeTimer);
    // Reset agar bisa pairing lagi
    Object.assign(ws, { phoneAsked:false, phoneSent:false, codeSent:false, lastCode:'', codeTimer:null });
    bot.sendMessage(ws.chatId,
      `⚠️ *Koneksi WA terputus!*\n\nBot sedang mencoba reconnect otomatis...\n_Kalau tidak konek, coba Restart._`,
      { parse_mode:'Markdown' }
    ).catch(() => {});
  }
}

// ══════════════════════════════════════════
//  KIRIM QRIS FOTO
// ══════════════════════════════════════════
async function sendQrisPhoto(chatId, inv) {
  const plan = PLANS[inv.planId];
  const rp   = n => 'Rp ' + Number(n).toLocaleString('id-ID');

  // Selalu tampilkan 3 menit (timer lokal kita) bukan expired_at Atlantic yang 8 jam
  const sisaExp  = '3 menit';
  const expireMs = pay.QR_TTL; // 3 menit

  const cap =
    `╔══════════════════════════════╗\n` +
    `║      💳  PEMBAYARAN QRIS     ║\n` +
    `╚══════════════════════════════╝\n\n` +
    `${plan.emoji} *${plan.nama}*\n` +
    `💰 Nominal : *${rp(plan.harga)}*\n` +
    `─────────────────────────────\n` +
    `📲 *Scan pakai:*\n` +
    `GoPay · OVO · Dana · ShopeePay\n` +
    `BCA Mobile · Livin · QRIS apapun\n` +
    `─────────────────────────────\n` +
    `⏳ *Kadaluarsa: ${sisaExp}*\n` +
    `✅ _Akun aktif otomatis setelah bayar!_`;

  let tmp      = null;
  let qrisMsg  = null;
  try {
    if (!inv.qrString) throw new Error('qr_string kosong dari server payment');
    tmp      = await pay.generateQrisImage(inv.qrString, TMP_DIR);
    qrisMsg  = await bot.sendPhoto(chatId, tmp, { caption:cap, parse_mode:'Markdown' });
    pay.cleanTmp(tmp);
  } catch(e) {
    pay.cleanTmp(tmp);
    console.error('[QRIS Photo]', e.message);
    qrisMsg = await bot.sendMessage(chatId, cap + `\n\n⚠️ _Foto QR gagal digenerate, scan tidak tersedia._`, { parse_mode:'Markdown' });
  }

  return { msg: qrisMsg, expireMs };
}

// ── Hapus pesan QRIS dengan aman ────────────────────────────
async function deleteQrisMsg(chatId, msgId) {
  if (!msgId) return;
  try { await bot.deleteMessage(chatId, msgId); } catch(_) {}
}

// ══════════════════════════════════════════
//  PAYMENT WATCHER
//  - Hapus pesan QRIS saat bayar / expire
// ══════════════════════════════════════════
const EXPIRE_MSG = [
  `😤 *Bos gimana sih kok gak bayar!*\nTabung dulu uangnya kalau gitu 🐉`,
  `💸 *Eh bos, kehabisan uang?*\nGapapa nabung dulu! Kami masih di sini 😊`,
  `🤔 *Bos lupa bayar ya?*\nQRIS sudah kadaluarsa nih... Tabung dulu bos! 🏦`,
  `😅 *Wahh bos malah kabur!*\Tabung dulu aja uangnya 🐉`,
];

// startPayWatcher sekarang menerima qrisMsgId untuk dihapus
function startPayWatcher(chatId, reffId, qrisMsgId) {
  stopPayWatcher(reffId);
  const inv = DB.invoices[reffId];
  if (!inv) return;
  console.log('[PAY] 👀', reffId);

  const poller = setInterval(async () => {
    try {
      const res = await pay.checkStatus(reffId);

      // ── Expired dari Atlantic ──────────────────────────
      if (pay.isExpired(res)) {
        stopPayWatcher(reffId);
        if (inv.status !== 'pending') return;
        inv.status = 'expired'; saveDB();

        // Hapus pesan QRIS
        await deleteQrisMsg(chatId, qrisMsgId);

        const expMsg = EXPIRE_MSG[Math.floor(Math.random()*EXPIRE_MSG.length)];
        bot.sendMessage(chatId, expMsg, {
          parse_mode  : 'Markdown',
          reply_markup: { inline_keyboard:[
            [{ text:'🔄 Coba Beli Lagi', callback_data:'buy_menu' }],
            [{ text:'🏠 Menu Utama',     callback_data:'home'     }],
          ]},
        }).catch(()=>{});
        return;
      }

      // ── Belum bayar ────────────────────────────────────
      if (!pay.isPaid(res)) return;

      // ── SUDAH BAYAR ✅ ─────────────────────────────────
      stopPayWatcher(reffId);
      inv.status = 'paid'; saveDB();
      const plan = upgradeUser(chatId, inv.planId);
      if (!plan) return;
      console.log('[PAY] ✅ PAID!', chatId, inv.planId);

      // Hapus pesan QRIS dulu
      await deleteQrisMsg(chatId, qrisMsgId);

      // Kirim pesan sukses
      await bot.sendMessage(chatId,
        `🪙 *PEMBAYARAN BERHASIL!* 🪙\n\n` +
        `${'━'.repeat(30)}\n` +
        `✅ *Akun berhasil diupgrade!*\n\n` +
        `${plan.emoji} *${plan.nama}*\n` +
        `⏰ Aktif  : *${plan.hari} hari*\n` +
        `🖥 Server : *${plan.maxSrv===5?'5 server privat':'1 server'}*\n` +
        `${'━'.repeat(30)}\n\n` +
        `Ketik /start untuk mulai! 🚀`,
        { parse_mode:'Markdown', reply_markup:{ inline_keyboard:[
          [{ text:'🚀 Mulai Sekarang', callback_data:'home' }],
        ]}}
      );

      // Notif admin
      bot.sendMessage(ADMIN_ID,
        `💰 *PEMBAYARAN MASUK!*\n\n` +
        `👤 User   : \`${chatId}\`\n` +
        `${plan.emoji} Paket  : ${plan.nama}\n` +
        `💵 Nominal: Rp ${plan.harga.toLocaleString('id-ID')}\n` +
        `🆔 Ref ID : \`${reffId}\``,
        { parse_mode:'Markdown' }
      ).catch(()=>{});

    } catch(e) { console.error('[PAY poll]', e.message); }
  }, POLL_MS);

  // ── Timer lokal (pakai expireTs dari invoice = 3 menit) ──
  const localExpireMs = (() => {
    if (inv.expireTs) {
      const ms = inv.expireTs - Date.now();
      if (ms > 0) return ms + 3000; // +3 detik buffer
    }
    return pay.QR_TTL; // fallback 3 menit
  })();

  const timer = setTimeout(async () => {
    stopPayWatcher(reffId);
    if (DB.invoices[reffId]?.status !== 'pending') return;
    DB.invoices[reffId].status = 'expired'; saveDB();

    // Hapus pesan QRIS
    await deleteQrisMsg(chatId, qrisMsgId);

    const expMsg = EXPIRE_MSG[Math.floor(Math.random()*EXPIRE_MSG.length)];
    bot.sendMessage(chatId, expMsg, {
      parse_mode  : 'Markdown',
      reply_markup: { inline_keyboard:[
        [{ text:'🔄 Coba Beli Lagi', callback_data:'buy_menu' }],
        [{ text:'🏠 Menu Utama',     callback_data:'home'     }],
      ]},
    }).catch(()=>{});
  }, localExpireMs);

  payWatch[reffId] = { poller, timer };
}

function stopPayWatcher(id) {
  const w = payWatch[id]; if (!w) return;
  clearInterval(w.poller); clearTimeout(w.timer); delete payWatch[id];
}

// ══════════════════════════════════════════
//  🆕 STATISTIK CPU / RAM / UPTIME
// ══════════════════════════════════════════
function getStats() {
  return new Promise(resolve => {
    // Uptime sistem
    const uptimeSec = Math.floor(process.uptime());
    const ud = Math.floor(uptimeSec/86400), uh = Math.floor((uptimeSec%86400)/3600), um = Math.floor((uptimeSec%3600)/60);
    const uptimeStr = ud>0 ? `${ud}h ${uh}j ${um}m` : uh>0 ? `${uh}j ${um}m` : `${um}m`;

    // RAM dari Node.js process
    const mem  = process.memoryUsage();
    const ramMB = Math.round(mem.rss / 1048576);

    // CPU via /proc/stat (Linux) atau fallback
    try {
      const stat1 = fs.readFileSync('/proc/stat','utf8').split('\n')[0].split(/\s+/).slice(1).map(Number);
      setTimeout(() => {
        try {
          const stat2 = fs.readFileSync('/proc/stat','utf8').split('\n')[0].split(/\s+/).slice(1).map(Number);
          const idle1=stat1[3], total1=stat1.reduce((a,b)=>a+b,0);
          const idle2=stat2[3], total2=stat2.reduce((a,b)=>a+b,0);
          const cpu = Math.round(100*(1-(idle2-idle1)/(total2-total1)));
          resolve({ cpu:`${cpu}%`, ram:`${ramMB} MB`, uptime:uptimeStr });
        } catch(_) { resolve({ cpu:'N/A', ram:`${ramMB} MB`, uptime:uptimeStr }); }
      }, 500);
    } catch(_) { resolve({ cpu:'N/A', ram:`${ramMB} MB`, uptime:uptimeStr }); }
  });
}

// ══════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════
async function safeEdit(cid, mid, txt, opts={}) {
  try { await bot.editMessageText(txt, { chat_id:cid, message_id:mid, ...opts }); }
  catch(e) {
    if (e.message?.includes('there is no text')) {
      // Pesan adalah foto/media — hapus lalu kirim teks baru
      try { await bot.deleteMessage(cid, mid); } catch(_) {}
      try { await bot.sendMessage(cid, txt, opts); } catch(_) {}
    }
    // 'not modified' atau 'not found' → diam saja
  }
}

async function safeSend(cid, txt, opts={}) {
  try { return await bot.sendMessage(cid, txt, opts); } catch(e) { console.error('[send]',e.message?.slice(0,60)); }
}

// safeReply: edit kalau bisa, kalau pesan foto → hapus + kirim baru SEKALI SAJA
async function safeReply(cid, mid, txt, opts={}) {
  try {
    await bot.editMessageText(txt, { chat_id:cid, message_id:mid, ...opts });
  } catch(e) {
    const isPhoto = e.message?.includes('there is no text') || e.message?.includes('message type');
    const notFound = e.message?.includes('message to edit not found') || e.message?.includes('MESSAGE_ID_INVALID');
    if (isPhoto) {
      try { await bot.deleteMessage(cid, mid); } catch(_) {}
      try { await bot.sendMessage(cid, txt, opts); } catch(_) {}
    } else if (!notFound && !e.message?.includes('not modified')) {
      // Unexpected error → kirim sebagai pesan baru
      try { await bot.sendMessage(cid, txt, opts); } catch(_) {}
    }
    // 'not modified' → tidak perlu lakukan apa-apa
  }
}

function panelTxt(sid) {
  const srv   = DB.servers[sid];
  const run   = isRunning(sid);
  const files = srvFiles(sid);
  const ps    = procs[sid];
  const cmd   = ps?.command || '—';
  const rc    = ps?.restartCount || 0;
  const ar    = ps?.autoRestart ? '✅ ON' : '❌ OFF';
  const t     = ps?.startedAt;
  let ut = '—';
  if (t) {
    const s = Math.floor((Date.now()-t)/1000);
    ut = `${Math.floor(s/3600)}j ${Math.floor((s%3600)/60)}m ${s%60}d`;
  }
  const totalSz = files.reduce((acc,f) => {
    try { return acc + fs.statSync(path.join(srvDir(sid),f)).size; } catch(_) { return acc; }
  }, 0);

  return (
    `╔══════════════════════════════╗\n` +
    `║  🖥  *${(srv?.name||sid).slice(0,20)}*\n` +
    `╠══════════════════════════════╣\n` +
    `║  ⚡ Status     : ${run ? '🟢 *Running*' : '🔴 *Stopped*'}\n` +
    `║  💻 Command    : \`${cmd.slice(0,28)}\`\n` +
    `║  ⏱  Uptime     : ${ut}\n` +
    `║  📁 File       : ${files.length} file (${fmtSz(totalSz)})\n` +
    `║  🔄 Restart    : ${rc}× | Auto: ${ar}\n` +
    `║  🆔 Server ID  : \`${sid}\`\n` +
    `╚══════════════════════════════╝`
  );
}

function akunTxt(id) {
  if (isAdmin(id)) {
    const totalUser = Object.keys(DB.users).length;
    const totalSrv  = Object.keys(DB.servers).length;
    const totalInv  = Object.values(DB.invoices).filter(i=>i.status==='paid').length;
    return (
      `╔══════════════════════════════╗\n` +
      `║  👤 *ADMIN PANEL*            ║\n` +
      `╠══════════════════════════════╣\n` +
      `║  🔧 Role     : Admin ♾️      ║\n` +
      `║  🖥 Server   : Tak Terbatas  ║\n` +
      `║  👥 Total User : ${String(totalUser).padEnd(10)}║\n` +
      `║  🗂 Total Srv  : ${String(totalSrv).padEnd(10)}║\n` +
      `║  💰 Total Bayar: ${String(totalInv).padEnd(10)}║\n` +
      `╚══════════════════════════════╝`
    );
  }
  const u   = getUser(id);
  const exp = isExpired(u);
  const srvCount = getUserSrvs(id).length;
  return (
    `╔══════════════════════════════╗\n` +
    `║  👤 *INFO AKUN*              ║\n` +
    `╠══════════════════════════════╣\n` +
    `║  🏷 Status  : ${BADGE[u.role]||u.role}\n` +
    `║  ⏰ Sisa    : ${exp ? '❌ *Expired!*' : sisaWaktu(u)}\n` +
    `║  🖥 Server  : ${srvCount}/${getMaxSrv(id)}\n` +
    `║  🆔 User ID : \`${u.id}\`\n` +
    `╚══════════════════════════════╝`
  );
}

// ══════════════════════════════════════════
//  KEYBOARDS
// ══════════════════════════════════════════
const kbHome = id => {
  const r = [
    [{text:'🖥 Server Saya',callback_data:'srv_list'}, {text:'📊 Statistik',callback_data:'stats'}],
    [{text:'💰 Beli Paket',callback_data:'buy_menu'},  {text:'👤 Akun Saya',callback_data:'akun'}],
    [{text:'🔗 Referral',callback_data:'referral'},    {text:'📋 Riwayat Bayar',callback_data:'history'}],
    [{text:'❓ Bantuan',callback_data:'help'}],
  ];
  if(isOwner(id)) r.push([{text:'➕ Buat Server Baru',callback_data:'new_srv'}]);
  if(isAdmin(id)) r.push([{text:'📢 Broadcast',callback_data:'A:bc'},{text:'🔧 Admin Panel',callback_data:'A:back'}]);
  return {inline_keyboard:r};
};

const kbBuy = () => ({inline_keyboard:[
  [{text:'💎 Premium 15 Hari  — Rp 5.000', callback_data:'pay:p15'}],
  [{text:'💎 Premium 30 Hari  — Rp 10.000',callback_data:'pay:p30'}],
  [{text:'👑 Owner 1 Tahun    — Rp 50.000', callback_data:'pay:own'}],
  [{text:'🔙 Kembali',callback_data:'home'}],
]});

const kbSrv = sid => {
  const ar = procs[sid]?.autoRestart;
  return {inline_keyboard:[
    [{text:'▶️ Run',callback_data:`r:${sid}`},{text:'⏹ Stop',callback_data:`st:${sid}`},{text:'🔄 Restart',callback_data:`rs:${sid}`}],
    [{text:'📥 NPM Install',callback_data:`ni:${sid}`},{text:'🐍 Pip Install',callback_data:`pi:${sid}`},{text:'📋 Log',callback_data:`lg:${sid}`}],
    [{text:'📁 Files',callback_data:`fl:${sid}`},{text:'🗑 Kelola File',callback_data:`dm:${sid}`}],
    [{text:`🔁 Auto-Restart: ${ar?'✅':'❌'}`,callback_data:`ar:${sid}`},{text:'📊 Statistik',callback_data:`sv:${sid}`}],
    [{text:'🔄 Refresh',callback_data:`rf:${sid}`},{text:'🔙 Server List',callback_data:'srv_list'}],
  ]};
};

function kbCmd(sid) {
  const cmds = detectCmds(sid);
  const rows = [];
  for(let i=0;i<cmds.length&&i<10;i+=2){
    const row=[{text:cmds[i].label,callback_data:`c:${sid}:${cmds[i].cmd}`}];
    if(cmds[i+1]) row.push({text:cmds[i+1].label,callback_data:`c:${sid}:${cmds[i+1].cmd}`});
    rows.push(row);
  }
  rows.push([{text:'🔙 Batal',callback_data:`rf:${sid}`}]);
  return {inline_keyboard:rows};
}

const kbBack = (to='home') => ({inline_keyboard:[[{text:'🔙 Kembali',callback_data:to}]]});

const ADMKB = {inline_keyboard:[
  [{text:'👥 List User',callback_data:'A:lu'},{text:'💎 List Premium',callback_data:'A:lp'}],
  [{text:'👑 List Owner',callback_data:'A:lo'},{text:'💰 List Invoice',callback_data:'A:li'}],
  [{text:'➕ Add Premium',callback_data:'A:ap'},{text:'👑 Add Owner',callback_data:'A:ao'}],
  [{text:'📢 Broadcast',callback_data:'A:bc'},{text:'📊 Statistik Bot',callback_data:'A:stat'}],
  [{text:'⏹ Stop Bot',callback_data:'A:stop'}],
]};

async function sendExpired(chatId) {
  await safeSend(chatId,'⛔ *Masa akses habis!*\n\nUpgrade sekarang:',{parse_mode:'Markdown',reply_markup:kbBuy()});
}

// ══════════════════════════════════════════
//  UPLOAD — terima SEMUA jenis file Telegram
// ══════════════════════════════════════════
function getFileInfo(msg) {
  if (msg.document)   return { fileId:msg.document.file_id, fileName:msg.document.file_name||`file_${Date.now()}`, fileSize:msg.document.file_size||0 };
  if (msg.photo)      { const p=msg.photo[msg.photo.length-1]; return { fileId:p.file_id, fileName:`photo_${Date.now()}.jpg`, fileSize:p.file_size||0 }; }
  if (msg.audio)      return { fileId:msg.audio.file_id, fileName:msg.audio.file_name||`audio_${Date.now()}.mp3`, fileSize:msg.audio.file_size||0 };
  if (msg.video)      return { fileId:msg.video.file_id, fileName:msg.video.file_name||`video_${Date.now()}.mp4`, fileSize:msg.video.file_size||0 };
  if (msg.voice)      return { fileId:msg.voice.file_id, fileName:`voice_${Date.now()}.ogg`, fileSize:msg.voice.file_size||0 };
  if (msg.video_note) return { fileId:msg.video_note.file_id, fileName:`vidnote_${Date.now()}.mp4`, fileSize:msg.video_note.file_size||0 };
  if (msg.sticker)    return { fileId:msg.sticker.file_id, fileName:`sticker_${Date.now()}.webp`, fileSize:msg.sticker.file_size||0 };
  return null;
}

// ── Guard duplikat pesan ──────────────────────────────────────
const _handledMsgIds = new Set();
function isDupMsg(chatId, msgId) {
  const key = `${chatId}:${msgId}`;
  if (_handledMsgIds.has(key)) return true;
  _handledMsgIds.add(key);
  setTimeout(() => _handledMsgIds.delete(key), 10_000); // cleanup 10 detik
  return false;
}

async function handleFile(msg) {
  const chatId = msg.chat.id;
  // Cegah event duplikat (misal zip dikirim sebagai document + photo preview)
  if (isDupMsg(chatId, msg.message_id)) return;

  const info   = getFileInfo(msg);
  if (!info) return;
  if (!canUse(chatId)) { await sendExpired(chatId); return; }

  // Pastikan ada server
  let srvs = getUserSrvs(chatId);
  if (!srvs.length) {
    if (getUserSrvs(chatId).length < getMaxSrv(chatId)) { mkServer(chatId,'Server Utama'); srvs=getUserSrvs(chatId); }
    else { await safeSend(chatId,'❌ Batas server tercapai!'); return; }
  }

  // Pilih server target
  let sid = srvs.length===1 ? srvs[0].id : uploadQ[chatId]?.serverId;
  if (!sid && srvs.length>1) {
    uploadQ[chatId] = { ...(uploadQ[chatId]||{}), pendingMsg:msg };
    await safeSend(chatId,`📤 *Upload "${info.fileName}" ke server mana?*`,
      { parse_mode:'Markdown', reply_markup:{ inline_keyboard:srvs.map(s=>[{text:`🖥 ${s.name}`,callback_data:`ut:${s.id}`}]) }});
    return;
  }

  await doUpload(chatId, sid, info.fileId, info.fileName, info.fileSize);
}

async function doUpload(chatId, sid, fileId, fileName, fileSize) {
  const ic    = icon(fileName);
  const sz    = fileSize ? ` (${fmtSz(fileSize)})` : '';
  const isArc = /\.(zip|tar\.gz|tgz|tar\.bz2|tar\.xz|tar)$/i.test(fileName);
  const isBig = fileSize > 5 * 1024 * 1024; // >5MB dianggap besar

  const lm = await safeSend(chatId,
    `📥 *Mengunduh* ${ic} \`${fileName}\`${sz}...\n${isBig ? '_File besar, mohon sabar..._' : ''}`,
    { parse_mode:'Markdown' }
  );
  if (!lm) return;

  // Progress update tiap 10 detik untuk file besar
  let progressIv = null;
  let lastPct    = 0;
  if (isBig) {
    progressIv = setInterval(async () => {
      if (lastPct > 0 && lastPct < 100)
        await safeEdit(chatId, lm.message_id,
          `📥 *Mengunduh* ${ic} \`${fileName}\`${sz}...\n📊 Progress: *${lastPct}%*`,
          { parse_mode:'Markdown' }
        ).catch(()=>{});
    }, 8000);
  }

  try {
    const url  = await bot.getFileLink(fileId);
    const dest = path.join(srvDir(sid), fileName);
    fs.mkdirSync(srvDir(sid), { recursive:true });

    await dlFile(url, dest, (recv, total) => {
      lastPct = Math.round((recv / total) * 100);
    });
    if (progressIv) clearInterval(progressIv);

    let extra = '';
    if (isArc) {
      await safeEdit(chatId, lm.message_id,
        `📦 *Mengekstrak* \`${fileName}\`...\n_Mohon tunggu..._`,
        { parse_mode:'Markdown' }
      );

      // Progress extract untuk ZIP
      let extractDone = 0, extractTotal = 0;
      let extractIv = setInterval(async () => {
        if (extractTotal > 0)
          await safeEdit(chatId, lm.message_id,
            `📦 *Mengekstrak* \`${fileName}\`...\n📂 ${extractDone}/${extractTotal} file`,
            { parse_mode:'Markdown' }
          ).catch(()=>{});
      }, 5000);

      try {
        const result = await extractArchive(dest, srvDir(sid), (done, total) => {
          extractDone  = done;
          extractTotal = total;
        });
        clearInterval(extractIv);
        safeUnlink(dest);
        const numFiles = typeof result === 'string' && result.includes('file')
          ? result : `${extractDone || '?'} file`;
        extra = `\n📦 Diekstrak: *${numFiles}*`;
      } catch(e) {
        clearInterval(extractIv);
        extra = `\n⚠️ Ekstrak gagal: ${e.message}`;
      }
    }

    if (!uploadQ[chatId]) uploadQ[chatId] = { serverId:sid, files:[], timer:null };
    if (uploadQ[chatId].serverId !== sid) uploadQ[chatId] = { serverId:sid, files:[], timer:null };
    uploadQ[chatId].files.push(fileName);

    await safeEdit(chatId, lm.message_id,
      `✅ ${ic} *${fileName}* tersimpan!${sz}${extra}`,
      { parse_mode:'Markdown' }
    );

    // Debounce 3 detik → tampilkan command selector
    if (uploadQ[chatId].timer) clearTimeout(uploadQ[chatId].timer);
    uploadQ[chatId].timer = setTimeout(async () => {
      const q = uploadQ[chatId]; if (!q) return;
      const s = q.serverId, flist = [...q.files];
      uploadQ[chatId] = null;
      const hasPkg = fs.existsSync(path.join(srvDir(s), 'package.json'));
      const hasNM  = fs.existsSync(path.join(srvDir(s), 'node_modules'));
      const hasReq = fs.existsSync(path.join(srvDir(s), 'requirements.txt'));
      const tips   = [];
      if (hasPkg && !hasNM) tips.push('⚠️ _Ada package.json → tekan 📥 Install NPM dulu!_');
      if (hasReq)            tips.push('💡 _Ada requirements.txt → install pip dulu!_');
      await safeSend(chatId,
        `📦 *${flist.length} file siap:*\n${flist.map(f=>`  ${icon(f)} \`${f}\``).join('\n')}\n\n⚙️ *Pilih command:*` +
        (tips.length ? '\n\n' + tips.join('\n') : ''),
        { parse_mode:'Markdown', reply_markup:kbCmd(s) }
      );
    }, 3000);

  } catch(e) {
    if (progressIv) clearInterval(progressIv);
    await safeEdit(chatId, lm.message_id,
      `❌ *Upload gagal:*\n\`${e.message}\``,
      { parse_mode:'Markdown' }
    );
  }
}

// Daftarkan semua tipe file
for (const ev of ['document','photo','audio','video','voice','video_note','sticker'])
  bot.on(ev, handleFile);

// ══════════════════════════════════════════
//  COMMANDS
// ══════════════════════════════════════════
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId  = msg.chat.id;
  const param   = (match[1] || '').trim();
  const isNew   = !DB.users[String(chatId)];
  getUser(chatId);
  if (!canUse(chatId)) { await sendExpired(chatId); return; }
  const name      = msg.from?.first_name || 'User';
  const totalUser = Object.keys(DB.users).length;

  // Proses referral kalau ada parameter ref_XXXX
  let refBonus = null;
  if (isNew && param.startsWith('ref_')) {
    const refCode = param.slice(4);
    const refUser = processReferral(chatId, refCode);
    if (refUser) {
      refBonus = refUser;
      console.log(`[REF] User ${chatId} join via ref ${refCode}`);
    }
  }

  // Path banner logo CelestiaPanel
  const BANNER = path.join(__dirname, 'banner.png');
  const hasBanner = fs.existsSync(BANNER);

  // ── USER BARU ─────────────────────────────────────
  if (isNew && !isAdmin(chatId)) {
    mkServer(chatId, 'Server Trial');

    const caption =
      `🌙 *Selamat Datang di CelestiaPanel!*\n` +
      `_Hosting Bot WA Premium 24/7_\n\n` +
      `╔══════════════════════════════╗\n` +
      `║  🎁 TRIAL 1 HARI GRATIS!    ║\n` +
      `╚══════════════════════════════╝\n\n` +
      `✨ *Apa yang kamu dapat:*\n` +
      `🟢 Hosting bot WA 24/7 non-stop\n` +
      `🔄 Auto-restart jika bot crash\n` +
      `📁 Upload semua jenis file\n` +
      `⚡ Deploy instan, langsung jalan\n` +
      `🔑 Support semua script Baileys\n` +
      `🔗 Bonus hari via program referral\n` +
      (refBonus ? `\n🎁 *Diajak oleh pengguna setia kami!*\n` : '') +
      `\n${akunTxt(chatId)}\n\n` +
      `💡 *Cara mulai:*\n` +
      `Kirim file bot kamu (.js/.py/.zip dll)\n` +
      `→ Bot langsung bantu jalankan! 🚀`;

    if (hasBanner) {
      await bot.sendPhoto(chatId, BANNER, {
        caption,
        parse_mode  : 'Markdown',
        reply_markup: kbHome(chatId),
      }).catch(() => safeSend(chatId, caption, { parse_mode:'Markdown', reply_markup:kbHome(chatId) }));
    } else {
      await safeSend(chatId, caption, { parse_mode:'Markdown', reply_markup:kbHome(chatId) });
    }
    return;
  }

  // ── USER LAMA / RETURNING ─────────────────────────
  const stats = await getStats();
  const u     = getUser(chatId);
  const exp   = isExpired(u);

  const caption =
    `👋 *Halo, ${name}!*\n` +
    `_Selamat datang kembali di CelestiaPanel_ 🌙\n\n` +
    `${akunTxt(chatId)}\n\n` +
    `╔══════════════════════════════╗\n` +
    `║  📊 STATUS SISTEM            ║\n` +
    `╠══════════════════════════════╣\n` +
    `║  ⚡ CPU    : ${stats.cpu.padEnd(16)}║\n` +
    `║  💾 RAM    : ${stats.ram.padEnd(16)}║\n` +
    `║  ⏱  Uptime : ${stats.uptime.padEnd(16)}║\n` +
    `║  👥 User   : ${String(totalUser).padEnd(16)}║\n` +
    `╚══════════════════════════════╝\n\n` +
    (exp && !isAdmin(chatId)
      ? `⚠️ *Akun kamu sudah expired!*\nUpgrade sekarang untuk lanjut hosting 👇`
      : `✅ *Sistem berjalan normal*\nSilakan kelola server kamu 👇`);

  if (hasBanner) {
    await bot.sendPhoto(chatId, BANNER, {
      caption,
      parse_mode  : 'Markdown',
      reply_markup: kbHome(chatId),
    }).catch(() => safeSend(chatId, caption, { parse_mode:'Markdown', reply_markup:kbHome(chatId) }));
  } else {
    await safeSend(chatId, caption, { parse_mode:'Markdown', reply_markup:kbHome(chatId) });
  }
});

bot.onText(/\/buatserver\s+(.*)/i, async (msg, match) => {
  const chatId=msg.chat.id;
  if (!canUse(chatId)) { await sendExpired(chatId); return; }
  if (!isOwner(chatId)) { await safeSend(chatId,'👑 *Fitur Owner Only!*\n\nBeli Owner untuk 5 server privat.',{parse_mode:'Markdown',reply_markup:kbBuy()}); return; }
  const name=(match[1]||'').trim();
  if (!name) { await safeSend(chatId,'❌ Nama tidak boleh kosong!\n`/buatserver NamaServer`',{parse_mode:'Markdown'}); return; }
  if (getUserSrvs(chatId).length >= getMaxSrv(chatId)) { await safeSend(chatId,`❌ Batas ${getMaxSrv(chatId)} server!`); return; }
  const srv=mkServer(chatId,name);
  await safeSend(chatId,`✅ *Server "${name}" dibuat!*\n🆔 \`${srv.id}\``,{parse_mode:'Markdown',reply_markup:{inline_keyboard:[[{text:`🖥 Buka ${name}`,callback_data:`op:${srv.id}`}]]}});
});

bot.onText(/\/1922/, async msg => {
  if (!isAdmin(msg.chat.id)) return;
  await safeSend(msg.chat.id, '🔧 *ADMIN PANEL*', { parse_mode:'Markdown', reply_markup:ADMKB });
});

// ══════════════════════════════════════════
//  PESAN TEKS — WA nomor, custom cmd, admin
// ══════════════════════════════════════════
bot.on('message', async msg => {
  const chatId=msg.chat.id;
  if (!msg.text||msg.text.startsWith('/')) return;
  if (msg.document||msg.photo||msg.audio||msg.video||msg.voice||msg.video_note||msg.sticker) return;
  const text=msg.text.trim();

  // 🆕 Broadcast handler (admin)
  if (isAdmin(chatId) && broadcastSt[chatId]?.step === 'msg') {
    delete broadcastSt[chatId];
    const allUsers = Object.keys(DB.users).filter(uid => uid !== String(chatId));
    const sentMsg  = await safeSend(chatId, `📢 *Broadcasting ke ${allUsers.length} user...*`, {parse_mode:'Markdown'});
    let ok=0, fail=0;
    for (const uid of allUsers) {
      try {
        await bot.sendMessage(uid,
          `📢 *Pesan dari Admin:*\n\n${text}`,
          {parse_mode:'Markdown'}
        );
        ok++;
      } catch(_) { fail++; }
      await new Promise(r=>setTimeout(r,100)); // rate limit
    }
    if (sentMsg) await safeEdit(chatId, sentMsg.message_id,
      `✅ *Broadcast selesai!*\n\n📤 Terkirim : ${ok}\n❌ Gagal    : ${fail}`,
      {parse_mode:'Markdown', reply_markup:ADMKB}
    );
    return;
  }

  // Admin step
  if (isAdmin(chatId) && adminSt[chatId]) {
    const ast=adminSt[chatId];
    if (ast.step==='id') {
      const id=parseInt(text,10);
      if(isNaN(id)||id<=0){await safeSend(chatId,'⚠️ ID tidak valid!');return;}
      ast.targetId=id; ast.step='days';
      await safeSend(chatId,`✅ Target: \`${id}\`\n\nKirim jumlah hari:`,{parse_mode:'Markdown'});
      return;
    }
    if (ast.step==='days') {
      const days=parseInt(text,10);
      if(isNaN(days)||days<1){await safeSend(chatId,'⚠️ Jumlah hari tidak valid!');return;}
      const uid=String(ast.targetId);
      if(!DB.users[uid]) getUser(ast.targetId);
      DB.users[uid].role=ast.role; DB.users[uid].expiry=Date.now()+days*86400_000; DB.users[uid].maxSrv=ast.role==='owner'?5:1;
      saveDB(); delete adminSt[chatId];
      await safeSend(chatId,`✅ \`${ast.targetId}\` → *${BADGE[ast.role]}* | ${days} hari`,{parse_mode:'Markdown'});
      bot.sendMessage(ast.targetId,`🎉 *Akun diupgrade ke ${BADGE[ast.role]}!*\nDurasi: *${days} hari*\n\nKetik /start`,{parse_mode:'Markdown'}).catch(()=>{});
      return;
    }
  }

  // Input nomor WA
  for (const [sid, ws] of Object.entries(waSt)) {
    if (ws?.chatId!==chatId||!ws.phoneAsked||ws.phoneSent) continue;
    const num=text.replace(/\D/g,'');
    if (num.length<10||num.length>15) { await safeSend(chatId,'⚠️ Format: `628xxxxxxxxxx`\nContoh: `6281234567890`',{parse_mode:'Markdown'}); return; }
    ws.phoneSent=true;
    let sent=false;
    try { if(procs[sid]?.proc?.stdin?.writable){procs[sid].proc.stdin.write(num+'\n');sent=true;} } catch(_){}
    await safeSend(chatId, sent?`📤 Nomor \`${num}\` dikirim!\n⏳ Tunggu pairing code...`:`⚠️ Ketik manual: \`${num}\``, {parse_mode:'Markdown'});
    return;
  }

  // Custom command
  if (awaitCmd[chatId]) {
    const sid=awaitCmd[chatId]; delete awaitCmd[chatId];
    const sm=await safeSend(chatId,`⏳ Menjalankan:\n\`$ ${text}\``,{parse_mode:'Markdown'});
    if(!sm) return;
    execCmd(sid,text,chatId);
    if (procs[sid]) procs[sid].autoRestart = AUTO_RESTART;
    await new Promise(r=>setTimeout(r,2500));
    await safeEdit(chatId,sm.message_id,`${isRunning(sid)?'🟢 *Berhasil!*':'⚠️ *Berhenti — cek Log*'}\n\n${panelTxt(sid)}`,{parse_mode:'Markdown',reply_markup:kbSrv(sid)});
  }
});

// ══════════════════════════════════════════
//  CALLBACK HANDLER
// ══════════════════════════════════════════
bot.on('callback_query', async q => {
  const chatId=q.message?.chat?.id, msgId=q.message?.message_id, data=q.data||'';
  bot.answerCallbackQuery(q.id).catch(()=>{});
  if(!chatId||!msgId) return;

  // ── home ──────────────────────────────────────────
  if (data==='home') {
    if(!canUse(chatId)){await sendExpired(chatId);return;}
    await safeReply(chatId,msgId,`${akunTxt(chatId)}\n\n🌙 *CelestiaPanel — Hosting Bot WA 24/7*`,{parse_mode:'Markdown',reply_markup:kbHome(chatId)});
    return;
  }

  // ── akun ──────────────────────────────────────────
  if (data==='akun') {
    await safeReply(chatId,msgId,akunTxt(chatId),{parse_mode:'Markdown',reply_markup:{inline_keyboard:[[{text:'💰 Upgrade',callback_data:'buy_menu'},{text:'🔙 Kembali',callback_data:'home'}]]}});
    return;
  }

  // ── buy menu ──────────────────────────────────────
  if (data==='buy_menu') {
    await safeReply(chatId,msgId,
      `💰 *PILIH PAKET*\n\n┌──────────────────────────────────┐\n│ 💎 Premium 15 Hari  — Rp  5.000 │\n│ 💎 Premium 30 Hari  — Rp 10.000 │\n│ 👑 Owner 1 Tahun    — Rp 50.000 │\n└──────────────────────────────────┘\n\n✨ *Kelebihan:*\n🚀 24/7 non-stop · ⚡ Anti DDoS\n📦 Semua jenis file diterima\n🤖 Support Baileys WA penuh\n👑 Owner: 5 server privat\n\n💳 *Scan QRIS — aktivasi otomatis!*`,
      {parse_mode:'Markdown',reply_markup:kbBuy()});
    return;
  }

  // ── beli → QRIS ──────────────────────────────────
  if (data.startsWith('pay:')) {
    const planId=data.slice(4); if(!PLANS[planId]) return;
    const loadMsg = await safeSend(chatId,
      `⏳ *Membuat QRIS...*\n\n_Mohon tunggu sebentar..._`,
      {parse_mode:'Markdown'});
    try {
      const inv = await pay.createInvoice(DB, chatId, planId, PLANS);
      saveDB();

      // Kirim foto QRIS
      const { msg: qrisMsg } = await sendQrisPhoto(chatId, inv);
      const qrisMsgId = qrisMsg?.message_id || null;

      // Edit pesan loading jadi konfirmasi
      if (loadMsg) await safeEdit(chatId, loadMsg.message_id,
        `✅ *QRIS berhasil dibuat!*\n\n` +
        `🤖 Bot standby menunggu konfirmasi bayar...\n` +
        `⏰ Kadaluarsa 3 menit`,
        {parse_mode:'Markdown'});

      // Mulai watcher dengan msgId QRIS untuk dihapus nanti
      startPayWatcher(chatId, inv.reffId, qrisMsgId);
    } catch(e) {
      console.error('[pay]', e.message);
      if (loadMsg) await safeEdit(chatId, loadMsg.message_id,
        `❌ *Gagal buat QRIS:*\n\`${e.message}\`\n\n_Pastikan ATLANTIC\\_API\\_KEY sudah diset._`,
        {parse_mode:'Markdown',reply_markup:kbBack('buy_menu')});
    }
    return;
  }

  // ── server list ───────────────────────────────────
  if (data==='srv_list') {
    if(!canUse(chatId)){await sendExpired(chatId);return;}
    const srvs=isAdmin(chatId)?Object.values(DB.servers):getUserSrvs(chatId);
    if(!srvs.length){
      await safeReply(chatId,msgId,`📭 *Belum ada server.*\n\n${isOwner(chatId)?'Ketik `/buatserver NamaServer`':'Beli Owner untuk buat server!'}`,
        {parse_mode:'Markdown',reply_markup:{inline_keyboard:[[{text:'💰 Upgrade',callback_data:'buy_menu'},{text:'🔙 Kembali',callback_data:'home'}]]}});
      return;
    }
    const rows=srvs.map(s=>[{text:`${isRunning(s.id)?'🟢':'🔴'} 🖥 ${s.name} (${srvFiles(s.id).length}f)`,callback_data:`op:${s.id}`}]);
    rows.push([{text:'🔙 Kembali',callback_data:'home'}]);
    await safeReply(chatId,msgId,`🖥 *Server* (${srvs.length}/${getMaxSrv(chatId)}):`,{parse_mode:'Markdown',reply_markup:{inline_keyboard:rows}});
    return;
  }

  if (data.startsWith('op:')) { const sid=data.slice(3); if(!DB.servers[sid]) return; await safeEdit(chatId,msgId,panelTxt(sid),{parse_mode:'Markdown',reply_markup:kbSrv(sid)}); return; }
  if (data.startsWith('rf:')) { const sid=data.slice(3); await safeEdit(chatId,msgId,panelTxt(sid),{parse_mode:'Markdown',reply_markup:kbSrv(sid)}); return; }

  // ── run → command list ────────────────────────────
  if (data.startsWith('r:')) {
    const sid=data.slice(2), files=srvFiles(sid);
    if(!files.length){await safeEdit(chatId,msgId,'📭 *Server kosong!*\n\nKirim file terlebih dahulu.',{parse_mode:'Markdown',reply_markup:kbSrv(sid)});return;}
    const tips=[];
    if(fs.existsSync(path.join(srvDir(sid),'package.json'))&&!fs.existsSync(path.join(srvDir(sid),'node_modules'))) tips.push('⚠️ _Ada package.json — tekan 📥 Install NPM dulu!_');
    if(fs.existsSync(path.join(srvDir(sid),'requirements.txt'))) tips.push('💡 _Ada requirements.txt — install pip dulu!_');
    await safeEdit(chatId,msgId,
      `📁 *File:*\n${files.map(f=>`  ${icon(f)} \`${f}\``).join('\n')}\n\n⚙️ *Pilih command:*`+(tips.length?'\n\n'+tips.join('\n'):''),
      {parse_mode:'Markdown',reply_markup:kbCmd(sid)});
    return;
  }

  // ── jalankan command ──────────────────────────────
  if (data.startsWith('c:')) {
    const i=data.indexOf(':',2), sid=data.slice(2,i), cmd=data.slice(i+1);
    if (cmd==='custom') {
      awaitCmd[chatId]=sid;
      await safeEdit(chatId,msgId,'⌨️ *Ketik command:*\n\nContoh:\n`npm start`\n`node index.js`\n`python3 main.py`\n`java -jar bot.jar`\n`php index.php`',{parse_mode:'Markdown',reply_markup:kbBack(`rf:${sid}`)});
      return;
    }
    await safeEdit(chatId,msgId,`⏳ Menjalankan:\n\`$ ${cmd}\``,{parse_mode:'Markdown'});
    execCmd(sid,cmd,chatId);
    if (procs[sid]) procs[sid].autoRestart = AUTO_RESTART; // 🆕 aktifkan auto-restart
    await new Promise(r=>setTimeout(r,2500));
    await safeEdit(chatId,msgId,`${isRunning(sid)?'🟢 *Berhasil!*':'⚠️ *Berhenti — cek Log*'}\n\n${panelTxt(sid)}`,{parse_mode:'Markdown',reply_markup:kbSrv(sid)});
    return;
  }

  // ── stop ──────────────────────────────────────────
  if (data.startsWith('st:')) {
    const sid=data.slice(3);
    if(!isRunning(sid)){bot.answerCallbackQuery(q.id,{text:'⚠️ Tidak ada proses!'}).catch(()=>{});return;}
    if (procs[sid]) procs[sid].autoRestart = false; // 🆕 matikan auto-restart saat stop manual
    killProc(sid); if(procs[sid]){procs[sid].proc=null;procs[sid].startedAt=null;}
    await safeEdit(chatId,msgId,`⏹ *Dihentikan!*\n\n${panelTxt(sid)}`,{parse_mode:'Markdown',reply_markup:kbSrv(sid)});
    return;
  }

  // ── restart ───────────────────────────────────────
  if (data.startsWith('rs:')) {
    const sid=data.slice(3), prev=procs[sid]?.command;
    if(!prev){bot.answerCallbackQuery(q.id,{text:'⚠️ Belum pernah run!'}).catch(()=>{});return;}
    killProc(sid);
    if(procs[sid]){procs[sid].proc=null;procs[sid].logs='';procs[sid].startedAt=null;procs[sid].restartCount=(procs[sid].restartCount||0)+1;}
    await safeEdit(chatId,msgId,`🔄 Merestart \`${prev}\`...`,{parse_mode:'Markdown'});
    execCmd(sid,prev,chatId);
    await new Promise(r=>setTimeout(r,2500));
    await safeEdit(chatId,msgId,`${isRunning(sid)?'🔄 *Restart berhasil!*':'⚠️ *Gagal — cek log*'}\n\n${panelTxt(sid)}`,{parse_mode:'Markdown',reply_markup:kbSrv(sid)});
    return;
  }

  // ── npm install ───────────────────────────────────
  if (data.startsWith('ni:')) {
    const sid=data.slice(3), dir=srvDir(sid);
    if(!fs.existsSync(path.join(dir,'package.json'))){
      await safeEdit(chatId,msgId,'❌ *package.json tidak ditemukan!*',{parse_mode:'Markdown',reply_markup:kbSrv(sid)});
      return;
    }
    await safeEdit(chatId,msgId,
      `⏳ *npm install berjalan...*\n_Sabar sebentar, proses ini bisa 2-5 menit untuk bot WA ☕_`,
      {parse_mode:'Markdown'});

    await new Promise(resolve => {
      let log = '';
      // --max-old-space-size=256 → batasi RAM 256MB agar tidak Killed
      // --prefer-offline → pakai cache kalau ada
      // --no-audit → skip audit, lebih cepat
      const npmEnv = {
        ...process.env,
        PATH              : buildPATH(dir),
        CI                : 'false',
        npm_config_loglevel: 'warn',
        NODE_OPTIONS      : '--max-old-space-size=256',
      };
      const c = spawn('npm', ['install','--prefer-offline','--no-audit','--no-fund'], {
        cwd:dir, shell:false, env:npmEnv
      });

      // Timeout 10 menit
      const killTimer = setTimeout(() => {
        try { c.kill('SIGKILL'); } catch(_) {}
      }, 10 * 60_000);

      c.stdout.on('data', d => log += d);
      c.stderr.on('data', d => log += d);

      const iv = setInterval(() => {
        const tail = log.replace(/\x1b\[[0-9;]*m/g,'').slice(-500);
        safeEdit(chatId,msgId,
          `⏳ *npm install...*\n\`\`\`\n${tail||'Memproses...'}\n\`\`\``,
          {parse_mode:'Markdown'}
        ).catch(()=>{});
      }, 8000);

      c.on('close', async code => {
        clearInterval(iv);
        clearTimeout(killTimer);
        if (code === 0) {
          await safeEdit(chatId,msgId,
            `✅ *npm install selesai!*\n\n${panelTxt(sid)}`,
            {parse_mode:'Markdown',reply_markup:kbSrv(sid)});
        } else {
          const err = log.replace(/\x1b\[[0-9;]*m/g,'').slice(-1200);
          const hint = err.includes('Killed') || err.includes('signal') ?
            '\n\n⚠️ _Killed = RAM VPS habis. Coba: matikan proses lain dulu, atau pakai VPS RAM lebih besar._' : '';
          await safeEdit(chatId,msgId,
            `❌ *npm install gagal!* (code ${code})\n\`\`\`\n${err||'no output'}\n\`\`\`${hint}`,
            {parse_mode:'Markdown',reply_markup:kbSrv(sid)});
        }
        resolve();
      });
      c.on('error', async e => {
        clearInterval(iv);
        clearTimeout(killTimer);
        await safeEdit(chatId,msgId,`❌ Error: ${e.message}`,{reply_markup:kbSrv(sid)});
        resolve();
      });
    });
    return;
  }

  // ── pip install ───────────────────────────────────
  if (data.startsWith('pi:')) {
    const sid=data.slice(3), dir=srvDir(sid);
    const reqFile = ['requirements.txt','requirement.txt','reqs.txt'].find(f=>fs.existsSync(path.join(dir,f)));
    if (!reqFile) {
      await safeEdit(chatId,msgId,
        `❌ *requirements.txt tidak ditemukan!*\n\nBuat file \`requirements.txt\` berisi daftar library Python dulu.`,
        {parse_mode:'Markdown',reply_markup:kbSrv(sid)});
      return;
    }
    await safeEdit(chatId,msgId,
      `⏳ *pip install berjalan...*\n_Menginstall dari \`${reqFile}\`, mohon tunggu 🐍_`,
      {parse_mode:'Markdown'});

    await new Promise(resolve => {
      let log = '';
      const c = spawn('pip3', ['install','-r',reqFile,'--no-cache-dir','--quiet'], {
        cwd:dir, shell:false,
        env:{...process.env, PYTHONUNBUFFERED:'1', PIP_NO_CACHE_DIR:'1'},
      });
      const killTimer = setTimeout(() => { try{c.kill('SIGKILL');}catch(_){} }, 10*60_000);

      c.stdout.on('data',d=>log+=d);
      c.stderr.on('data',d=>log+=d);
      const iv=setInterval(()=>{
        const tail=log.replace(/\x1b\[[0-9;]*m/g,'').slice(-400);
        safeEdit(chatId,msgId,`⏳ *pip install...*\n\`\`\`\n${tail||'Memproses...'}\n\`\`\``,{parse_mode:'Markdown'}).catch(()=>{});
      },8000);

      c.on('close',async code=>{
        clearInterval(iv); clearTimeout(killTimer);
        if(code===0) {
          await safeEdit(chatId,msgId,`✅ *pip install selesai!*\n\n${panelTxt(sid)}`,{parse_mode:'Markdown',reply_markup:kbSrv(sid)});
        } else {
          const err=log.replace(/\x1b\[[0-9;]*m/g,'').slice(-1000);
          await safeEdit(chatId,msgId,`❌ *pip install gagal!*\n\`\`\`\n${err||'no output'}\n\`\`\``,{parse_mode:'Markdown',reply_markup:kbSrv(sid)});
        }
        resolve();
      });
      c.on('error',async e=>{
        clearInterval(iv); clearTimeout(killTimer);
        await safeEdit(chatId,msgId,`❌ pip3 tidak tersedia: ${e.message}`,{reply_markup:kbSrv(sid)});
        resolve();
      });
    });
    return;
  }

  // ── log ───────────────────────────────────────────
  if (data.startsWith('lg:')) {
    const sid=data.slice(3);
    const out=(procs[sid]?.logs||'(Belum ada output)').replace(/\x1b\[[0-9;]*m/g,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n').slice(-3000);
    await safeEdit(chatId,msgId,`📋 *Log* ${isRunning(sid)?'🟢':'🔴'}\n\`\`\`\n${out}\n\`\`\``,
      {parse_mode:'Markdown',reply_markup:{inline_keyboard:[[{text:'🔄 Refresh',callback_data:`lg:${sid}`},{text:'🔙 Panel',callback_data:`rf:${sid}`}]]}});
    return;
  }

  // ── file list ─────────────────────────────────────
  if (data.startsWith('fl:')) {
    const sid=data.slice(3), files=srvFiles(sid);
    if(!files.length){await safeEdit(chatId,msgId,'📭 *Server kosong.*',{parse_mode:'Markdown',reply_markup:kbBack(`rf:${sid}`)});return;}
    const txt=files.map((f,i)=>{let sz='';try{sz=` _${fmtSz(fs.statSync(path.join(srvDir(sid),f)).size)}_`;}catch(_){}return `${i+1}. ${icon(f)} \`${f}\`${sz}`;}).join('\n');
    await safeEdit(chatId,msgId,`📁 *File* (${files.length}):\n\n${txt}`,{parse_mode:'Markdown',reply_markup:kbBack(`rf:${sid}`)});
    return;
  }

  // ── kelola file ───────────────────────────────────
  if (data.startsWith('dm:')) {
    const sid=data.slice(3), files=srvFiles(sid);
    if(!files.length){bot.answerCallbackQuery(q.id,{text:'📭 Tidak ada file!'}).catch(()=>{});return;}
    const rows=files.slice(0,20).map(f=>[{text:`🗑 ${icon(f)} ${f}`,callback_data:`df:${sid}:${f}`}]);
    rows.push([{text:'🗑 Hapus SEMUA',callback_data:`da:${sid}`},{text:'🔙 Kembali',callback_data:`rf:${sid}`}]);
    await safeEdit(chatId,msgId,`🗑 *Pilih file hapus:*`,{parse_mode:'Markdown',reply_markup:{inline_keyboard:rows}});
    return;
  }
  if (data.startsWith('df:')) {
    const p2=data.indexOf(':',3), sid=data.slice(3,p2), file=data.slice(p2+1);
    safeUnlink(path.join(srvDir(sid),file));
    await safeEdit(chatId,msgId,`✅ *${file}* dihapus!\n\n${panelTxt(sid)}`,{parse_mode:'Markdown',reply_markup:kbSrv(sid)});
    return;
  }
  if (data.startsWith('da:')) {
    const sid=data.slice(3); killProc(sid);
    if(procs[sid]){procs[sid].proc=null;procs[sid].logs='';procs[sid].startedAt=null;}
    srvFiles(sid).forEach(f=>safeUnlink(path.join(srvDir(sid),f)));
    await safeEdit(chatId,msgId,`✅ *Semua file dihapus!*\n\n${panelTxt(sid)}`,{parse_mode:'Markdown',reply_markup:kbSrv(sid)});
    return;
  }

  // ── 🆕 referral page ──────────────────────────────
  if (data === 'referral') {
    await safeReply(chatId, msgId, refTxt(chatId), {
      parse_mode  : 'Markdown',
      reply_markup: { inline_keyboard:[
        [{ text:'📋 Cara Kerja Referral', callback_data:'ref_help' }],
        [{ text:'🔙 Menu Utama', callback_data:'home' }],
      ]},
    });
    return;
  }

  // ── 🆕 cara kerja referral ─────────────────────────
  if (data === 'ref_help') {
    await safeReply(chatId, msgId,
      `📖 *CARA KERJA REFERRAL*\n\n` +
      `*1️⃣ Salin link referral kamu*\n` +
      `Tekan tombol 🔗 Referral → copy link\n\n` +
      `*2️⃣ Bagikan ke teman*\n` +
      `Kirim ke teman di WA, Telegram, dll\n\n` +
      `*3️⃣ Teman klik link & join bot*\n` +
      `Teman klik linkmu → otomatis tercatat\n\n` +
      `*4️⃣ Dapat bonus otomatis!*\n` +
      `${REF_BONUS.map(t=>`🎁 Ajak *${t.ajak}* teman → *+${t.bonus} hari gratis*`).join('\n')}\n\n` +
      `⚠️ *Syarat:*\n` +
      `• Teman harus belum pernah join bot\n` +
      `• 1 teman = 1 referral (tidak bisa dobel)\n` +
      `• Bonus langsung aktif otomatis!`,
      { parse_mode:'Markdown', reply_markup:{ inline_keyboard:[
        [{ text:'🔗 Link Saya', callback_data:'referral' }],
        [{ text:'🔙 Menu',      callback_data:'home'     }],
      ]}}
    );
    return;
  }

  if (data.startsWith('ar:')) {
    const sid = data.slice(3);
    if (!procs[sid]) procs[sid] = { restartCount:0 };
    procs[sid].autoRestart = !procs[sid].autoRestart;
    const state = procs[sid].autoRestart ? '✅ Aktif' : '❌ Nonaktif';
    bot.answerCallbackQuery(q.id, { text:`🔁 Auto-Restart: ${state}` }).catch(()=>{});
    await safeEdit(chatId,msgId,panelTxt(sid),{parse_mode:'Markdown',reply_markup:kbSrv(sid)});
    return;
  }

  // ── statistik global ──────────────────────────────
  if (data === 'stats') {
    const st = await getStats();
    const totalUser    = Object.keys(DB.users).length;
    const totalPremium = Object.values(DB.users).filter(u=>u.role==='premium').length;
    const totalOwner   = Object.values(DB.users).filter(u=>u.role==='owner').length;
    const totalSrv     = Object.keys(DB.servers).length;
    const runningSrv   = Object.keys(DB.servers).filter(id=>isRunning(id)).length;
    const totalPaid    = Object.values(DB.invoices).filter(i=>i.status==='paid').length;
    const statsTxt =
      `📊 *STATISTIK BOT*\n\n` +
      `╔══════════════════════════════╗\n` +
      `║  💻 SISTEM                   ║\n` +
      `╠══════════════════════════════╣\n` +
      `║  ⚡ CPU    : ${st.cpu.padEnd(16)}       ║\n` +
      `║  💾 RAM    : ${st.ram.padEnd(16)}      ║\n` +
      `║  ⏱  Uptime : ${st.uptime.padEnd(16)}║\n` +
      `╠══════════════════════════════╣\n` +
      `║  👥 USER                       ║\n` +
      `╠══════════════════════════════╣\n` +
      `║  Total   : ${String(totalUser).padEnd(19)}║\n` +
      `║  Trial   : ${String(totalUser-totalPremium-totalOwner).padEnd(19)}║\n` +
      `║  Premium : ${String(totalPremium).padEnd(19)}║\n` +
      `║  Owner   : ${String(totalOwner).padEnd(19)}║\n` +
      `╠══════════════════════════════╣\n` +
      `║  🖥 SERVER                   ║\n` +
      `╠══════════════════════════════╣\n` +
      `║  Total   : ${String(totalSrv).padEnd(19)}         ║\n` +
      `║  Running : ${String(runningSrv).padEnd(19)}║\n` +
      `║  Stopped : ${String(totalSrv-runningSrv).padEnd(19)}║\n` +
      `╠══════════════════════════════╣\n` +
      `║  💰 Transaksi Sukses : ${String(totalPaid).padEnd(6)}║\n` +
      `╚══════════════════════════════╝`;
    await safeReply(chatId,msgId, statsTxt,
      {parse_mode:'Markdown',reply_markup:{inline_keyboard:[[{text:'🔄 Refresh',callback_data:'stats'},{text:'🔙 Menu',callback_data:'home'}]]}});
    return;
  }

  // ── statistik per server ──────────────────────────
  if (data.startsWith('sv:')) {
    const sid  = data.slice(3);
    const st   = await getStats();
    const files= srvFiles(sid);
    const totalSz = files.reduce((a,f)=>{try{return a+fs.statSync(path.join(srvDir(sid),f)).size;}catch(_){return a;}},0);
    const ps   = procs[sid];
    await safeEdit(chatId,msgId,
      `📊 *Statistik Server*\n\n` +
      `╔══════════════════════════════╗\n` +
      `║  🖥 ${(DB.servers[sid]?.name||sid).slice(0,25)}\n` +
      `╠══════════════════════════════╣\n` +
      `║  ⚡ CPU    : ${st.cpu.padEnd(16)}║\n` +
      `║  💾 RAM    : ${st.ram.padEnd(16)}║\n` +
      `║  ⏱  Uptime : ${st.uptime.padEnd(16)}║\n` +
      `╠══════════════════════════════╣\n` +
      `║  📁 File   : ${String(files.length).padEnd(19)}║\n` +
      `║  💿 Size   : ${fmtSz(totalSz).padEnd(19)}║\n` +
      `║  🔄 Restart: ${String(ps?.restartCount||0).padEnd(19)}║\n` +
      `║  🔁 Auto-RS: ${ps?.autoRestart?'✅ ON':'❌ OFF'.padEnd(16)}║\n` +
      `╚══════════════════════════════╝`,
      {parse_mode:'Markdown',reply_markup:{inline_keyboard:[[{text:'🔄 Refresh',callback_data:`sv:${sid}`},{text:'🔙 Panel',callback_data:`rf:${sid}`}]]}});
    return;
  }

  // ── riwayat bayar user ────────────────────────────
  if (data === 'history') {
    const myInv = Object.values(DB.invoices)
      .filter(i => i.userId === String(chatId))
      .sort((a,b) => b.createdAt - a.createdAt)
      .slice(0, 10);
    if (!myInv.length) {
      await safeReply(chatId,msgId,'📋 *Riwayat Bayar*\n\n_Belum ada transaksi._',
        {parse_mode:'Markdown',reply_markup:kbBack('home')});
      return;
    }
    const rows = myInv.map((i,n) => {
      const st  = i.status==='paid' ? '✅' : i.status==='expired' ? '⌛' : '⏳';
      const tgl = new Date(i.createdAt).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'2-digit'});
      return `${n+1}. ${st} ${i.nama} — Rp ${i.harga.toLocaleString('id-ID')} _(${tgl})_\n    🆔 \`${i.reffId||'-'}\``;
    }).join('\n');
    await safeReply(chatId,msgId,`📋 *Riwayat Transaksi*\n\n${rows}`,
      {parse_mode:'Markdown',reply_markup:kbBack('home')});
    return;
  }

  // ── broadcast (admin only) ────────────────────────
  if (data === 'A:bc' && isAdmin(chatId)) {
    broadcastSt[chatId] = { step:'msg' };
    await safeEdit(chatId,msgId,
      `📢 *BROADCAST ke Semua User*\n\nKirim pesan yang ingin dikirim.\n\n_Ketik /batal untuk membatalkan._`,
      {parse_mode:'Markdown',reply_markup:{inline_keyboard:[[{text:'❌ Batal',callback_data:'A:back'}]]}});
    return;
  }


  // ── statistik bot (admin) ─────────────────────────
  if (data === 'A:stat' && isAdmin(chatId)) {
    const st = await getStats();
    const totalUser    = Object.keys(DB.users).length;
    const totalPremium = Object.values(DB.users).filter(u=>u.role==='premium').length;
    const totalOwner   = Object.values(DB.users).filter(u=>u.role==='owner').length;
    const totalSrv     = Object.keys(DB.servers).length;
    const runningSrv   = Object.keys(DB.servers).filter(id=>isRunning(id)).length;
    const totalPaid    = Object.values(DB.invoices).filter(i=>i.status==='paid').length;
    await safeEdit(chatId, msgId,
      `📊 *STATISTIK BOT*\n\n` +
      `╔══════════════════════════════╗\n` +
      `║  💻 SISTEM                   ║\n` +
      `╠══════════════════════════════╣\n` +
      `║  ⚡ CPU    : ${st.cpu.padEnd(16)}║\n` +
      `║  💾 RAM    : ${st.ram.padEnd(16)}║\n` +
      `║  ⏱  Uptime : ${st.uptime.padEnd(16)}║\n` +
      `╠══════════════════════════════╣\n` +
      `║  👥 USER                     ║\n` +
      `╠══════════════════════════════╣\n` +
      `║  Total   : ${String(totalUser).padEnd(19)}║\n` +
      `║  Trial   : ${String(totalUser-totalPremium-totalOwner).padEnd(19)}║\n` +
      `║  Premium : ${String(totalPremium).padEnd(19)}║\n` +
      `║  Owner   : ${String(totalOwner).padEnd(19)}║\n` +
      `╠══════════════════════════════╣\n` +
      `║  🖥 SERVER                   ║\n` +
      `╠══════════════════════════════╣\n` +
      `║  Total   : ${String(totalSrv).padEnd(19)}║\n` +
      `║  Running : ${String(runningSrv).padEnd(19)}║\n` +
      `║  Stopped : ${String(totalSrv-runningSrv).padEnd(19)}║\n` +
      `╠══════════════════════════════╣\n` +
      `║  💰 Transaksi Sukses : ${String(totalPaid).padEnd(6)}║\n` +
      `╚══════════════════════════════╝`,
      {parse_mode:'Markdown', reply_markup:{inline_keyboard:[
        [{text:'🔄 Refresh',callback_data:'A:stat'},{text:'🔙 Admin',callback_data:'A:back'}],
      ]}}
    );
    return;
  }


  if (data.startsWith('cw:')) {
    const sid=data.slice(3); if(waSt[sid]){if(waSt[sid].codeTimer)clearTimeout(waSt[sid].codeTimer);Object.assign(waSt[sid],{phoneAsked:false,phoneSent:false,codeSent:false,codeTimer:null});}
    await safeEdit(chatId,msgId,'❌ WA pairing dibatalkan.'); return;
  }

  // ── pilih server (multi) ──────────────────────────
  if (data.startsWith('ut:')) {
    const sid=data.slice(3), pending=uploadQ[chatId]?.pendingMsg;
    if(!uploadQ[chatId]) uploadQ[chatId]={};
    uploadQ[chatId].serverId=sid;
    await safeEdit(chatId,msgId,`✅ Target: *${DB.servers[sid]?.name||sid}*`,{parse_mode:'Markdown'});
    if(pending){delete uploadQ[chatId].pendingMsg;const info=getFileInfo(pending);if(info)await doUpload(chatId,sid,info.fileId,info.fileName,info.fileSize);}
    return;
  }

  // ── new server ────────────────────────────────────
  if (data==='new_srv') {
    if(!isOwner(chatId)){bot.answerCallbackQuery(q.id,{text:'👑 Owner only!'}).catch(()=>{});return;}
    await safeEdit(chatId,msgId,'➕ *Buat Server Baru*\n\nKetik:\n`/buatserver NamaServer`\n\nContoh:\n`/buatserver BotWA1`',{parse_mode:'Markdown',reply_markup:kbBack('home')});
    return;
  }

  // ── help ──────────────────────────────────────────
  if (data==='help') {
    await safeReply(chatId,msgId,
      `📖 *PANDUAN CelestiaPanel*\n\n` +
      `*File Didukung:*\n` +
      `🟨 JS/TS (.js .mjs .ts .jsx .tsx)\n` +
      `🐍 Python (.py)\n` +
      `☕ Java (.java .jar .class)\n` +
      `🔵 Go · 🦀 Rust · 💎 Ruby · 🟣 PHP\n` +
      `🌙 Lua · ⚙️ Shell (.sh .bash)\n` +
      `📦 Arsip (.zip .tar.gz) → *auto extract*\n` +
      `🖼 Gambar, 🎵 Media, 📋 Data & semua file!\n\n` +
      `*Alur:*\n` +
      `1️⃣ /start → panel utama\n` +
      `2️⃣ Kirim file bot kamu\n` +
      `3️⃣ Bot auto-detect → saran command\n` +
      `4️⃣ Pilih command → langsung jalan!\n\n` +
      `*Bot WA Baileys:*\n` +
      `Upload → Install NPM → Run\n` +
      `→ Bot tanya nomor HP\n` +
      `→ Pairing code dikirim otomatis 🔑\n\n` +
      `*Referral:*\n` +
      `🔗 Ajak teman → bonus hari gratis!\n` +
      `Tekan tombol *Referral* di menu utama\n\n` +
      `*Owner:* \`/buatserver NamaServer\``,
      {parse_mode:'Markdown',reply_markup:kbBack('home')});
    return;
  }

  // ══ ADMIN ═════════════════════════════════════════
  if (!data.startsWith('A:')) return;
  if (!isAdmin(chatId)) return;
  const ac=data.slice(2), BK={inline_keyboard:[[{text:'🔙 Kembali',callback_data:'A:back'}]]};

  if(ac==='back'){await safeEdit(chatId,msgId,'🔧 *ADMIN PANEL*',{parse_mode:'Markdown',reply_markup:ADMKB});return;}
  if(ac==='lu'){const u=Object.values(DB.users).slice(0,50);await safeEdit(chatId,msgId,`👥 *User* (${u.length}):\n\n${u.map((v,i)=>`${i+1}. \`${v.id}\` | ${v.role} | ${isExpired(v)?'❌':sisaWaktu(v)}`).join('\n')||'Kosong'}`,{parse_mode:'Markdown',reply_markup:BK});return;}
  if(ac==='lp'){const u=Object.values(DB.users).filter(v=>v.role==='premium');await safeEdit(chatId,msgId,`💎 *Premium* (${u.length}):\n\n${u.map((v,i)=>`${i+1}. \`${v.id}\` | ${sisaWaktu(v)}`).join('\n')||'Kosong'}`,{parse_mode:'Markdown',reply_markup:BK});return;}
  if(ac==='lo'){const u=Object.values(DB.users).filter(v=>v.role==='owner');await safeEdit(chatId,msgId,`👑 *Owner* (${u.length}):\n\n${u.map((v,i)=>`${i+1}. \`${v.id}\` | ${sisaWaktu(v)} | ${getUserSrvs(v.id).length}/5`).join('\n')||'Kosong'}`,{parse_mode:'Markdown',reply_markup:BK});return;}
  if(ac==='li'){const inv=Object.values(DB.invoices).slice(-25);await safeEdit(chatId,msgId,`💰 *Invoice* (${inv.length}):\n\n${inv.map((v,i)=>`${i+1}. \`${v.userId}\` | ${v.planId} | *${v.status}*`).join('\n')||'Kosong'}`,{parse_mode:'Markdown',reply_markup:BK});return;}
  if(ac==='ap'){adminSt[chatId]={step:'id',role:'premium'};await safeEdit(chatId,msgId,'💎 *Add Premium*\n\nKirim ID Telegram user:',{parse_mode:'Markdown',reply_markup:BK});return;}
  if(ac==='ao'){adminSt[chatId]={step:'id',role:'owner'};await safeEdit(chatId,msgId,'👑 *Add Owner*\n\nKirim ID Telegram user:',{parse_mode:'Markdown',reply_markup:BK});return;}
  if(ac==='stop'){await safeEdit(chatId,msgId,'⏹ *Bot dihentikan.*');setTimeout(()=>process.exit(0),1000);return;}
});

// ══════════════════════════════════════════
//  GLOBAL ERROR HANDLER — bot tidak pernah crash
// ══════════════════════════════════════════
bot.on('polling_error', e => console.error('[Poll]', e.code||'', e.message?.slice(0,80)));
bot.on('error',         e => console.error('[Bot]',  e.message?.slice(0,80)));
process.on('uncaughtException',  e => console.error('[uncaughtException]', e.message, e.stack?.split('\n')[1]));
process.on('unhandledRejection', r => console.error('[unhandledRejection]', String(r).slice(0,150)));

// ══════════════════════════════════════════
//  GRACEFUL SHUTDOWN
// ══════════════════════════════════════════
function shutdown(sig) {
  console.log(`[${sig}] Shutdown...`);
  Object.keys(payWatch).forEach(stopPayWatcher);
  Object.keys(procs).forEach(killProc);
  if(_dbT){clearTimeout(_dbT);_dbT=null;}
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(DB,null,2)); } catch(_){}
  setTimeout(()=>process.exit(0), 800);
}
process.on('SIGTERM', ()=>shutdown('SIGTERM'));
process.on('SIGINT',  ()=>shutdown('SIGINT'));

// ══════════════════════════════════════════
//  START
// ══════════════════════════════════════════
bot.getMe().then(me => {
  BOT_USERNAME = me.username || 'CelestiaPanelBot';
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║    🌙 CelestiaPanel — Ultra Stable Edition          ║');
  console.log('║    All Files · Baileys Fix · QRIS · Referral        ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\n  🤖 Bot     : @${me.username}`);
  console.log(`  🔐 Admin   : ${ADMIN_ID || ' Belum diset!'}`);
  console.log(`  🐉 : ${process.env.ATLANTIC_API_KEY ? '🐉 OWNER' : '🐉 @xuantionzang'}`);
  console.log(`  💱 Metode  : ${process.env.ATLANTIC_METODE || 'qris'} / ${process.env.ATLANTIC_TYPE || 'ewallet'}`);
  console.log('\n  ✅ Bot aktif — semua file diterima!\n');
}).catch(e => {
  console.error('❌ Token salah:', e.message);
  process.exit(1);
});
