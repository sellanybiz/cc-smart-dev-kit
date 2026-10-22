"use client";

import { useResource } from "@/api/hooks";
import { MACHINE_REFRESH } from "@/api/refresh";
import type { DoctorLine, MachineData, McpServerStatus } from "@/api/types";
import { CopyButton } from "@/components/copy-button";
import { HeavyJobsCard } from "@/components/heavy-jobs";
import { UpdatesCard, WorktreesCard } from "@/components/machine-cards";
import { SectionCards, StatCard } from "@/components/section-cards";
import { PagePad, ResourceView } from "@/components/states";
import { StatusMark, type Tone, TonePill } from "@/components/status";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KIT_NAME } from "@/lib/format";

const DOCTOR_TONE: Record<DoctorLine["mark"], Tone> = {
  ok: "ok",
  warn: "warn",
  fail: "bad",
  info: "info",
};

const MCP_WORDS: Record<McpServerStatus["state"], { tone: Tone; words: string }> = {
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
  return text.replace(/^[✓!✗]\s*/, "");
}

function MachinePage({ data }: { data: MachineData }) {
  const failing = data.doctor.filter((line) => line.mark === "fail").length;
  const warning = data.doctor.filter((line) => line.mark === "warn").length;
  const claude = data.claudeCode;
  const newer = claude !== null && claude.version !== null && claude.version !== claude.tested;
  const { omniroute, browser } = data;
  return (
    <>
      <SectionCards columns={4}>
        <StatCard
          label={KIT_NAME}
          value={data.facts.version}
          headline="Installed and enabled"
          detail={`The portal listens on 127.0.0.1:${data.facts.portalPort}`}
        />
        {claude !== null && (
          <StatCard
            label="Claude Code"
            value={claude.version ?? "not found"}
            badge={
              newer ? (
                <TonePill tone="info">newer than tested</TonePill>
              ) : (
                <TonePill tone="ok">tested</TonePill>
              )
            }
            headline={`The kit was last proved on ${claude.tested}`}
            detail={
              newer
                ? "A newer version usually works; the kit says when it does not"
                : "The version the kit was proved on"
            }
          />
        )}
        {data.bun !== null && (
          <StatCard
            label="Bun"
            value={data.bun}
            headline="Runs the kit's hooks and commands"
            detail="Found on this machine"
          />
        )}
        <StatCard
          label="Doctor"
          value={
            failing > 0 ? `${failing} failing` : warning > 0 ? `${warning} to look at` : "All good"
          }
          badge={
            failing > 0 ? (
              <TonePill tone="bad">fix</TonePill>
            ) : warning > 0 ? (
              <TonePill tone="warn">look</TonePill>
            ) : (
              <TonePill tone="ok">pass</TonePill>
            )
          }
          headline={`${data.doctor.length} checks`}
          detail={`The same checks as ${KIT_NAME} doctor`}
        />
      </SectionCards>
      <PagePad className="grid gap-4 md:gap-6 @4xl/main:grid-cols-2">
        <Card className="@4xl/main:col-span-2">
          <CardHeader>
            <CardTitle>Doctor</CardTitle>
            <CardDescription>What needs you comes first.</CardDescription>
            <CardAction>
              <CopyButton text={`${KIT_NAME} doctor`} label="Copy the command" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm @3xl/main:grid-cols-2">
              {[...data.doctor]
                .sort((a, b) => order(a.mark) - order(b.mark))
                .map((line) => (
                  <li key={`${line.section}-${line.text}`}>
                    <StatusMark tone={DOCTOR_TONE[line.mark]}>
                      <span className="text-muted-foreground">{line.section}: </span>
                      {line.text}
                    </StatusMark>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
        <HeavyJobsCard />
        <UpdatesCard />
        <Card>
          <CardHeader>
            <CardTitle>Companion plugins</CardTitle>
            <CardDescription>Plugins the kit works with, and their state.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {data.companions.map((companion) => (
              <div key={companion.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{companion.title}</span>
                  <TonePill tone={companionTone(companion.state)}>{companion.state}</TonePill>
                </div>
                <span className="font-mono text-xs text-muted-foreground">{companion.id}</span>
                <span className="text-sm">{withoutMark(companion.detail)}</span>
                {companion.command !== null && (
                  <CopyButton text={companion.command} label="Copy the fix" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>MCP servers</CardTitle>
            <CardDescription>The servers setup registers for every project.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.mcp === null && (
              <p className="text-sm text-muted-foreground">
                The portal does not list them yet:{" "}
                <code className="font-mono">{KIT_NAME} mcp status</code> does.
              </p>
            )}
            <ul className="flex flex-col gap-3 text-sm">
              {(data.mcp ?? []).map((server) => (
                <li key={server.name} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{server.name}</span>
                  <TonePill tone={MCP_WORDS[server.state].tone}>
                    {MCP_WORDS[server.state].words}
                  </TonePill>
                </li>
              ))}
            </ul>
            {(data.mcp ?? []).some((server) => server.state === "missing") && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                Setup registers a missing one:
                <CopyButton text={`${KIT_NAME} setup`} label="Copy the command" />
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Browser</CardTitle>
            <CardDescription>{browser.guide.intro}</CardDescription>
            <CardAction>
              <TonePill
                tone={browser.state.tokenSet && browser.state.extensionInstalled ? "ok" : "warn"}
              >
                {browser.state.tokenSet && browser.state.extensionInstalled ? "ready" : "not ready"}
              </TonePill>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm marker:text-muted-foreground">
              {browser.guide.steps.map((step) => (
                <li key={step.text} className="pl-1">
                  <StatusMark
                    tone={step.done === true ? "ok" : step.done === false ? "warn" : "info"}
                  >
                    <span className="text-pretty">{step.text}</span>
                    {step.detail !== undefined && (
                      <code className="mt-1 block w-fit rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {step.detail}
                      </code>
                    )}
                  </StatusMark>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>OmniRoute</CardTitle>
            <CardDescription>The program the affordable slots answer from.</CardDescription>
            <CardAction>
              <TonePill
                tone={
                  omniroute.state === "ok" ? "ok" : omniroute.state === "behind" ? "warn" : "info"
                }
              >
                {omniroute.state === "ok"
                  ? "up to date"
                  : omniroute.state === "behind"
                    ? "update ready"
                    : "unknown"}
              </TonePill>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">Installed</dt>
              <dd>
                {omniroute.install === null
                  ? "not found"
                  : `${omniroute.install.version}, through ${omniroute.install.manager}`}
              </dd>
              <dt className="text-muted-foreground">Newest</dt>
              <dd>
                {omniroute.newestVersion ?? omniroute.registryError ?? "unknown"}
                {omniroute.newestVersion !== null && (
                  <span className="text-muted-foreground"> (three days old or more)</span>
                )}
              </dd>
              <dt className="text-muted-foreground">Service</dt>
              <dd className="font-mono text-xs">{omniroute.unit ?? "none"}</dd>
              <dt className="text-muted-foreground">Backend</dt>
              <dd className="wrap-any font-mono text-xs">{omniroute.backend ?? "not set up"}</dd>
              {omniroute.previous !== null && (
                <>
                  <dt className="text-muted-foreground">Before</dt>
                  <dd>
                    {omniroute.previous.version}, replaced on {omniroute.previous.at}
                  </dd>
                </>
              )}
            </dl>
            {omniroute.state === "behind" && (
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={`${KIT_NAME} omniroute update`} label="Copy the update command" />
              </div>
            )}
          </CardContent>
        </Card>
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

function order(mark: DoctorLine["mark"]): number {
  return { fail: 0, warn: 1, info: 2, ok: 3 }[mark];
}

/** Machine: versions, Claude Code, the companions, the MCP servers, the browser, OmniRoute. */
export function MachineView() {
  const machine = useResource((client) => client.machine(), "", MACHINE_REFRESH);
  return (
    <ResourceView resource={machine} label="the machine">
      {(data) => <MachinePage data={data} />}
    </ResourceView>
  );
}
