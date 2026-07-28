# Shop Sales - Gmail OAuth Integration Setup Guide

## Overview

This guide explains how to set up and configure the **Shop Sales** feature with **Gmail OAuth integration** in the Sales Reconciliation UI.

## Features Implemented

✅ **Authentication Check**: The Shop Sales page is protected and only accessible to authenticated users
✅ **Gmail OAuth Flow**: Complete OAuth 2.0 integration with Gmail
✅ **Message Import**: Select and import sales data from Gmail messages
✅ **Dual Display Modes**: View component inline or in a modal
✅ **Import History**: Track all imported messages
✅ **Responsive Design**: Works on desktop, tablet, and mobile devices

## File Structure

```
src/
├── components/
│   └── GmailOAuth.jsx          # Gmail OAuth component
├── pages/
│   └── ShopSale.jsx            # Shop Sales page (updated)
└── styles/
    ├── GmailOAuth.css          # Gmail component styling
    └── ShopSale.css            # Shop Sales page styling
```

## Setup Instructions

### Step 1: Environment Variables

Add the following to your `.env.local` file:

```env
# Gmail OAuth Configuration
VITE_GMAIL_CLIENT_ID=YOUR_GMAIL_CLIENT_ID_HERE
VITE_GMAIL_REDIRECT_URI=http://localhost:5173/shop-sale

# API Configuration (already configured)
VITE_API_URL=https://localhost:7276/api
```

### Step 2: Get Gmail OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing one
3. Enable the **Gmail API**
4. Create an **OAuth 2.0 Client ID** (Web Application):
   - Authorized JavaScript origins: `http://localhost:5173`
   - Authorized redirect URIs: `http://localhost:5173/shop-sale`
5. Copy the Client ID and add to `.env.local`

### Step 3: Backend API Endpoints

Your backend should implement these endpoints:

#### POST `/api/gmail/exchange-code`
Exchanges authorization code for access token

**Request:**
```json
{
  "code": "authorization_code_from_google",
  "redirectUri": "http://localhost:5173/shop-sale",
  "userId": "user_id_from_token"
}
```

**Response:**
```json
{
  "accessToken": "gmail_access_token",
  "refreshToken": "gmail_refresh_token_optional"
}
```

#### GET `/api/gmail/messages`
Fetches user's Gmail messages

**Query Parameters:**
- `userId`: User ID from JWT token
- `maxResults`: Number of messages to fetch (default: 10)

**Headers:**
```
Authorization: Bearer {gmail_access_token}
```

**Response:**
```json
{
  "messages": [
    {
      "id": "message_id_from_gmail",
      "from": "sender@example.com",
      "subject": "Sales Data Report",
      "date": "2024-01-01T12:00:00Z",
      "preview": "Message preview text..."
    }
  ]
}
```

#### POST `/api/gmail/import`
Imports selected Gmail messages

**Request:**
```json
{
  "messageIds": ["msg_id_1", "msg_id_2"],
  "userId": "user_id_from_token"
}
```

**Headers:**
```
Authorization: Bearer {gmail_access_token}
```

**Response:**
```json
{
  "importedCount": 2,
  "processedMessages": [
    {
      "messageId": "msg_id_1",
      "status": "success",
      "extractedData": {...}
    }
  ]
}
```

## How It Works

### User Flow

1. **Access Shop Sales**: Click "Shop Sales" button in Dashboard
   - Route: `/shop-sale`
   - Protected by `ProtectedRoute` (requires authentication)

2. **Choose Display Mode**:
   - **Inline**: Gmail component displayed on the page
   - **Modal**: Click button to open in popup

3. **Authorize Gmail**:
   - Click "Authorize Gmail" button
   - Redirected to Google login (if not already logged in)
   - Grant permission for Gmail access
   - Redirected back with authorization code

4. **View Messages**:
   - List of recent Gmail messages displayed
   - Select messages to import
   - Use "Select All" checkbox for bulk selection

5. **Import Data**:
   - Click "Import X Messages"
   - Backend processes the messages
   - Import history updated
   - Success notification shown

### Component Details

#### GmailOAuth Component (`src/components/GmailOAuth.jsx`)

**Props:**
- `onSuccessfulImport` (function): Called when import succeeds
- `onClose` (function, optional): Called to close modal

**Features:**
- Automatic OAuth flow handling
- Message fetching and display
- Bulk selection with "Select All"
- Error handling and user feedback
- Token storage in localStorage
- Refresh functionality

**State Management:**
- Uses `useAuth()` from AuthContext
- Stores tokens in localStorage
- Manages message list and selection state

#### ShopSale Page (`src/pages/ShopSale.jsx`)

**Features:**
- Dual display mode toggle
- Import history tracking
- Statistics display
- Quick reference guide
- Modal integration
- Responsive sidebar

**Local Storage:**
- `gmail_access_token`: Gmail access token
- `gmail_refresh_token`: Gmail refresh token (optional)
- `shop_sale_imports`: Import history (last 10 imports)

## Authentication Flow

```
User (Unauthenticated)
    ↓
Click "Shop Sales" → ProtectedRoute Check
    ↓
Has JWT Token? → YES → Navigate to /shop-sale
    ↓ NO
Redirect to /login
    ↓
User Logs In
    ↓
JWT Token Stored → Navigate to /shop-sale
    ↓
ShopSale Page (GmailOAuth Component)
    ↓
Click "Authorize Gmail"
    ↓
OAuth Flow with Google
    ↓
Redirect with Authorization Code
    ↓
Exchange Code for Gmail Access Token
    ↓
Fetch and Display Messages
    ↓
Select & Import
```

## Display Modes

### Inline Mode
```
ShopSale Page
├── Header
├── Welcome Section
├── Control Panel (with mode toggle)
├── Gmail OAuth Component (displayed inline)
├── Import History
├── How It Works
└── Sidebar (Stats & Actions)
```

### Modal Mode
```
ShopSale Page
├── Header
├── Welcome Section
├── Control Panel (with "Open Gmail Integration" button)
├── Import History
├── How It Works
├── Sidebar (Stats & Actions)
└── Modal Overlay
    └── Gmail OAuth Component
```

## Error Handling

The component handles various error scenarios:

1. **Authorization Failed**: Display error message with retry option
2. **Token Expired**: Prompt user to re-authorize
3. **Network Error**: Show error message and allow retry
4. **No Messages Found**: Display empty state
5. **Import Failed**: Show error message with details

## Security Considerations

1. **JWT Authentication**: All requests validated with JWT token
2. **Token Storage**: Access tokens stored in localStorage (consider using secure cookies for production)
3. **Scope Limitation**: Gmail permissions limited to `gmail.readonly`
4. **CORS**: Ensure backend properly handles CORS for OAuth callback
5. **Rate Limiting**: Implement rate limiting on backend endpoints

## Styling

### CSS Files
- `src/styles/GmailOAuth.css`: Gmail component styles
- `src/styles/ShopSale.css`: Shop Sales page styles

### Color Scheme
- **Primary**: `#4f46e5` (Indigo)
- **Success**: `#10b981` (Green)
- **Danger**: `#ef4444` (Red)
- **Text**: `#1f2937` (Dark Gray)
- **Muted**: `#6b7280` (Gray)

### Responsive Breakpoints
- Desktop: Full layout with sidebar
- Tablet (≤1024px): Single column layout
- Mobile (≤768px): Compact layout
- Small Mobile (≤480px): Minimal layout

## Testing Checklist

- [ ] User can access Shop Sales when authenticated
- [ ] Unauthorized users are redirected to login
- [ ] Gmail OAuth authorization works
- [ ] Messages are fetched and displayed
- [ ] Message selection works
- [ ] Import functionality processes messages
- [ ] Import history is saved and displayed
- [ ] Display mode toggle works
- [ ] Modal opens/closes correctly
- [ ] Responsive design works on mobile
- [ ] Error messages display properly
- [ ] Token refresh works (if implemented)

## Common Issues & Solutions

### Issue: "Client ID not found"
**Solution**: Ensure `VITE_GMAIL_CLIENT_ID` is set in `.env.local`

### Issue: "Redirect URI mismatch"
**Solution**: Verify redirect URI matches exactly in Google Console and `.env.local`

### Issue: "Messages not loading"
**Solution**: Check backend endpoint `/api/gmail/messages` is implemented and returning correct format

### Issue: "Import fails"
**Solution**: Verify backend `/api/gmail/import` endpoint is implemented and processing messages correctly

### Issue: "Token expires"
**Solution**: Implement token refresh mechanism in backend

## Future Enhancements

1. **Token Refresh**: Implement automatic token refresh
2. **Message Filtering**: Add filters by date, sender, subject
3. **Data Extraction**: Parse email content for sales data
4. **Bulk Operations**: Archive or label imported messages
5. **Integration with Dashboard**: Display imported data in Summary
6. **Advanced Analytics**: Charts and reports of imported data
7. **Scheduler**: Auto-import on schedule
8. **Caching**: Cache messages to reduce API calls

## Support & Documentation

For issues or questions:
1. Check Gmail API Documentation: https://developers.google.com/gmail/api
2. Review OAuth 2.0 Flow: https://developers.google.com/identity/protocols/oauth2
3. Check backend implementation against API specifications above

---

**Last Updated**: 2024
**Version**: 1.0
