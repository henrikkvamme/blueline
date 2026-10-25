# Notes carry their own instructions

An agent needs to know how to answer a note, how to write journeys and variants, and when a
note arrives. We give it all three with nothing to install in the agent. Each delivered
note carries its step, its pins and the exact command to reply. The typed config and
`blueline guide` explain journeys and variants. Delivery goes through the agent's harness
(T3, the Codex app-server). A skill, a Claude Code plugin with hooks, and an MCP server
were the alternatives. Each needs an install per agent or per machine. An MCP server also
costs context in every session and cannot push.

## Consequences

A bare Claude Code session outside T3 gets notes only while it runs `blueline listen` under
a watcher, which can expire. If this proves to be a real limit, we add a Claude Code plugin
whose hook gives the agent the notes at each tool boundary.
