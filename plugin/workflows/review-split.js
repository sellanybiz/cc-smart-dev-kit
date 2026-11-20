export const meta = {
  name: 'review-split',
  description:
    'Review and refute a change set by track. Pass args: { base?: string, head?: string, intent?: string, folder?: string, tracks?: string[], risky?: boolean, budget?: number, spec?: string, prior?: string } as an object, not JSON text; see /cc-smart-dev-kit:review.',
}

// The input is the Workflow tool's `args`, passed verbatim: one object, which the review skill
// fills. A string, an unknown key or a wrong type is refused here, before any agent starts: a
// run on silent defaults would be a different review (one generic track, the ordinary tier) than
// the one the caller asked for. No `args` at all runs on the defaults, for a person who starts
// the workflow by hand. `audit-run.js` carries the same check: a workflow script cannot import
// another file, so each one holds its own.
const USAGE =
  'Pass one object: { base?: string, head?: string, intent?: string, folder?: string, tracks?: string[], risky?: boolean, budget?: number, spec?: string, prior?: string }.'
const refuse = (problem) => {
  throw new Error(`review-split refused its arguments (${problem}). ${USAGE}`)
}
const isText = (value) => typeof value === 'string'
const CHECKS = {
  base: [isText, 'a string'],
  head: [isText, 'a string'],
  intent: [isText, 'a string'],
  folder: [isText, 'a string'],
  tracks: [(value) => Array.isArray(value) && value.every(isText), 'an array of strings'],
  risky: [(value) => typeof value === 'boolean', 'true or false'],
  budget: [(value) => Number.isInteger(value) && value > 0, 'a whole number above 0'],
  spec: [isText, 'a string'],
  prior: [isText, 'a string'],
}
if (args !== undefined) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    refuse(args === null ? 'got null' : Array.isArray(args) ? 'got an array' : `got a ${typeof args}`)
  }
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(CHECKS, key)) refuse(`unknown key "${key}"`)
    if (!CHECKS[key][0](args[key])) refuse(`"${key}" must be ${CHECKS[key][1]}`)
  }
}
const given = args === undefined ? {} : args
const base = given.base || ''
const head = given.head || 'HEAD'
const intent = given.intent || 'what its commits and the diff say it does'
const folder = given.folder || ''
const named =
  given.tracks && given.tracks.length > 0
    ? given.tracks
    : ['every review dimension and edge-case axis that applies to this change']
const maxFindings = given.budget || 12
const risky = given.risky === true

// A plan's review runs this script twice (`plugin/skills/build/SKILL.md` § 6). `spec` is the
// plan file: it adds one last track, the spec compliance of the plan. `prior` is round 1's
// report: it makes this run round 2. An empty string for either is the same as leaving it out.
const spec = given.spec || ''
const prior = given.prior || ''
const SPEC_TRACK = 'spec compliance'
const tracks = spec === '' ? named : named.concat([SPEC_TRACK])

// The change set as the reviewers read it. With no base, the branch works it out from its own
// merge base: a base typed here would be one project's branch name in every project.
const change =
  base === ''
    ? 'the change on this branch since it left the default branch: its commits and any uncommitted work'
    : '`git diff ' + base + '...' + head + '`'
const checkout = folder === '' ? '' : '. The checkout is at `' + folder + '`'

// What one reviewer returns. Claude Code validates an agent's answer against this shape before
// the script reads it, so a prose answer never reaches the refuter.
const FINDINGS = {
  type: 'object',
  required: ['findings', 'coverage'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'title',
          'file',
          'trigger',
          'outcome',
          'missingGuard',
          'fix',
          'severity',
          'confidence',
        ],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          trigger: { type: 'string' },
          outcome: { type: 'string' },
          missingGuard: { type: 'string' },
          fix: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'warning', 'suggestion'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    hunches: { type: 'array', items: { type: 'string' } },
    coverage: { type: 'string' },
    // Round 2 only: where each finding of round 1's report stands now.
    priorStatus: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'status', 'evidence'],
        properties: {
          title: { type: 'string' },
          status: { type: 'string', enum: ['fixed', 'not_fixed', 'worse'] },
          evidence: { type: 'string' },
        },
      },
    },
  },
}

// What one refuter returns: the finding is kept only when it survives.
const VERDICT = {
  type: 'object',
  required: ['verdict', 'reason'],
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'refuted', 'unproven'] },
    reason: { type: 'string' },
    evidence: { type: 'string' },
  },
}

phase('Review')
log(
  `Reviewing ${tracks.length} track(s) of ${base === '' ? 'the change on this branch' : base + '...' + head} on the ${risky ? 'risky' : 'ordinary'} tier; at most ${maxFindings} finding(s) are checked against the code.`,
)

// The model rule is D46's: the review of a risky change set runs on `opus` at `xhigh`, every
// other on `sonnet` at `high`, which gives most of the gain. A literal cannot depend on the
// change set, so both fixed launch sets are written out here and the caller's `risky` picks one —
// the simplest shape that keeps every launch a literal the agent guard reads (two scripts would
// repeat every prompt and the orchestration, which `check:duplicates` fails). The refuters run
// on the same tier: they make the review's judgment, so D46's rule covers them too.
//
// The agent type is the review-record hook's default `reviewAgents` name. A track reviewer's
// brief carries the `Mode: review` line alone, so its return records the review for the merge
// guard; a refuter's brief does not, because it checks one finding, not the whole change.
//
// The senior engineer has every tool. The tracks run at once on one checkout, so each launch
// takes the editing tools away: no track changes the code another one is reading. It takes
// `Agent` away too: an agent a track started would send it a completion notice, which the
// review record counts as a later prompt, and the run would record no review. The prompt also
// asks for the StructuredOutput call, so Claude Code's nudge to make it is rarely needed (the
// record reads that nudge as harmless, `src/hooks/transcript.ts`).
// One template for every track, and the optional parts added to it: the plan every track reads when
// `spec` is set, the point-by-point check the spec track alone does, and the round-2 lines every
// track gets when `prior` is set. The strict rules close every prompt, in both rounds: a claim is
// proved by running when it can be, and a track that finds nothing still shows what it read and ran.
const planPart = `Read the plan file \`${spec}\` first. Judge your track against the plan's decisions and edge cases as well as against the code.`
const specPart =
  'For each Decision and each Edge case in the plan, say met, or failed with file:line; a failure is a finding. Then read the plan\'s tasks: call task_get on the phases and steps it lists. Check each step\'s done-check against its closing evidence and against the code. A step done only in name is a spec failure: report it as a finding.'
const roundTwoPart = `This is round 2. Round 1's report follows. Check that each finding it lists is really fixed, at its file:line, and report each one in \`priorStatus\` as fixed, not_fixed or worse, with the evidence. Check that the fixes broke nothing around them. Report what round 1 missed in the change set, at the same evidence bar.\n\nRound 1's report:\n\n${prior}`
const runPart =
  'Where a claim can be proved by running something, run it and quote the command and its output in the finding\'s `trigger` or `outcome`: a test, a small probe script in your scratchpad, or the real command. Reading the code is not enough. Change no file of the project: report only; scratch files go in your scratchpad.'
const answerPart =
  'Answer in the schema: a finding needs the trigger, the path as file:line, the outcome, the missing guard and the fix. A design finding\'s missing guard is the rule it breaks. What you cannot prove goes in `hunches`. In `coverage`, name the files you read, the commands you ran with their results, and where you stopped. A track with no findings still fills `coverage` this way: a bare "clean" is not evidence.'
const trackPrompt = (track, isSpecTrack) =>
  [
    `Mode: review\n\nOne track of the second opinion on one change set. The change set: ${change}${checkout}. What it is meant to do: ${intent}.`,
    `Your track: ${track}. Other reviewers take the other tracks; stay on yours. Judge the project by its own rules, skills and docs, and read the code the diff touches, not the diff alone.`,
    spec === '' ? '' : planPart,
    isSpecTrack ? specPart : '',
    prior === '' ? '' : roundTwoPart,
    runPart,
    answerPart,
    'End by calling the StructuredOutput tool; never end with plain text.',
  ]
    .filter((part) => part !== '')
    .join('\n\n')

const reviews = await pipeline(tracks, (track, index) => {
  const prompt = trackPrompt(track, spec !== '' && index === tracks.length - 1)
  return risky
    ? agent(prompt, {
        label: `review: ${track}`,
        model: 'opus',
        effort: 'xhigh',
        agentType: 'cc-smart-dev-kit:senior-engineer',
        disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Agent'],
        schema: FINDINGS,
      })
    : agent(prompt, {
        label: `review: ${track}`,
        model: 'sonnet',
        effort: 'high',
        agentType: 'cc-smart-dev-kit:senior-engineer',
        disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Agent'],
        schema: FINDINGS,
      })
})

const reported = reviews
  .filter((report) => report && Array.isArray(report.findings))
  .flatMap((report) => report.findings)

// Two tracks may prove the same finding: it is refuted once, not once per report.
const unique = []
const seen = new Set()
for (const finding of reported) {
  const key = `${finding.file}:${finding.line === undefined ? '' : finding.line}:${String(finding.title).trim().toLowerCase()}`
  if (seen.has(key)) continue
  seen.add(key)
  unique.push(finding)
}

const SEVERITIES = ['critical', 'warning', 'suggestion']
const rankOf = (severity) => {
  const at = SEVERITIES.indexOf(String(severity).toLowerCase())
  return at === -1 ? SEVERITIES.length : at
}

// The caller's budget bounds the expensive half: the agents this run starts. The cut falls on the
// least severe, never on the last track: the sort is stable, so equal severities keep their track
// order. What the budget does not reach is returned unchecked, never dropped.
const ranked = unique.slice().sort((a, b) => rankOf(a.severity) - rankOf(b.severity))
const checked = ranked.slice(0, maxFindings)
const unchecked = ranked.slice(maxFindings)

phase('Refute')
log(
  `${reported.length} finding(s) reported, ${unique.length} distinct; ${checked.length} refuted against the code, ${unchecked.length} not (returned unchecked).`,
)

// A second reviewer tries to refute each finding. Only what survives the code is reported: the
// evidence bar is the review's (`plugin/instructions/core.md` § Review).
const verdicts = await pipeline(checked, (finding) => {
  const prompt = `Refute one finding before it reaches the author: read the file and line it names, then the path around it, and look for what already stops it — a validator upstream, a database constraint, a type, a caller that can never pass that value. Change no file.\n\nAnswer \`confirmed\` only when the trigger, the path, the outcome and the missing guard all hold in the code; \`refuted\` when something already stops it; \`unproven\` when the code does not settle it. A design finding's missing guard is the rule it breaks. A project convention or sibling files with that shape refute it. Put the lines you read in \`evidence\`.\n\n${JSON.stringify(finding, null, 2)}`
  return risky
    ? agent(prompt, {
        label: `refute: ${finding.file}`,
        model: 'opus',
        effort: 'xhigh',
        agentType: 'cc-smart-dev-kit:senior-engineer',
        disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Agent'],
        schema: VERDICT,
      })
    : agent(prompt, {
        label: `refute: ${finding.file}`,
        model: 'sonnet',
        effort: 'high',
        agentType: 'cc-smart-dev-kit:senior-engineer',
        disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Agent'],
        schema: VERDICT,
      })
})

const judged = checked.map((finding, index) => ({ finding, verdict: verdicts[index] }))
const verdictOf = (one) => (one.verdict ? one.verdict.verdict : undefined)

// The reviewed findings, merged, verified and ranked: most severe first, then by file and line.
const verified = judged
  .filter((one) => verdictOf(one) === 'confirmed')
  .sort((a, b) => {
    const bySeverity = rankOf(a.finding.severity) - rankOf(b.finding.severity)
    if (bySeverity !== 0) return bySeverity
    const fileA = String(a.finding.file)
    const fileB = String(b.finding.file)
    if (fileA !== fileB) return fileA < fileB ? -1 : 1
    return (a.finding.line || 0) - (b.finding.line || 0)
  })

const placeOf = (finding) =>
  finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`
const refuted = judged.filter((one) => verdictOf(one) === 'refuted').length

// A finding the refuter could not settle, or that got no answer, is not proved and not refuted:
// it is listed with the hunches, with the refuter's reason, its trigger and its fix, so the
// author still sees it and can check it.
const unprovenHunches = judged
  .filter((one) => verdictOf(one) !== 'confirmed' && verdictOf(one) !== 'refuted')
  .map((one) => {
    const why =
      one.verdict && typeof one.verdict.reason === 'string' && one.verdict.reason !== ''
        ? one.verdict.reason
        : 'the refuter returned no answer'
    return `[${String(one.finding.severity).toUpperCase()}] ${one.finding.title} — ${placeOf(one.finding)} (unproven: ${why})\n  trigger: ${one.finding.trigger}\n  fix: ${one.finding.fix}`
  })

// What the reviewers could not prove, and how far each got: reported apart, never as findings.
const hunches = unprovenHunches.concat(
  reviews.flatMap((report) => (report && Array.isArray(report.hunches) ? report.hunches : [])),
)

// A track that found nothing must still show its work. A bare "clean", an empty coverage or no
// answer at all is not evidence of a review: the report says so, so the lead sees it.
const MIN_COVERAGE_CHARS = 40
const coverage = reviews
  .map((report, index) => {
    const text = report && typeof report.coverage === 'string' ? report.coverage.trim() : ''
    const found = report && Array.isArray(report.findings) && report.findings.length > 0
    const label = `track ${index + 1} (${tracks[index]})`
    if (!found && text.length < MIN_COVERAGE_CHARS) {
      return `${label} gave no evidence of coverage${text === '' ? '' : `: "${text}"`}`
    }
    return text === '' ? null : `${label}: ${text}`
  })
  .filter((one) => one !== null)

// Round 2 only: where each finding of round 1 stands, one line each. Several tracks may judge the
// same finding; the worst status stands, so a fix one track calls good and another calls broken
// is listed as broken.
const STATUSES = ['worse', 'not_fixed', 'fixed']
const statusRank = (status) => {
  const at = STATUSES.indexOf(status)
  return at === -1 ? STATUSES.length : at
}
const standing = new Map()
for (const report of reviews) {
  if (!report || !Array.isArray(report.priorStatus)) continue
  for (const one of report.priorStatus) {
    const key = String(one.title).trim().toLowerCase()
    const before = standing.get(key)
    if (before === undefined || statusRank(one.status) < statusRank(before.status)) {
      standing.set(key, one)
    }
  }
}
const priorLines = Array.from(standing.values())
  .sort((a, b) => statusRank(a.status) - statusRank(b.status))
  .map((one) => `- [${String(one.status).replace('_', ' ').toUpperCase()}] ${one.title} — ${one.evidence}`)

const lines = verified.map(
  (one, index) =>
    `${index + 1}. [${String(one.finding.severity).toUpperCase()}] ${one.finding.title} — ${placeOf(one.finding)}\n   trigger: ${one.finding.trigger}\n   outcome: ${one.finding.outcome}\n   missing guard: ${one.finding.missingGuard}\n   fix: ${one.finding.fix}\n   confidence: ${one.finding.confidence}`,
)
const uncheckedLines = unchecked.map(
  (finding) => `- [${String(finding.severity).toUpperCase()}] ${finding.title} — ${placeOf(finding)}`,
)

return [
  `# Second opinion - ${base === '' ? 'the change on this branch' : `${base}...${head}`}`,
  `Tier: ${risky ? 'risky (`opus` at `xhigh`)' : 'ordinary (`sonnet` at `high`)'} · tracks: ${tracks.length} · written for: ${intent}`,
  '',
  verified.length > 0
    ? `## Findings (${verified.length}, most severe first)\n\n${lines.join('\n')}`
    : unprovenHunches.length > 0
      ? `No checked finding was confirmed; ${unprovenHunches.length} ${unprovenHunches.length === 1 ? 'is' : 'are'} listed under Hunches.${unchecked.length === 0 ? '' : ' The unchecked ones are listed below.'}`
      : unchecked.length === 0
        ? 'No finding survived refutation.'
        : 'No checked finding survived refutation; the unchecked ones are listed below.',
  '',
  refuted === 0
    ? ''
    : `${refuted} of ${checked.length} checked finding(s) were refuted, and are not listed.`,
  '',
  // With no finding confirmed, the headline above already says this.
  verified.length === 0 || unprovenHunches.length === 0
    ? ''
    : `${unprovenHunches.length} of ${checked.length} checked finding(s) were left unproven: they are listed under Hunches.`,
  '',
  prior === ''
    ? ''
    : `## Round 1 findings\n\n${priorLines.length === 0 ? 'No track reported a status for a round 1 finding.' : priorLines.join('\n')}`,
  '',
  unchecked.length === 0
    ? ''
    : `${checked.length} of ${unique.length} distinct finding(s) refuted against the code; ${unchecked.length} not refuted.\n\n## Unchecked (${unchecked.length}, not refuted: check them or run again)\n\n${uncheckedLines.join('\n')}`,
  '',
  hunches.length === 0
    ? ''
    : `## Hunches (unproven, never findings)\n\n${hunches.map((one) => `- ${one}`).join('\n')}`,
  '',
  coverage.length === 0 ? '' : `## Coverage\n\n${coverage.join('\n')}`,
]
  .filter((one) => one !== '')
  .join('\n')
