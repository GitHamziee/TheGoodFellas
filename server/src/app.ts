import express from "express";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import { env } from "./lib/env";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/users.routes";
import leadRoutes from "./routes/leads.routes";
import analyticsRoutes from "./routes/analytics.routes";
import chatRoutes from "./routes/chat.routes";
import externalClientRoutes from "./routes/external-clients.routes";
import expenseRoutes from "./routes/expenses.routes";
import callReviewRoutes from "./routes/call-reviews.routes";

const app = express();

app.use(cors({ origin: env.clientOrigin, credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/admin/analytics", analyticsRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/external-clients", externalClientRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/call-reviews", callReviewRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Catch-all error handler — must be last and take 4 args for Express to treat it as one.
// Without this, an error passed to next() (e.g. via asyncHandler) has nowhere to go but Express's
// default HTML error page; with it we keep the API's { error } JSON contract on failure too.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
