# Shop Sales Gmail OAuth - Visual Guide & Component Architecture

## 🎯 User Journey

### Path 1: Unauthenticated User

```
┌──────────────────────┐
│  Not Authenticated   │
│  (No JWT Token)      │
└──────────┬───────────┘
           │
           ↓
┌──────────────────────────────────┐
│  Click "Shop Sales" in Dashboard │
└──────────┬───────────────────────┘
           │
           ↓
┌──────────────────────────────────┐
│  ProtectedRoute Check            │
│  - Verify JWT token exists       │
│  - Verify role is 'user'         │
└──────────┬───────────────────────┘
           │
           ↓ NO TOKEN
┌──────────────────────────────────┐
│  Redirect to /login              │
│  User logs in/registers          │
│  JWT token created & stored      │
└──────────┬───────────────────────┘
           │
           ↓ TOKEN OBTAINED
┌──────────────────────────────────┐
│  Redirect to /shop-sale          │
│  ShopSale component loads        │
└──────────────────────────────────┘
```

### Path 2: Authenticated User - Inline Mode

```
┌──────────────────────────────────┐
│  Click "Shop Sales"              │
└──────────┬───────────────────────┘
           │
           ↓
┌──────────────────────────────────┐
│  ProtectedRoute: JWT Valid ✓      │
└──────────┬───────────────────────┘
           │
           ↓
┌──────────────────────────────────┐
│  ShopSale Page (Inline Mode)     │
│  - Header with navigation        │
│  - Welcome section               │
│  - Control panel                 │
│  - GmailOAuth component          │
│  - Import history                │
│  - Sidebar with stats            │
└──────────┬───────────────────────┘
           │
           ↓
┌──────────────────────────────────┐
│  Click "Authorize Gmail"         │
│  (Button visible when not auth)  │
└──────────┬───────────────────────┘
           │
           ↓
┌──────────────────────────────────┐
│  OAuth 2.0 Flow with Google      │
│  - Redirect to Google consent    │
│  - User grants permissions       │
│  - Redirect back with code       │
│  - Exchange code for token       │
└──────────┬───────────────────────┘
           │
           ↓
┌──────────────────────────────────┐
│  Gmail Messages Listed           │
│  - Fetch messages from Gmail API │
│  - Display in selection list     │
│  - Show from, subject, date      │
└──────────┬───────────────────────┘
           │
           ↓
┌──────────────────────────────────┐
│  Select Messages                 │
│  - Use checkboxes                │
│  - Use "Select All"              │
│  - Update selected count         │
└──────────┬───────────────────────┘
           │
           ↓
┌──────────────────────────────────┐
│  Click "Import X Messages"       │
│  - Backend processes data        │
│  - Extract sales info            │
│  - Save to database              │
└──────────┬───────────────────────┘
           │
           ↓
┌──────────────────────────────────┐
│  Success! Import History Updated │
│  - Show success notification     │
│  - Add to import history         │
│  - Display stats                 │
└──────────────────────────────────┘
```

### Path 3: Authenticated User - Modal Mode

```
┌──────────────────────────────────┐
│  ShopSale Page (Modal Mode)      │
│  - Control panel with button     │
│  - Other content visible         │
└──────────┬───────────────────────┘
           │
           ↓
┌──────────────────────────────────┐
│  Click "Open Gmail Integration"  │
└──────────┬───────────────────────┘
           │
           ↓
┌──────────────────────────────────┐
│  Modal Opens (Overlay)           │
│  - Semi-transparent background   │
│  - GmailOAuth in center          │
│  - Can click outside to close    │
└──────────┬───────────────────────┘
           │
           ↓
│  [SAME AS INLINE MODE PATH]      │
│  [Authorize → Select → Import]   │
           │
           ↓
┌──────────────────────────────────┐
│  Modal Auto-closes               │
│  - After successful import       │
│  - User back to main page        │
│  - Import history updated        │
└──────────────────────────────────┘
```

---

## 🏗️ Component Architecture

### Component Tree

```
App.jsx
├── Router
├── AuthProvider
└── Routes
    ├── /login → Login
    ├── /register → Register
    ├── /shop-sale → ProtectedRoute
    │   └── ShopSale
    │       ├── Header
    │       │   ├── Back Button
    │       │   ├── Title
    │       │   └── User Badge
    │       ├── Main Content
    │       │   ├── Welcome Section
    │       │   ├── Control Panel
    │       │   │   └── GmailOAuth (Inline Mode Only)
    │       │   ├── Import History
    │       │   └── How It Works
    │       ├── Sidebar
    │       │   ├── Statistics Card
    │       │   └── Actions Card
    │       └── Modal (Modal Mode Only)
    │           └── GmailOAuth
    └── [Other Routes]
```

### GmailOAuth Component States

```
GmailOAuth
├── State: NOT AUTHORIZED
│   ├── Display: "Authorize Gmail" button
│   ├── Action: Click button
│   └── Next: OAuth flow
│
├── State: AUTHORIZING
│   ├── Display: Loading spinner
│   ├── Action: Waiting for user
│   └── Next: Authorization complete
│
├── State: AUTHORIZED
│   ├── Display: Messages list
│   ├── Features:
│   │   ├── Select/deselect messages
│   │   ├── Select All checkbox
│   │   ├── Refresh button
│   │   ├── Logout button
│   │   └── Import button
│   └── Next: Import or logout
│
├── State: IMPORTING
│   ├── Display: "Importing..." button
│   ├── Action: Processing messages
│   └── Next: Success or error
│
└── State: ERROR
    ├── Display: Error message
    ├── Action: Show error banner
    └── Next: Retry or back
```

---

## 📊 Data Flow

### OAuth Token Flow

```
┌─────────────────────────────────────────────────────┐
│         FRONTEND (React Component)                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. User clicks "Authorize Gmail"                   │
│                 ↓                                   │
│  2. Redirect to Google OAuth consent screen         │
│     URL: https://accounts.google.com/oauth2/auth   │
│                 ↓                                   │
│  3. [GOOGLE SERVERS - User logs in/grants access]  │
│                 ↓                                   │
│  4. Redirect back with authorization code           │
│     URL: http://localhost:5173/shop-sale?code=...  │
│                 ↓                                   │
│  5. Extract code from URL params                    │
│                 ↓                                   │
│  6. Call backend: POST /api/gmail/exchange-code    │
│                                                     │
└─────────────────────────────────────────────────────┘
                    ↓ HTTPS
┌─────────────────────────────────────────────────────┐
│         BACKEND (API Server)                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. Receive authorization code from frontend       │
│  2. Verify JWT token (authenticated user)          │
│  3. Exchange code for access token with Google API │
│  4. Return access token to frontend                │
│  5. Store token in database (encrypted)            │
│                                                     │
└─────────────────────────────────────────────────────┘
                    ↓ HTTPS
┌─────────────────────────────────────────────────────┐
│         FRONTEND (React Component)                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. Receive access token from backend              │
│  2. Store in localStorage                          │
│  3. Use token in Authorization header for requests │
│  4. Fetch Gmail messages                           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Message Import Flow

```
FRONTEND                          BACKEND                    DATABASE
    │                                │                           │
    ├─── Select Messages ───────────→│                           │
    │                                │                           │
    ├─── Click Import ───────────────→│                           │
    │    POST /api/gmail/import      │                           │
    │    + Authorization header      │                           │
    │    + Message IDs               │                           │
    │                                │                           │
    │                                ├─ Verify JWT Token         │
    │                                │                           │
    │                                ├─ Fetch Messages           │
    │                                │  from Gmail API           │
    │                                │                           │
    │                                ├─ Parse Message Data       │
    │                                │                           │
    │                                ├─── Extract sales info ───→│
    │                                │    Save ImportRecord      │
    │                                │                           │
    │←────────── Response ←──────────│                           │
    │    {importedCount: 2,           │                           │
    │     processedMessages: [...]}   │                           │
    │                                │                           │
    ├─── Show Success ───────────────→│                           │
    │                                │                           │
    └─── Update History & Stats ────→│                           │
         (localStorage)              │                           │
```

---

## 🗂️ File Dependencies

### Dependency Graph

```
App.jsx
├── react-router-dom
├── AuthContext
│   ├── axios
│   ├── localStorage
│   └── JWT tokens
├── ProtectedRoute
│   └── AuthContext
└── ShopSale
    ├── react-router-dom (useNavigate)
    ├── AuthContext (useAuth)
    ├── GmailOAuth
    │   ├── AuthContext
    │   ├── axios
    │   ├── localStorage
    │   ├── GmailOAuth.css
    │   └── Google OAuth API
    ├── ShopSale.css
    └── localStorage (import history)
```

### CSS Architecture

```
Global Styles
├── App.css (global styles)
├── index.css (base styles)

Component Styles
├── ShopSale.css
│   ├── .shop-sale-wrapper
│   ├── .shop-sale-header
│   ├── .shop-sale-container
│   ├── .shop-sale-main
│   ├── .shop-sale-sidebar
│   ├── .gmail-modal-overlay
│   ├── .gmail-modal-content
│   └── Responsive media queries
│
└── GmailOAuth.css
    ├── .gmail-oauth-container
    ├── .gmail-oauth-header
    ├── .authorization-section
    ├── .messages-section
    ├── .messages-list
    ├── .message-item
    └── Responsive media queries
```

---

## 🔄 State Management

### React Hooks Used

#### ShopSale Component

```javascript
const [showGmailModal, setShowGmailModal] = useState(false);
// Controls modal visibility

const [displayMode, setDisplayMode] = useState('inline');
// Switches between inline and modal mode

const [importedData, setImportedData] = useState(null);
// Stores last successful import

const [importHistory, setImportHistory] = useState([]);
// Stores import history (up to 10)
```

#### GmailOAuth Component

```javascript
const [isAuthorized, setIsAuthorized] = useState(false);
// OAuth authorization status

const [messages, setMessages] = useState([]);
// List of fetched Gmail messages

const [loading, setLoading] = useState(false);
// Loading state for API calls

const [error, setError] = useState(null);
// Error messages

const [selectedMessages, setSelectedMessages] = useState([]);
// Selected message IDs for import

const [importing, setImporting] = useState(false);
// Import operation status

const [accessToken, setAccessToken] = useState(null);
// Gmail access token
```

---

## 🎨 UI Component Hierarchy

### ShopSale Page Layout

```
┌─────────────────────────────────────────────────────────┐
│ SHOP-SALE-HEADER                                        │
│ [← Back]  [Shop Sales Management]  [👤 User Badge]    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌────────────────────────────┐  ┌──────────────────┐  │
│  │ MAIN CONTENT (Flex: 1fr)   │  │ SIDEBAR (300px)  │  │
│  │                            │  │                  │  │
│  │ ┌──────────────────────┐   │  │ ┌──────────────┐ │  │
│  │ │ Welcome Section      │   │  │ │ Stats Card   │ │  │
│  │ │ (Gradient)           │   │  │ │              │ │  │
│  │ └──────────────────────┘   │  │ └──────────────┘ │  │
│  │                            │  │                  │  │
│  │ ┌──────────────────────┐   │  │ ┌──────────────┐ │  │
│  │ │ Control Panel        │   │  │ │ Actions Card │ │  │
│  │ │ + Gmail Integration  │   │  │ │              │ │  │
│  │ │ + Mode Toggle        │   │  │ └──────────────┘ │  │
│  │ └──────────────────────┘   │  │                  │  │
│  │                            │  └──────────────────┘  │
│  │ ┌──────────────────────┐   │                       │
│  │ │ GmailOAuth (Inline)  │   │                       │
│  │ │ IF mode === 'inline' │   │                       │
│  │ └──────────────────────┘   │                       │
│  │                            │                       │
│  │ ┌──────────────────────┐   │                       │
│  │ │ Import History       │   │                       │
│  │ │ IF history.length > 0│   │                       │
│  │ └──────────────────────┘   │                       │
│  │                            │                       │
│  │ ┌──────────────────────┐   │                       │
│  │ │ How It Works         │   │                       │
│  │ │ (Info Section)       │   │                       │
│  │ └──────────────────────┘   │                       │
│  │                            │                       │
│  └────────────────────────────┘                       │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ GMAIL-MODAL (OVERLAY - IF mode === 'modal')      │  │
│  │ ┌────────────────────────────────────────────┐   │  │
│  │ │ GmailOAuth Component                       │   │  │
│  │ │ + Header with close button                 │   │  │
│  │ │ + OAuth Section OR Messages Section        │   │  │
│  │ └────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### GmailOAuth Component Layout

#### Authorization State
```
┌─────────────────────────────────────┐
│ GMAIL-OAUTH-CONTAINER               │
│ ┌─────────────────────────────────┐ │
│ │ HEADER                          │ │
│ │ [Gmail Integration]      [✕]    │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ AUTHORIZATION-SECTION           │ │
│ │                                 │ │
│ │ Authorize your Gmail account    │ │
│ │ to import sales data from       │ │
│ │ emails.                         │ │
│ │                                 │ │
│ │ [Authorize Gmail Button]        │ │
│ │                                 │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

#### Messages State
```
┌─────────────────────────────────────┐
│ GMAIL-OAUTH-CONTAINER               │
│ ┌─────────────────────────────────┐ │
│ │ HEADER                          │ │
│ │ [Your Gmail Messages] [🔄][Logout]
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ MESSAGES-LIST                   │ │
│ │ [☐ Select All (0 selected)]     │ │
│ │ ┌──────────────────────────────┐│ │
│ │ │ ☐ From: sender@example.com   ││ │
│ │ │ Subject: Daily Sales Report   ││ │
│ │ │ Date: 2024-01-01 10:30:00    ││ │
│ │ │ Preview: Today's sales...    ││ │
│ │ └──────────────────────────────┘│ │
│ │ ┌──────────────────────────────┐│ │
│ │ │ ☐ From: reports@system.com   ││ │
│ │ │ Subject: Automated Report     ││ │
│ │ │ Date: 2024-01-01 09:15:00    ││ │
│ │ │ Preview: Weekly reconciliation││ │
│ │ └──────────────────────────────┘│ │
│ │ ┌──────────────────────────────┐│ │
│ │ │ [More messages...]           ││ │
│ │ └──────────────────────────────┘│ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ MESSAGES-FOOTER                 │ │
│ │ 2 of 10 messages selected      │ │
│ │          [Import 2 Messages]   │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

---

## 🔗 API Integration Points

### Frontend → Backend Communication

```
Frontend Component          API Endpoint                Backend Action
─────────────────────────────────────────────────────────────────────
GmailOAuth.jsx
├─ Initial Load
│  └─ handleAuthorizationCode()
│     └─ POST /api/gmail/exchange-code
│        Request: {code, redirectUri, userId}
│        Response: {accessToken, refreshToken}
│        Action: Store tokens in localStorage
│
├─ Fetch Messages
│  └─ fetchGmailMessages()
│     └─ GET /api/gmail/messages?userId=...&maxResults=10
│        Headers: Authorization: Bearer {accessToken}
│        Response: {messages: [...]}
│        Action: Display messages in list
│
├─ Import Messages
│  └─ handleImportMessages()
│     └─ POST /api/gmail/import
│        Request: {messageIds: [...], userId: ...}
│        Headers: Authorization: Bearer {accessToken}
│        Response: {importedCount, processedMessages}
│        Action: Update import history
│
└─ Refresh Messages
   └─ handleRefreshMessages()
      └─ GET /api/gmail/messages (same as above)
```

---

## 💾 Data Storage Strategy

### localStorage (Client-Side)

```javascript
{
  // Gmail Tokens
  "gmail_access_token": "ya29.a0AfH6SMBx...",
  "gmail_refresh_token": "1//0gx...",
  
  // Import History (max 10 items)
  "shop_sale_imports": [
    {
      "id": 1704110400000,
      "timestamp": "2024-01-01, 10:30:00 AM",
      "messageCount": 2,
      "data": {
        "importedCount": 2,
        "processedMessages": [...]
      }
    },
    // ... more items
  ]
}
```

### Database (Backend)

```javascript
// GmailToken Collection
{
  _id: ObjectId,
  userId: "user-123",
  accessToken: "encrypted_token",
  refreshToken: "encrypted_token",
  expiresAt: ISODate,
  createdAt: ISODate,
  updatedAt: ISODate
}

// ImportedSalesRecord Collection
{
  _id: ObjectId,
  userId: "user-123",
  gmailMessageId: "18a1234567890abcdef",
  subject: "Daily Sales Report",
  from: "sales@company.com",
  extractedData: {
    salesAmount: 5000.00,
    transactionCount: 45,
    period: "2024-01-01"
  },
  importedAt: ISODate,
  status: "success",
  rawEmailBody: "... full email text ..."
}
```

---

## 🚀 Performance Considerations

### Optimization Strategies

```
FRONTEND
├─ Component Memoization
│  └─ Memo GmailOAuth for re-render optimization
│
├─ Event Debouncing
│  └─ Debounce checkbox selections
│
├─ Lazy Loading
│  └─ Infinite scroll for message list (future)
│
├─ Caching
│  └─ Cache messages for 5 minutes
│
└─ Code Splitting
   └─ Import GmailOAuth only when needed

BACKEND
├─ Rate Limiting
│  └─ 100 requests/sec per user
│
├─ Batch Processing
│  └─ Process messages in batches of 10
│
├─ Caching
│  └─ Cache Gmail message list for 1 hour
│
├─ Async Processing
│  └─ Queue long-running imports
│
└─ Database Indexing
   └─ Index userId, messageId, createdAt
```

---

## 📝 Development Notes

### Key Implementation Details

1. **OAuth Flow**
   - Uses Google OAuth 2.0 with authorization code grant
   - Scopes: `gmail.readonly` only
   - Tokens stored securely after exchange

2. **Message Fetching**
   - Maximum 10 messages fetched by default
   - Can paginate with nextPageToken
   - Headers extracted for display

3. **Import Processing**
   - Each message parsed for sales data
   - Custom regex patterns for data extraction
   - Failed messages marked with error reason

4. **State Persistence**
   - Import history saved to localStorage
   - Limited to 10 most recent imports
   - Persists across page refreshes

5. **Error Handling**
   - Network errors shown with retry option
   - Authorization errors prompt re-auth
   - Validation errors show specific messages

---

**Version**: 1.0
**Last Updated**: 2024
