import React, { useState, useEffect } from "react";
import axios from "axios";
import { Shield, Lock, User, Trash2, Edit2, LogOut, Check, AlertCircle, X, Save } from "lucide-react";
import styles from "../styles/AdminCrud.module.css";

export default function AdminCrud({ onCrudChange }) {
  const [token, setToken] = useState(localStorage.getItem("admin_token") || "");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [loginError, setLoginError] = useState("");
  
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [isError, setIsError] = useState(false);

  // Edit modal state
  const [editingUser, setEditingUser] = useState(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editDept, setEditDept] = useState("");
  const [editPassword, setEditPassword] = useState("");

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await axios.get("http://localhost:8000/api/users");
      setUsers(response.data);
    } catch (err) {
      console.error("Failed to fetch users", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchUsers();
    }
  }, [token]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    try {
      const response = await axios.post("http://localhost:8000/api/auth/login", {
        email: emailInput,
        password: passwordInput,
      });
      const jwtToken = response.data.access_token;
      localStorage.setItem("admin_token", jwtToken);
      setToken(jwtToken);
      setEmailInput("");
      setPasswordInput("");
    } catch (err) {
      console.error("Login failed", err);
      setLoginError(err.response?.data?.detail || "Invalid login credentials.");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_token");
    setToken("");
    setUsers([]);
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete profile: ${name}?`)) return;
    
    setActionMessage("");
    setIsError(false);
    try {
      await axios.delete(`http://localhost:8000/api/users/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setIsError(false);
      setActionMessage(`Profile '${name}' successfully deleted.`);
      fetchUsers();
      if (onCrudChange) onCrudChange();
    } catch (err) {
      console.error("Delete failed", err);
      setIsError(true);
      setActionMessage(err.response?.data?.detail || "Failed to delete user.");
    }
  };

  const startEdit = (user) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditRole(user.role);
    setEditDept(user.department);
    setEditPassword("");
  };

  const cancelEdit = () => {
    setEditingUser(null);
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    setActionMessage("");
    setIsError(false);
    
    const updatePayload = {
      name: editName,
      email: editEmail,
      role: editRole,
      department: editDept,
    };
    if (editPassword) {
      updatePayload.password = editPassword;
    }

    try {
      await axios.put(`http://localhost:8000/api/users/${editingUser.id}`, updatePayload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setIsError(false);
      setActionMessage(`Profile updated successfully.`);
      setEditingUser(null);
      fetchUsers();
      if (onCrudChange) onCrudChange();
    } catch (err) {
      console.error("Update failed", err);
      setIsError(true);
      setActionMessage(err.response?.data?.detail || "Failed to update profile.");
    }
  };

  // If not logged in, render Login UI
  if (!token) {
    return (
      <div className={styles.loginContainer}>
        <div className={styles.loginCard}>
          <div className={styles.iconHeader}>
            <Shield size={36} className={styles.shieldIcon} />
          </div>
          <h2 className={styles.loginTitle}>Admin Authentication</h2>
          <p className={styles.loginSubtitle}>Sign in to manage employees & analytics</p>

          <form onSubmit={handleLogin} className={styles.loginForm}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Email Address</label>
              <div className={styles.inputWrapper}>
                <User size={16} className={styles.inputIcon} />
                <input
                  type="email"
                  className={styles.input}
                  placeholder="admin@company.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Password</label>
              <div className={styles.inputWrapper}>
                <Lock size={16} className={styles.inputIcon} />
                <input
                  type="password"
                  className={styles.input}
                  placeholder="••••••••"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  required
                />
              </div>
            </div>

            {loginError && (
              <div className={styles.errorBanner}>
                <AlertCircle size={16} />
                <span>{loginError}</span>
              </div>
            )}

            <button type="submit" className={styles.submitBtn}>
              Authenticate Securely
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.crudContainer}>
      {/* Header Controls */}
      <div className={styles.crudHeader}>
        <div>
          <h2 className={styles.title}>Employee Directory</h2>
          <p className={styles.subtitle}>Administrative controls for role/department updates</p>
        </div>
        <button className={styles.logoutBtn} onClick={handleLogout}>
          <LogOut size={16} /> Log Out
        </button>
      </div>

      {actionMessage && (
        <div className={`${styles.statusBanner} ${isError ? styles.bannerError : styles.bannerSuccess}`}>
          {isError ? <AlertCircle size={16} /> : <Check size={16} />}
          <span>{actionMessage}</span>
          <button className={styles.closeBanner} onClick={() => setActionMessage("")}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main Directory Table */}
      <div className={styles.tableCard}>
        {loading && users.length === 0 ? (
          <div className={styles.loadingState}>Querying workforce database...</div>
        ) : users.length === 0 ? (
          <div className={styles.loadingState}>No employees enrolled in the system.</div>
        ) : (
          <div className={styles.tableResponsive}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Role</th>
                  <th>Enrolled Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const initials = u.name
                    ? u.name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase()
                    : "U";
                  return (
                    <tr key={u.id} className={styles.tr}>
                      <td>
                        <div className={styles.userFlex}>
                          <div className={styles.avatar}>{initials}</div>
                          <div>
                            <div className={styles.name}>{u.name}</div>
                            <div className={styles.email}>{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={styles.deptBadge}>{u.department}</span>
                      </td>
                      <td>
                        <span className={`${styles.roleBadge} ${styles[`role_${u.role.toLowerCase()}`]}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className={styles.date}>
                        {new Date(u.created_at).toLocaleDateString(undefined, {
                          year: 'numeric', month: 'short', day: 'numeric'
                        })}
                      </td>
                      <td>
                        <div className={styles.actionsFlex}>
                          <button className={styles.editBtn} onClick={() => startEdit(u)} title="Edit Employee">
                            <Edit2 size={15} />
                          </button>
                          <button className={styles.deleteBtn} onClick={() => handleDelete(u.id, u.name)} title="Delete Employee">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Profile Modal */}
      {editingUser && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <h3>Modify Profile: {editingUser.name}</h3>
              <button className={styles.modalCloseBtn} onClick={cancelEdit}>
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleUpdate} className={styles.modalForm}>
              <div className={styles.formGroup}>
                <label className={styles.modalLabel}>Full Name</label>
                <input
                  type="text"
                  className={styles.modalInput}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.modalLabel}>Email Address</label>
                <input
                  type="email"
                  className={styles.modalInput}
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  required
                />
              </div>

              <div className={styles.row}>
                <div className={styles.formGroup}>
                  <label className={styles.modalLabel}>Department</label>
                  <input
                    type="text"
                    className={styles.modalInput}
                    value={editDept}
                    onChange={(e) => setEditDept(e.target.value)}
                    placeholder="e.g. Engineering, Sales"
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.modalLabel}>System Role</label>
                  <select
                    className={styles.modalSelect}
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value)}
                  >
                    <option value="Employee">Employee</option>
                    <option value="HR">HR</option>
                    <option value="Admin">Admin</option>
                  </select>
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.modalLabel}>New Password (leave empty to keep current)</label>
                <input
                  type="password"
                  className={styles.modalInput}
                  placeholder="••••••••"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                />
              </div>

              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={cancelEdit}>
                  Discard
                </button>
                <button type="submit" className={styles.saveBtn}>
                  <Save size={16} /> Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
