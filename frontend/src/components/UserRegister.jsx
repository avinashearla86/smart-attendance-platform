import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import { UserPlus, Camera, Check, AlertCircle, X, ShieldAlert, RefreshCw } from "lucide-react";
import styles from "../styles/Register.module.css";

export default function UserRegister({ onRegistrationSuccess }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [photoBlob, setPhotoBlob] = useState(null);

  // Turn off camera on component unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setHasPhoto(false);
    setPhotoBlob(null);
    setStatusMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 400, height: 300, facingMode: "user" }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch (err) {
      console.error("Camera startup failed:", err);
      setIsError(true);
      setStatusMessage("Failed to access camera.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const takeSnapshot = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // Capture the frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setHasPhoto(true);
    
    // Save as blob for upload
    canvas.toBlob((blob) => {
      setPhotoBlob(blob);
    }, "image/jpeg", 0.9);

    stopCamera();
  };

  const resetPhoto = () => {
    setHasPhoto(false);
    setPhotoBlob(null);
    startCamera();
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!name || !email || !photoBlob) {
      setIsError(true);
      setStatusMessage("Please fill in all fields and take a profile photo.");
      return;
    }

    setLoading(true);
    setStatusMessage("Registering user, generating face embedding...");
    setIsError(false);

    // Prepare multipart form data
    const formData = new FormData();
    formData.append("name", name);
    formData.append("email", email);
    // Append the blob as a file named 'file'
    formData.append("file", photoBlob, `${email}_avatar.jpg`);

    try {
      const response = await axios.post("http://localhost:8000/api/users/register", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });

      if (response.data.success) {
        setIsError(false);
        setStatusMessage(response.data.message);
        
        // Reset form
        setName("");
        setEmail("");
        setHasPhoto(false);
        setPhotoBlob(null);
        
        // Trigger parent callback to refresh user list if provided
        if (onRegistrationSuccess) {
          onRegistrationSuccess();
        }
      } else {
        setIsError(true);
        setStatusMessage(response.data.message);
      }
    } catch (err) {
      console.error("Registration error:", err);
      setIsError(true);
      const detail = err.response?.data?.detail || "Network request failed.";
      setStatusMessage(`Registration failed: ${detail}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.registerCard}>
      <h2 className={styles.title}>
        <UserPlus size={24} /> Register Profile
      </h2>
      <p className={styles.subtitle}>Enrolls 128D geometric facial fingerprint</p>

      <form className={styles.form} onSubmit={handleRegister}>
        {/* Name Input */}
        <div className={styles.formGroup}>
          <label className={styles.label}>Full Name</label>
          <input
            className={styles.input}
            type="text"
            placeholder="John Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        {/* Email Input */}
        <div className={styles.formGroup}>
          <label className={styles.label}>Email Address</label>
          <input
            className={styles.input}
            type="email"
            placeholder="john.doe@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        {/* Snapshot / Camera Area */}
        <div className={styles.formGroup}>
          <label className={styles.label}>Face Photo Enrollment</label>
          <div className={styles.snapshotArea}>
            <div className={styles.webcamWrapper}>
              {/* Live Video View */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={styles.videoElement}
                style={{ display: cameraActive && !hasPhoto ? "block" : "none" }}
              />

              {/* Static Canvas Capture Preview */}
              <canvas
                ref={canvasRef}
                width="400"
                height="300"
                className={styles.previewCanvas}
                style={{ display: hasPhoto ? "block" : "none" }}
              />

              {/* Camera Stopped Placeholder */}
              {!cameraActive && !hasPhoto && (
                <div className={styles.placeholderBox}>
                  <Camera size={36} />
                  <span className={styles.placeholderText}>Camera is turned off</span>
                </div>
              )}
            </div>

            {/* Camera Action Buttons */}
            <div className={styles.captureControls}>
              {!cameraActive && !hasPhoto && (
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={startCamera}
                  disabled={loading}
                >
                  <Camera size={16} /> Open Camera
                </button>
              )}

              {cameraActive && !hasPhoto && (
                <>
                  <button
                    type="button"
                    className={`${styles.actionButton} ${styles.captureBtn}`}
                    onClick={takeSnapshot}
                  >
                    <Check size={16} /> Capture Photo
                  </button>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={stopCamera}
                    style={{ color: "#ef4444" }}
                  >
                    <X size={16} /> Close
                  </button>
                </>
              )}

              {hasPhoto && (
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={resetPhoto}
                  disabled={loading}
                >
                  <RefreshCw size={16} /> Retake Photo
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Register Submit Button */}
        <button
          type="submit"
          className={styles.submitBtn}
          disabled={loading || !name || !email || !photoBlob}
        >
          <UserPlus size={18} /> Register Employee Profile
        </button>
      </form>

      {/* Success/Error Status Notifications */}
      {statusMessage && (
        <div
          className={`${styles.message} ${
            isError ? styles.messageError : styles.messageSuccess
          }`}
        >
          {isError ? (
            <AlertCircle size={16} style={{ marginRight: "8px", verticalAlign: "middle" }} />
          ) : (
            <Check size={16} style={{ marginRight: "8px", verticalAlign: "middle" }} />
          )}
          {statusMessage}
        </div>
      )}
    </div>
  );
}
