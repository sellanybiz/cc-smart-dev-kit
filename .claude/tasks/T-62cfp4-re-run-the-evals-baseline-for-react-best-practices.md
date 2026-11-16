---
id: "T-62cfp4"
title: "Re-run the evals baseline for react-best-practices and the narrowed performance-budget"
kind: "follow-up"
status: "open"
when: "next-release"
flags: ["spends-money"]
created: "2026-11-16"
from: "branch feat/shadcn"
---
4.10.0 split react-best-practices out of performance-budget and added two eval cases tagged watch (evals/cases). The recorded baseline (evals/baseline/*.json) predates the split. Re-run the paid evals with the person's yes, compare trigger rates for both skills, and update the baseline.