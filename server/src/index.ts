import { createServer } from "http";
import app from "./app";
import { env } from "./lib/env";
import { initChatGateway } from "./realtime/chat-gateway";
import { reportError } from "./lib/rollbar";
import * as notificationService from "./services/notification.service";
import { startSheetSyncTimer } from "./services/retention-sheet-sync.service";

// Explicit HTTP server (rather than app.listen) so Socket.IO can share the same port
// and handle the websocket upgrade alongside the REST API.
const server = createServer(app);

initChatGateway(server);

// Daily notification cleanup (also once at startup) — read ones are dropped after a day.
const pruneNotifications = () =>
  notificationService.pruneOld().catch((err) => {
    console.error("[notifications] prune failed", err);
    reportError(err);
  });
setInterval(pruneNotifications, 24 * 60 * 60 * 1000).unref();

server.listen(env.port, () => {
  console.log(`TheGoodFellas API listening on http://localhost:${env.port}`);
  void pruneNotifications();
  startSheetSyncTimer();
});
