import { Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { ImageSchema } from "../notes/note";
import { ListeningSchema } from "./listening";
import { RepliesSchema } from "./replies";

/*
 * The page's side of the channel to the agent (vite.ts): posts a JSON line, keeps a pasted
 * screenshot, reads the agent's replies by note ID, and reads who listens.
 */

const http = <A, E>(program: Effect.Effect<A, E, HttpClient.HttpClient>) =>
  program.pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.timeout("10 seconds"),
  );

const url = (route: string) => new URL(route, window.location.href);

export const postLine = (route: string, line: unknown) =>
  http(
    Effect.gen(function* () {
      const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
      yield* client.execute(
        yield* HttpClientRequest.bodyJson(HttpClientRequest.post(url(route)), line),
      );
    }),
  );

export const readReplies = (route: string) =>
  http(
    Effect.gen(function* () {
      const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
      const response = yield* client.get(url(route));
      return yield* Schema.decodeUnknownEffect(RepliesSchema)(yield* response.json);
    }),
  );

/** Who listens to the notes, by listener. */
export const readListening = (route: string) =>
  http(
    Effect.gen(function* () {
      const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
      const response = yield* client.get(url(route));
      return yield* Schema.decodeUnknownEffect(ListeningSchema)(yield* response.json);
    }),
  );

/** Keeps a screenshot on the dev server, and gives its name and file. */
export const postImage = (route: string, image: Blob) =>
  http(
    Effect.gen(function* () {
      const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
      const request = HttpClientRequest.post(url(route)).pipe(
        HttpClientRequest.bodyUint8Array(
          new Uint8Array(yield* Effect.tryPromise(() => image.arrayBuffer())),
          image.type,
        ),
      );
      const response = yield* client.execute(request);
      return yield* Schema.decodeUnknownEffect(ImageSchema)(yield* response.json);
    }),
  );
