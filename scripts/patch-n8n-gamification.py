#!/usr/bin/env python3
"""Patch Flujo principal Instructor Peru with gamification tool + prompt updates."""

import json
import os
import sys
import uuid
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
        body = e.read().decode()
        raise SystemExit(f"HTTP {e.code}: {body}") from e


def main():
    wf = api_request("GET", f"/api/v1/workflows/{WORKFLOW_ID}")

    finish = next((n for n in wf["nodes"] if n["name"] == "finish_module"), None)
    ai_resp = next((n for n in wf["nodes"] if n["name"] == "AI Respuestas"), None)
    ai_preg = next((n for n in wf["nodes"] if n["name"] == "AI Preguntas"), None)

    if not finish or not ai_resp or not ai_preg:
        raise SystemExit("Required nodes not found in workflow")

    # Avoid duplicate patch
    if any(n["name"] == "register_gamification" for n in wf["nodes"]):
        print("register_gamification already exists — updating prompts only")
    else:
        pos = finish.get("position", [576, 560])
        new_node = {
            "parameters": {
                "toolDescription": "Registra puntos y racha tras evaluar la respuesta del estudiante en el curso activo",
                "method": "POST",
                "url": finish["parameters"]["url"].replace(
                    "/module-progress/complete", "/gamification/answer"
                ),
                "authentication": finish["parameters"].get("authentication", "genericCredentialType"),
                "genericAuthType": finish["parameters"].get("genericAuthType", "httpHeaderAuth"),
                "sendBody": True,
                "bodyParameters": {
                    "parameters": [
                        {
                            "name": "phoneNumber",
                            "value": "={{ $('parser').item.json.phoneNumber }}",
                        },
                        {
                            "name": "courseId",
                            "value": "={{ $('actual_course_validation').item.json.course || $fromAI('courseId', ``, 'string') }}",
                        },
                        {
                            "name": "isCorrect",
                            "value": "={{ $fromAI('isCorrect', ``, 'boolean') }}",
                        },
                    ]
                },
                "options": {},
            },
            "type": "n8n-nodes-base.httpRequestTool",
            "typeVersion": 4.2,
            "position": [pos[0] + 200, pos[1] + 400],
            "id": str(uuid.uuid4()),
            "name": "register_gamification",
            "credentials": finish.get("credentials", {}),
        }
        wf["nodes"].append(new_node)

        conns = wf.setdefault("connections", {})
        conns.setdefault("register_gamification", {"ai_tool": [[{
            "node": "AI Respuestas",
            "type": "ai_tool",
            "index": 0,
        }]]})
        print("Added register_gamification node")

    for node in wf["nodes"]:
        if node["name"] == "AI Respuestas":
            sm = node["parameters"]["options"].get("systemMessage", "")
            if "register_gamification" not in sm:
                node["parameters"]["options"]["systemMessage"] = sm + GAMIFICATION_APPEND_RESPUESTAS
                print("Updated AI Respuestas prompt")
        if node["name"] == "AI Preguntas":
            sm = node["parameters"]["options"].get("systemMessage", "")
            if "gamification.leveledUp" not in sm:
                node["parameters"]["options"]["systemMessage"] = sm + GAMIFICATION_APPEND_PREGUNTAS
                print("Updated AI Preguntas prompt")

    allowed_settings = {k: wf["settings"][k] for k in ("executionOrder", "callerPolicy") if k in wf.get("settings", {})}
    payload = {
        "name": wf["name"],
        "nodes": wf["nodes"],
        "connections": wf["connections"],
        "settings": allowed_settings,
    }

    api_request("PUT", f"/api/v1/workflows/{WORKFLOW_ID}", payload)
    print(f"Patched workflow {WORKFLOW_ID} successfully")


if __name__ == "__main__":
    main()
