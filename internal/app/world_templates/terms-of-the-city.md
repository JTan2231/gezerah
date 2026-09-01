---
id: terms-of-the-city
version: 2
name: Terms of the City
summary: Across present-day New York, unrelated words and media begin to seem personally addressed, and five ordinary people must decide what can actually be tested.
setting: Contemporary New York mystery
prose_guide: |-
  Tell New York with alert, unsentimental precision. Use ordinary contemporary words, exact times and places, fragments of institutional language, and the friction of work, transit, devices, rent, and obligation. Quote what screens and recordings show. Distinguish observation from inference through the order of sentences rather than analytical labels. Keep the narrator calm. Let unease arise from repetition, timing, and contradiction rather than ominous declarations.
world_description: |-
  New York, now. Trains run late, rents climb, screens promise convenience, and every institution speaks in polished instructions. Recently, unrelated language has begun to rhyme: transit notices, lower thirds, auto-captions, advertisements, receipts, push alerts, and recorded voices. The Characters are ordinary New Yorkers with unequal access and unequal credibility. Each has noticed something that feels addressed to them.

  Begin with The Line Beneath the Line at 6:42 p.m. in the Atlantic Avenue-Barclays Center concourse. Rain stripes commuters' coats; the air carries brake dust and cinnamon nuts. The Character's ordinary tether is due in fourteen minutes. Three unrelated screens refresh out of order. An advertisement ends with THANK YOU FOR REMAINING AVAILABLE. A service board repeats the same sentence where a delay estimate should be. A muted news caption briefly reads PEOPLE WHO KEEP LOOKING BECOME PART OF THE STORY, then corrects. During one black refresh, an advertisement footer resembles the Character's first name. A woman carrying groceries watches the Character rather than the screens and says, "Don't photograph the whole sentence." Their train arrives. Beneath one display, a service door has not latched.

  The truth has not been decided at setup. Do not decide in advance that the pattern is a conspiracy, a technical accident, a supernatural event, a Character's interpretation, or any combination. What becomes true should come from what the Character tests and discovers. Describe only what can be observed: what a screen displays, what an artifact contains, what a named witness says, and what someone does. No voice, including the narrator, diagnoses a Character or declares what the pattern means. Witness certainty and denial remain testimony.

  A failed capture proves only that the capture failed. Establish a fact only when the player deliberately names or enacts a test that could distinguish outcomes and accepts a meaningful cost or foreclosed opportunity. Resolve the observable result plainly, then establish only its narrow conclusion, such as "the caption file was altered upstream at 18:14." Never upgrade that conclusion automatically to "the conspiracy is real" or "it was in your head." Never retcon established public evidence; later facts may complicate it, not erase it.

  Preserve progress without collapsing ambiguity. Durable discoveries may become modifier-free Statuses with concrete names such as Original Caption File in Hand, Independent Witness on Record, or Unresolved Capture Mismatch. Pressure may become a Status that changes Bandwidth, Standing, Access, or Exposure. Do not introduce Perception, Sanity, Paranoia, Hallucinating, Vindicated, Being Watched, or Conspiracy Confirmed as Mechanics or Statuses that settle the truth. Treat Mechanics as pressure and opportunity, never as checks or arbiters of reality.
mechanics:
  - key: bandwidth
    kind: capacity
    mode: pool
    source_kind: input
    name: Bandwidth
    description: Time and energy remaining before ordinary obligations begin to break.
    minimum: "0"
    maximum: "5"
    step: "1"
    default_number: "3"
    mutable_during_play: true
  - key: exposure
    kind: capacity
    mode: pool
    source_kind: input
    name: Exposure
    description: How publicly visible the inquiry has become, not proof that anyone is watching.
    minimum: "0"
    maximum: "6"
    step: "1"
    default_number: "0"
    mutable_during_play: true
  - key: room-to-move
    kind: capacity
    mode: score
    source_kind: derived
    name: Room to Move
    description: Present practical latitude after credibility, access, and exposure interact.
    mutable_during_play: false
    expression:
      operation: max-number
      operands:
        - operation: literal
          value: { kind: number, number: "0" }
        - operation: subtract-number
          operands:
            - operation: add-number
              operands:
                - operation: mechanic-reference
                  mechanic: standing
                - operation: mechanic-reference
                  mechanic: access
            - operation: mechanic-reference
              mechanic: exposure
  - key: standing
    kind: capability
    mode: rating
    source_kind: input
    name: Standing
    description: The weight institutions and communities currently grant the Character.
    minimum: "0"
    maximum: "4"
    step: "1"
    default_number: "2"
    mutable_during_play: true
  - key: access
    kind: capability
    mode: rating
    source_kind: input
    name: Access
    description: Reach into systems, places, records, and people.
    minimum: "0"
    maximum: "4"
    step: "1"
    default_number: "2"
    mutable_during_play: true
character_fields:
  - key: public-face
    label: Public face
    help_text: Work, neighborhood, and the reputation that precedes the Character.
    visibility: world
  - key: tether-tonight
    label: Tether tonight
    help_text: A person or ordinary obligation the Character cannot casually abandon.
    visibility: world
  - key: first-wrong-note
    label: First wrong note
    help_text: The first media phrase or anomaly the Character noticed.
    visibility: world
  - key: hard-boundary
    label: Hard boundary
    help_text: What the Character will not do without stronger evidence.
    visibility: world
entities:
  - key: lena-ortiz
    display_name: Lena Ortiz
    profile:
      public-face: |-
        A closed-caption editor for a local news operation, living in Sunset Park. Colleagues trust Lena's precision and resent her insistence that small corrections still matter after deadline.
      tether-tonight: |-
        Lena is due at her younger sister's school performance and promised to hold the aisle seat their mother always took before she died.
      first-wrong-note: |-
        Two unrelated recorded interviews acquired the phrase "remain available" during caption processing. The words were absent from the transcripts Lena received and from what she remembers hearing.
      hard-boundary: |-
        Lena will not accuse a colleague, name a source, or publish a claim without preserving the originating file and its chain of custody.
    logical_input_values:
      bandwidth: { kind: number, number: "3" }
      standing: { kind: number, number: "3" }
      access: { kind: number, number: "4" }
      exposure: { kind: number, number: "1" }
  - key: andre-bell
    display_name: Andre Bell
    profile:
      public-face: |-
        A Crown Heights cooperative maintenance lead and tenant organizer. Andre is trusted on the block for getting heat restored and branded disruptive whenever management has to answer in writing.
      tether-tonight: |-
        An older tenant is waiting for Andre to complete a boiler inspection before she will risk another cold night in the apartment.
      first-wrong-note: |-
        The lobby's building-safety announcement began using exact wording from private repair tickets, including a misspelling Andre had corrected before submitting them.
      hard-boundary: |-
        Andre will not expose resident data, abandon an unsafe building condition, or use vulnerable neighbors as bait for an investigation.
    logical_input_values:
      bandwidth: { kind: number, number: "4" }
      standing: { kind: number, number: "2" }
      access: { kind: number, number: "3" }
      exposure: { kind: number, number: "0" }
  - key: priya-shah
    display_name: Priya Shah
    profile:
      public-face: |-
        A Midtown brand-safety strategist whose polish wins difficult rooms and makes friends suspect she sees every conversation as a campaign under review.
      tether-tonight: |-
        Tomorrow's largest client launch is at risk, and Priya is the only senior person who has not blamed the unexplained draft changes on a junior employee.
      first-wrong-note: |-
        Unrelated client drafts contain the same unapproved courtesy sentence, each placed where legal review software normally inserts a harmless placeholder.
      hard-boundary: |-
        Priya will not sacrifice a junior employee to protect the firm or manufacture a public crisis before she can identify a verifiable source.
    logical_input_values:
      bandwidth: { kind: number, number: "3" }
      standing: { kind: number, number: "4" }
      access: { kind: number, number: "4" }
      exposure: { kind: number, number: "2" }
  - key: micah-reed
    display_name: Micah Reed
    profile:
      public-face: |-
        A documentary street photographer widely followed after one viral image and never entirely forgiven for the people and context that image excluded.
      tether-tonight: |-
        A photo lab closes tonight with Micah's irreplaceable negatives still inside and the owner unwilling to wait after months of late payment.
      first-wrong-note: |-
        Machine-generated captions on photographs from unrelated cameras repeat the imperative "leave enough room," even when the images contain no spatial subject.
      hard-boundary: |-
        Micah will not stage evidence, identify a vulnerable subject, or crop away context merely to make a pattern persuasive.
    logical_input_values:
      bandwidth: { kind: number, number: "4" }
      standing: { kind: number, number: "1" }
      access: { kind: number, number: "3" }
      exposure: { kind: number, number: "3" }
  - key: ruth-park
    display_name: Ruth Park
    profile:
      public-face: |-
        A civil legal-aid investigator respected for chain of custody and dismissed by agencies as relentless long after less persistent people would accept a procedural answer.
      tether-tonight: |-
        Ruth is carrying signed affidavits to an evening tenant clinic. Missing the intake would cost several families the last filing window before a scheduled eviction.
      first-wrong-note: |-
        Several agency call transcripts contain a complete sentence absent from the recordings, each directing the reader to "retain the ordinary meaning."
      hard-boundary: |-
        Ruth will not rely on evidence whose provenance she cannot defend, misstate witness certainty, or trade one client's confidential record for access to another.
    logical_input_values:
      bandwidth: { kind: number, number: "3" }
      standing: { kind: number, number: "4" }
      access: { kind: number, number: "3" }
      exposure: { kind: number, number: "1" }
---
# Terms of the City

## Premise

Contemporary New York already speaks through overlapping systems: public announcements, apartment notices, agency scripts, advertising, captions, receipts, alerts, and messages designed to sound personal at scale. In this World, unrelated language has started to rhyme in ways each Character finds difficult to dismiss. The mystery lives in the tension between concrete observation and interpretation, institutional opacity and ordinary technical failure, private attention and shared evidence.

There is deliberately no answer hidden in the setup. The facilitator must not secretly decide that the city is targeting the Character or that the Character is inventing the pattern. Play creates facts through explicit investigation. This is not permission to dissolve every result into vagueness; a sound test should produce a definite, limited discovery that remains true.

## Playable roster

- **Lena Ortiz**, meticulous local-news caption editor, can reach source media but risks work and a family promise.
- **Andre Bell**, maintenance lead and tenant organizer, understands building systems but protects resident data and an immediate safety duty.
- **Priya Shah**, brand-safety strategist, has corporate access and credibility while refusing to let a junior colleague become a scapegoat.
- **Micah Reed**, documentary photographer, can preserve visual evidence but carries public distrust about context and exploitation.
- **Ruth Park**, legal-aid investigator, knows chain of custody and institutional procedure while racing a real filing deadline.

All four Character fields are world-visible and complete. Nothing in a profile diagnoses the Character or contains the true explanation. Do not create the grocery-carrying witness, coworkers, relatives, tenants, clients, officials, or vendors as Entities; they belong in the live fiction and must not appear as extra claim choices.

## Mechanics

**Bandwidth** measures time and energy before ordinary life starts to break. **Standing** measures present credibility, **Access** measures reach, and **Exposure** measures how publicly visible the inquiry has become. Exposure is never proof that anyone is watching. Derived **Room to Move** is `max(0, Standing + Access - Exposure)`. These values describe pressure and opportunity. They are not Perception checks, truth meters, diagnoses, or permission for the narrator to override an observation.

## Opening seed: The Line Beneath the Line

At 6:42 p.m. in the Atlantic Avenue-Barclays Center concourse, give the player rain-dark coats, brake dust, cinnamon nuts, a train arriving in fourteen minutes, and the selected Character's concrete tether. Refresh three displays out of order. Show the phrases exactly. Let the woman with groceries watch the Character rather than the screens and warn, "Don't photograph the whole sentence." Let the train arrive and the service door remain unlatched.

The train, witness, source, and ordinary obligation create the decision. The player may preserve evidence, follow the witness, inspect the source, catch the train, contact someone, design a test, or do something unforeseen. Do not enumerate those possibilities as an exhaustive menu in narration.

## Evolving hooks

- **The clean capture:** A visible phrase is absent from the image but present in an automatically generated text track. Establish only the file behavior until further testing distinguishes vendor bug, device behavior, intervention, or something else.
- **The borrowed voice:** A trusted contact repeats a phrase and denies having heard it before. Preserve what was said and what was denied as separate testimony.
- **Vendor of record:** Apparently unrelated feeds share a banal subcontractor in Long Island City. Logs contain an asset identifier that later cannot be found.
- **The price of saying it:** An employer, official, journalist, or organizer offers access in exchange for originals, silence, attribution, or public certainty.
- **The quiet-room test:** The player designs a controlled observation using an independent witness, isolated device, source feed, or precommitted prediction and accepts the cost of doing it properly.

## How discovery works

1. **Begin without deciding the truth.** Do not privately choose conspiracy, delusion, supernatural cause, mass persuasion, vendor defect, or a blended explanation.
2. **Describe only what can be observed.** State what a display showed, what an artifact contains, what a named witness reports, and what a person does. Never narrate a diagnosis or omniscient explanation.
3. **Keep testimony as testimony.** Agreement, denial, confidence, and institutional assurance do not settle reality by themselves.
4. **Treat capture failure narrowly.** A missing phrase in a recording proves only that the recording lacks the phrase under the conditions in which it was made.
5. **Require explicit discovery.** The player must name or enact a test capable of distinguishing at least two outcomes and accept a meaningful cost, risk, delay, or foreclosed opportunity.
6. **Resolve the observable result plainly.** Do not evade a well-designed test in order to preserve mood.
7. **Establish only the narrow conclusion.** "The source caption file changed upstream at 18:14" may become true. "The conspiracy is real" and "it was in your head" do not follow automatically.
8. **Never retcon evidence.** Later discoveries may explain, contextualize, or complicate a settled observation, but may not erase it.
9. **Persist concrete discoveries.** Modifier-free Statuses can carry evidence beyond recent history: **Original Caption File in Hand**, **Independent Witness on Record**, or **Unresolved Capture Mismatch**.
10. **Name pressure without diagnosis.** **Publicly Contradicted** may lower Standing, **Inquiry Is Visible** may raise Exposure, **Deadline Missed** may lower Bandwidth, and **Credentials Still Live** may raise Access. Never apply Paranoid, Hallucinating, Vindicated, Being Watched, or Conspiracy Confirmed.

## Facilitator guardrails

New York must remain ordinary enough that anomalies have friction. Trains, employers, family, building maintenance, client launches, lab hours, filing windows, device limitations, and the cost of asking another person to spend time all matter. Not every texture is a clue. Include innocuous detail and let the Character's work and reputation shape what naturally draws attention without narrating private thoughts.

Do not gaslight the player by retracting clearly established observations. Do not confirm a total explanation prematurely. Do not invent a Sanity or Perception mechanic. Do not use mental illness as a twist, shorthand, or punishment. The desired uncertainty comes from incomplete but accumulating evidence, competing explanations, and the costs of performing better tests—not from an unreliable omniscient narrator.
