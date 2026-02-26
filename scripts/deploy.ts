import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect();
  const [deployer] = await ethers.getSigners();

  const vault = await ethers.deployContract("CrediVault");
  // Wait for mining so downstream scripts always receive a live address.
  await vault.waitForDeployment();

  console.log("Deployer:", deployer.address);
  console.log("CrediVault deployed to:", await vault.getAddress());
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
