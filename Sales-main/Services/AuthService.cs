using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using Sales.DTOs;
using Sales.Models;

namespace Sales.Services;

public interface IAuthService
{
    string HashPassword(string password);
    bool VerifyPassword(string password, string hash);
    string GenerateJwtToken(User user, string jwtSecret, string jwtIssuer, string jwtAudience);
    int? ValidateJwtToken(string token, string jwtSecret);
}

public class AuthService : IAuthService
{
    public string HashPassword(string password)
    {
        using (var sha256 = SHA256.Create())
        {
            var hashedBytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(password));
            return Convert.ToBase64String(hashedBytes);
        }
    }

    public bool VerifyPassword(string password, string hash)
    {
        var hashOfInput = HashPassword(password);
        return hashOfInput.Equals(hash);
    }

    public string GenerateJwtToken(User user, string jwtSecret, string jwtIssuer, string jwtAudience)
    {
        var tokenHandler = new JwtSecurityTokenHandler();
        var key = Encoding.ASCII.GetBytes(jwtSecret);

        var tokenDescriptor = new SecurityTokenDescriptor
        {
            Subject = new System.Security.Claims.ClaimsIdentity(new[]
            {
                new System.Security.Claims.Claim("userId", user.UserId.ToString()),
                new System.Security.Claims.Claim("email", user.Email),
                new System.Security.Claims.Claim("role", user.Role),
                new System.Security.Claims.Claim("name", user.Name)
            }),
            Expires = DateTime.UtcNow.AddHours(24),
            Issuer = jwtIssuer,
            Audience = jwtAudience,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(key), SecurityAlgorithms.HmacSha256Signature)
        };

        var token = tokenHandler.CreateToken(tokenDescriptor);
        return tokenHandler.WriteToken(token);
    }

    public int? ValidateJwtToken(string token, string jwtSecret)
    {
        try
        {
            var tokenHandler = new JwtSecurityTokenHandler();
            var key = Encoding.ASCII.GetBytes(jwtSecret);

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

            return int.Parse(userId);
        }
        catch
        {
            return null;
        }
    }
}
