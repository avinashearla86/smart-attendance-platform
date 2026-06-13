import React, { useState, useEffect } from "react";
import axios from "axios";
import { Users, ShieldCheck, BarChart2, Settings } from "lucide-react";
import AttendanceScanner from "./components/AttendanceScanner";
import UserRegister from "./components/UserRegister";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import AdminCrud from "./components/AdminCrud";
import styles from "./styles/App.module.css";

export default function App() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("scanner"); // "scanner", "analytics", "admin"

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await axios.get("http://localhost:8000/api/users");
      setUsers(response.data);
    } catch (err) {
      console.error("Failed to fetch users:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  return (
    <div className={styles.appContainer}>
      {/* Brand Header */}
      <header className={styles.header}>
        <h1 className={styles.title}>
          <ShieldCheck style={{ verticalAlign: "middle", marginRight: "12px", display: "inline-block", color: "#06b6d4" }} size={36} />
          AURA Attendance
        </h1>
        <p className={styles.subtitle}>
          Cloud-Based Smart Attendance Platform (Phase 1 & 2 Liveness Verification)
        </p>
      </header>

      {/* Tabs Navigation */}
      <div className={styles.tabsContainer}>
        <button
          className={`${styles.tabBtn} ${activeTab === "scanner" ? styles.activeTabBtn : ""}`}
          onClick={() => setActiveTab("scanner")}
        >
          <ShieldCheck size={18} />
          Check-In Scanner
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === "analytics" ? styles.activeTabBtn : ""}`}
          onClick={() => setActiveTab("analytics")}
        >
          <BarChart2 size={18} />
          Workforce Analytics
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === "admin" ? styles.activeTabBtn : ""}`}
          onClick={() => setActiveTab("admin")}
        >
          <Settings size={18} />
          Admin Management
        </button>
      </div>

      {/* Tab Contents */}
      <div className={styles.tabContent}>
        {activeTab === "scanner" && (
          <div className={styles.dashboardGrid}>
            {/* Left Column: Live Verification Scanner */}
            <div className={styles.panel}>
              <AttendanceScanner />
            </div>

            {/* Right Column: Profile Enrollment & Employee Directory */}
            <div className={styles.panel}>
              <UserRegister onRegistrationSuccess={fetchUsers} />

              {/* Registered Employees Directory */}
              <div className={styles.directoryCard}>
                <h3 className={styles.dirTitle}>
                  <Users size={20} />
                  Enrolled Employees
                  <span className={styles.badge}>{users.length}</span>
                </h3>

                {loading && users.length === 0 ? (
                  <p className={styles.noUsers}>Loading database directory...</p>
                ) : users.length === 0 ? (
                  <p className={styles.noUsers}>No profiles enrolled. Use the form above to register your face.</p>
                ) : (
                  <div className={styles.userList}>
                    {users.map((user) => {
                      const initials = user.name
                        ? user.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .substring(0, 2)
                            .toUpperCase()
                        : "U";

                      return (
                        <div key={user.id} className={styles.userItem}>
                          <div className={styles.avatar}>{initials}</div>
                          <div className={styles.userInfo}>
                            <span className={styles.userName}>{user.name}</span>
                            <span className={styles.userEmail}>{user.email}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "analytics" && <AnalyticsDashboard />}

        {activeTab === "admin" && <AdminCrud onCrudChange={fetchUsers} />}
      </div>
    </div>
  );
}
