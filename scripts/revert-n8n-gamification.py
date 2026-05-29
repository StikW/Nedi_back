#!/usr/bin/env python3
"""Revert gamification changes from Flujo principal Instructor Peru."""

import json
import os
import sys
import urllib.request

N8N_API_URL = os.environ.get("N8N_API_URL", "https://dev.n8n.tututor.co")
N8N_API_KEY = os.environ.get("N8N_API_KEY", "")
WORKFLOW_ID = os.environ.get("N8N_WORKFLOW_ID", "thQSqeqoSKp8hVLD")

GAMIFICATION_APPEND_RESPUESTAS = """

## Gamificación (obligatorio)
Después de evaluar la respuesta con `vector_validation`:
1. Llama **siempre** a la tool `register_gamification` con:
   - `isCorrect`: `true` si la respuesta es correcta, `false` si es incorrecta.
   - `courseId`: el curso activo del estudiante.
2. Incluye en tu mensaje al estudiante el texto de gamificación que devuelve la tool (puntos y racha).
3. Si la respuesta es correcta, celebra brevemente antes de la retroalimentación.
"""

GAMIFICATION_APPEND_PREGUNTAS = """

## Gamificación al finalizar módulo
Cuando ejecutes `finish_module` y la API responda con `gamification.leveledUp: true`:
- Felicita al estudiante por **subir de nivel** e indica el nuevo nivel (`gamification.level`).
- Menciona sus puntos totales (`gamification.points`) en este curso.
- Usa el campo `gamification.message` como base del mensaje de celebración.
"""


def api_request(method: str, path: str, body=None):
    if not N8N_API_KEY:
        raise SystemExit("Set N8N_API_KEY environment variable")
    url = f"{N8N_API_URL.rstrip('/')}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "X-N8N-API-KEY": N8N_API_KEY,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise SystemExit(f"HTTP {e.code}: {err}") from e


def strip_gamification_prompt(text: str) -> str:
    for block in (GAMIFICATION_APPEND_RESPUESTAS, GAMIFICATION_APPEND_PREGUNTAS):
        text = text.replace(block, "")
    for marker in ("## Gamificación (obligatorio)", "## Gamificación al finalizar módulo"):
        if marker in text:
            text = text.split(marker)[0].rstrip()
    return text


def main():
    wf = api_request("GET", f"/api/v1/workflows/{WORKFLOW_ID}")

    before_nodes = len(wf["nodes"])
    wf["nodes"] = [n for n in wf["nodes"] if n["name"] != "register_gamification"]
    removed_nodes = before_nodes - len(wf["nodes"])

    wf["connections"].pop("register_gamification", None)

    prompts_reverted = 0
    for node in wf["nodes"]:
        if node["name"] in ("AI Respuestas", "AI Preguntas"):
            opts = node["parameters"].setdefault("options", {})
            sm = opts.get("systemMessage", "")
            cleaned = strip_gamification_prompt(sm)
            if cleaned != sm:
                opts["systemMessage"] = cleaned
                prompts_reverted += 1
                print(f"Reverted prompt: {node['name']}")

    allowed_settings = {
        k: wf["settings"][k]
        for k in ("executionOrder", "callerPolicy")
        if k in wf.get("settings", {})
    }
    payload = {
        "name": wf["name"],
        "nodes": wf["nodes"],
        "connections": wf["connections"],
        "settings": allowed_settings,
    }

    api_request("PUT", f"/api/v1/workflows/{WORKFLOW_ID}", payload)
    print(f"Removed register_gamification nodes: {removed_nodes}")
    print(f"Reverted prompts: {prompts_reverted}")
    print(f"Workflow {WORKFLOW_ID} restored")


if __name__ == "__main__":
    main()
