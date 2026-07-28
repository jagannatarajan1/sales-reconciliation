using Microsoft.EntityFrameworkCore;
using Sales.Data;
using Sales.DTOs;
using Sales.Models;

namespace Sales.Services;

public interface IUserService
{
    Task<UserDto?> RegisterAsync(RegisterRequest request, IAuthService authService);
    Task<(UserDto? User, string? Error)> LoginAsync(LoginRequest request, IAuthService authService);
    Task<UserDto?> GetUserByIdAsync(int userId);
    Task<UserDto?> GetCurrentUserAsync(int userId);
    Task<PaginatedResponse<UserDto>> GetAllUsersAsync(int pageNumber = 1, int pageSize = 10);
}

public class UserService : IUserService
{
    private readonly SalesDbContext _context;

    public UserService(SalesDbContext context)
    {
        _context = context;
    }

    public async Task<UserDto?> RegisterAsync(RegisterRequest request, IAuthService authService)
    {
        // Check if user already exists
        var existingUser = await _context.Users.FirstOrDefaultAsync(u => u.Email == request.Email);
        if (existingUser != null)
            return null;

        var user = new User
        {
            Email = request.Email,
            PasswordHash = authService.HashPassword(request.Password),
            Name = request.Name,
            Role = request.Role,
            IsActive = true
        };

        _context.Users.Add(user);
        await _context.SaveChangesAsync();

        return MapToUserDto(user);
    }

    public async Task<(UserDto? User, string? Error)> LoginAsync(LoginRequest request, IAuthService authService)
    {
        var user = await _context.Users.FirstOrDefaultAsync(u => u.Email == request.Email && u.IsActive);
        
        if (user == null)
            return (null, "Invalid email or password");

        if (!authService.VerifyPassword(request.Password, user.PasswordHash))
            return (null, "Invalid email or password");

        return (MapToUserDto(user), null);
    }

    public async Task<UserDto?> GetUserByIdAsync(int userId)
    {
        var user = await _context.Users.FirstOrDefaultAsync(u => u.UserId == userId && u.IsActive);
        return user != null ? MapToUserDto(user) : null;
    }

    public async Task<UserDto?> GetCurrentUserAsync(int userId)
    {
        var user = await _context.Users.FirstOrDefaultAsync(u => u.UserId == userId);
        return user != null ? MapToUserDto(user) : null;
    }

    public async Task<PaginatedResponse<UserDto>> GetAllUsersAsync(int pageNumber = 1, int pageSize = 10)
    {
        var query = _context.Users.Where(u => u.IsActive);
        var totalCount = await query.CountAsync();
        
        var users = await query
            .Skip((pageNumber - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        return new PaginatedResponse<UserDto>
        {
            Items = users.Select(MapToUserDto).ToList(),
            TotalCount = totalCount,
            PageNumber = pageNumber,
            PageSize = pageSize
        };
    }

    private static UserDto MapToUserDto(User user)
    {
        return new UserDto
        {
            UserId = user.UserId,
            Email = user.Email,
            Name = user.Name,
            Role = user.Role,
            CreatedAt = user.CreatedAt,
            IsActive = user.IsActive
        };
    }
}
