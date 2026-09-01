---
id: the-courtesy-season
version: 1
name: The Courtesy Season
summary: Bellwether has eliminated scarcity beautifully, but five privileged insiders are beginning to see whose sleep, memory, and civic future pay for their comfort.
setting: Utopian/dystopian cyberpunk
world_description: |-
  In 2189, Bellwether rises on pale terraces above a drowned delta. Upper-city life is genuinely extraordinary: silent transit, preventive medicine, fruiting gardens, reversible bodily alterations, and weather delivered by invitation.

  During the forty-day Courtesy Season, heirs, artists, physicians, and civic hosts gather for exhibitions, dinners, romances, and appointments. Their collective preferences feed the Concordance, which allocates residency, medicine, water, and energy throughout Bellwether. The Courtesy Mesh anticipates every elite desire and renders distressing sights as tasteful abstractions.

  Officially, the system's cognition is synthetic and everyone participates voluntarily. This year, impossible intimacies are leaking through it. Attendants know dead relatives' pet names. Deleted faces appear in commissioned art. Whole districts disappear from maps after awkward social moments.

  Begin at the Season's First Supper. An attendant freezes beside the Character and repeats something from a memory official records say cannot exist. The Courtesy Filter turns the attendant into a decorative fault while everyone else hears a harp tone. The host requests approval for routine reconciliation. Across the room, guests applaud news that a lower district has voluntarily contributed enough sleep-hours to cool tonight's rain.

  Bellwether's achievements are real. Its medicine saves lives, its gardens shelter people, and destabilizing it has consequences. Exploited residents have names, expertise, factions, and conflicting goals; they are not a single innocent mass waiting for an elite savior. Keep the surface porcelain, cultivated, fashionable, and calm rather than defaulting to rain-soaked neon. The central question is what an implicated insider will surrender when justice becomes personally expensive.
mechanics:
  - key: favors
    kind: capacity
    mode: pool
    source_kind: input
    name: Favors
    description: Social debts and invitations that can still be called in.
    minimum: "0"
    maximum: "6"
    step: "1"
    default_number: "3"
    mutable_during_play: true
  - key: composure
    kind: capacity
    mode: pool
    source_kind: input
    name: Composure
    description: Reserve for maintaining intention and bearing under intimate pressure.
    minimum: "0"
    maximum: "6"
    step: "1"
    default_number: "4"
    mutable_during_play: true
  - key: civic-exposure
    kind: capacity
    mode: pool
    source_kind: input
    name: Civic Exposure
    description: How visible the Character's deviation has become to Bellwether's allocating institutions.
    minimum: "0"
    maximum: "6"
    step: "1"
    default_number: "1"
    mutable_during_play: true
  - key: latitude
    kind: capacity
    mode: score
    source_kind: derived
    name: Latitude
    description: Present room to act without immediate institutional containment.
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
                  mechanic: bearing
                - operation: mechanic-reference
                  mechanic: favors
            - operation: mechanic-reference
              mechanic: civic-exposure
  - key: bearing
    kind: capability
    mode: rating
    source_kind: input
    name: Bearing
    description: Practiced command of elite ritual, attention, and social space.
    minimum: "0"
    maximum: "5"
    step: "1"
    default_number: "3"
    mutable_during_play: false
  - key: systems-fluency
    kind: capability
    mode: rating
    source_kind: input
    name: Systems Fluency
    description: Ability to understand, redirect, or penetrate Bellwether's technical systems.
    minimum: "0"
    maximum: "5"
    step: "1"
    default_number: "2"
    mutable_during_play: false
  - key: courtesy-filter
    kind: capability
    mode: binary
    source_kind: input
    name: Courtesy Filter
    description: Whether the Character's installed overlay is presently mediating distressing civic reality.
    mutable_during_play: true
character_fields:
  - key: place-at-the-table
    label: Place at the Table
    help_text: The Character's formal place within Bellwether's elite society.
    visibility: world
  - key: public-reputation
    label: Public Reputation
    help_text: The admired, feared, or disreputable story attached to the Character.
    visibility: world
  - key: signature-alteration
    label: Signature Alteration
    help_text: A visible or known bodily technology associated with the Character.
    visibility: world
  - key: unfashionable-attachment
    label: Unfashionable Attachment
    help_text: A person, practice, place, or object loved beyond what fashion permits.
    visibility: world
  - key: cost-of-comfort
    label: Cost of Comfort
    help_text: A specific harm hidden inside the Character's privileged life.
    visibility: restricted
  - key: memory-the-mesh-rejects
    label: Memory the Mesh Rejects
    help_text: A memory that Bellwether's records or overlays refuse to hold cleanly.
    visibility: restricted
entities:
  - key: mara-lysen
    display_name: Mara Lysen
    profile:
      place-at-the-table: |-
        Heir to Lysen Hydrics and ceremonial patron of the Season's public gardens. Hosts compete to seat Mara where every charitable camera can find her.
      public-reputation: |-
        The saint of the cisterns. Mara's cooling gardens made elite abundance appear generous, local, and ecologically healed.
      signature-alteration: |-
        A translucent vascular lattice at the wrists changes color with air quality and blooms gold when Mara authorizes a civic grant.
      unfashionable-attachment: |-
        Mara still visits an elderly childhood tutor in an unfavored mid-terrace residence and keeps the tutor's handwritten lessons rather than memory-polished copies.
      cost-of-comfort: |-
        Mara signed the emergency exception that erased three residential blocks from the allocation map so the gardens would never miss a cooling cycle.
      memory-the-mesh-rejects: |-
        At age twelve, Mara followed the tutor through a service corridor and saw sleeping residents wired into a wall of white diagnostic light. Every official replay replaces them with irrigation pumps.
    logical_input_values:
      bearing: { kind: number, number: "5" }
      systems-fluency: { kind: number, number: "2" }
      favors: { kind: number, number: "5" }
      composure: { kind: number, number: "3" }
      civic-exposure: { kind: number, number: "1" }
      courtesy-filter: { kind: boolean, boolean: true }
  - key: ivo-senn
    display_name: Ivo Senn
    profile:
      place-at-the-table: |-
        Bellwether's most sought-after memory couturier, invited everywhere but seated just below hereditary families who commission his work.
      public-reputation: |-
        A celebrated radical of empathy whose immersive works let patrons inhabit curated fragments of other lives. Critics praise the tenderness and whisper about consent.
      signature-alteration: |-
        A silver sensory halo behind one ear records emotional texture and can project chosen recollections as shared scent, pressure, and sound.
      unfashionable-attachment: |-
        Ivo maintains an obsolete street cinema in a flood-shadowed district and screens uncorrected family recordings for whoever still comes.
      cost-of-comfort: |-
        His masterwork used thousands of human hours classified as waste cognition. Contracts rendered the source residents anonymous and their refusal statistically irrelevant.
      memory-the-mesh-rejects: |-
        One source consciousness looked back through the recording apparatus, called Ivo by a childhood nickname, and asked him not to make beauty from her exhaustion.
    logical_input_values:
      bearing: { kind: number, number: "4" }
      systems-fluency: { kind: number, number: "4" }
      favors: { kind: number, number: "3" }
      composure: { kind: number, number: "2" }
      civic-exposure: { kind: number, number: "3" }
      courtesy-filter: { kind: boolean, boolean: false }
  - key: nia-corven
    display_name: Nia Corven
    profile:
      place-at-the-table: |-
        Master of Precedence for the Courtesy Season. Nia decides seating, introductions, apology order, and which social disputes become allocation signals.
      public-reputation: |-
        Feared for perfect manners and near-mathematical foresight. People say Nia can end a career by moving one chair without ever raising her voice.
      signature-alteration: |-
        Subdermal filaments across the fingertips read pulse, temperature, and identity permissions during formal greeting.
      unfashionable-attachment: |-
        Nia secretly tends a rooftop flock of ordinary pigeons, unmodified and inefficient, and knows each bird by behavior rather than tag.
      cost-of-comfort: |-
        A rival Nia demoted subsequently lost desalination priority. Nia understood that social precedence fed the Concordance and approved the change anyway.
      memory-the-mesh-rejects: |-
        During an early Season, Nia watched a guest vanish from every place setting and conversation between one course and the next. Nia alone remembers moving the empty chair.
    logical_input_values:
      bearing: { kind: number, number: "5" }
      systems-fluency: { kind: number, number: "3" }
      favors: { kind: number, number: "6" }
      composure: { kind: number, number: "4" }
      civic-exposure: { kind: number, number: "2" }
      courtesy-filter: { kind: boolean, boolean: true }
  - key: samira-ro
    display_name: Dr. Samira Ro
    profile:
      place-at-the-table: |-
        Physician to long-lived civic families and the medical conscience invited onto allocation ethics panels whenever legitimacy is required.
      public-reputation: |-
        Supposedly incorruptible. Samira has refused fashionable procedures on safety grounds and is trusted to say no where everyone else says later.
      signature-alteration: |-
        A living diagnostic iris around the left pupil maps cellular stress and displays a soft blue ring while clinical consent is recorded.
      unfashionable-attachment: |-
        Samira cooks labor-intensive delta recipes with an estranged brother and refuses nutrient-perfect substitutions for their mother's imprecise instructions.
      cost-of-comfort: |-
        Elite longevity treatments were calibrated on lower-tier neurological damage misclassified as voluntary therapy. Samira challenged the wording, then certified the usable results.
      memory-the-mesh-rejects: |-
        Samira remembers a patient remaining lucid after the record says cognition ended. The patient described Bellwether's rain from inside someone else's body.
    logical_input_values:
      bearing: { kind: number, number: "3" }
      systems-fluency: { kind: number, number: "5" }
      favors: { kind: number, number: "4" }
      composure: { kind: number, number: "5" }
      civic-exposure: { kind: number, number: "2" }
      courtesy-filter: { kind: boolean, boolean: true }
  - key: felix-ansel
    display_name: Felix Ansel
    profile:
      place-at-the-table: |-
        Disgraced heir to an infrastructure house, admitted to the Season because old access and excellent company remain useful even after scandal.
      public-reputation: |-
        Charming, unreliable, and technically dangerous. Felix makes obsolete systems sing and has never convinced Bellwether that the performance will end safely.
      signature-alteration: |-
        Outdated maintenance ports along the ribs can still handshake with buried civic infrastructure that newer bodies are forbidden to recognize.
      unfashionable-attachment: |-
        Felix keeps a patched municipal service drone named Lark, speaks to it as a colleague, and refuses the elegant replacement offered every Season.
      cost-of-comfort: |-
        A maintenance route Felix leaked once enabled an enforcement sweep through an unregistered settlement. The intended recipients escaped; dozens of others did not.
      memory-the-mesh-rejects: |-
        Lark contains nine minutes of corrupted audio in Felix's own voice, calmly issuing instructions Felix does not remember and could not have known at the time.
    logical_input_values:
      bearing: { kind: number, number: "2" }
      systems-fluency: { kind: number, number: "5" }
      favors: { kind: number, number: "2" }
      composure: { kind: number, number: "4" }
      civic-exposure: { kind: number, number: "4" }
      courtesy-filter: { kind: boolean, boolean: false }
---
# The Courtesy Season

## Premise

Bellwether is a high society whose beauty works. Its preventive medicine, controlled climate, quiet transit, gardens, and reversible bodies are not a hollow facade. They are remarkable achievements sustained through a civic allocation system that converts elite preference into material priority. The rot is not that the city failed to create abundance; it is that the city taught its beneficiaries not to see whose cognition, sleep, water, residence, and future are consumed to maintain it.

The forty-day Courtesy Season brings the people with the most social influence into one exquisitely controlled circuit of exhibitions, dinners, treatments, appointments, and romances. Tiny choices become signals to the Concordance. The Courtesy Mesh anticipates desire and edits distress into tasteful abstraction. This year, suppressed experience is leaking through the edit.

## Playable roster

- **Mara Lysen**, beloved infrastructure heir and public saint, signed away three blocks for her gardens.
- **Ivo Senn**, empathy artist, made beauty from cognition whose owners could not meaningfully refuse.
- **Nia Corven**, feared Master of Precedence, knowingly turned a social demotion into material deprivation.
- **Dr. Samira Ro**, trusted physician, certified results extracted through euphemized neurological harm.
- **Felix Ansel**, charming fallen heir, retains forbidden access and carries responsibility for a route used in an enforcement sweep.

All six profile fields are complete. The two restricted fields give the selected Character immediate private pressure; they do not provide a universal secret solution. Do not turn attendants, exploited residents, rivals, or family members into additional Entities. They should have names, skills, loyalties, and incompatible aims in the live fiction without becoming claimable Characters.

## Mechanics

**Favors** and **Composure** are spendable reserves. **Civic Exposure** measures how visible deviation has become to allocating institutions; it does not prove that a conspiracy is targeting the Character. **Bearing** and **Systems Fluency** are established capabilities. **Courtesy Filter** is a literal installed overlay and may be disabled or restored through consequences. Derived **Latitude** is `max(0, Bearing + Favors - Civic Exposure)`, making the social cost of visible dissent propagate through the sheet.

## Opening seed: The Season's First Supper

The table is laid beneath fruiting branches trained into a perfect indoor dusk. Rain scheduled for the terraces makes no sound against the glass. An attendant freezes beside the selected Character and repeats a phrase from the Character's rejected memory. The Courtesy Filter recasts the person as a decorative fault; other guests hear a harp tone. The host requests approval for routine reconciliation. Across the room, applause greets news that a lower district voluntarily contributed enough sleep-hours to cool tonight's rain.

Present immediate social and physical choices without making them exhaustive: approve, intervene, follow the attendant, disable the Filter, preserve evidence, recruit an ally, disrupt the ritual, or act unexpectedly. Whatever the player does, let the room respond through etiquette before force.

## Evolving hooks

- A work of commissioned art contains a deleted resident's face and a detail only the Character recognizes.
- An exploited district offers technically sophisticated help but demands a sacrifice rather than gratitude.
- The Concordance predicts a scandal before the Character has decided whether to cause it.
- A loved person benefits directly from a treatment whose evidence chain is morally compromised.
- Courtesy Filter failures spread unevenly, producing incompatible versions of the same public event.
- A reform faction wants disclosure timed to win control, while an abolition faction refuses another managed transition.

## Facilitator guardrails

Avoid familiar cyberpunk shorthand. Bellwether's surface is porcelain, cultivated gardens, couture implants, managed weather, clean service passages, and flawless manners. Make comfort sensorially persuasive. Let every intervention threaten something real: medical continuity, water delivery, shelter, a dependent relationship, or another district's bargaining position.

Do not reduce exploited residents to victims awaiting rescue, and do not make every elite NPC knowingly cruel. Give people partial information, self-serving theories, and legitimate fears. The interesting choice is not whether oppression is bad. It is what an implicated insider will surrender, whom they will trust with power, and whether a system capable of genuine care can be transformed without preserving the hierarchy that defines whose care counts.
