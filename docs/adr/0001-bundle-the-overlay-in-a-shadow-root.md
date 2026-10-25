# Bundle the React overlay in a shadow root

Blueline must work in apps with any framework, but its overlay is about 5,000 lines of
tested React. We keep that UI and bundle React with it. The overlay mounts in a shadow root
with its own compiled CSS, so the app needs no React, Tailwind or Effect, and the two
styles do not mix. A rewrite in Solid, Lit or plain DOM would be smaller, but it would take
weeks and give the reviewer nothing new. React adds about 45 kB gzip, in development only.

## Consequences

The framework adapters (`/react`, `/foldkit`) only connect an app's parts to the core's
part store. They do not render the overlay. An app that uses React has two copies of React
in development.
