export const meta = {
  name: 'research-sweep',
  description:
    'Research one question from several angles: a read-only researcher per angle, a second agent to refute every claim the answer rests on by opening its source, and the verified claims returned with their sources.',
}

// The input is the Workflow tool's `args`: the research-first skill sets every field. A research
// question is the caller's own, so there is no default: a string, a missing field or a field this
// script does not know is refused here, before any agent starts and spends anything.
const MAX_ANGLES = 8
const DEFAULT_BUDGET = 12
const FIELDS = ['question', 'angles', 'budget', 'context']

function refuse(why) {
  throw new Error(
    'research-sweep needs an object { question, angles: [..], budget?, context? }: ' + why,
  )
}
const isText = (value) => typeof value === 'string' && value.trim() !== ''

if (args === null || typeof args !== 'object' || Array.isArray(args)) {
  refuse('it got ' + (Array.isArray(args) ? 'an array' : args === null ? 'null' : typeof args) + '.')
}
for (const key of Object.keys(args)) {
  if (!FIELDS.includes(key)) refuse('`' + key + '` is not a field it reads.')
}
if (!isText(args.question)) refuse('`question` must be a non-empty string.')
if (!Array.isArray(args.angles) || args.angles.length === 0 || !args.angles.every(isText)) {
  refuse('`angles` must be a non-empty list of non-empty strings.')
}
if (args.angles.length > MAX_ANGLES) refuse('`angles` holds at most ' + MAX_ANGLES + ' angles.')
if (args.budget !== undefined && !(Number.isInteger(args.budget) && args.budget > 0)) {
  refuse('`budget` must be a positive whole number.')
}
if (args.context !== undefined && typeof args.context !== 'string') {
  refuse('`context` must be a string.')
}

const question = args.question
const angles = args.angles
const maxClaims = args.budget === undefined ? DEFAULT_BUDGET : args.budget
const background =
  args.context === undefined || args.context.trim() === ''
    ? ''
    : '\n\nWhat the asker already knows:\n' + args.context

// What one researcher returns. Claude Code validates an agent's answer against this shape before
// the script reads it, so a prose answer never reaches a refuter. `weight` ranks the claims when
// the budget is smaller than the list.
const CLAIMS = {
  type: 'object',
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'source', 'quote', 'weight'],
        properties: {
          claim: { type: 'string' },
          source: { type: 'string' },
          quote: { type: 'string' },
          asOf: { type: 'string' },
          weight: { type: 'string', enum: ['decisive', 'supporting'] },
        },
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
    coverage: { type: 'string' },
  },
}

// What one refuter returns: a claim is kept as verified only when its source holds up.
const VERDICT = {
  type: 'object',
  required: ['verdict', 'reason'],
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'refuted', 'unproven'] },
    reason: { type: 'string' },
    quote: { type: 'string' },
  },
}

phase('Research')
log(
  `Researching "${question}" from ${angles.length} angle(s); at most ${maxClaims} claim(s) are checked against their sources.`,
)

// One researcher per angle, in parallel. Each angle is the caller's; the researchers read only.
const reports = await pipeline(angles, (angle) =>
  agent(
    `Research this question: ${question}${background}\n\nYour angle: ${angle}. Other researchers take the other angles; stay on yours.\n\nUse the current sources, not memory: read the date first, then fetch the page, the changelog, the issue or the file itself. Report each claim the answer would rest on as one entry: the claim in one sentence, the exact source (a URL, or \`file:line\`), a short verbatim quote from that source, the version or date the source speaks for in \`asOf\`, and its weight (\`decisive\` when the answer changes without it, else \`supporting\`). Never report a claim you did not read in a source. What you looked for and could not find goes in \`openQuestions\`, never in \`claims\`. End with \`coverage\`: the pages and files you read, and the ones you never opened.`,
    {
      label: `research: ${angle}`,
      model: 'sonnet',
      effort: 'max',
      agentType: 'cc-smart-dev-kit:auditor',
      schema: CLAIMS,
    },
  ),
)

const claims = reports
  .filter((report) => report && Array.isArray(report.claims))
  .flatMap((report) => report.claims)
// The decisive claims are checked first, in the order the researchers gave them; the budget cuts
// what is left. Nothing is dropped: the cut part is returned as `unchecked`.
const ranked = [
  ...claims.filter((one) => one.weight === 'decisive'),
  ...claims.filter((one) => one.weight !== 'decisive'),
]
const checked = ranked.slice(0, maxClaims)
const unchecked = ranked.slice(maxClaims)

phase('Refute')
log(`${claims.length} claim(s) reported; ${checked.length} checked against their sources.`)

// A second agent tries to refute each claim at its source. Only what survives is called verified.
const verdicts = await pipeline(checked, (one) =>
  agent(
    `Check this research claim against its own source. Open the source it names: fetch the URL, or read the file at the line. Find the quote, then read around it: does the source say what the claim says, for the version or date the claim speaks for, and is a later page, release or issue stating the opposite? Answer \`confirmed\` only when the source supports the claim as written; \`refuted\` when it says something else, or something newer replaces it; \`unproven\` when you cannot open the source or it does not settle the claim. Put the lines you read in \`quote\`, and say why in \`reason\`.\n\nThe question being researched: ${question}\n\n${JSON.stringify(one, null, 2)}`,
    {
      label: `refute: ${one.claim.slice(0, 60)}`,
      model: 'opus',
      effort: 'high',
      agentType: 'cc-smart-dev-kit:auditor',
      schema: VERDICT,
    },
  ),
)

const verified = []
const refuted = []
const unproven = []
checked.forEach((one, index) => {
  const verdict = verdicts[index]
  if (!verdict || typeof verdict.verdict !== 'string') {
    unproven.push({ ...one, reason: 'The refuter returned no answer.' })
  } else if (verdict.verdict === 'confirmed') {
    verified.push({ ...one, reason: verdict.reason, quote: verdict.quote || one.quote })
  } else if (verdict.verdict === 'refuted') {
    refuted.push({ ...one, reason: verdict.reason, quote: verdict.quote || '' })
  } else {
    unproven.push({ ...one, reason: verdict.reason })
  }
})

// What the researchers could not find, and how far each got. A researcher that returned no report
// is named: a lost angle must not read as an angle with nothing to say.
const openQuestions = reports.flatMap((report, index) =>
  report && Array.isArray(report.openQuestions)
    ? report.openQuestions
    : report
      ? []
      : ['The researcher for the angle "' + angles[index] + '" returned no report.'],
)
const coverage = reports
  .map((report, index) =>
    report && typeof report.coverage === 'string' && report.coverage !== ''
      ? `angle ${index + 1} (${angles[index]}): ${report.coverage}`
      : null,
  )
  .filter((one) => one !== null)

return { question, verified, refuted, unproven, unchecked, openQuestions, coverage }
