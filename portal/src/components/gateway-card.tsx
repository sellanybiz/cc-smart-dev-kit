"use client";

import {
  CircleAlertIcon,
  InfoIcon,
  LoaderCircleIcon,
  PencilIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { useResource } from "@/api/hooks";
import { PROJECT_REFRESH } from "@/api/refresh";
import type {
  ProjectGatewayData,
  ProjectGatewayNote,
  ProjectListRow,
  ProjectProfileSlot,
} from "@/api/types";
import { ActionResultLine, useAction } from "@/components/action-button";
import { ChainEditor, type ChainItem } from "@/components/chain-editor";
import { ChoiceSwitch } from "@/components/choice-switch";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SavedSwitch } from "@/components/saved-switch";
import { StatusMark, TonePill } from "@/components/status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { targetModel } from "@/lib/format";
import {
  type GatewayChoice,
  type GatewayDraft,
  gatewayDraftOf,
  gatewayRequest,
  personalFileWords,
  runningWords,
  STATE_LABEL,
  slotApplies,
  stateTone,
} from "@/lib/gateway";

/** A chain's targets as one line, the Slots page's way. */
function chainLine(targets: readonly string[]): string {
  return targets.map(targetModel).join(" → ");
}

/** The team file's words; the personal file's depend on git (`personalFileWords`). */
const TEAM_FILE_WORDS =
  "Your team: .claude/settings.json, committed with the project. A session reads it only when it starts in the project's top folder.";

/** One note beside the state: a fault or a warning as an alert, a fact as a quiet line. */
function NoteLine({ note }: { note: ProjectGatewayNote }) {
  if (note.tone === "info") {
    return (
      <p className="flex items-start gap-2 text-sm text-pretty text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span className="wrap-any">{note.text}</span>
      </p>
    );
  }
  const bad = note.tone === "bad";
  return (
    <Alert className={bad ? "border-bad/40" : "border-warn/40"}>
      {bad ? (
        <CircleAlertIcon className="text-bad" aria-hidden="true" />
      ) : (
        <TriangleAlertIcon className="text-warn" aria-hidden="true" />
      )}
      <AlertDescription className="wrap-any">
        <span className="sr-only">{bad ? "Fault: " : "Warning: "}</span>
        {note.text}
      </AlertDescription>
    </Alert>
  );
}

/** What a session started in the project gets, and which file decides it; the files on demand. */
function StateSummary({ data }: { data: ProjectGatewayData }) {
  const [open, setOpen] = useState(false);
  const filesId = useId();
  const { choice, effective } = data;
  const follows = choice.source === "none" && effective.source === "machine";
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-x-6 gap-y-2 text-sm @xl/main:grid-cols-[minmax(0,auto)_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Its sessions get</dt>
        <dd className="min-w-0 pb-2 @xl/main:pb-0">
          <StatusMark tone={stateTone(effective.state)} className="wrap-any">
            {effective.words}
          </StatusMark>
        </dd>
        <dt className="text-muted-foreground">Decided by</dt>
        <dd className="min-w-0 wrap-any">
          {follows
            ? `This project sets nothing, so ${effective.from} decides.`
            : `${effective.from[0]?.toUpperCase() ?? ""}${effective.from.slice(1)}.`}
        </dd>
      </dl>
      <div className="flex flex-col items-start gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground"
          aria-expanded={open}
          aria-controls={filesId}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide the files read" : `The files read (${data.files.length})`}
        </Button>
        <ol id={filesId} hidden={!open} className="flex w-full flex-col gap-2 pl-2 text-sm">
          {data.files.map((file, index) => (
            <li key={file.path} className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="text-xs text-muted-foreground tabular-nums">{index + 1}.</span>
                <span className="font-medium">
                  {file.kind === "personal"
                    ? "Personal file"
                    : file.kind === "team"
                      ? "Team file"
                      : "This machine's settings"}
                </span>
                <span className="wrap-any font-mono text-xs text-muted-foreground">
                  {file.path}
                </span>
              </span>
              <StatusMark tone={file.problem ? "bad" : "info"} className="wrap-any text-xs">
                {file.holds}
              </StatusMark>
            </li>
          ))}
        </ol>
        <p hidden={!open} className="pl-2 text-xs text-pretty text-muted-foreground">
          The first file that sets the address decides. A session started with --settings uses that
          file first, and the portal cannot see it.
        </p>
      </div>
    </div>
  );
}

/** The question before a change of the project's state, in the design's words. */
function changeTitle(name: string, draft: GatewayDraft): string {
  if (draft.state === "on") {
    return draft.profile === null
      ? `Send ${name}'s sessions through the gateway?`
      : `Send ${name}'s sessions through the gateway, with the profile ${draft.profile}?`;
  }
  return draft.state === "off"
    ? `Send ${name}'s sessions straight to Anthropic?`
    : `Let this machine's settings decide for ${name}?`;
}

/**
 * The project's own state: on, off or default, the file it goes to, and a profile with on. The
 * form starts from the project's choice; Apply asks first, then the command line's own
 * `gateway project` runs and its result shows in place.
 */
function ChangeForm({ data, project }: { data: ProjectGatewayData; project: ProjectListRow }) {
  const [edited, setEdited] = useState<GatewayDraft | null>(null);
  const [asking, setAsking] = useState(false);
  const { run, state } = useAction("project.gateway.set", (result) => {
    if (result.ok) setEdited(null);
  });
  const draft = edited ?? gatewayDraftOf(data);
  const request = gatewayRequest(data, draft);
  const sending = state.phase === "sending";
  const fileId = useId();
  const profileId = useId();
  const blockedId = useId();
  const edit = (next: Partial<GatewayDraft>) => setEdited({ ...draft, ...next });
  // Each option says why the command would refuse it in the file chosen, in its own words; the
  // team file's refusal of on is the one structural rule, said short.
  const refusals = data.refusals[draft.team ? "team" : "personal"];
  const onBlocked =
    draft.team && refusals.on !== null ? "The team file takes off or default only." : refusals.on;
  return (
    <section aria-labelledby={`${fileId}-title`} className="flex flex-col gap-4 border-t pt-5">
      <div className="flex flex-col gap-0.5">
        <h3 id={`${fileId}-title`} className="font-semibold">
          This project's own state
        </h3>
        <p className="text-sm text-pretty text-muted-foreground">
          On sends its sessions through this machine's router, off sends them straight to Anthropic
          on your own login, and default writes nothing, so this machine's settings decide.
        </p>
      </div>
      <div className="grid gap-4 @3xl/main:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium" aria-hidden="true">
            State
          </span>
          <ChoiceSwitch<GatewayChoice>
            label="This project's gateway state"
            value={draft.state}
            disabled={sending}
            onChoose={(next) => edit({ state: next })}
            options={[
              { blocked: onBlocked, label: "On", value: "on" },
              { blocked: refusals.off, label: "Off", value: "off" },
              { blocked: refusals.default, label: "Default", value: "default" },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium" aria-hidden="true">
            Written to
          </span>
          <ChoiceSwitch<"personal" | "team">
            label="The settings file it is written to"
            value={draft.team ? "team" : "personal"}
            disabled={sending}
            onChoose={(next) => edit({ team: next === "team" })}
            options={[
              { label: "Only me", value: "personal" },
              {
                blocked:
                  draft.state === "on" && data.refusals.team.on !== null
                    ? "On goes to your personal file only."
                    : null,
                label: "The team",
                value: "team",
              },
            ]}
          />
          <p id={fileId} className="text-xs text-pretty text-muted-foreground">
            {draft.team ? TEAM_FILE_WORDS : personalFileWords(data)}
          </p>
        </div>
      </div>
      {draft.state === "on" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={profileId}>Profile</Label>
          <NativeSelect
            id={profileId}
            value={draft.profile ?? ""}
            disabled={sending}
            onChange={(event) =>
              edit({ profile: event.target.value === "" ? null : event.target.value })
            }
            className="w-80 max-w-full"
          >
            <NativeSelectOption value="">None: this machine's own chains</NativeSelectOption>
            {data.profiles.map((name) => (
              <NativeSelectOption key={name} value={name}>
                {name}
              </NativeSelectOption>
            ))}
            {draft.profile !== null && !data.profiles.includes(draft.profile) && (
              <NativeSelectOption value={draft.profile}>
                {draft.profile} (the router has none by that name)
              </NativeSelectOption>
            )}
          </NativeSelect>
          <p className="text-xs text-pretty text-muted-foreground">
            {data.profiles.length === 0
              ? "This machine has no profile yet. The command line makes one: its first chain makes it."
              : "A profile gives some slots other chains than this machine's, for every project that names it."}
          </p>
        </div>
      )}
      <p className="flex items-start gap-2 text-sm text-pretty text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {runningWords(draft.state)}
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={request.kind !== "send" || sending}
            aria-busy={sending}
            aria-describedby={request.kind === "blocked" ? blockedId : undefined}
            onClick={() => setAsking(true)}
          >
            {sending && (
              <LoaderCircleIcon
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {sending ? "Applying…" : "Apply"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={edited === null || sending}
            onClick={() => setEdited(null)}
          >
            Discard
          </Button>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {request.kind === "same" ? "This is the project's state now." : ""}
          </p>
        </div>
        {request.kind === "blocked" && (
          <p id={blockedId} className="text-xs text-pretty text-warn">
            <span aria-hidden="true">! </span>
            {request.why}
          </p>
        )}
        <ActionResultLine state={state} onRetry={() => setAsking(true)} />
      </div>
      <ConfirmDialog
        open={asking}
        title={changeTitle(project.name, draft)}
        yes={draft.state === "default" ? "Remove the address" : "Write it"}
        onCancel={() => setAsking(false)}
        onYes={() => {
          setAsking(false);
          if (request.kind !== "send") return;
          run({ ...request.body, confirm: true, project: project.id });
        }}
      >
        <span className="block">
          {draft.state === "default"
            ? `It removes the address from the ${draft.team ? "team" : "personal"} file.`
            : `It writes the address in the ${draft.team ? "team" : "personal"} file${draft.team ? ": commit it for your teammates" : data.personalTracked === true ? ", which git tracks in this project: it is committed with it" : ", which is never committed"}.`}{" "}
          {draft.state === "off"
            ? "Anthropic's own address keeps your own Claude login: nobody is logged out."
            : ""}
        </span>
        <span className="mt-2 block">{runningWords(draft.state)}</span>
      </ConfirmDialog>
    </section>
  );
}

/** The model list for a chain editor: the Slots page's own, read once an editor opens. */
function useModels(open: boolean) {
  return useResource(
    (client) => (open ? client.slots() : Promise.resolve(null)),
    open ? "models" : "closed",
  );
}

/** One slot of the profile: what answers it, from where, its fallback, and its editor. */
function ProfileSlotRow({ slot, profile }: { slot: ProjectProfileSlot; profile: string }) {
  const [open, setOpen] = useState(false);
  const editorId = useId();
  const applies = slotApplies(slot);
  const source =
    applies.from === "own"
      ? "its own chain"
      : applies.from === "claude"
        ? "Claude in this profile"
        : "as on this machine";
  return (
    <li className="flex flex-col gap-3 border-t py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{slot.name}</span>
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {source}
            </Badge>
          </span>
          {applies.chain === null ? (
            <span className="text-sm">Claude answers, on your own login</span>
          ) : (
            <span className="wrap-any font-mono text-xs">{chainLine(applies.chain)}</span>
          )}
          {applies.chain !== null && (
            <span className="text-xs text-muted-foreground">
              Fallback {slot.fallback ? "on" : "off"}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls={editorId}
          onClick={() => setOpen(!open)}
        >
          <PencilIcon data-icon="inline-start" aria-hidden="true" />
          {open ? "Close" : "Change"}
          <span className="sr-only"> {slot.name}</span>
        </Button>
      </div>
      <div id={editorId} hidden={!open}>
        {open && <SlotEditor slot={slot} profile={profile} />}
      </div>
    </li>
  );
}

/** What a profile's slot may become: this machine's chain, plain Claude, or a chain of its own. */
type SlotPick = "claude" | "machine" | "own";

/**
 * One slot's editor inside a profile: the Slots page's own chain editor and switch, each change
 * asked first and run by the command line's `gateway profile` (it checks each target against
 * its backend's live list).
 */
function SlotEditor({ slot, profile }: { slot: ProjectProfileSlot; profile: string }) {
  const applies = slotApplies(slot);
  const [pick, setPick] = useState<SlotPick>(applies.from);
  // A chain of its own starts from the chain that answers now, so the person edits from it.
  const [items, setItems] = useState<ChainItem[]>(
    (applies.chain ?? []).map((target) => ({ restingFor: null, target })),
  );
  const [asking, setAsking] = useState(false);
  const models = useModels(pick === "own");
  const save = useAction("project.gateway.profile");
  const sending = save.state.phase === "sending";
  const ownNow = Array.isArray(slot.own) ? slot.own : null;
  const same =
    pick === applies.from &&
    (pick !== "own" ||
      (ownNow !== null &&
        ownNow.length === items.length &&
        ownNow.every((target, index) => items[index]?.target === target)));
  const ready = !same && (pick !== "own" || items.length > 0);
  const effect = `Every project whose address names ${profile} uses it from its next request.`;
  const body =
    pick === "own"
      ? { targets: items.map((item) => item.target) }
      : { value: pick === "claude" ? "claude" : "machine" };
  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-3">
      <ChoiceSwitch<SlotPick>
        label={`Who answers ${slot.name} in ${profile}`}
        value={pick}
        disabled={sending}
        onChoose={setPick}
        options={[
          { label: "Machine", value: "machine" },
          { label: "Claude", value: "claude" },
          { label: "Own chain", value: "own" },
        ]}
      />
      {pick === "machine" && (
        <p className="text-sm text-pretty text-muted-foreground">
          {slot.machine === null
            ? "This machine has no chain for it: Claude answers, as it does for every project."
            : `As every project without a profile: ${chainLine(slot.machine)}.`}
        </p>
      )}
      {pick === "claude" && (
        <p className="text-sm text-pretty text-muted-foreground">
          Plain Claude for {slot.name} in this profile, on your own login, whatever this machine's
          chain is.
        </p>
      )}
      {pick === "own" &&
        (models.status === "loading" ? (
          <div role="status" aria-live="polite">
            <span className="sr-only">Loading the model list…</span>
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {models.status === "error" && (
              <p className="text-xs text-pretty text-muted-foreground">
                The model list could not be read ({models.message}): type a target instead.
              </p>
            )}
            <ChainEditor
              items={items}
              models={models.status === "ready" ? (models.data?.models ?? []) : []}
              onChange={setItems}
              label={`The ${slot.name} chain of ${profile}`}
              stats={new Map()}
              live={false}
              empty="No target yet: add one from the list, or type one."
              disabled={sending}
            />
          </div>
        ))}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!ready || sending}
            aria-busy={sending}
            onClick={() => setAsking(true)}
          >
            {sending ? "Saving…" : "Save"}
          </Button>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {same ? "This is the slot in this profile now." : ""}
          </p>
        </div>
        <ActionResultLine state={save.state} onRetry={() => setAsking(true)} />
      </div>
      {/* A slot with no chain has nothing to fall back to; the judge's switch says whether the
          worker's tested targets stand in while Claude cannot judge. */}
      {(applies.chain !== null || slot.name === "judge") && (
        <div className="border-t pt-3">
          <SavedSwitch
            label="Fallback"
            help={
              applies.chain === null
                ? slot.fallback
                  ? "On: in this profile, while Claude is limited or down, the worker's tested targets judge in its place."
                  : "Off: in this profile, Claude judges alone."
                : slot.fallback
                  ? "On: in this profile, when a target fails or rests, the next one answers."
                  : "Off: in this profile, only the first target answers."
            }
            checked={slot.fallback}
            action="project.gateway.profile"
            body={(on) => ({ confirm: true, kind: "fallback", on, profile, slot: slot.name })}
            question={`Turn fallback ${slot.fallback ? "off" : "on"} for ${slot.name} in ${profile}?`}
            effect={effect}
          />
        </div>
      )}
      <ConfirmDialog
        open={asking}
        title={`Change ${slot.name} in the profile ${profile}?`}
        yes="Save it"
        onCancel={() => setAsking(false)}
        onYes={() => {
          setAsking(false);
          save.run({ ...body, confirm: true, kind: "slot", profile, slot: slot.name });
        }}
      >
        <span className="block font-mono text-xs text-foreground">
          {pick === "own"
            ? chainLine(items.map((item) => item.target))
            : pick === "claude"
              ? "Claude"
              : "This machine's chain"}
        </span>
        <span className="mt-2 block">
          {pick === "own" ? "The command line checks each target first. " : ""}
          {effect}
        </span>
      </ConfirmDialog>
    </div>
  );
}

/** The profile the project's address names: its chains slot by slot, over this machine's. */
function ProfileSection({ data }: { data: ProjectGatewayData }) {
  const titleId = useId();
  const profile = data.profile;
  if (profile === null) return null;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2 border-t pt-5">
      <div className="flex flex-col gap-0.5">
        <h3 id={titleId} className="flex flex-wrap items-center gap-2 font-semibold">
          Profile <span className="font-mono">{profile.name}</span>
          <Badge variant="secondary" className="font-normal">
            this machine's, shared
          </Badge>
        </h3>
        <p className="text-sm text-pretty text-muted-foreground">
          Its chains, slot by slot, over this machine's. Every project whose address names{" "}
          {profile.name} uses them; a change reaches their sessions from the next request.
        </p>
      </div>
      {profile.exists ? (
        <ul aria-label={`The slots of ${profile.name}`}>
          {profile.slots.map((slot) => (
            <ProfileSlotRow key={slot.key} slot={slot} profile={profile.name} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-pretty text-muted-foreground">
          There is nothing to show: until it is made, every slot answers as plain Claude.
        </p>
      )}
    </section>
  );
}

/**
 * A project's Gateway card (GP4b): where its Claude sessions send their requests — this
 * machine's router, Anthropic's own address, or what this machine's settings say — and which
 * file decides it; the project's own state to change; and, when its address names a profile, that
 * profile's chains slot by slot over this machine's.
 */
export function GatewayCard({ project }: { project: ProjectListRow }) {
  const gateway = useResource(
    (client) => client.projectGateway(project.id),
    project.id,
    PROJECT_REFRESH,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Gateway</CardTitle>
        <CardDescription className="text-pretty">
          Where this project's Claude sessions send their requests, and which settings file says so.
        </CardDescription>
        {gateway.status === "ready" && (
          <CardAction>
            <TonePill tone={stateTone(gateway.data.effective.state)}>
              {STATE_LABEL[gateway.data.effective.state]}
              {gateway.data.effective.profile === null
                ? ""
                : ` · ${gateway.data.effective.profile}`}
            </TonePill>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {gateway.status === "loading" ? (
          <div role="status" aria-live="polite" className="flex flex-col gap-3">
            <span className="sr-only">Loading the project's gateway…</span>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : gateway.status === "error" ? (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="text-sm text-pretty text-bad">
              The project's gateway could not be read: {gateway.message}
            </p>
            <Button variant="outline" size="sm" onClick={gateway.reload}>
              <RotateCwIcon data-icon="inline-start" aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : (
          <>
            <StateSummary data={gateway.data} />
            {gateway.data.notes.map((note) => (
              <NoteLine key={note.text} note={note} />
            ))}
            {gateway.data.writable && <ChangeForm data={gateway.data} project={project} />}
            <ProfileSection data={gateway.data} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
