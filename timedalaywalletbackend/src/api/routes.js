import { Router } from "express";
import { ethers } from "ethers";
import prisma from "../config/db.js";
import { logger } from "../utils/logger.js";

const router = Router();

// ─── POST /api/wallet/register ──────────────────────────────────────────────
// Register wallet + email in DB (called by frontend after createWallet())
router.post("/wallet/register", async (req, res) => {
  try {
    const { walletAddress, ownerAddress, email } = req.body;

    if (!walletAddress || !ownerAddress || !email) {
      return res.status(400).json({ success: false, message: "walletAddress, ownerAddress and email are required" });
    }

    if (!ethers.isAddress(walletAddress) || !ethers.isAddress(ownerAddress)) {
      return res.status(400).json({ success: false, message: "Invalid Ethereum address" });
    }

    if (!email.includes("@")) {
      return res.status(400).json({ success: false, message: "Invalid email address" });
    }

    const wallet = await prisma.wallet.upsert({
      where:  { walletAddress: walletAddress.toLowerCase() },
      update: { ownerAddress: ownerAddress.toLowerCase(), email },
      create: { walletAddress: walletAddress.toLowerCase(), ownerAddress: ownerAddress.toLowerCase(), email },
    });

    logger.success(`Wallet registered | wallet: ${walletAddress} | email: ${email}`);
    return res.status(200).json({ success: true, message: "Wallet registered successfully", wallet });

  } catch (err) {
    logger.error(`POST /wallet/register → ${err.message}`);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /api/wallet/:ownerAddress ──────────────────────────────────────────
// Get all wallets for an EOA owner
router.get("/wallet/:ownerAddress", async (req, res) => {
  try {
    const { ownerAddress } = req.params;

    if (!ethers.isAddress(ownerAddress)) {
      return res.status(400).json({ success: false, message: "Invalid Ethereum address" });
    }

    const wallets = await prisma.wallet.findMany({
      where: { ownerAddress: ownerAddress.toLowerCase() },
    });

    return res.status(200).json({ success: true, wallets });

  } catch (err) {
    logger.error(`GET /wallet/:ownerAddress → ${err.message}`);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /api/transactions/:walletAddress ────────────────────────────────────
// Get all transactions for a wallet
router.get("/transactions/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ success: false, message: "Invalid wallet address" });
    }

    const transactions = await prisma.transaction.findMany({
      where:   { walletAddress: walletAddress.toLowerCase() },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({ success: true, transactions });

  } catch (err) {
    logger.error(`GET /transactions/:walletAddress → ${err.message}`);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ─── GET /cancel/:wallet/:txId ──────────────────────────────────────────────
router.get("/cancel/:wallet/:txId", async (req, res) => {
  const { wallet, txId } = req.params;
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Cancel Transaction</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;background:#fff0f0;display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .card{background:#fff;padding:40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);max-width:520px;width:90%;text-align:center;}
    h1{color:#e74c3c;margin:16px 0 8px;}
    .info{background:#f8f8f8;border-radius:8px;padding:16px;margin:20px 0;text-align:left;font-size:14px;color:#333;word-break:break-all;line-height:1.8;}
    .warn{background:#fff3f3;border:1px solid #ffcccc;border-radius:8px;padding:12px;color:#cc0000;font-size:13px;margin-bottom:20px;}
    button{background:#e74c3c;color:#fff;border:none;padding:16px 40px;border-radius:8px;font-size:17px;font-weight:bold;cursor:pointer;width:100%;}
    button:disabled{background:#aaa;cursor:not-allowed;}
    #status{margin-top:16px;font-size:14px;color:#555;}
    a{color:#e74c3c;font-size:13px;}
  </style>
</head>
<body>
<div class="card">
  <div style="font-size:56px;">🚫</div>
  <h1>Cancel Transaction</h1>
  <p style="color:#555;margin-bottom:20px;">Connect your wallet and click Cancel to stop this transaction.</p>
  <div class="info">
    <b>Wallet:</b> ${wallet}<br>
    <b>Transaction ID:</b> #${txId}
  </div>
  <div class="warn">⚠️ Commission fee is non-refundable even after cancellation.</div>
  <button id="btn" onclick="doCancel()">Connect Wallet &amp; Cancel</button>
  <div id="status"></div>
</div>
<script>
const WALLET = "${wallet}";
const TX_ID  = ${txId};
const ABI    = ["function cancelTransaction(uint256 txId) external"];

async function doCancel() {
  const btn = document.getElementById("btn");
  const status = document.getElementById("status");
  try {
    if (!window.ethereum) { status.textContent = "MetaMask not found."; return; }
    btn.disabled = true; btn.textContent = "Connecting...";
    await window.ethereum.request({ method: "eth_requestAccounts" });
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer   = await provider.getSigner();
    const contract = new ethers.Contract(WALLET, ABI, signer);
    btn.textContent = "Confirm in MetaMask...";
    status.textContent = "Please confirm the transaction in MetaMask.";
    const tx = await contract.cancelTransaction(TX_ID);
    status.textContent = "Waiting for confirmation...";
    await tx.wait();
    btn.textContent = "Cancelled!";
    btn.style.background = "#27AE60";
    status.innerHTML = "Transaction cancelled successfully.<br><small>Tx: " + tx.hash + "</small>";
  } catch (err) {
    btn.disabled = false; btn.textContent = "Connect Wallet & Cancel";
    status.textContent = "Error: " + (err.reason || err.message);
  }
}
</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.umd.min.js"></script>
</body>
</html>`);
});

// ─── GET /execute/:wallet/:txId ─────────────────────────────────────────────
router.get("/execute/:wallet/:txId", async (req, res) => {
  const { wallet, txId } = req.params;
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Execute Transaction</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;background:#f0fff4;display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .card{background:#fff;padding:40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);max-width:520px;width:90%;text-align:center;}
    h1{color:#27AE60;margin:16px 0 8px;}
    .info{background:#f8f8f8;border-radius:8px;padding:16px;margin:20px 0;text-align:left;font-size:14px;color:#333;word-break:break-all;line-height:1.8;}
    button{background:#27AE60;color:#fff;border:none;padding:16px 40px;border-radius:8px;font-size:17px;font-weight:bold;cursor:pointer;width:100%;}
    button:disabled{background:#aaa;cursor:not-allowed;}
    #status{margin-top:16px;font-size:14px;color:#555;}
  </style>
</head>
<body>
<div class="card">
  <div style="font-size:56px;">🚀</div>
  <h1>Execute Transaction</h1>
  <p style="color:#555;margin-bottom:20px;">The security delay has passed. Connect your wallet and execute.</p>
  <div class="info">
    <b>Wallet:</b> ${wallet}<br>
    <b>Transaction ID:</b> #${txId}
  </div>
  <button id="btn" onclick="doExecute()">Connect Wallet &amp; Execute</button>
  <div id="status"></div>
</div>
<script>
const WALLET = "${wallet}";
const TX_ID  = ${txId};
const ABI    = ["function executeTransaction(uint256 txId) external"];

async function doExecute() {
  const btn = document.getElementById("btn");
  const status = document.getElementById("status");
  try {
    if (!window.ethereum) { status.textContent = "MetaMask not found."; return; }
    btn.disabled = true; btn.textContent = "Connecting...";
    await window.ethereum.request({ method: "eth_requestAccounts" });
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer   = await provider.getSigner();
    const contract = new ethers.Contract(WALLET, ABI, signer);
    btn.textContent = "Confirm in MetaMask...";
    status.textContent = "Please confirm the transaction in MetaMask.";
    const tx = await contract.executeTransaction(TX_ID);
    status.textContent = "Waiting for confirmation...";
    await tx.wait();
    btn.textContent = "Executed!";
    btn.style.background = "#2980b9";
    status.innerHTML = "Transaction executed successfully.<br><small>Tx: " + tx.hash + "</small>";
  } catch (err) {
    btn.disabled = false; btn.textContent = "Connect Wallet & Execute";
    status.textContent = "Error: " + (err.reason || err.message);
  }
}
</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.umd.min.js"></script>
</body>
</html>`);
});

export default router;
