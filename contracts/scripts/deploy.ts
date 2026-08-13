import { ethers } from "hardhat";

async function main() {
  const Mutiny = await ethers.getContractFactory("Mutiny");
  const mutiny = await Mutiny.deploy();
  await mutiny.waitForDeployment();
  const address = await mutiny.getAddress();

  console.log(`MUTINY deployed: ${address}`);
  console.log(`Base Sepolia: https://sepolia.basescan.org/address/${address}`);
  console.log(`Set NEXT_PUBLIC_MUTINY_ADDRESS=${address} in frontend/.env.local`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
