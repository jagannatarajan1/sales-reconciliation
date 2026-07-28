using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Sales.DTOs;
using Sales.Services;

namespace Sales.Controllers;

[ApiController]
[Route("api/gmail")]
public class GmailController : ControllerBase
{
    private readonly IGmailService _gmailService;
    private readonly IConfiguration _configuration;

    public GmailController(IGmailService gmailService, IConfiguration configuration)
    {
        _gmailService = gmailService;
        _configuration = configuration;
    }

    [HttpGet("connect")]
    public IActionResult Connect()
    {
        var userIdObj = HttpContext.Items["UserId"];
        var userRoleObj = HttpContext.Items["UserRole"];
        if (userIdObj == null)
            return Unauthorized(new { message = "User not authenticated" });
        if (userRoleObj?.ToString() != "admin")
            return Forbid();

        var adminUserId = (int)userIdObj;
        var state = CreateSignedState(adminUserId);
        var consentUrl = _gmailService.BuildConsentUrl(state);
        return Redirect(consentUrl);
    }

    [HttpGet("callback")]
    public async Task<IActionResult> Callback([FromQuery] string? code, [FromQuery] string? state, [FromQuery] string? error)
    {
        var frontendBaseUrl = _configuration["Gmail:FrontendBaseUrl"] ?? string.Empty;

        if (!string.IsNullOrEmpty(error))
            return BadRequest(new { message = "Gmail connection was cancelled or denied." });

        if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state))
            return BadRequest(new { message = "Missing authorization code or state." });

        var adminUserId = TryValidateSignedState(state);
        if (adminUserId == null)
            return BadRequest(new { message = "Invalid or expired connection request. Please try connecting again." });

        var success = await _gmailService.HandleOAuthCallbackAsync(code, adminUserId.Value);
        if (!success)
            return BadRequest(new { message = "Failed to connect Gmail account. Please try again." });

        if (!string.IsNullOrEmpty(frontendBaseUrl))
            return Redirect($"{frontendBaseUrl}/admin/dashboard?gmail=connected");

        return Ok(new { message = "Gmail account connected successfully." });
    }

    [HttpGet("status")]
    public async Task<ActionResult<GmailStatusDto>> Status()
    {
        var userIdObj = HttpContext.Items["UserId"];
        var userRoleObj = HttpContext.Items["UserRole"];
        if (userIdObj == null)
            return Unauthorized(new { message = "User not authenticated" });
        if (userRoleObj?.ToString() != "admin")
            return Forbid();

        var status = await _gmailService.GetStatusAsync();
        return Ok(status);
    }

    // Self-contained, signed "state" value: proves which admin started the connect flow
    // without needing a separate server-side store, since this is a single-admin,
    // low-frequency, internal-only flow (not a public multi-tenant OAuth surface).
    private string CreateSignedState(int adminUserId)
    {
        var jwtSecret = _configuration["Jwt:Secret"] ?? string.Empty;
        var nonce = Guid.NewGuid().ToString("N");
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var payload = $"{adminUserId}.{nonce}.{timestamp}";
        var signature = SignPayload(payload, jwtSecret);
        return $"{payload}.{signature}";
    }

    private int? TryValidateSignedState(string state)
    {
        var jwtSecret = _configuration["Jwt:Secret"] ?? string.Empty;
        var parts = state.Split('.');
        if (parts.Length != 4)
            return null;

        var adminUserIdPart = parts[0];
        var noncePart = parts[1];
        var timestampPart = parts[2];
        var signaturePart = parts[3];

        var payload = $"{adminUserIdPart}.{noncePart}.{timestampPart}";
        var expectedSignature = SignPayload(payload, jwtSecret);
        if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(signaturePart), Encoding.UTF8.GetBytes(expectedSignature)))
            return null;

        if (!long.TryParse(timestampPart, out var timestamp))
            return null;

        var age = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - timestamp;
        if (age is < 0 or > 600) // state is only valid for 10 minutes
            return null;

        return int.TryParse(adminUserIdPart, out var adminUserId) ? adminUserId : null;
    }

    private static string SignPayload(string payload, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(payload));
        return Convert.ToHexString(hash);
    }
}
