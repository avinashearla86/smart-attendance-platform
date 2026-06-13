import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv
# pyrefly: ignore [missing-import]
import bcrypt

# Load environment variables from .env file
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set in environment or .env file")

# If running inside docker, default host might be 'db'
if os.getenv("RUNNING_IN_DOCKER") == "true":
    DATABASE_URL = DATABASE_URL.replace("localhost:5433", "db:5432")
    DATABASE_URL = DATABASE_URL.replace("localhost", "db")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """Initializes the database: ensures pgvector extension is created, tables exist, migrations run, and default admin is seeded."""
    from .models import User, Attendance
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
        conn.commit()
    
    Base.metadata.create_all(bind=engine)

    # Perform schema migrations dynamically if columns are missing
    with engine.connect() as conn:
        # Check column existence using system catalogs for 'users' table
        result = conn.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name='users';"
        )).fetchall()
        existing_columns = {row[0] for row in result}
        
        mutated = False
        if "hashed_password" not in existing_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN hashed_password VARCHAR;"))
            mutated = True
        if "role" not in existing_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR DEFAULT 'Employee' NOT NULL;"))
            mutated = True
        if "department" not in existing_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN department VARCHAR DEFAULT 'General' NOT NULL;"))
            mutated = True
            
        if mutated:
            conn.commit()
            
    # Seed default Admin account if no users exist
    
    db = SessionLocal()
    try:
        from .models import User
        # Seed admin if no Admin role exists
        admin_exists = db.query(User).filter(User.role == "Admin").first()
        if not admin_exists:
            default_admin_email = "admin@company.com"
            existing_user = db.query(User).filter(User.email == default_admin_email).first()
            if not existing_user:
                hashed_pw = bcrypt.hashpw("adminpassword".encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
                admin_user = User(
                    name="System Admin",
                    email=default_admin_email,
                    hashed_password=hashed_pw,
                    role="Admin",
                    department="Administration"
                )
                db.add(admin_user)
                db.commit()
    except Exception as e:
        print(f"Error seeding admin: {e}")
        db.rollback()
    finally:
        db.close()
