---
name: next-docs
description: Look up the installed Next.js 16 documentation in node_modules/next/dist/docs before using or changing any Next.js API (route handlers, params, caching, metadata, middleware/proxy, server actions, next/font, next/image, config). Use whenever writing Next.js-specific code, because this version differs from training data.
argument-hint: "<api or topic, e.g. route handler params>"
allowed-tools: Read, Grep, Glob
---

# Check the installed Next.js docs

Topic: $ARGUMENTS

1. Search the App Router docs first (this project does not use the Pages Router):
   - `Grep` for the API name in `node_modules/next/dist/docs/01-app/` (files are `.md`,
     so use `output_mode: files_with_matches` first).
   - Start points: `01-app/03-api-reference/` (functions, file conventions, config),
     `01-app/02-guides/`, and `01-app/01-getting-started/`.
2. Read the matching file(s) and note any **deprecation**, **breaking change** or
   **version history** notes.
3. Answer with: the exact signature or convention for this version, a one-line example, the
   doc path you read, and any deprecations. If the docs and existing project code disagree,
   follow the docs and say which project file uses the old form, without changing it unless
   it is in scope.
4. If nothing is found, say so plainly and do not fall back to memory without flagging that.
