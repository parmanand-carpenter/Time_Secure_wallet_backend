// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./TimeDelayWallet.sol";

contract WalletFactory {

    address public immutable implementation;
    address public immutable platformAdmin;

    // ================= REGISTRY =================

    mapping(address => address[]) private _wallets;        // owner  → wallets[]
    mapping(address => address)   private _walletOwner;    // wallet → owner

    event WalletCreated(address indexed wallet, address indexed owner);

    constructor(
        address _implementation,
        address _platformAdmin
    ) {
        require(_implementation != address(0), "Invalid implementation");
        require(_platformAdmin != address(0), "Invalid platform");

        implementation = _implementation;
        platformAdmin = _platformAdmin;
    }

    function createWallet() external returns (address) {
        address payable clone = payable(Clones.clone(implementation));

        TimeDelayWallet(clone).initialize(
            msg.sender,
            platformAdmin
        );

        _wallets[msg.sender].push(clone);
        _walletOwner[clone] = msg.sender;

        emit WalletCreated(clone, msg.sender);

        return clone;
    }

    // ================= DISCOVERY =================

    function getWallets(address _owner)
        external
        view
        returns (address[] memory)
    {
        return _wallets[_owner];
    }

    function getWalletCount(address _owner)
        external
        view
        returns (uint256)
    {
        return _wallets[_owner].length;
    }

    function getWalletOwner(address _wallet)
        external
        view
        returns (address)
    {
        return _walletOwner[_wallet];
    }

    function isWalletOf(address _wallet, address _owner)
        external
        view
        returns (bool)
    {
        return _walletOwner[_wallet] == _owner;
    }
}