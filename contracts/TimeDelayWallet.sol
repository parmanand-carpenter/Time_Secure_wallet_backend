// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TimeDelayWallet is ReentrancyGuard {

    using SafeERC20 for IERC20;

    address public owner;
    address public pendingOwner;

    // ================= PLATFORM CONTROL =================

    address public platformAdmin;

    // ================= COMMISSION =================

    uint256 public feeBps; // 1% — set in initialize()
    uint256 public constant BPS_DENOMINATOR = 10000;

    // ================= CORE =================

    uint256 public constant DELAY = 2 minutes;
    bool public initialized;

    struct Transaction {
        address to;
        uint256 value;
        address token;
        uint256 executeAfter;
        bool executed;
        bool cancelled;
    }

    uint256 public txCounter;
    mapping(uint256 => Transaction) public transactions;

    // ================= EVENTS =================

    event Initialized(address owner);
    event TransactionQueued(
        uint256 indexed txId,
        address indexed to,
        uint256 value,
        address token,
        uint256 executeAfter
    );
    event TransactionExecuted(uint256 indexed txId);
    event TransactionCancelled(uint256 indexed txId);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    // ================= MODIFIERS =================

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyPlatform() {
        require(msg.sender == platformAdmin, "Not platform");
        _;
    }

    // ================= CONSTRUCTOR (locks implementation) =================

    constructor() {
        initialized = true;
    }

    // ================= INITIALIZE =================

    function initialize(
        address _owner,
        address _platformAdmin
    ) external {
        require(!initialized, "Already initialized");
        require(_owner != address(0), "Invalid owner");
        require(_platformAdmin != address(0), "Invalid platform");

        owner = _owner;
        platformAdmin = _platformAdmin;
        feeBps = 100;

        initialized = true;

        emit Initialized(_owner);
    }

    // ================= RECEIVE =================

    receive() external payable {}

    // ================= QUEUE =================

    function queueTransaction(
        address _to,
        uint256 _value,
        address _token
    )
        external
        onlyOwner
        nonReentrant
        returns (uint256)
    {
        // CHECKS
        require(_value > 0, "Zero value");
        require(_to != address(0), "Invalid recipient");

        uint256 fee = (_value * feeBps) / BPS_DENOMINATOR;
        uint256 totalRequired = _value + fee;

        if (_token == address(0)) {
            require(address(this).balance >= totalRequired, "Insufficient balance");
        } else {
            require(
                IERC20(_token).balanceOf(address(this)) >= totalRequired,
                "Insufficient balance"
            );
        }

        // EFFECTS
        uint256 txId = txCounter;

        transactions[txId] = Transaction({
            to: _to,
            value: _value,
            token: _token,
            executeAfter: block.timestamp + DELAY,
            executed: false,
            cancelled: false
        });

        txCounter++;

        emit TransactionQueued(
            txId,
            _to,
            _value,
            _token,
            block.timestamp + DELAY
        );

        // INTERACTIONS
        if (fee > 0) {
            if (_token == address(0)) {
                (bool feeSent, ) = platformAdmin.call{value: fee}("");
                require(feeSent, "Fee transfer failed");
            } else {
                IERC20(_token).safeTransfer(platformAdmin, fee);
            }
        }

        return txId;
    }

    // ================= EXECUTE =================

    function executeTransaction(uint256 _txId)
        external
        onlyOwner
        nonReentrant
    {
        require(_txId < txCounter, "Invalid txId");

        Transaction storage txn = transactions[_txId];

        require(!txn.executed, "Already executed");
        require(!txn.cancelled, "Cancelled");
        require(block.timestamp >= txn.executeAfter, "Too early");

        txn.executed = true;

        if (txn.token == address(0)) {
            require(address(this).balance >= txn.value, "Insufficient balance");
            (bool success, ) = txn.to.call{value: txn.value}("");
            require(success, "Native transfer failed");
        } else {
            require(
                IERC20(txn.token).balanceOf(address(this)) >= txn.value,
                "Insufficient balance"
            );
            IERC20(txn.token).safeTransfer(txn.to, txn.value);
        }

        emit TransactionExecuted(_txId);
    }

    // ================= CANCEL =================

    function cancelTransaction(uint256 _txId)
        external
        onlyOwner
    {
        require(_txId < txCounter, "Invalid txId");

        Transaction storage txn = transactions[_txId];

        require(!txn.executed, "Already executed");
        require(!txn.cancelled, "Already cancelled");
        require(block.timestamp < txn.executeAfter, "Delay passed");

        txn.cancelled = true;

        emit TransactionCancelled(_txId);
    }

    // ================= UPDATE COMMISSION =================

    function updateFee(uint256 _newFeeBps)
        external
        onlyPlatform
    {
        require(_newFeeBps <= 500, "Fee too high");
        feeBps = _newFeeBps;
    }

    function updatePlatformAdmin(address _newPlatformAdmin)
        external
        onlyPlatform
    {
        require(_newPlatformAdmin != address(0), "Invalid address");
        platformAdmin = _newPlatformAdmin;
    }

    // ================= OWNERSHIP =================

    function transferOwnership(address newOwner)
        external
        onlyOwner
    {
        require(newOwner != address(0), "Invalid owner");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership()
        external
    {
        require(msg.sender == pendingOwner, "Not pending owner");
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, owner);
    }

    function rescueToken(address _token, uint256 _amount)
        external
        onlyOwner
    {
        require(_token != address(0), "Invalid token");
        IERC20(_token).safeTransfer(owner, _amount);
    }
}