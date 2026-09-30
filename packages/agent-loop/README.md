# @jscadui/agent-loop

The browser-local agent loop behind jscad-web's AI Chat: provider adapters
for Anthropic Messages, OpenAI chat completions and the OpenAI Responses API,
the tool list, the system prompt, and the `docs` tool over a generated API
index. It also holds the tools that improve the prompt from real sessions: a
reader for the launcher's chat log and a live eval that runs model code in a
crt sandbox.

```js
import { buildSystemPrompt, createProvider, runTurn } from '@jscadui/agent-loop'
```

- [User manual](docs/user-manual.md): the API style setting, conversation
  context, the `docs` tool, option warnings, the chat log reader, and the
  eval's commands, fixtures, environment variables, grading and result files.
- [Architecture](docs/architecture.md): the project the model works in, its
  file tools and build report, how the eval runs model code, the sandbox with
  its parent/executor split, and the API index.
- [Development](docs/development.md): the system prompt files, regenerating
  the API index, tests.
- The prompt review loop, and how a prompt change is judged against the
  previous run: `.claude/skills/chat-review/SKILL.md`.
