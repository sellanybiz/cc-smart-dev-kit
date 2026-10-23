/**
 * The portal app's copy of the API types (`portal/src/api/wire.ts`) against the server's own
 * (`./types.ts`), checked by the type checker: one line per exported name.
 *
 * `same` holds when the two types are assignable both ways and have the same fields, so a
 * field added, removed, renamed, made optional or given another type on either side is a type
 * error on that line. `fits` is the one-way form, for the few types that hold a value the app
 * keeps opaque (`unknown`): the server's value must fit the app's type, with the same fields.
 *
 * `bun run typecheck` checks this file with the rest of `src/`, and `wire-mirror.test.ts`
 * checks it on its own and that no exported name is missing from `MIRRORED`.
 */

import type * as Wire from "../../../portal/src/api/wire";
import type * as Server from "./types";

type KeysMatch<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;

/** Assignable both ways, with the same fields. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? KeysMatch<A, B> : false) : false;

/** The server's value fits the app's type, with the same fields (the app keeps a part opaque). */
type Fits<A, B> = [A] extends [B] ? KeysMatch<A, B> : false;

/** `true` only compiles when the pair is the same. */
function same<A, B>(ok: Same<A, B>): true {
  return ok as true;
}

function fits<A, B>(ok: Fits<A, B>): true {
  return ok as true;
}

/**
 * The exported names the app does not mirror, and why. Everything else `types.ts` exports must
 * be a key of `MIRRORED`.
 */
export const SERVER_ONLY: Readonly<Record<string, string>> = {
  LivePublish: "the server's publisher type: the page only receives events",
};

/** Every mirrored name, checked. */
export const MIRRORED = {
  ActionEvent: same<Server.ActionEvent, Wire.ActionEvent>(true),
  ActionName: same<Server.ActionName, Wire.ActionName>(true),
  ActionResult: same<Server.ActionResult, Wire.ActionResult>(true),
  ApiError: same<Server.ApiError, Wire.ApiError>(true),
  BackendRow: same<Server.BackendRow, Wire.BackendRow>(true),
  BreakerNeed: same<Server.BreakerNeed, Wire.BreakerNeed>(true),
  BreakerRecord: same<Server.BreakerRecord, Wire.BreakerRecord>(true),
  BunFacts: same<Server.BunFacts, Wire.BunFacts>(true),
  ClaudeCodeFacts: same<Server.ClaudeCodeFacts, Wire.ClaudeCodeFacts>(true),
  ClaudeMemCurrent: same<Server.ClaudeMemCurrent, Wire.ClaudeMemCurrent>(true),
  ClaudeMemFacts: same<Server.ClaudeMemFacts, Wire.ClaudeMemFacts>(true),
  ClaudeMemSource: same<Server.ClaudeMemSource, Wire.ClaudeMemSource>(true),
  CrewAnswer: same<Server.CrewAnswer, Wire.CrewAnswer>(true),
  CrewEvent: same<Server.CrewEvent, Wire.CrewEvent>(true),
  CrewMemoryPoint: same<Server.CrewMemoryPoint, Wire.CrewMemoryPoint>(true),
  CrewNeed: same<Server.CrewNeed, Wire.CrewNeed>(true),
  CrewReport: same<Server.CrewReport, Wire.CrewReport>(true),
  CrewReview: same<Server.CrewReview, Wire.CrewReview>(true),
  CrewStepItem: same<Server.CrewStepItem, Wire.CrewStepItem>(true),
  CrewSummary: same<Server.CrewSummary, Wire.CrewSummary>(true),
  DoctorCheck: same<Server.DoctorCheck, Wire.DoctorCheck>(true),
  DoctorFailure: same<Server.DoctorFailure, Wire.DoctorFailure>(true),
  DiffFile: same<Server.DiffFile, Wire.DiffFile>(true),
  FactsAnswer: same<Server.FactsAnswer, Wire.FactsAnswer>(true),
  FallbackRecord: same<Server.FallbackRecord, Wire.FallbackRecord>(true),
  FallbackRow: same<Server.FallbackRow, Wire.FallbackRow>(true),
  FlowAnswer: same<Server.FlowAnswer, Wire.FlowAnswer>(true),
  FlowReport: same<Server.FlowReport, Wire.FlowReport>(true),
  GhLoginState: same<Server.GhLoginState, Wire.GhLoginState>(true),
  GuardAsk: same<Server.GuardAsk, Wire.GuardAsk>(true),
  GuardAskItem: same<Server.GuardAskItem, Wire.GuardAskItem>(true),
  GuardAsksAnswer: same<Server.GuardAsksAnswer, Wire.GuardAsksAnswer>(true),
  HealthAnswer: same<Server.HealthAnswer, Wire.HealthAnswer>(true),
  HistoryAnswer: same<Server.HistoryAnswer, Wire.HistoryAnswer>(true),
  HistoryBy: same<Server.HistoryBy, Wire.HistoryBy>(true),
  HistoryFilters: same<Server.HistoryFilters, Wire.HistoryFilters>(true),
  HistoryKeys: same<Server.HistoryKeys, Wire.HistoryKeys>(true),
  HistoryKeysAnswer: same<Server.HistoryKeysAnswer, Wire.HistoryKeysAnswer>(true),
  HistoryPoint: same<Server.HistoryPoint, Wire.HistoryPoint>(true),
  HistoryRange: same<Server.HistoryRange, Wire.HistoryRange>(true),
  HistoryRequest: same<Server.HistoryRequest, Wire.HistoryRequest>(true),
  HistorySeries: same<Server.HistorySeries, Wire.HistorySeries>(true),
  JobWeightState: same<Server.JobWeightState, Wire.JobWeightState>(true),
  JobWeightsState: same<Server.JobWeightsState, Wire.JobWeightsState>(true),
  JobsAnswer: same<Server.JobsAnswer, Wire.JobsAnswer>(true),
  LastCheck: same<Server.LastCheck, Wire.LastCheck>(true),
  LeadSummary: same<Server.LeadSummary, Wire.LeadSummary>(true),
  LimitRecord: same<Server.LimitRecord, Wire.LimitRecord>(true),
  LimitRow: same<Server.LimitRow, Wire.LimitRow>(true),
  LiveEventName: same<Server.LiveEventName, Wire.LiveEventName>(true),
  LiveEvents: same<Server.LiveEvents, Wire.LiveEvents>(true),
  LiveState: same<Server.LiveState, Wire.LiveState>(true),
  LogLine: same<Server.LogLine, Wire.LogLine>(true),
  MachineAnswer: fits<Server.MachineAnswer, Wire.MachineAnswer>(true),
  MachineUpdate: same<Server.MachineUpdate, Wire.MachineUpdate>(true),
  McpServerRow: same<Server.McpServerRow, Wire.McpServerRow>(true),
  MergeDetail: same<Server.MergeDetail, Wire.MergeDetail>(true),
  MergeVerdict: same<Server.MergeVerdict, Wire.MergeVerdict>(true),
  ModelRow: same<Server.ModelRow, Wire.ModelRow>(true),
  NeedsAnswer: same<Server.NeedsAnswer, Wire.NeedsAnswer>(true),
  NotSetUp: same<Server.NotSetUp, Wire.NotSetUp>(true),
  OpenBreaker: same<Server.OpenBreaker, Wire.OpenBreaker>(true),
  OverviewAnswer: same<Server.OverviewAnswer, Wire.OverviewAnswer>(true),
  PermissionWait: same<Server.PermissionWait, Wire.PermissionWait>(true),
  PlanWindow: same<Server.PlanWindow, Wire.PlanWindow>(true),
  PortalFacts: same<Server.PortalFacts, Wire.PortalFacts>(true),
  PortHolder: same<Server.PortHolder, Wire.PortHolder>(true),
  // The card it carries keeps the project's workflow opaque in the app (`ProjectCardData`),
  // so this is the one-way form, as `ProjectsAnswer` is.
  ProjectAnswer: fits<Server.ProjectAnswer, Wire.ProjectAnswer>(true),
  ProjectBranch: same<Server.ProjectBranch, Wire.ProjectBranch>(true),
  ProjectCardData: fits<Server.ProjectCardData, Wire.ProjectCardData>(true),
  ProjectSummary: same<Server.ProjectSummary, Wire.ProjectSummary>(true),
  ProjectsAnswer: fits<Server.ProjectsAnswer, Wire.ProjectsAnswer>(true),
  ProjectWorkflowAnswer: same<Server.ProjectWorkflowAnswer, Wire.ProjectWorkflowAnswer>(true),
  ProjectWorkflowSetting: same<Server.ProjectWorkflowSetting, Wire.ProjectWorkflowSetting>(true),
  RecentEntry: same<Server.RecentEntry, Wire.RecentEntry>(true),
  RequestsAnswer: same<Server.RequestsAnswer, Wire.RequestsAnswer>(true),
  RouterFacts: same<Server.RouterFacts, Wire.RouterFacts>(true),
  SessionSummary: same<Server.SessionSummary, Wire.SessionSummary>(true),
  SettingsAnswer: same<Server.SettingsAnswer, Wire.SettingsAnswer>(true),
  SettingsData: same<Server.SettingsData, Wire.SettingsData>(true),
  SlotRow: same<Server.SlotRow, Wire.SlotRow>(true),
  SlotTarget: same<Server.SlotTarget, Wire.SlotTarget>(true),
  SlotsAnswer: same<Server.SlotsAnswer, Wire.SlotsAnswer>(true),
  SwitchFacts: same<Server.SwitchFacts, Wire.SwitchFacts>(true),
  TestRun: same<Server.TestRun, Wire.TestRun>(true),
  UpdateAnswer: same<Server.UpdateAnswer, Wire.UpdateAnswer>(true),
  WorkAnswer: same<Server.WorkAnswer, Wire.WorkAnswer>(true),
  WorktreeAutoClean: same<Server.WorktreeAutoClean, Wire.WorktreeAutoClean>(true),
  WorktreeItem: same<Server.WorktreeItem, Wire.WorktreeItem>(true),
  WorktreesAnswer: same<Server.WorktreesAnswer, Wire.WorktreesAnswer>(true),
} as const;
