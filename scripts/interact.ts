import { network } from "hardhat";

async function main() {
  const contractAddress = process.env.CREDIVAULT_ADDRESS;
  if (!contractAddress) {
    throw new Error(
      "Set CREDIVAULT_ADDRESS before running this script",
    );
  }

  const { ethers } = await network.connect();
  const [owner, debtor, recipientA, recipientB, recipientC, executor] =
    await ethers.getSigners();

  // Reuse an existing deployment so this script can be rerun safely in any env.
  const vault = await ethers.getContractAt("CrediVault", contractAddress);
  const caseId = ethers.id("INV-2026-001");
  const amountDue = ethers.parseEther("1.0");
  const payment = ethers.parseEther("1.0");

  console.log("Contract:", contractAddress);
  console.log("Owner:", owner.address);
  console.log("Debtor:", debtor.address);
  console.log("Executor:", executor.address);

  let tx = await vault.createCase(caseId, debtor.address, amountDue);
  await tx.wait();
  console.log("createCase tx:", tx.hash);

  tx = await vault.setExecutor(executor.address, true);
  await tx.wait();
  console.log("setExecutor tx:", tx.hash);

  tx = await vault.setAllocation(
    caseId,
    [recipientA.address, recipientB.address, recipientC.address],
    [7000, 2000, 1000],
  );
  await tx.wait();
  console.log("setAllocation tx:", tx.hash);

  tx = await vault.connect(debtor).payInvoice(caseId, { value: payment });
  await tx.wait();
  console.log("payInvoice tx:", tx.hash);

  // Snapshot state immediately before payout to verify transition correctness.
  const before = await vault.getCase(caseId);
  console.log("Case before execute:", before);
  console.log("Contract balance before execute:", await vault.contractBalance());

  tx = await vault.connect(executor).executePayout(caseId);
  await tx.wait();
  console.log("executePayout tx:", tx.hash);

  const after = await vault.getCase(caseId);
  console.log("Case after execute:", after);
  console.log("Contract balance after execute:", await vault.contractBalance());

  // Event queries double-check that the full lifecycle emitted expected logs.
  const depositEvents = await vault.queryFilter(vault.filters.Deposit(caseId));
  const allocationEvents = await vault.queryFilter(
    vault.filters.AllocationUpdated(caseId),
  );
  const executedEvents = await vault.queryFilter(vault.filters.Executed(caseId));

  console.log("Deposit events:", depositEvents.length);
  console.log("AllocationUpdated events:", allocationEvents.length);
  console.log("Executed events:", executedEvents.length);
}

main().catch((error) => {
  console.error("Interaction failed:", error);
  process.exitCode = 1;
});
