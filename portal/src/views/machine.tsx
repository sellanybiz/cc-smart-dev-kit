"use client";

import {
  DownloadIcon,
  FileCheckIcon,
  GlobeIcon,
  PowerIcon,
  StethoscopeIcon,
  Undo2Icon,
} from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { useResource } from "@/api/hooks";
import { MACHINE_REFRESH } from "@/api/refresh";
import type {
  AutoModeChange,
  ClaudeCodeFacts,
  DoctorLine,
  MachineData,
  McpServerRow,
} from "@/api/types";
import { ActionButton, ActionResultLine, useAction } from "@/components/action-button";
import { ClaudeMemCard } from "@/components/claude-mem-card";
import { CommandLine } from "@/components/copy-button";
import { HeavyJobsCard } from "@/components/heavy-jobs";
import { UpdatesCard, WorktreesCard } from "@/components/machine-cards";
import { SectionCards, StatCard } from "@/components/section-cards";
import { PagePad, ResourceView } from "@/components/states";
import { StatusMark, type Tone, TonePill } from "@/components/status";
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
import { ago, clockTime, KIT_NAME } from "@/lib/format";

const DOCTOR_TONE: Record<DoctorLine["mark"], Tone> = {
  ok: "ok",
  warn: "warn",
  fail: "bad",
  info: "info",
};

const MCP_WORDS: Record<McpServerRow["state"], { tone: Tone; words: string }> = {
  ours: { tone: "ok", words: "registered by the kit" },
  foreign: { tone: "warn", words: "something else runs under this name" },
  missing: { tone: "bad", words: "not registered" },
  unreadable: { tone: "warn", words: "Claude Code's config cannot be read" },
  unknown: { tone: "warn", words: "registered, the kit's record cannot be read" },
};

function companionTone(state: string): Tone {
  if (state === "ok") return "ok";
  if (state === "missing") return "bad";
  return "warn";
}

/** A detail line from `doctor` starts with its own mark; the page draws the mark itself. */
function withoutMark(text: string): string {
  return text.replace(/^[✓!✗·]\s*/, "");
}

function order(mark: DoctorLine["mark"]): number {
  return { fail: 0, warn: 1, info: 2, ok: 3 }[mark];
}

/** What the last `doctor --live` proved, against the Claude Code this machine runs now. */
function liveWords(claude: ClaudeCodeFacts): { tone: Tone; pill: string; line: string } {
  const live = claude.liveCheck;
  if (live === null) {
    return {
      line: "doctor --live has not run on this machine",
      pill: "not proved here",
      tone: "info",
    };
  }
  if (claude.version === null) {
    return {
      line: `doctor --live last passed on ${live.claudeCode}`,
      pill: "last proof",
      tone: "info",
    };
  }
  if (live.claudeCode !== claude.version) {
    return {
      line: `doctor --live last passed on ${live.claudeCode}, not this one`,
      pill: "proved on another",
      tone: "warn",
    };
  }
  return { line: `doctor --live passed on ${live.claudeCode}`, pill: "proved here", tone: "ok" };
}

/**
 * Runs `doctor` again. Its answer is every check, and the list below redraws from the pass it
 * made (the `doctor` event), so the button only says it runs; a failure keeps its words here.
 */
function DoctorRun() {
  const { run, state } = useAction("doctor.run");
  const sending = state.phase === "sending";
  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        size="sm"
        variant="outline"
        disabled={sending}
        aria-busy={sending}
        onClick={() => run({})}
      >
        <StethoscopeIcon data-icon="inline-start" aria-hidden="true" />
        {sending ? "Running…" : "Run doctor"}
      </Button>
      {state.phase === "done" && !state.result.ok && <ActionResultLine state={state} />}
    </div>
  );
}

function DoctorCard({ data, now }: { data: MachineData; now: number }) {
  const failing = data.doctor.filter((line) => line.mark === "fail").length;
  return (
    <Card className="@4xl/main:col-span-2">
      <CardHeader>
        <CardTitle>Doctor</CardTitle>
        <CardDescription>
          {data.doctorAt === null
            ? `The same checks as ${KIT_NAME} doctor. Not run yet.`
            : `The same checks as ${KIT_NAME} doctor, run ${ago(data.doctorAt, now)} (${clockTime(data.doctorAt)}). ${failing === 0 ? "Nothing to fix." : `${failing} to fix, first.`}`}
        </CardDescription>
        <CardAction>
          <DoctorRun />
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-x-6 gap-y-2 text-sm @3xl/main:grid-cols-2">
          {[...data.doctor]
            .sort((a, b) => order(a.mark) - order(b.mark))
            .map((line) => (
              <li key={`${line.section}-${line.text}`} className="flex min-w-0 flex-col gap-1">
                <StatusMark tone={DOCTOR_TONE[line.mark]}>
                  <span className="text-muted-foreground">{line.section}: </span>
                  <span className="text-pretty wrap-anywhere">{line.text}</span>
                </StatusMark>
                {line.fix !== null && (
                  <span className="pl-[1.125rem]">
                    <CommandLine command={line.fix} label="Copy the fix" />
                  </span>
                )}
              </li>
            ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CompanionsCard({ data }: { data: MachineData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Companion plugins</CardTitle>
        <CardDescription>Plugins the kit works with, and their state.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {data.companions.map((companion) => (
          <div key={companion.id} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{companion.title}</span>
              <TonePill tone={companionTone(companion.state)}>{companion.state}</TonePill>
            </div>
            <span className="font-mono text-xs text-muted-foreground wrap-anywhere">
              {companion.id}
            </span>
            <span className="text-sm text-pretty">{withoutMark(companion.detail)}</span>
            {companion.enableArgv !== null ? (
              <ActionButton
                action="companion.enable"
                body={{ id: companion.id }}
                variant="outline"
                icon={<PowerIcon data-icon="inline-start" aria-hidden="true" />}
                confirm={{
                  title: `Turn ${companion.title} on?`,
                  body: (
                    <>
                      <span className="block">
                        A plugin turned off is a choice: this runs the same command the CLI prints.
                      </span>
                      <code className="mt-2 block font-mono text-xs wrap-anywhere">
                        {companion.enableArgv.join(" ")}
                      </code>
                      <span className="mt-2 block">
                        New Claude sessions load it; a running one keeps what it has.
                      </span>
                    </>
                  ),
                  yes: "Turn it on",
                }}
              >
                Turn it on
              </ActionButton>
            ) : (
              companion.command !== null && (
                <CommandLine command={companion.command} label="Copy the fix" />
              )
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function McpCard({ servers }: { servers: McpServerRow[] }) {
  const missing = servers.some((server) => server.state === "missing");
  return (
    <Card>
      <CardHeader>
        <CardTitle>MCP servers</CardTitle>
        <CardDescription>
          The servers setup registers for every project, read from Claude Code's own config.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-3 text-sm">
          {servers.map((server) => (
            <li key={server.name} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs">{server.name}</span>
                <TonePill tone={MCP_WORDS[server.state].tone}>
                  {MCP_WORDS[server.state].words}
                </TonePill>
              </span>
              {server.runsWhat !== null && (
                <span className="text-xs text-muted-foreground wrap-anywhere">
                  Runs <code className="font-mono">{server.runsWhat}</code> instead.
                </span>
              )}
            </li>
          ))}
        </ul>
        {missing && (
          <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            Setup registers a missing one:
            <CommandLine command={`${KIT_NAME} setup`} label="Copy the command" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** What an OmniRoute restart costs, in the design's words: said before the update asks. */
const OMNIROUTE_RESTART =
  "While it restarts, a request to an OmniRoute target fails: a slot with its fallback on moves to its next target, if it has one; any other slot answers with that error. A version that does not answer is put back.";

function OmnirouteCard({ data }: { data: MachineData }) {
  const { omniroute } = data;
  const canUpdate = omniroute.install !== null && omniroute.state === "behind";
  return (
    <Card>
      <CardHeader>
        <CardTitle>OmniRoute</CardTitle>
        <CardDescription>The program the affordable slots answer from.</CardDescription>
        <CardAction>
          <TonePill
            tone={omniroute.state === "ok" ? "ok" : omniroute.state === "behind" ? "warn" : "info"}
          >
            {omniroute.state === "ok"
              ? "up to date"
              : omniroute.state === "behind"
                ? "update ready"
                : "unknown"}
          </TonePill>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">Installed</dt>
          <dd>
            {omniroute.install === null
              ? "not found"
              : `${omniroute.install.version}, through ${omniroute.install.manager}`}
          </dd>
          <dt className="text-muted-foreground">Newest</dt>
          <dd>
            {omniroute.newestVersion ?? "unknown"}
            {omniroute.newestVersion !== null && (
              <span className="text-muted-foreground"> (three days old or more)</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Service</dt>
          {omniroute.unit === null ? (
            <dd>none</dd>
          ) : (
            <dd className="font-mono text-xs">{omniroute.unit}</dd>
          )}
          <dt className="text-muted-foreground">Backend</dt>
          {/* The backend is matched to an installed OmniRoute: with none, it is not known. */}
          {omniroute.backend !== null ? (
            <dd className="font-mono text-xs wrap-anywhere">{omniroute.backend}</dd>
          ) : (
            <dd>
              {omniroute.install === null
                ? "not known: OmniRoute is not installed here"
                : "no gateway backend points at it"}
            </dd>
          )}
          {omniroute.previous !== null && (
            <>
              <dt className="text-muted-foreground">Before</dt>
              <dd>
                {omniroute.previous.version}, replaced on {omniroute.previous.at.slice(0, 10)}
              </dd>
            </>
          )}
        </dl>
        {omniroute.registryError !== null && (
          <p className="text-pretty text-warn">
            The npm registry could not be read: {omniroute.registryError}
          </p>
        )}
        {omniroute.install !== null && (
          <p className="text-pretty text-muted-foreground">
            {omniroute.unit === null
              ? `No user unit runs OmniRoute here, so an update installs the new version but cannot restart it or check it: restart OmniRoute the way this machine runs it, then run ${KIT_NAME} omniroute status.`
              : `The update restarts ${omniroute.unit}. ${OMNIROUTE_RESTART}`}
          </p>
        )}
        {(canUpdate || omniroute.previous !== null) && (
          <div className="flex flex-wrap items-start gap-3">
            {canUpdate && (
              <ActionButton
                action="omniroute.update"
                body={{}}
                icon={<DownloadIcon data-icon="inline-start" aria-hidden="true" />}
                confirm={{
                  title: `Update OmniRoute to ${omniroute.newestVersion ?? "the newest release"}?`,
                  body: `It installs the newest release that is three days old or more, and restarts the model path. ${OMNIROUTE_RESTART}`,
                  yes: "Update and restart",
                }}
              >
                Update to {omniroute.newestVersion}
              </ActionButton>
            )}
            {omniroute.previous !== null && (
              <ActionButton
                action="omniroute.rollback"
                body={{}}
                variant="outline"
                icon={<Undo2Icon data-icon="inline-start" aria-hidden="true" />}
                confirm={{
                  title: `Put OmniRoute ${omniroute.previous.version} back?`,
                  body: `It installs the version the last update replaced, and restarts the model path. ${OMNIROUTE_RESTART}`,
                  yes: "Put it back",
                }}
              >
                Roll back to {omniroute.previous.version}
              </ActionButton>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The extension's token, saved through `browser token`'s own writer. The field starts empty and
 * is emptied after a save: the stored token is never on the page, and no answer echoes it.
 */
function TokenField({ tokenSet, platform }: { tokenSet: boolean; platform: string }) {
  const id = useId();
  const [token, setToken] = useState("");
  const { run, state } = useAction("browser.token", () => setToken(""));
  const sending = state.phase === "sending";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    run({ token });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Label htmlFor={id}>The extension's token</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={
            tokenSet
              ? "a token is set: paste a new one to replace it"
              : "paste PLAYWRIGHT_MCP_EXTENSION_TOKEN=…"
          }
          className="h-8 min-w-0 flex-1 basis-56 font-mono text-xs"
        />
        <Button type="submit" size="sm" variant="outline" disabled={sending} aria-busy={sending}>
          Save the token
        </Button>
      </div>
      <ActionResultLine state={state} />
      <p className="text-xs text-pretty text-muted-foreground">
        It is written to the same file {KIT_NAME} browser token writes,{" "}
        {platform === "win32"
          ? "in your own user profile, where only you can read it"
          : "mode 600: readable only by you"}
        , and it is never shown again, printed, or logged anywhere.
      </p>
    </form>
  );
}

function BrowserCard({ data }: { data: MachineData }) {
  const { browser } = data;
  const ready = browser.state.tokenSet && browser.state.extensionInstalled;
  const profile = browser.state.profileDirName;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Browser</CardTitle>
        <CardDescription>
          The Playwright MCP server drives your Chrome, in a profile of its own named{" "}
          <span className="font-mono">{profile}</span>. {browser.guide.intro}
        </CardDescription>
        <CardAction>
          <TonePill tone={ready ? "ok" : "warn"}>{ready ? "ready" : "not ready"}</TonePill>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ActionButton
          action="browser.setup"
          body={{}}
          variant="outline"
          icon={<GlobeIcon data-icon="inline-start" aria-hidden="true" />}
          confirm={{
            title: `Open the extension's page in the ${profile} profile?`,
            body: `The same command as ${KIT_NAME} browser setup runs: Chrome comes to the front, nothing is installed without your click, and the profile is named in Chrome's own settings file while Chrome is closed.`,
            yes: "Open it",
          }}
        >
          Set up the browser
        </ActionButton>
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm marker:text-muted-foreground">
          {browser.guide.steps.map((step) => (
            <li key={step.text} className="pl-1">
              <StatusMark tone={step.done === true ? "ok" : step.done === false ? "warn" : "info"}>
                <span className="text-pretty">{step.text}</span>
                {step.detail !== undefined && (
                  <code className="mt-1 block w-fit rounded bg-muted px-1.5 py-0.5 font-mono text-xs wrap-anywhere">
                    {step.detail}
                  </code>
                )}
              </StatusMark>
            </li>
          ))}
        </ol>
        {[...browser.guide.notes, ...browser.notes].map((note) => (
          <p key={note} className="text-xs text-pretty text-muted-foreground wrap-anywhere">
            {withoutMark(note)}
          </p>
        ))}
        <TokenField tokenSet={browser.state.tokenSet} platform={data.facts.platform} />
      </CardContent>
    </Card>
  );
}

/**
 * The project's auto-mode trust rules, as `setup`'s own `+` / `-` lines. The write sends back the
 * hash of exactly this change, and the server plans again under its lock and refuses another.
 */
function AutoModeCard({ change }: { change: NonNullable<AutoModeChange> }) {
  const lines = [
    ...change.added.map((entry) => ({ entry, mark: "+" })),
    ...change.removed.map((entry) => ({ entry, mark: "-" })),
  ];
  return (
    <Card className="@4xl/main:col-span-2">
      <CardHeader>
        <CardTitle>Auto mode: trust rules</CardTitle>
        <CardDescription className="text-pretty">
          These come from <span className="font-mono wrap-anywhere">{change.from}</span> and go into{" "}
          <span className="font-mono">{change.settings}</span>, the only place Claude Code's auto
          mode reads them from. They are trust rules: read them before you say yes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {change.differsFrom !== null && (
          <p className="text-pretty text-warn">
            This worktree's file is not the same as the main checkout's (
            <span className="font-mono">{change.differsFrom}</span>). The rules below come from this
            worktree's file.
          </p>
        )}
        {lines.length === 0 ? (
          <p className="text-muted-foreground">Your user settings already hold these rules.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1.5 font-mono text-xs">
              {lines.map((line) => (
                <li key={`${line.mark}${line.entry}`} className="flex gap-2">
                  <span className={line.mark === "+" ? "text-ok" : "text-bad"} aria-hidden="true">
                    {line.mark}
                  </span>
                  <span className="wrap-anywhere">
                    <span className="sr-only">{line.mark === "+" ? "added: " : "removed: "}</span>
                    {line.entry}
                  </span>
                </li>
              ))}
            </ul>
            <ActionButton
              action="automode.apply"
              body={{ confirm: true, shownHash: change.hash }}
              icon={<FileCheckIcon data-icon="inline-start" aria-hidden="true" />}
              confirm={{
                title: "Write these trust rules?",
                body: `They go into ${change.settings}, and auto mode will treat them as true.`,
                yes: "Write them",
              }}
            >
              Write them
            </ActionButton>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MachinePage({ data }: { data: MachineData }) {
  const [now] = useState(() => Date.now());
  const failing = data.doctor.filter((line) => line.mark === "fail").length;
  const warning = data.doctor.filter((line) => line.mark === "warn").length;
  const claude = data.claudeCode;
  const live = liveWords(claude);
  const { bun } = data;
  return (
    <>
      <SectionCards columns={4}>
        <StatCard
          label={KIT_NAME}
          value={data.facts.version}
          headline="Installed and enabled"
          detail={`The portal listens on 127.0.0.1:${data.facts.portalPort}`}
        />
        <StatCard
          label="Claude Code"
          value={claude.version ?? "unknown"}
          badge={<TonePill tone={live.tone}>{live.pill}</TonePill>}
          headline={live.line}
          detail={
            claude.why ??
            `Prove it${claude.liveCheck === null ? "" : " again"} with ${KIT_NAME} doctor --live`
          }
        />
        <StatCard
          label="Bun"
          value={bun.version}
          badge={
            bun.ok ? (
              <TonePill tone="ok">new enough</TonePill>
            ) : (
              <TonePill tone="bad">too old</TonePill>
            )
          }
          headline={`The kit needs ${bun.minimum} or newer`}
          detail="The Bun this portal runs on"
        />
        <StatCard
          label="Doctor"
          value={
            data.doctorAt === null
              ? "Not run"
              : failing > 0
                ? `${failing} failing`
                : warning > 0
                  ? `${warning} to look at`
                  : "All good"
          }
          badge={
            failing > 0 ? (
              <TonePill tone="bad">fix</TonePill>
            ) : warning > 0 ? (
              <TonePill tone="warn">look</TonePill>
            ) : data.doctorAt === null ? undefined : (
              <TonePill tone="ok">pass</TonePill>
            )
          }
          headline={`${data.doctor.length} checks`}
          detail={data.doctorAt === null ? "Run it below" : `Run ${ago(data.doctorAt, now)}`}
        />
      </SectionCards>
      <PagePad className="grid gap-4 md:gap-6 @4xl/main:grid-cols-2">
        <DoctorCard data={data} now={now} />
        <HeavyJobsCard />
        <UpdatesCard />
        <CompanionsCard data={data} />
        <McpCard servers={data.mcp} />
        <BrowserCard data={data} />
        <OmnirouteCard data={data} />
        <ClaudeMemCard facts={data.claudeMem} />
        {data.autoMode !== null && <AutoModeCard change={data.autoMode} />}
        <Card>
          <CardHeader>
            <CardTitle>Warp</CardTitle>
            <CardDescription>
              Optional. Installing or removing it needs sudo, so the portal never runs it.
            </CardDescription>
            <CardAction>
              <TonePill tone={data.warp.installed ? "ok" : "info"}>
                {data.warp.installed ? "installed" : "not installed"}
              </TonePill>
            </CardAction>
          </CardHeader>
          <CardContent className="text-sm">{data.warp.detail}</CardContent>
        </Card>
        <WorktreesCard />
      </PagePad>
    </>
  );
}

/** Machine: versions, doctor, the queue, the companions, the MCP servers, the browser, OmniRoute. */
export function MachineView() {
  const machine = useResource((client) => client.machine(), "", MACHINE_REFRESH);
  return (
    <ResourceView resource={machine} label="the machine">
      {(data) => <MachinePage data={data} />}
    </ResourceView>
  );
}
