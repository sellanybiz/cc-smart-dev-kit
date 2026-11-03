# Gateway health and recovery

- `cc-smart-dev-kit gateway status`: router health (requests, fallbacks, resting targets, open
  breakers), each backend, the slots, whether Claude Code points at the gateway. Keys are
  masked. Its last line gives the verdict and next step.
- `cc-smart-dev-kit doctor`: the service, the router copy, the health page, each backend.
- The log: `journalctl --user -u cc-smart-dev-kit-router -f`. One line per request; never a key.
  A target that answers 4xx / 5xx (Anthropic too) gets a `WARN` line with the start of
  its error reason, keys masked: read it first when a slot fails.
- A backend that refuses a request comes back as a 424, so Claude Code does not send it again
  without its deferred tools. A refusal about the conversation's length starts "prompt is too
  long" instead, which starts Claude Code's compaction. Anthropic's own 400 passes unchanged.
- Every Claude Code request hangs or fails: the router is down. `doctor` says whether its
  socket is open without an answering router, or systemd closed it after repeated failures.
  Read `journalctl --user -u cc-smart-dev-kit-router -n 30`, fix the cause, then use
  `cc-smart-dev-kit gateway setup` to reopen both. Still down: `gateway off` switches sessions
  back to Anthropic. If this changes your own model path, give the person the command instead.
- `doctor` says "a gateway setup did not finish": the router did not answer after the restart.
  Read the same recent log, fix the cause, then run setup again with permission for the restart.
