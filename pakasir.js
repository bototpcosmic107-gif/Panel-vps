// ================================================================
//   PAKASIR.JS — Modul QRIS Payment via Pakasir API
//   Docs: https://app.pakasir.com/docs
// ================================================================

import axios from "axios";

// ── Buat transaksi QRIS ───────────────────────────────────────
// amount   : nominal dalam Rupiah (integer)
// apiKey   : API Key dari halaman detail Proyek Pakasir
// project  : slug proyek kamu di Pakasir (isi di config.js)
// orderId  : ID unik transaksi (auto-generate kalau tidak diisi)
export async function createQRIS(amount, apiKey, project, orderId = null) {
  const order_id = orderId || `TRX-${Date.now()}`;
  const url = "https://app.pakasir.com/api/transactioncreate/qris";

  const { data } = await axios.post(
    url,
    {
      project,
      order_id,
      amount: parseInt(amount),
      api_key: apiKey,
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    }
  );

  // Response: { payment: { project, order_id, amount, fee, total_payment,
  //              payment_method, payment_number, expired_at } }
  if (!data?.payment) throw new Error(data?.message || "Gagal buat transaksi QRIS");

  return {
    order_id,
    project,
    amount: data.payment.amount,
    fee: data.payment.fee,
    total_payment: data.payment.total_payment,
    payment_number: data.payment.payment_number, // QR string
    expired_at: data.payment.expired_at,
  };
}

// ── Cek status pembayaran ─────────────────────────────────────
// GET https://app.pakasir.com/api/transactiondetail
//     ?project={slug}&amount={amount}&order_id={order_id}
export async function checkPayment(order_id, amount, apiKey, project) {
  const url = "https://app.pakasir.com/api/transactiondetail";

  const { data } = await axios.get(url, {
    params: { project, amount: parseInt(amount), order_id },
    headers: { "Content-Type": "application/json" },
    timeout: 15000,
  });

  // Response: { transaction: { amount, order_id, project, status, payment_method, completed_at } }
  if (!data?.transaction) throw new Error(data?.message || "Gagal cek status transaksi");

  const paid =
    data.transaction.status === "completed" ||
    data.transaction.status === "paid" ||
    data.transaction.status === "success";

  return { paid, status: data.transaction.status, data: data.transaction };
}

// ── Polling sampai lunas atau timeout ─────────────────────────
export async function waitForPayment(
  order_id,
  amount,
  apiKey,
  project,
  timeoutMs = 5 * 60 * 1000,
  intervalMs = 7000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { paid, data } = await checkPayment(order_id, amount, apiKey, project);
      if (paid) return { paid: true, data };
    } catch (_) {
      // Abaikan error sementara, lanjut polling
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { paid: false, data: null };
}
