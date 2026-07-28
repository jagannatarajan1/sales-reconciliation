import { Order } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { CreateOrderRequest, OrderDto, PaginatedResponse, UpdateOrderRequest } from "../types/dto.js";

function mapToOrderDto(order: Order): OrderDto {
  return {
    orderId: order.orderId,
    userId: order.userId,
    orderNumber: order.orderNumber,
    orderDate: order.orderDate,
    totalAmount: Number(order.totalAmount),
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export async function createOrder(userId: number, request: CreateOrderRequest): Promise<OrderDto> {
  const order = await prisma.order.create({
    data: {
      userId,
      orderNumber: request.orderNumber,
      orderDate: new Date(request.orderDate),
      totalAmount: request.totalAmount,
      status: request.status ?? "pending",
    },
  });

  return mapToOrderDto(order);
}

export async function getOrderById(orderId: number): Promise<OrderDto | null> {
  const order = await prisma.order.findUnique({ where: { orderId } });
  return order ? mapToOrderDto(order) : null;
}

export async function getAllOrders(
  pageNumber = 1,
  pageSize = 10
): Promise<PaginatedResponse<OrderDto>> {
  const totalCount = await prisma.order.count();
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    skip: (pageNumber - 1) * pageSize,
    take: pageSize,
  });

  return { items: orders.map(mapToOrderDto), totalCount, pageNumber, pageSize };
}

export async function getUserOrders(
  userId: number,
  pageNumber = 1,
  pageSize = 10
): Promise<PaginatedResponse<OrderDto>> {
  const where = { userId };
  const totalCount = await prisma.order.count({ where });
  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (pageNumber - 1) * pageSize,
    take: pageSize,
  });

  return { items: orders.map(mapToOrderDto), totalCount, pageNumber, pageSize };
}

export async function updateOrder(
  orderId: number,
  request: UpdateOrderRequest
): Promise<OrderDto | null> {
  const existing = await prisma.order.findUnique({ where: { orderId } });
  if (!existing) return null;

  const order = await prisma.order.update({
    where: { orderId },
    data: {
      orderNumber: request.orderNumber || undefined,
      orderDate: request.orderDate ? new Date(request.orderDate) : undefined,
      totalAmount: request.totalAmount ?? undefined,
      status: request.status || undefined,
      updatedAt: new Date(),
    },
  });

  return mapToOrderDto(order);
}

export async function deleteOrder(orderId: number): Promise<boolean> {
  const existing = await prisma.order.findUnique({ where: { orderId } });
  if (!existing) return false;

  await prisma.order.delete({ where: { orderId } });
  return true;
}
