import { loadConfig } from "../../../core/config";
import { startDaemon } from "../../daemon";

export function serve(): void {
  startDaemon(loadConfig());
}
