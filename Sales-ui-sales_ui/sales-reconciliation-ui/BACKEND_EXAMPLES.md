# Backend Implementation Examples

This document provides example implementations of the Gmail OAuth integration endpoints in popular backend frameworks.

## Table of Contents

1. [C# / .NET 6+](#c-net-60)
2. [Node.js / Express](#nodejs--express)
3. [Python / Flask](#python--flask)

---

## C# / .NET 6.0+

### 1. Setup NuGet Packages

```xml
<ItemGroup>
    <PackageReference Include="Google.Apis.Gmail.v1" Version="1.59.0" />
    <PackageReference Include="Google.Apis.Auth.AspNetCore" Version="1.59.0" />
    <PackageReference Include="Google.Apis.Core" Version="1.59.0" />
    <PackageReference Include="System.IdentityModel.Tokens.Jwt" Version="7.0.0" />
</ItemGroup>
```

### 2. Models

```csharp
public class GmailMessage
{
    public string Id { get; set; }
    public string ThreadId { get; set; }
    public string From { get; set; }
    public string Subject { get; set; }
    public DateTime Date { get; set; }
    public string Preview { get; set; }
    public List<string> Labels { get; set; }
}

public class ExchangeCodeRequest
{
    public string Code { get; set; }
    public string RedirectUri { get; set; }
    public string UserId { get; set; }
}

public class TokenResponse
{
    public string AccessToken { get; set; }
    public string RefreshToken { get; set; }
    public int ExpiresIn { get; set; }
    public string TokenType { get; set; }
}

public class ImportRequest
{
    public List<string> MessageIds { get; set; }
    public string UserId { get; set; }
}

public class ImportResponse
{
    public int ImportedCount { get; set; }
    public int FailedCount { get; set; }
    public List<ProcessedMessage> ProcessedMessages { get; set; }
}

public class ProcessedMessage
{
    public string MessageId { get; set; }
    public string Status { get; set; }
    public string Subject { get; set; }
    public Dictionary<string, object> ExtractedData { get; set; }
    public string Error { get; set; }
}
```

### 3. Service for Gmail Integration

```csharp
using Google.Apis.Auth.OAuth2;
using Google.Apis.Gmail.v1;
using Google.Apis.Gmail.v1.Data;
using Google.Apis.Services;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

public interface IGmailService
{
    Task<TokenResponse> ExchangeCodeForTokenAsync(ExchangeCodeRequest request);
    Task<List<GmailMessage>> FetchMessagesAsync(string accessToken, int maxResults = 10);
    Task<ImportResponse> ImportMessagesAsync(string accessToken, ImportRequest request);
}

public class GmailIntegrationService : IGmailService
{
    private readonly IConfiguration _configuration;
    private readonly IHttpClientFactory _httpClientFactory;

    public GmailIntegrationService(IConfiguration configuration, IHttpClientFactory httpClientFactory)
    {
        _configuration = configuration;
        _httpClientFactory = httpClientFactory;
    }

    public async Task<TokenResponse> ExchangeCodeForTokenAsync(ExchangeCodeRequest request)
    {
        try
        {
            var clientId = _configuration["Gmail:ClientId"];
            var clientSecret = _configuration["Gmail:ClientSecret"];

            var exchangeRequest = new GoogleAuthorizationCodeTokenRequest(
                new HttpClientFactory(),
                "https://oauth2.googleapis.com/token",
                clientId,
                clientSecret,
                request.Code,
                request.RedirectUri);

            var token = await exchangeRequest.ExecuteAsync();

            return new TokenResponse
            {
                AccessToken = token.AccessToken,
                RefreshToken = token.RefreshToken,
                ExpiresIn = (int)(token.ExpiresInSeconds ?? 3600),
                TokenType = token.TokenType
            };
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException("Failed to exchange authorization code", ex);
        }
    }

    public async Task<List<GmailMessage>> FetchMessagesAsync(string accessToken, int maxResults = 10)
    {
        var credential = GoogleCredential.FromAccessToken(accessToken);

        using (var service = new GmailService(new BaseClientService.Initializer()
        {
            HttpClientInitializer = credential,
            ApplicationName = "Sales Reconciliation",
        }))
        {
            var request = service.Users.Messages.List("me");
            request.MaxResults = maxResults;
            request.Q = "is:inbox"; // Query for inbox messages

            var response = await request.ExecuteAsync();
            var messages = new List<GmailMessage>();

            if (response.Messages == null || response.Messages.Count == 0)
            {
                return messages;
            }

            foreach (var msg in response.Messages)
            {
                var getRequest = service.Users.Messages.Get("me", msg.Id);
                var fullMessage = await getRequest.ExecuteAsync();

                var headers = fullMessage.Payload?.Headers ?? new List<MessagePartHeader>();
                var from = headers.FirstOrDefault(h => h.Name == "From")?.Value ?? "Unknown";
                var subject = headers.FirstOrDefault(h => h.Name == "Subject")?.Value ?? "(No Subject)";
                var date = headers.FirstOrDefault(h => h.Name == "Date")?.Value ?? "";

                messages.Add(new GmailMessage
                {
                    Id = msg.Id,
                    ThreadId = msg.ThreadId,
                    From = from,
                    Subject = subject,
                    Date = DateTime.TryParse(date, out var dt) ? dt : DateTime.Now,
                    Preview = fullMessage.Snippet,
                    Labels = fullMessage.LabelIds ?? new List<string>()
                });
            }

            return messages;
        }
    }

    public async Task<ImportResponse> ImportMessagesAsync(string accessToken, ImportRequest request)
    {
        var response = new ImportResponse
        {
            ProcessedMessages = new List<ProcessedMessage>()
        };

        var credential = GoogleCredential.FromAccessToken(accessToken);

        using (var service = new GmailService(new BaseClientService.Initializer()
        {
            HttpClientInitializer = credential,
            ApplicationName = "Sales Reconciliation",
        }))
        {
            foreach (var messageId in request.MessageIds)
            {
                try
                {
                    var getRequest = service.Users.Messages.Get("me", messageId);
                    getRequest.Format = UsersResource.MessagesResource.GetRequest.FormatEnum.Full;
                    var message = await getRequest.ExecuteAsync();

                    var headers = message.Payload?.Headers ?? new List<MessagePartHeader>();
                    var subject = headers.FirstOrDefault(h => h.Name == "Subject")?.Value ?? "";

                    var extractedData = ExtractSalesData(message);

                    response.ProcessedMessages.Add(new ProcessedMessage
                    {
                        MessageId = messageId,
                        Status = "success",
                        Subject = subject,
                        ExtractedData = extractedData
                    });

                    response.ImportedCount++;
                }
                catch (Exception ex)
                {
                    response.ProcessedMessages.Add(new ProcessedMessage
                    {
                        MessageId = messageId,
                        Status = "failed",
                        Error = ex.Message
                    });

                    response.FailedCount++;
                }
            }
        }

        return response;
    }

    private Dictionary<string, object> ExtractSalesData(Message message)
    {
        // Implementation to parse email and extract sales data
        // This is specific to your email format

        var extracted = new Dictionary<string, object>
        {
            { "salesAmount", 0m },
            { "transactionCount", 0 },
            { "source", "email" },
            { "category", "import" }
        };

        // Parse message body
        var bodyText = GetMessageBody(message);
        
        // TODO: Implement your custom parsing logic
        // Example: Use regex to extract sales amount, transaction count, etc.

        return extracted;
    }

    private string GetMessageBody(Message message)
    {
        if (message.Payload?.Parts == null)
        {
            return Base64Decode(message.Payload?.Body?.Data ?? "");
        }

        var part = message.Payload.Parts.FirstOrDefault(p => p.MimeType == "text/plain");
        return part != null ? Base64Decode(part.Body?.Data ?? "") : "";
    }

    private string Base64Decode(string base64String)
    {
        try
        {
            var decodedData = Convert.FromBase64String(base64String);
            return System.Text.Encoding.UTF8.GetString(decodedData);
        }
        catch
        {
            return "";
        }
    }
}
```

### 4. Controller

```csharp
[ApiController]
[Route("api/gmail")]
[Authorize]
public class GmailController : ControllerBase
{
    private readonly IGmailService _gmailService;

    public GmailController(IGmailService gmailService)
    {
        _gmailService = gmailService;
    }

    [HttpPost("exchange-code")]
    public async Task<IActionResult> ExchangeCode([FromBody] ExchangeCodeRequest request)
    {
        try
        {
            var token = await _gmailService.ExchangeCodeForTokenAsync(request);
            // TODO: Store token in database with user association
            return Ok(token);
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpGet("messages")]
    public async Task<IActionResult> GetMessages([FromQuery] int maxResults = 10)
    {
        try
        {
            var accessToken = Request.Headers["Authorization"].ToString().Replace("Bearer ", "");
            var messages = await _gmailService.FetchMessagesAsync(accessToken, maxResults);
            return Ok(new { messages });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("import")]
    public async Task<IActionResult> ImportMessages([FromBody] ImportRequest request)
    {
        try
        {
            var accessToken = Request.Headers["Authorization"].ToString().Replace("Bearer ", "");
            var result = await _gmailService.ImportMessagesAsync(accessToken, request);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
```

---

## Node.js / Express

### 1. Setup Dependencies

```bash
npm install express google-auth-library nodemailer axios dotenv
npm install --save-dev @types/express
```

### 2. Configuration

```javascript
// config/gmail.js
const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);

module.exports = { oauth2Client };
```

### 3. Service

```javascript
// services/gmailService.js
const { google } = require('googleapis');
const axios = require('axios');

class GmailService {
  async exchangeCodeForToken(code, redirectUri) {
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        redirectUri
      );

      const { tokens } = await oauth2Client.getToken(code);

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expiry_date,
        tokenType: 'Bearer'
      };
    } catch (error) {
      throw new Error('Failed to exchange authorization code: ' + error.message);
    }
  }

  async fetchMessages(accessToken, maxResults = 10) {
    try {
      const gmail = google.gmail({ version: 'v1', auth: this.getAuthClient(accessToken) });

      const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults: maxResults,
        q: 'is:inbox'
      });

      const messages = [];

      if (response.data.messages && response.data.messages.length > 0) {
        for (const msg of response.data.messages) {
          const message = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date']
          });

          const headers = message.data.payload.headers;
          const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
          const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
          const date = headers.find(h => h.name === 'Date')?.value || new Date().toISOString();

          messages.push({
            id: msg.id,
            threadId: msg.threadId,
            from: from,
            subject: subject,
            date: new Date(date),
            preview: message.data.snippet,
            labels: message.data.labelIds || []
          });
        }
      }

      return messages;
    } catch (error) {
      throw new Error('Failed to fetch messages: ' + error.message);
    }
  }

  async importMessages(accessToken, messageIds) {
    const gmail = google.gmail({ version: 'v1', auth: this.getAuthClient(accessToken) });
    const processedMessages = [];
    let importedCount = 0;
    let failedCount = 0;

    for (const messageId of messageIds) {
      try {
        const message = await gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'full'
        });

        const headers = message.data.payload.headers;
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const from = headers.find(h => h.name === 'From')?.value || '';

        const extractedData = this.extractSalesData(message.data);

        processedMessages.push({
          messageId: messageId,
          status: 'success',
          subject: subject,
          from: from,
          extractedData: extractedData
        });

        importedCount++;
      } catch (error) {
        processedMessages.push({
          messageId: messageId,
          status: 'failed',
          error: error.message
        });

        failedCount++;
      }
    }

    return {
      importedCount,
      failedCount,
      processedMessages
    };
  }

  extractSalesData(message) {
    // TODO: Implement custom parsing logic
    return {
      salesAmount: 0,
      transactionCount: 0,
      source: 'email',
      category: 'import'
    };
  }

  getAuthClient(accessToken) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: accessToken
    });

    return oauth2Client;
  }
}

module.exports = new GmailService();
```

### 4. Routes

```javascript
// routes/gmail.js
const express = require('express');
const router = express.Router();
const gmailService = require('../services/gmailService');
const authMiddleware = require('../middleware/auth');

router.post('/exchange-code', authMiddleware, async (req, res) => {
  try {
    const { code, redirectUri } = req.body;
    const token = await gmailService.exchangeCodeForToken(code, redirectUri);
    // TODO: Store token in database with user association
    res.json(token);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get('/messages', authMiddleware, async (req, res) => {
  try {
    const accessToken = req.headers.authorization?.replace('Bearer ', '');
    const maxResults = req.query.maxResults || 10;
    const messages = await gmailService.fetchMessages(accessToken, maxResults);
    res.json({ messages });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/import', authMiddleware, async (req, res) => {
  try {
    const accessToken = req.headers.authorization?.replace('Bearer ', '');
    const { messageIds } = req.body;
    const result = await gmailService.importMessages(accessToken, messageIds);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
```

### 5. Main App

```javascript
// app.js
const express = require('express');
const gmailRoutes = require('./routes/gmail');

const app = express();

app.use(express.json());
app.use('/api/gmail', gmailRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

---

## Python / Flask

### 1. Setup Dependencies

```bash
pip install flask google-auth-oauthlib google-auth-httplib2 google-api-python-client
pip install python-dotenv
```

### 2. Service

```python
# services/gmail_service.py
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
import base64
import os

class GmailService:
    def __init__(self):
        self.SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
        self.SERVICE_NAME = 'gmail'
        self.API_VERSION = 'v1'

    def exchange_code_for_token(self, code, redirect_uri):
        try:
            flow = Flow.from_client_secrets_file(
                'credentials.json',
                scopes=self.SCOPES,
                redirect_uri=redirect_uri
            )
            flow.fetch_token(code=code)
            credentials = flow.credentials

            return {
                'accessToken': credentials.token,
                'refreshToken': credentials.refresh_token,
                'expiresIn': 3600,
                'tokenType': 'Bearer'
            }
        except Exception as e:
            raise Exception(f'Failed to exchange authorization code: {str(e)}')

    def fetch_messages(self, access_token, max_results=10):
        try:
            credentials = Credentials(token=access_token)
            service = build(self.SERVICE_NAME, self.API_VERSION, credentials=credentials)

            results = service.users().messages().list(
                userId='me',
                maxResults=max_results,
                q='is:inbox'
            ).execute()

            messages = []

            if 'messages' in results:
                for msg in results['messages']:
                    message = service.users().messages().get(
                        userId='me',
                        id=msg['id'],
                        format='metadata',
                        metadataHeaders=['From', 'Subject', 'Date']
                    ).execute()

                    headers = message['payload']['headers']
                    from_header = next((h['value'] for h in headers if h['name'] == 'From'), 'Unknown')
                    subject = next((h['value'] for h in headers if h['name'] == 'Subject'), '(No Subject)')
                    date = next((h['value'] for h in headers if h['name'] == 'Date'), '')

                    messages.append({
                        'id': msg['id'],
                        'threadId': msg['threadId'],
                        'from': from_header,
                        'subject': subject,
                        'date': date,
                        'preview': message.get('snippet', ''),
                        'labels': message.get('labelIds', [])
                    })

            return messages
        except Exception as e:
            raise Exception(f'Failed to fetch messages: {str(e)}')

    def import_messages(self, access_token, message_ids):
        try:
            credentials = Credentials(token=access_token)
            service = build(self.SERVICE_NAME, self.API_VERSION, credentials=credentials)

            processed_messages = []
            imported_count = 0
            failed_count = 0

            for message_id in message_ids:
                try:
                    message = service.users().messages().get(
                        userId='me',
                        id=message_id,
                        format='full'
                    ).execute()

                    headers = message['payload']['headers']
                    subject = next((h['value'] for h in headers if h['name'] == 'Subject'), '')
                    from_header = next((h['value'] for h in headers if h['name'] == 'From'), '')

                    extracted_data = self.extract_sales_data(message)

                    processed_messages.append({
                        'messageId': message_id,
                        'status': 'success',
                        'subject': subject,
                        'from': from_header,
                        'extractedData': extracted_data
                    })

                    imported_count += 1
                except Exception as e:
                    processed_messages.append({
                        'messageId': message_id,
                        'status': 'failed',
                        'error': str(e)
                    })

                    failed_count += 1

            return {
                'importedCount': imported_count,
                'failedCount': failed_count,
                'processedMessages': processed_messages
            }
        except Exception as e:
            raise Exception(f'Failed to import messages: {str(e)}')

    def extract_sales_data(self, message):
        # TODO: Implement custom parsing logic
        return {
            'salesAmount': 0,
            'transactionCount': 0,
            'source': 'email',
            'category': 'import'
        }

gmail_service = GmailService()
```

### 3. Routes

```python
# routes/gmail_routes.py
from flask import Blueprint, request, jsonify
from services.gmail_service import gmail_service
from middleware.auth import token_required

gmail_bp = Blueprint('gmail', __name__, url_prefix='/api/gmail')

@gmail_bp.route('/exchange-code', methods=['POST'])
@token_required
def exchange_code():
    try:
        data = request.get_json()
        code = data.get('code')
        redirect_uri = data.get('redirectUri')
        
        token = gmail_service.exchange_code_for_token(code, redirect_uri)
        # TODO: Store token in database with user association
        
        return jsonify(token), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 400

@gmail_bp.route('/messages', methods=['GET'])
@token_required
def get_messages():
    try:
        access_token = request.headers.get('Authorization', '').replace('Bearer ', '')
        max_results = request.args.get('maxResults', 10, type=int)
        
        messages = gmail_service.fetch_messages(access_token, max_results)
        
        return jsonify({'messages': messages}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 400

@gmail_bp.route('/import', methods=['POST'])
@token_required
def import_messages():
    try:
        access_token = request.headers.get('Authorization', '').replace('Bearer ', '')
        data = request.get_json()
        message_ids = data.get('messageIds', [])
        
        result = gmail_service.import_messages(access_token, message_ids)
        
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 400
```

### 4. Main App

```python
# app.py
from flask import Flask
from routes.gmail_routes import gmail_bp

app = Flask(__name__)

app.register_blueprint(gmail_bp)

if __name__ == '__main__':
    app.run(debug=True, port=5000)
```

---

## Common Implementation Patterns

### 1. Token Storage Pattern

Always store tokens securely:
- Use encryption at rest
- Associate with user account
- Store expiration time
- Implement refresh token rotation

### 2. Error Handling Pattern

```javascript
// Generic error handler
try {
  // Operation
} catch (error) {
  if (error.status === 401) {
    // Token expired - prompt re-authorization
  } else if (error.status === 403) {
    // Permission denied
  } else {
    // Other errors
  }
}
```

### 3. Rate Limiting Pattern

Gmail API limits: 100 requests/second per user

```javascript
// Implement exponential backoff
async function makeRequestWithRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429 && i < maxRetries - 1) {
        await sleep(Math.pow(2, i) * 1000); // Exponential backoff
      } else {
        throw error;
      }
    }
  }
}
```

---

**Version:** 1.0
**Last Updated:** 2024
