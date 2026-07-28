# Sales Reconciliation API

A complete ASP.NET Core Web API backend for Sales Reconciliation with JWT authentication, role-based authorization, and Entity Framework Core.

## Prerequisites

- .NET 8 SDK
- SQL Server 2019 or later
- Visual Studio Code or Visual Studio 2022

## Setup Instructions

### 1. Install Dependencies

Open the terminal in the project directory and run:

```bash
dotnet restore
```

### 2. Configure Database Connection

Edit `appsettings.json` and update the connection string if needed:

```json
"ConnectionStrings": {
  "DefaultConnection": "Server=.;Database=SalesReconciliation;Trusted_Connection=true;Encrypt=false;"
}
```

For Azure SQL or other SQL Server instances, use the appropriate connection string format.

### 3. Configure JWT Secret

In `appsettings.json`, change the JWT secret to a secure value:

```json
"Jwt": {
  "Secret": "your-very-long-and-secure-secret-key-at-least-32-characters-long!",
  "Issuer": "SalesReconciliationApp",
  "Audience": "SalesReconciliationClient",
  "ExpirationMinutes": 1440
}
```

**⚠️ IMPORTANT**: In production, use environment variables for sensitive configuration.

### 4. Create Database and Apply Migrations

```bash
# Add initial migration
dotnet ef migrations add InitialCreate

# Apply migration to database
dotnet ef database update
```

If you haven't installed Entity Framework Core tools globally:

```bash
dotnet tool install --global dotnet-ef
```

### 5. Run the Application

```bash
dotnet run
```

The API will be available at:
- Development: `https://localhost:5001` or `http://localhost:5000`
- Swagger UI: `https://localhost:5001/swagger/index.html`

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login and get JWT token
- `GET /api/auth/me` - Get current user info (requires token)

### Users
- `GET /api/users` - List all users (admin only)
- `GET /api/users/{id}` - Get user by ID

### Orders
- `GET /api/orders` - Get orders (pagination: `?pageNumber=1&pageSize=10`)
- `GET /api/orders/{id}` - Get order by ID
- `POST /api/orders` - Create new order
- `PUT /api/orders/{id}` - Update order
- `DELETE /api/orders/{id}` - Delete order

## Authentication

### Register User

```bash
curl -X POST https://localhost:5001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!",
    "name": "John Doe",
    "role": "user"
  }'
```

### Login

```bash
curl -X POST https://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!"
  }'
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "userId": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "role": "user",
    "createdAt": "2024-01-01T00:00:00Z",
    "isActive": true
  }
}
```

### Using the Token

Include the token in the Authorization header:

```bash
curl -X GET https://localhost:5001/api/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## Project Structure

```
Sales/
├── Controllers/          # API endpoint handlers
│   ├── AuthController.cs
│   ├── UsersController.cs
│   └── OrdersController.cs
├── Data/                 # Entity Framework DbContext
│   └── SalesDbContext.cs
├── DTOs/                 # Data Transfer Objects
│   └── DtoModels.cs
├── Middleware/           # Custom middleware
│   ├── ErrorHandlingMiddleware.cs
│   └── JwtAuthenticationMiddleware.cs
├── Models/               # Data models
│   ├── User.cs
│   └── Order.cs
├── Services/             # Business logic
│   ├── AuthService.cs
│   ├── UserService.cs
│   └── OrderService.cs
├── Migrations/           # EF Core migrations (generated)
├── appsettings.json      # Configuration
├── Program.cs            # Application startup
└── Sales.csproj          # Project file
```

## Database Schema

### Users Table
- `UserId` (int, PK)
- `Email` (varchar, unique)
- `PasswordHash` (varchar)
- `Name` (varchar)
- `Role` (varchar) - 'user' or 'admin'
- `CreatedAt` (datetime)
- `UpdatedAt` (datetime)
- `IsActive` (bit)

### Orders Table
- `OrderId` (int, PK)
- `UserId` (int, FK)
- `OrderNumber` (varchar)
- `OrderDate` (datetime)
- `TotalAmount` (decimal)
- `Status` (varchar) - 'pending', 'completed', 'cancelled'
- `CreatedAt` (datetime)
- `UpdatedAt` (datetime)

## Features

✅ **JWT Authentication** - Secure token-based authentication
✅ **Role-Based Authorization** - User and Admin roles
✅ **Entity Framework Core** - ORM for database operations
✅ **SQL Server Integration** - Optimized for SQL Server
✅ **CORS Support** - Configured for React frontend
✅ **Error Handling Middleware** - Centralized error management
✅ **Pagination** - Built-in pagination for list endpoints
✅ **Password Hashing** - SHA-256 password hashing
✅ **Swagger Documentation** - Interactive API documentation

## CORS Configuration

The API is configured to accept requests from:
- `http://localhost:5173` (Vue/Vite development server)
- `http://localhost:3000` (React development server)

Update `appsettings.json` to add or modify allowed origins.

## Security Notes

1. **JWT Secret**: Use a strong, randomly generated secret in production
2. **HTTPS**: Always use HTTPS in production
3. **Password Storage**: Passwords are hashed with SHA-256 (upgrade to bcrypt for production)
4. **Database**: Use SQL Server authentication in production
5. **Environment Variables**: Store sensitive config in environment variables, not appsettings.json

## Testing the API

Use Swagger UI at `https://localhost:5001/swagger` or Postman:

1. Register a new user
2. Login to get token
3. Add token to Authorization header: `Bearer {token}`
4. Make authenticated requests

## Troubleshooting

### Database Connection Error
- Verify SQL Server is running
- Check connection string in `appsettings.json`
- Ensure database user has appropriate permissions

### Migration Error
```bash
# Remove last migration if needed
dotnet ef migrations remove

# Or delete database and recreate
dotnet ef database drop
dotnet ef database update
```

### JWT Token Issues
- Verify JWT secret matches between token generation and validation
- Check token expiration time
- Ensure Authorization header format: `Bearer {token}`

## License

MIT License - See LICENSE file for details
