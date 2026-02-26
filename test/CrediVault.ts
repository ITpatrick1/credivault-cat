import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("CrediVault", function () {
  async function deployFixture() {
    const [owner, debtor, recipientA, recipientB, recipientC, executor, outsider] =
      await ethers.getSigners();

    const vault = await ethers.deployContract("CrediVault");
    await vault.waitForDeployment();

    const caseId = ethers.id("INV-TEST-001");
    const amountDue = ethers.parseEther("1.0");

    return {
      vault,
      owner,
      debtor,
      recipientA,
      recipientB,
      recipientC,
      executor,
      outsider,
      caseId,
      amountDue,
    };
  }

  it("sets deployer as owner and default executor", async function () {
    const { vault, owner } = await deployFixture();

    expect(await vault.owner()).to.equal(owner.address);
    expect(await vault.isExecutor(owner.address)).to.equal(true);
  });

  it("enforces ownership restrictions for admin functions", async function () {
    const { vault, debtor, executor, caseId, amountDue, recipientA, recipientB } =
      await deployFixture();

    await expect(
      vault.connect(debtor).createCase(caseId, debtor.address, amountDue),
    ).to.be.revertedWith("ONLY_OWNER");

    await expect(vault.createCase(caseId, debtor.address, amountDue))
      .to.emit(vault, "CaseCreated")
      .withArgs(caseId, debtor.address, amountDue);

    await expect(vault.connect(debtor).setExecutor(executor.address, true)).to.be
      .revertedWith("ONLY_OWNER");

    await expect(
      vault.connect(debtor).setAllocation(
        caseId,
        [recipientA.address, recipientB.address],
        [6000, 4000],
      ),
    ).to.be.revertedWith("ONLY_OWNER");
  });

  it("validates inputs and rejects invalid flows", async function () {
    const { vault, debtor, caseId, amountDue, recipientA, recipientB } =
      await deployFixture();

    await expect(vault.createCase(caseId, ethers.ZeroAddress, amountDue)).to.be
      .revertedWith("BAD_DEBTOR");
    await expect(vault.createCase(caseId, debtor.address, 0n)).to.be.revertedWith(
      "BAD_AMOUNT",
    );

    await vault.createCase(caseId, debtor.address, amountDue);

    await expect(vault.createCase(caseId, debtor.address, amountDue)).to.be
      .revertedWith("CASE_EXISTS");
    await expect(
      vault.setAllocation(caseId, [recipientA.address], [5000, 5000]),
    ).to.be.revertedWith("LEN_MISMATCH");
    await expect(vault.setAllocation(caseId, [], [])).to.be.revertedWith("EMPTY");
    await expect(
      vault.setAllocation(
        caseId,
        [recipientA.address, recipientB.address],
        [8000, 1000],
      ),
    ).to.be.revertedWith("MUST_EQUAL_10000");

    await expect(vault.connect(debtor).payInvoice(caseId, { value: 0n })).to.be
      .revertedWith("ZERO_VALUE");
  });

  it("enforces executor authorization and prevents double execution", async function () {
    const { vault, debtor, recipientA, recipientB, executor, outsider, caseId, amountDue } =
      await deployFixture();

    await vault.createCase(caseId, debtor.address, amountDue);
    await vault.setAllocation(
      caseId,
      [recipientA.address, recipientB.address],
      [7000, 3000],
    );

    await expect(vault.connect(executor).executePayout(caseId)).to.be.revertedWith(
      "ONLY_EXECUTOR",
    );

    await vault.setExecutor(executor.address, true);

    await expect(vault.connect(outsider).executePayout(caseId)).to.be.revertedWith(
      "ONLY_EXECUTOR",
    );

    await expect(vault.connect(executor).executePayout(caseId)).to.be.revertedWith(
      "NO_FUNDS",
    );

    await vault
      .connect(debtor)
      .payInvoice(caseId, { value: ethers.parseEther("1.0") });

    await expect(vault.connect(executor).executePayout(caseId)).to.emit(
      vault,
      "Executed",
    );
    await expect(vault.connect(executor).executePayout(caseId)).to.be.revertedWith(
      "ALREADY_EXECUTED",
    );
  });

  it("distributes funds according to configured allocations", async function () {
    const {
      vault,
      debtor,
      recipientA,
      recipientB,
      recipientC,
      executor,
      caseId,
      amountDue,
    } = await deployFixture();

    const payment = ethers.parseEther("1.0");

    await vault.createCase(caseId, debtor.address, amountDue);
    await vault.setExecutor(executor.address, true);
    await vault.setAllocation(
      caseId,
      [recipientA.address, recipientB.address, recipientC.address],
      [7000, 2000, 1000],
    );

    const aBefore = await ethers.provider.getBalance(recipientA.address);
    const bBefore = await ethers.provider.getBalance(recipientB.address);
    const cBefore = await ethers.provider.getBalance(recipientC.address);

    await vault.connect(debtor).payInvoice(caseId, { value: payment });
    await vault.connect(executor).executePayout(caseId);

    const aAfter = await ethers.provider.getBalance(recipientA.address);
    const bAfter = await ethers.provider.getBalance(recipientB.address);
    const cAfter = await ethers.provider.getBalance(recipientC.address);

    expect(aAfter - aBefore).to.equal((payment * 7000n) / 10000n);
    expect(bAfter - bBefore).to.equal((payment * 2000n) / 10000n);
    expect(cAfter - cBefore).to.equal((payment * 1000n) / 10000n);
    expect(await vault.contractBalance()).to.equal(0n);
  });

  it("emits Deposit, AllocationUpdated, and Executed events", async function () {
    const { vault, debtor, recipientA, recipientB, executor, caseId, amountDue } =
      await deployFixture();

    const payment = ethers.parseEther("0.5");

    await vault.createCase(caseId, debtor.address, amountDue);
    await vault.setExecutor(executor.address, true);

    await expect(
      vault.setAllocation(
        caseId,
        [recipientA.address, recipientB.address],
        [6000, 4000],
      ),
    )
      .to.emit(vault, "AllocationUpdated")
      .withArgs(caseId);

    await expect(vault.connect(debtor).payInvoice(caseId, { value: payment }))
      .to.emit(vault, "Deposit")
      .withArgs(caseId, debtor.address, payment);

    await expect(vault.connect(executor).executePayout(caseId))
      .to.emit(vault, "Executed")
      .withArgs(caseId, payment);
  });
});
