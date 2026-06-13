import numpy as np
import mediapipe as mp
import cv2
import logging

logger = logging.getLogger("face_embed_service")

# Key landmarks for facial geometry (40 points)
KEY_LANDMARKS = [
    1, 33, 61, 199, 263, 291, 10, 152, 109, 338, 
    70, 300, 159, 386, 145, 374, 57, 287, 87, 317,
    18, 83, 313, 17, 0, 11, 12, 13, 14, 15,
    16, 78, 308, 95, 324, 88, 318, 81, 311, 82
]

class FaceEmbeddingService:
    def __init__(self):
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5
        )
        
        # Deterministic projection matrix to map landmark measurements to a dense, robust 128D space
        # Using a fixed seed ensures the projection is identical across all runs and server restarts
        np.random.seed(99)
        self.projection_matrix = np.random.normal(0, 1, (128, 128))
        # Orthogonalize the projection matrix for better feature preservation
        q, _ = np.linalg.qr(self.projection_matrix)
        self.projection_matrix = q

    def extract_embedding(self, frame_np: np.ndarray) -> list[float] | None:
        """
        Extracts a normalized 128-dimensional embedding vector from a face image.
        Args:
            frame_np: BGR image numpy array
        Returns:
            A list of 128 floats normalized to unit length, or None if no face is detected
        """
        rgb_frame = cv2.cvtColor(frame_np, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb_frame)

        if not results.multi_face_landmarks:
            logger.warning("No face detected for embedding extraction.")
            return None

        landmarks = results.multi_face_landmarks[0].landmark
        
        # 1. Gather coordinates of key facial landmarks
        coords = []
        for idx in KEY_LANDMARKS:
            lm = landmarks[idx]
            coords.append([lm.x, lm.y, lm.z])
        coords = np.array(coords) # shape: (40, 3)
        
        # Normalize relative to head size (e.g. distance between outer boundary points 109 and 338)
        p1 = np.array([landmarks[109].x, landmarks[109].y, landmarks[109].z])
        p2 = np.array([landmarks[338].x, landmarks[338].y, landmarks[338].z])
        face_width = np.linalg.norm(p1 - p2)
        if face_width == 0:
            face_width = 1.0

        # Center coordinates around the nose tip (index 1)
        nose_tip = np.array([landmarks[1].x, landmarks[1].y, landmarks[1].z])
        coords_centered = (coords - nose_tip) / face_width

        # Flatten features (40 points * 3 coords = 120 features)
        raw_features = coords_centered.flatten()

        # 2. Add 8 pairwise distance ratios to capture facial scale-invariance (brings features to 128)
        # Pairs: (left eye - right eye), (nose - chin), (mouth width), (left eyebrow - left eye), etc.
        pairs = [
            (33, 263),   # outer eye-to-eye
            (1, 152),    # nose-to-chin
            (61, 291),   # mouth width
            (10, 152),   # face height
            (70, 159),   # left eyebrow-to-eye
            (300, 386),  # right eyebrow-to-eye
            (159, 145),  # left eye vertical aperture
            (386, 374)   # right eye vertical aperture
        ]
        
        extra_features = []
        for idx1, idx2 in pairs:
            pt1 = np.array([landmarks[idx1].x, landmarks[idx1].y, landmarks[idx1].z])
            pt2 = np.array([landmarks[idx2].x, landmarks[idx2].y, landmarks[idx2].z])
            dist = np.linalg.norm(pt1 - pt2) / face_width
            extra_features.append(dist)
            
        full_features = np.concatenate([raw_features, np.array(extra_features)]) # 128 elements

        # Project features to spread variance across 128 dimensions and normalize
        projected = np.dot(self.projection_matrix, full_features)
        
        # L2 normalization for cosine similarity search compatibility
        norm = np.linalg.norm(projected)
        if norm == 0:
            return [0.0] * 128
            
        normalized_embedding = (projected / norm).tolist()
        return normalized_embedding
