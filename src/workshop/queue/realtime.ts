/*
 * The fast tier (ADR 0008): OpenAI's realtime model hears him while he holds ⌃⌘, and calls
 * the page's tools in about half a second. It speaks only to hand a request to the deep agent;
 * a command acts in silence, and the page shows what happened. The page connects over WebRTC
 * with a short-lived key from the dev server's `/__realtime/token`. Turn detection is off: his
 * audio flows only while the keys are held, and the release commits it.
 *
 * He may speak again before it answers. Each release is a turn: the turns wait in line for
 * their answers, one at a time, and a press never throws away a turn before it. Each response
 * carries its turn, so a turn that took too long is cancelled, and its late answer does nothing.
 *
 * Each press asks the dev server whether the app's map is newer than the session's. When it
 * is, the session gets the map's instructions and tools, and no answer starts until it has.
 *
 * A session that drops connects again at once, so his next press finds it ready. With no route
 * or no key, the state is unavailable, and the workshop can only take typed words.
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
  /** Resolves when the model calls a tool for this turn or ends its answer: true, or false
   * when no answer came in time or the session closed. */
  readonly answered: Promise<boolean>;
}

export interface Fast {
  /** Ready: connected, so a press goes to the realtime model. */
  readonly state: () => "ready" | "connecting" | "unavailable";
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

/** The longest a turn waits for its answer. Then it fails, and its response is cancelled. */
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
  /** The version of the app's map that the session knows. */
  let version = "";
  /** Asks for a newer map: no answer starts until it ends. */
  let refreshing: Promise<void> | undefined;
  const items = new Map<string, number>();
  /** The turn of each response, by its id. */
  const responses = new Map<string, number>();
  const answers = new Map<number, (answered: boolean) => void>();
  const answer = (turn: number | undefined, answered = true) => {
    if (turn === undefined) return;
    answers.get(turn)?.(answered);
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
    if (refreshing !== undefined) {
      void refreshing.then(respond);
      return;
    }
    const turn = waiting.shift();
    if (turn === undefined) return;
    answering = turn;
    for (const old of pages.filter((p) => p < turn))
      send({ type: "conversation.item.delete", item_id: `page${String(old)}` });
    pages = pages.filter((p) => p >= turn);
    sound();
    send({
      type: "response.create",
      event_id: `respond${String(turn)}`,
      response: { metadata: { turn: String(turn) } },
    });
  };

  /** The response for the turn ended: answered, or false when it failed. */
  const answered = (ok = true) => {
    answer(answering, ok);
    answering = undefined;
    respond();
  };

  /** No answer came in time: the turn fails, and the next one in line is answered. */
  const giveUp = (turn: number) => {
    answer(turn, false);
    waiting = waiting.filter((t) => t !== turn);
    if (answering !== turn) return;
    send({ type: "response.cancel" });
    answering = undefined;
    respond();
  };

  const turnOf = (response: unknown) => {
    const turn = Number(
      (response as { metadata?: { turn?: unknown } } | undefined)?.metadata?.turn,
    );
    return Number.isInteger(turn) ? turn : undefined;
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
    for (const done of answers.values()) done(false);
    answers.clear();
    responses.clear();
    pages = [];
    waiting = [];
    answering = undefined;
    commits = [];
    items.clear();
    if (state !== "unavailable") state = "off";
  };

  const receive = (event: Event) => {
    switch (event.type) {
      case "response.created": {
        const response = event["response"] as { id?: unknown } | undefined;
        const turn = turnOf(response);
        if (typeof response?.id === "string" && turn !== undefined)
          responses.set(response.id, turn);
        break;
      }
      case "response.done": {
        const response = event["response"] as { id?: unknown } | undefined;
        if (typeof response?.id === "string") responses.delete(response.id);
        const turn = turnOf(response);
        // The end of a cancelled response, after the next turn's started.
        if (turn !== undefined && turn !== answering) break;
        // A response that failed or stopped, with no call before, answered nothing.
        answered((response as { status?: unknown } | undefined)?.status === "completed");
        break;
      }
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
        const of =
          typeof event["response_id"] === "string"
            ? responses.get(event["response_id"])
            : undefined;
        // A call from a cancelled response does nothing.
        if (of !== undefined && of !== answering) break;
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
        if (cause === `respond${String(answering)}`) answered(false);
        if (typeof cause === "string" && cause.startsWith("commit"))
          commits = commits.filter((turn) => cause !== `commit${String(turn)}`);
        break;
      }
    }
  };

  /** The session dropped: it connects again soon, unless the page closes it first. */
  const lost = () => {
    close();
    const mine = generation;
    window.setTimeout(() => {
      if (mine === generation) void connect();
    }, 500);
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
      const token = (await r.json()) as { value: string; version?: string };
      const { value } = token;
      version = token.version ?? "";
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
        lost();
      });
      pc.addEventListener("connectionstatechange", () => {
        if (peer !== pc) return;
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          console.warn(`Realtime: the connection ${pc.connectionState}`);
          lost();
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

  /** Sends the session a newer map, when there is one, one ask at a time. A slow dev server
   * holds the answer back for at most 2 s. */
  const refresh = () => {
    if (refreshing !== undefined) return;
    const mine = generation;
    refreshing = (async () => {
      try {
        const r = await fetch(`/__realtime/session?${new URLSearchParams({ have: version })}`, {
          signal: AbortSignal.timeout(2000),
        });
        if (r.status !== 200 || mine !== generation) return;
        const next = (await r.json()) as { version: string; instructions: string; tools: unknown };
        if (mine !== generation || next.version === version) return;
        send({
          type: "session.update",
          session: { type: "realtime", instructions: next.instructions, tools: next.tools },
        });
        version = next.version;
      } catch (error) {
        console.warn("Realtime: no new map", error);
      }
    })().finally(() => {
      refreshing = undefined;
    });
  };

  return {
    state: () => (state === "off" ? "connecting" : state),
    warm: () => void connect(),
    press: (stream) => {
      flush?.();
      hush = turns + 1;
      sound();
      send({ type: "input_audio_buffer.clear" });
      void sender?.replaceTrack(stream.getAudioTracks()[0] ?? null);
      refresh();
    },
    release: (page) => {
      flush?.();
      const turn = ++turns;
      const done = new Promise<boolean>((resolve) => {
        answers.set(turn, resolve);
        window.setTimeout(() => giveUp(turn), LONGEST);
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
