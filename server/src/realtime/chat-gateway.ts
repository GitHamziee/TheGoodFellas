import type { Server as HttpServer } from "http";
import { Server as IOServer, type Socket } from "socket.io";
import type { Role } from "@prisma/client";
import { env } from "../lib/env";
import { verifyToken } from "../lib/jwt";
import prisma from "../lib/prisma";
import { canAccessRoom, parseRoom, roomsForUser, socketRoom, type RoomKey } from "../lib/chat-rooms";
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

    // Private room per user — the only way a notification reaches a socket.
    void socket.join(`user:${user.id}`);

    // Membership is assigned here, from the role and group rows — never from anything the client sends.
    void roomsForUser(user).then((rooms) => {
      for (const room of rooms) void socket.join(socketRoom(room));
    });

    socket.on("chat:typing", async (payload: unknown) => {
      const raw = payload as { room?: unknown; isTyping?: unknown } | null;
      const room = parseRoom(raw?.room);
      if (!room || !(await canAccessRoom(user, room))) return;

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
export function emitMessageCreated(room: RoomKey, message: PublicMessage): void {
  io?.to(socketRoom(room)).emit("chat:message", message);
}

/** Broadcast an edit or soft-delete — clients replace the message with the same id in place. */
export function emitMessageUpdated(room: RoomKey, message: PublicMessage): void {
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

/** Pushes one notification to a single user's live sockets (every tab/device they have open). */
export function emitNotification(userId: string, notification: unknown): void {
  io?.to(`user:${userId}`).emit("notification:new", notification);
}

/**
 * A new group was created: put every member's live sockets into its room and tell them to
 * refresh their channel list, so the group appears without a reload.
 */
export function emitGroupCreated(room: RoomKey, memberIds: string[]): void {
  for (const id of memberIds) {
    io?.in(`user:${id}`).socketsJoin(socketRoom(room));
    io?.to(`user:${id}`).emit("chat:rooms-changed");
  }
}

/** Group roster/name changed: sync live socket rooms and tell everyone affected to refetch. */
export function emitGroupChanged(room: RoomKey, addedIds: string[], removedIds: string[], keptIds: string[]): void {
  for (const id of addedIds) io?.in(`user:${id}`).socketsJoin(socketRoom(room));
  for (const id of removedIds) io?.in(`user:${id}`).socketsLeave(socketRoom(room));
  for (const id of [...addedIds, ...removedIds, ...keptIds]) io?.to(`user:${id}`).emit("chat:rooms-changed");
}

/** Group deleted: drop every member's socket from its room and have them refetch their list. */
export function emitGroupDeleted(room: RoomKey, memberIds: string[]): void {
  io?.in(socketRoom(room)).socketsLeave(socketRoom(room));
  for (const id of memberIds) io?.to(`user:${id}`).emit("chat:rooms-changed");
}
