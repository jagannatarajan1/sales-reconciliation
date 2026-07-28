using Microsoft.AspNetCore.Mvc;
using Sales.DTOs;
using Sales.Services;

namespace Sales.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly IOrderService _orderService;

    public OrdersController(IOrderService orderService)
    {
        _orderService = orderService;
    }

    [HttpGet]
    public async Task<ActionResult<PaginatedResponse<OrderDto>>> GetAllOrders([FromQuery] int pageNumber = 1, [FromQuery] int pageSize = 10)
    {
        // Check if user is authenticated
        var userIdObj = HttpContext.Items["UserId"];
        if (userIdObj == null)
            return Unauthorized(new { message = "User not authenticated" });

        // Regular users see only their orders, admins see all
        var userRoleObj = HttpContext.Items["UserRole"];
        if (userRoleObj?.ToString() == "admin")
        {
            var allOrders = await _orderService.GetAllOrdersAsync(pageNumber, pageSize);
            return Ok(allOrders);
        }

        var userId = (int)userIdObj;
        var userOrders = await _orderService.GetUserOrdersAsync(userId, pageNumber, pageSize);
        return Ok(userOrders);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<OrderDto>> GetOrderById(int id)
    {
        // Check if user is authenticated
        var userIdObj = HttpContext.Items["UserId"];
        if (userIdObj == null)
            return Unauthorized(new { message = "User not authenticated" });

        var order = await _orderService.GetOrderByIdAsync(id);
        if (order == null)
            return NotFound(new { message = "Order not found" });

        // Check authorization
        var currentUserId = (int)userIdObj;
        var userRoleObj = HttpContext.Items["UserRole"];
        if (currentUserId != order.UserId && userRoleObj?.ToString() != "admin")
            return Forbid();

        return Ok(order);
    }

    [HttpPost]
    public async Task<ActionResult<OrderDto>> CreateOrder(CreateOrderRequest request)
    {
        // Check if user is authenticated
        var userIdObj = HttpContext.Items["UserId"];
        if (userIdObj == null)
            return Unauthorized(new { message = "User not authenticated" });

        if (string.IsNullOrWhiteSpace(request.OrderNumber) || request.TotalAmount <= 0)
            return BadRequest(new { message = "OrderNumber and TotalAmount are required and TotalAmount must be greater than 0" });

        var userId = (int)userIdObj;
        var order = await _orderService.CreateOrderAsync(userId, request);
        return CreatedAtAction(nameof(GetOrderById), new { id = order.OrderId }, order);
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<OrderDto>> UpdateOrder(int id, UpdateOrderRequest request)
    {
        // Check if user is authenticated
        var userIdObj = HttpContext.Items["UserId"];
        if (userIdObj == null)
            return Unauthorized(new { message = "User not authenticated" });

        var order = await _orderService.GetOrderByIdAsync(id);
        if (order == null)
            return NotFound(new { message = "Order not found" });

        // Check authorization
        var currentUserId = (int)userIdObj;
        var userRoleObj = HttpContext.Items["UserRole"];
        if (currentUserId != order.UserId && userRoleObj?.ToString() != "admin")
            return Forbid();

        var updatedOrder = await _orderService.UpdateOrderAsync(id, request);
        return Ok(updatedOrder);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteOrder(int id)
    {
        // Check if user is authenticated
        var userIdObj = HttpContext.Items["UserId"];
        if (userIdObj == null)
            return Unauthorized(new { message = "User not authenticated" });

        var order = await _orderService.GetOrderByIdAsync(id);
        if (order == null)
            return NotFound(new { message = "Order not found" });

        // Check authorization
        var currentUserId = (int)userIdObj;
        var userRoleObj = HttpContext.Items["UserRole"];
        if (currentUserId != order.UserId && userRoleObj?.ToString() != "admin")
            return Forbid();

        var success = await _orderService.DeleteOrderAsync(id);
        if (!success)
            return BadRequest(new { message = "Failed to delete order" });

        return NoContent();
    }
}
