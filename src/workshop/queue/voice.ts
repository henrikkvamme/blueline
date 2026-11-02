/*
 * The agent cursor's voice: each line comes from the dev server's `/__voice` route, as
 * ElevenLabs speech, and plays from its first bytes. A walk asks for all of its lines when it
 * starts, so each one is ready or on its way when the walk comes to it. With no route, or no key behind it, the walk shows its words alone.
 */

/** The voices to choose from, ElevenLabs' own. */
export const VOICES = [
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice" },
  { id: "SAz9YHcvj6GT2YYXdXww", name: "River" },
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric" },
] as const;

import * as timing from "./timing";

const asked = new Set<string>();

/** Where the line plays from: the dev server streams it as ElevenLabs makes it. */
const urlOf = (text: string, voice: string) =>
  `/__voice?${new URLSearchParams({ voice, text }).toString()}`;

/** Asks the dev server for the line now, so it plays at once when the walk comes to it. */
export function ahead(text: string, voice: string) {
  const id = `${voice}\n${text}`;
  if (asked.has(id)) return;
  asked.add(id);
  void fetch("/__voice/ahead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
  })
    .then((r) => {
      if (!r.ok) asked.delete(id);
    })
    .catch(() => asked.delete(id));
}

let playing: HTMLAudioElement | undefined;

/** How fast the voice speaks: 1, or 2 while he holds Space. */
let rate = 1;

/** Speaks faster or at the normal pace, from now: the line that plays changes at once. The
 * pitch stays his. */
export function setRate(to: number) {
  rate = to;
  if (playing !== undefined) playing.playbackRate = to;
}

/** How fast the voice speaks now. */
export const rateNow = () => rate;

/** Stops the line that plays. */
export function hush() {
  playing?.pause();
  playing = undefined;
}

/** Plays the line, and resolves when it ends, fails or is hushed. Resolves false when there
 * was no voice to play. */
export async function say(text: string, voice: string): Promise<boolean> {
  hush();
  timing.mark("say");
  const audio = new Audio(urlOf(text, voice));
  audio.playbackRate = rate;
  playing = audio;
  return new Promise((resolve) => {
    let played = false;
    const end = () => resolve(played);
    audio.onplaying = () => {
      played = true;
      timing.mark("voice");
    };
    audio.onended = end;
    // With no voice, or one that fails before it plays, the walk shows the line.
    audio.onerror = end;
    audio.onpause = end;
    audio.play().catch(end);
  });
}

/** A word that he said, and when in the audio, in s. */
export interface Word {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** The reviewer's spoken words as text, each word with its time, from the dev server's
 * `/__hear` route; undefined when it has no ears or heard nothing. */
export async function hear(
  audio: Blob,
): Promise<{ readonly text: string; readonly words: readonly Word[] } | undefined> {
  try {
    const r = await fetch("/__hear", {
      method: "POST",
      headers: { "Content-Type": audio.type },
      body: audio,
    });
    if (!r.ok) return undefined;
    const { text, words } = (await r.json()) as { text: string; words?: readonly Word[] };
    // A tag in brackets is a sound, not a word: with only tags, he said nothing.
    const said = text.replace(/[[(][^\])]*[\])]/g, "").trim();
    return said === "" ? undefined : { text: said, words: words ?? [] };
  } catch {
    return undefined;
  }
}
