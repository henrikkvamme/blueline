import { describe, expect, it } from "vitest";
import { devCommandOf, listenOf, viteInputsOf, wordsOf } from "../src/server/command";

/*
 * How `blueline dev` reads the command it wraps (src/server/command.ts): the dev server in
 * it, through the app's package scripts, and the port and host the page uses.
 */

const found = (words: string[], scripts: Record<string, string> = {}) => {
  const command = devCommandOf(words, scripts);
  if (command.kind !== "found") throw new Error(command.reason);
  return command.server;
};
const reason = (words: string[], scripts: Record<string, string> = {}) => {
  const command = devCommandOf(words, scripts);
  if (command.kind !== "refused") throw new Error("Not refused");
  return command.reason;
};

describe("the dev server in a command", () => {
  it("splits a script's text as a shell does, with its quotes", () => {
    expect(wordsOf(`A=1 vite --mode "my mode" && echo 'a b'`)).toEqual([
      ["A=1", "vite", "--mode", "my mode"],
      ["echo", "a b"],
    ]);
    expect(wordsOf("a & b | c ; d || e")).toEqual([["a"], ["b"], ["c"], ["d"], ["e"]]);
  });

  it("takes each package manager's script, with the words after it", () => {
    const scripts = { dev: "vite --port 4000" };
    for (const words of [
      ["pnpm", "dev", "--host"],
      ["pnpm", "run", "dev", "--host"],
      ["npm", "run", "dev", "--", "--host"],
      ["yarn", "dev", "--host"],
      ["yarn", "run", "dev", "--host"],
      ["bun", "run", "dev", "--host"],
    ])
      expect(found(words, scripts)).toEqual({
        kind: "vite",
        program: "vite",
        args: ["--port", "4000", "--host"],
        env: {},
      });
  });

  it("follows a script that runs another script", () => {
    expect(found(["pnpm", "dev"], { dev: "pnpm run web", web: "next dev -p 3001" })).toEqual({
      kind: "next",
      program: "next",
      args: ["dev", "-p", "3001"],
      env: {},
    });
  });

  it("carries a script's NAME=value words into the scripts it runs", () => {
    const scripts = { dev: "PORT=4567 A=1 pnpm run web", web: "A=2 next dev" };
    expect(found(["pnpm", "dev"], scripts).env).toEqual({ PORT: "4567", A: "2" });
    expect(reason(["pnpm", "dev"], { dev: "NODE_OPTIONS=x pnpm run web", web: "vite" })).toMatch(
      /NODE_OPTIONS/,
    );
  });

  it("finds the dev server's part after others, and its env and wrappers", () => {
    expect(found(["pnpm", "dev"], { dev: "tsc -b && PORT=4100 cross-env A=b next dev" })).toEqual({
      kind: "next",
      program: "next",
      args: ["dev"],
      env: { PORT: "4100", A: "b" },
    });
    expect(found(["npx", "vite", "serve"]).kind).toBe("vite");
    expect(found(["pnpm", "exec", "vp", "dev"]).program).toBe("vp");
    expect(found(["bunx", "vite"]).kind).toBe("vite");
    expect(found(["./node_modules/.bin/vite"]).kind).toBe("vite");
  });

  it("refuses a command with no dev server it knows", () => {
    expect(reason(["pnpm", "dev"], { dev: "astro dev" })).toMatch(/--port/);
    expect(reason(["vite", "build"])).toMatch(/--port/);
    expect(reason(["next", "start"])).toMatch(/--port/);
    expect(reason(["pnpm", "dev"])).toMatch(/no script dev/);
  });

  it("refuses two dev servers, and a script of another package", () => {
    expect(reason(["pnpm", "dev"], { dev: "vite & next dev" })).toMatch(/two dev servers/);
    expect(reason(["pnpm", "--filter", "web", "dev"], { dev: "vite" })).toMatch(/--filter/);
  });

  it("refuses a command that sets NODE_OPTIONS itself", () => {
    for (const script of [
      "NODE_OPTIONS=--max-old-space-size=4096 next dev",
      "cross-env NODE_OPTIONS=--inspect vite",
      "NODE_OPTIONS=x astro dev",
    ])
      expect(reason(["pnpm", "dev"], { dev: script })).toMatch(/NODE_OPTIONS/);
  });
});

describe("where the page listens", () => {
  const vite = (args: string[], config = {}, env = {}) =>
    listenOf({ kind: "vite", program: "vite", args, env: {} }, env, config);
  const next = (args: string[], own: Record<string, string> = {}, env = {}) =>
    listenOf({ kind: "next", program: "next", args, env: own }, env, {});

  it("takes Vite's flag, then its config, then 5173", () => {
    expect(vite(["--port", "4000"], { port: 5000 }).port).toBe(4000);
    expect(vite(["--port=4001"]).port).toBe(4001);
    expect(vite(["--port", "4000", "--port", "4002"]).port).toBe(4002);
    expect(vite([], { port: 5000 }).port).toBe(5000);
    expect(vite([]).port).toBe(5173);
  });

  it("takes Next.js's flag, then PORT from the part, then from the environment, then 3000", () => {
    expect(next(["dev", "-p", "3001"], { PORT: "3002" }, { PORT: "3003" }).port).toBe(3001);
    expect(next(["dev", "--port=3004"]).port).toBe(3004);
    expect(next(["dev"], { PORT: "3002" }, { PORT: "3003" }).port).toBe(3002);
    expect(next(["dev"], {}, { PORT: "3003" }).port).toBe(3003);
    expect(next(["dev"]).port).toBe(3000);
  });

  it("listens where the dev server would", () => {
    expect(vite([]).host).toBe("localhost");
    expect(vite(["--host"]).host).toBe(true);
    expect(vite(["--host", "--port", "1"]).host).toBe(true);
    expect(vite(["--host", "app.test"]).host).toBe("app.test");
    expect(vite(["--host=0.0.0.0"]).host).toBe("0.0.0.0");
    expect(vite([], { host: true }).host).toBe(true);
    expect(vite([], { host: "my.test" }).host).toBe("my.test");
    expect(next(["dev"]).host).toBe(true);
    expect(next(["dev", "-H", "127.0.0.1"]).host).toBe("127.0.0.1");
    expect(next(["dev", "--hostname=::1"]).host).toBe("::1");
  });

  it("says when the dev server serves HTTPS", () => {
    expect(vite([], { https: true }).https).toBe(true);
    expect(next(["dev", "--experimental-https"]).https).toBe(true);
    expect(vite([]).https).toBe(false);
  });

  it("gives Vite's config the root, config file, mode and loader in the words", () => {
    expect(
      viteInputsOf(["serve", "web", "-c", "other.js", "--mode=staging", "--host", "x"]),
    ).toEqual({ root: "web", file: "other.js", mode: "staging", loader: undefined });
    expect(viteInputsOf(["--configLoader", "runner", "-m", "test", "app"])).toEqual({
      root: "app",
      file: undefined,
      mode: "test",
      loader: "runner",
    });
  });
});
