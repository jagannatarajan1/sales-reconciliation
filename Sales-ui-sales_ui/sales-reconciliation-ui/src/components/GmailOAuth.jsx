import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import '../styles/GmailOAuth.css';

const GMAIL_CLIENT_ID = import.meta.env.VITE_GMAIL_CLIENT_ID || 'YOUR_GMAIL_CLIENT_ID';
const GMAIL_REDIRECT_URI = import.meta.env.VITE_GMAIL_REDIRECT_URI || `${window.location.origin}/auth/gmail/callback`;
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

const todayISO = () => new Date().toISOString().split('T')[0];

export const GmailOAuth = ({ onSuccessfulImport, onClose }) => {
  const { user } = useAuth();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedMessages, setSelectedMessages] = useState([]);
  const [importing, setImporting] = useState(false);
  const [accessToken, setAccessToken] = useState(localStorage.getItem('gmail_access_token'));
  const [fetchDate, setFetchDate] = useState(todayISO());

  // Check if user has Gmail access token
  useEffect(() => {
    const token = localStorage.getItem('gmail_access_token');
    if (token) {
      setIsAuthorized(true);
      setAccessToken(token);
      fetchGmailMessages(token, fetchDate);
    }
  }, []);

  // Handle OAuth callback from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    
    if (code) {
      handleAuthorizationCode(code);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleAuthorizationCode = async (code) => {
    try {
      setLoading(true);
      setError(null);

      // Exchange authorization code for access token
      const response = await axios.post(`${API_BASE_URL}/gmail/exchange-code`, {
        code,
        redirectUri: GMAIL_REDIRECT_URI,
        userId: user?.id,
      });

      const { accessToken, refreshToken } = response.data;
      
      // Store tokens
      localStorage.setItem('gmail_access_token', accessToken);
      if (refreshToken) {
        localStorage.setItem('gmail_refresh_token', refreshToken);
      }

      setAccessToken(accessToken);
      setIsAuthorized(true);

      // Fetch messages after authorization
      await fetchGmailMessages(accessToken, fetchDate);
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message || 'Authorization failed';
      setError(errorMsg);
      console.error('Gmail authorization error:', err);
    } finally {
      setLoading(false);
    }
  };

  const startOAuthFlow = () => {
    const scope = 'https://www.googleapis.com/auth/gmail.readonly';
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    
    authUrl.searchParams.append('client_id', GMAIL_CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', GMAIL_REDIRECT_URI);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', scope);
    authUrl.searchParams.append('access_type', 'offline');
    authUrl.searchParams.append('prompt', 'consent');

    window.location.href = authUrl.toString();
  };

  const fetchGmailMessages = async (token, date) => {
    try {
      setLoading(true);
      setError(null);

      const response = await axios.get(`${API_BASE_URL}/gmail/messages`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          userId: user?.id,
          maxResults: 10,
          date,
        },
      });

      setMessages(response.data.messages || []);
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message || 'Failed to fetch messages';
      setError(errorMsg);
      console.error('Error fetching Gmail messages:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleMessageSelection = (messageId) => {
    setSelectedMessages((prev) =>
      prev.includes(messageId)
        ? prev.filter((id) => id !== messageId)
        : [...prev, messageId]
    );
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedMessages(messages.map((msg) => msg.id));
    } else {
      setSelectedMessages([]);
    }
  };

  const handleImportMessages = async () => {
    if (selectedMessages.length === 0) {
      setError('Please select at least one message to import');
      return;
    }

    try {
      setImporting(true);
      setError(null);

      const response = await axios.post(
        `${API_BASE_URL}/gmail/import`,
        {
          messageIds: selectedMessages,
          userId: user?.id,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      // Success - clear selections and notify parent
      setSelectedMessages([]);
      if (onSuccessfulImport) {
        onSuccessfulImport(response.data);
      }

      setError(null);
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message || 'Import failed';
      setError(errorMsg);
      console.error('Error importing messages:', err);
    } finally {
      setImporting(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('gmail_access_token');
    localStorage.removeItem('gmail_refresh_token');
    setIsAuthorized(false);
    setAccessToken(null);
    setMessages([]);
    setSelectedMessages([]);
    setError(null);
  };

  const handleRefreshMessages = async () => {
    if (accessToken) {
      await fetchGmailMessages(accessToken, fetchDate);
    }
  };

  const handleDateChange = async (e) => {
    const newDate = e.target.value;
    setFetchDate(newDate);
    setSelectedMessages([]);
    if (accessToken) {
      await fetchGmailMessages(accessToken, newDate);
    }
  };

  return (
    <div className="gmail-oauth-container">
      <div className="gmail-oauth-header">
        <h2>Gmail Integration</h2>
        {onClose && (
          <button className="close-button" onClick={onClose}>
            ✕
          </button>
        )}
      </div>

      {error && (
        <div className="error-banner">
          <p>{error}</p>
          <button onClick={() => setError(null)} className="close-error">×</button>
        </div>
      )}

      {!isAuthorized ? (
        <div className="authorization-section">
          <div className="authorization-content">
            <p>Authorize your Gmail account to import sales data from emails.</p>
            <button
              onClick={startOAuthFlow}
              disabled={loading}
              className="authorize-button"
            >
              {loading ? 'Authorizing...' : 'Authorize Gmail'}
            </button>
          </div>
        </div>
      ) : (
        <div className="messages-section">
          <div className="messages-header">
            <h3>Your Gmail Messages</h3>
            <div className="messages-actions">
              <button
                onClick={handleRefreshMessages}
                disabled={loading}
                className="refresh-button"
              >
                🔄 Refresh
              </button>
              <button
                onClick={handleLogout}
                className="logout-button"
              >
                Logout Gmail
              </button>
            </div>
          </div>

          <div className="gmail-date-filter">
            <label className="gmail-date-label" htmlFor="gmail-date-input">
              Fetching messages for:
            </label>
            <input
              id="gmail-date-input"
              type="date"
              value={fetchDate}
              max={todayISO()}
              onChange={handleDateChange}
              disabled={loading}
              className="gmail-date-input"
            />
          </div>

          {loading ? (
            <div className="loading-state">
              <p>Loading your messages...</p>
              <div className="spinner"></div>
            </div>
          ) : messages.length === 0 ? (
            <div className="empty-state">
              <p>No messages found in your Gmail account.</p>
            </div>
          ) : (
            <>
              <div className="messages-list">
                <div className="messages-controls">
                  <label className="select-all-label">
                    <input
                      type="checkbox"
                      checked={
                        messages.length > 0 &&
                        selectedMessages.length === messages.length
                      }
                      onChange={handleSelectAll}
                    />
                    Select All ({selectedMessages.length} selected)
                  </label>
                </div>

                <div className="messages-items">
                  {messages.map((message) => (
                    <div key={message.id} className="message-item">
                      <input
                        type="checkbox"
                        checked={selectedMessages.includes(message.id)}
                        onChange={() => handleMessageSelection(message.id)}
                      />
                      <div className="message-content">
                        <p className="message-from">
                          <strong>From:</strong> {message.from}
                        </p>
                        <p className="message-subject">
                          <strong>Subject:</strong> {message.subject}
                        </p>
                        <p className="message-date">
                          <strong>Date:</strong>{' '}
                          {new Date(message.date).toLocaleString()}
                        </p>
                        {message.preview && (
                          <p className="message-preview">{message.preview}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="messages-footer">
                <p className="selected-info">
                  {selectedMessages.length} of {messages.length} messages selected
                </p>
                <button
                  onClick={handleImportMessages}
                  disabled={
                    selectedMessages.length === 0 || importing
                  }
                  className="import-button"
                >
                  {importing ? 'Importing...' : `Import ${selectedMessages.length} Message${selectedMessages.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
