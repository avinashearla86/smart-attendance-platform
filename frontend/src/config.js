// Determine API and WebSocket base URLs dynamically
const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  // Fallback to local development server
  return "http://localhost:8000";
};

const getWsBaseUrl = () => {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  // Derive from API base URL
  const apiBase = getApiBaseUrl();
  if (apiBase.startsWith("https://")) {
    return apiBase.replace("https://", "wss://");
  } else if (apiBase.startsWith("http://")) {
    return apiBase.replace("http://", "ws://");
  }
  return "ws://localhost:8000";
};

export const API_BASE_URL = getApiBaseUrl();
export const WS_BASE_URL = getWsBaseUrl();
