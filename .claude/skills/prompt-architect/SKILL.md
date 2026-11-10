---
name: prompt-architect
description: Turn a plain-language Geez Squad request into a structured XML prompt (role, verbatim input, repo context, architecture guidelines, positively phrased constraints, done-means, verification, output format), then carry it out as the task contract. Use when the user runs /prompt-architect, or asks to structure, sharpen, rewrite or "engineer" a prompt before work starts.
argument-hint: "[--only] <your request in plain words>"
---

# Prompt architect

Raw request: $ARGUMENTS

You turn the raw request into a precise prompt, then act on it as a literal-minded senior web
developer and system design engineer. `--only` means: produce the prompt and stop.

## 1. Ground it in the repo (read, don't guess)

- Keep the user's words verbatim for `<user_input>`, minus the `--only` flag.
- Find the files the request touches (Grep/Glob, then read the relevant parts). Note the real
  current behavior with `file:line`.
- Pick the areas involved: camera/pose, API/authorization, schema, UI/layout, live room,
  records, deploy. For each area, take its guideline and constraint lines from
  [reference.md](reference.md). Include only the areas involved.
- If a Next.js API is involved, check `node_modules/next/dist/docs/` (the `next-docs` skill)
  and cite the doc path.

## 2. Write the prompt with this exact skeleton

```xml
<role>
Literal-minded senior web developer and system design engineer on Geez Squad
(Next.js 16 App Router, React 19, Prisma SQLite/PostgreSQL, Better Auth, LiveKit, MediaPipe).
Do exactly what <task> says, prove it with checks, and report what remains unverified.
</role>

<user_input>
{the request, verbatim}
</user_input>

<task>
{one sentence, imperative, no "and". If it needs "and", list sub-tasks as numbered steps.}
</task>

<context>
  <current_behavior>{what happens today, with file:line}</current_behavior>
  <relevant_files>
    <file path="...">{why it matters}</file>
  </relevant_files>
  <user>{trainee | coach | studio owner | admin}</user>
  <device>{phone 390x844 iPhone Safari | desktop | both}</device>
</context>

<architecture_guidelines>
  <guideline area="...">{from reference.md: how this area is built}</guideline>
</architecture_guidelines>

<constraints>
  <constraint>{positive, checkable instruction}</constraint>
</constraints>

<scope>
  <in>{files or behaviors that will change}</in>
  <out>{adjacent work to record as a follow-up instead of doing}</out>
</scope>

<done_means>
  <criterion id="1">{observable on a screen or asserted by a test, with numbers}</criterion>
</done_means>

<verification>
  <check>{exact command, e.g. test-results/runtime22/node.exe scripts/local-coaching-check.mjs unit}</check>
  <manual>{real-device or screenshot step, if any}</manual>
</verification>

<output_format>
Outcome in 1-2 sentences; then Changed (file: why), Verified (command: result),
Not verified, Out of scope.
</output_format>

<open_questions>
  <question>{only questions the code cannot answer; omit the element when none}</question>
</open_questions>
```

## 3. Positive steering (required)

Write every constraint as the action to take, never as a prohibition. State the desired end
state precisely enough that it can be checked.

| Instead of | Write |
| --- | --- |
| Don't break the camera | Keep the analyzer `<video>`/`<canvas>` nodes mounted and the active stream unchanged across layout changes |
| Don't hardcode colors | Use `src/app/tokens.css` tokens for every color, size, radius and shadow |
| No unrelated refactors | Change only the files listed in `<scope><in>`; record anything else under `<scope><out>` |
| Don't skip auth | Call `requireUser()` and the matching access helper inside the same transaction as each read and write |
| Don't drop columns | Add new nullable or defaulted columns in paired SQLite and PostgreSQL migrations |
| Don't guess the Next.js API | Confirm each Next.js API against `node_modules/next/dist/docs/` and cite the file |

Keep tags in the skeleton order. Fill each tag from evidence. If a field cannot be filled,
turn it into an `<open_questions>` item rather than inventing an answer.

## 4. Then act

1. Show the prompt in one `xml` code block.
2. If `--only` was passed, stop.
3. If `<open_questions>` has items, ask them (at most 3) and wait. Update the prompt with the
   answers.
4. Otherwise treat the prompt as the contract: run the `system-architect` subagent first when
   `<scope><in>` spans more than one layer, implement within scope, run `/verify`, and reply
   in `<output_format>`.
