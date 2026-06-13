import os
# pyrefly: ignore [missing-import]
import cv2
import base64
import numpy as np
import logging
from datetime import datetime, timedelta, date
# pyrefly: ignore [missing-import]
import jwt
# pyrefly: ignore [missing-import]
from passlib.context import CryptContext
# pyrefly: ignore [missing-import]
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, WebSocket, WebSocketDisconnect, status
# pyrefly: ignore [missing-import]
from fastapi.security import OAuth2PasswordBearer
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from fastapi.responses import StreamingResponse
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import Session
from typing import List, Optional

logger = logging.getLogger("app")

from .database import get_db, init_db
from .models import User, Attendance
from .schemas import UserResponse, RegistrationResult, VerificationResult, UserLogin, Token, UserUpdate
from .services.liveness import LivenessService, BlinkStateMachine
from .services.face_embed import FaceEmbeddingService
from .services.risk_model import RiskModelService

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise ValueError("SECRET_KEY environment variable is not set in environment or .env file")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "180"))

# pyrefly: ignore [missing-import]
import bcrypt
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login", auto_error=False)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def create_access_token(data: dict, expires_delta: timedelta = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
    
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception
    return user

def require_role(allowed_roles: list[str]):
    def dependency(current_user: User = Depends(get_current_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Permission denied. Required role: one of {allowed_roles}"
            )
        return current_user
    return dependency

app = FastAPI(title="Smart Attendance Platform API")

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize services
liveness_service = LivenessService()
face_embed_service = FaceEmbeddingService()
risk_model_service = RiskModelService()

@app.on_event("startup")
def on_startup():
    init_db()

def decode_image_file(file: UploadFile) -> np.ndarray:
    """Decodes uploaded image file to OpenCV format."""
    try:
        contents = file.file.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Decoded image is None")
        return img
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image file: {str(e)}")

def decode_base64_image(base64_data: str) -> np.ndarray:
    """Decodes base64 string image to OpenCV format."""
    try:
        if "," in base64_data:
            base64_data = base64_data.split(",")[1]
        img_bytes = base64.b64decode(base64_data)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Decoded image is None")
        return img
    except Exception as e:
        raise ValueError(f"Failed to decode base64 image: {str(e)}")

def calculate_user_historical_delay(db: Session, user_id: int) -> float:
    """Calculates the user's average delay past 09:00 AM in minutes."""
    records = db.query(Attendance).filter(Attendance.user_id == user_id).all()
    if not records:
        return 0.0
    
    delays = []
    for r in records:
        # Check-in time on that day
        checkin_time = r.timestamp
        # Target start time on that day (09:00 AM)
        target_time = checkin_time.replace(hour=9, minute=0, second=0, microsecond=0)
        
        # Calculate delay in minutes (positive values represent late)
        diff_minutes = (checkin_time - target_time).total_seconds() / 60.0
        # If checked in early, delay is 0
        delays.append(max(0.0, diff_minutes))
        
    return float(np.mean(delays))

@app.post("/api/users/register", response_model=RegistrationResult)
def register_user(
    name: str = Form(...),
    email: str = Form(...),
    password: Optional[str] = Form(None),
    role: Optional[str] = Form("Employee"),
    department: Optional[str] = Form("General"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    # Check if user already exists
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        return RegistrationResult(success=False, message="Email already registered")

    # Read and decode image
    img = decode_image_file(file)

    # Extract face embedding
    embedding = face_embed_service.extract_embedding(img)
    if embedding is None:
        return RegistrationResult(success=False, message="No face detected. Please try another photo.")

    # Hash password if provided
    hashed_pw = get_password_hash(password) if password else None

    # Create new user
    user = User(
        name=name, 
        email=email, 
        face_embedding=embedding,
        hashed_password=hashed_pw,
        role=role,
        department=department
    )
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
        return RegistrationResult(
            success=True, 
            message="User successfully registered", 
            user=UserResponse.from_orm(user)
        )
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/api/users", response_model=List[UserResponse])
def get_users(db: Session = Depends(get_db)):
    users = db.query(User).all()
    return [UserResponse.from_orm(u) for u in users]

@app.post("/api/attendance/check-in", response_model=VerificationResult)
def check_in(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Fallback endpoint to run identification from a single uploaded file (without real-time liveness)."""
    img = decode_image_file(file)
    embedding = face_embed_service.extract_embedding(img)
    if embedding is None:
        return VerificationResult(
            success=False,
            message="No face detected in photo",
            match_found=False,
            risk_score=0.0,
            status="absent"
        )

    # Find the user with closest face embedding utilizing pgvector cosine similarity
    distance_expr = User.face_embedding.cosine_distance(embedding)
    match = db.query(User, distance_expr.label("distance")).order_by(distance_expr).first()

    # Match threshold: 0.35 for cosine distance
    if not match or match.distance > 0.35:
        return VerificationResult(
            success=False,
            message="Face match not found",
            match_found=False,
            risk_score=0.0,
            status="absent"
        )

    user, distance = match
    now = datetime.now()

    # Predict risk score
    avg_delay = calculate_user_historical_delay(db, user.id)
    risk_score = risk_model_service.predict_late_risk(
        day_of_week=now.weekday(),
        hour=now.hour,
        minute=now.minute,
        avg_historical_delay=avg_delay
    )

    # Determine attendance status (Threshold: 9:00 AM)
    status = "present"
    if now.hour > 9 or (now.hour == 9 and now.minute > 0):
        status = "late"

    # Log attendance
    attendance = Attendance(
        user_id=user.id,
        status=status,
        risk_score=risk_score,
        liveness_verified=False  # Single file check-in doesn't verify liveness
    )
    db.add(attendance)
    db.commit()

    return VerificationResult(
        success=True,
        message=f"Welcome {user.name}. Attendance recorded.",
        match_found=True,
        user=UserResponse.from_orm(user),
        risk_score=risk_score,
        status=status
    )

@app.websocket("/api/ws/attendance")
async def websocket_attendance(websocket: WebSocket, db: Session = Depends(get_db)):
    """Real-time liveness verification and identity logging WebSocket channel."""
    await websocket.accept()
    
    state_machine = BlinkStateMachine()
    verified_liveness = False
    
    try:
        while True:
            # Receive frame data (JSON text with base64 data)
            data = await websocket.receive_json()
            frame_data = data.get("frame")
            if not frame_data:
                await websocket.send_json({"error": "No frame data received"})
                continue
            
            try:
                frame = decode_base64_image(frame_data)
            except ValueError as ve:
                await websocket.send_json({"error": str(ve)})
                continue
            
            # Step 1: Liveness / Blink Detection
            if not verified_liveness:
                result = liveness_service.process_frame(frame, state_machine)
                
                # Report current liveness progress back to frontend
                await websocket.send_json({
                    "type": "liveness_update",
                    "face_detected": result["face_detected"],
                    "ear": result["ear"],
                    "state": result["state"],
                    "blink_count": result["blink_count"],
                    "is_verified": result["is_verified"],
                    "message": result["message"]
                })
                
                if result["is_verified"]:
                    verified_liveness = True
                    # If verified on this frame, extract embedding immediately
                    # to identify the user
                    embedding = face_embed_service.extract_embedding(frame)
                    if embedding is None:
                        await websocket.send_json({
                            "type": "verification_result",
                            "success": False,
                            "message": "Liveness verified, but failed to extract face embedding."
                        })
                        continue
                    
                    # Match user
                    distance_expr = User.face_embedding.cosine_distance(embedding)
                    match = db.query(User, distance_expr.label("distance")).order_by(distance_expr).first()
                    
                    if not match or match.distance > 0.35:
                        await websocket.send_json({
                            "type": "verification_result",
                            "success": False,
                            "message": "Liveness verified, but user identity not found."
                        })
                        continue
                    
                    user, distance = match
                    now = datetime.now()
                    
                    # Compute delay metrics and run Random Forest risk model
                    avg_delay = calculate_user_historical_delay(db, user.id)
                    risk_score = risk_model_service.predict_late_risk(
                        day_of_week=now.weekday(),
                        hour=now.hour,
                        minute=now.minute,
                        avg_historical_delay=avg_delay
                    )
                    
                    status = "present"
                    if now.hour > 9 or (now.hour == 9 and now.minute > 0):
                        status = "late"
                        
                    # Save attendance
                    attendance = Attendance(
                        user_id=user.id,
                        status=status,
                        risk_score=risk_score,
                        liveness_verified=True
                    )
                    db.add(attendance)
                    db.commit()
                    
                    await websocket.send_json({
                        "type": "verification_result",
                        "success": True,
                        "message": f"Verified successfully! Welcome, {user.name}.",
                        "user": {"id": user.id, "name": user.name, "email": user.email},
                        "risk_score": risk_score,
                        "status": status
                    })
            else:
                # Liveness is already verified, just output confirmation
                await websocket.send_json({
                    "type": "status",
                    "message": "Liveness already verified. Logged successfully."
                })
                
    except WebSocketDisconnect:
        logger.info("WebSocket connection disconnected.")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"error": f"Internal server error: {str(e)}"})
        except:
            pass

# --- Expanded Authentication & Admin CRUD Endpoints ---

@app.post("/api/auth/login", response_model=Token)
def login(login_data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == login_data.email).first()
    if not user or not verify_password(login_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid email or password")
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email, "role": user.role},
        expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/users/{id}", response_model=UserResponse)
def get_user_profile(
    id: int, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(require_role(["Admin", "HR"]))
):
    user = db.query(User).filter(User.id == id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.put("/api/users/{id}", response_model=UserResponse)
def update_user_profile(
    id: int,
    user_update: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["Admin"]))
):
    user = db.query(User).filter(User.id == id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user_update.name is not None:
        user.name = user_update.name
    if user_update.email is not None:
        existing = db.query(User).filter(User.email == user_update.email, User.id != id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")
        user.email = user_update.email
    if user_update.role is not None:
        if user_update.role not in ["Admin", "HR", "Employee"]:
            raise HTTPException(status_code=400, detail="Invalid role. Must be Admin, HR, or Employee")
        user.role = user_update.role
    if user_update.department is not None:
        user.department = user_update.department
    if user_update.password is not None:
        user.hashed_password = get_password_hash(user_update.password)
        
    try:
        db.commit()
        db.refresh(user)
        return user
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database update error: {str(e)}")

@app.delete("/api/users/{id}")
def delete_user_profile(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["Admin"]))
):
    user = db.query(User).filter(User.id == id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user.email == current_user.email:
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account")

    try:
        db.delete(user)
        db.commit()
        return {"success": True, "message": f"User '{user.name}' successfully deleted"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database deletion error: {str(e)}")

# --- Workforce Analytics & Logs Export Endpoints ---

@app.get("/api/analytics/workforce-summary")
def get_workforce_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["Admin", "HR"]))
):
    today = date.today()
    
    total_users = db.query(User).count()
    
    today_start = datetime.combine(today, datetime.min.time())
    today_end = datetime.combine(today, datetime.max.time())
    
    today_records = db.query(Attendance).filter(
        Attendance.timestamp >= today_start,
        Attendance.timestamp <= today_end
    ).all()
    
    present_user_ids = {r.user_id for r in today_records}
    present_count = len(present_user_ids)
    
    attendance_pct = (present_count / total_users * 100) if total_users > 0 else 0.0
    late_count = sum(1 for r in today_records if r.status.lower() == "late")
    absent_count = max(0, total_users - present_count)
    
    # Trends for last 7 days
    trends = []
    for i in range(6, -1, -1):
        day = today - timedelta(days=i)
        day_start = datetime.combine(day, datetime.min.time())
        day_end = datetime.combine(day, datetime.max.time())
        
        day_records = db.query(Attendance).filter(
            Attendance.timestamp >= day_start,
            Attendance.timestamp <= day_end
        ).all()
        
        day_present_ids = {r.user_id for r in day_records}
        day_present_count = len(day_present_ids)
        day_absent_count = max(0, total_users - day_present_count)
        day_late_count = sum(1 for r in day_records if r.status.lower() == "late")
        
        trends.append({
            "date": day.strftime("%b %d"),
            "present": day_present_count,
            "absent": day_absent_count,
            "late": day_late_count,
            "attendance_rate": round((day_present_count / total_users * 100), 1) if total_users > 0 else 0.0
        })
        
    # Department distribution
    dept_distribution = {}
    users = db.query(User).all()
    user_dept_map = {u.id: u.department for u in users}
    
    for uid in present_user_ids:
        dept = user_dept_map.get(uid, "General")
        dept_distribution[dept] = dept_distribution.get(dept, 0) + 1
        
    dept_data = [{"name": dept, "value": count} for dept, count in dept_distribution.items()]
    if not dept_data:
        dept_data = [{"name": "No Data", "value": 0}]

    # Monthly averages
    month_start = datetime.combine(today - timedelta(days=30), datetime.min.time())
    month_records = db.query(Attendance).filter(Attendance.timestamp >= month_start).all()
    
    daily_present_map = {}
    for r in month_records:
        r_date = r.timestamp.date()
        if r_date not in daily_present_map:
            daily_present_map[r_date] = set()
        daily_present_map[r_date].add(r.user_id)
        
    daily_rates = []
    for d, uids in daily_present_map.items():
        daily_rates.append(len(uids) / total_users * 100 if total_users > 0 else 0.0)
        
    monthly_avg_attendance = float(np.mean(daily_rates)) if daily_rates else 0.0
    monthly_avg_late = len([r for r in month_records if r.status.lower() == "late"]) / 30.0
    
    return {
        "summary": {
            "total_employees": total_users,
            "present_today": present_count,
            "absent_today": absent_count,
            "attendance_percentage": round(attendance_pct, 1),
            "late_today": late_count,
            "monthly_avg_attendance": round(monthly_avg_attendance, 1),
            "monthly_avg_late": round(monthly_avg_late, 2)
        },
        "trends": trends,
        "department_distribution": dept_data
    }

@app.get("/api/attendance/export")
def export_attendance(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["Admin", "HR"]))
):
    import io
    import pandas as pd
    
    records = db.query(Attendance, User).join(User, Attendance.user_id == User.id).order_by(Attendance.timestamp.desc()).all()
    
    data = []
    for att, user in records:
        data.append({
            "Attendance ID": att.id,
            "Employee ID": user.id,
            "Employee Name": user.name,
            "Employee Email": user.email,
            "Department": user.department,
            "Role": user.role,
            "Timestamp": att.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            "Status": att.status.upper(),
            "Liveness Verified": "YES" if att.liveness_verified else "NO",
            "Late Risk Score (%)": round(att.risk_score * 100, 1)
        })
        
    if not data:
        df = pd.DataFrame(columns=[
            "Attendance ID", "Employee ID", "Employee Name", "Employee Email", 
            "Department", "Role", "Timestamp", "Status", "Liveness Verified", "Late Risk Score (%)"
        ])
    else:
        df = pd.DataFrame(data)
        
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Attendance Logs')
    buffer.seek(0)
    
    headers = {
        'Content-Disposition': 'attachment; filename="attendance_report.xlsx"'
    }
    return StreamingResponse(
        buffer,
        headers=headers,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

@app.get("/api/attendance/recent")
def get_recent_attendance(db: Session = Depends(get_db)):
    from datetime import date
    today = date.today()
    today_start = datetime.combine(today, datetime.min.time())
    
    records = db.query(Attendance, User).join(User, Attendance.user_id == User.id)\
        .filter(Attendance.timestamp >= today_start)\
        .order_by(Attendance.timestamp.desc()).limit(5).all()
        
    return [{
        "id": att.id,
        "name": user.name,
        "email": user.email,
        "timestamp": att.timestamp.strftime("%I:%M %p"),
        "status": att.status,
        "liveness_verified": att.liveness_verified
    } for att, user in records]
