# MUTINY — submission draft

## One-line pitch

Everything you need to cheat is already onchain. You still cannot see it.

## What it is

MUTINY is a five-seat confidential social strategy game on Base Sepolia using Inco Lightning. The crew must keep Reactor, Life Support, and Navigation alive for five rounds while one secretly assigned Saboteur tries to destroy a confidential target.

Every player submits the same sealed order format. Loyal allocations repair the ship. The Saboteur's apparently identical allocations are converted into damage inside confidential state. Individual orders, roles, investigations, canonical ship health, and ballots stay hidden during play. Only aggregate claimed energy, displayed telemetry, discussion, and the ejection result are public.

The Saboteur may poison one telemetry reading, making the public board report a healthier system than the encrypted canonical state. The Captain can spend a special action to privately audit true health. Investigations produce imperfect evidence rather than revealing a role. The Smuggler can also generate anomalous activity, giving innocent players a reason to look guilty.

After the fifth round, BLACK BOX irreversibly reveals the match handles and reconstructs the operation: every role and objective, claimed allocation versus actual effect, true versus displayed health, sealed ballot, sabotage total, poisoned telemetry event, and the winner.

## Why Inco

MUTINY is not a normal game with privacy added afterward. If the encrypted state became public, the deduction game collapses: players could inspect who damaged each system, read every ballot, see the Saboteur target, and detect poisoned telemetry from transaction data.

Inco Lightning is used for:

- client-side encrypted human orders and ballots;
- encrypted roles and objectives;
- confidential random role/target assignment;
- arithmetic on sealed allocations;
- encrypted role-dependent branching with comparisons and selection;
- private investigation and Captain audit handles;
- confidential canonical system health;
- selective public reveal of aggregate/displayed telemetry;
- irreversible post-match BLACK BOX declassification.

## Built with

- Solidity 0.8.30
- Inco Lightning
- Base Sepolia
- Next.js 15
- React 19
- TypeScript
- viem

## Design

The interface avoids a wallet-first Web3 dashboard. It is framed as a damaged 1970s spacecraft/submarine operations console: vertical hull navigation, CRT scanlines, restrained ivory/oxide instrumentation, classified role files, sealed command controls, and a dedicated BLACK BOX declassification view.

## Judge path

1. Open the local simulation and understand a complete match immediately without a wallet.
2. Open Onchain Operations and connect a Base Sepolia wallet.
3. Create a match and fill empty seats with confidential onchain bots.
4. Decrypt only your own role.
5. Encrypt and submit one packed three-energy order.
6. Resolve the round and reveal only public aggregate/displayed telemetry.
7. Decrypt private evidence.
8. Transmit a public accusation.
9. Submit a sealed ballot and reveal only the ejection result.
10. Open a completed operation and declassify BLACK BOX.

The target visual proof is one uninterrupted sequence: `EVERYONE HAS SOMETHING TO HIDE` → confidential dossier → encrypted contribution → ciphertext-only transaction → hidden sabotage → poisoned telemetry → confidential ballot → BLACK BOX → `CLAIMED +3 / ACTUAL -3` → true health versus reported health.

## Proof assets

- `docs/screenshots/landing-desktop.png`
- `docs/screenshots/landing-mobile.png`
- `docs/screenshots/confidential-dossier.png`
- `docs/screenshots/poisoned-telemetry.png`
- `docs/screenshots/black-box-deception.png`
- `frontend/public/og-mutiny.png`

## What we deliberately did not add

No token, NFTs, marketplace, paid backend, LLM dependency, or oversized 3D world. The product is scoped around the confidential mechanic and a complete playable loop.
