namespace Sales.DTOs;

public class RegisterRequest
{
    public string Email { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Role { get; set; } = "user";
}

public class LoginRequest
{
    public string Email { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public class AuthResponse
{
    public string Token { get; set; } = string.Empty;
    public UserDto User { get; set; } = new();
}

public class UserDto
{
    public int UserId { get; set; }
    public string Email { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public bool IsActive { get; set; }
}

public class CreateOrderRequest
{
    public string OrderNumber { get; set; } = string.Empty;
    public DateTime OrderDate { get; set; }
    public decimal TotalAmount { get; set; }
    public string Status { get; set; } = "pending";
}

public class UpdateOrderRequest
{
    public string? OrderNumber { get; set; }
    public DateTime? OrderDate { get; set; }
    public decimal? TotalAmount { get; set; }
    public string? Status { get; set; }
}

public class OrderDto
{
    public int OrderId { get; set; }
    public int UserId { get; set; }
    public string OrderNumber { get; set; } = string.Empty;
    public DateTime OrderDate { get; set; }
    public decimal TotalAmount { get; set; }
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class PaginatedResponse<T>
{
    public List<T> Items { get; set; } = new();
    public int TotalCount { get; set; }
    public int PageNumber { get; set; }
    public int PageSize { get; set; }
}

public class GmailStatusDto
{
    public bool IsConnected { get; set; }
    public string? EmailAddress { get; set; }
    public DateTime? ConnectedAt { get; set; }
}

public class ZReportEmailDto
{
    public DateTime Date { get; set; }
    public string Body { get; set; } = string.Empty;
}

public class ZReportResponse
{
    public bool IsCommitted { get; set; }
    public string? Message { get; set; }
    public DateTime TargetDate { get; set; }
    public ZReportEmailDto? Email { get; set; }
}

public class TodaySummaryResponse
{
    public bool IsCommitted { get; set; }
    public string? Message { get; set; }
}
