from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional, List

# User Schemas
class UserBase(BaseModel):
    name: str
    email: EmailStr

class UserCreate(UserBase):
    password: Optional[str] = None
    role: Optional[str] = "Employee"
    department: Optional[str] = "General"

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    role: Optional[str] = None
    department: Optional[str] = None

class UserResponse(UserBase):
    id: int
    role: str
    department: str
    created_at: datetime

    class Config:
        from_attributes = True

# Authentication Schemas
class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

# Attendance Schemas
class AttendanceBase(BaseModel):
    status: str
    risk_score: float
    liveness_verified: bool

class AttendanceCreate(AttendanceBase):
    user_id: int

class AttendanceResponse(BaseModel):
    id: int
    user_id: int
    timestamp: datetime
    status: str
    risk_score: float
    liveness_verified: bool
    user: Optional[UserResponse] = None

    class Config:
        from_attributes = True

# Custom response schemas
class RegistrationResult(BaseModel):
    success: bool
    message: str
    user: Optional[UserResponse] = None

class VerificationResult(BaseModel):
    success: bool
    message: str
    match_found: bool
    user: Optional[UserResponse] = None
    risk_score: float
    status: str
