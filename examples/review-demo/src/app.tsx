import { lazy, Suspense } from "react";
import { RequestPage } from "./request-page";
import { RequestsPage } from "./requests-page";
import { requestIn, usePath } from "./router";

/** The review tools, in development only: a build holds none of them. */
const Review = import.meta.env.DEV ? lazy(() => import("./dev/review")) : () => null;

export function App() {
  const path = usePath();
  const id = requestIn(path);
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      {id === undefined ? <RequestsPage /> : <RequestPage id={id} />}
      <Suspense fallback={null}>
        <Review path={path} />
      </Suspense>
    </div>
  );
}
