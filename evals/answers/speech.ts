import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/*
 * What a case says, as speech: ElevenLabs text to speech, with the time each word starts, so
 * the eval can point at an element as he says the word for it. Each line is spoken once and
 * kept under evals/answers/audio/ (out of git). Only a new line needs ELEVENLABS_API_KEY.
 */

/** ElevenLabs' George, the voice of the hearing evals. */
const VOICE = "JBFqnCBsd6RMkjVDRZzb";
const MODEL = "eleven_v4";

export interface Speech {
  /** The audio, as base64 mp3. */
  readonly audio: string;
  /** Each word, with when it starts and ends in the audio, in s. */
  readonly words: readonly {
    readonly word: string;
    readonly start: number;
    readonly end: number;
  }[];
  readonly seconds: number;
}

interface Alignment {
  readonly characters: readonly string[];
  readonly character_start_times_seconds: readonly number[];
  readonly character_end_times_seconds: readonly number[];
}

export function wordsOf(alignment: Alignment): Speech["words"] {
  const words: { word: string; start: number; end: number }[] = [];
  let word: { word: string; start: number; end: number } | undefined;
  alignment.characters.forEach((ch, i) => {
    const start = alignment.character_start_times_seconds[i] ?? 0;
    const end = alignment.character_end_times_seconds[i] ?? start;
    if (/\s/.test(ch)) {
      if (word !== undefined) words.push(word);
      word = undefined;
      return;
    }
    if (word === undefined) word = { word: ch, start, end };
    else word = { ...word, word: word.word + ch, end };
  });
  if (word !== undefined) words.push(word);
  return words;
}

export async function speak(dir: string, text: string): Promise<Speech> {
  const key = createHash("sha256").update(`${VOICE} ${MODEL} ${text}`).digest("hex").slice(0, 16);
  const file = path.join(dir, `${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Speech;
  const apiKey = process.env["ELEVENLABS_API_KEY"] ?? "";
  if (apiKey === "") throw new Error(`Set ELEVENLABS_API_KEY to speak "${text}"`);
  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: MODEL }),
    },
  );
  if (!r.ok) throw new Error(`Text to speech ${String(r.status)}: ${await r.text()}`);
  const body = (await r.json()) as { audio_base64: string; alignment: Alignment };
  const words = wordsOf(body.alignment);
  const speech: Speech = {
    audio: body.audio_base64,
    words,
    seconds: Math.max(0, ...body.alignment.character_end_times_seconds),
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(speech));
  return speech;
}
