# A realtime voice tier acts, Opus thinks

When Henrik said "go to the next" in the workshop, the page moved 4 to 6 s later. Speech to
text took 2.0 to 2.7 s after he let go of the keys, and Opus needed about 2 s more for its
first token. A command that only moves the queue does not need Opus.

We add a fast tier in front of the agent. On Henrik's decision of 2026-11-04:

- OpenAI `gpt-realtime-2.1` hears him and calls the page's tools. The page connects to it over
  WebRTC with a short-lived key that the dev server makes. The page never sees the API key.
- Push-to-talk stays on ⌃⌘. The mic streams while he holds the keys. At the release the page
  commits the audio and asks for a response. Turn detection is off, so a pause while he
  points does not end his turn.
- Its tools are `next`, `back`, `settle`, `preview` (n), `keep`, `point` (target), `walk`
  (steps), `play`, `pause` and `ask_deep_agent` (request). Before each response the page adds
  what he points at, so `point` and `ask_deep_agent` know the part he means.
- `ask_deep_agent` hands the request to the Opus agent server that answers today. Its answer
  comes back as the tool's result.
- Every line Blueline speaks uses OpenAI's voice, also Opus's answers. Blueline keeps one
  voice.

## Journeys

On Henrik's decision of 2026-11-04, the fast tier also walks a journey through the app, such as
"show me how I send this" or "click through it for me". Its `walk` tool takes the steps in
order. Each step names a part of the app, says one line, and then points at the part, clicks
it, or waits for his own click. It hands a journey to Opus when it is not sure of the parts or
their order. The walker speaks each line in the same voice as Opus's lines.

The fast tier cannot read the code, so it walks by the app's map. Opus reads the app's code once
and writes the map (`examples/review-demo/map.ts`): the pages, the parts of each by their
`data-q` names, the page that a click on a part opens, and the usual journeys. The map goes into
each new session's instructions, and its part names are the only parts `walk` accepts. The map
keeps a hash of each file Opus read. When one of them changes, the map is stale: the session
does not get it, and Opus writes it again in the background, in about 15 s. A session with no
fresh map has no `walk` tool, and a journey goes to Opus. A map written by hand was not chosen:
it goes stale without a sign, and the prod version has no person to keep it.

A journey spoken to the fast tier started its walk 1.6 s after he let go of the keys. The same
journey typed to Opus started 3.4 s after Enter, and a spoken one also waits for the fast tier
first. The lines of the walk take the same time either way.

## What we measured

`evals/voice/spike.ts` speaks eight commands with ElevenLabs text to speech, streams each at
the pace of speech, and times the end of speech to the tool call. Three rounds, 24 commands
for each setup, on 2026-11-04:

| Setup                                    | Right tool | Median | 90th percentile | Slowest |
| ---------------------------------------- | ---------- | ------ | --------------- | ------- |
| `gpt-realtime-2.1`, push-to-talk         | 24/24      | 529 ms | 861 ms          | 2673 ms |
| `gpt-realtime-2.1-mini`, push-to-talk    | 22/24      | 578 ms | 731 ms          | 1517 ms |
| ElevenLabs Agents, Claude Haiku 5.5      | 24/24      | 692 ms | 897 ms          | 2724 ms |
| ElevenLabs Agents, Gemini 3.5 Flash-Lite | 24/24      | 775 ms | 834 ms          | 909 ms  |

`evals/voice/route.ts` checks the routing of the live session: 16 spoken requests, from "next"
to a journey and a question on the code, each with the page it was said on. With the map, it
gave 47 of 48 right in three rounds; the one miss asked a question on the code as quick, not
deep. With no map, both journeys went to Opus, 4 of 4.

## Not chosen

- **`gpt-realtime-2.1-mini`.** It sent "Point at the approvers" to the deep agent two times
  in three. A wrong tool costs more than 50 ms.
- **ElevenLabs Agents.** It was right each time and kept the Alice voice, but it has no
  push-to-talk. Its turn ends on silence, so a pause while he points can cut him off. It was
  also about 150 ms slower.

## Consequences

The dev server needs `OPENAI_API_KEY`. The key is the `OpenAI API key (Blueline voice spike)`
item in the Agents vault. OpenAI's audio costs $32 for each million tokens in and $64 out.
ElevenLabs stays for the evals' speech only. Rerun the spike with
`node evals/voice/spike.ts [rounds] [openai|elevenlabs]` before a change of model.
