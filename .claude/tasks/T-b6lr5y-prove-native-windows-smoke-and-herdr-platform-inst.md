---
id: "T-b6lr5y"
title: "Prove native Windows smoke and Herdr platform installation before release"
kind: "follow-up"
status: "open"
created: "2026-11-08"
from: "branch worktree-agent-ad926290a71e9513f"
---
Release verification still owed for prepared3.0.0 removal/Herdr change: native Windows hook+installer CI smoke (install.ps1 version changed); consented official GUI install on Windows Restricted-policy environment and Apple Silicon/Rosetta. Fake tests/reviews passed but no live installation performed. Do not install, change policy persistently, restart services or release without explicit approval. Check existing-GUI preservation, default/manual consent,optout,core partial failure,child-only execution policy/environment and no GUI launch/preferences. Linux mock browser checks do not prove native behavior. Keep this as release evidence obligation, not claim completed.