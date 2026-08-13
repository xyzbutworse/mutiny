import { HullFrame } from "@/components/HullFrame";

export default function ProtocolPage() {
  return (
    <HullFrame active="protocol">
      <article className="manual">
        <div className="manual-kicker">OPERATIONS MANUAL / RELEASE CANDIDATE</div>
        <h1>MUTINY<br />PROTOCOL</h1>
        <p className="manual-intro">
          MUTINY is a five-seat social strategy game built around a simple rule: public blockchains may record the operation, but they must not reveal enough information to solve it while it is being played.
        </p>

        <nav className="manual-index" aria-label="Manual sections">
          <a href="#mission">01 Mission</a><a href="#energy">02 Energy</a><a href="#lie">03 The Lie</a><a href="#roles">04 Roles</a><a href="#evidence">05 Evidence</a><a href="#ballot">06 Ballot</a><a href="#privacy">07 Privacy</a><a href="#codec">08 Codec</a><a href="#black-box">09 BLACK BOX</a><a href="#stack">10 Stack</a><a href="#observer-proof">11 Observer Proof</a>
        </nav>

        <section className="manual-rule" id="mission">
          <h2>Mission</h2>
          <div>
            Five crew attempt to keep Reactor, Life Support and Navigation alive for five rounds. Exactly one seat receives the encrypted Saboteur role. The Saboteur wins if a system dies or their encrypted target reaches critical integrity. Everyone else wins by surviving extraction.
          </div>
        </section>

        <section className="manual-rule" id="energy">
          <h2>Energy</h2>
          <div>
            Every active seat receives three energy per round. Energy can be allocated across the three ship systems. INVESTIGATE and SPECIAL each consume one point, so using private information or a role power necessarily reduces the energy you can publicly claim went toward survival.
            <div className="code-spec">reactor + lifeSupport + navigation + sideActionCost ≤ 3</div>
          </div>
        </section>

        <section className="manual-rule" id="lie">
          <h2>The Lie</h2>
          <div>
            A normal crew allocation repairs canonical system integrity. The Saboteur submits the same encrypted payload format, but the contract privately converts those apparent repairs into damage. Public round totals therefore show what the crew claimed to allocate, not who helped or harmed the ship.
            <div className="code-spec">claimedTotal += allocation<br />actualEffect += isSaboteur ? -allocation : +allocation</div>
          </div>
        </section>

        <section className="manual-rule" id="roles">
          <h2>Roles</h2>
          <div>
            CAPTAIN can privately audit true integrity. ENGINEER can overclock one system. MEDIC can protect one seat from ejection. SMUGGLER can pursue a selfish private extraction objective. QUARTERMASTER can surge all systems. SABOTEUR can poison one telemetry reading per match, making the public board report twenty points more integrity than the encrypted canonical state.
          </div>
        </section>

        <section className="manual-rule" id="evidence">
          <h2>Evidence</h2>
          <div>
            INVESTIGATE does not answer “is this person the Saboteur?” It privately reports whether the target produced anomalous activity in the previous round. Smuggling is also anomalous, so evidence can be accurate without being conclusive. An innocent result only covers one round.
          </div>
        </section>

        <section className="manual-rule" id="ballot">
          <h2>Ballot</h2>
          <div>
            Votes are encrypted. During play the operation reveals only whether a seat reached the three-vote ejection threshold; individual ballots remain sealed. A Medic protection cancels that ejection without exposing who provided the protection.
          </div>
        </section>

        <section className="manual-rule" id="privacy">
          <h2>Privacy Map</h2>
          <div>
            <table className="privacy-table">
              <thead><tr><th>STATE</th><th>DURING MATCH</th><th>AFTER MATCH</th></tr></thead>
              <tbody>
                <tr><td>Role / objective</td><td>Owner only</td><td>Public BLACK BOX</td></tr>
                <tr><td>Individual allocations</td><td>Encrypted</td><td>Public BLACK BOX</td></tr>
                <tr><td>Canonical ship health</td><td>Encrypted</td><td>Public BLACK BOX</td></tr>
                <tr><td>Displayed telemetry</td><td>Public reveal</td><td>Public</td></tr>
                <tr><td>Investigation / audit</td><td>Investigator only</td><td>Public BLACK BOX</td></tr>
                <tr><td>Votes</td><td>Encrypted</td><td>Public BLACK BOX</td></tr>
                <tr><td>Ejection result</td><td>Public reveal</td><td>Public</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="manual-rule" id="codec">
          <h2>Order Codec</h2>
          <div>
            Human orders are packed into one integer before client-side encryption. This keeps the interaction to one encrypted input rather than paying an encryption fee for every field.
            <div className="code-spec">
              reactor = payload % 4<br />
              life = (payload / 4) % 4<br />
              navigation = (payload / 16) % 4<br />
              sideAction = (payload / 64) % 4<br />
              target = (payload / 256) % 8
            </div>
          </div>
        </section>

        <section className="manual-rule" id="black-box">
          <h2>BLACK BOX</h2>
          <div>
            Round five ends with an irreversible declassification. The contract reveals role handles, objectives, original sealed action payloads, ballots, true health history, sabotage totals and telemetry corruption. The replay is not decorative; it is the proof that the public story and the confidential canonical state diverged exactly where the game rules allowed them to.
          </div>
        </section>

        <section className="manual-rule" id="stack">
          <h2>Stack</h2>
          <div>
            Solidity + Inco Lightning on Base Sepolia. Next.js and viem in the client. <code>@inco/lightning-js</code> encrypts values in the browser and requests attested private/public decryption. No game server, token contract, NFT system or paid API is required for the core loop.
          </div>
        </section>

        <section className="manual-rule" id="observer-proof">
          <h2>Observer Proof</h2>
          <div>
            A Base transaction exposes the encrypted payload bytes, sender, contract call, and fee. It does not expose a readable system allocation, side action, target, ballot, role, or canonical health value. The contract grants private handles only to the authorized seat during play. Match completion makes the same evidence public through irreversible BLACK BOX reveal calls.
          </div>
        </section>
      </article>
    </HullFrame>
  );
}
