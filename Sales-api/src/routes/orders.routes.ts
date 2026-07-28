import { Router } from "express";
import * as orderService from "../services/order.service.js";
import { CreateOrderRequest, UpdateOrderRequest } from "../types/dto.js";

export const ordersRouter = Router();

ordersRouter.get("/", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const pageNumber = parseInt((req.query.pageNumber as string) ?? "1", 10);
  const pageSize = parseInt((req.query.pageSize as string) ?? "10", 10);

  if (req.userRole === "admin") {
    return res.json(await orderService.getAllOrders(pageNumber, pageSize));
  }

  res.json(await orderService.getUserOrders(req.userId, pageNumber, pageSize));
});

ordersRouter.get("/:id", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const order = await orderService.getOrderById(parseInt(req.params.id, 10));
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }

  if (req.userId !== order.userId && req.userRole !== "admin") {
    return res.status(403).end();
  }

  res.json(order);
});

ordersRouter.post("/", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const request = req.body as CreateOrderRequest;
  if (!request.orderNumber?.trim() || !(request.totalAmount > 0)) {
    return res.status(400).json({
      message: "OrderNumber and TotalAmount are required and TotalAmount must be greater than 0",
    });
  }

  const order = await orderService.createOrder(req.userId, request);
  res.status(201).json(order);
});

ordersRouter.put("/:id", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const id = parseInt(req.params.id, 10);
  const order = await orderService.getOrderById(id);
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }

  if (req.userId !== order.userId && req.userRole !== "admin") {
    return res.status(403).end();
  }

  const updated = await orderService.updateOrder(id, req.body as UpdateOrderRequest);
  res.json(updated);
});

ordersRouter.delete("/:id", async (req, res) => {
  if (req.userId == null) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  const id = parseInt(req.params.id, 10);
  const order = await orderService.getOrderById(id);
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }

  if (req.userId !== order.userId && req.userRole !== "admin") {
    return res.status(403).end();
  }

  const success = await orderService.deleteOrder(id);
  if (!success) {
    return res.status(400).json({ message: "Failed to delete order" });
  }

  res.status(204).end();
});
