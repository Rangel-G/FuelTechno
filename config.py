import os
import logging

config_logger = logging.getLogger("config")

# Helper to load .env file manually (so we don't depend on python-dotenv)
def load_dotenv():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    # Only set if not already set in system environment
                    if key not in os.environ:
                        os.environ[key] = val


def save_to_env(updates: dict):
    """
    Persists key=value pairs to the .env file.
    If a key already exists, its value is updated in-place.
    If a key does not exist, it is appended at the end.
    """
    env_path = os.path.join(os.path.dirname(__file__), ".env")

    lines = []
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

    remaining = dict(updates)  # keys still to write

    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in remaining:
                new_lines.append(f"{key}={remaining.pop(key)}\n")
                continue
        new_lines.append(line if line.endswith("\n") else line + "\n")

    # Append any keys that weren't found in the existing file
    for key, val in remaining.items():
        new_lines.append(f"{key}={val}\n")

    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)

    config_logger.info("Configuração salva em .env: %s", list(updates.keys()))


# Load environment variables from .env
load_dotenv()

# --- OBD-II Connection Configurations ---
OBD_CONNECTION_TYPE = os.getenv("OBD_CONNECTION_TYPE", "serial-com")
OBD_PROTOCOL = os.getenv("OBD_PROTOCOL", "auto")

# --- LED Configurations ---
LED_DEVICE_NAME = os.getenv("LED_DEVICE_NAME", "LEDDMX-000101")
LED_CHAR_UUID = os.getenv("LED_CHAR_UUID", "0000ffe1-0000-1000-8000-00805f9b34fb")

# --- Serial Port Configurations ---
# Default smart fallback for SERIAL_PORT if not set in .env
if os.getenv("SERIAL_PORT"):
    SERIAL_PORT = os.getenv("SERIAL_PORT")
else:
    SERIAL_PORT = "/dev/rfcomm0" if os.name == "posix" else "COM4"

try:
    BAUD_RATE = int(os.getenv("BAUD_RATE", "38400"))
except ValueError:
    BAUD_RATE = 38400

# --- WebSocket Server Configurations ---
WS_HOST = os.getenv("WS_HOST", "127.0.0.1")
try:
    WS_PORT = int(os.getenv("WS_PORT", "8765"))
except ValueError:
    WS_PORT = 8765

# --- Shift Light / RPM Threshold and Colors ---
try:
    LED_REDLINE_RPM = int(os.getenv("LED_REDLINE_RPM", "3000"))
except ValueError:
    LED_REDLINE_RPM = 3000

def _parse_color(color_str, default):
    try:
        parts = [int(x.strip()) for x in color_str.split(",")]
        if len(parts) == 3:
            return tuple(parts)
    except Exception:
        pass
    return default

LED_COLOR_NORMAL = _parse_color(os.getenv("LED_COLOR_NORMAL", ""), (0, 0, 255))
LED_COLOR_REDLINE = _parse_color(os.getenv("LED_COLOR_REDLINE", ""), (255, 0, 0))

# --- Log Configuration ---
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
