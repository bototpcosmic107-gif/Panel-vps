'use strict';
// ══════════════════════════════════════════════════════════════
//  CELESTIAPANEL — PAYMENT MODULE (Atlantic H2H)
//  - Generate QR dari qr_string (bukan download, karena 403)
//  - Cloudflare bypass dengan proper headers
//  - QR expire 3 menit (hardcode karena Atlantic pakai 480 menit)
//
//  ENV:
//    ATLANTIC_API_KEY = API Key dari dashboard Atlantic H2H
//    ATLANTIC_METODE  = metode pembayaran (default: qris)
//    ATLANTIC_TYPE    = tipe deposit (default: ewallet)
// ══════════════════════════════════════════════════════════════

const https = require('https');
const zlib  = require('zlib');
const fs    = require('fs');
const path  = require('path');

const API_KEY  = process.env.ATLANTIC_API_KEY || 'G9WWnZUFlY43ZB9JG4U70RQ2KGx9L0dQMlLp2eFBhAmf5AjQjUOT1BfaqKTgItdcABZO07MJA6DfkydFW1ZZ1BXDbMJoQrldDrvt';
const METODE   = process.env.ATLANTIC_METODE  || 'qris';
const TYPE     = process.env.ATLANTIC_TYPE    || 'ewallet';
const BASE     = 'atlantich2h.com';
const QR_TTL   = 3 * 60_000; // 3 menit timeout lokal

// ── Generate order ID unik ──────────────────────────────────
function genOrderId() {
  const d = new Date();
  return 'VPS' + [
    d.getFullYear(),
    String(d.getMonth()+1).padStart(2,'0'),
    String(d.getDate()).padStart(2,'0'),
    String(d.getHours()).padStart(2,'0'),
    String(d.getMinutes()).padStart(2,'0'),
  ].join('') + Math.random().toString(36).slice(2,8).toUpperCase();
}

// ── POST request ke Atlantic H2H ───────────────────────────
function postForm(endpoint, params, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();

    const options = {
      hostname : BASE,
      port     : 443,
      path     : endpoint,
      method   : 'POST',
      headers  : {
        'Content-Type'      : 'application/x-www-form-urlencoded',
        'Content-Length'    : Buffer.byteLength(body),
        'User-Agent'        : 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.210 Mobile Safari/537.36',
        'Accept'            : 'application/json, text/plain, */*',
        'Accept-Language'   : 'id-ID,id;q=0.9',
        'Accept-Encoding'   : 'gzip, deflate',
        'Origin'            : `https://${BASE}`,
        'Referer'           : `https://${BASE}/`,
        'Connection'        : 'keep-alive',
        'Cache-Control'     : 'no-cache',
        'Pragma'            : 'no-cache',
        'X-Requested-With'  : 'XMLHttpRequest',
      },
    };

    let req;
    const timer = setTimeout(() => {
      try { req.destroy(); } catch(_) {}
      reject(new Error('Timeout koneksi ke server payment'));
    }, timeoutMs);

    req = https.request(options, res => {
      const encoding = res.headers['content-encoding'] || '';
      let stream = res;

      if (encoding.includes('gzip')) {
        stream = res.pipe(zlib.createGunzip());
      } else if (encoding.includes('deflate')) {
        stream = res.pipe(zlib.createInflate());
      }

      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => {
        clearTimeout(timer);
        const raw = Buffer.concat(chunks).toString('utf8').trim();

        // Cek Cloudflare block
        if (raw.startsWith('<!') || raw.includes('Just a moment') || raw.includes('cf-browser-verification')) {
          return reject(new Error(
            'Server payment diblokir Cloudflare.\n' +
            'Silakan hubungi Atlantic H2H support untuk whitelist IP server:\n' +
            '146.190.86.105'
          ));
        }

        // Cek empty response
        if (!raw) return reject(new Error('Response kosong dari server payment'));

        try {
          resolve(JSON.parse(raw));
        } catch(_) {
          reject(new Error('Format response tidak valid: ' + raw.slice(0, 150)));
        }
      });
      stream.on('error', e => { clearTimeout(timer); reject(e); });
    });

    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.write(body);
    req.end();
  });
}

// ── Buat deposit QRIS ke Atlantic H2H ──────────────────────
async function createDeposit(reffId, nominal) {
  if (!API_KEY) throw new Error('ATLANTIC_API_KEY belum diset di Pterodactyl ENV!');

  const json = await postForm('/deposit/create', {
    api_key : API_KEY,
    reff_id : reffId,
    nominal : String(nominal),
    type    : TYPE,
    metode  : METODE,
  });

  if (!json.status && !json.data) {
    throw new Error(json.message || json.msg || 'Gagal membuat deposit: ' + JSON.stringify(json).slice(0,150));
  }

  return json.data || json;
}

// ── Cek status deposit ──────────────────────────────────────
async function checkStatus(reffId) {
  if (!API_KEY) return null;
  try {
    return await postForm('/deposit/status', {
      api_key : API_KEY,
      reff_id : reffId,
    }, 10000);
  } catch(_) { return null; }
}

// ── Cek sudah bayar ─────────────────────────────────────────
function isPaid(obj) {
  if (!obj) return false;
  const d = obj.data || obj;
  const s = String(d.status || obj.status || '').toLowerCase().trim();
  return ['success','paid','settlement','completed','berhasil'].includes(s);
}

// ── Cek expired ─────────────────────────────────────────────
function isExpired(obj) {
  if (!obj) return false;
  const d = obj.data || obj;
  const s = String(d.status || obj.status || '').toLowerCase().trim();
  return s === 'expired';
}

// ── Generate foto QR dari qr_string ────────────────────────
async function generateQrisImage(qrString, tmpDir) {
  if (!qrString) throw new Error('qr_string kosong dari server payment');

  let QRCode;
  try {
    QRCode = require('qrcode');
  } catch(_) {
    throw new Error('Module qrcode belum terinstall. Jalankan npm install');
  }

  const tmp = path.join(tmpDir, '_qris_' + Date.now() + '.png');

  await QRCode.toFile(tmp, qrString, {
    type                : 'png',
    width               : 600,
    margin              : 3,
    color               : { dark:'#000000', light:'#FFFFFF' },
    errorCorrectionLevel: 'M',
  });

  return tmp;
}

// ── Buat invoice & simpan ke DB ─────────────────────────────
async function createInvoice(db, userId, planId, plans) {
  const plan = plans[planId];
  if (!plan) throw new Error('Plan tidak valid: ' + planId);

  const reffId = genOrderId();
  const data   = await createDeposit(reffId, plan.harga);

  if (!data.qr_string && !data.qr_image) {
    throw new Error('Server payment tidak mengembalikan data QR. Cek API Key.');
  }

  if (!db.invoices) db.invoices = {};

  // Hitung expiry: pakai dari Atlantic atau fallback 3 menit
  const expiredAt = data.expired_at || null;
  let expireTs = Date.now() + QR_TTL; // default 3 menit
  if (expiredAt) {
    try {
      const ts = new Date(expiredAt).getTime();
      if (ts > Date.now()) expireTs = ts;
    } catch(_) {}
  }

  db.invoices[reffId] = {
    reffId,
    userId    : String(userId),
    planId,
    harga     : plan.harga,
    nama      : plan.nama,
    status    : 'pending',
    qrString  : data.qr_string  || '',
    qrImage   : data.qr_image   || '',
    atlanticId: data.id         || '',
    expiredAt : expiredAt,
    expireTs,                          // timestamp ms untuk timer lokal
    createdAt : Date.now(),
  };

  return db.invoices[reffId];
}

function safeUnlink(p) { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch(_){} }
function cleanTmp(p)   { safeUnlink(p); }

module.exports = {
  QR_TTL,
  genOrderId,
  createDeposit,
  checkStatus,
  isPaid,
  isExpired,
  createInvoice,
  generateQrisImage,
  cleanTmp,
  safeUnlink,
};
