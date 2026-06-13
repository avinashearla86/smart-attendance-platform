import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
import pickle
import os
import logging

logger = logging.getLogger("risk_model")

MODEL_PATH = os.path.join(os.path.dirname(__file__), "late_risk_model.pkl")

class RiskModelService:
    def __init__(self):
        self.model = None
        self.load_or_train_model()

    def generate_synthetic_data(self, num_samples: int = 1500) -> pd.DataFrame:
        """
        Generates a synthetic historical dataset for training.
        Features:
          - day_of_week: 0 (Monday) to 6 (Sunday)
          - hour: 0 to 23
          - minute: 0 to 59
          - avg_historical_delay: average delay in minutes for the user (0.0 to 45.0)
        Target:
          - is_late: 1 if check-in time is after 09:00, 0 otherwise.
        """
        np.random.seed(42)
        
        # 1. Day of the week (mostly weekdays 0-4, fewer weekends 5-6)
        day_of_week = np.random.choice(7, size=num_samples, p=[0.18, 0.18, 0.18, 0.18, 0.18, 0.05, 0.05])
        
        # 2. Average historical delay (minutes)
        avg_historical_delay = np.random.exponential(scale=10.0, size=num_samples)
        avg_historical_delay = np.clip(avg_historical_delay, 0, 45)
        
        # 3. Check-in minutes from midnight
        # Base check-in centered around 08:45 AM (525 minutes) with some variance
        base_checkin = np.random.normal(loc=525.0, scale=20.0, size=num_samples)
        
        # Add historical delay influence to the check-in time
        # Higher historical delay shifts check-in later
        checkin_minutes = base_checkin + (avg_historical_delay * 0.8)
        
        # Mondays (0) and Fridays (4) have slightly later check-ins (add 5 minutes)
        checkin_minutes += np.where((day_of_week == 0) | (day_of_week == 4), 5.0, 0.0)
        
        # Extract hours and minutes
        hour = (checkin_minutes // 60).astype(int)
        minute = (checkin_minutes % 60).astype(int)
        
        # Ensure hours/minutes stay in valid boundaries
        hour = np.clip(hour, 0, 23)
        minute = np.clip(minute, 0, 59)
        
        # 4. Target: late threshold is 09:00 AM (540 minutes from midnight)
        actual_checkin_minutes = hour * 60 + minute
        is_late = (actual_checkin_minutes > 540).astype(int)
        
        df = pd.DataFrame({
            "day_of_week": day_of_week,
            "hour": hour,
            "minute": minute,
            "avg_historical_delay": avg_historical_delay,
            "is_late": is_late
        })
        
        return df

    def train_model(self):
        """Generates synthetic data and trains the RandomForestClassifier."""
        logger.info("Generating synthetic data for Random Forest training...")
        df = self.generate_synthetic_data()
        
        X = df[["day_of_week", "hour", "minute", "avg_historical_delay"]]
        y = df["is_late"]
        
        logger.info("Training RandomForestClassifier...")
        model = RandomForestClassifier(n_estimators=100, max_depth=6, random_state=42)
        model.fit(X, y)
        
        self.model = model
        
        # Save model to disk
        try:
            with open(MODEL_PATH, "wb") as f:
                pickle.dump(model, f)
            logger.info(f"Model successfully saved to {MODEL_PATH}")
        except Exception as e:
            logger.error(f"Failed to save model: {e}")

    def load_or_train_model(self):
        """Loads model from disk or trains a new one if not found."""
        if os.path.exists(MODEL_PATH):
            try:
                with open(MODEL_PATH, "rb") as f:
                    self.model = pickle.load(f)
                logger.info("Successfully loaded pre-trained Random Forest model.")
            except Exception as e:
                logger.warning(f"Failed to load model from disk: {e}. Re-training...")
                self.train_model()
        else:
            self.train_model()

    def predict_late_risk(self, day_of_week: int, hour: int, minute: int, avg_historical_delay: float) -> float:
        """
        Predicts the probability of being late.
        Returns:
            probability (float between 0.0 and 1.0)
        """
        if self.model is None:
            logger.error("Model is not initialized.")
            return 0.5
            
        features = [[day_of_week, hour, minute, avg_historical_delay]]
        # predict_proba returns [prob_on_time, prob_late]
        probs = self.model.predict_proba(features)
        late_prob = float(probs[0][1])
        return round(late_prob, 4)
