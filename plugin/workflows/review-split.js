export const meta = {
  name: 'review-split',
  description:
    'The second opinion on one change set, split across review tracks: a read-only reviewer per track, a second reviewer to refute every finding, and the verified findings merged and ranked.',
}

// The input is the Workflow tool's `args`: the review skill sets every field. The defaults let a
// person run the workflow by hand, without the skill.
const base = args && typeof args.base === 'string' && args.base !== '' ? args.base : ''
const head = args && typeof args.head === 'string' && args.head !== '' ? args.head : 'HEAD'
const intent =
  args && typeof args.intent === 'string' && args.intent !== ''
    ? args.intent
    : 'what its commits and the diff say it does'
const folder = args && typeof args.folder === 'string' && args.folder !== '' ? args.folder : ''
const tracks =
  args && Array.isArray(args.tracks) && args.tracks.length > 0
    ? args.tracks
    : ['every review dimension and edge-case axis that applies to this change']
const maxFindings = args && Number.isInteger(args.budget) && args.budget > 0 ? args.budget : 12
const risky = Boolean(args && args.risky === true)

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
  required: ['findings'],
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
// other on `sonnet` at `max`. A literal cannot depend on the change set, so both fixed launch
// sets are written out here and the caller's `risky` picks one — the simplest shape that keeps
// every launch a literal the agent guard reads (two scripts would repeat every prompt and the
// orchestration, which `check:duplicates` fails). The refuters run on the same tier: they make
// the review's judgment, so D46's rule covers them too.
//
// The agent type is the review-record hook's default `reviewAgents` name, so the run's reviewers
// are the ones whose return records the review for the merge guard.
const reviews = await pipeline(tracks, (track) => {
  const prompt = `One track of the second opinion on one change set. The change set: ${change}${checkout}. What it is meant to do: ${intent}.\n\nYour track: ${track}. Other reviewers take the other tracks; stay on yours. Judge the project by its own rules, skills and docs, and read the code the diff touches, not the diff alone.\n\nAnswer in the schema: a finding needs the trigger, the path as file:line, the outcome, the missing guard and the fix. What you cannot prove goes in \`hunches\`. In \`coverage\`, name what you read and where you stopped.`
  return risky
    ? agent(prompt, {
        label: `review: ${track}`,
        model: 'opus',
        effort: 'xhigh',
        agentType: 'cc-smart-dev-kit:reviewer',
        schema: FINDINGS,
      })
    : agent(prompt, {
        label: `review: ${track}`,
        model: 'sonnet',
        effort: 'max',
        agentType: 'cc-smart-dev-kit:reviewer',
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
// The caller's budget bounds the expensive half: the agents this run starts.
const checked = unique.slice(0, maxFindings)

phase('Refute')
log(
  `${reported.length} finding(s) reported, ${unique.length} distinct; ${checked.length} refuted against the code.`,
)

// A second reviewer tries to refute each finding. Only what survives the code is reported: the
// evidence bar is the review's (`plugin/instructions/core.md` § Review).
const verdicts = await pipeline(checked, (finding) => {
  const prompt = `Refute one finding before it reaches the author: read the file and line it names, then the path around it, and look for what already stops it — a validator upstream, a database constraint, a type, a caller that can never pass that value.\n\nAnswer \`confirmed\` only when the trigger, the path, the outcome and the missing guard all hold in the code; \`refuted\` when something already stops it; \`unproven\` when the code does not settle it. Put the lines you read in \`evidence\`.\n\n${JSON.stringify(finding, null, 2)}`
  return risky
    ? agent(prompt, {
        label: `refute: ${finding.file}`,
        model: 'opus',
        effort: 'xhigh',
        agentType: 'cc-smart-dev-kit:reviewer',
        schema: VERDICT,
      })
    : agent(prompt, {
        label: `refute: ${finding.file}`,
        model: 'sonnet',
        effort: 'max',
        agentType: 'cc-smart-dev-kit:reviewer',
        schema: VERDICT,
      })
})

const SEVERITIES = ['critical', 'warning', 'suggestion']
const rankOf = (severity) => {
  const at = SEVERITIES.indexOf(String(severity).toLowerCase())
  return at === -1 ? SEVERITIES.length : at
}

// The reviewed findings, merged, verified and ranked: most severe first, then by file and line.
const verified = checked
  .map((finding, index) => ({ finding, verdict: verdicts[index] }))
  .filter((one) => one.verdict && one.verdict.verdict === 'confirmed')
  .sort((a, b) => {
    const bySeverity = rankOf(a.finding.severity) - rankOf(b.finding.severity)
    if (bySeverity !== 0) return bySeverity
    const fileA = String(a.finding.file)
    const fileB = String(b.finding.file)
    if (fileA !== fileB) return fileA < fileB ? -1 : 1
    return (a.finding.line || 0) - (b.finding.line || 0)
  })

// What the reviewers could not prove, and how far each got: reported apart, never as findings.
const hunches = reviews.flatMap((report) =>
  report && Array.isArray(report.hunches) ? report.hunches : [],
)
const coverage = reviews
  .map((report, index) =>
    report && typeof report.coverage === 'string' && report.coverage !== ''
      ? `track ${index + 1} (${tracks[index]}): ${report.coverage}`
      : null,
  )
  .filter((one) => one !== null)

const placeOf = (finding) =>
  finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`
const lines = verified.map(
  (one, index) =>
    `${index + 1}. [${String(one.finding.severity).toUpperCase()}] ${one.finding.title} — ${placeOf(one.finding)}\n   trigger: ${one.finding.trigger}\n   outcome: ${one.finding.outcome}\n   missing guard: ${one.finding.missingGuard}\n   fix: ${one.finding.fix}\n   confidence: ${one.finding.confidence}`,
)
const dropped = checked.length - verified.length

return [
  `# Second opinion - ${base === '' ? 'the change on this branch' : `${base}...${head}`}`,
  `Tier: ${risky ? 'risky (`opus` at `xhigh`)' : 'ordinary (`sonnet` at `max`)'} · tracks: ${tracks.length} · written for: ${intent}`,
  '',
  verified.length === 0
    ? 'No finding survived refutation.'
    : `## Findings (${verified.length}, most severe first)\n\n${lines.join('\n')}`,
  '',
  dropped === 0
    ? ''
    : `${dropped} of ${checked.length} checked finding(s) were refuted or left unproven, and are not listed.`,
  '',
  hunches.length === 0
    ? ''
    : `## Hunches (unproven, never findings)\n\n${hunches.map((one) => `- ${one}`).join('\n')}`,
  '',
  coverage.length === 0 ? '' : `## Coverage\n\n${coverage.join('\n')}`,
]
  .filter((one) => one !== '')
  .join('\n')
