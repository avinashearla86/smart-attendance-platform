import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  TrendingDown, Users, Clock, Calendar, Download, AlertTriangle, ShieldAlert
} from "lucide-react";
import styles from "../styles/Analytics.module.css";

// Colors for Department PieChart distribution
const COLORS = ["#06b6d4", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#3b82f6"];

export default function AnalyticsDashboard() {
  const [token, setToken] = useState(localStorage.getItem("admin_token") || "");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const fetchAnalytics = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axios.get("http://localhost:8000/api/analytics/workforce-summary", {
        headers: { Authorization: `Bearer ${token}` }
      });
      setData(response.data);
    } catch (err) {
      console.error("Failed to fetch analytics", err);
      setError(err.response?.data?.detail || "Failed to load analytics metrics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Check local storage updates periodically in case user logs in on another tab
    const handleStorageChange = () => {
      const currentToken = localStorage.getItem("admin_token");
      if (currentToken !== token) {
        setToken(currentToken || "");
      }
    };

    window.addEventListener("storage", handleStorageChange);
    // Interval check for tab navigation synchronization
    const interval = setInterval(handleStorageChange, 1000);

    if (token) {
      fetchAnalytics();
    }

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, [token]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await axios.get("http://localhost:8000/api/attendance/export", {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "blob"
      });

      // Create downloadable link
      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `AURA_Attendance_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed", err);
      alert("Failed to export attendance logs.");
    } finally {
      setExporting(false);
    }
  };

  if (!token) {
    return (
      <div className={styles.lockContainer}>
        <div className={styles.lockCard}>
          <ShieldAlert size={40} className={styles.lockIcon} />
          <h2 className={styles.lockTitle}>Analytics Restricted</h2>
          <p className={styles.lockSubtitle}>
            Please authenticate using the **Admin Panel** tab to access the workforce metrics dashboard.
          </p>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return <div className={styles.loading}>Querying workforce analytics dashboard...</div>;
  }

  if (error) {
    return (
      <div className={styles.errorCard}>
        <AlertTriangle size={24} style={{ color: "#ef4444" }} />
        <span>{error}</span>
        <button onClick={fetchAnalytics} className={styles.retryBtn}>Retry</button>
      </div>
    );
  }

  const summary = data?.summary || {
    total_employees: 0,
    present_today: 0,
    absent_today: 0,
    attendance_percentage: 0.0,
    late_today: 0,
    monthly_avg_attendance: 0.0,
    monthly_avg_late: 0.0
  };

  const trends = data?.trends || [];
  const deptDist = data?.department_distribution || [];

  return (
    <div className={styles.dashboardContainer}>
      {/* Dashboard Header */}
      <div className={styles.dashHeader}>
        <div>
          <h2 className={styles.dashTitle}>Workforce Analytics</h2>
          <p className={styles.dashSubtitle}>Real-time employee metrics, attendance rates, and late trends</p>
        </div>
        
        <button
          onClick={handleExport}
          className={styles.exportBtn}
          disabled={exporting}
        >
          <Download size={16} />
          {exporting ? "Generating Report..." : "Export Excel Report"}
        </button>
      </div>

      {/* Grid of KPI Summary Cards */}
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiFlex}>
            <div>
              <span className={styles.kpiLabel}>Daily Attendance</span>
              <h3 className={styles.kpiValue}>{summary.attendance_percentage}%</h3>
            </div>
            <div className={`${styles.kpiIconBox} ${styles.blueBox}`}>
              <Calendar size={20} />
            </div>
          </div>
          <span className={styles.kpiSubText}>
            {summary.present_today} of {summary.total_employees} present today
          </span>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiFlex}>
            <div>
              <span className={styles.kpiLabel}>Today's Late Check-Ins</span>
              <h3 className={styles.kpiValue} style={{ color: summary.late_today > 0 ? "#f59e0b" : "#f8fafc" }}>
                {summary.late_today}
              </h3>
            </div>
            <div className={`${styles.kpiIconBox} ${styles.orangeBox}`}>
              <Clock size={20} />
            </div>
          </div>
          <span className={styles.kpiSubText}>Requires arrival pattern audit</span>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiFlex}>
            <div>
              <span className={styles.kpiLabel}>General Absenteeism</span>
              <h3 className={styles.kpiValue} style={{ color: summary.absent_today > 0 ? "#ef4444" : "#f8fafc" }}>
                {summary.absent_today}
              </h3>
            </div>
            <div className={`${styles.kpiIconBox} ${styles.redBox}`}>
              <TrendingDown size={20} />
            </div>
          </div>
          <span className={styles.kpiSubText}>Absentees without logs today</span>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiFlex}>
            <div>
              <span className={styles.kpiLabel}>Monthly Attendance Avg</span>
              <h3 className={styles.kpiValue}>{summary.monthly_avg_attendance}%</h3>
            </div>
            <div className={`${styles.kpiIconBox} ${styles.greenBox}`}>
              <Users size={20} />
            </div>
          </div>
          <span className={styles.kpiSubText}>
            {summary.monthly_avg_late.toFixed(1)} daily lates avg
          </span>
        </div>
      </div>

      {/* Recharts Graphical Visuals Grid */}
      <div className={styles.chartsGrid}>
        {/* Trend Area / LineChart */}
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Absenteeism & Attendance Trends (Last 7 Days)</h3>
          <div className={styles.chartWrapper}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15, 23, 42, 0.95)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "10px"
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                <Line
                  type="monotone"
                  dataKey="attendance_rate"
                  name="Attendance Rate (%)"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  activeDot={{ r: 6 }}
                />
                <Line
                  type="monotone"
                  dataKey="absent"
                  name="Absent Count"
                  stroke="#ef4444"
                  strokeWidth={1.5}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Late Check-Ins / BarChart */}
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Daily Late Arrival Audits</h3>
          <div className={styles.chartWrapper}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15, 23, 42, 0.95)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "10px"
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                <Bar dataKey="late" name="Late Count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Department Pie Chart Distribution */}
        <div className={styles.chartCard} style={{ gridColumn: "span 2" }}>
          <h3 className={styles.chartTitle}>Department Attendance Shares (Today)</h3>
          <div className={styles.pieFlexWrapper}>
            <div className={styles.pieChartContainer}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={deptDist}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {deptDist.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "rgba(15, 23, 42, 0.95)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "10px"
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            
            {/* Custom Premium Legend */}
            <div className={styles.pieLegend}>
              {deptDist.map((entry, index) => {
                const color = COLORS[index % COLORS.length];
                return (
                  <div key={entry.name} className={styles.legendItem}>
                    <div className={styles.colorIndicator} style={{ background: color }} />
                    <span className={styles.legendName}>{entry.name}</span>
                    <span className={styles.legendValue}>{entry.value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
