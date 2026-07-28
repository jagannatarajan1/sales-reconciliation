# Backend API Specification - Gmail OAuth Integration

## Overview

This document specifies the backend API endpoints required for Gmail OAuth integration in the Sales Reconciliation application.

## Authentication

All endpoints (except OAuth callback) require a valid JWT Bearer token in the `Authorization` header:

```
Authorization: Bearer {jwt_token}
```

For Gmail-specific operations, pass the Gmail access token in the same header when making requests from the frontend.

## Endpoints

### 1. Exchange Authorization Code for Access Token

**Endpoint:** `POST /api/gmail/exchange-code`

**Purpose:** Exchange the authorization code received from Google for an access token and optional refresh token.

**Request Headers:**
```
Content-Type: application/json
Authorization: Bearer {jwt_token}
```

**Request Body:**
```json
{
  "code": "4/0AX4XfWjzTQh...",
  "redirectUri": "http://localhost:5173/shop-sale",
  "userId": "user-123"
}
```

**Response (200 OK):**
```json
{
  "accessToken": "ya29.a0AfH6SMBx...",
  "refreshToken": "1//0gx...",
  "expiresIn": 3599,
  "tokenType": "Bearer"
}
```

**Response (400 Bad Request):**
```json
{
  "message": "Invalid authorization code",
  "error": "invalid_grant"
}
```

**Response (401 Unauthorized):**
```json
{
  "message": "Unauthorized - JWT token invalid or expired"
}
```

**Implementation Notes:**
- Store refresh token securely for later use
- Validate `redirectUri` matches the registered OAuth redirect URI
- Associate access token with user for later operations
- Consider storing token expiry time for refresh logic

---

### 2. Fetch Gmail Messages

**Endpoint:** `GET /api/gmail/messages`

**Purpose:** Fetch a list of Gmail messages for the authenticated user.

**Request Headers:**
```
Authorization: Bearer {gmail_access_token}
```

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| userId | string | Yes | - | User ID from JWT token |
| maxResults | integer | No | 10 | Max messages to return (1-100) |
| pageToken | string | No | - | Token for pagination |
| q | string | No | - | Gmail search query filter |

**Example Request:**
```
GET /api/gmail/messages?userId=user-123&maxResults=20
```

**Response (200 OK):**
```json
{
  "messages": [
    {
      "id": "18a1234567890abcdef",
      "threadId": "18a1234567890abcdef",
      "from": "sales@company.com",
      "to": "user@example.com",
      "subject": "Daily Sales Report - Jan 01, 2024",
      "date": "2024-01-01T10:30:00Z",
      "snippet": "Today's sales summary: $5,000 in revenue...",
      "preview": "Daily Sales Report - Jan 01, 2024\n\nToday's sales summary: $5,000 in revenue across all channels...",
      "hasAttachment": true,
      "labels": ["INBOX", "UNREAD"],
      "internalDate": "1704110400000"
    },
    {
      "id": "18b2345678901bcdefg",
      "threadId": "18b2345678901bcdefg",
      "from": "reports@system.com",
      "to": "user@example.com",
      "subject": "Automated Sales Reconciliation",
      "date": "2024-01-01T09:15:00Z",
      "snippet": "Weekly reconciliation report attached...",
      "preview": "Automated Sales Reconciliation\n\nWeekly reconciliation report attached...",
      "hasAttachment": false,
      "labels": ["INBOX"],
      "internalDate": "1704106500000"
    }
  ],
  "nextPageToken": "NEXT_PAGE_TOKEN_HERE",
  "resultSizeEstimate": 145
}
```

**Response (401 Unauthorized):**
```json
{
  "message": "Gmail access token invalid or expired - please re-authorize"
}
```

**Response (403 Forbidden):**
```json
{
  "message": "User does not have permission to access this resource"
}
```

**Implementation Notes:**
- Use Gmail API v1 `users/me/messages/list` endpoint
- Extract message metadata from Gmail API response
- Parse email headers to get from/to/subject
- Use `snippet` or `preview` for message preview
- Return labels and internal date for additional context
- Support pagination with nextPageToken
- Handle rate limiting (100 requests/second for Gmail API)

---

### 3. Get Gmail Message Details

**Endpoint:** `GET /api/gmail/messages/{messageId}`

**Purpose:** Get full details of a specific Gmail message.

**Request Headers:**
```
Authorization: Bearer {gmail_access_token}
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| messageId | string | Gmail message ID |

**Query Parameters:**
| Parameter | Type | Required | Default |
|-----------|------|----------|---------|
| userId | string | Yes | - |

**Response (200 OK):**
```json
{
  "id": "18a1234567890abcdef",
  "threadId": "18a1234567890abcdef",
  "from": "sales@company.com",
  "to": "user@example.com",
  "subject": "Daily Sales Report - Jan 01, 2024",
  "date": "2024-01-01T10:30:00Z",
  "snippet": "Today's sales summary: $5,000 in revenue...",
  "body": "Full email body HTML or text...",
  "attachments": [
    {
      "mimeType": "application/pdf",
      "filename": "sales_report.pdf",
      "size": 250000
    }
  ],
  "labels": ["INBOX"],
  "internalDate": "1704110400000"
}
```

**Implementation Notes:**
- Use Gmail API `users/me/messages/get` endpoint with `format: 'full'`
- Parse email body from multipart MIME structure
- Extract attachments metadata
- Consider caching for performance

---

### 4. Import Gmail Messages

**Endpoint:** `POST /api/gmail/import`

**Purpose:** Import selected Gmail messages and extract sales data.

**Request Headers:**
```
Content-Type: application/json
Authorization: Bearer {gmail_access_token}
```

**Request Body:**
```json
{
  "messageIds": [
    "18a1234567890abcdef",
    "18b2345678901bcdefg"
  ],
  "userId": "user-123"
}
```

**Response (200 OK):**
```json
{
  "importedCount": 2,
  "failedCount": 0,
  "timestamp": "2024-01-01T12:00:00Z",
  "processedMessages": [
    {
      "messageId": "18a1234567890abcdef",
      "status": "success",
      "subject": "Daily Sales Report - Jan 01, 2024",
      "from": "sales@company.com",
      "extractedData": {
        "salesAmount": 5000.00,
        "transactionCount": 45,
        "source": "email",
        "category": "daily_report",
        "parsedFields": {
          "revenue": 5000.00,
          "transactions": 45,
          "period": "2024-01-01"
        }
      },
      "savedRecordId": "record-123"
    },
    {
      "messageId": "18b2345678901bcdefg",
      "status": "success",
      "subject": "Automated Sales Reconciliation",
      "from": "reports@system.com",
      "extractedData": {
        "salesAmount": 12500.00,
        "transactionCount": 120,
        "source": "email",
        "category": "reconciliation"
      },
      "savedRecordId": "record-124"
    }
  ]
}
```

**Response (400 Bad Request):**
```json
{
  "message": "Invalid request data",
  "errors": [
    "messageIds must be a non-empty array",
    "userId is required"
  ]
}
```

**Response (207 Multi-Status):**
```json
{
  "importedCount": 1,
  "failedCount": 1,
  "processedMessages": [
    {
      "messageId": "18a1234567890abcdef",
      "status": "success",
      "extractedData": {...}
    },
    {
      "messageId": "18b2345678901bcdefg",
      "status": "failed",
      "error": "Could not parse sales data from message"
    }
  ]
}
```

**Implementation Notes:**
- Process each message sequentially or in parallel
- Extract sales-related data from email body
- Parse attachments if they contain data (CSV, JSON, etc.)
- Store extracted data in database
- Associate imports with user account
- Log failed imports for debugging
- Consider async processing for large batches
- Implement data validation before saving

---

### 5. Refresh Gmail Access Token

**Endpoint:** `POST /api/gmail/refresh-token`

**Purpose:** Refresh expired Gmail access token using refresh token.

**Request Headers:**
```
Content-Type: application/json
Authorization: Bearer {jwt_token}
```

**Request Body:**
```json
{
  "userId": "user-123"
}
```

**Response (200 OK):**
```json
{
  "accessToken": "ya29.a0AfH6SMBx...",
  "expiresIn": 3599,
  "tokenType": "Bearer"
}
```

**Response (401 Unauthorized):**
```json
{
  "message": "Refresh token invalid or expired - please re-authorize Gmail"
}
```

**Implementation Notes:**
- Retrieve stored refresh token for user
- Call Google OAuth API to refresh
- Update stored access token
- Return new access token
- Consider automatic refresh strategy

---

### 6. Revoke Gmail Authorization

**Endpoint:** `POST /api/gmail/revoke`

**Purpose:** Revoke Gmail access for the user.

**Request Headers:**
```
Authorization: Bearer {jwt_token}
```

**Request Body:**
```json
{
  "userId": "user-123"
}
```

**Response (200 OK):**
```json
{
  "message": "Gmail authorization revoked successfully",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

**Implementation Notes:**
- Delete stored access token and refresh token
- Call Google API to revoke token
- Clear any cached data
- Log the action for audit trail

---

## Error Responses

### Common Error Codes

| Code | Scenario | Response |
|------|----------|----------|
| 400 | Invalid request parameters | Bad Request |
| 401 | Invalid or expired JWT token | Unauthorized |
| 403 | User not authorized for resource | Forbidden |
| 404 | Message or resource not found | Not Found |
| 429 | Rate limit exceeded | Too Many Requests |
| 500 | Server error | Internal Server Error |

### Standard Error Response Format

```json
{
  "message": "Error description",
  "error": "error_code",
  "timestamp": "2024-01-01T12:00:00Z",
  "traceId": "trace-id-for-debugging"
}
```

---

## Data Models

### Gmail Message (Metadata)

```csharp
public class GmailMessage
{
    public string Id { get; set; }
    public string ThreadId { get; set; }
    public string From { get; set; }
    public string To { get; set; }
    public string Subject { get; set; }
    public DateTime Date { get; set; }
    public string Snippet { get; set; }
    public string Preview { get; set; }
    public bool HasAttachment { get; set; }
    public List<string> Labels { get; set; }
    public string InternalDate { get; set; }
}
```

### Imported Sales Record

```csharp
public class ImportedSalesRecord
{
    public string Id { get; set; }
    public string UserId { get; set; }
    public string MessageId { get; set; }
    public string Subject { get; set; }
    public string From { get; set; }
    public DateTime ImportedAt { get; set; }
    public decimal SalesAmount { get; set; }
    public int TransactionCount { get; set; }
    public Dictionary<string, object> ExtractedData { get; set; }
    public string RawEmailBody { get; set; }
    public string Status { get; set; } // success, failed, processing
}
```

### Gmail Token Storage

```csharp
public class GmailToken
{
    public string Id { get; set; }
    public string UserId { get; set; }
    public string AccessToken { get; set; }
    public string RefreshToken { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
```

---

## Rate Limiting & Quotas

- Gmail API: 100 requests/second per user
- Implement exponential backoff on 429 responses
- Cache message lists to reduce API calls
- Consider implementing per-user rate limiting

---

## Security Checklist

- [ ] Validate JWT token on all endpoints
- [ ] Encrypt stored refresh tokens
- [ ] Validate user authorization before accessing their data
- [ ] Implement CORS properly
- [ ] Use HTTPS only
- [ ] Sanitize error messages in production
- [ ] Log all OAuth operations
- [ ] Implement rate limiting
- [ ] Validate email parsing (avoid injection)
- [ ] Use secure headers (CSP, X-Frame-Options, etc.)

---

## Testing

### Unit Tests
- Token exchange logic
- Message parsing
- Data extraction
- Error handling

### Integration Tests
- Gmail API integration
- Database operations
- End-to-end OAuth flow

### Example Test Cases
1. Exchange valid authorization code → Success
2. Exchange invalid code → Error
3. Fetch messages with valid token → Success
4. Fetch messages with expired token → Error
5. Import valid messages → Success
6. Import with parsing errors → Partial success
7. Revoke authorization → Success

---

**Version:** 1.0
**Last Updated:** 2024
