import type { Server as HttpServer } from "http";
import { Server as IOServer, type Socket } from "socket.io";
import type { ChatRoom, Role } from "@prisma/client";
import { env } from "../lib/env";
import { verifyToken } from "../lib/jwt";
import prisma from "../lib/prisma";
import { canAccessRoom, parseRoom, roomsFor, socketRoom } from "../lib/chat-rooms";
import type { PublicMessage } from "../services/chat.service";

interface SocketUser {
  id: string;
  name: string;
  role: Role;
}

// socket.data is `any` by default — this keeps handlers honest about what's on it.
type ChatSocket = Socket & { data: { user: SocketUser } };

let io: IOServer | null = null;

/**
 * Attaches the chat websocket to the existing HTTP server.
 *
 * The socket carries *no* authority of its own: it authenticates with the same JWT as the
 * REST API (same tokenVersion check), and the server decides which rooms it joins from the
 * user's role. A client can never ask to join a room — so a Junior Closer cannot subscribe
 * to the Closers channel by editing the request.
 */
export function initChatGateway(httpServer: HttpServer): IOServer {
  io = new IOServer(httpServer, {
    cors: { origin: env.clientOrigin, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      // Sent by the client as `auth: { token }` — the browser WebSocket API cannot set
      // an Authorization header, so the handshake payload is where the token goes.
      const token = socket.handshake.auth?.token;
      if (typeof token !== "string" || token === "") return next(new Error("Unauthorized"));

      const payload = verifyToken(token);
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, name: true, role: true, tokenVersion: true },
      });

      // Same revocation rule as the REST middleware — a role or password change kills live sockets too.
      if (!user || user.tokenVersion !== payload.tokenVersion) return next(new Error("Unauthorized"));

      // CLIENT has no chat channels but still connects: the socket also carries the
      // payload-free `data:changed` nudge that tells every portal to refetch.

      socket.data.user = { id: user.id, name: user.name, role: user.role };
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const chatSocket = socket as ChatSocket;
    const user = chatSocket.data.user;

    // Membership is assigned here, from the role — never from anything the client sends.
    for (const room of roomsFor(user.role)) {
      void socket.join(socketRoom(room));
    }

    socket.on("chat:typing", (payload: unknown) => {
      const raw = payload as { room?: unknown; isTyping?: unknown } | null;
      const room = parseRoom(raw?.room);
      if (!room || !canAccessRoom(user.role, room)) return;

      // `socket.to` excludes the sender — you never see your own typing indicator.
      socket.to(socketRoom(room)).emit("chat:typing", {
        room,
        userId: user.id,
        name: user.name,
        isTyping: raw?.isTyping === true,
      });
    });
  });

  return io;
}

/** Broadcast a newly created message to everyone currently in that room. */
export function emitMessageCreated(room: ChatRoom, message: PublicMessage): void {
  io?.to(socketRoom(room)).emit("chat:message", message);
}

/** Broadcast an edit or soft-delete — clients replace the message with the same id in place. */
export function emitMessageUpdated(room: ChatRoom, message: PublicMessage): void {
  io?.to(socketRoom(room)).emit("chat:message-updated", message);
}

/**
 * Tells every connected portal "something changed, refetch". Deliberately carries no payload:
 * clients reload through the normal REST endpoints, so role-based masking still applies and
 * nothing sensitive ever rides on the broadcast.
 */
export function emitDataChanged(): void {
  io?.emit("data:changed");
}
