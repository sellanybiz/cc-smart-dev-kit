/**
 * The reader of a raw write to GitHub's issues (D67): `gh issue create|edit|comment|close|…` and
 * `gh api` POST/PATCH/PUT/DELETE to a repository's issues. The merge guard asks the person about
 * one, and denies it in a crew session. Reads, and the kit's own `issue file`, are no write.
 */
import { describe, expect, test } from "bun:test";
import { computedIssueRisk, issueWrites, requestsIssueWrite } from "./issue-writes";

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
