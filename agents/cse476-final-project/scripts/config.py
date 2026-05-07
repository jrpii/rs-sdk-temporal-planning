### Config for the agent.
import os
from dotenv import load_dotenv

# Load env vars from .env (or set to defaults)
load_dotenv()

def get_api_key() -> str:
    return os.getenv("OPENAI_API_KEY", "ollama")
def get_api_base() -> str:
    return os.getenv("API_BASE", "http://127.0.0.1:11434/v1")
def get_model_name() -> str:
    return os.getenv("MODEL_NAME", os.getenv("MODEL", "gemma3:12b"))
