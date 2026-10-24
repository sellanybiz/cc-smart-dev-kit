"use client";

import { ChoiceSwitch } from "@/components/choice-switch";

export type SlotModeName = "claude" | "custom";

/**
 * Who answers a slot: Claude, or its Custom chain (`ChoiceSwitch`). Choosing one asks first (the
 * page's dialog), so the checked one is always what the server holds. A Custom that cannot be
 * chosen yet says why.
 */
export function ModeSwitch({
  value,
  pending,
  customBlocked,
  label,
  onChoose,
}: {
  value: SlotModeName;
  /** The mode a change is moving to, while it runs. */
  pending: null | SlotModeName;
  /** Why Custom cannot be chosen now; null when it can. */
  customBlocked: null | string;
  label: string;
  onChoose: (mode: SlotModeName) => void;
}) {
  return (
    <ChoiceSwitch
      value={value}
      pending={pending}
      label={label}
      onChoose={onChoose}
      options={[
        { label: "Claude", value: "claude" },
        { blocked: customBlocked, label: "Custom", value: "custom" },
      ]}
    />
  );
}
