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

export interface WorldPlayViewModel {
  worldName: string;
  currentUserName: string;
  roleLabel: string;
  facilitator: boolean;
  canCreateProblem: boolean;
  hasActiveProblem: boolean;
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
}

export interface WorldPlayViewActions {
  createProblem: () => void;
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

export interface CharacterOnboardingViewModel {
  worldName: string;
  currentUserName: string;
  statusLabel: string;
  loading: boolean;
  issue: PlayViewIssue | null;
  characters: CharacterChoiceViewModel[];
}

export interface CharacterOnboardingViewActions {
  retry: () => void;
  selectCharacter: (id: string) => void;
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
  terraEnabled: boolean;
  generating: boolean;
  saving: boolean;
  issue: PlayViewIssue | null;
}

export interface NewProblemViewActions {
  changeTitle: (value: string) => void;
  changeDescription: (value: string) => void;
  toggleContextEntity: (id: string) => void;
  toggleResponder: (id: string) => void;
  generate: () => void;
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
  issue: PlayViewIssue | null;
}

export interface OpenProblemViewActions {
  changeActingEntity: (id: string) => void;
  changeActionText: (value: string) => void;
  submitAction: () => void;
  withdrawAction: () => void;
  closeActions: () => void;
}

export interface LiveInteractionViewModel {
  status: "open" | "adjudicating" | "draft" | "resolved" | "cancelled";
  statusLabel: string;
  presentedLabel: string;
  title: string;
  prompt: string;
  contextEntityNames: string[];
  facilitator: boolean;
  working: boolean;
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
  terraEnabled: boolean;
  submissions: SubmittedActionViewModel[];
  narrative: string;
  selectedAction: {
    actorName: string;
    text: string;
  } | null;
  preview: RulingPreviewViewModel | null;
  rulesReady: boolean;
  previewStale: boolean;
  saving: "compile" | "generate" | "resolve" | null;
  issue: PlayViewIssue | null;
}

export interface RulingViewActions {
  changeNarrative: (value: string) => void;
  prepare: (mode: "compile" | "generate") => void;
  resolve: () => void;
}

export interface HistoryEffectViewModel {
  id: string;
  label: string;
}

export interface HistoryCardViewModel {
  id: string;
  outcome: "resolved" | "cancelled";
  occurredLabel: string;
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
