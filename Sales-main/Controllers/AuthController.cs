using Microsoft.AspNetCore.Mvc;
using Sales.DTOs;
using Sales.Services;

namespace Sales.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly IUserService _userService;
    private readonly IAuthService _authService;
    private readonly IConfiguration _configuration;

    public AuthController(IUserService userService, IAuthService authService, IConfiguration configuration)
    {
        _userService = userService;
        _authService = authService;
        _configuration = configuration;
    }

    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password) || string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { message = "Email, password, and name are required" });

        var user = await _userService.RegisterAsync(request, _authService);
        if (user == null)
            return BadRequest(new { message = "User with this email already exists" });

        var token = _authService.GenerateJwtToken(
            new Sales.Models.User 
            { 
                UserId = user.UserId, 
                Email = user.Email, 
                Name = user.Name, 
                Role = user.Role 
            },
            _configuration["Jwt:Secret"] ?? string.Empty,
            _configuration["Jwt:Issuer"] ?? string.Empty,
            _configuration["Jwt:Audience"] ?? string.Empty
        );

        return Ok(new AuthResponse { Token = token, User = user });
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { message = "Email and password are required" });

        var (user, error) = await _userService.LoginAsync(request, _authService);
        if (user == null)
            return Unauthorized(new { message = error });

        var token = _authService.GenerateJwtToken(
            new Sales.Models.User 
            { 
                UserId = user.UserId, 
                Email = user.Email, 
                Name = user.Name, 
                Role = user.Role 
            },
            _configuration["Jwt:Secret"] ?? string.Empty,
            _configuration["Jwt:Issuer"] ?? string.Empty,
            _configuration["Jwt:Audience"] ?? string.Empty
        );

        return Ok(new AuthResponse { Token = token, User = user });
    }

    [HttpGet("me")]
    public async Task<ActionResult<UserDto>> GetCurrentUser()
    {
        var userIdObj = HttpContext.Items["UserId"];
        if (userIdObj == null)
            return Unauthorized(new { message = "User not authenticated" });

        var userId = (int)userIdObj;
        var user = await _userService.GetCurrentUserAsync(userId);
        if (user == null)
            return NotFound(new { message = "User not found" });

        return Ok(user);
    }
}
