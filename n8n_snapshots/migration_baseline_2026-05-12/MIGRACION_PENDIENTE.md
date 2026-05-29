# Migración n8n: preguntas por curso (baseline 2026-05-12)

Documento de referencia para replicar en **otro n8n** los mismos flujos con la arquitectura actual:
- **Banco de preguntas global** → tabla `CourseModuleQuestions` (PK `courseId`, SK `moduleId`)
- **Progreso por usuario** → tabla `Progress` (PK `phoneNumber` con prefijo `wa`, SK `moduleId`, campo `status` numérico)

Instancia origen auditada vía MCP el **2026-05-12**.

---

## Flujos a sincronizar (por nombre)

| Flujo | ID origen | Nodos | Última modificación | Prioridad |
|-------|-----------|-------|---------------------|-----------|
| Flujo principal Instructor evo-gpt4 | `4N3tPZ9WfPsMyPTh` | 114 | 2026-05-12 02:18 UTC | **CRÍTICA** |
| WF_GeneradorPreguntas | `5wX3L3zO2av1ke1Y` | 15 | 2026-05-12 00:12 UTC | Alta |
| WF_ObtenerPreguntas | `ViNJz61mmnAXApoG` | 4 | 2026-05-12 01:17 UTC | Alta |
| WF_ValidadorRespuesta | `GMjzsrfTkCH6bAaB` | 8 | 2026-05-09 00:07 UTC | **Revisar / actualizar** |
| Validación de avance modulo | `Raf39Xrh1R9YiQo0` | 8 | 2026-05-08 22:32 UTC | Sin cambios de tabla |
| Validación de cursos | `wMwzmGCy1wlgckkS` | 8 | 2026-03-18 | Sin cambios de tabla |
| sendVideo | `MdKkoWEZwLYRQ0vS` | 8 | 2026-05-02 | Baja (solo `moduleId` null-safe en principal) |
| WF_Vectorizacion | `LPvHo86tC1kwVZoP` | 11 | 2026-05-11 23:47 UTC | Bucket S3 corregido |

Snapshot JSON del flujo principal: `main_4N3tPZ9WfPsMyPTh_live.json`

---

## Arquitectura de datos (no cambiar lógica de negocio)

```
CourseModuleQuestions          Progress (por usuario)
├── courseId (PK)              ├── phoneNumber = "wa" + dígitos (PK)
├── moduleId (SK)              ├── moduleId (SK)
└── questions (JSON string)    └── status (N, índice de pregunta)
```

- `status = 0` → primera pregunta (`arr[0]`)
- Tras responder la primera → escribir `status = 1`
- **No escribir** `questions` en `Progress` desde el flujo principal

---

## Cambios por flujo (estado LIVE auditado)

### 1. WF_GeneradorPreguntas ✅ listo para replicar

**Nodo:** `Create or update an item` (id `ecea1891-461e-4090-8db9-9d139ffbc5f2`)

| Campo | Valor |
|-------|-------|
| tableName | `CourseModuleQuestions` |
| courseId | `={{ $('When Executed by Another Workflow').item.json.course }}` |
| moduleId | `={{ $('When Executed by Another Workflow').item.json.module }}` |
| questions | `={{ JSON.stringify($json.output.preguntas) }}` |

- **No** escribir `questionNumber` ni `phoneNumber` aquí
- S3 bucket: `ai-nedi-learning-modules`

---

### 2. WF_ObtenerPreguntas ✅ listo para replicar

**Trigger inputs:** `phoneNumber`, `moduleId`, `module`, `course`, `courseId`

**Nodo `Get CourseModuleQuestions`** (id `1e92e6fb-8657-44bf-b407-6b01c9bafdee`)
- tableName: `CourseModuleQuestions`
- courseId: `={{ ...course || ...courseId }}`
- moduleId: `={{ ...moduleId || ...module }}`
- `alwaysOutputData: true`

**Nodo `Get Progress`** (id `c4a8e12b-9f33-4d1a-b8e6-1a2d3f4c5b67`)
- tableName: `Progress`
- phoneNumber: `=wa{{ $('When Executed by Another Workflow').first().json.phoneNumber }}`
- moduleId: `={{ ...moduleId || ...module }}`
- `alwaysOutputData: true`

**Nodo `Edit Fields`** — índice desde progreso del usuario:
- Usa `parseStatus(prog?.status)` (numérico o legacy `"pregunta N"`)
- Banco desde `$('Get CourseModuleQuestions').first()?.json`

---

### 3. Flujo principal Instructor evo-gpt4 ⚠️ incluye tus cambios manuales

**Versión activa:** `62d80ec1-a715-477f-a90f-91584b627f36` (114 nodos)

#### Nodos DynamoDB / progreso

**`Get an item`** (id `69316ca8-7214-4f8d-900a-888aba7fc0e7`)
- tableName: `Progress`
- phoneNumber: `=wa{{ $('parser').item.json.phoneNumber }}`
- moduleId: `={{ $('get_module_validation').item.json.modules?.filter(Boolean)?.[0] || $('actual_course_validation').item.json.module }}`
- `alwaysOutputData: true`

**`Create or update an item`** (id `9d48e467-a7e8-4b40-b0ac-c284bb81ae09`)
- tableName: `Progress`
- phoneNumber: `=wa{{ $('parser').item.json.phoneNumber }}`
- moduleId: (misma expresión filter(Boolean) que arriba)
- status: `={{ Number.isFinite(Number($json?.status)) ? Number($json.status) + 1 : 1 }}`
- **Pendiente recomendado:** agregar `autoParseNumbers: false` y `operation: upsert` explícitos (se perdieron en edición manual; con prefijo `wa` suele funcionar igual)

**`save_actual_question`** (datatable `actual_question_users`, id `s2tFksTYJtuViy68`)
- actual_question: `={{ Number.isFinite(Number($('Get an item').item?.json?.status)) ? Number($('Get an item').item.json.status) + 1 : 1 }}`
- module con `?.filter(Boolean)?.[0]`

#### Tools / sub-workflows (IDs en origen — mapear por nombre en destino)

| Nodo tool | Workflow destino | Inputs clave |
|-----------|------------------|--------------|
| `generador_preguntas` | WF_GeneradorPreguntas | phoneNumber, module (`filter(Boolean)`), course |
| `obtener_pregunta` | WF_ObtenerPreguntas | phoneNumber, moduleId, module, course |
| `sendVideo` | sendVideo | module (`filter(Boolean)`), phoneNumber, apikey |
| `get_module_questions` | Validación de avance modulo | phoneNumber, courseId |
| `get_module_validation` | Validación de avance modulo | phoneNumber, courseId |

Expresión defensiva de módulo (usar en tools):
```
={{ $('get_module_questions').item.json.modules?.filter(Boolean)?.[0] || $('actual_course_questions').item.json.module }}
```

#### Datatables n8n requeridas

| Tabla | ID origen | Uso |
|-------|-----------|-----|
| actual_course | `bitXQfNe2tWMSF3C` | Curso/módulo/flujo activo por teléfono |
| actual_question_users | `s2tFksTYJtuViy68` | Pregunta actual en UI/cache |

#### Diferencias detectadas vs chat anterior (tus cambios)

- nodeCount: **109 → 114** (agregaste nodos; replicar workflow completo, no solo parches)
- Posiciones de nodos de progreso cambiaron (rama validación)
- **`autoParseNumbers: false` ya no está** en el JSON exportado del nodo Progress upsert
- `existe_status` aún usa `modules[0]` **sin** `filter(Boolean)` — considerar alinear

---

### 4. WF_ValidadorRespuesta ❌ NO migrado — pendiente

Sigue con lógica **antigua** (preguntas en Progress por usuario):

- `Get an item` / `Create or update an item` → tableName `Progress`
- phoneNumber: `={{ ...phoneNumber.base64Encode() }}` ← **inconsistente** con `wa{{...}}` del resto
- Escribe campo `questions` en Progress ← **eliminar** en migración
- status: string desde input (`"pregunta 1"`) ← alinear a numérico si el validador escribe progreso

**Acción al migrar:** decidir si este flujo solo valida (AI Agent → Edit Fields) y **desconectar** la rama DynamoDB, o actualizarla para escribir solo `status` numérico con `wa` prefix.

---

### 5. Validación de avance modulo — sin cambios de migración

- Usa `CourseModules` + `ModuleProgress`
- Retorna `modules: [primerModuloPendiente]` o `[null]` si curso completado
- Conocido: cuando todos los módulos están completos devuelve `[null]` → requiere `filter(Boolean)` aguas arriba (ya aplicado en principal)

---

### 6. Validación de cursos — sin cambios

- Tablas `Students`, `Courses`
- Sin referencia a preguntas

---

### 7. WF_Vectorizacion — replicar fix S3

- bucketName: **`ai-nedi-learning-modules`** (no `ai-learning-donbodegon-modules`)
- Nodos: `Get many files`, `Download a file`
- Pinecone namespace: `courseId`, metadata `module`

---

## Plan de migración al cambiar MCP

1. **Conectar MCP** al n8n destino
2. **Listar workflows** por nombre y anotar nuevos IDs
3. **Opción A (recomendada):** importar JSON completo del principal desde `main_4N3tPZ9WfPsMyPTh_live.json` y re-vincular credenciales + IDs de sub-workflows
4. **Opción B:** aplicar parches node-by-node con `n8n_update_partial_workflow` usando este documento
5. **Re-mapear referencias** en tools del principal: workflowId de sub-flujos cambiará en destino
6. **Recrear datatables** `actual_course` y `actual_question_users` (o actualizar IDs en nodos dataTable)
7. **Verificar credenciales:** `AWS (IAM) Prod`, OpenAI, Pinecone, Redis
8. **Probar:** usuario nuevo → generar preguntas → obtener Q0 → responder → Progress con `wa{phone}` + status=1

---

## Checklist post-migración

- [ ] `WF_GeneradorPreguntas` escribe en `CourseModuleQuestions` (no Progress)
- [ ] `WF_ObtenerPreguntas` lee banco + progreso separados
- [ ] Principal escribe solo `status` en Progress (prefijo `wa`)
- [ ] `autoParseNumbers: false` en upsert Progress (recomendado)
- [ ] Tools apuntan a workflows correctos en instancia destino
- [ ] Datatables existen con mismos nombres de columnas
- [ ] WF_Vectorizacion bucket S3 correcto
- [ ] WF_ValidadorRespuesta revisado (rama DynamoDB obsoleta)
- [ ] Prueba end-to-end con usuario sin filas previas en Progress

---

## Notas

- Los **IDs de workflow** (`4N3tPZ9WfPsMyPTh`, etc.) son de la instancia origen; en destino serán distintos
- Los **IDs de datatable** también cambian por instancia
- El prefijo `wa` en `phoneNumber` es **obligatorio** para compatibilidad con filas existentes y evitar bug de `autoParseNumbers`
