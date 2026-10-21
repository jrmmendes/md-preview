import mermaidPath from "../../../node_modules/mermaid/dist/mermaid.min.js" with { type: "file" };

import { baseHeaders } from "./headers";

export function mermaidAsset(): Response {
  return new Response(Bun.file(mermaidPath), {
    headers: baseHeaders("application/javascript; charset=utf-8"),
  });
}
