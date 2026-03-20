import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

const transporter = nodemailer.createTransport({
  host:   env.SMTP_HOST,
  port:   env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false },
});

function formatAddress(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatEther(value) {
  try {
    const val = BigInt(value);
    return (Number(val) / 1e18).toFixed(6);
  } catch {
    return value;
  }
}

function formatTime(unixTimestamp) {
  return new Date(Number(unixTimestamp) * 1000).toUTCString();
}

export async function sendCancelEmail({ email, walletAddress, txId, toAddress, value, token, executeAfter }) {
  const cancelLink  = `${env.FRONTEND_URL}/cancel/${walletAddress}/${txId}`;
  const isNative    = token === "0x0000000000000000000000000000000000000000";
  const amountLabel = isNative ? `${formatEther(value)} ETH` : `${formatEther(value)} TOKEN`;

  const html = `
  <!DOCTYPE html>
  <html>
  <head><meta charset="UTF-8"></head>
  <body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px;">
    <div style="max-width:600px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">

      <div style="background:#FF4444;padding:30px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:24px;">⚠️ Transaction Queued</h1>
        <p style="color:#ffe0e0;margin:8px 0 0;">Action Required — Review Before Execution</p>
      </div>

      <div style="padding:30px;">
        <p style="color:#333;font-size:16px;">A transaction has been queued from your Time-Secure Wallet. Review the details below and cancel if this was not you.</p>

        <div style="background:#f8f8f8;border-radius:8px;padding:20px;margin:20px 0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#666;font-size:14px;">Wallet Address</td><td style="padding:8px 0;color:#333;font-weight:bold;font-size:14px;word-break:break-all;">${walletAddress}</td></tr>
            <tr><td style="padding:8px 0;color:#666;font-size:14px;">Transaction ID</td><td style="padding:8px 0;color:#333;font-weight:bold;font-size:14px;">#${txId}</td></tr>
            <tr><td style="padding:8px 0;color:#666;font-size:14px;">Sending To</td><td style="padding:8px 0;color:#333;font-weight:bold;font-size:14px;word-break:break-all;">${toAddress}</td></tr>
            <tr><td style="padding:8px 0;color:#666;font-size:14px;">Amount</td><td style="padding:8px 0;color:#333;font-weight:bold;font-size:14px;">${amountLabel}</td></tr>
            <tr><td style="padding:8px 0;color:#666;font-size:14px;">Executes After</td><td style="padding:8px 0;color:#e74c3c;font-weight:bold;font-size:14px;">${formatTime(executeAfter)}</td></tr>
          </table>
        </div>

        <div style="background:#fff3f3;border:1px solid #ffcccc;border-radius:8px;padding:15px;margin:20px 0;">
          <p style="color:#cc0000;margin:0;font-size:14px;">⚠️ <strong>Note:</strong> The platform commission fee is non-refundable even if you cancel this transaction.</p>
        </div>

        <div style="text-align:center;margin:30px 0;">
          <a href="${cancelLink}" style="background:#FF4444;color:#fff;padding:16px 40px;border-radius:8px;text-decoration:none;font-size:18px;font-weight:bold;display:inline-block;">🚫 Cancel Transaction</a>
        </div>

        <p style="color:#999;font-size:13px;text-align:center;">If you initiated this transaction, ignore this email. It will execute automatically after the security delay.</p>
      </div>

      <div style="background:#f4f4f4;padding:15px;text-align:center;">
        <p style="color:#aaa;font-size:12px;margin:0;">Time-Secure Wallet — Powered by Smart Contract Security</p>
      </div>
    </div>
  </body>
  </html>`;

  await transporter.sendMail({
    from:    env.EMAIL_FROM,
    to:      email,
    subject: `TD Wallet Alert: Transaction #${txId} queued - review required`,
    html,
    text: `A transaction has been queued from your Time-Delay Wallet.\n\nWallet: ${walletAddress}\nTx ID: #${txId}\nTo: ${toAddress}\nAmount: ${amountLabel}\nExecutes After: ${formatTime(executeAfter)}\n\nIf you did not initiate this, cancel it before the delay expires.`,
  });

  logger.success(`Cancel email sent → ${email} | txId: ${txId}`);
}

export async function sendExecuteEmail({ email, walletAddress, txId, toAddress, value, token }) {
  const executeLink = `${env.FRONTEND_URL}/execute/${walletAddress}/${txId}`;
  const isNative    = token === "0x0000000000000000000000000000000000000000";
  const amountLabel = isNative ? `${formatEther(value)} ETH` : `${formatEther(value)} TOKEN`;

  const html = `
  <!DOCTYPE html>
  <html>
  <head><meta charset="UTF-8"></head>
  <body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:20px;">
    <div style="max-width:600px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">

      <div style="background:#27AE60;padding:30px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:24px;">✅ Ready to Execute</h1>
        <p style="color:#d5f5e3;margin:8px 0 0;">Your 24-hour security delay has passed</p>
      </div>

      <div style="padding:30px;">
        <p style="color:#333;font-size:16px;">Your queued transaction is now ready to execute. Click the button below to proceed.</p>

        <div style="background:#f8f8f8;border-radius:8px;padding:20px;margin:20px 0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#666;font-size:14px;">Wallet Address</td><td style="padding:8px 0;color:#333;font-weight:bold;font-size:14px;word-break:break-all;">${walletAddress}</td></tr>
            <tr><td style="padding:8px 0;color:#666;font-size:14px;">Transaction ID</td><td style="padding:8px 0;color:#333;font-weight:bold;font-size:14px;">#${txId}</td></tr>
            <tr><td style="padding:8px 0;color:#666;font-size:14px;">Sending To</td><td style="padding:8px 0;color:#333;font-weight:bold;font-size:14px;word-break:break-all;">${toAddress}</td></tr>
            <tr><td style="padding:8px 0;color:#666;font-size:14px;">Amount</td><td style="padding:8px 0;color:#27AE60;font-weight:bold;font-size:14px;">${amountLabel}</td></tr>
          </table>
        </div>

        <div style="text-align:center;margin:30px 0;">
          <a href="${executeLink}" style="background:#27AE60;color:#fff;padding:16px 40px;border-radius:8px;text-decoration:none;font-size:18px;font-weight:bold;display:inline-block;">🚀 Execute Transaction</a>
        </div>

        <p style="color:#999;font-size:13px;text-align:center;">You must sign the transaction with your wallet to complete the transfer.</p>
      </div>

      <div style="background:#f4f4f4;padding:15px;text-align:center;">
        <p style="color:#aaa;font-size:12px;margin:0;">Time-Secure Wallet — Powered by Smart Contract Security</p>
      </div>
    </div>
  </body>
  </html>`;

  await transporter.sendMail({
    from:    env.EMAIL_FROM,
    to:      email,
    subject: `TD Wallet: Transaction #${txId} is ready to execute`,
    html,
    text: `Your queued transaction is now ready to execute.\n\nWallet: ${walletAddress}\nTx ID: #${txId}\nTo: ${toAddress}\nAmount: ${amountLabel}\n\nOpen your wallet app and call executeTransaction(${txId}) to complete the transfer.`,
  });

  logger.success(`Execute email sent → ${email} | txId: ${txId}`);
}
