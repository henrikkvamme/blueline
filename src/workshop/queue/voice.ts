/*
 * The agent cursor's voice: each line comes from the dev server's `/__voice` route, as
 * ElevenLabs speech. A walk asks for all of its lines when it starts, so each one plays at
 * once. With no route, or no key behind it, the walk shows its words alone.
 */

/** The voices to choose from, ElevenLabs' own. */
export const VOICES = [
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice" },
  { id: "SAz9YHcvj6GT2YYXdXww", name: "River" },
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric" },
] as const;

const kept = new Map<string, Promise<string | undefined>>();

/** The line as an audio URL, once; undefined when the server has no voice. */
export function fetchLine(text: string, voice: string): Promise<string | undefined> {
  const id = `${voice}\n${text}`;
  let line = kept.get(id);
  if (line === undefined) {
    line = fetch("/__voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
    })
      .then(async (r) => (r.ok ? URL.createObjectURL(await r.blob()) : undefined))
      .catch(() => undefined);
    kept.set(id, line);
    void line.then((url) => url === undefined && kept.delete(id));
  }
  return line;
}

let playing: HTMLAudioElement | undefined;

/** Stops the line that plays. */
export function hush() {
  playing?.pause();
  playing = undefined;
}

/** Plays the line, and resolves when it ends, fails or is hushed. Resolves false when there
 * was no voice to play. */
export async function say(text: string, voice: string): Promise<boolean> {
  hush();
  const url = await fetchLine(text, voice);
  if (url === undefined) return false;
  const audio = new Audio(url);
  playing = audio;
  return new Promise((resolve) => {
    const end = () => resolve(true);
    audio.onended = end;
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
    return text.trim() === "" ? undefined : { text: text.trim(), words: words ?? [] };
  } catch {
    return undefined;
  }
}
