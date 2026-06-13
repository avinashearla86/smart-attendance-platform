from sqlalchemy import Column, Integer, String, DateTime, Float, Boolean, ForeignKey, func
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=True)
    role = Column(String, default="Employee", nullable=False)
    department = Column(String, default="General", nullable=False)
    face_embedding = Column(Vector(128), nullable=True) # 128-dimensional embedding
    created_at = Column(DateTime, server_default=func.now())

    attendances = relationship("Attendance", back_populates="user", cascade="all, delete-orphan")

class Attendance(Base):
    __tablename__ = "attendances"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    timestamp = Column(DateTime, server_default=func.now(), nullable=False)
    status = Column(String, nullable=False)  # 'present', 'late', 'absent'
    risk_score = Column(Float, nullable=False)  # Late arrival risk probability (0.0 to 1.0)
    liveness_verified = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    user = relationship("User", back_populates="attendances")
