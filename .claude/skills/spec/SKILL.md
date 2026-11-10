---
name: spec
description: Turn a Geez Squad feature or fix request into a checkable spec (docs/FEATURE_SPEC_TEMPLATE.md) before any code is written. Use when a request is vague, has no "done means", spans several areas, or uses words like "improve", "polish", "production grade", "make it work better".
argument-hint: "<feature or bug in plain words>"
---

# Draft a spec before coding

Request: $ARGUMENTS

1. Read `docs/FEATURE_SPEC_TEMPLATE.md`, and read the source files the request touches so
   the "Today" line describes real current behavior with `file:line`.
2. Fill the template **literally from the request**. Do not invent scope. If the request
   contains "and", consider whether it is two specs and say so.
   - **Who**: one primary user (trainee, coach, studio owner or admin).
   - **Device**: phone 390px on iPhone Safari, desktop, or both.
   - **Done means**: 3-6 lines, each observable on a screen or asserted in a test. Use
     numbers (px, seconds, counts) wherever the request implies them.
   - **Must not change**: pick from the contracts that apply (camera ownership and
     counting, monotonic records, auth checks, API shapes, 44px, safe areas, contain sizing,
     light-only).
   - **Out of scope**: the tempting adjacent work.
   - **How I will verify**: exact commands from the verification matrix, plus the e2e spec
     filename to add or update and any real-device steps.
3. Put every ambiguity you could not resolve from code into one **Questions** list (at most
   3 questions).
4. Show the spec and stop. Edit nothing until the user confirms or amends it. After
   confirmation, the spec is the contract: one spec, one branch, one PR.
