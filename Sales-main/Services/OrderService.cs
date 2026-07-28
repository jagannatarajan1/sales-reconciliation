using Microsoft.EntityFrameworkCore;
using Sales.Data;
using Sales.DTOs;
using Sales.Models;

namespace Sales.Services;

public interface IOrderService
{
    Task<OrderDto?> CreateOrderAsync(int userId, CreateOrderRequest request);
    Task<OrderDto?> GetOrderByIdAsync(int orderId);
    Task<PaginatedResponse<OrderDto>> GetAllOrdersAsync(int pageNumber = 1, int pageSize = 10);
    Task<PaginatedResponse<OrderDto>> GetUserOrdersAsync(int userId, int pageNumber = 1, int pageSize = 10);
    Task<OrderDto?> UpdateOrderAsync(int orderId, UpdateOrderRequest request);
    Task<bool> DeleteOrderAsync(int orderId);
}

public class OrderService : IOrderService
{
    private readonly SalesDbContext _context;

    public OrderService(SalesDbContext context)
    {
        _context = context;
    }

    public async Task<OrderDto?> CreateOrderAsync(int userId, CreateOrderRequest request)
    {
        var order = new Order
        {
            UserId = userId,
            OrderNumber = request.OrderNumber,
            OrderDate = request.OrderDate,
            TotalAmount = request.TotalAmount,
            Status = request.Status
        };

        _context.Orders.Add(order);
        await _context.SaveChangesAsync();

        return MapToOrderDto(order);
    }

    public async Task<OrderDto?> GetOrderByIdAsync(int orderId)
    {
        var order = await _context.Orders.FirstOrDefaultAsync(o => o.OrderId == orderId);
        return order != null ? MapToOrderDto(order) : null;
    }

    public async Task<PaginatedResponse<OrderDto>> GetAllOrdersAsync(int pageNumber = 1, int pageSize = 10)
    {
        var query = _context.Orders;
        var totalCount = await query.CountAsync();
        
        var orders = await query
            .OrderByDescending(o => o.CreatedAt)
            .Skip((pageNumber - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        return new PaginatedResponse<OrderDto>
        {
            Items = orders.Select(MapToOrderDto).ToList(),
            TotalCount = totalCount,
            PageNumber = pageNumber,
            PageSize = pageSize
        };
    }

    public async Task<PaginatedResponse<OrderDto>> GetUserOrdersAsync(int userId, int pageNumber = 1, int pageSize = 10)
    {
        var query = _context.Orders.Where(o => o.UserId == userId);
        var totalCount = await query.CountAsync();
        
        var orders = await query
            .OrderByDescending(o => o.CreatedAt)
            .Skip((pageNumber - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        return new PaginatedResponse<OrderDto>
        {
            Items = orders.Select(MapToOrderDto).ToList(),
            TotalCount = totalCount,
            PageNumber = pageNumber,
            PageSize = pageSize
        };
    }

    public async Task<OrderDto?> UpdateOrderAsync(int orderId, UpdateOrderRequest request)
    {
        var order = await _context.Orders.FirstOrDefaultAsync(o => o.OrderId == orderId);
        if (order == null)
            return null;

        if (!string.IsNullOrEmpty(request.OrderNumber))
            order.OrderNumber = request.OrderNumber;

        if (request.OrderDate.HasValue)
            order.OrderDate = request.OrderDate.Value;

        if (request.TotalAmount.HasValue)
            order.TotalAmount = request.TotalAmount.Value;

        if (!string.IsNullOrEmpty(request.Status))
            order.Status = request.Status;

        order.UpdatedAt = DateTime.UtcNow;
        _context.Orders.Update(order);
        await _context.SaveChangesAsync();

        return MapToOrderDto(order);
    }

    public async Task<bool> DeleteOrderAsync(int orderId)
    {
        var order = await _context.Orders.FirstOrDefaultAsync(o => o.OrderId == orderId);
        if (order == null)
            return false;

        _context.Orders.Remove(order);
        await _context.SaveChangesAsync();
        return true;
    }

    private static OrderDto MapToOrderDto(Order order)
    {
        return new OrderDto
        {
            OrderId = order.OrderId,
            UserId = order.UserId,
            OrderNumber = order.OrderNumber,
            OrderDate = order.OrderDate,
            TotalAmount = order.TotalAmount,
            Status = order.Status,
            CreatedAt = order.CreatedAt,
            UpdatedAt = order.UpdatedAt
        };
    }
}
