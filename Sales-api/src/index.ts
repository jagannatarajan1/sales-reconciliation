import "dotenv/config";
import "express-async-errors";
import cors from "cors";
import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { attachUser } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.routes.js";
import { usersRouter } from "./routes/users.routes.js";
import { ordersRouter } from "./routes/orders.routes.js";
import { gmailRouter } from "./routes/gmail.routes.js";
import { summaryRouter } from "./routes/summary.routes.js";

const app = express();

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
app.use(cors({ origin: allowedOrigins, credentials: true }));

app.use(express.json());
app.use(attachUser);

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/gmail", gmailRouter);
app.use("/api/Summary", summaryRouter);

app.use(errorHandler);

const port = process.env.PORT ?? 5000;
app.listen(port, () => {
  console.log(`Sales API listening on http://localhost:${port}`);
});
