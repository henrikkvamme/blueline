import { Workshop } from "@henrikkvamme/blueline/workshop";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./workshop.css";

/*
 * Blueline's own workshops, at /workshop.html on the dev server only: the build reads
 * index.html alone.
 */

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <Workshop />
    </StrictMode>,
  );
