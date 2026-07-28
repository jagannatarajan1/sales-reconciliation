using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Sales.Data;
using Sales.DTOs;
using Sales.Models;

namespace Sales.Services;

public interface IGmailService
{
    string BuildConsentUrl(string state);
    Task<bool> HandleOAuthCallbackAsync(string code, int adminUserId);
    Task<GmailStatusDto> GetStatusAsync();
    Task<string?> GetValidAccessTokenAsync();
    Task<ZReportEmailDto?> FindZReportEmailAsync(DateTime targetDate);
}

public class GmailService : IGmailService
{
    private readonly SalesDbContext _context;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;

    private const string TokenEndpoint = "https://oauth2.googleapis.com/token";
    private const string AuthEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
    private const string GmailApiBase = "https://gmail.googleapis.com/gmail/v1/users/me";

    public GmailService(SalesDbContext context, IHttpClientFactory httpClientFactory, IConfiguration configuration)
    {
        _context = context;
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
    }

    public string BuildConsentUrl(string state)
    {
        var clientId = _configuration["Gmail:ClientId"] ?? string.Empty;
        var redirectUri = _configuration["Gmail:RedirectUri"] ?? string.Empty;

        var query = new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["redirect_uri"] = redirectUri,
            ["response_type"] = "code",
            ["scope"] = "https://www.googleapis.com/auth/gmail.readonly",
            ["access_type"] = "offline",
            ["prompt"] = "consent",
            ["state"] = state
        };

        var queryString = string.Join("&", query.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
        return $"{AuthEndpoint}?{queryString}";
    }

    public async Task<bool> HandleOAuthCallbackAsync(string code, int adminUserId)
    {
        var clientId = _configuration["Gmail:ClientId"] ?? string.Empty;
        var clientSecret = _configuration["Gmail:ClientSecret"] ?? string.Empty;
        var redirectUri = _configuration["Gmail:RedirectUri"] ?? string.Empty;

        var httpClient = _httpClientFactory.CreateClient();
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["code"] = code,
            ["client_id"] = clientId,
            ["client_secret"] = clientSecret,
            ["redirect_uri"] = redirectUri,
            ["grant_type"] = "authorization_code"
        });

        var tokenResponse = await httpClient.PostAsync(TokenEndpoint, form);
        if (!tokenResponse.IsSuccessStatusCode)
            return false;

        var tokenJson = await tokenResponse.Content.ReadAsStringAsync();
        var tokens = JsonSerializer.Deserialize<GoogleTokenResponse>(tokenJson);
        if (tokens == null || string.IsNullOrEmpty(tokens.AccessToken) || string.IsNullOrEmpty(tokens.RefreshToken))
            return false;

        var profileRequest = new HttpRequestMessage(HttpMethod.Get, $"{GmailApiBase}/profile");
        profileRequest.Headers.Add("Authorization", $"Bearer {tokens.AccessToken}");
        var profileResponse = await httpClient.SendAsync(profileRequest);
        if (!profileResponse.IsSuccessStatusCode)
            return false;

        var profileJson = await profileResponse.Content.ReadAsStringAsync();
        var profile = JsonSerializer.Deserialize<GoogleProfileResponse>(profileJson);
        if (profile == null || string.IsNullOrEmpty(profile.EmailAddress))
            return false;

        var existingConnections = await _context.GmailConnections.Where(c => c.IsActive).ToListAsync();
        foreach (var existing in existingConnections)
        {
            existing.IsActive = false;
            existing.UpdatedAt = DateTime.UtcNow;
        }

        _context.GmailConnections.Add(new GmailConnection
        {
            EmailAddress = profile.EmailAddress,
            RefreshToken = tokens.RefreshToken,
            AccessToken = tokens.AccessToken,
            AccessTokenExpiresAt = DateTime.UtcNow.AddSeconds(tokens.ExpiresIn),
            ConnectedByUserId = adminUserId,
            IsActive = true
        });

        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<GmailStatusDto> GetStatusAsync()
    {
        var connection = await GetActiveConnectionAsync();
        if (connection == null)
            return new GmailStatusDto { IsConnected = false };

        return new GmailStatusDto
        {
            IsConnected = true,
            EmailAddress = connection.EmailAddress,
            ConnectedAt = connection.ConnectedAt
        };
    }

    public async Task<string?> GetValidAccessTokenAsync()
    {
        var connection = await GetActiveConnectionAsync();
        if (connection == null)
            return null;

        if (!string.IsNullOrEmpty(connection.AccessToken) &&
            connection.AccessTokenExpiresAt.HasValue &&
            connection.AccessTokenExpiresAt.Value > DateTime.UtcNow.AddSeconds(60))
        {
            return connection.AccessToken;
        }

        var clientId = _configuration["Gmail:ClientId"] ?? string.Empty;
        var clientSecret = _configuration["Gmail:ClientSecret"] ?? string.Empty;

        var httpClient = _httpClientFactory.CreateClient();
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["client_secret"] = clientSecret,
            ["refresh_token"] = connection.RefreshToken,
            ["grant_type"] = "refresh_token"
        });

        var refreshResponse = await httpClient.PostAsync(TokenEndpoint, form);
        if (!refreshResponse.IsSuccessStatusCode)
            return null;

        var refreshJson = await refreshResponse.Content.ReadAsStringAsync();
        var refreshed = JsonSerializer.Deserialize<GoogleTokenResponse>(refreshJson);
        if (refreshed == null || string.IsNullOrEmpty(refreshed.AccessToken))
            return null;

        connection.AccessToken = refreshed.AccessToken;
        connection.AccessTokenExpiresAt = DateTime.UtcNow.AddSeconds(refreshed.ExpiresIn);
        connection.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();

        return connection.AccessToken;
    }

    public async Task<ZReportEmailDto?> FindZReportEmailAsync(DateTime targetDate)
    {
        var accessToken = await GetValidAccessTokenAsync();
        if (accessToken == null)
            return null;

        var senderEmail = _configuration["Gmail:SenderEmail"] ?? string.Empty;
        var afterDate = targetDate.Date.ToString("yyyy/MM/dd");
        var beforeDate = targetDate.Date.AddDays(1).ToString("yyyy/MM/dd");
        var query = string.IsNullOrEmpty(senderEmail)
            ? $"after:{afterDate} before:{beforeDate}"
            : $"from:{senderEmail} after:{afterDate} before:{beforeDate}";

        var httpClient = _httpClientFactory.CreateClient();
        var listRequest = new HttpRequestMessage(HttpMethod.Get, $"{GmailApiBase}/messages?q={Uri.EscapeDataString(query)}");
        listRequest.Headers.Add("Authorization", $"Bearer {accessToken}");
        var listResponse = await httpClient.SendAsync(listRequest);
        if (!listResponse.IsSuccessStatusCode)
            return null;

        var listJson = await listResponse.Content.ReadAsStringAsync();
        var listResult = JsonSerializer.Deserialize<GoogleMessageListResponse>(listJson);
        var firstMessageId = listResult?.Messages?.FirstOrDefault()?.Id;
        if (string.IsNullOrEmpty(firstMessageId))
            return null;

        var getRequest = new HttpRequestMessage(HttpMethod.Get, $"{GmailApiBase}/messages/{firstMessageId}?format=full");
        getRequest.Headers.Add("Authorization", $"Bearer {accessToken}");
        var getResponse = await httpClient.SendAsync(getRequest);
        if (!getResponse.IsSuccessStatusCode)
            return null;

        var messageJson = await getResponse.Content.ReadAsStringAsync();
        using var messageDoc = JsonDocument.Parse(messageJson);
        var root = messageDoc.RootElement;

        var body = ExtractPlainTextBody(root.TryGetProperty("payload", out var payload) ? payload : default) ?? string.Empty;

        var emailDate = targetDate.Date;
        if (root.TryGetProperty("internalDate", out var internalDateElement) &&
            long.TryParse(internalDateElement.GetString(), out var internalDateMs))
        {
            emailDate = DateTimeOffset.FromUnixTimeMilliseconds(internalDateMs).UtcDateTime;
        }

        return new ZReportEmailDto { Date = emailDate, Body = body };
    }

    private async Task<GmailConnection?> GetActiveConnectionAsync()
    {
        return await _context.GmailConnections
            .Where(c => c.IsActive)
            .OrderByDescending(c => c.ConnectedAt)
            .FirstOrDefaultAsync();
    }

    private static string? ExtractPlainTextBody(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object)
            return null;

        if (payload.TryGetProperty("mimeType", out var mimeTypeElement) &&
            mimeTypeElement.GetString() == "text/plain" &&
            payload.TryGetProperty("body", out var bodyElement) &&
            bodyElement.TryGetProperty("data", out var dataElement))
        {
            return DecodeBase64Url(dataElement.GetString() ?? string.Empty);
        }

        if (payload.TryGetProperty("parts", out var partsElement) && partsElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var part in partsElement.EnumerateArray())
            {
                var extracted = ExtractPlainTextBody(part);
                if (!string.IsNullOrEmpty(extracted))
                    return extracted;
            }
        }

        return null;
    }

    private static string DecodeBase64Url(string data)
    {
        var base64 = data.Replace('-', '+').Replace('_', '/');
        var padding = base64.Length % 4;
        if (padding > 0)
            base64 += new string('=', 4 - padding);

        var bytes = Convert.FromBase64String(base64);
        return Encoding.UTF8.GetString(bytes);
    }

    private class GoogleTokenResponse
    {
        [JsonPropertyName("access_token")]
        public string AccessToken { get; set; } = string.Empty;

        [JsonPropertyName("refresh_token")]
        public string? RefreshToken { get; set; }

        [JsonPropertyName("expires_in")]
        public int ExpiresIn { get; set; }
    }

    private class GoogleProfileResponse
    {
        [JsonPropertyName("emailAddress")]
        public string EmailAddress { get; set; } = string.Empty;
    }

    private class GoogleMessageListResponse
    {
        [JsonPropertyName("messages")]
        public List<GoogleMessageRef>? Messages { get; set; }
    }

    private class GoogleMessageRef
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = string.Empty;
    }
}
