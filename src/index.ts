import { cfg } from "./config";
import { startServer } from "./server";
import { recover, scan } from "./worker";

recover();
const server = startServer();
console.log(`videocoder: ${cfg.input} → ${cfg.output}, UI on :${server.port}`);
scan();
setInterval(scan, cfg.scanInterval * 1000);
