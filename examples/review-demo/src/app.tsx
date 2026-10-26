import { RequestPage } from "./request-page";
import { RequestsPage } from "./requests-page";
import { requestIn, usePath } from "./router";

// The review tools, in development only: a build holds none of them.
if (import.meta.env.DEV) void import("./dev/review");

export function App() {
  const path = usePath();
  const id = requestIn(path);
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      {id === undefined ? <RequestsPage /> : <RequestPage id={id} />}
    </div>
  );
}
