import "dotenv/config";
import "express-async-errors";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./middleware/errorHandler.js";
import { attachUser } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.routes.js";
import { usersRouter } from "./routes/users.routes.js";
import { staffRouter } from "./routes/staff.routes.js";
import { ordersRouter } from "./routes/orders.routes.js";
import { gmailRouter } from "./routes/gmail.routes.js";
import { summaryRouter } from "./routes/summary.routes.js";
import { deductionRouter } from "./routes/deduction.routes.js";
import { suppliersRouter } from "./routes/suppliers.routes.js";
import { lotteryRouter } from "./routes/lottery.routes.js";
import { paypointRouter } from "./routes/paypoint.routes.js";
import { lotteryInstantRouter } from "./routes/lotteryInstant.routes.js";
import { adminLotteryRouter } from "./routes/adminLottery.routes.js";
import { adminActiveDateRouter } from "./routes/adminActiveDate.routes.js";
import { adminReconciliationRouter } from "./routes/adminReconciliation.routes.js";
import { reportsRouter } from "./routes/reports.routes.js";
import { zReportsRouter } from "./routes/zReports.routes.js";

const app = express();

// Render (and most PaaS hosts) sit behind a reverse proxy. Without this,
// express-rate-limit (and anything else reading req.ip) sees every visitor
// as the proxy's single IP, either rate-limiting everyone as one client or
// nobody correctly. Harmless locally where there is no proxy.
app.set("trust proxy", 1);

app.use(helmet());

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
app.use(cors({ origin: allowedOrigins, credentials: true }));

app.use(express.json({ limit: "1mb" }));
app.use(attachUser);

// Strict limiter on login only: real users mistyping a password a few times
// should never be affected, but scripted password guessing gets shut down.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again later." },
});
app.use("/api/auth/login", loginLimiter);

// General limiter across all API traffic: generous for normal use, well
// below what a scripted flood would generate.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again later." },
});
app.use("/api", apiLimiter);

app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/staff", staffRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/gmail", gmailRouter);
app.use("/api/Summary", summaryRouter);
app.use("/api/Deduction", deductionRouter);
app.use("/api/Suppliers", suppliersRouter);
app.use("/api/suppliers", suppliersRouter);
app.use("/api/lottery", lotteryRouter);
app.use("/api/paypoint", paypointRouter);
app.use("/api/LotteryInstant", lotteryInstantRouter);
app.use("/api/admin/lottery", adminLotteryRouter);
app.use("/api/admin/active-date", adminActiveDateRouter);
app.use("/api/admin/reconciliation", adminReconciliationRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/z-reports", zReportsRouter);

app.use(errorHandler);

const port = process.env.PORT ?? 5000;
app.listen(port, () => {
  console.log(`Sales API listening on http://localhost:${port}`);
});
