import { createServer } from "http";
import app from "./app";
import { env } from "./lib/env";
import { initChatGateway } from "./realtime/chat-gateway";

// Explicit HTTP server (rather than app.listen) so Socket.IO can share the same port
// and handle the websocket upgrade alongside the REST API.
const server = createServer(app);

initChatGateway(server);

server.listen(env.port, () => {
  console.log(`TheGoodFellas API listening on http://localhost:${env.port}`);
});
