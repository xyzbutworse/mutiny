// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {euint256, ebool, e, inco} from "@inco/lightning/src/Lib.sol";

/// @title MUTINY — confidential social strategy on Inco Lightning
/// @notice Five crew seats, one encrypted saboteur, sealed allocations, private votes,
///         selective reveals during play, and a full BLACK BOX reveal after round five.
contract Mutiny {
    using e for *;

    uint8 public constant SEATS = 5;
    uint8 public constant SYSTEMS = 3;
    uint8 public constant MAX_ROUNDS = 5;

    uint8 public constant PHASE_LOBBY = 0;
    uint8 public constant PHASE_ACTION = 1;
    uint8 public constant PHASE_DISCUSSION = 2;
    uint8 public constant PHASE_VOTING = 3;
    uint8 public constant PHASE_FINISHED = 4;

    uint8 public constant ROLE_CAPTAIN = 1;
    uint8 public constant ROLE_ENGINEER = 2;
    uint8 public constant ROLE_MEDIC = 3;
    uint8 public constant ROLE_SMUGGLER = 4;
    uint8 public constant ROLE_QUARTERMASTER = 5;
    uint8 public constant ROLE_SABOTEUR = 6;

    uint8 public constant ACTION_NONE = 0;
    uint8 public constant ACTION_INVESTIGATE = 1;
    uint8 public constant ACTION_SPECIAL = 2;

    uint256 public nextMatchId = 1;

    struct MatchState {
        address host;
        uint8 phase;
        uint8 round;
        uint8 humanCount;
        uint8 botCount;
        uint64 actionDeadline;
        uint64 discussionDeadline;
        uint64 voteDeadline;
        address[SEATS] players;
        bool[SEATS] isBot;
        ebool[SEATS] active;
        euint256[SEATS] role;
        euint256[SEATS] objective;
        euint256[SYSTEMS] health;
        ebool telemetrySpent;
        euint256 saboteurTarget; // 0 = Reactor, 2 = Navigation
        euint256 smugglerProgress;
    }

    mapping(uint256 => MatchState) private matches;
    mapping(uint256 => mapping(address => uint8)) private seatPlusOne;
    mapping(uint256 => bool[SEATS]) private readyBySeat;
    mapping(uint256 => uint256) public matchCreatedBlock;

    mapping(uint256 => mapping(uint8 => mapping(uint8 => euint256))) private actionByRound;
    mapping(uint256 => mapping(uint8 => mapping(uint8 => bool))) public actionSubmitted;
    mapping(uint256 => mapping(uint8 => mapping(uint8 => euint256))) private voteByRound;
    mapping(uint256 => mapping(uint8 => mapping(uint8 => bool))) public voteSubmitted;

    mapping(uint256 => mapping(uint8 => mapping(uint8 => ebool))) private anomalyByRound;
    mapping(uint256 => mapping(uint8 => mapping(uint8 => euint256))) private investigationClue;
    mapping(uint256 => mapping(uint8 => mapping(uint8 => euint256))) private auditResult;
    mapping(uint256 => mapping(uint8 => mapping(uint8 => ebool))) private protectedForVote;

    mapping(uint256 => mapping(uint8 => mapping(uint8 => euint256))) private trueHealthByRound;
    mapping(uint256 => mapping(uint8 => mapping(uint8 => euint256))) private displayHealthByRound;
    mapping(uint256 => mapping(uint8 => mapping(uint8 => euint256))) private claimedTotalByRound;
    mapping(uint256 => mapping(uint8 => mapping(uint8 => euint256))) private sabotageByRound;
    mapping(uint256 => mapping(uint8 => mapping(uint8 => ebool))) private telemetryByRound;
    mapping(uint256 => mapping(uint8 => euint256)) private ejectedSeatByRound;
    mapping(uint256 => euint256) private winnerByMatch;

    event MatchCreated(uint256 indexed matchId, address indexed host);
    event SeatJoined(uint256 indexed matchId, uint8 indexed seat, address indexed player);
    event SeatReady(uint256 indexed matchId, uint8 indexed seat, address indexed player, bool ready);
    event MatchStarted(uint256 indexed matchId, uint8 humanCount, uint8 botCount);
    event OrdersSealed(uint256 indexed matchId, uint8 indexed round, uint8 indexed seat);
    event RoundResolved(
        uint256 indexed matchId,
        uint8 indexed round,
        bytes32 reactorDisplay,
        bytes32 lifeDisplay,
        bytes32 navDisplay,
        bytes32 reactorClaimed,
        bytes32 lifeClaimed,
        bytes32 navClaimed
    );
    event Comms(uint256 indexed matchId, uint8 indexed round, address indexed sender, string message);
    event VoteOpened(uint256 indexed matchId, uint8 indexed round);
    event VoteSealed(uint256 indexed matchId, uint8 indexed round, uint8 indexed seat);
    event VoteResolved(uint256 indexed matchId, uint8 indexed round, bytes32 ejectedSeatHandle);
    event MatchFinished(uint256 indexed matchId, bytes32 winnerHandle);

    modifier existingMatch(uint256 matchId) {
        require(matches[matchId].host != address(0), "MATCH_NOT_FOUND");
        _;
    }

    function createMatch() external returns (uint256 matchId) {
        matchId = nextMatchId++;
        MatchState storage m = matches[matchId];
        m.host = msg.sender;
        m.phase = PHASE_LOBBY;
        m.players[0] = msg.sender;
        m.humanCount = 1;
        seatPlusOne[matchId][msg.sender] = 1;
        matchCreatedBlock[matchId] = block.number;
        emit MatchCreated(matchId, msg.sender);
        emit SeatJoined(matchId, 0, msg.sender);
    }

    function joinMatch(uint256 matchId) external existingMatch(matchId) {
        MatchState storage m = matches[matchId];
        require(m.phase == PHASE_LOBBY, "LOBBY_CLOSED");
        require(seatPlusOne[matchId][msg.sender] == 0, "ALREADY_SEATED");
        require(m.humanCount < SEATS, "MATCH_FULL");

        uint8 seat = m.humanCount;
        m.players[seat] = msg.sender;
        m.humanCount += 1;
        seatPlusOne[matchId][msg.sender] = seat + 1;
        emit SeatJoined(matchId, seat, msg.sender);
    }

    function setReady(uint256 matchId, bool ready) external existingMatch(matchId) {
        MatchState storage m = matches[matchId];
        require(m.phase == PHASE_LOBBY, "LOBBY_CLOSED");
        uint8 plusOne = seatPlusOne[matchId][msg.sender];
        require(plusOne != 0, "NOT_CREW");
        uint8 seat = plusOne - 1;
        readyBySeat[matchId][seat] = ready;
        emit SeatReady(matchId, seat, msg.sender, ready);
    }

    /// @notice Starts the operation and fills every open seat with an encrypted onchain bot.
    /// @dev Three Inco random handles are created: saboteur seat + saboteur target + hidden role rotation.
    function startMatch(uint256 matchId) external payable existingMatch(matchId) {
        MatchState storage m = matches[matchId];
        require(msg.sender == m.host, "HOST_ONLY");
        require(m.phase == PHASE_LOBBY, "BAD_PHASE");
        require(m.humanCount >= 1, "NO_CREW");
        require(msg.value == inco.getFee() * 3, "INCO_FEE");
        for (uint8 i = 0; i < m.humanCount; i++) {
            require(readyBySeat[matchId][i], "CREW_NOT_READY");
        }

        m.botCount = SEATS - m.humanCount;
        for (uint8 i = m.humanCount; i < SEATS; i++) {
            m.isBot[i] = true;
        }

        euint256 sabSeat = e.randBounded(SEATS);
        sabSeat.allowThis();

        euint256 sabTargetBit = e.randBounded(2);
        sabTargetBit.allowThis();
        // Map 0 -> Reactor (0), 1 -> Navigation (2).
        m.saboteurTarget = sabTargetBit.mul(2);
        m.saboteurTarget.allowThis();

        // Confidentially rotate the five specialist roles so seat number does not leak role.
        euint256 roleRotation = e.randBounded(SEATS);
        roleRotation.allowThis();

        for (uint8 i = 0; i < SEATS; i++) {
            m.active[i] = e.asEbool(true);
            m.active[i].allowThis();

            ebool isSaboteur = sabSeat.eq(uint256(i));
            euint256 baseRole = roleRotation.add(uint256(i)).rem(SEATS).add(1);
            euint256 role = isSaboteur.select(uint256(ROLE_SABOTEUR).asEuint256(), baseRole);
            role.allowThis();
            m.role[i] = role;

            // Non-saboteur objective is the base-role code. Saboteur objectives are 100/102.
            euint256 sabObjective = m.saboteurTarget.add(100);
            euint256 objective = isSaboteur.select(sabObjective, baseRole);
            objective.allowThis();
            m.objective[i] = objective;

            if (!m.isBot[i]) {
                role.allow(m.players[i]);
                objective.allow(m.players[i]);
            }
        }

        for (uint8 s = 0; s < SYSTEMS; s++) {
            m.health[s] = uint256(55).asEuint256();
            m.health[s].allowThis();
        }
        m.telemetrySpent = e.asEbool(false);
        m.telemetrySpent.allowThis();
        m.smugglerProgress = uint256(0).asEuint256();
        m.smugglerProgress.allowThis();

        m.round = 1;
        m.phase = PHASE_ACTION;
        m.actionDeadline = uint64(block.timestamp + 90);
        emit MatchStarted(matchId, m.humanCount, m.botCount);
    }

    /// @notice Payload layout (base-4/base-8):
    /// reactor = p % 4; life = (p/4)%4; nav = (p/16)%4;
    /// sideAction = (p/64)%4; target = (p/256)%8.
    /// A side action costs one of the three energy budget points.
    function submitOrders(uint256 matchId, bytes calldata encryptedPayload)
        external
        payable
        existingMatch(matchId)
    {
        MatchState storage m = matches[matchId];
        require(m.phase == PHASE_ACTION, "BAD_PHASE");
        uint8 plusOne = seatPlusOne[matchId][msg.sender];
        require(plusOne != 0, "NOT_CREW");
        uint8 seat = plusOne - 1;
        require(!actionSubmitted[matchId][m.round][seat], "ALREADY_SUBMITTED");
        require(msg.value == inco.getFee(), "INCO_FEE");

        euint256 packed = encryptedPayload.newEuint256(msg.sender);
        packed.allowThis();
        actionByRound[matchId][m.round][seat] = packed;
        actionSubmitted[matchId][m.round][seat] = true;
        emit OrdersSealed(matchId, m.round, seat);
    }

    function canResolveRound(uint256 matchId) public view existingMatch(matchId) returns (bool) {
        MatchState storage m = matches[matchId];
        if (m.phase != PHASE_ACTION) return false;
        if (block.timestamp >= m.actionDeadline) return true;
        for (uint8 i = 0; i < m.humanCount; i++) {
            if (!actionSubmitted[matchId][m.round][i]) return false;
        }
        return true;
    }

    /// @notice Resolves encrypted orders. Bots use a deterministic bounded schedule,
    /// so only player encryption and the three match-start random draws consume fees.
    function resolveRound(uint256 matchId) external payable existingMatch(matchId) {
        MatchState storage m = matches[matchId];
        require(canResolveRound(matchId), "ORDERS_PENDING");
        require(msg.value == 0, "UNEXPECTED_VALUE");

        uint8 round = m.round;

        // Every bot contributes three sealed energy to a deterministic bounded system.
        // The schedule stays cheap while public contributions remain aggregated.
        for (uint8 i = 0; i < SEATS; i++) {
            if (m.isBot[i]) {
                uint8 target = uint8((uint256(round) + i) % SYSTEMS);
                euint256 r = target == 0 ? uint256(3).asEuint256() : uint256(0).asEuint256();
                euint256 l = target == 1 ? uint256(3).asEuint256() : uint256(0).asEuint256();
                euint256 n = target == 2 ? uint256(3).asEuint256() : uint256(0).asEuint256();
                euint256 packed = r.add(l.mul(4)).add(n.mul(16));
                packed.allowThis();
                actionByRound[matchId][round][i] = packed;
                actionSubmitted[matchId][round][i] = true;
            } else if (!actionSubmitted[matchId][round][i]) {
                // Timed-out human contributes nothing this round.
                euint256 zero = uint256(0).asEuint256();
                zero.allowThis();
                actionByRound[matchId][round][i] = zero;
                actionSubmitted[matchId][round][i] = true;
            }
        }

        euint256[3] memory claimed;
        euint256[3] memory good;
        euint256[3] memory bad;
        euint256[3] memory engineerBonus;
        euint256[3] memory quarterBonus;
        ebool[3] memory telemetry;

        for (uint8 s = 0; s < SYSTEMS; s++) {
            claimed[s] = uint256(0).asEuint256();
            good[s] = uint256(0).asEuint256();
            bad[s] = uint256(0).asEuint256();
            engineerBonus[s] = uint256(0).asEuint256();
            quarterBonus[s] = uint256(0).asEuint256();
            telemetry[s] = e.asEbool(false);
            protectedForVote[matchId][round][s] = e.asEbool(false);
        }
        // Protection has five seats, initialize all of them.
        for (uint8 p = 0; p < SEATS; p++) {
            protectedForVote[matchId][round][p] = e.asEbool(false);
            protectedForVote[matchId][round][p].allowThis();
        }

        for (uint8 i = 0; i < SEATS; i++) {
            (euint256 ar, euint256 al, euint256 an, euint256 actionType, euint256 target) =
                _decodeAndSanitize(actionByRound[matchId][round][i]);

            // Encrypted ejection state silently zeros future orders.
            ar = m.active[i].select(ar, uint256(0).asEuint256());
            al = m.active[i].select(al, uint256(0).asEuint256());
            an = m.active[i].select(an, uint256(0).asEuint256());
            actionType = m.active[i].select(actionType, uint256(0).asEuint256());

            euint256[3] memory alloc;
            alloc[0] = ar;
            alloc[1] = al;
            alloc[2] = an;
            ebool isSab = m.role[i].eq(ROLE_SABOTEUR);
            ebool isEngineer = m.role[i].eq(ROLE_ENGINEER);
            ebool isMedic = m.role[i].eq(ROLE_MEDIC);
            ebool isSmuggler = m.role[i].eq(ROLE_SMUGGLER);
            ebool isQuarter = m.role[i].eq(ROLE_QUARTERMASTER);
            ebool usingSpecial = actionType.eq(ACTION_SPECIAL);

            euint256 allocated = ar.add(al).add(an);
            ebool anomaly = isSab.and(allocated.gt(0)).or(isSmuggler.and(usingSpecial));
            anomaly.allowThis();
            anomalyByRound[matchId][round][i] = anomaly;

            for (uint8 s = 0; s < SYSTEMS; s++) {
                claimed[s] = claimed[s].add(alloc[s]);
                good[s] = good[s].add(isSab.select(uint256(0).asEuint256(), alloc[s]));
                bad[s] = bad[s].add(isSab.select(alloc[s], uint256(0).asEuint256()));

                ebool targetsSystem = target.rem(SYSTEMS).eq(uint256(s));
                ebool engineerSpecial = isEngineer.and(usingSpecial).and(targetsSystem);
                engineerBonus[s] = engineerBonus[s].add(
                    engineerSpecial.select(uint256(2).asEuint256(), uint256(0).asEuint256())
                );
                ebool quarterSpecial = isQuarter.and(usingSpecial);
                quarterBonus[s] = quarterBonus[s].add(
                    quarterSpecial.select(uint256(1).asEuint256(), uint256(0).asEuint256())
                );

                ebool canCorrupt = isSab.and(usingSpecial).and(m.telemetrySpent.not()).and(targetsSystem);
                telemetry[s] = telemetry[s].or(canCorrupt);
            }

            // One-use telemetry charge, regardless of which system was targeted.
            ebool spentNow = isSab.and(usingSpecial).and(m.telemetrySpent.not());
            m.telemetrySpent = m.telemetrySpent.or(spentNow);
            m.telemetrySpent.allowThis();

            // Medic protects one seat from the current round's vote.
            for (uint8 p = 0; p < SEATS; p++) {
                ebool protects = isMedic.and(usingSpecial).and(target.rem(SEATS).eq(uint256(p)));
                protectedForVote[matchId][round][p] = protectedForVote[matchId][round][p].or(protects);
                protectedForVote[matchId][round][p].allowThis();
            }

            // Smuggler quietly advances a personal objective instead of improving the ship.
            ebool smugAction = isSmuggler.and(usingSpecial);
            m.smugglerProgress = m.smugglerProgress.add(
                smugAction.select(uint256(1).asEuint256(), uint256(0).asEuint256())
            );
            m.smugglerProgress.allowThis();

            // Investigation: only the investigator may decrypt whether the target was anomalous last round.
            ebool priorAnomaly = e.asEbool(false);
            if (round > 1) {
                for (uint8 p = 0; p < SEATS; p++) {
                    priorAnomaly = target.rem(SEATS).eq(uint256(p)).select(
                        anomalyByRound[matchId][round - 1][p], priorAnomaly
                    );
                }
            }
            ebool investigating = actionType.eq(ACTION_INVESTIGATE);
            euint256 clue = investigating.select(
                priorAnomaly.select(uint256(2).asEuint256(), uint256(0).asEuint256()),
                uint256(255).asEuint256()
            );
            clue.allowThis();
            investigationClue[matchId][round][i] = clue;
            if (!m.isBot[i]) clue.allow(m.players[i]);

            // Captain audit handle is generated after health update below.
        }

        uint256[3] memory decay = [uint256(8), uint256(7), uint256(6)];
        for (uint8 s = 0; s < SYSTEMS; s++) {
            euint256 afterDecay = _floorSub(m.health[s], decay[s]);
            euint256 withRepair = afterDecay.add(good[s]).add(engineerBonus[s]).add(quarterBonus[s]).min(100);
            euint256 nextHealth = _floorSubEncrypted(withRepair, bad[s]);
            nextHealth.allowThis();
            m.health[s] = nextHealth;
            trueHealthByRound[matchId][round][s] = nextHealth;

            euint256 fakeHealth = nextHealth.add(20).min(100);
            euint256 displayed = telemetry[s].select(fakeHealth, nextHealth);
            displayed.allowThis();
            displayed.reveal();
            displayHealthByRound[matchId][round][s] = displayed;

            claimed[s].allowThis();
            claimed[s].reveal();
            claimedTotalByRound[matchId][round][s] = claimed[s];

            bad[s].allowThis();
            sabotageByRound[matchId][round][s] = bad[s];
            telemetry[s].allowThis();
            telemetryByRound[matchId][round][s] = telemetry[s];
        }

        // Captain's audit sees the TRUE post-resolution health for the secretly targeted system.
        for (uint8 i = 0; i < SEATS; i++) {
            (, , , euint256 actionType, euint256 target) = _decodeAndSanitize(actionByRound[matchId][round][i]);
            ebool validAudit = m.active[i].and(m.role[i].eq(ROLE_CAPTAIN)).and(actionType.eq(ACTION_SPECIAL));
            euint256 systemTarget = target.rem(SYSTEMS);
            euint256 selectedHealth = systemTarget.eq(0).select(
                m.health[0], systemTarget.eq(1).select(m.health[1], m.health[2])
            );
            euint256 result = validAudit.select(selectedHealth, uint256(255).asEuint256());
            result.allowThis();
            auditResult[matchId][round][i] = result;
            if (!m.isBot[i]) result.allow(m.players[i]);
        }

        m.phase = PHASE_DISCUSSION;
        m.discussionDeadline = uint64(block.timestamp + 45);

        emit RoundResolved(
            matchId,
            round,
            euint256.unwrap(displayHealthByRound[matchId][round][0]),
            euint256.unwrap(displayHealthByRound[matchId][round][1]),
            euint256.unwrap(displayHealthByRound[matchId][round][2]),
            euint256.unwrap(claimedTotalByRound[matchId][round][0]),
            euint256.unwrap(claimedTotalByRound[matchId][round][1]),
            euint256.unwrap(claimedTotalByRound[matchId][round][2])
        );
    }

    function sendComms(uint256 matchId, string calldata message) external existingMatch(matchId) {
        MatchState storage m = matches[matchId];
        require(m.phase == PHASE_DISCUSSION || m.phase == PHASE_VOTING, "COMMS_CLOSED");
        uint8 plusOne = seatPlusOne[matchId][msg.sender];
        require(plusOne != 0, "NOT_CREW");
        require(bytes(message).length > 0 && bytes(message).length <= 180, "MESSAGE_LENGTH");
        emit Comms(matchId, m.round, msg.sender, message);
    }

    function openVote(uint256 matchId) external existingMatch(matchId) {
        MatchState storage m = matches[matchId];
        require(m.phase == PHASE_DISCUSSION, "BAD_PHASE");
        require(msg.sender == m.host || block.timestamp >= m.discussionDeadline, "DISCUSSION_ACTIVE");
        m.phase = PHASE_VOTING;
        m.voteDeadline = uint64(block.timestamp + 45);
        emit VoteOpened(matchId, m.round);
    }

    /// @notice Encrypted vote value: 0..4 = seat, 5 = KEEP / no ejection.
    function submitVote(uint256 matchId, bytes calldata encryptedVote)
        external
        payable
        existingMatch(matchId)
    {
        MatchState storage m = matches[matchId];
        require(m.phase == PHASE_VOTING, "BAD_PHASE");
        uint8 plusOne = seatPlusOne[matchId][msg.sender];
        require(plusOne != 0, "NOT_CREW");
        uint8 seat = plusOne - 1;
        require(!voteSubmitted[matchId][m.round][seat], "ALREADY_SUBMITTED");
        require(msg.value == inco.getFee(), "INCO_FEE");

        euint256 vote = encryptedVote.newEuint256(msg.sender).rem(6);
        vote.allowThis();
        voteByRound[matchId][m.round][seat] = vote;
        voteSubmitted[matchId][m.round][seat] = true;
        emit VoteSealed(matchId, m.round, seat);
    }

    function canResolveVote(uint256 matchId) public view existingMatch(matchId) returns (bool) {
        MatchState storage m = matches[matchId];
        if (m.phase != PHASE_VOTING) return false;
        if (block.timestamp >= m.voteDeadline) return true;
        for (uint8 i = 0; i < m.humanCount; i++) {
            if (!voteSubmitted[matchId][m.round][i]) return false;
        }
        return true;
    }

    /// @notice Bots cast deterministic bounded ballots, so resolving a vote has no Inco fee.
    function resolveVote(uint256 matchId) external payable existingMatch(matchId) {
        MatchState storage m = matches[matchId];
        require(canResolveVote(matchId), "VOTES_PENDING");
        require(msg.value == 0, "UNEXPECTED_VALUE");

        uint8 round = m.round;
        for (uint8 i = 0; i < SEATS; i++) {
            if (m.isBot[i]) {
                euint256 vote = uint256((uint256(round) + i) % 6).asEuint256();
                vote.allowThis();
                voteByRound[matchId][round][i] = vote;
                voteSubmitted[matchId][round][i] = true;
            } else if (!voteSubmitted[matchId][round][i]) {
                euint256 keep = uint256(5).asEuint256();
                keep.allowThis();
                voteByRound[matchId][round][i] = keep;
                voteSubmitted[matchId][round][i] = true;
            }
        }

        euint256[6] memory counts;
        for (uint8 c = 0; c < 6; c++) counts[c] = uint256(0).asEuint256();

        for (uint8 voter = 0; voter < SEATS; voter++) {
            for (uint8 candidate = 0; candidate < 6; candidate++) {
                ebool chose = voteByRound[matchId][round][voter].eq(uint256(candidate));
                ebool counted = m.active[voter].and(chose);
                counts[candidate] = counts[candidate].add(counted.asEuint256());
            }
        }

        euint256 bestSeat = uint256(5).asEuint256();
        euint256 bestCount = counts[5];
        for (uint8 candidate = 0; candidate < SEATS; candidate++) {
            ebool better = counts[candidate].gt(bestCount);
            bestSeat = better.select(uint256(candidate).asEuint256(), bestSeat);
            bestCount = better.select(counts[candidate], bestCount);
        }

        ebool protectedCandidate = e.asEbool(false);
        for (uint8 candidate = 0; candidate < SEATS; candidate++) {
            protectedCandidate = bestSeat.eq(uint256(candidate)).select(
                protectedForVote[matchId][round][candidate], protectedCandidate
            );
        }
        ebool majority = bestCount.ge(3);
        ebool ejects = majority.and(protectedCandidate.not()).and(bestSeat.lt(SEATS));
        euint256 ejected = ejects.select(bestSeat, uint256(255).asEuint256());
        ejected.allowThis();
        ejected.reveal();
        ejectedSeatByRound[matchId][round] = ejected;

        for (uint8 i = 0; i < SEATS; i++) {
            ebool wasEjected = ejected.eq(uint256(i));
            m.active[i] = m.active[i].and(wasEjected.not());
            m.active[i].allowThis();
        }

        emit VoteResolved(matchId, round, euint256.unwrap(ejected));

        if (round >= MAX_ROUNDS) {
            _finish(matchId);
        } else {
            m.round = round + 1;
            m.phase = PHASE_ACTION;
            m.actionDeadline = uint64(block.timestamp + 90);
        }
    }

    function _finish(uint256 matchId) internal {
        MatchState storage m = matches[matchId];
        ebool reactorDead = m.health[0].eq(0);
        ebool lifeDead = m.health[1].eq(0);
        ebool navDead = m.health[2].eq(0);
        ebool targetReactor = m.saboteurTarget.eq(0);
        ebool targetCritical = targetReactor.select(m.health[0].le(10), m.health[2].le(10));
        ebool saboteurWins = reactorDead.or(lifeDead).or(navDead).or(targetCritical);
        euint256 winner = saboteurWins.select(uint256(1).asEuint256(), uint256(0).asEuint256());
        winner.allowThis();
        winner.reveal();
        winnerByMatch[matchId] = winner;

        // Declassify the complete operation. Reveal is irreversible by design and only happens at match end.
        for (uint8 i = 0; i < SEATS; i++) {
            m.role[i].reveal();
            m.objective[i].reveal();
        }
        m.saboteurTarget.reveal();
        m.smugglerProgress.reveal();

        for (uint8 r = 1; r <= MAX_ROUNDS; r++) {
            for (uint8 i = 0; i < SEATS; i++) {
                actionByRound[matchId][r][i].reveal();
                voteByRound[matchId][r][i].reveal();
                anomalyByRound[matchId][r][i].reveal();
                investigationClue[matchId][r][i].reveal();
                auditResult[matchId][r][i].reveal();
            }
            for (uint8 s = 0; s < SYSTEMS; s++) {
                trueHealthByRound[matchId][r][s].reveal();
                sabotageByRound[matchId][r][s].reveal();
                telemetryByRound[matchId][r][s].reveal();
            }
        }

        m.phase = PHASE_FINISHED;
        emit MatchFinished(matchId, euint256.unwrap(winner));
    }

    function _decodeAndSanitize(euint256 packed)
        internal
        returns (euint256 ar, euint256 al, euint256 an, euint256 actionType, euint256 target)
    {
        ar = packed.rem(4);
        al = packed.div(4).rem(4);
        an = packed.div(16).rem(4);
        actionType = packed.div(64).rem(4);
        target = packed.div(256).rem(8);

        euint256 sideCost = actionType.ne(0).asEuint256();
        ebool valid = ar.add(al).add(an).add(sideCost).le(3).and(actionType.le(ACTION_SPECIAL));
        ar = valid.select(ar, uint256(0).asEuint256());
        al = valid.select(al, uint256(0).asEuint256());
        an = valid.select(an, uint256(0).asEuint256());
        actionType = valid.select(actionType, uint256(0).asEuint256());
        target = valid.select(target, uint256(0).asEuint256());
    }

    function _floorSub(euint256 value, uint256 amount) internal returns (euint256) {
        return value.ge(amount).select(value.sub(amount), uint256(0).asEuint256());
    }

    function _floorSubEncrypted(euint256 value, euint256 amount) internal returns (euint256) {
        return value.ge(amount).select(value.sub(amount), uint256(0).asEuint256());
    }

    // ---------- Read API ----------

    function matchSummary(uint256 matchId)
        external
        view
        existingMatch(matchId)
        returns (
            address host,
            uint8 phase,
            uint8 round,
            uint8 humanCount,
            uint8 botCount,
            uint64 actionDeadline,
            uint64 discussionDeadline,
            uint64 voteDeadline,
            address[SEATS] memory players,
            bool[SEATS] memory bots
        )
    {
        MatchState storage m = matches[matchId];
        return (
            m.host,
            m.phase,
            m.round,
            m.humanCount,
            m.botCount,
            m.actionDeadline,
            m.discussionDeadline,
            m.voteDeadline,
            m.players,
            m.isBot
        );
    }

    function incoFee() external pure returns (uint256) {
        return inco.getFee();
    }

    function seatOf(uint256 matchId, address player) external view returns (uint8) {
        uint8 plusOne = seatPlusOne[matchId][player];
        return plusOne == 0 ? 255 : plusOne - 1;
    }

    function readyState(uint256 matchId) external view existingMatch(matchId) returns (bool[SEATS] memory) {
        return readyBySeat[matchId];
    }

    function privateHandles(uint256 matchId, uint8 seat, uint8 round)
        external
        view
        existingMatch(matchId)
        returns (bytes32 roleHandle, bytes32 objectiveHandle, bytes32 clueHandle, bytes32 auditHandle)
    {
        require(seat < SEATS && round <= MAX_ROUNDS, "OUT_OF_RANGE");
        MatchState storage m = matches[matchId];
        require(m.phase == PHASE_FINISHED || seatPlusOne[matchId][msg.sender] == seat + 1, "PRIVATE_HANDLE");
        return (
            euint256.unwrap(m.role[seat]),
            euint256.unwrap(m.objective[seat]),
            euint256.unwrap(investigationClue[matchId][round][seat]),
            euint256.unwrap(auditResult[matchId][round][seat])
        );
    }

    function publicRoundHandles(uint256 matchId, uint8 round)
        external
        view
        existingMatch(matchId)
        returns (
            bytes32[3] memory displayedHealth,
            bytes32[3] memory claimedTotals,
            bytes32 ejectedSeat
        )
    {
        require(round > 0 && round <= MAX_ROUNDS, "OUT_OF_RANGE");
        for (uint8 s = 0; s < SYSTEMS; s++) {
            displayedHealth[s] = euint256.unwrap(displayHealthByRound[matchId][round][s]);
            claimedTotals[s] = euint256.unwrap(claimedTotalByRound[matchId][round][s]);
        }
        ejectedSeat = euint256.unwrap(ejectedSeatByRound[matchId][round]);
    }

    function blackBoxRoundHandles(uint256 matchId, uint8 round)
        external
        view
        existingMatch(matchId)
        returns (
            bytes32[5] memory actions,
            bytes32[5] memory votes,
            bytes32[3] memory trueHealth,
            bytes32[3] memory displayedHealth,
            bytes32[3] memory claimedTotals,
            bytes32[3] memory sabotage,
            bytes32[3] memory telemetry,
            bytes32[5] memory anomalies,
            bytes32[5] memory investigationClues,
            bytes32[5] memory auditResults,
            bytes32 ejectedSeat
        )
    {
        require(matches[matchId].phase == PHASE_FINISHED, "BLACK_BOX_LOCKED");
        require(round > 0 && round <= MAX_ROUNDS, "OUT_OF_RANGE");
        for (uint8 i = 0; i < SEATS; i++) {
            actions[i] = euint256.unwrap(actionByRound[matchId][round][i]);
            votes[i] = euint256.unwrap(voteByRound[matchId][round][i]);
            anomalies[i] = ebool.unwrap(anomalyByRound[matchId][round][i]);
            investigationClues[i] = euint256.unwrap(investigationClue[matchId][round][i]);
            auditResults[i] = euint256.unwrap(auditResult[matchId][round][i]);
        }
        for (uint8 s = 0; s < SYSTEMS; s++) {
            trueHealth[s] = euint256.unwrap(trueHealthByRound[matchId][round][s]);
            displayedHealth[s] = euint256.unwrap(displayHealthByRound[matchId][round][s]);
            claimedTotals[s] = euint256.unwrap(claimedTotalByRound[matchId][round][s]);
            sabotage[s] = euint256.unwrap(sabotageByRound[matchId][round][s]);
            telemetry[s] = ebool.unwrap(telemetryByRound[matchId][round][s]);
        }
        ejectedSeat = euint256.unwrap(ejectedSeatByRound[matchId][round]);
    }

    function blackBoxIdentityHandles(uint256 matchId)
        external
        view
        existingMatch(matchId)
        returns (bytes32[5] memory roles, bytes32[5] memory objectives, bytes32 saboteurTarget, bytes32 winner)
    {
        MatchState storage m = matches[matchId];
        require(m.phase == PHASE_FINISHED, "BLACK_BOX_LOCKED");
        for (uint8 i = 0; i < SEATS; i++) {
            roles[i] = euint256.unwrap(m.role[i]);
            objectives[i] = euint256.unwrap(m.objective[i]);
        }
        saboteurTarget = euint256.unwrap(m.saboteurTarget);
        winner = euint256.unwrap(winnerByMatch[matchId]);
    }
}
