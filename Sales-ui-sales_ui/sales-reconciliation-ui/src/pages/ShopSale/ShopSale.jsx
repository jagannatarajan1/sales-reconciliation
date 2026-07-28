import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import "./ShopSale.css";

const SUMMARY_URL = `${import.meta.env.VITE_API_URL || "https://localhost:7276/api"}/Summary`;

const ShopSale = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [emailBody, setEmailBody]               = useState("");
  const [targetDate, setTargetDate]             = useState(null);
  const [emailReceivedDate, setEmailReceivedDate] = useState(null);
  const [isCommitted, setIsCommitted]           = useState(false);
  const [committedMessage, setCommittedMessage] = useState("");
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState("");
  const [selectedDate, setSelectedDate]         = useState("");

  const authHeaders = () => ({ Authorization: `Bearer ${user.token}` });
  const todayStr = new Date().toISOString().split("T")[0]; // "YYYY-MM-DD" for max attr

  useEffect(() => { fetchActiveReport(); }, []);

  const resetState = () => {
    setLoading(true);
    setError("");
    setEmailBody("");
    setIsCommitted(false);
    setCommittedMessage("");
    setTargetDate(null);
    setEmailReceivedDate(null);
  };

  const applyResult = (data) => {
    if (data.isCommitted) {
      setIsCommitted(true);
      setCommittedMessage(data.message || "Values are already committed.");
      return;
    }
    setTargetDate(data.targetDate ?? null);
    if (data.email?.date) {
      const parsed = new Date(data.email.date);
      if (!isNaN(parsed)) setEmailReceivedDate(parsed.toISOString().split("T")[0]);
    }
    setEmailBody(data.email?.body ?? "");
  };

  const fetchActiveReport = async () => {
    resetState();
    try {
      const [emailRes, summaryRes] = await Promise.all([
        fetch(`${SUMMARY_URL}/zreport-email`, { headers: authHeaders() }),
        fetch(`${SUMMARY_URL}/today`,          { headers: authHeaders() }),
      ]);

      // If the day is already committed per Summary/today, show committed state
      // regardless of what zreport-email returns (the two can be out of sync)
      if (summaryRes.ok) {
        const summary = await summaryRes.json();
        if (summary.isCommitted) {
          setIsCommitted(true);
          setCommittedMessage("Values are already committed.");
          return;
        }
      }

      if (emailRes.status === 400) {
        const body = await emailRes.json().catch(() => ({}));
        setError(body.message || "No Z-report email found.");
        return;
      }
      if (!emailRes.ok) { setError("Failed to load Z-report."); return; }
      applyResult(await emailRes.json());
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const fetchReportByDate = async (dateStr) => {
    resetState();
    try {
      const res = await fetch(
        `${SUMMARY_URL}/zreport-email/by-date?date=${dateStr}`,
        { headers: authHeaders() }
      );
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        setError(body.message || "No Z-report email found for this date.");
        return;
      }
      if (!res.ok) { setError("Failed to load Z-report."); return; }
      applyResult(await res.json());
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (e) => {
    const dateStr = e.target.value;
    setSelectedDate(dateStr);
    if (dateStr) fetchReportByDate(dateStr);
  };

  const handleRefresh = () => {
    if (selectedDate) fetchReportByDate(selectedDate);
    else fetchActiveReport();
  };

  const clearDateSelection = () => {
    setSelectedDate("");
    fetchActiveReport();
  };

  const formatDate = (dateStr) =>
    dateStr
      ? new Date(dateStr).toLocaleDateString("en-GB", {
          day: "2-digit", month: "short", year: "numeric",
        })
      : "";

  const subtitle = isCommitted
    ? "Values are committed"
    : emailReceivedDate
    ? `Z-report received ${formatDate(emailReceivedDate)} — pending commit`
    : targetDate
    ? `Showing report for ${formatDate(targetDate)} — pending commit`
    : selectedDate
    ? `Showing report for ${formatDate(selectedDate)}`
    : "Latest report imported from Gmail";

  return (
    <div className="shop-sale-page">
      <div className="report-container">

        <button className="back-button" onClick={() => navigate(-1)}>
          ← Back
        </button>

        <div className="report-header">
          <h1>Z-Report Viewer</h1>
          <p>{subtitle}</p>

          <div className="date-picker-row">
            <label htmlFor="zreport-date-picker">Select Date:</label>
            <input
              id="zreport-date-picker"
              type="date"
              value={selectedDate}
              max={todayStr}
              onChange={handleDateChange}
              className="date-input"
            />
            {selectedDate && (
              <button className="active-date-btn" onClick={clearDateSelection}>
                Show Active Date
              </button>
            )}
          </div>

          <button className="refresh-btn" onClick={handleRefresh}>
            Refresh Report
          </button>
        </div>

        {loading && (
          <div className="loading-container">
            <p>Loading report...</p>
          </div>
        )}

        {!loading && isCommitted && (
          <div className="committed-notice">
            {committedMessage}
          </div>
        )}

        {!loading && error && (
          <div className="error-container">{error}</div>
        )}

        {!loading && !isCommitted && !error && emailBody && (
          <div className="report-card">
            <pre className="report-content">{emailBody}</pre>
          </div>
        )}

        {!loading && !isCommitted && !error && !emailBody && (
          <div className="error-container">
            No Z-report email found. Please ensure the plain-text Z-report has been received.
          </div>
        )}

      </div>
    </div>
  );
};

export default ShopSale;
