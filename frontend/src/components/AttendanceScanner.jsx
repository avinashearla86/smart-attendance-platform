import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Camera, RefreshCw, CheckCircle, AlertTriangle, Play, Square, Eye, Activity } from "lucide-react";
import { API_BASE_URL, WS_BASE_URL } from "../config";
import styles from "../styles/Attendance.module.css";

export default function AttendanceScanner() {
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState("idle"); // 'idle', 'connecting', 'streaming', 'verified', 'error'
  const [message, setMessage] = useState("Start camera to check in");
  
  // Real-time metrics
  const [ear, setEar] = useState(0.0);
  const [blinkCount, setBlinkCount] = useState(0);
  const [livenessState, setLivenessState] = useState("OPEN_1");
  const [isLivenessVerified, setIsLivenessVerified] = useState(false);
  
  // Final verification result
  const [result, setResult] = useState(null);
  const [recentLogs, setRecentLogs] = useState([]);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);

  // Stop video stream and clear timers
  const stopScanner = () => {
    setIsActive(false);
    setStatus("idle");
    
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const fetchRecentLogs = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/attendance/recent`);
      setRecentLogs(response.data);
    } catch (err) {
      console.error("Failed to fetch recent logs:", err);
    }
  };

  // Cleanup and log polling on mount
  useEffect(() => {
    fetchRecentLogs();
    const pollInterval = setInterval(fetchRecentLogs, 5000);
    return () => {
      stopScanner();
      clearInterval(pollInterval);
    };
  }, []);

  const startScanner = async () => {
    setResult(null);
    setIsLivenessVerified(false);
    setBlinkCount(0);
    setEar(0.0);
    setLivenessState("OPEN_1");
    setStatus("connecting");
    setMessage("Initializing video feed...");

    try {
      // 1. Get webcam stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" }
      });
      
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      setIsActive(true);
      setStatus("streaming");
      setMessage("Connecting to AI service...");

      // 2. Open WebSocket to backend
      const ws = new WebSocket(`${WS_BASE_URL}/api/ws/attendance`);
      wsRef.current = ws;

      ws.onopen = () => {
        setMessage("Align face. Blink twice to check-in!");
        
        // Start sending frames once WebSocket is open
        intervalRef.current = setInterval(captureAndSendFrame, 150);
      };

      ws.onmessage = (event) => {
        const response = JSON.parse(event.data);
        
        if (response.error) {
          setMessage(response.error);
          setStatus("error");
          stopScanner();
          return;
        }

        if (response.type === "liveness_update") {
          setEar(response.ear || 0.0);
          setBlinkCount(response.blink_count || 0);
          setLivenessState(response.state || "OPEN_1");
          setIsLivenessVerified(response.is_verified || false);
          
          if (!response.face_detected) {
            setMessage("No face detected. Look directly at the camera.");
          } else if (response.is_verified) {
            setMessage("Liveness verified! Matching face...");
          } else {
            setMessage(`Blink pattern: ${response.blink_count}/2 blinks detected.`);
          }
        }

        if (response.type === "verification_result") {
          if (response.success) {
            setStatus("verified");
            setResult({
              user: response.user,
              riskScore: response.risk_score,
              status: response.status
            });
            setMessage("Check-in successful!");
            stopScanner();
            fetchRecentLogs();
          } else {
            setMessage(response.message);
            setStatus("error");
            stopScanner();
          }
        }
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        setMessage("AI server connection failed.");
        setStatus("error");
        stopScanner();
      };

      ws.onclose = () => {
        if (status === "streaming") {
          setMessage("Connection closed by server.");
          setStatus("error");
        }
      };

    } catch (err) {
      console.error("Camera access failed:", err);
      setMessage("Camera access denied or unavailable.");
      setStatus("error");
    }
  };

  const captureAndSendFrame = () => {
    if (!videoRef.current || !canvasRef.current || !wsRef.current) return;
    if (wsRef.current.readyState !== WebSocket.OPEN) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // Copy current video frame to hidden canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Extract canvas image data as compressed JPEG base64 string
    const dataUrl = canvas.toDataURL("image/jpeg", 0.65);
    
    // Send to WebSocket
    wsRef.current.send(JSON.stringify({ frame: dataUrl }));
  };

  // Determine wrapper classes based on status
  let wrapperClass = styles.videoWrapper;
  if (status === "streaming" || status === "connecting") {
    wrapperClass += ` ${styles.videoWrapperActive}`;
  } else if (status === "verified") {
    wrapperClass += ` ${styles.videoWrapperSuccess}`;
  }

  // Determine blink badge border based on state
  let blinkBadgeClass = styles.blinkCounter;
  if (blinkCount > 0) {
    blinkBadgeClass += ` ${styles.blinkActive}`;
  }

  return (
    <div className={styles.scannerContainer}>
      <div className={styles.glassCard}>
        <h2 className={styles.title}>
          <Camera className={status === "streaming" ? styles.statusTag : ""} size={24} />
          Webcam Scanner
        </h2>
        <p className={styles.subtitle}>Phase 1/2 real-time liveness authentication</p>

        {/* Video Box */}
        <div className={wrapperClass}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={styles.videoElement}
          />
          <canvas
            ref={canvasRef}
            width="400"
            height="300"
            className={styles.canvasHidden}
          />

          {/* Scanner Overlay UI */}
          {isActive && (
            <div className={styles.scannerOverlay}>
              <div className={styles.scanLine} />
              
              <div className={`${styles.statusTag} ${isLivenessVerified ? styles.statusTagSuccess : ""}`}>
                <RefreshCw size={12} className={styles.videoElement ? "spin" : ""} style={{ animation: "spin 2s linear infinite" }} />
                {isLivenessVerified ? "Liveness Valid" : "Scanning"}
              </div>

              <div className={blinkBadgeClass}>
                <Eye size={14} />
                Blinks: {blinkCount}/2
              </div>
            </div>
          )}
        </div>

        {/* Control Button */}
        {!isActive && status !== "verified" && (
          <button className={styles.startButton} onClick={startScanner}>
            <Play size={18} /> Start Verification Scanner
          </button>
        )}

        {isActive && (
          <button className={styles.startButton} style={{ background: "#ef4444" }} onClick={stopScanner}>
            <Square size={18} /> Cancel Check-in
          </button>
        )}

        {/* Status Prompt */}
        <p className={styles.subtitle} style={{ textAlign: "center", marginTop: "16px", fontWeight: "600", color: status === "error" ? "#ef4444" : "#e2e8f0" }}>
          {message}
        </p>

        {/* Real-time telemetry indicators */}
        {isActive && (
          <div className={styles.metricsGrid}>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Eye Aspect Ratio (EAR)</span>
              <span className={styles.metricValue}>{ear.toFixed(4)}</span>
            </div>
            <div className={styles.metricItem}>
              <span className={styles.metricLabel}>Liveness Stage</span>
              <span className={styles.metricValue} style={{ color: isLivenessVerified ? "#10b981" : "#06b6d4" }}>
                {livenessState}
              </span>
            </div>
          </div>
        )}

        {/* Match Verification Results & ML prediction statistics */}
        {result && (
          <div className={styles.resultPanel}>
            <div className={styles.resultHeader}>
              <CheckCircle size={20} />
              Verification Verified
            </div>
            <div className={styles.resultRow}>
              <span className={styles.resultLabel}>User Name</span>
              <span className={styles.resultValue}>{result.user.name}</span>
            </div>
            <div className={styles.resultRow}>
              <span className={styles.resultLabel}>Email</span>
              <span className={styles.resultValue}>{result.user.email}</span>
            </div>
            <div className={styles.resultRow}>
              <span className={styles.resultLabel}>Check-In Status</span>
              <span className={`${styles.resultValue} ${result.status === "late" ? styles.statusLate : styles.statusPresent}`}>
                {result.status.toUpperCase()}
              </span>
            </div>
            <div className={styles.resultRow}>
              <span className={styles.resultLabel}>Late Arrival Risk (RF Prob)</span>
              <span className={styles.resultValue} style={{ color: result.riskScore > 0.5 ? "#ef4444" : "#10b981" }}>
                {(result.riskScore * 100).toFixed(1)}%
              </span>
            </div>
            <button className={styles.resetButton} onClick={() => { setResult(null); setStatus("idle"); setMessage("Start camera to check in"); }}>
              Scan Next User
            </button>
          </div>
        )}
      </div>

      {/* Today's Activity Feed */}
      <div className={styles.activityCard}>
        <h3 className={styles.activityTitle}>
          <Activity size={18} />
          Today's Activity Feed
        </h3>
        
        {recentLogs.length === 0 ? (
          <p className={styles.activityNoLogs}>No check-ins logged yet today.</p>
        ) : (
          <div className={styles.activityList}>
            {recentLogs.map((log) => {
              const initials = log.name
                ? log.name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase()
                : "U";
              return (
                <div key={log.id} className={styles.activityItem}>
                  <div className={styles.activityUserFlex}>
                    <div className={styles.activityAvatar}>{initials}</div>
                    <div>
                      <div className={styles.activityName}>{log.name}</div>
                      <div className={styles.activityTime}>{log.timestamp}</div>
                    </div>
                  </div>
                  <div className={styles.activityMeta}>
                    <span className={`${styles.activityBadge} ${log.status === 'late' ? styles.badgeLate : styles.badgePresent}`}>
                      {log.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
