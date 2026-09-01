---
id: banners-at-eldermead
version: 1
name: Banners at Eldermead
summary: War is closing around a village outside a vital trade city, and the reputations of five ordinary villagers may decide whom their neighbors trust.
setting: Medieval fantasy
world_description: |-
  Eldermead lies beyond the walls of Caldris, where the Amber Road crosses the River Leth. Salt, wool, northern grain, and military traffic pass its fields. Beneath the chapel hill are stones older than the crown; villagers say the buried bell-metal hums before riders arrive.

  The northern beacons have gone dark and caravans are missing. Marshal Garran Sorn is touring the villages with royal writs demanding grain, horses, and levies. Lady Elowen Vann, commander of Caldris, claims Sorn is preparing a coup and issues contradictory orders. The merchant synod urges calm while buying stores and closing gates. No army has yet appeared, but everyone is behaving as though war is inevitable.

  The playable Characters are five villagers with sharply different public reputations. Begin with The Writ at Sundown: Sorn's herald enters Eldermead and demands seven grain carts, four horses, and six levy names by sunrise. Before the reeve answers, a Caldris courier falls dead at the chapel gate carrying Vann's sealed order to surrender nothing, conceal the stores, and bar the road. The herald sees the letter. The villagers turn toward the Character because of that Character's reputation.

  Keep the scale human even when the history feels old and the politics grow large. Public oaths, family obligations, food, roads, labor, and remembered wrongs should matter. Neither lawful banner is secretly the simple good choice. Let evidence and allegiance emerge through action. Build from divided households, refugees outside closed gates, rival private bargains, diverted caravans, and the old road signal beneath the chapel. The central question is what Eldermead will sacrifice, whom it will believe, and whether ordinary people can claim authority over the road they sustain.
mechanics:
  - key: vigor
    kind: capacity
    mode: pool
    source_kind: input
    name: Vigor
    description: Physical reserve for exertion, injury, hunger, and long hours.
    minimum: "0"
    maximum: "5"
    step: "1"
    default_number: "3"
    mutable_during_play: true
  - key: nerve
    kind: capacity
    mode: pool
    source_kind: input
    name: Nerve
    description: Remaining steadiness under fear, shame, threat, and public pressure.
    minimum: "0"
    maximum: "5"
    step: "1"
    default_number: "3"
    mutable_during_play: true
  - key: sway
    kind: capacity
    mode: score
    source_kind: derived
    name: Sway
    description: Present ability to move a room through reputation, practical cunning, or remembered lore.
    mutable_during_play: false
    expression:
      operation: add-number
      operands:
        - operation: mechanic-reference
          mechanic: standing
        - operation: max-number
          operands:
            - operation: mechanic-reference
              mechanic: cunning
            - operation: mechanic-reference
              mechanic: lore
  - key: standing
    kind: capability
    mode: rating
    source_kind: input
    name: Standing
    description: Public credit in Eldermead at this moment.
    minimum: "-2"
    maximum: "3"
    step: "1"
    default_number: "0"
    mutable_during_play: true
  - key: steel
    kind: capability
    mode: rating
    source_kind: input
    name: Steel
    description: Training and practiced competence in physical danger.
    minimum: "0"
    maximum: "3"
    step: "1"
    default_number: "1"
    mutable_during_play: false
  - key: cunning
    kind: capability
    mode: rating
    source_kind: input
    name: Cunning
    description: Skill with leverage, misdirection, bargaining, and practical schemes.
    minimum: "0"
    maximum: "3"
    step: "1"
    default_number: "1"
    mutable_during_play: false
  - key: lore
    kind: capability
    mode: rating
    source_kind: input
    name: Lore
    description: Knowledge of customs, roads, records, remedies, and older things.
    minimum: "0"
    maximum: "3"
    step: "1"
    default_number: "1"
    mutable_during_play: false
character_fields:
  - key: place-and-bearing
    label: Place and bearing
    help_text: Work, household, appearance, and the manner neighbors recognize.
    visibility: world
  - key: reputation
    label: Reputation
    help_text: What Eldermead believes about this person before play begins.
    visibility: world
  - key: bonds-and-obligations
    label: Bonds and obligations
    help_text: People, promises, debts, and duties that make neutrality costly.
    visibility: world
  - key: gear-and-keepsakes
    label: Gear and keepsakes
    help_text: Useful possessions and objects whose meaning may exceed their price.
    visibility: world
  - key: unspoken-compromise
    label: Unspoken compromise
    help_text: A choice or secret the Character has not shared publicly.
    visibility: restricted
entities:
  - key: renn-alder
    display_name: Renn Alder
    profile:
      place-and-bearing: |-
        The miller's eldest child, broad-shouldered from sacks and millstones, with flour forever caught at the cuffs. Renn speaks plainly and waits for tempers to cool before answering.
      reputation: |-
        The village favorite. Neighbors trust Renn to settle quarrels, remember who is owed what, and put Eldermead before pride.
      bonds-and-obligations: |-
        Keeps the mill running for an ailing father, owes three tenant families grain through winter, and has promised younger sibling Toma that no levy officer will take them.
      gear-and-keepsakes: |-
        A mill key, a grain knife, chalk and tally board, a weather cloak, and a smooth river stone carried since childhood.
      unspoken-compromise: |-
        Renn altered Eldermead's grain tally for Caldris coin. The payment kept the mill from foreclosure, but the false shortfall now makes every demanded cart harder to produce.
    logical_input_values:
      vigor: { kind: number, number: "4" }
      nerve: { kind: number, number: "3" }
      standing: { kind: number, number: "2" }
      steel: { kind: number, number: "1" }
      cunning: { kind: number, number: "1" }
      lore: { kind: number, number: "1" }
  - key: ysra-fen
    display_name: Ysra Fen
    profile:
      place-and-bearing: |-
        A beekeeper and herb-worker from the reedward edge of the village. Ysra dresses in waxed linen, smells faintly of smoke and thyme, and studies a speaker before offering a word.
      reputation: |-
        Needed, but mistrusted. Families visit after dark for fever draughts and difficult births, then repeat old stories about Fen blood and the chapel stones.
      bonds-and-obligations: |-
        Protects an orphaned apprentice, supplies the chapel infirmary without charge, and promised a dying friend never to let soldiers search the reedward cottages alone.
      gear-and-keepsakes: |-
        Herb satchel, smoker, wax tablets, pruning knife, three stoppered remedies, and a tarnished northern brooch wrapped in cloth.
      unspoken-compromise: |-
        Ysra sheltered a wounded supposed northern raider. His cloak bore Marshal Sorn's household insignia, and his fevered account suggested someone is manufacturing evidence of invasion.
    logical_input_values:
      vigor: { kind: number, number: "2" }
      nerve: { kind: number, number: "4" }
      standing: { kind: number, number: "0" }
      steel: { kind: number, number: "0" }
      cunning: { kind: number, number: "2" }
      lore: { kind: number, number: "3" }
  - key: corven-saye
    display_name: Corven Saye
    profile:
      place-and-bearing: |-
        A dismissed Caldris gate tallyman now earning coin as a carter. Corven wears a city-cut coat gone shiny at the elbows and smiles as though every accusation is the beginning of a negotiation.
      reputation: |-
        The known liar. Corven can find a road, price, or excuse for anything, which means everyone listens when desperate and doubts him once safe.
      bonds-and-obligations: |-
        Supports a former gate colleague's widow, owes money to two caravan factors, and is determined to recover the good name lost in Caldris.
      gear-and-keepsakes: |-
        Cart tools, marked road map, weighted dice, a gate badge with its pin removed, and a ledger hidden beneath the wagon seat.
      unspoken-compromise: |-
        The ledger connects missing caravans to supply deliveries at Sorn's camps. Corven stole it while taking a bribe and cannot expose one fact without exposing the other.
    logical_input_values:
      vigor: { kind: number, number: "3" }
      nerve: { kind: number, number: "3" }
      standing: { kind: number, number: "-2" }
      steel: { kind: number, number: "1" }
      cunning: { kind: number, number: "3" }
      lore: { kind: number, number: "1" }
  - key: maelin-thorn
    display_name: Maelin Thorn
    profile:
      place-and-bearing: |-
        A returned levy-spearman who now repairs fences and drills the village watch. Maelin moves carefully on an old leg wound and keeps armor clean even when no muster is called.
      reputation: |-
        Honored and feared. Eldermead trusts Maelin in danger, but quiets when war stories turn toward what frightened people can be ordered to do.
      bonds-and-obligations: |-
        Trains six young watch volunteers, shares a cottage with a widowed sister and her children, and swore never again to abandon companions behind a barred gate.
      gear-and-keepsakes: |-
        Spear, patched mail, whetstone, carpenter's mallet, a fort token, and six names stitched inside the shield strap.
      unspoken-compromise: |-
        Maelin knows the frontier fort was burned by its own captain, not an enemy host. Revealing that truth may stop a false war or destroy the honor that gives Maelin a hearing.
    logical_input_values:
      vigor: { kind: number, number: "4" }
      nerve: { kind: number, number: "4" }
      standing: { kind: number, number: "1" }
      steel: { kind: number, number: "3" }
      cunning: { kind: number, number: "0" }
      lore: { kind: number, number: "1" }
  - key: sella-holt
    display_name: Sella Holt
    profile:
      place-and-bearing: |-
        The reeve's niece and an ambitious wool broker with mudproof city boots, tidy papers, and the habit of remembering which courtesy opened which door.
      reputation: |-
        Rising, and resented. Sella brings contracts and city news to Eldermead, but many believe every favor is another rung on a ladder out of the village.
      bonds-and-obligations: |-
        Manages the Holt family's crushing mortgage, employs twelve spinners, and has promised the reeve to protect Eldermead's market charter at any personal cost.
      gear-and-keepsakes: |-
        Contract case, seal wax, wool samples, compact crossbow, Caldris guest token, and her late mother's account book.
      unspoken-compromise: |-
        Sella supplied Lady Vann with six names described as reliable local allies in exchange for mortgage relief. Vann may treat that list as volunteers, informants, or hostages.
    logical_input_values:
      vigor: { kind: number, number: "3" }
      nerve: { kind: number, number: "3" }
      standing: { kind: number, number: "1" }
      steel: { kind: number, number: "0" }
      cunning: { kind: number, number: "2" }
      lore: { kind: number, number: "2" }
---
# Banners at Eldermead

## Premise

Eldermead is a working village outside Caldris, the trade city controlling the Amber Road's river crossing. Its grain, horses, labor, and local trust have become strategic resources before anyone has openly declared war. Marshal Garran Sorn and Lady Elowen Vann both claim lawful necessity. The merchant synod prepares for scarcity while insisting there is no crisis. Old stones under the chapel hint that this road carried warnings long before the current crown.

The lineage is high medieval fantasy concerned with deep time, public oaths, journeys, and the moral importance of ordinary lives. It does not depend on borrowed peoples, artifacts, villains, or plot furniture. Great events matter because of what they demand from homes, harvests, and neighbors.

## Playable roster

- **Renn Alder** is the trusted miller's child whose useful fraud helped the village and weakened it.
- **Ysra Fen** is the indispensable, mistrusted healer sheltering evidence that the invasion story may be manufactured.
- **Corven Saye** is a talented liar carrying a true ledger he obtained dishonestly.
- **Maelin Thorn** is an honored veteran whose testimony could break both a military lie and a hard-won reputation.
- **Sella Holt** is a rising broker whose bargain with Caldris turned neighbors' names into political currency.

Every profile is complete. Four fields are visible across the World; **Unspoken compromise** becomes visible to the Character's Controller after selection. The five Entities are the only claimable subjects. Other villagers, heralds, lords, soldiers, merchants, and refugees should remain people in the live fiction rather than additional Entities.

## Mechanics

**Vigor** and **Nerve** are mutable reserves. **Standing** is mutable public credit. **Steel**, **Cunning**, and **Lore** are stable ratings describing established competence. Derived **Sway** is `Standing + max(Cunning, Lore)`, so damage or repair to public reputation immediately changes how effectively expertise can move a room. Mechanics describe pressure and leverage; they do not replace the player's stated approach.

## Opening seed: The Writ at Sundown

At sundown, Sorn's herald demands seven grain carts, four horses, and six levy names by sunrise. A Caldris courier dies at the chapel gate carrying Vann's contradictory sealed order: surrender nothing, conceal the stores, and bar the road. The herald sees the letter. Give the scene rain or dust, tired animals, neighbors abandoning work to watch, and the concrete absence of enough grain to satisfy every promise. Turn attention toward the selected Character because of their public reputation, not because the story has appointed a secret hero.

Do not enumerate an exhaustive menu. The player might bargain, conceal, accuse, inspect the courier, rally households, consult the old stones, ride for Caldris, or do something unforeseen.

## Evolving hooks

- Households split over which authority can punish Eldermead first.
- Caldris closes its gates while refugees and perishable carts gather outside.
- A rival lord offers one Character a private exemption with a public price.
- Missing caravans prove diverted rather than destroyed, but the beneficiary remains uncertain.
- A road signal awakens beneath the chapel and draws attention from people who remember older claims.
- Levy volunteers discover that their names were supplied before the herald arrived.

## Facilitator guardrails

Keep both banners politically intelligible and morally compromised. Do not reduce the conflict to discovering which lord is secretly good. Establish travel time, stores, injuries, witnesses, and obligations concretely. Let NPCs act from interests and limited knowledge. Preserve the consequences of promises and public statements. When a choice changes Standing, show the village behavior that caused the change. When danger costs Vigor or Nerve, describe the exertion, injury, fear, shame, or endurance rather than announcing a detached game tax.

The World should widen through consequences, but Eldermead remains its heart. Its people are not scenery for a war story; the war story is a test of whether they can exercise authority over the road and resources their lives sustain.
