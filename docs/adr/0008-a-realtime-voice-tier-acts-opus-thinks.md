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
- Its tools are `next`, `back`, `settle`, `preview` (n), `keep`, `point` (target), `play`,
  `pause` and `ask_deep_agent` (request). Before each response the page adds what he points
  at, so `point` and `ask_deep_agent` know the part he means.
- `ask_deep_agent` hands the request to the Opus agent server that answers today. Its answer
  comes back as the tool's result.
- Every line Blueline speaks uses OpenAI's voice, also Opus's answers. Blueline keeps one
  voice.

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
