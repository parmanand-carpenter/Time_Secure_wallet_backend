# Import Wallet — Complete Guide

> This document explains everything about the Import Wallet feature
> in the TS Wallet system. How it works, why it works, and how to build it.

---

## What is Import Wallet?

When a user creates a TS Wallet, they get a smart contract wallet address.
If they switch to a new device or clear their browser, they need a way
to find and reconnect to their existing wallet.

Import Wallet solves this problem.

There are TWO ways to import:

```
Method 1 — AUTO DISCOVERY
    User just connects MetaMask → wallet found automatically
    No address needed. No typing. Just connect.

Method 2 — MANUAL IMPORT
    User types their wallet contract address → system validates it
    Like Safe Wallet's "Add existing Safe Account" screen.
```

---

## How It Works — The Registry

When a user calls `factory.createWallet()`, the factory stores two things internally:

```
_wallets[ownerEOA].push(walletAddress)       ← forward: who owns what
_walletOwner[walletAddress] = ownerEOA        ← reverse: what belongs to who
```

These two mappings are `private` — only the factory can write to them.
Nobody can inject fake entries. Nobody can forge ownership.

This registry is the foundation of both import methods.

---

## Method 1 — Auto Discovery

### How It Works

```
Step 1: User opens app on new device
        ↓
Step 2: User connects MetaMask (EOA: 0xABC...)
        ↓
Step 3: App calls factory.getWallets("0xABC...")
        ↓
        Factory looks up _wallets["0xABC..."]
        ↓
Step 4: Returns ["0xWallet1", "0xWallet2", ...]
        ↓
Step 5: App loads wallet automatically
```

### Visual Flow

```
New Device
    │
    ▼
Connect MetaMask ──► EOA: 0xABC...
    │
    ▼
factory.getWallets("0xABC...")
    │
    ├── returns []
    │       │
    │       ▼
    │   No wallet found
    │   Show "Create Wallet" button
    │
    ├── returns ["0xWallet1"]
    │       │
    │       ▼
    │   One wallet found
    │   Load dashboard automatically ✅
    │
    └── returns ["0xWallet1", "0xWallet2"]
            │
            ▼
        Multiple wallets found
        Show wallet selector screen
        User picks one
```

### Smart Contract Function

```
factory.getWallets(address _owner)
    Input  : user's EOA address
    Output : array of wallet addresses
    Cost   : FREE (view function, no gas)
```

### Frontend Code

```js
async function autoDiscoverWallet() {
    const userEOA = await signer.getAddress();

    const wallets = await factory.getWallets(userEOA);

    if (wallets.length === 0) {
        // No wallet exists for this EOA
        showCreateWalletScreen();

    } else if (wallets.length === 1) {
        // Exactly one wallet — load it directly
        loadWallet(wallets[0]);

    } else {
        // Multiple wallets — let user choose
        showWalletSelector(wallets);
    }
}
```

---

## Method 2 — Manual Import

### How It Works

```
Step 1: User opens app on new device
        ↓
Step 2: User connects MetaMask (EOA: 0xABC...)
        ↓
Step 3: User types their wallet address: 0xWallet123
        ↓
Step 4: App calls factory.isWalletOf("0xWallet123", "0xABC...")
        ↓
        Factory checks: _walletOwner["0xWallet123"] == "0xABC..."
        ↓
Step 5: true  → Import success → Load wallet
        false → Show error → Reject
```

### Visual Flow

```
New Device
    │
    ▼
Connect MetaMask ──► EOA: 0xABC...
    │
    ▼
┌─────────────────────────────────┐
│  Enter your wallet address:     │
│  [ 0xWallet123...             ] │
│  [      Import Button         ] │
└─────────────────────────────────┘
    │
    ▼
factory.isWalletOf("0xWallet123", "0xABC...")
    │
    ├── true
    │     │
    │     ▼
    │   ✅ Wallet belongs to you
    │   Load wallet dashboard
    │
    └── false
          │
          ▼
        ❌ Error shown:
        "This wallet does not belong to your address"
```

### Smart Contract Function

```
factory.isWalletOf(address _wallet, address _owner)
    Input  : wallet contract address + user's EOA address
    Output : true or false
    Cost   : FREE (view function, no gas)
```

### Frontend Code

```js
async function manualImport(inputAddress) {
    const userEOA = await signer.getAddress();

    // Step 1: Check address format
    if (!ethers.isAddress(inputAddress)) {
        showError("Invalid address format");
        return;
    }

    // Step 2: Validate on-chain
    const isValid = await factory.isWalletOf(inputAddress, userEOA);

    if (!isValid) {
        showError("This wallet does not belong to your address");
        return;
    }

    // Step 3: Import success
    loadWallet(inputAddress);
}
```

---

## Security — How Fake Wallets Are Blocked

### Attack 1: User types a random/fake address

```
isWalletOf("0xFakeAddress", "0xABC...")
    ↓
_walletOwner["0xFakeAddress"] = address(0)   ← never registered
    ↓
address(0) == "0xABC..."  →  FALSE ❌
    ↓
Import rejected
```

### Attack 2: User tries to import someone else's wallet

```
isWalletOf("0xVictimsWallet", "0xAttacker...")
    ↓
_walletOwner["0xVictimsWallet"] = "0xVictim..."   ← real owner
    ↓
"0xVictim..." == "0xAttacker..."  →  FALSE ❌
    ↓
Import rejected
```

### Attack 3: Attacker tries to register a fake wallet into registry

```
_wallets is PRIVATE
_walletOwner is PRIVATE

Only createWallet() can write to these mappings.
No external function can modify the registry.
Fake injection is IMPOSSIBLE.
```

### Result

```
Only wallets that were:
    1. Deployed by THIS factory
    2. Initialized with THIS user's EOA as owner

...can pass isWalletOf() validation.
```

---

## Both Methods Together — Recommended UI Flow

```
App starts
    │
    ▼
User connects MetaMask
    │
    ▼
Auto Discovery runs first
    │
    ├── Wallet found ──► Load directly (best UX)
    │
    └── No wallet found
            │
            ▼
    Show two options:
    ┌────────────────────────────────────┐
    │                                    │
    │  [ Create New Wallet ]             │
    │                                    │
    │  Already have one?                 │
    │  [ Import by Address ]             │
    │                                    │
    └────────────────────────────────────┘
            │
            ▼ (if Import chosen)
    ┌────────────────────────────────────┐
    │  Enter your wallet address:        │
    │  [ 0x...                        ]  │
    │  [ Import ]                        │
    └────────────────────────────────────┘
            │
            ▼
    isWalletOf() validates
            │
            ├── true  → Load wallet ✅
            └── false → Show error ❌
```

---

## Complete Frontend Code — Both Methods Combined

```js
import { ethers } from "ethers";
import FACTORY_ABI from "./abis/WalletFactory.json";
import WALLET_ABI  from "./abis/TimeDelayWallet.json";

const FACTORY_ADDRESS = "0xFE6327aeCAeF8Ddb3E0CA8AEc61FBDCFE735A1CA";

// ── Setup ─────────────────────────────────────────────────
const provider = new ethers.BrowserProvider(window.ethereum);
const signer   = await provider.getSigner();
const userEOA  = await signer.getAddress();
const factory  = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);


// ── Method 1: Auto Discovery ──────────────────────────────
async function autoDiscover() {
    const wallets = await factory.getWallets(userEOA);

    if (wallets.length === 0) {
        showScreen("no-wallet");              // show create + import options

    } else if (wallets.length === 1) {
        loadWallet(wallets[0]);              // auto load

    } else {
        showWalletSelector(wallets);          // let user pick
    }
}


// ── Method 2: Manual Import ───────────────────────────────
async function importByAddress(inputAddress) {

    // format check
    if (!ethers.isAddress(inputAddress)) {
        showError("Invalid address format");
        return;
    }

    // on-chain validation
    const isValid = await factory.isWalletOf(inputAddress, userEOA);

    if (!isValid) {
        showError("This wallet does not belong to your address");
        return;
    }

    loadWallet(inputAddress);
}


// ── Load wallet after any import method ──────────────────
function loadWallet(walletAddress) {
    const wallet = new ethers.Contract(walletAddress, WALLET_ABI, signer);
    window.currentWallet = wallet;
    showScreen("dashboard");
}
```

---

## Factory Functions Used for Import

| Function | Type | Purpose |
|---|---|---|
| `getWallets(ownerEOA)` | view / free | Returns all wallets for an EOA — auto discovery |
| `getWalletCount(ownerEOA)` | view / free | Returns count — quick check before getWallets |
| `isWalletOf(wallet, ownerEOA)` | view / free | Validates manual import — true/false |
| `getWalletOwner(wallet)` | view / free | Returns owner of any wallet — admin use |

All four functions are **free to call** (view functions — no gas, no transaction).

---

## Key Rules for Developer

```
1. Auto discovery runs on EVERY login automatically.
   Do not ask user for their address if getWallets() finds it.

2. Manual import is only shown when auto discovery returns empty.

3. isWalletOf() is the ONLY valid way to verify wallet ownership.
   Do NOT trust user input alone. Always validate on-chain.

4. A user CAN have multiple wallets under one EOA.
   Handle wallets.length > 1 with a selector screen.

5. All import functions are view — call them freely with no gas cost.

6. The wallet address returned is the USER's wallet contract.
   Use TimeDelayWallet ABI with this address for all wallet operations.
   Use WalletFactory ABI only for discovery/import.
```

---

*Import Wallet feature — TS Wallet v1.0 — Sepolia Testnet*
*Tested and verified on-chain — March 2026*
