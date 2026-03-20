import { ethers } from "ethers";
import { env } from "../config/env.js";
import prisma from "../config/db.js";
import { addQueuedJob, addCancelledJob, addExecutedJob } from "../queue/transactionQueue.js";
import { logger } from "../utils/logger.js";

const FACTORY_ABI = [
  "event WalletCreated(address indexed wallet, address indexed owner)",
];

const WALLET_ABI = [
  "event TransactionQueued(uint256 indexed txId, address indexed to, uint256 value, address token, uint256 executeAfter)",
  "event TransactionCancelled(uint256 indexed txId)",
  "event TransactionExecuted(uint256 indexed txId)",
];

const chains = [
  { name: "Sepolia", rpcUrl: env.RPC_URL,        factoryAddress: env.FACTORY_ADDRESS },
  { name: "XHAVIC",  rpcUrl: env.XHAVIC_RPC_URL,  factoryAddress: env.XHAVIC_FACTORY_ADDRESS },
];

const attachedWallets = new Set();

// ── WebSocket listener (Sepolia) ─────────────────────────────────────────────
function attachWalletListeners(walletAddress, provider) {
  const addr = walletAddress.toLowerCase();
  if (attachedWallets.has(addr)) return;
  attachedWallets.add(addr);

  const contract = new ethers.Contract(addr, WALLET_ABI, provider);

  contract.on("TransactionQueued", async (txId, to, value, token, executeAfter) => {
    logger.info(`TransactionQueued | wallet: ${addr} | txId: ${txId}`);
    await addQueuedJob({ txId: txId.toString(), walletAddress: addr, toAddress: to, value: value.toString(), token, executeAfter: executeAfter.toString() });
  });

  contract.on("TransactionCancelled", async (txId) => {
    logger.info(`TransactionCancelled | wallet: ${addr} | txId: ${txId}`);
    await addCancelledJob({ txId: txId.toString(), walletAddress: addr });
  });

  contract.on("TransactionExecuted", async (txId) => {
    logger.info(`TransactionExecuted | wallet: ${addr} | txId: ${txId}`);
    await addExecutedJob({ txId: txId.toString(), walletAddress: addr });
  });

  logger.success(`Listening to wallet: ${addr}`);
}

async function connectWss(chain) {
  const provider = new ethers.WebSocketProvider(chain.rpcUrl);

  provider.websocket.on("close", () => {
    logger.warn(`[${chain.name}] WebSocket disconnected — reconnecting in 5s...`);
    attachedWallets.clear();
    setTimeout(() => connectWss(chain), 5000);
  });

  provider.websocket.on("error", (err) => {
    logger.error(`[${chain.name}] WebSocket error: ${err.message}`);
  });

  await provider.ready;
  logger.success(`[${chain.name}] Provider connected (WebSocket)`);

  const wallets = await prisma.wallet.findMany();
  for (const w of wallets) attachWalletListeners(w.walletAddress, provider);

  const factory = new ethers.Contract(chain.factoryAddress, FACTORY_ABI, provider);
  factory.on("WalletCreated", async (walletAddress, ownerAddress) => {
    logger.info(`[${chain.name}] New wallet | wallet: ${walletAddress} | owner: ${ownerAddress}`);
    attachWalletListeners(walletAddress, provider);
  });

  logger.success(`[${chain.name}] Factory listener active: ${chain.factoryAddress}`);
}

// ── HTTP manual polling (XHAVIC) ─────────────────────────────────────────────
const POLL_INTERVAL_MS = 5000;
const httpLastBlock     = {};
const httpWalletSet     = new Set();

async function pollChain(chain) {
  const provider = new ethers.JsonRpcProvider(chain.rpcUrl);

  // Test connection
  try {
    await provider.getBlockNumber();
    logger.success(`[${chain.name}] Provider connected (HTTP polling)`);
  } catch (err) {
    logger.error(`[${chain.name}] HTTP connection failed: ${err.message} — retrying in 10s`);
    setTimeout(() => pollChain(chain), 10000);
    return;
  }

  // Load existing wallets
  const wallets = await prisma.wallet.findMany();
  for (const w of wallets) httpWalletSet.add(w.walletAddress.toLowerCase());
  logger.success(`[${chain.name}] Factory listener active: ${chain.factoryAddress}`);

  // Set start block
  const currentBlock = await provider.getBlockNumber();
  httpLastBlock[chain.name] = currentBlock;

  const walletIface  = new ethers.Interface(WALLET_ABI);
  const factoryIface = new ethers.Interface(FACTORY_ABI);

  // Poll loop
  setInterval(async () => {
    try {
      const latest   = await provider.getBlockNumber();
      const fromBlock = httpLastBlock[chain.name] + 1;
      if (fromBlock > latest) return;

      // Check for new wallets from factory
      const factoryLogs = await provider.getLogs({
        address:   chain.factoryAddress,
        fromBlock,
        toBlock:   latest,
        topics:    [factoryIface.getEvent("WalletCreated").topicHash],
      });

      for (const log of factoryLogs) {
        try {
          const parsed = factoryIface.parseLog(log);
          const addr   = parsed.args.wallet.toLowerCase();
          if (!httpWalletSet.has(addr)) {
            httpWalletSet.add(addr);
            logger.info(`[${chain.name}] New wallet detected | wallet: ${addr}`);
          }
        } catch (_) {}
      }

      // Check TransactionQueued / Cancelled / Executed for all known wallets
      if (httpWalletSet.size > 0) {
        const walletLogs = await provider.getLogs({
          address:   [...httpWalletSet],
          fromBlock,
          toBlock:   latest,
        });

        for (const log of walletLogs) {
          const walletAddr = log.address.toLowerCase();
          try {
            const parsed = walletIface.parseLog(log);

            if (parsed.name === "TransactionQueued") {
              const { txId, to, value, token, executeAfter } = parsed.args;
              logger.info(`[${chain.name}] TransactionQueued | wallet: ${walletAddr} | txId: ${txId}`);
              await addQueuedJob({ txId: txId.toString(), walletAddress: walletAddr, toAddress: to, value: value.toString(), token, executeAfter: executeAfter.toString() });

            } else if (parsed.name === "TransactionCancelled") {
              const { txId } = parsed.args;
              logger.info(`[${chain.name}] TransactionCancelled | wallet: ${walletAddr} | txId: ${txId}`);
              await addCancelledJob({ txId: txId.toString(), walletAddress: walletAddr });

            } else if (parsed.name === "TransactionExecuted") {
              const { txId } = parsed.args;
              logger.info(`[${chain.name}] TransactionExecuted | wallet: ${walletAddr} | txId: ${txId}`);
              await addExecutedJob({ txId: txId.toString(), walletAddress: walletAddr });
            }
          } catch (_) {}
        }
      }

      httpLastBlock[chain.name] = latest;
    } catch (err) {
      logger.error(`[${chain.name}] Poll error: ${err.message}`);
    }
  }, POLL_INTERVAL_MS);
}

export async function startListener() {
  const wallets = await prisma.wallet.findMany();
  logger.info(`Loaded ${wallets.length} existing wallets from DB`);

  for (const chain of chains) {
    if (chain.rpcUrl.startsWith("wss://")) {
      await connectWss(chain);
    } else {
      await pollChain(chain);
    }
  }
}
