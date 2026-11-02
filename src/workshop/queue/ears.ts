import type { Word } from "./voice";

/*
 * His words as he speaks them, from ElevenLabs' realtime speech to text. The page streams the
 * microphone to it while he holds the keys, so the words show as he says them, and the final
 * words come about 0.2 s after he lets go, where sending the whole recording after took 0.4 to
 * 0.8 s (measured by the hearing evals, evals/hearing).
 *
 * The page talks to ElevenLabs itself, with a single-use token from the dev server's
 * `/__ears/token`, so the key stays on the server and no hop is added. One token waits ready.
 * When anything fails, `finish` resolves to undefined, and the page sends the recording as
 * before.
 */

const RATE = 16_000;
const URL_ =
  "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime" +
  "&commit_strategy=manual&audio_format=pcm_16000&include_timestamps=true";
/** How long to wait for the final words after he lets go, before the recording is sent. */
const FINAL = 2500;

let ready: Promise<string | undefined> | undefined;

/** A token for the next listen, fetched ahead. */
function token() {
  const got =
    ready ??
    fetch("/__ears/token", { method: "POST" })
      .then(async (r) => (r.ok ? ((await r.json()) as { token: string }).token : undefined))
      .catch(() => undefined);
  ready = undefined;
  // The next one, for the next press.
  setTimeout(() => {
    ready ??= fetch("/__ears/token", { method: "POST" })
      .then(async (r) => (r.ok ? ((await r.json()) as { token: string }).token : undefined))
      .catch(() => undefined);
  });
  return got;
}

/** Fetches the first token, so the first press does not wait for one. */
export function warm() {
  ready ??= fetch("/__ears/token", { method: "POST" })
    .then(async (r) => (r.ok ? ((await r.json()) as { token: string }).token : undefined))
    .catch(() => undefined);
}

/** Turns the microphone's samples into 16 kHz, 16-bit PCM, in chunks of about 100 ms. */
const WORKLET = `
class Pcm extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        this.buf.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
      if (this.buf.length >= 1600) {
        this.port.postMessage(Int16Array.from(this.buf).buffer, []);
        this.buf = [];
      }
    }
    return true;
  }
}
registerProcessor("pcm", Pcm);
`;

const base64 = (bytes: ArrayBuffer) => {
  let text = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000)
    text += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(text);
};

export interface Listening {
  /** Ends the audio, and resolves to his final words, or undefined to send the recording. */
  readonly finish: () => Promise<{ text: string; words: readonly Word[] } | undefined>;
  readonly cancel: () => void;
}

/**
 * The names and words on the page, which the ears should expect: "Ingrid" was heard as
 * "English" without them. Measured: no slower.
 */
export function keytermsOf(texts: readonly string[]): readonly string[] {
  const found = new Set<string>();
  for (const text of texts) {
    // Each capitalized word, and each pair, such as "Ingrid" and "Ingrid Berg".
    const names = [...text.matchAll(/\p{Lu}[\p{L}'-]+/gu)].map((m) => m[0]);
    for (const [i, name] of names.entries()) {
      found.add(name);
      const next = names[i + 1];
      if (next !== undefined && text.includes(`${name} ${next}`)) found.add(`${name} ${next}`);
    }
  }
  return [...found].slice(0, 50);
}

/**
 * Streams the microphone to the realtime ears. `partial` gets the words so far. `keyterms`
 * are words on the page that he may say.
 */
export function listen(
  stream: MediaStream,
  partial: (text: string) => void,
  keyterms: readonly string[] = [],
): Listening {
  let socket: WebSocket | undefined;
  let started = false;
  let failed = false;
  let ended = false;
  const waiting: string[] = [];
  let final: (got: { text: string; words: readonly Word[] } | undefined) => void = () => {};
  const done = new Promise<{ text: string; words: readonly Word[] } | undefined>(
    (resolve) => (final = resolve),
  );
  const fail = () => {
    failed = true;
    final(undefined);
  };
  const chunk = (audio: string, commit: boolean) =>
    JSON.stringify({
      message_type: "input_audio_chunk",
      audio_base_64: audio,
      commit,
      sample_rate: RATE,
    });
  const send = (message: string) => {
    if (started && socket?.readyState === WebSocket.OPEN) socket.send(message);
    else waiting.push(message);
  };

  const audio = new AudioContext({ sampleRate: RATE });
  void (async () => {
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      await audio.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(audio, "pcm");
      node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (!ended) send(chunk(base64(e.data), false));
      };
      audio.createMediaStreamSource(stream).connect(node);
    } catch {
      fail();
    }
  })();

  void token().then((t) => {
    if (t === undefined || failed) return fail();
    const terms = keyterms.map((k) => `&keyterms=${encodeURIComponent(k)}`).join("");
    const ws = new WebSocket(`${URL_}${terms}&token=${encodeURIComponent(t)}`);
    socket = ws;
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as {
        message_type: string;
        text?: string;
        words?: readonly { text: string; start: number; end: number; type: string }[];
      };
      if (m.message_type === "session_started") {
        started = true;
        for (const message of waiting.splice(0)) ws.send(message);
      } else if (m.message_type === "partial_transcript" && m.text) partial(m.text);
      else if (m.message_type === "committed_transcript_with_timestamps") {
        const words = (m.words ?? [])
          .filter((w) => w.type === "word")
          .map(({ text, start, end }) => ({ text, start, end }));
        final({ text: (m.text ?? "").trim(), words });
        ws.close();
      } else if (m.message_type.includes("error")) fail();
    };
    ws.onerror = fail;
    ws.onclose = () => final(undefined);
  });

  const close = () => {
    ended = true;
    void audio.close().catch(() => undefined);
  };
  return {
    finish: () => {
      close();
      if (failed) return Promise.resolve(undefined);
      // The last chunk ends the audio: an empty one that commits.
      send(chunk("", true));
      const timer = setTimeout(() => final(undefined), FINAL);
      return done.finally(() => clearTimeout(timer));
    },
    cancel: () => {
      close();
      failed = true;
      socket?.close();
    },
  };
}
