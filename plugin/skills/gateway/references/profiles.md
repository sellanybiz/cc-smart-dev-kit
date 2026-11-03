# Gateway profiles

## Profiles: a project's own chains

A profile is a named set of chains and switches over the machine's, reached by the project's URL
`…/p/<name>`. `gateway project on --profile <name>` points a project at one.

- `cc-smart-dev-kit gateway profile <name> slot <slot> <target>,<target>…`: the profile's own chain
  for a slot, checked against `gateway models` exactly as `gateway slot` checks the machine's.
  The first chain makes the profile. A slot the profile does not name keeps the machine's chain.
  A judge target must already have passed the machine's judge test (`gateway slot judge`), since
  the proof is machine-wide and an untested target is ignored.
- `gateway profile <name> slot <slot> off` (`claude` says the same): plain Claude for that slot in
  this profile. `clear` forgets the entry, so the machine's chain applies there again.
- `gateway profile <name> fallback <slot> on|off`: may the profile's next target answer when the
  one before it fails or rests?
- `gateway profile <name> breaker <slot> on|off`: may the router hold a request while every target
  of the profile's slot is limited or down? The judge has none. This is the profile's own switch.
  `gateway breaker` sets the machine's, which a profile that sets none follows; it never changes a
  profile's own setting.
- `gateway profile <name> remove`: deletes the profile; a project whose URL still names it answers
  as plain Claude.
- The change is live: the router reads the config again within about a second.

