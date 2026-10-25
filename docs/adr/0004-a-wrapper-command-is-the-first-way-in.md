---
status: proposed
---

# A wrapper command is the first way in

An app must be able to use Blueline with no change to its code. `blueline dev -- <cmd>`
runs the app's own dev command behind a proxy that adds the overlay's script tag to each
HTML page. A proxy on a new port changes the page's origin. That breaks sign-in redirects
built from the origin, backend CORS lists and service workers. So the wrapper starts the app
on a hidden port and takes the port that the app would have used. A browser extension would
also need no code, but it adds a store review and a second way to deliver the overlay. A
Vite plugin is simpler, but it needs a change in each app. We keep the plugin and a script
tag for the apps where the proxy cannot take the port.

Henrik's try-out on several repos settles whether the wrapper is the best way in. Until
then, this decision is proposed.

## Consequences

The wrapper must know how to move each dev server to another port: `PORT` for Next.js,
`--port` for Vite. A dev server that it does not know gets a new port and a warning.
