import { createServer } from "http";
import app from "./app";
import { env } from "./lib/env";
import { emitDataChanged, initChatGateway } from "./realtime/chat-gateway";
import { reportError } from "./lib/rollbar";
import * as leadService from "./services/lead.service";
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

// Retention callbacks lapse back to drafts after 48h; checked every minute (and at startup).
const expireCallbacks = () =>
  leadService
    .expireRetentionCallbacks()
    .then((lapsed) => {
      if (lapsed > 0) emitDataChanged();
    })
    .catch((err) => {
    console.error("[callbacks] expiry failed", err);
    reportError(err);
  });
setInterval(expireCallbacks, 60 * 1000).unref();

server.listen(env.port, () => {
  console.log(`TheGoodFellas API listening on http://localhost:${env.port}`);
  void pruneNotifications();
  void expireCallbacks();
  startSheetSyncTimer();
});
