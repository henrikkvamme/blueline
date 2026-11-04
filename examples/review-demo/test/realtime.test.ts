import { afterEach, describe, expect, it, vi } from "vitest";
import { fast } from "../../../src/workshop/queue/realtime";

/*
 * The fast tier's turns against a made-up connection: the page's events go out in the right
 * order, and each turn says whether an answer came.
 */

type Sent = { readonly type: string } & Record<string, unknown>;

class Channel extends EventTarget {
  readyState = "open";
  readonly sent: Sent[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data) as Sent);
  }
  close() {}
  /** An event from OpenAI. */
  receive(event: object) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
  }
}

let channel: Channel;

class Peer extends EventTarget {
  connectionState = "new";
  ontrack: unknown = null;
  addTransceiver() {
    return { sender: { replaceTrack: async () => {} } };
  }
  createDataChannel() {
    channel = new Channel();
    return channel;
  }
  async createOffer() {
    return { type: "offer", sdp: "offer" };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {
    setTimeout(() => channel.dispatchEvent(new Event("open")));
  }
  close() {}
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** A fast tier on the made-up connection; the map route answers after `mapAfter` ms. */
async function connected(mapAfter: number) {
  vi.stubGlobal("RTCPeerConnection", Peer);
  const real = window.fetch.bind(window);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.startsWith("/__realtime/token")) return Response.json({ value: "key", version: "" });
    if (url.startsWith("https://api.openai.com")) return new Response("answer");
    if (url.startsWith("/__realtime/session")) {
      await wait(mapAfter);
      return Response.json({ version: "v2", instructions: "with the map", tools: [] });
    }
    return real(input, init);
  });
  const tier = fast(() => "marin", { onCall: () => {}, onHeard: () => {} });
  tier.warm();
  for (let i = 0; i < 50 && tier.state() !== "ready"; i++) await wait(10);
  expect(tier.state()).toBe("ready");
  return tier;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the fast tier", () => {
  it("starts no answer before a newer map reaches the session", async () => {
    const tier = await connected(400);
    tier.press(new MediaStream());
    void tier.release("The page.");
    await wait(600);
    const types = channel.sent.map((e) => e.type);
    expect(types).toContain("response.create");
    expect(types.indexOf("session.update")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("session.update")).toBeLessThan(types.indexOf("response.create"));
    tier.close();
  });

  it("says that no answer came when the response fails", async () => {
    const tier = await connected(0);
    tier.press(new MediaStream());
    const { turn, answered } = tier.release("The page.");
    await wait(300);
    const response = { id: "r1", metadata: { turn: String(turn) } };
    channel.receive({ type: "response.created", response });
    channel.receive({ type: "response.done", response: { ...response, status: "failed" } });
    expect(await answered).toBe(false);
    tier.close();
  });

  it("fails a press that the session dropped and sends the new one nothing", async () => {
    const tier = await connected(0);
    tier.press(new MediaStream());
    const old = channel;
    old.dispatchEvent(new Event("close"));
    for (let i = 0; i < 100 && (channel === old || tier.state() !== "ready"); i++) await wait(10);
    expect(tier.state()).toBe("ready");
    const { answered } = tier.release("The page.");
    expect(await answered).toBe(false);
    await wait(300);
    expect(channel.sent.map((e) => e.type)).not.toContain("input_audio_buffer.commit");
    tier.close();
  });

  it("lets a late answer of an earlier turn do nothing", async () => {
    const tier = await connected(0);
    tier.press(new MediaStream());
    const first = tier.release("The page.");
    await wait(300);
    channel.receive({
      type: "response.created",
      response: { id: "r1", metadata: { turn: String(first.turn) } },
    });
    channel.receive({
      type: "response.done",
      response: { id: "r1", metadata: { turn: String(first.turn) }, status: "completed" },
    });
    expect(await first.answered).toBe(true);
    // The first turn's response ends again, late: the second turn still waits for its own.
    tier.press(new MediaStream());
    const second = tier.release("The page.");
    await wait(300);
    let settled = false;
    void second.answered.then(() => (settled = true));
    channel.receive({
      type: "response.done",
      response: { id: "r1", metadata: { turn: String(first.turn) }, status: "completed" },
    });
    await wait(20);
    expect(settled).toBe(false);
    tier.close();
  });
});
