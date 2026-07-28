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
import { deductionRouter } from "./routes/deduction.routes.js";
import { suppliersRouter } from "./routes/suppliers.routes.js";
import { lotteryRouter } from "./routes/lottery.routes.js";
import { paypointRouter } from "./routes/paypoint.routes.js";
import { lotteryInstantRouter } from "./routes/lotteryInstant.routes.js";
import { adminLotteryRouter } from "./routes/adminLottery.routes.js";
import { adminActiveDateRouter } from "./routes/adminActiveDate.routes.js";
import { adminReconciliationRouter } from "./routes/adminReconciliation.routes.js";
import { reportsRouter } from "./routes/reports.routes.js";

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

app.use(errorHandler);

const port = process.env.PORT ?? 5000;
app.listen(port, () => {
  console.log(`Sales API listening on http://localhost:${port}`);
});
