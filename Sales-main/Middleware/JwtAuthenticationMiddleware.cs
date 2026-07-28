using System.IdentityModel.Tokens.Jwt;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Sales.Middleware;

public class JwtAuthenticationMiddleware
{
    private readonly RequestDelegate _next;
    private readonly string _jwtSecret;

    public JwtAuthenticationMiddleware(RequestDelegate next, IConfiguration configuration)
    {
        _next = next;
        _jwtSecret = configuration["Jwt:Secret"] ?? string.Empty;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var token = context.Request.Headers["Authorization"].FirstOrDefault()?.Split(" ").Last();

        if (!string.IsNullOrEmpty(token))
        {
            AttachUserToContext(context, token);
        }

        await _next(context);
    }

    private void AttachUserToContext(HttpContext context, string token)
    {
        try
        {
            var tokenHandler = new JwtSecurityTokenHandler();
            var key = Encoding.ASCII.GetBytes(_jwtSecret);

            tokenHandler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(key),
                ValidateIssuer = false,
                ValidateAudience = false,
                ClockSkew = TimeSpan.Zero
            }, out SecurityToken validatedToken);

            var jwtToken = (JwtSecurityToken)validatedToken;
            var userId = jwtToken.Claims.First(x => x.Type == "userId").Value;
            var userRole = jwtToken.Claims.First(x => x.Type == "role").Value;

            context.Items["UserId"] = int.Parse(userId);
            context.Items["UserRole"] = userRole;
        }
        catch
        {
            // Invalid token, user will not be attached
        }
    }
}
