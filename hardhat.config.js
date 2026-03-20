import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import dotenv from "dotenv";
dotenv.config();

export default {
  plugins: [hardhatEthers],
  solidity: "0.8.20",
  networks: {
    sepolia: {
      type: "http",
      url: process.env.SEPOLIA_RPC_URL,
      accounts: [process.env.PRIVATE_KEY],
    },
    xhavic: {
      type: "http",
      url: process.env.XHAVIC_RPC_URL,
      accounts: [process.env.PRIVATE_KEY],
    },
  },
};