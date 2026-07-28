using Microsoft.EntityFrameworkCore;
using Sales.Models;

namespace Sales.Data;

public class SalesDbContext : DbContext
{
    public SalesDbContext(DbContextOptions<SalesDbContext> options) : base(options)
    {
    }

    public DbSet<User> Users { get; set; } = null!;
    public DbSet<Order> Orders { get; set; } = null!;
    public DbSet<GmailConnection> GmailConnections { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // User configuration
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(e => e.UserId);
            entity.Property(e => e.Email).IsRequired().HasMaxLength(255);
            entity.Property(e => e.PasswordHash).IsRequired();
            entity.Property(e => e.Name).IsRequired().HasMaxLength(255);
            entity.Property(e => e.Role).IsRequired().HasMaxLength(50);
            entity.HasIndex(e => e.Email).IsUnique();
            entity.HasMany(e => e.Orders).WithOne(o => o.User).HasForeignKey(o => o.UserId);
        });

        // Order configuration
        modelBuilder.Entity<Order>(entity =>
        {
            entity.HasKey(e => e.OrderId);
            entity.Property(e => e.OrderNumber).IsRequired().HasMaxLength(100);
            entity.Property(e => e.Status).IsRequired().HasMaxLength(50);
            entity.Property(e => e.TotalAmount).HasPrecision(18, 2);
            entity.HasOne(e => e.User).WithMany(u => u.Orders).HasForeignKey(e => e.UserId);
        });

        // GmailConnection configuration
        modelBuilder.Entity<GmailConnection>(entity =>
        {
            entity.HasKey(e => e.GmailConnectionId);
            entity.Property(e => e.EmailAddress).IsRequired().HasMaxLength(255);
            entity.Property(e => e.RefreshToken).IsRequired();
            entity.HasOne(e => e.ConnectedByUser).WithMany().HasForeignKey(e => e.ConnectedByUserId);
        });
    }
}
