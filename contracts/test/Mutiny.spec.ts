import { expect } from "chai";
import { ethers, network } from "hardhat";

const INCO = "0x4b9911b0191B0b6a6eA8F2Ed562e20Cff5AC8624";
const FEE = 100_000_000_000_000n;
const encrypted = (value: bigint) =>
  ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes"], [ethers.ZeroHash, ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [value])]);

describe("MUTINY confidential lifecycle", function () {
  async function deploy() {
    const Mock = await ethers.getContractFactory("MockInco");
    const mock = await Mock.deploy();
    const runtime = await ethers.provider.getCode(await mock.getAddress());
    await network.provider.send("hardhat_setCode", [INCO, runtime]);
    const Mutiny = await ethers.getContractFactory("Mutiny");
    const mutiny = await Mutiny.deploy();
    const signers = await ethers.getSigners();
    const [host, crew, outsider] = signers;
    return { mutiny, host, crew, outsider, signers };
  }

  async function advance(seconds: number) {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine");
  }

  async function startWithHumans(mutiny: Awaited<ReturnType<typeof deploy>>["mutiny"], players: Awaited<ReturnType<typeof ethers.getSigners>>, count: number) {
    await mutiny.connect(players[0]).createMatch();
    for (let index = 1; index < count; index++) await mutiny.connect(players[index]).joinMatch(1);
    for (let index = 0; index < count; index++) await mutiny.connect(players[index]).setReady(1, true);
    await mutiny.connect(players[0]).startMatch(1, { value: FEE * 3n });
    return players.slice(0, count);
  }

  async function playRound(mutiny: Awaited<ReturnType<typeof deploy>>["mutiny"], players: Awaited<ReturnType<typeof ethers.getSigners>>, orders: bigint[], votes: bigint[]) {
    for (let index = 0; index < players.length; index++) {
      await mutiny.connect(players[index]).submitOrders(1, encrypted(orders[index] ?? 0n), { value: FEE });
    }
    await mutiny.resolveRound(1);
    await mutiny.openVote(1);
    for (let index = 0; index < players.length; index++) {
      await mutiny.connect(players[index]).submitVote(1, encrypted(votes[index] ?? 5n), { value: FEE });
    }
    await mutiny.resolveVote(1);
  }

  it("enforces lobby ownership and duplicate-seat rules", async function () {
    const { mutiny, crew, outsider } = await deploy();
    await mutiny.createMatch();
    await expect(mutiny.connect(outsider).startMatch(1, { value: FEE * 3n })).to.be.revertedWith("HOST_ONLY");
    await mutiny.connect(crew).joinMatch(1);
    await expect(mutiny.connect(crew).joinMatch(1)).to.be.revertedWith("ALREADY_SEATED");
    await expect(mutiny.startMatch(1, { value: FEE * 3n })).to.be.revertedWith("CREW_NOT_READY");
    await mutiny.setReady(1, true);
    await mutiny.connect(crew).setReady(1, true);
    expect(await mutiny.readyState(1)).to.deep.equal([true, true, false, false, false]);
  });

  it("rejects invalid turns, duplicate encrypted orders, and incorrect fees", async function () {
    const { mutiny, crew } = await deploy();
    await mutiny.createMatch();
    await mutiny.connect(crew).joinMatch(1);
    await mutiny.setReady(1, true);
    await mutiny.connect(crew).setReady(1, true);
    await mutiny.startMatch(1, { value: FEE * 3n });
    await expect(mutiny.connect(crew).submitOrders(1, encrypted(0n), { value: FEE - 1n })).to.be.revertedWith("INCO_FEE");
    await mutiny.connect(crew).submitOrders(1, encrypted(0n), { value: FEE });
    await expect(mutiny.connect(crew).submitOrders(1, encrypted(0n), { value: FEE })).to.be.revertedWith("ALREADY_SUBMITTED");
    await expect(mutiny.openVote(1)).to.be.revertedWith("BAD_PHASE");
  });

  it("keeps black-box material locked during play and publishes only aggregate round handles", async function () {
    const { mutiny, crew, outsider } = await deploy();
    await mutiny.createMatch();
    await mutiny.connect(crew).joinMatch(1);
    await mutiny.setReady(1, true);
    await mutiny.connect(crew).setReady(1, true);
    await mutiny.startMatch(1, { value: FEE * 3n });
    await expect(mutiny.connect(outsider).privateHandles(1, 0, 1)).to.be.revertedWith("PRIVATE_HANDLE");
    await expect(mutiny.blackBoxIdentityHandles(1)).to.be.revertedWith("BLACK_BOX_LOCKED");
    await expect(mutiny.blackBoxRoundHandles(1, 1)).to.be.revertedWith("BLACK_BOX_LOCKED");
    await mutiny.submitOrders(1, encrypted(0n), { value: FEE });
    await mutiny.connect(crew).submitOrders(1, encrypted(0n), { value: FEE });
    await mutiny.resolveRound(1);
    const round = await mutiny.publicRoundHandles(1, 1);
    expect(round[0]).to.have.length(3);
    expect(round[1]).to.have.length(3);
  });

  it("applies Saboteur telemetry poisoning without revealing the canonical health handle", async function () {
    const { mutiny } = await deploy();
    await mutiny.createMatch();
    await mutiny.setReady(1, true);
    await mutiny.startMatch(1, { value: FEE * 3n });
    // The semantic executor deterministically assigns seat zero as Saboteur.
    // SPECIAL on reactor has no allocation, so the public reading differs only
    // because the one-use poisoned telemetry rule was applied.
    await mutiny.submitOrders(1, encrypted(128n), { value: FEE });
    await mutiny.resolveRound(1);
    const publicRound = await mutiny.publicRoundHandles(1, 1);
    expect(BigInt(publicRound[0][0])).to.equal(70n);
    await mutiny.openVote(1);
    await mutiny.submitVote(1, encrypted(5n), { value: FEE });
    await mutiny.resolveVote(1);
    expect((await mutiny.matchSummary(1)).phase).to.equal(1n);
  });

  it("finishes after five rounds and unlocks a replayable BLACK BOX", async function () {
    const { mutiny } = await deploy();
    await mutiny.createMatch();
    await mutiny.setReady(1, true);
    await mutiny.startMatch(1, { value: FEE * 3n });
    for (let round = 1; round <= 5; round++) {
      await mutiny.submitOrders(1, encrypted(0n), { value: FEE });
      await mutiny.resolveRound(1);
      await mutiny.openVote(1);
      await mutiny.submitVote(1, encrypted(5n), { value: FEE });
      await mutiny.resolveVote(1);
    }
    expect((await mutiny.matchSummary(1)).phase).to.equal(4n);
    const archiveRound = await mutiny.blackBoxRoundHandles(1, 5);
    expect(archiveRound[0]).to.have.length(5);
    expect(archiveRound[7]).to.have.length(5);
    expect(archiveRound[8]).to.have.length(5);
    expect(archiveRound[9]).to.have.length(5);
    expect(BigInt(archiveRound[10])).to.equal(255n);
    expect((await mutiny.blackBoxIdentityHandles(1))[0]).to.have.length(5);
  });

  it("supports one, two, and five human manifests and rejects a sixth seat", async function () {
    const one = await deploy();
    await startWithHumans(one.mutiny, one.signers, 1);
    expect((await one.mutiny.matchSummary(1)).botCount).to.equal(4n);

    const two = await deploy();
    await startWithHumans(two.mutiny, two.signers, 2);
    expect((await two.mutiny.matchSummary(1)).botCount).to.equal(3n);

    const five = await deploy();
    await five.mutiny.createMatch();
    for (let index = 1; index < 5; index++) await five.mutiny.connect(five.signers[index]).joinMatch(1);
    await expect(five.mutiny.connect(five.signers[5]).joinMatch(1)).to.be.revertedWith("MATCH_FULL");
    for (let index = 0; index < 5; index++) await five.mutiny.connect(five.signers[index]).setReady(1, true);
    await five.mutiny.startMatch(1, { value: FEE * 3n });
    expect((await five.mutiny.matchSummary(1)).botCount).to.equal(0n);
  });

  it("rejects late joins, outsider actions, malformed comms, and unexpected value", async function () {
    const { mutiny, signers, outsider } = await deploy();
    await startWithHumans(mutiny, signers, 2);
    await expect(mutiny.connect(outsider).joinMatch(1)).to.be.revertedWith("LOBBY_CLOSED");
    await expect(mutiny.connect(outsider).submitOrders(1, encrypted(0n), { value: FEE })).to.be.revertedWith("NOT_CREW");
    await mutiny.submitOrders(1, encrypted(0n), { value: FEE });
    await mutiny.connect(signers[1]).submitOrders(1, encrypted(0n), { value: FEE });
    await expect(mutiny.resolveRound(1, { value: 1n })).to.be.revertedWith("UNEXPECTED_VALUE");
    await mutiny.resolveRound(1);
    await expect(mutiny.connect(outsider).sendComms(1, "intrusion")).to.be.revertedWith("NOT_CREW");
    await expect(mutiny.sendComms(1, "")).to.be.revertedWith("MESSAGE_LENGTH");
    await expect(mutiny.sendComms(1, "X".repeat(181))).to.be.revertedWith("MESSAGE_LENGTH");
  });

  it("sanitizes over-budget encrypted orders instead of applying hidden damage", async function () {
    const { mutiny, signers } = await deploy();
    await startWithHumans(mutiny, signers, 1);
    await mutiny.submitOrders(1, encrypted(63n), { value: FEE });
    await mutiny.resolveRound(1);
    const handles = await mutiny.publicRoundHandles(1, 1);
    expect(BigInt(handles[0][0])).to.equal(50n);
    expect(BigInt(handles[1][0])).to.equal(3n);
  });

  it("releases missing orders and no-vote ballots when each crisis clock expires", async function () {
    const { mutiny, signers } = await deploy();
    await startWithHumans(mutiny, signers, 2);
    await mutiny.submitOrders(1, encrypted(0n), { value: FEE });
    expect(await mutiny.canResolveRound(1)).to.equal(false);
    await advance(91);
    expect(await mutiny.canResolveRound(1)).to.equal(true);
    await mutiny.resolveRound(1);
    await mutiny.openVote(1);
    expect(await mutiny.canResolveVote(1)).to.equal(false);
    await advance(46);
    expect(await mutiny.canResolveVote(1)).to.equal(true);
    await mutiny.resolveVote(1);
    expect((await mutiny.matchSummary(1)).phase).to.equal(1n);
    expect(BigInt((await mutiny.publicRoundHandles(1, 1))[2])).to.equal(255n);
  });

  it("ejects the Saboteur by confidential majority and zeroes later sabotage", async function () {
    const { mutiny, signers } = await deploy();
    const players = await startWithHumans(mutiny, signers, 5);
    await playRound(mutiny, players, [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n]);
    expect(BigInt((await mutiny.publicRoundHandles(1, 1))[2])).to.equal(0n);

    await playRound(mutiny, players, [3n, 0n, 0n, 0n, 0n], [5n, 5n, 5n, 5n, 5n]);
    const second = await mutiny.publicRoundHandles(1, 2);
    expect(BigInt(second[0][0])).to.equal(39n);
  });

  it("ejects an innocent by confidential majority and removes later repair", async function () {
    const { mutiny, signers } = await deploy();
    const players = await startWithHumans(mutiny, signers, 5);
    await playRound(mutiny, players, [0n, 0n, 0n, 0n, 0n], [1n, 1n, 1n, 1n, 1n]);
    expect(BigInt((await mutiny.publicRoundHandles(1, 1))[2])).to.equal(1n);

    await playRound(mutiny, players, [0n, 3n, 0n, 0n, 0n], [5n, 5n, 5n, 5n, 5n]);
    const second = await mutiny.publicRoundHandles(1, 2);
    expect(BigInt(second[0][0])).to.equal(39n);
  });

  it("resolves both crew survival and critical-system Saboteur win conditions", async function () {
    const crewGame = await deploy();
    const crewPlayers = await startWithHumans(crewGame.mutiny, crewGame.signers, 5);
    for (let round = 0; round < 5; round++) {
      await playRound(crewGame.mutiny, crewPlayers, [0n, 0n, 0n, 0n, 0n], [5n, 5n, 5n, 5n, 5n]);
    }
    expect(BigInt((await crewGame.mutiny.blackBoxIdentityHandles(1))[3])).to.equal(0n);

    const sabotageGame = await deploy();
    const sabotagePlayers = await startWithHumans(sabotageGame.mutiny, sabotageGame.signers, 5);
    for (let round = 0; round < 5; round++) {
      await playRound(sabotageGame.mutiny, sabotagePlayers, [3n, 0n, 0n, 0n, 0n], [5n, 5n, 5n, 5n, 5n]);
    }
    const identity = await sabotageGame.mutiny.blackBoxIdentityHandles(1);
    expect(BigInt(identity[3])).to.equal(1n);
    const finalRound = await sabotageGame.mutiny.blackBoxRoundHandles(1, 5);
    expect(BigInt(finalRound[2][0])).to.equal(0n);
  });
});
