# Time Secure Wallet (TS Wallet) — Complete Integration Guide

> This document is the single source of truth for app developers and AI assistants
> integrating with the TS Wallet smart contract system.
> Read this file completely before writing any frontend or backend code.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Deployed Contracts](#2-deployed-contracts)
3. [Architecture](#3-architecture)
4. [Roles & Permissions](#4-roles--permissions)
5. [Commission / Fee System](#5-commission--fee-system)
6. [Transaction Lifecycle](#6-transaction-lifecycle)
7. [WalletFactory — All Functions](#7-walletfactory--all-functions)
8. [TimeDelayWallet — All Functions](#8-timedelaywallet--all-functions)
9. [All Events](#9-all-events)
10. [Complete ABIs](#10-complete-abis)
11. [Frontend Integration — Step by Step](#11-frontend-integration--step-by-step)
12. [Error Reference](#12-error-reference)
13. [Security Rules](#13-security-rules)

---

## 1. System Overview

TS Wallet is a smart contract wallet system where:

- Every user gets their own independent smart contract wallet
- All transactions are time-locked for 24 hours (security delay)
- A platform commission (1%) is charged at the time of queuing
- The receiver always gets the full requested amount
- Users can cancel a transaction within the 24-hour window
- After 24 hours, only execute is possible (cancel is blocked)

**Why time delay?**
If a user's device is compromised and an attacker queues a transaction,
the user has 24 hours to detect it and cancel before funds leave.

---

## 2. Deployed Contracts

```
Network           : Sepolia Testnet
Chain ID          : 11155111

Implementation    : 0xA5145cf92C00fe5cff4aa46f77e63dc430a38b00
WalletFactory     : 0xFE6327aeCAeF8Ddb3E0CA8AEc61FBDCFE735A1CA
platformAdmin EOA : 0x929f950c6DD3DD4A6E69337c69A469517187c5af
```

> NOTE FOR DEVELOPER:
> You only need WalletFactory address for ALL user interactions.
> Implementation address is internal — never expose it to users.
> Each user's wallet address is different and discovered via getWallets().

---

## 3. Architecture

```
                        WalletFactory
                       (one contract)
                            |
              createWallet() called by user
                            |
              deploys EIP-1167 minimal proxy clone
                            |
                  calls initialize(owner, platformAdmin)
                            |
                   User's TimeDelayWallet
                    (unique per user)
                            |
              ┌─────────────┼─────────────┐
          queueTx      cancelTx      executeTx
```

**EIP-1167 Clone Pattern:**
- One implementation contract holds all logic
- Each user gets a cheap clone (~45k gas vs ~1M gas for full deploy)
- Each clone has completely separate storage (balances, transactions)
- All clones share the same logic but are fully independent

---

## 4. Roles & Permissions

```
┌─────────────────┬──────────────────────────────────────────────────┐
│ Role            │ Can Do                                           │
├─────────────────┼──────────────────────────────────────────────────┤
│ owner           │ queueTransaction, executeTransaction,            │
│ (wallet user)   │ cancelTransaction, transferOwnership,            │
│                 │ acceptOwnership, rescueToken                     │
├─────────────────┼──────────────────────────────────────────────────┤
│ platformAdmin   │ updateFee, updatePlatformAdmin                   │
│ (platform)      │ Also receives all commission fees                │
└─────────────────┴──────────────────────────────────────────────────┘
```

- owner and platformAdmin are completely separate roles
- owner CANNOT change fees
- platformAdmin CANNOT queue, execute, or cancel transactions
- platformAdmin IS the fee recipient (same address)

---

## 5. Commission / Fee System

```
Fee rate         : 1% (100 basis points)
Maximum fee      : 5% (500 basis points) — platform can change
Fee denominator  : 10000

Formula:
    fee          = value × feeBps / 10000
    totalRequired = value + fee

Example (sending 1 ETH):
    fee          = 1 ETH × 100 / 10000 = 0.01 ETH
    totalRequired = 1.01 ETH (wallet must hold this)
    receiver gets = 1.00 ETH (full amount, no deduction)
    platform gets = 0.01 ETH (at queue time)
```

**Critical rules:**
- Fee is charged AT QUEUE TIME, not at execute time
- Fee is NON-REFUNDABLE — if user cancels, fee is gone
- Receiver always gets the FULL value, never reduced by fee
- Wallet must hold (value + fee) before queueing or it reverts

---

## 6. Transaction Lifecycle

```
State diagram of every transaction:

[QUEUED] ──── within 24h ────► [CANCELLED]  (fee lost)
   │
   │ after 24h
   ▼
[EXECUTABLE] ──────────────► [EXECUTED]     (receiver gets full amount)

Rules:
- Cancel only works BEFORE 24h delay expires
- Execute only works AFTER 24h delay expires
- Once executed, cannot cancel
- Once cancelled, cannot execute
- No automatic execution — owner must call executeTransaction()
```

---

## 7. WalletFactory — All Functions

### `createWallet()`
Creates a new TS Wallet for the caller.

```
Type     : transaction (costs gas)
Caller   : any EOA (the user)
Returns  : address — the new wallet address

What it does:
1. Deploys a clone of the implementation
2. Initializes it with msg.sender as owner
3. Registers wallet in internal registry
4. Emits WalletCreated event
5. Returns wallet address

IMPORTANT: Save the returned wallet address OR use getWallets() later.
```

---

### `getWallets(address _owner)`
Returns all wallets created by a given EOA. Used for auto-discovery on login.

```
Type     : view (free, no gas)
Input    : _owner — the user's EOA address
Returns  : address[] — array of wallet addresses

Use case : User connects MetaMask → call getWallets(userAddress)
           → get their wallet(s) automatically

Example:
    getWallets("0xUserEOA") → ["0xWallet1", "0xWallet2"]
    getWallets("0xNewUser") → []   (no wallet yet)
```

---

### `getWalletCount(address _owner)`
Returns how many wallets an EOA has created.

```
Type     : view (free, no gas)
Input    : _owner — the user's EOA address
Returns  : uint256 — count of wallets

Use case : Quick check before calling getWallets()
    0 → show "Create Wallet" button
    1 → auto-load that wallet
    2+ → show wallet selector UI
```

---

### `isWalletOf(address _wallet, address _owner)`
Validates that a given wallet address belongs to a given EOA.
Used for manual import — user types their wallet address.

```
Type     : view (free, no gas)
Inputs   : _wallet — contract wallet address entered by user
           _owner  — connected EOA address
Returns  : bool — true if wallet belongs to owner, false otherwise

Security guarantees:
- Returns false for any fake/random address
- Returns false if wallet exists but belongs to different owner
- Only returns true for wallets genuinely created by this factory for this owner

Use case : Import screen — user types address → validate → load
```

---

### `getWalletOwner(address _wallet)`
Returns the owner EOA of any wallet created by this factory.

```
Type     : view (free, no gas)
Input    : _wallet — contract wallet address
Returns  : address — owner EOA, or address(0) if not from this factory

Use case : Admin/backend lookup — who owns wallet 0xABC?
```

---

### `implementation` (public variable)
Address of the logic contract. Read-only. Never changes.

---

### `platformAdmin` (public variable)
Address of the platform admin. Read-only in factory. Never changes in factory.

---

## 8. TimeDelayWallet — All Functions

> All write functions below require the caller to be the wallet owner (user's EOA).
> Call these on the USER'S WALLET ADDRESS, not the factory address.

---

### `queueTransaction(address _to, uint256 _value, address _token)`
Queues a transaction with a 24-hour time lock. Fee is charged immediately.

```
Type     : transaction (costs gas)
Caller   : owner only
Inputs   :
    _to    — receiver address (who will receive funds)
    _value — amount to send (in wei for ETH, in token units for ERC20)
    _token — token contract address, OR address(0) for native ETH

Returns  : uint256 — txId (save this to execute/cancel later)

What happens:
1. Checks balance >= value + fee
2. Stores transaction with executeAfter = now + 24 hours
3. Immediately transfers fee to platformAdmin
4. Emits TransactionQueued with txId and executeAfter timestamp

For ETH:
    _token = "0x0000000000000000000000000000000000000000"
    _value = amount in wei  (1 ETH = 1000000000000000000)

For ERC20:
    _token = token contract address (e.g. USDC: 0x...)
    _value = amount in token's smallest unit
    NOTE: User must first send tokens directly to their wallet address

Reverts if:
    - caller is not owner
    - _value is 0
    - _to is zero address
    - wallet balance < value + fee
    - fee transfer to platform fails
```

---

### `executeTransaction(uint256 _txId)`
Executes a queued transaction after the 24-hour delay.

```
Type     : transaction (costs gas)
Caller   : owner only
Input    : _txId — the transaction ID returned from queueTransaction()

What happens:
1. Verifies 24 hours have passed
2. Marks transaction as executed
3. Sends full _value to the receiver

Reverts if:
    - caller is not owner
    - txId does not exist
    - already executed
    - already cancelled
    - 24 hours have not passed yet ("Too early")
    - wallet balance < value (funds moved out between queue and execute)
```

---

### `cancelTransaction(uint256 _txId)`
Cancels a queued transaction. Must be called BEFORE 24-hour delay expires.

```
Type     : transaction (costs gas)
Caller   : owner only
Input    : _txId — the transaction ID returned from queueTransaction()

What happens:
1. Marks transaction as cancelled
2. Funds stay in wallet (only fee was already taken)
3. Fee is NOT refunded

Reverts if:
    - caller is not owner
    - txId does not exist
    - already executed
    - already cancelled
    - 24 hours have already passed ("Delay passed")
```

---

### `transferOwnership(address newOwner)`
Step 1 of two-step ownership transfer. Proposes a new owner.

```
Type     : transaction (costs gas)
Caller   : owner only
Input    : newOwner — new owner's EOA address

What happens:
    Sets pendingOwner = newOwner
    New owner must call acceptOwnership() to confirm

NOTE: Does NOT immediately transfer ownership.
      New owner must accept. This prevents permanent wallet loss from typos.
```

---

### `acceptOwnership()`
Step 2 of two-step ownership transfer. New owner confirms.

```
Type     : transaction (costs gas)
Caller   : pendingOwner only (new owner)

What happens:
    owner = pendingOwner
    pendingOwner = address(0)
    Emits OwnershipTransferred
```

---

### `updateFee(uint256 _newFeeBps)` — PLATFORM ONLY
Changes the commission rate for this wallet.

```
Type     : transaction (costs gas)
Caller   : platformAdmin only (NOT the wallet owner)
Input    : _newFeeBps — new fee in basis points (100 = 1%, 500 = 5% max)

Reverts if:
    - caller is not platformAdmin
    - _newFeeBps > 500 (5% hard cap)
```

---

### `updatePlatformAdmin(address _newPlatformAdmin)` — PLATFORM ONLY
Changes the platform admin address for this wallet.

```
Type     : transaction (costs gas)
Caller   : platformAdmin only
Input    : _newPlatformAdmin — new platform admin address

NOTE: After this call, fees go to the new address.
      Only current platformAdmin can call this.
```

---

### `rescueToken(address _token, uint256 _amount)`
Allows owner to recover any ERC20 token accidentally sent to wallet.

```
Type     : transaction (costs gas)
Caller   : owner only
Inputs   : _token  — ERC20 token contract address
           _amount — amount to rescue

NOTE: Sends tokens to owner's EOA.
      Use carefully — do not rescue tokens needed for pending transactions.
```

---

### Read-only (view) variables and functions

```
owner()          → address  — current owner EOA
pendingOwner()   → address  — proposed new owner (0x0 if none pending)
platformAdmin()  → address  — platform admin address
feeBps()         → uint256  — current fee in basis points (default: 100 = 1%)
txCounter()      → uint256  — total number of transactions ever queued
initialized()    → bool     — always true after wallet creation
DELAY()          → uint256  — delay in seconds (86400 = 24 hours)
BPS_DENOMINATOR()→ uint256  — always 10000

transactions(txId) → struct:
    to           — receiver address
    value        — amount to send
    token        — token address (0x0 for ETH)
    executeAfter — Unix timestamp when executable
    executed     — bool
    cancelled    — bool
```

---

## 9. All Events

### WalletFactory Events

```
WalletCreated(address indexed wallet, address indexed owner)
    Emitted : when createWallet() is called
    Use     : index by owner to build off-chain wallet registry
```

### TimeDelayWallet Events

```
Initialized(address owner)
    Emitted : once when wallet is first created
    Use     : confirm wallet setup

TransactionQueued(
    uint256 indexed txId,
    address indexed to,
    uint256 value,
    address token,
    uint256 executeAfter
)
    Emitted : when queueTransaction() succeeds
    Use     : save txId, schedule 24h notification at executeAfter timestamp

TransactionExecuted(uint256 indexed txId)
    Emitted : when executeTransaction() succeeds
    Use     : mark transaction as done in UI

TransactionCancelled(uint256 indexed txId)
    Emitted : when cancelTransaction() succeeds
    Use     : mark transaction as cancelled in UI

OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)
    Emitted : when transferOwnership() is called
    Use     : notify new owner to call acceptOwnership()

OwnershipTransferred(address indexed oldOwner, address indexed newOwner)
    Emitted : when acceptOwnership() is called
    Use     : update UI with new owner
```

---

## 10. Complete ABIs

### WalletFactory ABI

```json
[
  {
    "inputs": [
      { "internalType": "address", "name": "_implementation", "type": "address" },
      { "internalType": "address", "name": "_platformAdmin", "type": "address" }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "wallet", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "owner", "type": "address" }
    ],
    "name": "WalletCreated",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "createWallet",
    "outputs": [ { "internalType": "address", "name": "", "type": "address" } ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "address", "name": "_owner", "type": "address" } ],
    "name": "getWalletCount",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "address", "name": "_wallet", "type": "address" } ],
    "name": "getWalletOwner",
    "outputs": [ { "internalType": "address", "name": "", "type": "address" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "address", "name": "_owner", "type": "address" } ],
    "name": "getWallets",
    "outputs": [ { "internalType": "address[]", "name": "", "type": "address[]" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "implementation",
    "outputs": [ { "internalType": "address", "name": "", "type": "address" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "_wallet", "type": "address" },
      { "internalType": "address", "name": "_owner", "type": "address" }
    ],
    "name": "isWalletOf",
    "outputs": [ { "internalType": "bool", "name": "", "type": "bool" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "platformAdmin",
    "outputs": [ { "internalType": "address", "name": "", "type": "address" } ],
    "stateMutability": "view",
    "type": "function"
  }
]
```

---

### TimeDelayWallet ABI

```json
[
  {
    "inputs": [],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [ { "indexed": false, "internalType": "address", "name": "owner", "type": "address" } ],
    "name": "Initialized",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "previousOwner", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "newOwner", "type": "address" }
    ],
    "name": "OwnershipTransferStarted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "oldOwner", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "newOwner", "type": "address" }
    ],
    "name": "OwnershipTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [ { "indexed": true, "internalType": "uint256", "name": "txId", "type": "uint256" } ],
    "name": "TransactionCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [ { "indexed": true, "internalType": "uint256", "name": "txId", "type": "uint256" } ],
    "name": "TransactionExecuted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "uint256", "name": "txId",         "type": "uint256" },
      { "indexed": true,  "internalType": "address", "name": "to",           "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "value",        "type": "uint256" },
      { "indexed": false, "internalType": "address", "name": "token",        "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "executeAfter", "type": "uint256" }
    ],
    "name": "TransactionQueued",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "BPS_DENOMINATOR",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "DELAY",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "acceptOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "_txId", "type": "uint256" } ],
    "name": "cancelTransaction",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "_txId", "type": "uint256" } ],
    "name": "executeTransaction",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "feeBps",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "_owner",         "type": "address" },
      { "internalType": "address", "name": "_platformAdmin", "type": "address" }
    ],
    "name": "initialize",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "initialized",
    "outputs": [ { "internalType": "bool", "name": "", "type": "bool" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [ { "internalType": "address", "name": "", "type": "address" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pendingOwner",
    "outputs": [ { "internalType": "address", "name": "", "type": "address" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "platformAdmin",
    "outputs": [ { "internalType": "address", "name": "", "type": "address" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "_to",    "type": "address" },
      { "internalType": "uint256", "name": "_value", "type": "uint256" },
      { "internalType": "address", "name": "_token", "type": "address" }
    ],
    "name": "queueTransaction",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "_token",  "type": "address" },
      { "internalType": "uint256", "name": "_amount", "type": "uint256" }
    ],
    "name": "rescueToken",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "name": "transactions",
    "outputs": [
      { "internalType": "address", "name": "to",           "type": "address" },
      { "internalType": "uint256", "name": "value",        "type": "uint256" },
      { "internalType": "address", "name": "token",        "type": "address" },
      { "internalType": "uint256", "name": "executeAfter", "type": "uint256" },
      { "internalType": "bool",    "name": "executed",     "type": "bool"    },
      { "internalType": "bool",    "name": "cancelled",    "type": "bool"    }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "address", "name": "newOwner", "type": "address" } ],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "txCounter",
    "outputs": [ { "internalType": "uint256", "name": "", "type": "uint256" } ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "uint256", "name": "_newFeeBps", "type": "uint256" } ],
    "name": "updateFee",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [ { "internalType": "address", "name": "_newPlatformAdmin", "type": "address" } ],
    "name": "updatePlatformAdmin",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "stateMutability": "payable",
    "type": "receive"
  }
]
```

---

## 11. Frontend Integration — Step by Step

### Setup (ethers.js v6)

```js
import { ethers } from "ethers";
import FACTORY_ABI from "./abis/WalletFactory.json";
import WALLET_ABI  from "./abis/TimeDelayWallet.json";

const FACTORY_ADDRESS = "0xFE6327aeCAeF8Ddb3E0CA8AEc61FBDCFE735A1CA";

// Connect provider and signer
const provider = new ethers.BrowserProvider(window.ethereum);
const signer   = await provider.getSigner();
const userEOA  = await signer.getAddress();

// Factory instance (read + write)
const factory  = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);
```

---

### Flow 1 — User Login / Auto Discovery

```js
async function onLogin() {
    const wallets = await factory.getWallets(userEOA);

    if (wallets.length === 0) {
        showScreen("create-wallet");

    } else if (wallets.length === 1) {
        loadWallet(wallets[0]);              // auto load

    } else {
        showWalletSelector(wallets);          // let user pick
    }
}

function loadWallet(walletAddress) {
    const wallet = new ethers.Contract(walletAddress, WALLET_ABI, signer);
    // store wallet instance for all further calls
    window.currentWallet = wallet;
}
```

---

### Flow 2 — Create New Wallet

```js
async function createWallet() {
    const tx      = await factory.createWallet();
    const receipt = await tx.wait();

    // Extract wallet address from event
    const event = receipt.logs
        .map(log => { try { return factory.interface.parseLog(log); } catch { return null; } })
        .find(e => e?.name === "WalletCreated");

    const walletAddress = event.args.wallet;
    loadWallet(walletAddress);
}
```

---

### Flow 3 — Manual Import (user types address)

```js
async function importWallet(inputAddress) {

    if (!ethers.isAddress(inputAddress)) {
        showError("Invalid address format");
        return;
    }

    const isValid = await factory.isWalletOf(inputAddress, userEOA);

    if (!isValid) {
        showError("This wallet does not belong to your address");
        return;
    }

    loadWallet(inputAddress);
}
```

---

### Flow 4 — Deposit ETH to Wallet

```js
async function depositETH(walletAddress, amountETH) {
    const tx = await signer.sendTransaction({
        to:    walletAddress,
        value: ethers.parseEther(amountETH)   // e.g. "0.5"
    });
    await tx.wait();
}
```

---

### Flow 5 — Queue ETH Transaction

```js
async function queueETH(toAddress, amountETH) {
    const wallet = window.currentWallet;
    const value  = ethers.parseEther(amountETH);

    // Calculate fee to show user
    const feeBps  = await wallet.feeBps();
    const fee     = value * feeBps / 10000n;
    const total   = value + fee;

    // Show user: "This will cost X ETH (including 1% fee of Y ETH)"

    const tx      = await wallet.queueTransaction(
        toAddress,
        value,
        ethers.ZeroAddress          // ETH = zero address
    );
    const receipt = await tx.wait();

    // Get txId and executeAfter from event
    const event = receipt.logs
        .map(log => { try { return wallet.interface.parseLog(log); } catch { return null; } })
        .find(e => e?.name === "TransactionQueued");

    const txId         = event.args.txId;
    const executeAfter = event.args.executeAfter;  // Unix timestamp

    // IMPORTANT: Save txId — needed to execute or cancel later
    // Schedule 24h notification at executeAfter timestamp
    return { txId: txId.toString(), executeAfter: Number(executeAfter) };
}
```

---

### Flow 6 — Queue ERC20 Transaction

```js
async function queueERC20(toAddress, tokenAddress, amount) {
    const wallet = window.currentWallet;

    const tx = await wallet.queueTransaction(
        toAddress,
        amount,         // in token's smallest unit (e.g. USDC uses 6 decimals)
        tokenAddress    // ERC20 contract address
    );
    const receipt = await tx.wait();

    const event = receipt.logs
        .map(log => { try { return wallet.interface.parseLog(log); } catch { return null; } })
        .find(e => e?.name === "TransactionQueued");

    return {
        txId:         event.args.txId.toString(),
        executeAfter: Number(event.args.executeAfter)
    };
}
```

---

### Flow 7 — Execute Transaction (after 24h)

```js
async function executeTransaction(txId) {
    const wallet = window.currentWallet;

    // Check if delay has passed
    const txData = await wallet.transactions(txId);
    const now    = Math.floor(Date.now() / 1000);

    if (now < Number(txData.executeAfter)) {
        const remaining = Number(txData.executeAfter) - now;
        showError(`Too early. Wait ${Math.ceil(remaining / 3600)} more hours.`);
        return;
    }

    const tx = await wallet.executeTransaction(txId);
    await tx.wait();
    showSuccess("Transaction executed. Receiver got full amount.");
}
```

---

### Flow 8 — Cancel Transaction (within 24h)

```js
async function cancelTransaction(txId) {
    const wallet = window.currentWallet;

    // Check if still within cancel window
    const txData = await wallet.transactions(txId);
    const now    = Math.floor(Date.now() / 1000);

    if (now >= Number(txData.executeAfter)) {
        showError("Cancel window has passed. You can only execute now.");
        return;
    }

    const tx = await wallet.cancelTransaction(txId);
    await tx.wait();
    showWarning("Transaction cancelled. Note: the fee is non-refundable.");
}
```

---

### Flow 9 — Display Transaction Status

```js
async function getTransactionStatus(txId) {
    const wallet = window.currentWallet;
    const txData = await wallet.transactions(txId);
    const now    = Math.floor(Date.now() / 1000);

    if (txData.executed)   return "EXECUTED";
    if (txData.cancelled)  return "CANCELLED";
    if (now < Number(txData.executeAfter)) return "PENDING (can cancel)";
    return "READY TO EXECUTE";
}
```

---

### Flow 10 — List All Transactions

```js
async function getAllTransactions() {
    const wallet  = window.currentWallet;
    const count   = await wallet.txCounter();
    const txList  = [];

    for (let i = 0; i < Number(count); i++) {
        const tx = await wallet.transactions(i);
        txList.push({
            txId:         i,
            to:           tx.to,
            value:        ethers.formatEther(tx.value),
            token:        tx.token,
            executeAfter: new Date(Number(tx.executeAfter) * 1000),
            executed:     tx.executed,
            cancelled:    tx.cancelled
        });
    }

    return txList;
}
```

---

### Flow 11 — Listen to Events (real-time updates)

```js
// Listen for new queued transactions
wallet.on("TransactionQueued", (txId, to, value, token, executeAfter) => {
    console.log("New tx queued:", txId.toString());
    // Schedule 24h notification at executeAfter
    scheduleNotification(Number(executeAfter));
});

// Listen for executions
wallet.on("TransactionExecuted", (txId) => {
    updateUI(txId.toString(), "EXECUTED");
});

// Listen for cancellations
wallet.on("TransactionCancelled", (txId) => {
    updateUI(txId.toString(), "CANCELLED");
});

// Stop listening when user leaves page
wallet.removeAllListeners();
```

---

## 12. Error Reference

| Revert Message           | Function         | Reason                                      |
|--------------------------|------------------|---------------------------------------------|
| `"Not owner"`            | all write funcs  | Caller is not the wallet owner              |
| `"Not platform"`         | updateFee etc.   | Caller is not platformAdmin                 |
| `"Already initialized"`  | initialize()     | Wallet already set up                       |
| `"Zero value"`           | queueTransaction | _value must be > 0                          |
| `"Invalid recipient"`    | queueTransaction | _to is zero address                         |
| `"Insufficient balance"` | queue / execute  | Wallet does not have enough funds           |
| `"Fee transfer failed"`  | queueTransaction | ETH fee transfer to platformAdmin failed    |
| `"Too early"`            | executeTransaction| 24 hours have not passed yet               |
| `"Cancelled"`            | executeTransaction| Transaction was already cancelled           |
| `"Already executed"`     | execute / cancel | Transaction was already executed            |
| `"Already cancelled"`    | cancelTransaction | Transaction was already cancelled          |
| `"Delay passed"`         | cancelTransaction | 24 hours already passed, cannot cancel     |
| `"Invalid txId"`         | execute / cancel | txId does not exist yet                     |
| `"Fee too high"`         | updateFee        | feeBps > 500 (5% max)                       |
| `"Invalid address"`      | updatePlatformAdmin | New address is zero address              |
| `"Invalid owner"`        | transferOwnership| New owner is zero address                   |
| `"Not pending owner"`    | acceptOwnership  | Caller is not the nominated new owner       |
| `"Invalid token"`        | rescueToken      | Token address is zero address               |

---

## 13. Security Rules

### For App Developer — Must Follow

```
1. ALWAYS check wallet balance + fee before calling queueTransaction()
   Formula: required = value + (value * feeBps / 10000)
   Show this clearly to user BEFORE they sign.

2. ALWAYS save txId from TransactionQueued event receipt.
   Without txId you cannot execute or cancel.

3. ALWAYS show executeAfter time to user after queuing.
   User must know when they can execute AND when cancel window closes.

4. NEVER call executeTransaction() before executeAfter timestamp.
   It will revert with "Too early".

5. NEVER call cancelTransaction() after executeAfter timestamp.
   It will revert with "Delay passed".

6. Fee is NON-REFUNDABLE. Tell users clearly before they queue.

7. For ownership transfer: after calling transferOwnership(),
   the NEW OWNER must call acceptOwnership() from their wallet.
   Ownership is NOT transferred until acceptOwnership() is called.

8. For ERC20: user must send tokens directly to their wallet address
   BEFORE calling queueTransaction() with that token.
   There is no approve+transferFrom mechanism.

9. Do NOT store or expose the implementation contract address (0xA5145...).
   Users never interact with it. Only factory address matters.

10. platformAdmin controls fee changes. Do not allow users to call
    updateFee() or updatePlatformAdmin() — those are platform-only.
```

---

*Document generated for TS Wallet v1.0 — Sepolia Testnet deployment*
*All functions tested and verified on-chain — March 2026*
