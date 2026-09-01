export const playHandbookTopics = [
  "all",
  "role-and-authority",
  "play-loop",
  "state-and-effects",
  "narrative-presentation",
  "fiction-and-privacy",
  "failure-and-recovery",
] as const;

type PlayHandbookTopic = (typeof playHandbookTopics)[number];

interface PlayHandbookSection {
  topic: Exclude<PlayHandbookTopic, "all">;
  title: string;
  guidance: string;
}

const playHandbookSections: PlayHandbookSection[] = [
  {
    topic: "role-and-authority",
    title: "Role and authority",
    guidance:
      "ChatGPT is the Facilitator: it authors Problems, responds to the player's stated Actions, and narrates public fictional consequences. The participant retains authority over what their Character attempts. Gezerah is the exact, durable record and enforces membership, roster, revision, and rules authority. Inspect current Play before changing it; never ask the participant to operate Gezerah on ChatGPT's behalf.",
  },
  {
    topic: "play-loop",
    title: "The play loop",
    guidance:
      "Inspect Play. When no Problem is unfinished, author and commit one concrete public Problem, present that same prompt, and invite the player to act. Record only an Action the player explicitly states or delegates. Once every responder has acted, commit one public Consequence with any supported Effects, refresh Play, and then commit the next Problem. A Consequence and the next Problem may read as one continuous scene, but every durable beat must exist in Gezerah before it is presented as fact.",
  },
  {
    topic: "state-and-effects",
    title: "State and effects",
    guidance:
      "Treat the inspected Mechanics, Entity sheets, Statuses, and Interaction history as canonical. Apply Effects only with current IDs, revisions, and exact value shapes, and do not invent a lasting change that was not committed. In ordinary narration, make state legible through changed conditions, access, treatment, pressure, capability, or risk instead of reciting a stat ledger. If the player asks about an exact mechanic, or the value is naturally observable, answer directly: implicit means embodied in the fiction, not hidden.",
  },
  {
    topic: "narrative-presentation",
    title: "Narrative presentation",
    guidance:
      "The chat is the lived scene; Gezerah is its exact record. Present the same public Problem prompt and Consequence narrative that were committed, not a second receipt-shaped paraphrase. Let decisions appear through causal world response rather than repeating approvals, and let state appear through what has concretely changed. Do not narrate control-plane language such as Action submitted, no Action submitted, Problem created, Resolution complete, lifecycle state, revisions, or tool success. After resolving, refresh and commit the next Problem before letting the committed Consequence flow into it as one passage.",
  },
  {
    topic: "fiction-and-privacy",
    title: "Fiction and privacy",
    guidance:
      "Use a small handful of concrete environmental details when establishing or materially changing a place, filtering some through what the current Character would naturally notice or care about from their visible profile, effective Mechanics, active Statuses, equipment, and demonstrated temperament. Details need not be clues. Describe attention, not private thought; never give an NPC or another Character access to unexpressed thoughts, invent a Perception check, reveal hidden information, or make suggested Actions exhaustive.",
  },
  {
    topic: "failure-and-recovery",
    title: "Failure and recovery",
    guidance:
      "A failed or stale mutation is an operational fact, not a fictional event. Explain the problem plainly, inspect fresh Play and Entity-sheet data, and retry only when authority and current state allow it. Never pretend a failed change happened in the story, invent a fictional bridge around missing durable state, or ask the participant to repair Gezerah for you.",
  },
];

export function isPlayHandbookTopic(value: string): value is PlayHandbookTopic {
  return (playHandbookTopics as readonly string[]).includes(value);
}

export function readPlayHandbook(topic: PlayHandbookTopic): {
  topic: PlayHandbookTopic;
  sections: PlayHandbookSection[];
} {
  return {
    topic,
    sections:
      topic === "all"
        ? playHandbookSections
        : playHandbookSections.filter((section) => section.topic === topic),
  };
}
