/**
 * The reader of a raw write to GitHub's issues (D67): `gh issue create|edit|comment|close|…` and
 * `gh api` POST/PATCH/PUT/DELETE to a repository's issues. The merge guard asks the person about
 * one, and denies it in a crew session. Reads, and the kit's own `issue file`, are no write.
 */
import { describe, expect, test } from "bun:test";
import { computedIssueRisk, issueWrites, requestsIssueWrite, unnamedGhWords } from "./issue-writes";

describe("a raw issue write", () => {
  test.each([
    "gh issue create --title t --body b",
    "gh issue new -t t",
    "gh issue edit 5 --add-label x",
    "gh issue comment 5 --body hi",
    "gh issue close 5",
    "gh issue reopen 5",
    "gh issue delete 5 --yes",
    "gh issue transfer 5 other/repo",
    "gh issue lock 5",
    "gh issue pin 5",
    "gh issue develop 5 --name b",
    "gh issue -R o/r create -t t",
    "gh issue create --repo o/r -t t",
    "cd /tmp && gh issue create -t t",
    "echo hi | gh issue comment 5 -F -",
    "bash -c 'gh issue create -t t'",
    "env GH_TOKEN=x gh issue create -t t",
    "timeout 60 gh issue edit 3 -b x",
    "sudo -u me gh issue close 4",
  ])("%s is a write", (command) => {
    expect(requestsIssueWrite(command, "bash")).toBe(true);
  });

  // The review of GI1: gh reads flags its own way, and runs what other programs name.
  test.each([
    "gh issue --title list create --body x", // an option before the subcommand takes `list`
    "gh issue -t view create -b x",
    "gh issue create --title -h --body x", // `-h` is the title
    "gh issue comment 5 --body --help",
    "find . -name a -exec gh issue create -t t -b b ;",
    "watch -n 60 gh issue create -t t -b b",
    `su -c "gh issue create -t t -b b" me`,
    `parallel "gh issue create -t {} -b b" ::: a`,
    "xargs -n1 gh issue close < ids",
  ])("review: %s is a write", (command) => {
    expect(requestsIssueWrite(command, "bash")).toBe(true);
  });

  // The review of the follow-up: the private runner list is gone, and these must still be seen
  // by the shared reader alone (the crew deny reads this detector).
  test.each([
    "parallel ::: 'gh issue create -t x -b y'",
    "parallel -u gh issue create -t x -b y ::: a",
    "parallel --delay 1 gh issue create -t x -b y ::: a",
    "parallel --arg-sep ,, gh issue create -t x -b y ,, a",
    "watch -q 3 gh issue create -t x -b y",
    // The second review.
    "watch -dq gh issue create -t x -b y",
    "parallel gh issue ::: create",
    "parallel bash -c ::: 'gh issue create -t x -b y'",
    "parallel --tmpdir /tmp --wd . --ssh ssh gh issue create -t x -b y ::: a",
    "find . -maxdepth 0 -exec flock + gh issue create -t x -b y \\;",
    "su -- me -c 'gh issue create -t x -b y'",
    "su --session-command 'gh issue create -t x -b y' me",
  ])("review: %s is a write", (command) => {
    expect(requestsIssueWrite(command, "bash")).toBe(true);
  });

  test.each([
    "gh issue --help create",
    "gh issue create -h",
    "gh issue -R o/r list",
    "gh issue --repo=o/r view 5",
    "find . -name a -exec gh issue list ;",
    "watch -n 60 gh issue view 5",
  ])("review: %s is no write", (command) => {
    expect(requestsIssueWrite(command, "bash")).toBe(false);
  });

  test.each([
    "gh api repos/o/r/issues -X POST -f title=t",
    "gh api repos/o/r/issues -f title=t",
    "gh api --method PATCH repos/o/r/issues/5 -f state=closed",
    "gh api -X DELETE repos/o/r/issues/comments/9",
    "gh api repos/o/r/issues/5/comments -f body=hi",
    "gh api repos/o/r/issues/5/labels -X PUT -f 'labels[]=x'",
    "gh api /repos/o/r/issues -X POST",
    "gh api https://api.github.com/repos/o/r/issues -f title=t",
    "gh api repos/{owner}/{repo}/issues -X POST -f title=t",
    `gh api graphql -f query='mutation { createIssue(input: {repositoryId: "x", title: "t"}) { issue { id } } }'`,
    `gh api graphql -f query='mutation { addComment(input: {subjectId: "x", body: "b"}) { clientMutationId } }'`,
  ])("%s is a write", (command) => {
    expect(requestsIssueWrite(command, "bash")).toBe(true);
  });

  test.each([
    "gh issue list",
    "gh issue ls --label bug",
    "gh issue view 5",
    "gh issue status",
    "gh issue create --help",
    "gh issue",
    "gh pr create --title t",
    "gh pr view 5",
    "gh api repos/o/r/issues",
    "gh api repos/o/r/issues -X GET",
    "gh api repos/o/r/issues/5",
    "gh api repos/o/r/pulls -X POST -f title=t",
    "gh api repos/o/r/issues -X POST --help",
    `gh api graphql -f query='{ viewer { login } }'`,
    "gh repo view",
    "cc-smart-dev-kit issue file --title t --body-file - --fingerprint k",
    "echo gh issue create",
    "git commit -m 'gh issue create'",
    "ls",
  ])("%s is no write", (command) => {
    expect(requestsIssueWrite(command, "bash")).toBe(false);
  });

  test("each write is named, once, in the order it runs", () => {
    expect(
      issueWrites("gh issue close 4 && gh api repos/o/r/issues/5 -X PATCH -f state=closed", "bash"),
    ).toEqual(["gh issue close", "a gh api PATCH to repos/o/r/issues/5"]);
  });

  test("PowerShell is read in its own dialect", () => {
    expect(requestsIssueWrite("gh issue create --title 't'", "powershell")).toBe(true);
    expect(requestsIssueWrite("gh issue list", "powershell")).toBe(false);
  });

  test("a program the line works out when it runs, with `issue` in its words, is a risk", () => {
    expect(computedIssueRisk("$GH issue create -t t", "bash")).toBe(true);
    expect(computedIssueRisk("$(which gh) api repos/o/r/issues -X POST", "bash")).toBe(true);
    expect(computedIssueRisk("$GH pr view 5", "bash")).toBe(false);
    expect(computedIssueRisk("gh issue create -t t", "bash")).toBe(false);
  });
});

// The review of release 1.3.0 (IX1): a write the reader could not read whole was let through.
describe("IX1-1: a gh api write whose endpoint or query is not literal text fails closed", () => {
  test.each([
    'gh api "$EP" -f body=hi',
    "EP=repos/o/r/issues; gh api $EP -f body=hi",
    'gh api "$(echo repos/o/r/issues)" -f body=hi',
    'gh api "repos/o/r/$K/5/comments" -f body=hi',
    "gh api `echo repos/o/r/issues` -X POST",
    'gh api -X POST "$EP"',
    'gh api -X "$M" repos/o/r/issues/5',
    "for u in $(gh api repos/o/r/issues --jq '.[].comments_url'); do gh api \"$u\" -f body=hi; done",
    'gh api graphql -f query="$Q"',
    "gh api graphql -F query=$Q",
    "gh api graphql -f query=@change.graphql",
    "gh api graphql -F query=@change.graphql",
    "gh api graphql --input body.json",
    "gh api graphql --input -",
    'gh api graphql -f query="mutation { $M }"',
    'gh api graphql -f query="$(cat q.graphql)"',
    'gh api "$EP" --input body.json',
    'gh api "$EP" -f query="$Q"',
  ])("%s counts as an issue write", (command) => {
    expect(requestsIssueWrite(command, "bash")).toBe(true);
  });

  test("the question says what cannot be read", () => {
    expect(issueWrites('gh api "$EP" -f body=hi', "bash")).toEqual([
      "a gh api POST to an endpoint that cannot be read ($EP)",
    ]);
    expect(issueWrites("gh api graphql --input body.json", "bash")).toEqual([
      "a gh api graphql request that cannot be read (its body comes from a file or standard input)",
    ]);
    expect(issueWrites('gh api graphql -f query="$Q"', "bash")).toEqual([
      "a gh api graphql request that cannot be read (its query comes from a file or the shell)",
    ]);
  });

  test.each([
    'gh api "$EP"',
    'gh api "$EP" -X GET',
    'gh api "repos/o/r/$K/5/comments"',
    'gh api "$EP" --method GET -f state=open',
    "gh api graphql -f query='{ viewer { login } }'",
    "gh api repos/o/r/issues",
    'gh api "$EP" -X POST --help',
  ])("%s is a read: no write", (command) => {
    expect(requestsIssueWrite(command, "bash")).toBe(false);
  });
});

describe("IX1-2: gh reads `-X=POST` as POST", () => {
  test.each([
    "gh api -X=POST repos/o/r/issues -f title=t",
    "gh api -X=PATCH repos/o/r/issues/5 -f state=closed",
    "gh api -X=DELETE repos/o/r/issues/comments/9",
    "gh api -XPOST repos/o/r/issues",
    "gh api -X=POST repos/o/r/labels -f name=n",
  ])("%s is a write", (command) => {
    expect(requestsIssueWrite(command, "bash")).toBe(true);
  });

  test("the method is named without the `=`", () => {
    expect(issueWrites("gh api -X=POST repos/o/r/issues -f title=t", "bash")).toEqual([
      "a gh api POST to repos/o/r/issues",
    ]);
  });

  test("`-X=GET` is a read", () => {
    expect(requestsIssueWrite("gh api -X=GET repos/o/r/issues", "bash")).toBe(false);
  });
});

describe("IX1-3: any GraphQL mutation is an issue write unless it is a pull request mutation", () => {
  const mutation = (field: string) =>
    `gh api graphql -f query='mutation { ${field}(input: {x: "y"}) { clientMutationId } }'`;

  test.each([
    "clearLabelsFromLabelable",
    "minimizeComment",
    "unminimizeComment",
    "addSubIssue",
    "removeSubIssue",
    "addAssigneesToAssignable",
    "createLabel",
    "updateLabel",
    "deleteLabel",
    "someMutationNextYear",
  ])("%s is a write, named", (field) => {
    expect(issueWrites(mutation(field), "bash")).toEqual([`a gh api graphql mutation (${field})`]);
  });

  test("a mutation with no `(input:` is a write that is not named", () => {
    expect(issueWrites("gh api graphql -f query='mutation { x }'", "bash")).toEqual([
      "a gh api graphql mutation",
    ]);
  });

  test("a pull request mutation the merge guard judges is no issue write", () => {
    for (const field of [
      "mergePullRequest",
      "enablePullRequestAutoMerge",
      "createPullRequest",
      "markPullRequestReadyForReview",
    ]) {
      expect([field, requestsIssueWrite(mutation(field), "bash")]).toEqual([field, false]);
    }
  });

  test("a pull request mutation beside an issue mutation still counts, naming only the issue one", () => {
    const command = `gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } clearLabelsFromLabelable(input: {}) { clientMutationId } }'`;
    expect(issueWrites(command, "bash")).toEqual([
      "a gh api graphql mutation (clearLabelsFromLabelable)",
    ]);
  });

  test("a query is no write", () => {
    expect(
      requestsIssueWrite(
        'gh api graphql -f query=\'query { repository(owner: "o", name: "r") { id } }\'',
        "bash",
      ),
    ).toBe(false);
  });
});

describe("IX1-4: a gh alias is read for what it expands to", () => {
  const ALIASES = new Map([
    ["bug", "issue create --label bug"],
    ["chain", "bug --title t"],
    ["ls", "issue list"],
    ["sh", "!gh issue close 5"],
  ]);

  test("an alias for an issue write is a write, through another alias too", () => {
    expect(issueWrites("gh bug --title t", "bash", ALIASES)).toEqual(["gh issue create"]);
    expect(issueWrites("gh chain", "bash", ALIASES)).toEqual(["gh issue create"]);
  });

  test("an alias for a read is no write", () => {
    expect(issueWrites("gh ls", "bash", ALIASES)).toEqual([]);
  });

  test("a shell alias cannot be read: it counts as a write", () => {
    expect(issueWrites("gh sh", "bash", ALIASES)).toEqual([
      "a gh alias that runs a shell command (`gh sh`)",
    ]);
  });

  test("an alias that loops cannot be followed: it counts as a write", () => {
    const loop = new Map([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(issueWrites("gh a", "bash", loop)).toEqual([
      "a gh alias that expands to further commands (`gh a`)",
    ]);
  });

  test("the words that name no gh command are handed back, minus the aliases given", () => {
    expect(unnamedGhWords("gh bug --title t && gh issue list && gh -R o/r dash", "bash")).toEqual([
      "bug",
      "dash",
    ]);
    expect(unnamedGhWords("gh bug", "bash", ALIASES)).toEqual([]);
    expect(unnamedGhWords("gh dash", "bash", ALIASES)).toEqual(["dash"]);
    expect(unnamedGhWords("echo gh dash; ls", "bash")).toEqual([]);
  });
});

describe("IX1-11: a label write asks like an issue write", () => {
  test.each([
    "gh label create ready -c 00ff00",
    "gh label edit bug --name ready",
    "gh label delete bug --yes",
    "gh label clone other/repo",
    "gh label -R o/r create x",
    "gh label whatever",
    "gh api repos/o/r/labels -f name=ready",
    "gh api repos/o/r/labels/bug -X PATCH -f new_name=ready",
    "gh api -X DELETE repos/o/r/labels/bug",
    "gh api repositories/5/labels -f name=x",
  ])("%s is a write", (command) => {
    expect(requestsIssueWrite(command, "bash")).toBe(true);
  });

  test.each([
    "gh label list",
    "gh label ls --json name",
    "gh label create --help",
    "gh label",
    "gh api repos/o/r/labels",
    "gh api repos/o/r/labels -X GET",
  ])("%s is no write", (command) => {
    expect(requestsIssueWrite(command, "bash")).toBe(false);
  });

  test("a program worked out when the line runs, with `label` in its words, is a risk", () => {
    expect(computedIssueRisk("$GH label create x", "bash")).toBe(true);
    expect(computedIssueRisk("$GH api repos/o/r/labels -f name=x", "bash")).toBe(true);
    expect(computedIssueRisk("$GH pr view 5", "bash")).toBe(false);
  });

  test("the question names it", () => {
    expect(issueWrites("gh label create ready", "bash")).toEqual(["gh label create"]);
    expect(issueWrites("gh api repos/o/r/labels -f name=x", "bash")).toEqual([
      "a gh api POST to repos/o/r/labels",
    ]);
  });
});

describe("IX1 review: what the second opinion found", () => {
  test("gh's own command aliases and hidden commands name a gh command", () => {
    for (const word of [
      "version",
      "ext",
      "extensions",
      "cs",
      "at",
      "rs",
      "agent",
      "agents",
      "agent-tasks",
    ]) {
      expect([word, unnamedGhWords(`gh ${word} list`, "bash")]).toEqual([word, []]);
    }
  });

  test.each([
    'gh "$CMD" create -t x',
    "gh $(echo issue) create -t x",
    "gh $X",
    "gh `echo issue` create -t x",
  ])("%s: a gh command the shell fills in is a write", (command) => {
    expect(requestsIssueWrite(command, "bash")).toBe(true);
  });

  test.each([
    "gh api graphql -f query='mutation{createPullRequest(input:{}){a} createIssue,(input:{}){a}}'",
    "gh api graphql -f query='mutation{createPullRequest(input:{}){a} createIssue(\n# a comment\ninput:{}){a}}'",
    "gh api graphql -f query='mutation{mergePullRequest(input:{}){a} , clearLabelsFromLabelable (input:{}){a}}'",
  ])("%s: a GraphQL ignored token does not hide an issue mutation", (command) => {
    expect(requestsIssueWrite(command, "bash")).toBe(true);
  });

  test("an alias is looked up by the name as typed: gh's aliases are case-sensitive", () => {
    const aliases = new Map([["Bug", "issue create"]]);
    expect(issueWrites("gh Bug -t x", "bash", aliases)).toEqual(["gh issue create"]);
    expect(unnamedGhWords("gh bug -t x", "bash", aliases)).toEqual(["bug"]);
  });

  test("a full URL of a GitHub Enterprise API is read like the path", () => {
    expect(
      requestsIssueWrite(
        "gh api https://ghe.example.com/api/v3/repos/o/r/issues -f title=x",
        "bash",
      ),
    ).toBe(true);
    expect(
      requestsIssueWrite("gh api https://ghe.example.com/api/v3/repos/o/r/labels -X POST", "bash"),
    ).toBe(true);
    expect(
      requestsIssueWrite("gh api https://ghe.example.com/api/v3/repos/o/r/issues", "bash"),
    ).toBe(false);
  });
});

// The 1.4.0 review (IX3): the shell reader now says which words the shell fills in, so a `$`
// inside single quotes (GraphQL's own variables) is text, and a `$` the shell fills still fails closed.
describe("IX3: only text the shell fills in cannot be read whole", () => {
  const READ_QUERY =
    'gh api graphql -f query=\'query($n: Int!) { repository(owner: "o", name: "r") { issue(number: $n) { title } } }\' -F n=5';

  test("a GraphQL read with its own $n variable in single quotes is no write", () => {
    expect(issueWrites(READ_QUERY, "bash")).toEqual([]);
    expect(requestsIssueWrite(READ_QUERY, "bash")).toBe(false);
    expect(
      issueWrites(
        'gh api graphql -f query=\'query($n: Int!) { repository(owner: "o", name: "r") { issue(number: $n) { title } } }\' -F n=5',
        "powershell",
      ),
    ).toEqual([]);
  });

  test.each([
    'gh api graphql -f query="$Q"',
    'gh api graphql -f query="query { viewer { login } } $(cat q)"',
    'gh api graphql -f query="`cat q`"',
    "gh api graphql -F query=$Q",
    'gh api graphql -f query="query($n: Int!) { a(number: $n) { b } }" -F n=5',
    "bash -c 'gh api graphql -f query=\"$Q\"'",
  ])("%s still fails closed: the shell fills the query in", (command) => {
    expect(issueWrites(command, "bash")).toEqual([
      "a gh api graphql request that cannot be read (its query comes from a file or the shell)",
    ]);
  });

  test("a literal mutation with variables is judged by its name, as before", () => {
    expect(
      issueWrites(
        "gh api graphql -f query='mutation($id: ID!, $b: String!) { addComment(input: {subjectId: $id, body: $b}) { clientMutationId } }'",
        "bash",
      ),
    ).toEqual(["a gh api graphql mutation (addComment)"]);
    expect(
      issueWrites(
        "gh api graphql -f query='mutation($id: ID!) { mergePullRequest(input: {pullRequestId: $id}) { clientMutationId } }'",
        "bash",
      ),
    ).toEqual([]);
  });

  test("an endpoint in single quotes with a literal $ is read as written", () => {
    expect(issueWrites("gh api -X POST 'repos/o/r/issues/$x' -f body=hi", "bash")).toEqual([
      "a gh api POST to repos/o/r/issues/$x",
    ]);
    expect(issueWrites("gh api 'repos/o/r/issues/$x'", "bash")).toEqual([]);
    // Not an issue endpoint, and no `$` the shell fills: nothing to ask about.
    expect(issueWrites("gh api -X POST 'repos/o/r/pulls/$x/comments' -f body=hi", "bash")).toEqual(
      [],
    );
  });

  test("an escaped \\$ in bash is a literal $", () => {
    expect(issueWrites("gh api -X POST repos/o/r/issues/\\$x -f body=hi", "bash")).toEqual([
      "a gh api POST to repos/o/r/issues/$x",
    ]);
    expect(
      issueWrites("gh api graphql -f query=query\\(\\$n:Int!\\){viewer{login}}", "bash"),
    ).toEqual([]);
  });

  test("an endpoint with a filled $ still fails closed, in double quotes and unquoted", () => {
    expect(requestsIssueWrite('gh api "repos/o/r/$K/5/comments" -f body=hi', "bash")).toBe(true);
    expect(requestsIssueWrite("gh api repos/o/r/$K/5/comments -f body=hi", "bash")).toBe(true);
    expect(issueWrites('gh api -X POST "repos/o/r/$K/5/comments"', "bash")).toEqual([
      "a gh api POST to an endpoint that cannot be read (repos/o/r/$K/5/comments)",
    ]);
  });

  test("PowerShell: '$n' is text, \"$n\" is filled in, and a backtick-escaped $ is text", () => {
    const write = (endpoint: string) =>
      issueWrites(`gh api -X POST ${endpoint} -f body=hi`, "powershell");
    expect(write("'repos/o/r/issues/$n'")).toEqual(["a gh api POST to repos/o/r/issues/$n"]);
    expect(write('"repos/o/r/$n/5/comments"')).toEqual([
      "a gh api POST to an endpoint that cannot be read (repos/o/r/$n/5/comments)",
    ]);
    expect(write("repos/o/r/$($n)/5/comments")).toEqual([
      "a gh api POST to an endpoint that cannot be read (repos/o/r/$($n)/5/comments)",
    ]);
    expect(write('"repos/o/r/issues/`$n"')).toEqual(["a gh api POST to repos/o/r/issues/$n"]);
  });

  test("a line the outer shell fills in first is filled all through its inner quotes", () => {
    for (const command of [
      `bash -c "gh api -X POST 'repos/o/r/$K/5/comments' -f body=hi"`,
      `echo "gh api -X POST 'repos/o/r/$K/5/comments' -f body=hi" | bash`,
      `eval "gh api -X POST 'repos/o/r/$K/5/comments' -f body=hi"`,
      "bash <<EOF\ngh api -X POST 'repos/o/r/$K/5/comments' -f body=hi\nEOF",
    ]) {
      expect(requestsIssueWrite(command, "bash")).toBe(true);
    }
    // The same text with the shell's hands off is read as written.
    expect(
      requestsIssueWrite(
        "bash <<'EOF'\ngh api -X POST 'repos/o/r/$K/5/comments' -f body=hi\nEOF",
        "bash",
      ),
    ).toBe(false);
  });

  test.each([
    "gh api graphql -f query=@change.graphql",
    "gh api graphql --input body.json",
    "gh api -X POST repos/o/r/issues --input -",
  ])("%s stays a request that cannot be read", (command) => {
    expect(requestsIssueWrite(command, "bash")).toBe(true);
  });
});
