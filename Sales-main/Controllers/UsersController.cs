using Microsoft.AspNetCore.Mvc;
using Sales.DTOs;
using Sales.Services;

namespace Sales.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    private readonly IUserService _userService;

    public UsersController(IUserService userService)
    {
        _userService = userService;
    }

    [HttpGet]
    public async Task<ActionResult<PaginatedResponse<UserDto>>> GetAllUsers([FromQuery] int pageNumber = 1, [FromQuery] int pageSize = 10)
    {
        // Check if user is admin
        var userRoleObj = HttpContext.Items["UserRole"];
        if (userRoleObj?.ToString() != "admin")
            return Forbid();

        var result = await _userService.GetAllUsersAsync(pageNumber, pageSize);
        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<UserDto>> GetUserById(int id)
    {
        // Check if user is authenticated
        var userIdObj = HttpContext.Items["UserId"];
        if (userIdObj == null)
            return Unauthorized(new { message = "User not authenticated" });

        // Users can only see their own profile unless they're admin
        var currentUserId = (int)userIdObj;
        var userRoleObj = HttpContext.Items["UserRole"];
        if (currentUserId != id && userRoleObj?.ToString() != "admin")
            return Forbid();

        var user = await _userService.GetUserByIdAsync(id);
        if (user == null)
            return NotFound(new { message = "User not found" });

        return Ok(user);
    }
}
