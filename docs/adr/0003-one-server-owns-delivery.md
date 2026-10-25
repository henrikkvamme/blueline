# One server on the machine owns delivery

Before this decision, an agent got notes only while it listened. A watcher that expired, or
an agent that never started one, left notes unseen for up to two hours. A separate service
tried to close the gap. It found listeners with `ps` and `lsof`, and it watched only the
paths it knew. Now one `blueline serve` process on each machine keeps every repository's
notes and delivers them. Agents register with it. When no agent is registered, it starts
one. The Vite plugin and the script tag start the server when it does not run, so there is
no service to install.

## Consequences

The dev server no longer holds the channel. The page talks to the server, through the Vite
plugin's proxy or directly from the script tag. The notes file stays the record, so an agent
can still read the notes without the server.
