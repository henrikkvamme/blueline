/*
 * The fast tier (ADR 0008): OpenAI's realtime model hears him while he holds ⌃⌘, and calls
 * the page's tools in about half a second. It speaks only to hand a request to the deep agent;
 * a command acts in silence, and the page shows what happened. The page connects over WebRTC
 * with a short-lived key from the dev server's `/__realtime/token`. Turn detection is off: his
 * audio flows only while the keys are held, and the release commits it.
 *
 * He may speak again before it answers. Each release is a turn: the turns wait in line for
 * their answers, one at a time, and a press never throws away a turn before it.
 *
 * With no route or no key, `ready` stays false and the workshop hears him the old way.
 */

export interface Call {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly id: string;
  /** The release it answers. */
  readonly turn: number;
}

export interface Released {
  readonly turn: number;
  /** Resolves when the model calls a tool for this turn or ends its answer. */
  readonly answered: Promise<void>;
}

export interface Fast {
  /** Connected, so a press goes to the realtime model. */
  readonly ready: () => boolean;
  /** Connects ahead of his first press. */
  readonly warm: () => void;
  /** The keys went down: his voice streams, and the model's voice goes quiet. */
  readonly press: (stream: MediaStream) => void;
  /** The keys came up: the page as he saw it, then his words, and it acts. */
  readonly release: (page: string) => Released;
  /** He dropped what he said since the press. */
  readonly drop: () => void;
  /** What a tool did, for the model to know. It says nothing about it. */
  readonly answer: (id: string, output: string) => void;
  /** A fact for the model to know, such as the deep agent's answer. */
  readonly tell: (text: string) => void;
  readonly mute: (muted: boolean) => void;
  readonly close: () => void;
}

interface Handlers {
  readonly onCall: (call: Call) => void;
  readonly onHeard: (words: string, turn: number) => void;
}

/** After the keys come up, his last syllable is still on its way. */
const TAIL = 150;

/** The longest the page waits for an answer before it stops showing that it hears him. */
const LONGEST = 8000;

type Event = { readonly type: string } & Record<string, unknown>;

export function fast(voice: () => string, on: Handlers): Fast {
  let state: "off" | "connecting" | "ready" | "unavailable" = "off";
  let peer: RTCPeerConnection | undefined;
  let channel: RTCDataChannel | undefined;
  let sender: RTCRtpSender | undefined;
  let speaker: HTMLAudioElement | undefined;
  let muted = false;
  let generation = 0;
  let tail = 0;
  let flush: (() => void) | undefined;
  let turns = 0;
  let pages: number[] = [];
  let waiting: number[] = [];
  let answering: number | undefined;
  let hush = 0;
  let commits: number[] = [];
  const items = new Map<string, number>();
  const answers = new Map<number, () => void>();
  const answer = (turn: number | undefined) => {
    if (turn === undefined) return;
    answers.get(turn)?.();
    answers.delete(turn);
  };

  const send = (event: object) => {
    if (channel?.readyState === "open") channel.send(JSON.stringify(event));
  };

  const sound = () => {
    if (speaker !== undefined) speaker.muted = muted || (answering ?? turns) < hush;
  };

  const respond = () => {
    if (answering !== undefined) return;
    const turn = waiting.shift();
    if (turn === undefined) return;
    answering = turn;
    for (const old of pages.filter((p) => p < turn))
      send({ type: "conversation.item.delete", item_id: `page${String(old)}` });
    pages = pages.filter((p) => p >= turn);
    sound();
    send({ type: "response.create", event_id: `respond${String(turn)}` });
  };

  const answered = () => {
    answer(answering);
    answering = undefined;
    respond();
  };

  const close = () => {
    generation++;
    channel?.close();
    peer?.close();
    speaker?.pause();
    peer = undefined;
    channel = undefined;
    sender = undefined;
    window.clearTimeout(tail);
    flush = undefined;
    for (const done of answers.values()) done();
    answers.clear();
    pages = [];
    waiting = [];
    answering = undefined;
    commits = [];
    items.clear();
    if (state !== "unavailable") state = "off";
  };

  const receive = (event: Event) => {
    switch (event.type) {
      case "response.done":
        answered();
        break;
      case "input_audio_buffer.committed": {
        const turn = commits.shift();
        if (turn !== undefined && typeof event["item_id"] === "string")
          items.set(event["item_id"], turn);
        break;
      }
      case "response.output_item.done": {
        const item = event["item"] as
          | { type: string; name?: string; arguments?: string; call_id?: string }
          | undefined;
        if (item?.type !== "function_call" || item.name === undefined || item.call_id === undefined)
          break;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(item.arguments ?? "{}") as Record<string, unknown>;
        } catch {
          // A call with broken arguments acts with none.
        }
        const turn = answering ?? turns;
        answer(turn);
        on.onCall({ name: item.name, args, id: item.call_id, turn });
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const id = typeof event["item_id"] === "string" ? event["item_id"] : "";
        const turn = items.get(id);
        items.delete(id);
        if (turn !== undefined)
          on.onHeard(
            typeof event["transcript"] === "string" ? event["transcript"].trim() : "",
            turn,
          );
        break;
      }
      case "error": {
        console.warn("Realtime:", event["error"]);
        const cause = (event["error"] as { event_id?: unknown } | undefined)?.event_id;
        if (cause === `respond${String(answering)}`) answered();
        if (typeof cause === "string" && cause.startsWith("commit"))
          commits = commits.filter((turn) => cause !== `commit${String(turn)}`);
        break;
      }
    }
  };

  const connect = async () => {
    if (state !== "off") return;
    state = "connecting";
    const mine = generation;
    const stale = () => mine !== generation;
    try {
      const r = await fetch(`/__realtime/token?${new URLSearchParams({ voice: voice() })}`, {
        method: "POST",
      });
      if (r.status === 503 || r.status === 404) {
        state = "unavailable";
        return;
      }
      if (!r.ok) throw new Error(`Token ${String(r.status)}`);
      const { value } = (await r.json()) as { value: string };
      if (stale()) return;
      const pc = new RTCPeerConnection();
      peer = pc;
      speaker = new Audio();
      speaker.autoplay = true;
      sound();
      pc.ontrack = (e) => {
        if (speaker !== undefined) speaker.srcObject = e.streams[0] ?? null;
      };
      sender = pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
      const dc = pc.createDataChannel("oai-events");
      channel = dc;
      dc.addEventListener("message", (m) => receive(JSON.parse(String(m.data)) as Event));
      dc.addEventListener("open", () => {
        if (peer !== pc) return;
        state = "ready";
        console.info("Realtime: ready");
      });
      dc.addEventListener("close", () => {
        if (peer !== pc) return;
        console.warn("Realtime: the session closed");
        close();
      });
      pc.addEventListener("connectionstatechange", () => {
        if (peer !== pc) return;
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          console.warn(`Realtime: the connection ${pc.connectionState}`);
          close();
        }
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answer = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp ?? "",
        headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/sdp" },
      });
      if (!answer.ok) throw new Error(`Calls ${String(answer.status)}`);
      const sdp = await answer.text();
      if (stale()) return;
      await pc.setRemoteDescription({ type: "answer", sdp });
    } catch (error) {
      console.warn("Realtime:", error);
      if (!stale()) close();
    }
  };

  return {
    ready: () => state === "ready",
    warm: () => void connect(),
    press: (stream) => {
      flush?.();
      hush = turns + 1;
      sound();
      send({ type: "input_audio_buffer.clear" });
      void sender?.replaceTrack(stream.getAudioTracks()[0] ?? null);
    },
    release: (page) => {
      flush?.();
      const turn = ++turns;
      const done = new Promise<void>((resolve) => {
        answers.set(turn, resolve);
        window.setTimeout(() => answer(turn), LONGEST);
      });
      flush = () => {
        flush = undefined;
        window.clearTimeout(tail);
        void sender?.replaceTrack(null);
        send({
          type: "conversation.item.create",
          item: {
            id: `page${String(turn)}`,
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: page }],
          },
        });
        pages.push(turn);
        send({ type: "input_audio_buffer.commit", event_id: `commit${String(turn)}` });
        commits.push(turn);
        waiting.push(turn);
        respond();
      };
      tail = window.setTimeout(() => flush?.(), TAIL);
      return { turn, answered: done };
    },
    drop: () => {
      void sender?.replaceTrack(null);
      send({ type: "input_audio_buffer.clear" });
    },
    answer: (id, output) =>
      send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: id, output },
      }),
    tell: (text) =>
      send({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
      }),
    mute: (to) => {
      muted = to;
      sound();
    },
    close,
  };
}
