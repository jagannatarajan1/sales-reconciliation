# Quick Reference Guide - Shop Sales Gmail OAuth

## 🚀 Getting Started in 5 Minutes

### 1. Set Environment Variables (.env.local)

```env
VITE_GMAIL_CLIENT_ID=YOUR_CLIENT_ID_FROM_GOOGLE
VITE_GMAIL_REDIRECT_URI=http://localhost:5173/shop-sale
VITE_API_URL=https://localhost:7276/api
```

### 2. Get Gmail API Credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create OAuth 2.0 credential (Web Application)
3. Add redirect URI: `http://localhost:5173/shop-sale`
4. Copy Client ID → `.env.local`

### 3. Test Frontend

```bash
npm run dev
# Navigate to Dashboard → Click "Shop Sales"
# Should load the feature
```

### 4. Implement Backend Endpoints

See API endpoints below or `BACKEND_API_SPEC.md` for full details.

---

## 📚 Documentation Files

| File | Contents | When to Use |
|------|----------|-----------|
| `IMPLEMENTATION_SUMMARY.md` | 📋 Overview of what's done | Start here |
| `GMAIL_OAUTH_SETUP.md` | 🔧 Complete setup guide | Setup & deployment |
| `BACKEND_API_SPEC.md` | 📡 API specification | Backend development |
| `BACKEND_EXAMPLES.md` | 💻 Code examples (C#/Node/Python) | Implementation reference |
| `VISUAL_GUIDE.md` | 🎨 Architecture & flow diagrams | Understanding the system |
| `QUICK_REFERENCE.md` | ⚡ This file - quick lookup | Quick answers |

---

## 🔗 API Endpoints Required

### 1. Exchange Auth Code → Access Token
```
POST /api/gmail/exchange-code
Authorization: Bearer {jwt_token}

{
  "code": "authorization_code",
  "redirectUri": "http://localhost:5173/shop-sale",
  "userId": "user-id"
}

← {accessToken, refreshToken, expiresIn}
```

### 2. Fetch Messages
```
GET /api/gmail/messages?userId=user-id&maxResults=10
Authorization: Bearer {gmail_access_token}

← {messages: [{id, from, subject, date, preview}]}
```

### 3. Import Messages
```
POST /api/gmail/import
Authorization: Bearer {gmail_access_token}

{
  "messageIds": ["id1", "id2"],
  "userId": "user-id"
}

← {importedCount, processedMessages: [...]}
```

### 4. Optional: Refresh Token
```
POST /api/gmail/refresh-token
Authorization: Bearer {jwt_token}

{
  "userId": "user-id"
}

← {accessToken, expiresIn}
```

---

## 🎯 File Locations

### Frontend Code
```
src/
├── components/GmailOAuth.jsx          ← Gmail OAuth component
├── pages/ShopSale.jsx                 ← Shop Sales page (updated)
└── styles/
    ├── GmailOAuth.css                 ← Gmail styling
    └── ShopSale.css                   ← Shop page styling
```

### Routes
- Protected: `/shop-sale` → `ShopSale` page
- Already protected by `ProtectedRoute`

---

## 🔐 Authentication Layers

| Layer | Check | Where |
|-------|-------|-------|
| 1️⃣ JWT Token | User logged in? | ProtectedRoute |
| 2️⃣ User Role | User is 'user'? | ProtectedRoute |
| 3️⃣ Gmail Token | Gmail authorized? | GmailOAuth component |
| 4️⃣ Backend Auth | JWT valid on API? | Backend middleware |

---

## 💾 Storage

### Client-Side (localStorage)
```javascript
gmail_access_token      // Gmail OAuth token
gmail_refresh_token     // Gmail refresh token
shop_sale_imports       // Import history (last 10)
```

### Server-Side (Database)
```
GmailToken Table:
- userId
- accessToken (encrypted)
- refreshToken (encrypted)
- expiresAt

ImportedSalesRecord Table:
- userId
- messageId
- extractedData (JSON)
- importedAt
```

---

## 🎨 Display Modes

### Inline Mode
- Gmail component on same page
- Always visible
- Default mode
- Better for detailed work

### Modal Mode
- Gmail component in popup
- Click button to open
- Click outside to close
- Better for quick actions

Toggle with: `setDisplayMode('inline' | 'modal')`

---

## ⚡ Key Functions in GmailOAuth.jsx

```javascript
startOAuthFlow()
// Redirects to Google OAuth consent screen

handleAuthorizationCode(code)
// Exchanges code for access token

fetchGmailMessages(token)
// Gets list of Gmail messages

handleMessageSelection(messageId)
// Toggle message checkbox

handleSelectAll(e)
// Select/deselect all messages

handleImportMessages()
// Send selected messages to backend for processing

handleLogout()
// Revoke Gmail authorization
```

---

## 📊 State in ShopSale.jsx

```javascript
showGmailModal        // Is modal open?
displayMode           // 'inline' or 'modal'
importedData          // Last successful import
importHistory         // Array of past imports (max 10)
```

---

## 📊 State in GmailOAuth.jsx

```javascript
isAuthorized          // Gmail is authorized?
messages              // List of fetched messages
loading               // API call in progress?
error                 // Error message (if any)
selectedMessages      // Array of checked message IDs
importing             // Import operation in progress?
accessToken           // Gmail access token
```

---

## 🐛 Troubleshooting

### "Gmail component not loading"
→ Check `VITE_GMAIL_CLIENT_ID` in `.env.local`

### "Redirect URI mismatch"
→ Verify URI matches exactly in Google Console & `.env.local`

### "Messages list empty"
→ Implement backend `GET /api/gmail/messages` endpoint

### "Import doesn't work"
→ Implement backend `POST /api/gmail/import` endpoint

### "Token expired"
→ Implement backend `POST /api/gmail/refresh-token` endpoint

### "CORS error"
→ Configure backend CORS headers for `http://localhost:5173`

---

## ✅ Testing Checklist

```
[ ] User can click Shop Sales button
[ ] Unauthorized users redirected to login
[ ] Authorized users see Gmail component
[ ] Can toggle between Inline and Modal mode
[ ] Can click "Authorize Gmail"
[ ] Redirected to Google consent screen
[ ] After granting permission, messages load
[ ] Can select/deselect individual messages
[ ] Can click "Select All"
[ ] Can click "Import X Messages"
[ ] Backend receives request
[ ] Import succeeds
[ ] History updates
[ ] Modal closes (if modal mode)
[ ] Error handling works
[ ] Responsive on mobile/tablet
```

---

## 🚀 Deployment Checklist

```
Frontend
[ ] All env vars set
[ ] No console errors
[ ] Responsive design tested
[ ] Error messages clear
[ ] Loading states visible

Backend
[ ] All 3 endpoints implemented
[ ] JWT validation working
[ ] Gmail API integration done
[ ] Database schema created
[ ] Error handling complete
[ ] Rate limiting implemented
[ ] Logging enabled

Integration
[ ] Frontend ↔ Backend communication works
[ ] OAuth flow end-to-end tested
[ ] Import processing verified
[ ] Error scenarios handled
[ ] Security review passed
```

---

## 📱 Responsive Breakpoints

- **Desktop**: ≥1025px (full layout + sidebar)
- **Tablet**: 768px - 1024px (single column)
- **Mobile**: 481px - 767px (compact layout)
- **Small**: ≤480px (minimal layout)

Test with Chrome DevTools device emulation.

---

## 🔑 Key Technologies

| Component | Technology |
|-----------|-----------|
| Frontend | React 18+ |
| Routing | React Router v6+ |
| HTTP | axios |
| Auth | JWT + OAuth 2.0 |
| Gmail | Google Gmail API v1 |
| Styling | CSS3 (no frameworks) |
| State | React Hooks (useState) |

---

## 📞 Common Questions

### Q: Can users have multiple Gmail accounts?
A: Current implementation supports one Gmail account per user. For multiple accounts, store multiple tokens in database.

### Q: How long do tokens last?
A: Access tokens valid for ~1 hour. Refresh tokens valid until revoked. Implement refresh mechanism.

### Q: Where is data saved?
A: Import history in localStorage (client). Extracted data should be saved in backend database.

### Q: Can we parse different email formats?
A: Yes! Implement custom parsing in `extractSalesData()` function for your email format.

### Q: How do we handle failed imports?
A: Failed messages returned in response with error reason. Display to user for retry.

### Q: Is Gmail data encrypted?
A: Access tokens should be encrypted on backend. Implement encryption-at-rest for stored data.

---

## 🎓 Learning Resources

- [React Documentation](https://react.dev)
- [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
- [Gmail API Reference](https://developers.google.com/gmail/api/reference/rest/v1)
- [MDN Web Docs](https://developer.mozilla.org)

---

## 🎯 Next Steps

1. **Week 1**: Implement backend endpoints
2. **Week 2**: Test OAuth flow end-to-end
3. **Week 3**: Deploy to staging
4. **Week 4**: Security review & optimization

---

## 📋 Version Info

- **Implementation Version**: 1.0
- **Created**: 2024
- **Frontend Status**: ✅ Complete
- **Backend Status**: ⏳ To Do
- **Documentation**: ✅ Complete

---

## 👥 Support

For questions or issues:
1. Check `IMPLEMENTATION_SUMMARY.md` for overview
2. Check specific documentation file for your topic
3. Review code comments in components
4. Check error messages and logs

---

**Keep this guide handy for quick reference!** 🚀

---

**Last Updated**: 2024
