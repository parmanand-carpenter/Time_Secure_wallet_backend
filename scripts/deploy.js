import hre from "hardhat";

async function main() {

  const connection = await hre.network.connect();
  const { ethers } = connection;

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // Deploy implementation
  const Wallet = await ethers.getContractFactory("TimeDelayWallet");
  const implementation = await Wallet.deploy();
  await implementation.waitForDeployment();

  console.log("Implementation:", await implementation.getAddress());

  // Deploy factory (platformAdmin = deployer address)
  const Factory = await ethers.getContractFactory("WalletFactory");
  const factory = await Factory.deploy(
    await implementation.getAddress(),
    deployer.address
  );
  await factory.waitForDeployment();

  console.log("Factory:", await factory.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});