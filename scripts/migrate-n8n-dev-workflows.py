#!/usr/bin/env python3
"""Apply CourseModuleQuestions migration to dev.n8n.tututor.co workflows."""

import copy
import json
import os
import sys
import urllib.request

API_URL = os.environ.get("N8N_API_URL", "https://dev.n8n.tututor.co/api/v1")
API_KEY = os.environ.get(
    "N8N_API_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZjljNzQwMC1lZGUwLTQyOTktOThiNS02NjlhMDdjYzMxNWEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiYzhlNThkYWUtNzcyMi00OTAyLWJkZGMtOWM0ZDcwYzBlY2Q3IiwiaWF0IjoxNzc5NjgzNzEyfQ.bgWIywcKWGbJjs_q2o4nWl27tDxaUgmIiochWp20ORY",
)

WORKFLOWS = {
    "generador": "fG3ffsIJytdAahLu",
    "obtener": "JR6WQaK1jPZSxVOd",
    "vectorizacion": "QeJA0rSV4Lslprzl",
    "principal": "thQSqeqoSKp8hVLD",
}

EDIT_FIELDS_QUESTIONS_EXPR = (
    "={{ (() => { const bank = $('Get CourseModuleQuestions').first()?.json; "
    "const prog = $('Get Progress').first()?.json; "
    "const parseStatus = (s) => { if (s == null || s === '') return 0; "
    "if (typeof s === 'number' && !Number.isNaN(s)) return s; "
    "const n = Number(s); if (!Number.isNaN(n)) return n; "
    "const m = String(s).match(/pregunta\\\\s*(\\\\d+)/i); "
    "if (m) return Math.max(0, parseInt(m[1], 10) - 1); return 0; }; "
    "if (!bank?.questions) return null; let arr; "
    "try { arr = typeof bank.questions === 'string' ? JSON.parse(bank.questions) : bank.questions; } "
    "catch { return null; } "
    "if (!Array.isArray(arr) || arr.length === 0) return null; "
    "const idx = parseStatus(prog?.status); const q = arr[idx]; "
    "if (q === undefined) return '¡Modulo finalizado!'; "
    "return typeof q === 'string' ? q : JSON.stringify(q); })() }}"
)

MODULE_EXPR_VALIDATION = (
    "={{ $('get_module_validation').item.json.modules?.filter(Boolean)?.[0] "
    "|| $('actual_course_validation').item.json.module }}"
)

MODULE_EXPR_QUESTIONS = (
    "={{ $('get_module_questions').item.json.modules?.filter(Boolean)?.[0] "
    "|| $('actual_course_questions').item.json.module }}"
)

STATUS_EXPR = "={{ Number.isFinite(Number($json?.status)) ? Number($json.status) + 1 : 1 }}"

ACTUAL_QUESTION_EXPR = (
    "={{ Number.isFinite(Number($('Get an item').item?.json?.status)) "
    "? Number($('Get an item').item.json.status) + 1 : 1 }}"
)


def api(method: str, path: str, body: dict | None = None) -> dict:
    url = f"{API_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "X-N8N-API-KEY": API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else {}


def get_workflow(wid: str) -> dict:
    return api("GET", f"/workflows/{wid}")


def put_workflow(wid: str, wf: dict) -> dict:
    raw_settings = wf.get("settings") or {}
    settings = {}
    if raw_settings.get("executionOrder"):
        settings["executionOrder"] = raw_settings["executionOrder"]
    payload = {
        "name": wf["name"],
        "nodes": wf["nodes"],
        "connections": wf["connections"],
        "settings": settings,
    }
    return api("PUT", f"/workflows/{wid}", payload)


def find_node(wf: dict, name: str) -> dict | None:
    for n in wf["nodes"]:
        if n.get("name") == name:
            return n
    return None


def migrate_generador(wf: dict) -> list[str]:
    changes = []
    node = find_node(wf, "Create or update an item")
    if not node:
        return ["SKIP: Create or update an item not found"]
    p = node.setdefault("parameters", {})
    p["tableName"] = "CourseModuleQuestions"
    p["operation"] = "upsert"
    p["dataToSend"] = "defineBelow"
    p["fieldsUi"] = {
        "fieldValues": [
            {
                "fieldId": "courseId",
                "fieldValue": "={{ $('When Executed by Another Workflow').item.json.course }}",
            },
            {
                "fieldId": "moduleId",
                "fieldValue": "={{ $('When Executed by Another Workflow').item.json.module }}",
            },
            {
                "fieldId": "questions",
                "fieldValue": "={{ JSON.stringify($json.output.preguntas) }}",
            },
        ]
    }
    changes.append("Generador → CourseModuleQuestions (courseId, moduleId, questions)")
    return changes


def migrate_obtener(wf: dict) -> list[str]:
    changes = []
    trigger = find_node(wf, "When Executed by Another Workflow")
    if not trigger:
        return ["ERROR: trigger missing"]

    trigger.setdefault("parameters", {}).setdefault("workflowInputs", {})["values"] = [
        {"name": "phoneNumber"},
        {"name": "moduleId"},
        {"name": "module"},
        {"name": "course"},
        {"name": "courseId"},
    ]

    aws_creds = None
    old_get = find_node(wf, "Get an item")
    if old_get and old_get.get("credentials", {}).get("aws"):
        aws_creds = old_get["credentials"]

    # Remove old Get an item if present
    wf["nodes"] = [n for n in wf["nodes"] if n.get("name") != "Get an item"]

    get_bank = {
        "parameters": {
            "operation": "get",
            "tableName": "CourseModuleQuestions",
            "keysUi": {
                "keyValues": [
                    {
                        "key": "courseId",
                        "value": "={{ $('When Executed by Another Workflow').first().json.course || $('When Executed by Another Workflow').first().json.courseId }}",
                    },
                    {
                        "key": "moduleId",
                        "value": "={{ $('When Executed by Another Workflow').first().json.moduleId || $('When Executed by Another Workflow').first().json.module }}",
                    },
                ]
            },
            "additionalFields": {},
        },
        "type": "n8n-nodes-base.awsDynamoDb",
        "typeVersion": 1,
        "position": [208, 0],
        "id": "1e92e6fb-8657-44bf-b407-6b01c9bafdee",
        "name": "Get CourseModuleQuestions",
        "alwaysOutputData": True,
    }

    get_progress = {
        "parameters": {
            "operation": "get",
            "tableName": "Progress",
            "keysUi": {
                "keyValues": [
                    {
                        "key": "phoneNumber",
                        "value": "=wa{{ $('When Executed by Another Workflow').first().json.phoneNumber }}",
                    },
                    {
                        "key": "moduleId",
                        "value": "={{ $('When Executed by Another Workflow').first().json.moduleId || $('When Executed by Another Workflow').first().json.module }}",
                    },
                ]
            },
            "additionalFields": {},
        },
        "type": "n8n-nodes-base.awsDynamoDb",
        "typeVersion": 1,
        "position": [320, 0],
        "id": "c4a8e12b-9f33-4d1a-b8e6-1a2d3f4c5b67",
        "name": "Get Progress",
        "alwaysOutputData": True,
    }

    if aws_creds:
        get_bank["credentials"] = copy.deepcopy(aws_creds)
        get_progress["credentials"] = copy.deepcopy(aws_creds)

    wf["nodes"].append(get_bank)
    wf["nodes"].append(get_progress)

    edit = find_node(wf, "Edit Fields")
    if edit:
        for a in edit["parameters"]["assignments"]["assignments"]:
            if a.get("name") == "questions":
                a["value"] = EDIT_FIELDS_QUESTIONS_EXPR

    wf["connections"] = {
        "When Executed by Another Workflow": {
            "main": [[{"node": "Get CourseModuleQuestions", "type": "main", "index": 0}]]
        },
        "Get CourseModuleQuestions": {
            "main": [[{"node": "Get Progress", "type": "main", "index": 0}]]
        },
        "Get Progress": {
            "main": [[{"node": "Edit Fields", "type": "main", "index": 0}]]
        },
    }

    changes.append("Obtener → CourseModuleQuestions + Get Progress + Edit Fields")
    return changes


def migrate_vectorizacion(wf: dict) -> list[str]:
    changes = []
    wrong = "ai-learning-donbodegon-modules"
    for n in wf["nodes"]:
        if n.get("type") == "n8n-nodes-base.awsS3":
            bucket = n.get("parameters", {}).get("bucketName", "")
            if wrong in bucket:
                n["parameters"]["bucketName"] = bucket.replace(
                    wrong, "dev-ai-nedi-learning-modules-dev"
                )
                changes.append(f"S3 {n['name']}: fixed wrong bucket")
    return changes or ["Vectorizacion: bucket already OK for dev"]


def patch_tool_workflow_id(node: dict, name_to_id: dict[str, str]) -> bool:
    wf_id = node.get("parameters", {}).get("workflowId", {})
    cached = wf_id.get("cachedResultName") or wf_id.get("value")
    if isinstance(wf_id, dict):
        old_name = wf_id.get("cachedResultName", "")
        mapping = {
            "WF_GeneradorPreguntas": "generador",
            "WF_GeneradorPreguntas copy": "generador",
            "WF_ObtenerPreguntas": "obtener",
            "WF_ObtenerPreguntas copy": "obtener",
            "Validación de avance modulo": "avance",
            "Validación de avance modulo copy": "avance",
            "sendVideo": "sendVideo",
            "sendVideo copy": "sendVideo",
        }
        for label, key in mapping.items():
            if old_name == label or wf_id.get("value") in name_to_id.values():
                pass
        for label, key in mapping.items():
            if wf_id.get("cachedResultName") == label:
                node["parameters"]["workflowId"]["value"] = WORKFLOWS.get(key, wf_id.get("value"))
                node["parameters"]["workflowId"]["cachedResultName"] = label
                return True
    return False


def migrate_principal(wf: dict, sub_ids: dict[str, str]) -> list[str]:
    changes = []

    # Tool workflow IDs
    tool_map = {
        "generador_preguntas": sub_ids["generador"],
        "obtener_pregunta": sub_ids["obtener"],
        "get_module_questions": sub_ids["avance"],
        "get_module_validation": sub_ids["avance"],
        "sendVideo": sub_ids["sendVideo"],
    }
    for n in wf["nodes"]:
        name = n.get("name", "")
        if name in tool_map and "workflowId" in n.get("parameters", {}):
            n["parameters"]["workflowId"]["value"] = tool_map[name]
            changes.append(f"Tool {name} → {tool_map[name]}")

    get_node = find_node(wf, "Get an item")
    if get_node:
        get_node["alwaysOutputData"] = True
        p = get_node["parameters"]
        p["tableName"] = "Progress"
        p["operation"] = "get"
        p["keysUi"]["keyValues"] = [
            {"key": "phoneNumber", "value": "=wa{{ $('parser').item.json.phoneNumber }}"},
            {"key": "moduleId", "value": MODULE_EXPR_VALIDATION},
        ]
        changes.append("Get an item → Progress + wa + filter(Boolean)")

    upsert = find_node(wf, "Create or update an item")
    if upsert and upsert.get("type") == "n8n-nodes-base.awsDynamoDb":
        p = upsert["parameters"]
        p["tableName"] = "Progress"
        p["operation"] = "upsert"
        p["dataToSend"] = "defineBelow"
        p["autoParseNumbers"] = False
        p["fieldsUi"] = {
            "fieldValues": [
                {"fieldId": "phoneNumber", "fieldValue": "=wa{{ $('parser').item.json.phoneNumber }}"},
                {"fieldId": "moduleId", "fieldValue": MODULE_EXPR_VALIDATION},
                {"fieldId": "status", "fieldValue": STATUS_EXPR},
            ]
        }
        changes.append("Create or update → Progress status only + autoParseNumbers false")

    save = find_node(wf, "save_actual_question")
    if save:
        cols = save["parameters"]["columns"]["value"]
        cols["actual_question"] = ACTUAL_QUESTION_EXPR
        cols["module"] = MODULE_EXPR_VALIDATION
        for c in save["parameters"]["filters"]["conditions"]:
            if c.get("keyName") == "module":
                c["keyValue"] = MODULE_EXPR_VALIDATION
        changes.append("save_actual_question updated")

    for n in wf["nodes"]:
        if n.get("name") in ("generador_preguntas", "obtener_pregunta", "sendVideo"):
            v = n.get("parameters", {}).get("workflowInputs", {}).get("value", {})
            if "module" in v:
                v["module"] = MODULE_EXPR_QUESTIONS
            if "moduleId" in v:
                v["moduleId"] = MODULE_EXPR_QUESTIONS

    for n in wf["nodes"]:
        if n.get("name") == "existe_status":
            for c in n["parameters"]["filters"]["conditions"]:
                if c.get("keyName") == "module":
                    c["keyValue"] = MODULE_EXPR_QUESTIONS

    return changes


def main() -> int:
    results = {}

    # 1. Generador
    wf = get_workflow(WORKFLOWS["generador"])
    results["generador"] = migrate_generador(wf)
    put_workflow(WORKFLOWS["generador"], wf)

    # 2. Obtener
    wf = get_workflow(WORKFLOWS["obtener"])
    results["obtener"] = migrate_obtener(wf)
    put_workflow(WORKFLOWS["obtener"], wf)

    # 3. Vectorizacion
    wf = get_workflow(WORKFLOWS["vectorizacion"])
    results["vectorizacion"] = migrate_vectorizacion(wf)
    put_workflow(WORKFLOWS["vectorizacion"], wf)

    # 4. Principal
    sub_ids = {
        "generador": WORKFLOWS["generador"],
        "obtener": WORKFLOWS["obtener"],
        "avance": "zY5wXuIxbKMIxuuN",
        "sendVideo": "L972bVfR9qho6ntU",
    }
    wf = get_workflow(WORKFLOWS["principal"])
    results["principal"] = migrate_principal(wf, sub_ids)
    put_workflow(WORKFLOWS["principal"], wf)

    print(json.dumps(results, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
