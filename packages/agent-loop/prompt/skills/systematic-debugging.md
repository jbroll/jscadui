---
description: Diagnose a build failure or wrong geometry by isolating the cause.
---

1. Reproduce first: read the build report error with file, line and column, or describe the wrong shape with measure and check.
2. Isolate: narrow with grep to the suspect lines, re-read them with read, and test a minimal snippet with execute, which never saves.
3. Form one hypothesis at a time; check docs for the exact signature before assuming misuse.
4. Fix with a single edit, then verify via the build report, measure, and check.
5. If the fix fails, discard the hypothesis and try the next; do not stack edits.
6. Report the cause and the verification, not the guesses that failed.
