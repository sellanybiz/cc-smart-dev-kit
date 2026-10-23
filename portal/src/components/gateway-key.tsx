"use client";

import { KeyRoundIcon } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import type { MachineData } from "@/api/types";
import { ActionResultLine, useAction } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CommandLine } from "@/components/copy-button";
import { TonePill } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KIT_NAME } from "@/lib/format";

type KeyState = MachineData["gatewayKey"];

/** The state in a pill, and in a sentence: never the key itself. */
const STATE_WORDS: Record<
  KeyState,
  { pill: string; tone: "bad" | "info" | "ok" | "warn"; now: string }
> = {
  set: { pill: "key set", tone: "ok", now: "A key is set. It is never shown here." },
  none: {
    pill: "no key yet",
    tone: "warn",
    now: "No key yet, so the gateway's requests to OmniRoute are refused.",
  },
  "not-set-up": {
    pill: "not set up",
    tone: "info",
    now: "The gateway is not set up on this machine yet.",
  },
  unreadable: {
    pill: "config unreadable",
    tone: "bad",
    now: "The gateway's config cannot be read, so its key cannot be changed here. The Doctor card says why.",
  },
};

/**
 * The gateway's own OmniRoute key, on the OmniRoute card (PK1): paste a key, or make one with
 * OmniRoute's dashboard password, as `gateway setup` does on a terminal. Both fields start empty
 * and are emptied after a save: the key and the password are never on the page, and no answer
 * holds either. The server tests the key with OmniRoute before it saves it.
 */
export function GatewayKeyPart({ state }: { state: KeyState }) {
  const titleId = useId();
  const words = STATE_WORDS[state];
  const canChange = state === "set" || state === "none";
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3 border-t pt-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={titleId} className="flex items-center gap-2 text-sm font-medium">
            <KeyRoundIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            The gateway's key
          </h3>
          <TonePill tone={words.tone}>{words.pill}</TonePill>
        </div>
        <p className="text-pretty">{words.now}</p>
        <p className="text-xs text-pretty text-muted-foreground">
          The key the gateway's own requests to OmniRoute carry: an OmniRoute API key, from its
          dashboard's API keys page. A provider key (an Ollama Cloud key, say) is a different
          credential, and OmniRoute refuses it.
        </p>
      </div>
      {state === "not-set-up" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-pretty">
            Set the gateway up in a terminal first: it asks for this key, or makes one with your
            OmniRoute password.
          </p>
          <CommandLine command={`${KIT_NAME} gateway setup`} label="Copy the command" />
        </div>
      )}
      {canChange && (
        <>
          <PasteKey keySet={state === "set"} />
          <MakeKey />
        </>
      )}
    </section>
  );
}

/** Paste a key: tested with OmniRoute, then saved; untested only with the person's tick. */
function PasteKey({ keySet }: { keySet: boolean }) {
  const id = useId();
  const uncheckedId = useId();
  const [key, setKey] = useState("");
  const [saveUnchecked, setSaveUnchecked] = useState(false);
  const [asking, setAsking] = useState(false);
  const { run, state } = useAction("gateway.key.save", (result) => {
    if (result.ok) {
      setKey("");
      setSaveUnchecked(false);
    }
  });
  const sending = state.phase === "sending";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (key.trim() !== "") setAsking(true);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Label htmlFor={id}>Paste a key</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={keySet ? "paste a new key to replace it" : "paste the OmniRoute API key"}
          className="h-8 min-w-0 flex-1 basis-56 font-mono text-xs placeholder:font-sans"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={sending || key.trim() === ""}
          aria-busy={sending}
        >
          Save this key
        </Button>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id={uncheckedId}
          checked={saveUnchecked}
          onCheckedChange={(on) => setSaveUnchecked(on === true)}
          className="mt-0.5"
        />
        <label htmlFor={uncheckedId} className="text-xs text-pretty text-muted-foreground">
          Save it even if OmniRoute does not answer now. It is then saved untested: check it once
          OmniRoute runs, with {KIT_NAME} gateway check.
        </label>
      </div>
      <ActionResultLine state={state} />
      <ConfirmDialog
        open={asking}
        title="Save this key for the gateway?"
        yes="Test and save"
        onCancel={() => setAsking(false)}
        onYes={() => {
          setAsking(false);
          run({ confirm: true, key, saveUnchecked });
        }}
      >
        OmniRoute is asked first, with one request that carries this key, and a key it refuses
        changes nothing.{" "}
        {saveUnchecked &&
          "If OmniRoute does not answer, the key is saved untested, as you ticked. "}
        The key in use now is backed up before it is replaced. The router reads the new key by
        itself: nothing restarts.
      </ConfirmDialog>
    </form>
  );
}

/** Make a key with the dashboard password, as `gateway setup --omniroute-password` does. */
function MakeKey() {
  const id = useId();
  const [password, setPassword] = useState("");
  const [asking, setAsking] = useState(false);
  const { run, state } = useAction("gateway.key.make");
  const sending = state.phase === "sending";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password.trim() !== "") setAsking(true);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Label htmlFor={id}>Or make a key from your OmniRoute password</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="OmniRoute's dashboard password"
          className="h-8 min-w-0 flex-1 basis-56 text-xs"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={sending || password.trim() === ""}
          aria-busy={sending}
        >
          Make and save a key
        </Button>
      </div>
      <p className="text-xs text-pretty text-muted-foreground">
        The password you log in to OmniRoute's dashboard with. It is used once, to make the key, and
        is never stored.
      </p>
      <ActionResultLine state={state} />
      <ConfirmDialog
        open={asking}
        title="Make a key in OmniRoute and save it?"
        yes="Make and save"
        onCancel={() => setAsking(false)}
        onYes={() => {
          setAsking(false);
          run({ confirm: true, password });
          // Dropped as soon as it is sent, whatever the answer: it is typed again, never held.
          setPassword("");
        }}
      >
        The kit logs in to OmniRoute's dashboard with this password once, makes a key named after
        this machine, tests it and saves it for the gateway, backing up the key in use now. The
        password is not stored. A key that cannot be saved is deleted again in OmniRoute.
      </ConfirmDialog>
    </form>
  );
}
