"use client";

import {
  ArrowRightLeftIcon,
  KeyRoundIcon,
  LifeBuoyIcon,
  TriangleAlertIcon,
  Undo2Icon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { useResource } from "@/api/hooks";
import type { ClaudeMemCurrent, ClaudeMemFacts, ClaudeMemSource, ModelRow } from "@/api/types";
import {
  ActionButton,
  ActionResultLine,
  type ActionState,
  useAction,
} from "@/components/action-button";
import {
  CLAUDE,
  fallbackWords,
  OFF,
  ownClaudeModelWords,
  takenOverWords,
} from "@/components/claude-mem-words";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CommandLine } from "@/components/copy-button";
import { StatusMark, TonePill } from "@/components/status";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { KIT_NAME, targetBackend, targetModel } from "@/lib/format";

/**
 * claude-mem's card (PM1): where its summaries go, the key that opens that backend, and what
 * takes over while the route's provider is limited. Every change is the person's own: it asks
 * first, runs the kit's own writer (`claudemem.*`), and a later `setup` leaves it as it is.
 * The model list is the slot picker's own (`/api/slots`), so no model is ever typed free.
 */

/** Who put a value there, in words. */
const SOURCE_WORDS: Record<ClaudeMemSource, string> = {
  default: "claude-mem's own default",
  hand: "set by hand in claude-mem's file",
  portal: "chosen here",
  setup: "set by setup, from the scout slot",
};

function routeWords(route: ClaudeMemCurrent["route"]): string {
  if (route.kind === "claude") {
    return `Claude, on your own login${route.model === null ? "" : ` (${route.model})`}`;
  }
  if (route.target !== null) {
    return `${targetModel(route.target)} on ${targetBackend(route.target)}`;
  }
  const model = route.model ?? "no model";
  return route.kind === "backend"
    ? `${model} at ${route.address ?? "an address the gateway does not know"}`
    : `${route.provider}, set by hand`;
}

/** One part of the card: its name, what holds now and who set it, then its control. */
function Part({
  icon,
  title,
  now,
  source,
  children,
  note,
  refused = false,
}: {
  icon: ReactNode;
  title: string;
  now: string;
  /** Who set the value; left out where no value is in use (no key on the Claude route). */
  source?: ClaudeMemSource;
  children: ReactNode;
  note?: ReactNode;
  /** A change here is refused now: a value it writes was set by hand (`refusedByHand`). */
  refused?: boolean;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </h3>
        <p className="text-sm text-pretty wrap-anywhere">{now}</p>
        {source !== undefined && (
          <p className="text-xs text-muted-foreground">{SOURCE_WORDS[source]}</p>
        )}
        {/* The kit never overwrites a value the person set by hand: say so before they try. */}
        {refused && (
          <StatusMark tone="warn" className="text-xs text-pretty">
            A value this writes was set by hand, so the kit changes nothing here. Let the kit manage
            claude-mem's values (above), or change them in the file.
          </StatusMark>
        )}
        {note}
      </div>
      {children}
    </section>
  );
}

/** The model list, grouped as the slot picker groups it: each backend's models, then Claude's. */
function backendGroups(models: ModelRow[]): Array<[string, ModelRow[]]> {
  const groups = new Map<string, ModelRow[]>();
  for (const model of models) {
    if (model.plan) continue;
    groups.set(model.backend, [...(groups.get(model.backend) ?? []), model]);
  }
  return [...groups.entries()];
}

/** What the list says while it loads, or why it is not there. */
function listNote(models: ModelList): null | string {
  if (models.status === "none")
    return `Set up the gateway to pick a backend model: ${KIT_NAME} gateway setup`;
  if (models.status === "loading") return "Reading the gateway's model list…";
  if (models.status === "error") return `The model list could not be read: ${models.message}`;
  return null;
}

type ModelList =
  | { status: "none" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; models: ModelRow[] };

/** The route: Claude, or one model from the gateway's live list. */
function RoutePart({ current, models }: { current: ClaudeMemCurrent; models: ModelList }) {
  const id = useId();
  const now = current.route.kind === "claude" ? CLAUDE : (current.route.target ?? "");
  const [choice, setChoice] = useState(now);
  // The value changed under the list (another tab, setup, a hand-back): the list follows it.
  useEffect(() => setChoice(now), [now]);
  const ready = models.status === "ready" ? models.models : [];
  const note = listNote(models);
  const toBackend = choice !== CLAUDE;
  return (
    <Part
      icon={<ArrowRightLeftIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
      title="Route and model"
      now={routeWords(current.route)}
      source={current.route.source}
      refused={current.route.refusedByHand}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>Send its summaries to</Label>
        <NativeSelect
          id={id}
          className="w-full"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
        >
          {now === "" && <NativeSelectOption value="">Pick one</NativeSelectOption>}
          <NativeSelectOption value={CLAUDE}>Claude, on your own login</NativeSelectOption>
          {backendGroups(ready).map(([backend, rows]) => (
            <NativeSelectOptGroup key={backend} label={backend}>
              {rows.map((row) => (
                <NativeSelectOption key={row.id} value={row.id}>
                  {targetModel(row.id)}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          ))}
          {now !== "" && now !== CLAUDE && !ready.some((row) => row.id === now) && (
            <NativeSelectOption value={now}>{targetModel(now)} (now)</NativeSelectOption>
          )}
        </NativeSelect>
        {note !== null && <p className="text-xs text-pretty text-muted-foreground">{note}</p>}
      </div>
      <ActionButton
        action="claudemem.route"
        body={{ confirm: true, target: choice }}
        variant="outline"
        disabled={current.route.refusedByHand || choice === now || choice === ""}
        confirm={{
          title: toBackend
            ? `Send claude-mem's summaries to ${targetModel(choice)}?`
            : "Put claude-mem back on Claude?",
          body: toBackend ? (
            <>
              <span className="block">
                From now on, what claude-mem summarises from every session goes to{" "}
                {targetModel(choice)} on {targetBackend(choice)}.
              </span>
              <span className="mt-2 block">
                The kit sends that model one tiny request first, and writes nothing if it does not
                answer.
              </span>
            </>
          ) : (
            "claude-mem's summaries go back to Claude, on your own login: they count toward your plan's usage."
          ),
          yes: toBackend ? "Send them there" : "Use Claude",
        }}
      >
        Use it
      </ActionButton>
    </Part>
  );
}

/** The key: the gateway's own key for that backend, or one the person pastes (never shown). */
function KeyPart({ current }: { current: ClaudeMemCurrent }) {
  const id = useId();
  const [key, setKey] = useState("");
  const [asking, setAsking] = useState(false);
  const { run, state } = useAction("claudemem.key", (result) => {
    if (result.ok) setKey("");
  });
  const sending = state.phase === "sending";
  const refused = current.key.refusedByHand;
  // The backend the key opens: the route's, or a Claude route's backend fallback.
  const target = current.route.target ?? current.fallback.target;
  const name = target === null ? "its backend" : targetBackend(target);
  const now =
    current.key.state === "gateway"
      ? `The gateway's own key for ${name}`
      : current.key.state === "other"
        ? "A key of your own (never shown)"
        : "No key";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (key.trim() !== "") setAsking(true);
  };
  return (
    <Part
      icon={<KeyRoundIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
      title="Key"
      now={now}
      source={current.key.source}
      refused={refused}
      note={
        current.key.pool && (
          <p className="text-xs text-pretty text-muted-foreground">
            Your own key pool is set too: claude-mem tries this key first, then the pool.
          </p>
        )
      }
    >
      {current.key.state !== "gateway" && target !== null && (
        <ActionButton
          action="claudemem.key"
          body={{ confirm: true, use: "gateway" }}
          variant="outline"
          disabled={refused}
          confirm={{
            title: `Use the gateway's own key for ${name}?`,
            body: "The same key the gateway's slots use, as setup gives it to claude-mem. The kit sends one tiny request with it first.",
            yes: "Use it",
          }}
        >
          Use the gateway's key
        </ActionButton>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Label htmlFor={id}>Use another key</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="paste the key"
            className="h-8 min-w-0 flex-1 basis-40 font-mono text-xs"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={refused || sending || key.trim() === ""}
            aria-busy={sending}
          >
            Save this key
          </Button>
        </div>
        <ActionResultLine state={state} />
        <p className="text-xs text-pretty text-muted-foreground">
          It goes into claude-mem's own file, readable only by you, and is never shown, printed or
          logged in full again: its last four characters at most.
        </p>
      </form>
      <ConfirmDialog
        open={asking}
        title="Save this key for claude-mem?"
        yes="Save the key"
        onCancel={() => setAsking(false)}
        onYes={() => {
          setAsking(false);
          run({ confirm: true, key, use: "other" });
        }}
      >
        The kit sends one tiny request with it first, and saves nothing if the backend refuses it.
      </ConfirmDialog>
    </Part>
  );
}

/** The fallback: off, Claude (its own model or one from the list), or a backend model. */
function FallbackPart({ current, models }: { current: ClaudeMemCurrent; models: ModelList }) {
  const id = useId();
  const { fallback, route } = current;
  const now =
    fallback.provider === OFF
      ? OFF
      : fallback.provider === CLAUDE
        ? (fallback.model ?? CLAUDE)
        : (fallback.target ?? "");
  const [choice, setChoice] = useState(now);
  useEffect(() => setChoice(now), [now]);
  const ready = models.status === "ready" ? models.models : [];
  const claudeRoute = route.kind === "claude";
  const backendRoute = route.kind === "backend";
  const claudeModels = ready.filter((row) => row.plan);
  const groups = backendRoute ? [] : backendGroups(ready);
  // Every value the list offers: the one in use now is shown even when it is not among them
  // (Claude as a Claude route's own fallback, a model the list does not name), so the list
  // never reads as a value that is not set.
  const offered = [
    OFF,
    ...(claudeRoute ? [] : [CLAUDE, ...claudeModels.map((row) => row.id)]),
    ...groups.flatMap(([, rows]) => rows.map((row) => row.id)),
  ];
  return (
    <Part
      icon={<LifeBuoyIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
      title="Fallback"
      now={fallbackWords(fallback)}
      source={fallback.source}
      refused={fallback.refusedByHand}
      note={
        fallback.idle !== null && (
          <StatusMark tone="warn" className="text-xs text-pretty">
            {fallback.idle}
          </StatusMark>
        )
      }
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>While the route's provider is limited</Label>
        <NativeSelect
          id={id}
          className="w-full"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
        >
          {now === "" && <NativeSelectOption value="">Pick one</NativeSelectOption>}
          <NativeSelectOption value={OFF}>Off: wait for it</NativeSelectOption>
          {!claudeRoute && (
            <NativeSelectOptGroup label="Claude, on your own login">
              <NativeSelectOption value={CLAUDE}>
                {ownClaudeModelWords(fallback)}
              </NativeSelectOption>
              {claudeModels.map((row) => (
                <NativeSelectOption key={row.id} value={row.id}>
                  {row.id}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          )}
          {groups.map(([backend, rows]) => (
            <NativeSelectOptGroup key={backend} label={backend}>
              {rows.map((row) => (
                <NativeSelectOption key={row.id} value={row.id}>
                  {targetModel(row.id)}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          ))}
          {now !== "" && !offered.includes(now) && (
            <NativeSelectOption value={now}>{fallbackWords(fallback)} (now)</NativeSelectOption>
          )}
        </NativeSelect>
        <p className="text-xs text-pretty text-muted-foreground">
          {backendRoute
            ? "claude-mem has one backend setting, and the route uses it: the fallback can be Claude, or off."
            : claudeRoute
              ? "On the Claude route, the fallback can be a backend model, or off."
              : "The fallback can be Claude, a backend model, or off."}
        </p>
      </div>
      <ActionButton
        action="claudemem.fallback"
        body={{ confirm: true, target: choice }}
        variant="outline"
        disabled={fallback.refusedByHand || choice === now || choice === ""}
        confirm={{
          title:
            choice === OFF
              ? "Turn claude-mem's fallback off?"
              : `Make ${choice === CLAUDE ? "Claude" : targetModel(choice)} claude-mem's fallback?`,
          body:
            choice === OFF
              ? "While its route's provider is limited, claude-mem waits, and summarises nothing until it answers again."
              : choice.includes(":")
                ? `While its route's provider is limited, what claude-mem summarises goes to ${targetModel(choice)} on ${targetBackend(choice)}. The kit sends it one tiny request first.`
                : "While its route's provider is limited, claude-mem summarises on your own Claude login: that counts toward your plan's usage.",
          yes: "Set the fallback",
        }}
      >
        Set the fallback
      </ActionButton>
    </Part>
  );
}

/**
 * The take-over (MS1, D63): the values set by hand that refuse a choice now, by name, and the
 * offer to let the kit manage them. It asks first, naming the keys; nothing in the file changes.
 * Once they are the kit's, only its result stays, until it clears itself.
 */
function TakeOver({
  facts,
  state,
  run,
}: {
  facts: ClaudeMemFacts;
  state: ActionState;
  run: (body: Record<string, unknown>) => void;
}) {
  const [asking, setAsking] = useState(false);
  const keys = facts.handKeys;
  const sending = state.phase === "sending";
  if (keys.length === 0) return <ActionResultLine state={state} />;
  const keyList = (
    <ul className="flex flex-col gap-0.5 font-mono text-xs wrap-anywhere">
      {keys.map((key) => (
        <li key={key}>{key}</li>
      ))}
    </ul>
  );
  return (
    <>
      {/* A note, not an alert: it is the card's state on every load, not news to announce. */}
      <Alert role="note" className="border-warn/40">
        <TriangleAlertIcon className="text-warn" aria-hidden="true" />
        <AlertTitle className="text-pretty">
          {takenOverWords(keys.length)}, so the kit changes none of them
        </AlertTitle>
        <div className="flex min-w-0 flex-col items-start gap-2 text-sm text-muted-foreground">
          <p className="text-pretty">
            The choices they hold are refused below. Let the kit manage them to change claude-mem's
            route, key and fallback here:
          </p>
          {keyList}
          <Button
            size="sm"
            variant="outline"
            disabled={sending}
            aria-busy={sending}
            onClick={() => setAsking(true)}
          >
            Let the kit manage these
          </Button>
          <ActionResultLine state={state} onRetry={() => setAsking(true)} />
        </div>
      </Alert>
      <ConfirmDialog
        open={asking}
        title="Let the kit manage these values?"
        yes="Let the kit manage them"
        onCancel={() => setAsking(false)}
        onYes={() => {
          setAsking(false);
          run({ confirm: true });
        }}
      >
        <div className="flex flex-col gap-2">
          <p>
            The kit records these values in{" "}
            <span className="font-mono wrap-anywhere">{facts.file}</span> as its own:
          </p>
          {keyList}
          <p>
            Nothing in the file changes now: each value stays exactly as it is until you pick
            another here.
          </p>
          <p>
            <span className="font-mono">{KIT_NAME} restore</span> puts them back as they were. A
            key's value is never written down: restore leaves a taken-over key as you set it, or,
            once the kit replaced it, names the backup that holds yours.
          </p>
        </div>
      </ConfirmDialog>
    </>
  );
}

/** The card. Blocked (not installed, too old, a file it cannot read): the reason and the fix. */
export function ClaudeMemCard({ facts }: { facts: ClaudeMemFacts }) {
  const gateway = facts.backends !== null && facts.current !== null;
  const list = useResource(
    (client) => (gateway ? client.slots() : Promise.resolve(null)),
    gateway ? "slots" : "none",
  );
  const models: ModelList = !gateway
    ? { status: "none" }
    : list.status === "loading"
      ? { status: "loading" }
      : list.status === "error"
        ? { message: list.message, status: "error" }
        : { models: list.data?.models ?? [], status: "ready" };
  const current = facts.current;
  const needsKey =
    current !== null &&
    (current.route.kind === "backend" || current.fallback.provider === "openai-compatible");
  // Something here is the person's choice: the card offers to hand it back to setup.
  const chosen =
    current !== null &&
    [current.route.source, current.key.source, current.fallback.source].includes("portal");
  // Here, not in the take-over's own box: the box goes once the values are the kit's, and its
  // result must stay in place after it.
  const takeOver = useAction("claudemem.takeover");
  return (
    <Card className="@4xl/main:col-span-2">
      <CardHeader>
        <CardTitle>claude-mem</CardTitle>
        <CardDescription className="text-pretty">
          Your memory plugin summarises every session. Those summaries leave this machine for the
          model chosen here: Claude on your own login, or a backend model through the gateway.
        </CardDescription>
        <CardAction>
          {current === null ? (
            <TonePill tone="warn">not ready</TonePill>
          ) : (
            <TonePill tone="info">
              {current.route.kind === "claude"
                ? "on Claude"
                : current.route.target !== null
                  ? `on ${targetBackend(current.route.target)}`
                  : `on ${current.route.provider}`}
            </TonePill>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {current === null || facts.blocked !== null ? (
          <div className="flex flex-col gap-2">
            <p className="text-pretty">{facts.blocked?.text}</p>
            {facts.blocked?.fix != null && (
              <CommandLine command={facts.blocked.fix} label="Copy the fix" />
            )}
          </div>
        ) : (
          <>
            <TakeOver facts={facts} state={takeOver.state} run={takeOver.run} />
            <div className="grid gap-4 @3xl/main:grid-cols-3">
              <RoutePart current={current} models={models} />
              {needsKey ? (
                <KeyPart current={current} />
              ) : (
                <Part
                  icon={
                    <KeyRoundIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  }
                  title="Key"
                  now="No key needed: Claude uses your own login"
                >
                  <p className="text-xs text-pretty text-muted-foreground">
                    Pick a backend model for the route or the fallback, and its key is set here.
                  </p>
                </Part>
              )}
              <FallbackPart current={current} models={models} />
            </div>
            <p className="text-xs text-pretty text-muted-foreground">
              Saved in <span className="font-mono">{facts.file}</span> with a backup, and taken out
              again by {KIT_NAME} restore. Setup leaves a value you choose here until you hand it
              back. claude-mem reads the file each time it uses it: no restart.
            </p>
            {/* Always there, so its own result stays in place after the hand-back. */}
            <ActionButton
              action="claudemem.follow"
              body={{ confirm: true }}
              variant="outline"
              disabled={!chosen}
              icon={<Undo2Icon data-icon="inline-start" aria-hidden="true" />}
              confirm={{
                title: "Hand claude-mem back to setup?",
                body: "Your choices here are forgotten, and setup's own claude-mem step runs now: claude-mem follows the gateway's scout slot again (after one tiny request to its model), and its fallback goes back to claude-mem's own default. A value you set by hand in the file stays yours.",
                yes: "Hand it back",
              }}
            >
              Let setup decide again
            </ActionButton>
          </>
        )}
      </CardContent>
    </Card>
  );
}
