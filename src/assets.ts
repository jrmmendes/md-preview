import mermaidPath from "../node_modules/mermaid/dist/mermaid.min.js" with { type: "file" };

const HEADERS = {
  "Content-Type": "application/javascript; charset=utf-8",
  "Cache-Control": "no-store",
  "Connection": "close",
};

export function mermaidAsset(): Response {
  return new Response(Bun.file(mermaidPath), { headers: HEADERS });
}
