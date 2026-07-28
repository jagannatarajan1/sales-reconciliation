namespace Sales.Models;

public class GmailConnection
{
    public int GmailConnectionId { get; set; }
    public string EmailAddress { get; set; } = string.Empty;
    public string RefreshToken { get; set; } = string.Empty;
    public string? AccessToken { get; set; }
    public DateTime? AccessTokenExpiresAt { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime ConnectedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Foreign key
    public int ConnectedByUserId { get; set; }
    public User? ConnectedByUser { get; set; }
}
