# MUTINY — 75 second judge demo

## 0–8s — the hook

Show two panels: the game UI and a Base transaction/handle.

**Voice:** “Everyone has something to hide. One crew member is destroying the ship, and only the blockchain knows the whole truth.”

Open your private role file. Do not reveal the other seats.

## 8–22s — sealed orders

Allocate energy and press **ENCRYPT + SEAL ORDERS**.

Show that the client sends ciphertext, not `reactor=2`, `life=1`, etc.

**Voice:** “Every player submits one encrypted turn. The contract can compute on it without exposing the allocations.”

## 22–35s — the lie

Resolve the round. Show aggregate claimed energy, then a damaged system.

**Voice:** “The Saboteur uses the same interface. Their apparent repair is converted into damage inside confidential state. Nobody can inspect the transaction to identify them.”

If possible, use the telemetry special and show a system reporting twenty points above its real state.

## 35–47s — private evidence

Use INVESTIGATE or CAPTAIN AUDIT and decrypt the result only in your wallet.

**Voice:** “Evidence is selective. An investigation tells me what I’m authorized to learn, not the hidden state itself.”

## 47–57s — sealed social vote

Open the ballot, submit an encrypted vote and resolve it.

**Voice:** “Discussion is public. The ballot is not. The chain reveals the ejection outcome, not who voted for whom.”

## 57–75s — BLACK BOX

Jump to the end of the prepared match. Press **DECLASSIFY OPERATION**.

Show:

- Saboteur identity
- `CLAIMED: REACTOR +3` versus `ACTUAL: REACTOR -3`
- `TRUE HEALTH` versus `REPORTED HEALTH`
- sealed votes
- winner

**Voice:** “After the game, Inco makes the classified handles public. BLACK BOX reconstructs every lie. Confidentiality is not a privacy skin here. Remove Inco and the game stops working.”

End on the title:

**MUTINY**

**Everyone has something to hide. One of you wants everyone dead.**
