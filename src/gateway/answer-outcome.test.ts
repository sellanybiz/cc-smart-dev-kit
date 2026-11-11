import { expect, it } from "bun:test";
import { AnswerUsageReader } from "./safety-checks";

it.each([
  [false, '{"type":"message","stop_reason":"end_turn"}', null],
  [false, '{"type":"message","stop_reason":"refusal"}', "refused"],
  [false, '{"type":"error"}', "stream_error"],
  [true, 'data: {"type":"error","error":{"type":"overloaded_error"}}\n\n', "stream_error"],
  [true, 'data: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n', "refused"],
  [true, 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n', null],
] as const)(
  "observes outcome without retaining the answer (%s, %s)",
  (streaming, body, outcome) => {
    const reader = new AnswerUsageReader(streaming);
    reader.push(new TextEncoder().encode(body));
    reader.tokens();
    expect(reader.outcome()).toBe(outcome);
  },
);
