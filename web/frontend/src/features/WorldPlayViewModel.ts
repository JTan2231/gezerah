import type { ReactNode } from "react";

export interface PlayViewIssue {
  kind: "connection" | "request";
  message: string;
  fields: Record<string, string>;
}

export type WorldPlayBoundaryViewModel =
  | { kind: "loading"; label: string }
  | { kind: "issue"; issue: PlayViewIssue }
  | { kind: "empty"; title: string; description: string };

export interface RosterEntityViewModel {
  id: string;
  name: string;
  subtitle: string;
  selected: boolean;
  controlled: boolean;
  setupRequired: boolean;
}

export interface ReadyMemberViewModel {
  id: string;
  name: string;
}

export interface FacilitatorChoiceViewModel {
  value: string;
  name: string;
}

export interface WorldPlayViewModel {
  worldName: string;
  currentUserName: string;
  roleLabel: string;
  accessLabel: string;
  facilitator: boolean;
  canCreateProblem: boolean;
  hasActiveProblem: boolean;
  dungeonMaster: {
    name: string;
    source: "human" | "terra" | "agent";
    selectedValue: string;
    canChange: boolean;
    canTakeOver: boolean;
    changing: boolean;
    choices: FacilitatorChoiceViewModel[];
    issue: PlayViewIssue | null;
  };
  idle: {
    terraFacilitated: boolean;
    agentFacilitated: boolean;
    canContinue: boolean;
    continuing: boolean;
    issue: PlayViewIssue | null;
  };
  roster: {
    loading: boolean;
    showEmpty: boolean;
    issue: PlayViewIssue | null;
    entities: RosterEntityViewModel[];
    readyMembers: ReadyMemberViewModel[];
  };
  problems: {
    loading: boolean;
    issue: PlayViewIssue | null;
  };
  history: HistoryCardViewModel[];
  agentMode: AgentModeViewModel | null;
}

export interface WorldPlayViewActions {
  createProblem: () => void;
  changeFacilitator: (value: string) => void;
  takeOverFacilitation: () => void;
  continueWithTerra: () => void;
  copyAgentPrompt: () => void;
  retryRoster: () => void;
  retryProblems: () => void;
  selectEntity: (id: string) => void;
}

export interface CharacterChoiceViewModel {
  id: string;
  name: string;
  completedFieldCount: number;
  requiredFieldCount: number;
  selected: boolean;
}

export interface ClaimableCharacterViewModel {
  id: string;
  name: string;
  summary?: string | undefined;
}

export interface AgentModeViewModel {
  siteToolsAvailable: boolean;
  starterPrompt: string;
  launchURL: string;
  promptCopied: boolean;
}

export interface CharacterOnboardingViewModel {
  worldName: string;
  currentUserName: string;
  dungeonMasterName: string;
  statusLabel: string;
  facilitatorActionLabel: string;
  canBecomeFacilitator: boolean;
  changingFacilitator: boolean;
  facilitatorIssue: PlayViewIssue | null;
  loading: boolean;
  issue: PlayViewIssue | null;
  characters: CharacterChoiceViewModel[];
  claimableCharacters: ClaimableCharacterViewModel[];
  claimingCharacterId?: string | undefined;
  claimIssue: PlayViewIssue | null;
  agentMode: AgentModeViewModel | null;
}

export interface CharacterOnboardingViewActions {
  retry: () => void;
  selectCharacter: (id: string) => void;
  becomeFacilitator: () => void;
  claimCharacter: (id: string) => void;
  copyAgentPrompt: () => void;
}

export interface NewProblemDraftViewModel {
  title: string;
  description: string;
  selectedEntityIds: string[];
  selectedResponderIds: string[];
}

export interface ChoiceViewModel {
  id: string;
  name: string;
}

export interface NewProblemViewModel {
  draft: NewProblemDraftViewModel;
  contextEntities: ChoiceViewModel[];
  showContextChoices: boolean;
  responders: ChoiceViewModel[];
  saving: boolean;
  issue: PlayViewIssue | null;
}

export interface NewProblemViewActions {
  changeTitle: (value: string) => void;
  changeDescription: (value: string) => void;
  toggleContextEntity: (id: string) => void;
  toggleResponder: (id: string) => void;
  submit: () => void;
  close: () => void;
}

export interface SubmittedActionViewModel {
  id: string;
  actorName: string;
  playerName?: string | undefined;
  text: string;
}

export interface OpenProblemViewModel {
  submissions: SubmittedActionViewModel[];
  facilitator: boolean;
  eligibleResponder: boolean;
  actionSubmitted: boolean;
  controlledEntities: ChoiceViewModel[];
  actingEntityId: string;
  actionText: string;
  saving: boolean;
  closing: boolean;
  terraFacilitated: boolean;
  agentFacilitated: boolean;
  canRequestDecision: boolean;
  allRespondersReady: boolean;
  decisionEnabled: boolean;
  responseProgressLabel: string;
  deciding: boolean;
  issue: PlayViewIssue | null;
}

export interface OpenProblemViewActions {
  changeActingEntity: (id: string) => void;
  changeActionText: (value: string) => void;
  submitAction: () => void;
  passAction: () => void;
  withdrawAction: () => void;
  closeActions: () => void;
  requestDecision: () => void;
}

export interface LiveInteractionViewModel {
  status: "open" | "adjudicating" | "draft" | "resolved" | "cancelled";
  statusLabel: string;
  presentedLabel: string;
  title: string;
  prompt: string;
  contextEntityNames: string[];
  facilitator: boolean;
  canSkip: boolean;
  working: boolean;
  skipping: boolean;
  issue: PlayViewIssue | null;
}

export interface PreviewApplicationViewModel {
  id: string;
  entityName: string;
  effectLabel: string;
  outcomeLabel: string;
}

export interface PreviewChangeViewModel {
  id: string;
  label: string;
  outcomeLabel: string;
}

export interface RulingPreviewViewModel {
  applicationSummary: string;
  applications: PreviewApplicationViewModel[];
  effectiveChanges: PreviewChangeViewModel[];
}

export interface RulingViewModel {
  submissions: SubmittedActionViewModel[];
  narrative: string;
  selectedAction: {
    actorName: string;
    text: string;
  } | null;
  preview: RulingPreviewViewModel | null;
  rulesReady: boolean;
  previewStale: boolean;
  saving: "compile" | "resolve" | null;
  issue: PlayViewIssue | null;
}

export interface RulingViewActions {
  changeNarrative: (value: string) => void;
  prepare: () => void;
  resolve: () => void;
}

export interface HistoryEffectViewModel {
  id: string;
  label: string;
}

export interface HistoryCardViewModel {
  id: string;
  outcome: "resolved" | "cancelled";
  cancellationLabel?: "Cancelled" | "Skipped" | undefined;
  occurredLabel: string;
  facilitatorLabel: string;
  title: string;
  prompt: string;
  narrative?: string | undefined;
  effects: HistoryEffectViewModel[];
  effectiveChanges: HistoryEffectViewModel[];
}

export interface WorldPlayViewSlots {
  activeProblem: ReactNode;
  selectedEntity: ReactNode;
  problemDialog: ReactNode;
}
