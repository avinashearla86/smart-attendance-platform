import cv2
# pyrefly: ignore [missing-import]
import mediapipe as mp
import numpy as np
import logging

logger = logging.getLogger("liveness_service")

# Eye landmark indices in MediaPipe Face Mesh
# Left eye
LEFT_EYE_HORIZONTAL = (33, 133)
LEFT_EYE_VERTICAL = [(160, 144), (158, 153)]

# Right eye
RIGHT_EYE_HORIZONTAL = (362, 263)
RIGHT_EYE_VERTICAL = [(385, 373), (387, 380)]

class BlinkStateMachine:
    """
    State machine to track a double-blink sequence.
    States:
      - 'OPEN_1': Starting state, waiting for the first eye closure.
      - 'CLOSED_1': Eye is closed for the first time.
      - 'OPEN_2': Eye reopened (first blink completed), waiting for second closure.
      - 'CLOSED_2': Eye is closed for the second time.
      - 'OPEN_3': Eye reopened (second blink completed) -> SUCCESS/VERIFIED.
    """
    def __init__(self, ear_threshold: float = 0.22):
        self.ear_threshold = ear_threshold
        self.state = "OPEN_1"
        self.blink_count = 0
        self.is_verified = False

    def update(self, ear: float) -> dict:
        is_closed = ear < self.ear_threshold

        if self.state == "OPEN_1":
            if is_closed:
                self.state = "CLOSED_1"
        elif self.state == "CLOSED_1":
            if not is_closed:
                self.state = "OPEN_2"
                self.blink_count = 1
        elif self.state == "OPEN_2":
            if is_closed:
                self.state = "CLOSED_2"
        elif self.state == "CLOSED_2":
            if not is_closed:
                self.state = "OPEN_3"
                self.blink_count = 2
                self.is_verified = True

        return {
            "state": self.state,
            "blink_count": self.blink_count,
            "is_verified": self.is_verified
        }

    def reset(self):
        self.state = "OPEN_1"
        self.blink_count = 0
        self.is_verified = False


class LivenessService:
    def __init__(self):
        self.mp_face_mesh = mp.solutions.face_mesh
        # We set refine_landmarks=True to get detailed eye & iris contours
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )

    def calculate_euclidean_distance(self, p1, p2) -> float:
        return float(np.linalg.norm(p1 - p2))

    def calculate_ear(self, landmarks, eye_horizontal_idx, eye_vertical_indices) -> float:
        """
        Calculates Eye Aspect Ratio (EAR) for a single eye.
        Formula: EAR = (||p_v1_top - p_v1_bottom|| + ||p_v2_top - p_v2_bottom||) / (2 * ||p_h_left - p_h_right||)
        """
        # Horizontal points
        p_h1 = np.array([landmarks[eye_horizontal_idx[0]].x, landmarks[eye_horizontal_idx[0]].y])
        p_h2 = np.array([landmarks[eye_horizontal_idx[1]].x, landmarks[eye_horizontal_idx[1]].y])
        
        # Vertical pairs
        v1_top, v1_bottom = eye_vertical_indices[0]
        v2_top, v2_bottom = eye_vertical_indices[1]
        
        p_v1_top = np.array([landmarks[v1_top].x, landmarks[v1_top].y])
        p_v1_bottom = np.array([landmarks[v1_bottom].x, landmarks[v1_bottom].y])
        
        p_v2_top = np.array([landmarks[v2_top].x, landmarks[v2_top].y])
        p_v2_bottom = np.array([landmarks[v2_bottom].x, landmarks[v2_bottom].y])
        
        # Distances
        dist_h = self.calculate_euclidean_distance(p_h1, p_h2)
        dist_v1 = self.calculate_euclidean_distance(p_v1_top, p_v1_bottom)
        dist_v2 = self.calculate_euclidean_distance(p_v2_top, p_v2_bottom)
        
        if dist_h == 0:
            return 0.0
            
        ear = (dist_v1 + dist_v2) / (2.0 * dist_h)
        return ear

    def process_frame(self, frame_np: np.ndarray, state_machine: BlinkStateMachine) -> dict:
        """
        Processes a single frame, extracts EAR, and updates the blink state machine.
        Args:
            frame_np: OpenCV image in BGR format
            state_machine: BlinkStateMachine instance for the current session
        Returns:
            dict containing metrics (EAR, status, blink count, liveness verification status)
        """
        # Convert BGR to RGB
        rgb_frame = cv2.cvtColor(frame_np, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb_frame)

        if not results.multi_face_landmarks:
            return {
                "face_detected": False,
                "ear": 0.0,
                "state": state_machine.state,
                "blink_count": state_machine.blink_count,
                "is_verified": state_machine.is_verified,
                "message": "No face detected"
            }

        # Take the first detected face
        face_landmarks = results.multi_face_landmarks[0].landmark

        # Calculate EAR for both eyes
        left_ear = self.calculate_ear(face_landmarks, LEFT_EYE_HORIZONTAL, LEFT_EYE_VERTICAL)
        right_ear = self.calculate_ear(face_landmarks, RIGHT_EYE_HORIZONTAL, RIGHT_EYE_VERTICAL)
        
        # Average EAR
        avg_ear = (left_ear + right_ear) / 2.0

        # Update blink state machine
        status = state_machine.update(avg_ear)

        return {
            "face_detected": True,
            "ear": round(avg_ear, 4),
            "state": status["state"],
            "blink_count": status["blink_count"],
            "is_verified": status["is_verified"],
            "message": "Success"
        }
