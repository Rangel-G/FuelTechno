import logging
import asyncio
import firebase_admin
from firebase_admin import credentials, firestore

logger = logging.getLogger("firestore_client")
_db = None

ALLOWED_SECTIONS = {"gear_config", "led_config", "obd_config"}


def init(cred_path: str = "serviceAccountKey.json"):
    global _db
    try:
        if not firebase_admin._apps:
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
        _db = firestore.client()
        logger.info("[FIRESTORE] Conectado.")
    except Exception as e:
        logger.warning(
            "[FIRESTORE] Indisponível, seguindo apenas com storage local: %s", e
        )
        _db = None


def _save_sync(device_id: str, section: str, data: dict):
    if _db is None or section not in ALLOWED_SECTIONS:
        return
    try:
        _db.collection("users").document(device_id).collection("configs").document(
            section
        ).set(data, merge=True)
    except Exception as e:
        logger.warning("[FIRESTORE] Falha ao salvar %s/%s: %s", device_id, section, e)


def save_config_async(device_id: str, section: str, data: dict):
    """Dispara a gravação em background — nunca bloqueia o loop de telemetria/LED."""
    if not device_id or _db is None:
        return
    asyncio.create_task(asyncio.to_thread(_save_sync, device_id, section, data))


def load_config(device_id: str) -> dict:
    if _db is None or not device_id:
        return {}
    try:
        docs = (
            _db.collection("users").document(device_id).collection("configs").stream()
        )
        return {doc.id: doc.to_dict() for doc in docs}
    except Exception as e:
        logger.warning("[FIRESTORE] Falha ao ler %s: %s", device_id, e)
        return {}
