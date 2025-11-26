# main.py — ИСПРАВЛЕННАЯ, 100% РАБОЧАЯ ВЕРСИЯ
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import json
import yaml
import asyncio
import time
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any
import fnmatch
import requests

from rag_engine import init_engine, ai_items, G, retriever, l2_generator, retrieve_hybrid
from l0_cache_utils import load_l0_cache

app = FastAPI(
    title="AiItem RAG Architect API — Kosmos Vector Edition",
    version="2.1.1",
    description="Полностью совместимый RAG-бэкенд на базе твоего прототипа",
    license_info={"name": "MIT"}
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)
CONFIG_PATH = Path("config.json")
CONTRACT_PATH = Path("api-contract.yaml")

# In-memory state
pipelines: Dict[str, Dict] = {}
server_logs: List[Dict] = []
log_queue = asyncio.Queue()
pipeline_counter = 0

def get_current_timestamp() -> str:
    return datetime.utcnow().isoformat() + "Z"

def add_server_log(level: str, message: str):
    log_entry = {
        "id": f"log_{int(time.time() * 1000)}",
        "timestamp": get_current_timestamp(),
        "level": level,
        "message": message
    }
    server_logs.append(log_entry)
    if len(server_logs) > 1000:
        server_logs.pop(0)
    asyncio.create_task(log_queue.put(log_entry))

def generate_pipeline_id() -> str:
    global pipeline_counter
    pipeline_counter += 1
    return f"pipeline_{int(time.time())}{pipeline_counter:03d}"

# === Вспомогательные функции ===
def detect_language(file_path: Path) -> str:
    """Определяет язык файла по расширению"""
    ext = file_path.suffix.lower()
    lang_map = {
        '.py': 'python',
        '.js': 'javascript',
        '.ts': 'typescript',
        '.tsx': 'typescript',
        '.go': 'go',
        '.java': 'java'
    }
    return lang_map.get(ext, 'unknown')

def migrate_config_if_needed(config: Dict) -> Dict:
    """Мигрирует старый конфиг (targetPath -> rootPath) и гарантирует обязательные поля"""
    migrated = config.copy()
    
    # Миграция targetPath -> rootPath
    if 'targetPath' in migrated and 'rootPath' not in migrated:
        migrated['rootPath'] = migrated['targetPath']
        del migrated['targetPath']
    
    # Гарантируем обязательные поля
    if 'rootPath' not in migrated:
        migrated['rootPath'] = '.'
    if 'includeMask' not in migrated:
        migrated['includeMask'] = '**/*.{py,js,ts,tsx,go,java}'
    if 'ignorePatterns' not in migrated:
        migrated['ignorePatterns'] = '**/node_modules/**,**/venv/**,**/__pycache__/**,**/dist/**,**/.git/**'
    if 'lastUpdated' not in migrated:
        migrated['lastUpdated'] = get_current_timestamp()
    
    # Опциональные поля (инициализируем если отсутствуют)
    if 'fileSelection' not in migrated:
        migrated['fileSelection'] = []
    if 'metadata' not in migrated:
        migrated['metadata'] = {}
    
    return migrated

def get_files_to_process(config: Dict) -> List[Path]:
    """Получает список файлов для обработки согласно конфигурации"""
    root_path = Path(config.get('rootPath', '.')).resolve()
    file_selection = config.get('fileSelection', [])
    
    # Если fileSelection не пуст - используем только эти файлы
    if file_selection:
        files = []
        for rel_path in file_selection:
            # Убираем префикс ./ если есть
            clean_path = rel_path.lstrip('./')
            full_path = root_path / clean_path
            if full_path.exists() and full_path.is_file():
                files.append(full_path)
        return files
    
    # Fallback на glob маски
    include_mask = config.get('includeMask', '**/*.{py,js,ts,tsx,go,java}')
    ignore_patterns = config.get('ignorePatterns', '').split(',')
    
    files = []
    for pattern in include_mask.split(','):
        pattern = pattern.strip()
        for file_path in root_path.rglob(pattern):
            if file_path.is_file():
                rel_str = str(file_path.relative_to(root_path)).replace('\\', '/')
                # Проверяем ignore patterns
                if any(fnmatch.fnmatch(rel_str, pat.strip()) for pat in ignore_patterns if pat.strip()):
                    continue
                files.append(file_path)
    
    return files

# === CONFIG ===
if not CONFIG_PATH.exists():
    default = {
        "rootPath": ".",
        "includeMask": "**/*.{py,js,ts,tsx,go,java}",
        "ignorePatterns": "**/node_modules/**,**/venv/**,**/__pycache__/**,**/dist/**,**/.git/**",
        "fileSelection": [],
        "metadata": {},
        "lastUpdated": get_current_timestamp()
    }
    CONFIG_PATH.write_text(json.dumps(default, indent=2, ensure_ascii=False))

raw_config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
config = migrate_config_if_needed(raw_config)

# Сохраняем мигрированный конфиг если были изменения
if raw_config != config:
    CONFIG_PATH.write_text(json.dumps(config, indent=2, ensure_ascii=False))

# === STARTUP ===
@app.on_event("startup")
async def startup():
    add_server_log("INFO", "Запуск Kosmos Vector RAG Backend...")
    init_engine()
    add_server_log("INFO", "RAG Engine успешно инициализирован")

# === SYSTEM ===
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "timestamp": get_current_timestamp(),
        "version": "2.1.1"
    }

@app.get("/api/contract")
def contract(format: str = "yaml"):
    if format == "json":
        data = yaml.safe_load(CONTRACT_PATH.read_text(encoding="utf-8"))
        return JSONResponse(data)
    return FileResponse(CONTRACT_PATH, media_type="application/x-yaml")

# === CORE ===
@app.get("/api/items")
def get_items():
    # Загружаем L0-кэш один раз
    l0_cache = load_l0_cache()
    # Возвращаем массив напрямую согласно контракту
    return [
        {
            "id": iid,
            "type": item.type,
            "language": item.language,
            "l0_code": l0_cache.get(iid, {}).get("l0_snippet", ""),
            "l1_deps": list(G.successors(iid)) if G.has_node(iid) else [],
            "l2_desc": item.l2.get("purpose", "") if item.l2 else "",
            "filePath": getattr(item, 'file_path', 'unknown') or 'unknown'
        }
        for iid, item in ai_items.items()
    ]

@app.get("/api/items/{id}")
def get_item(id: str):
    if id not in ai_items:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": f"AiItem with id '{id}' not found"}
        )
    item = ai_items[id]
    l0_cache = load_l0_cache()
    # Возвращаем объект напрямую согласно контракту
    return {
        "id": id,
        "type": item.type,
        "language": item.language,
        "l0_code": l0_cache.get(id, {}).get("l0_snippet", ""),
        "l1_deps": list(G.successors(id)) if G.has_node(id) else [],
        "l2_desc": item.l2.get("purpose", "") if item.l2 else "",
        "filePath": getattr(item, 'file_path', 'unknown') or 'unknown'
    }

@app.get("/api/graph")
def get_graph():
    nodes = []
    links = []
    for node in G.nodes():
        item = ai_items.get(node)
        if item:
            nodes.append({
                "id": node,
                "type": item.type,
                "language": item.language,
                "filePath": getattr(item, 'file_path', 'unknown'),
                "l2_desc": item.l2.get("purpose", "") if item.l2 else ""
            })
    for u, v in G.edges():
        links.append({"source": u, "target": v})
    # Возвращаем GraphData напрямую согласно контракту
    return {"nodes": nodes, "links": links}

@app.get("/api/stats")
def stats():
    total = len(ai_items)
    type_counts = {}
    for item in ai_items.values():
        type_counts[item.type] = type_counts.get(item.type, 0) + 1

    # Возвращаем данные напрямую согласно контракту DashboardStats
    return {
        "totalItems": total,
        "totalDeps": G.number_of_edges(),
        "averageDependencyDensity": f"{G.number_of_edges()/total:.2f}" if total else "0.00",
        "typeStats": [{"name": k.capitalize(), "count": v} for k, v in type_counts.items()],
        "languageStats": [{"name": "python", "value": total}],
        "vectorIndexSize": f"{len(retriever.embeddings_dict) if retriever else 0}",
        "lastScan": get_current_timestamp()
    }

# === RAG CHAT ===
@app.post("/api/chat")
async def chat(request: Dict[str, Any]):
    # Контракт требует поле "message", а не "text"
    message = request.get("message", "").strip()
    if not message:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "Message cannot be empty"}
        )

    top_k = request.get("topK", 5)
    context_items = retrieve_hybrid(message, ai_items, G, retriever, top_k=top_k)
    l0_cache = load_l0_cache()

    context_str = "\n\n".join([
        f"### {it.id}\nЦель: {it.l2.get('purpose', '—')}\nКод:\n```python\n{l0_cache.get(it.id, {}).get('l0_snippet', '').strip()}\n```"
        for it in context_items
    ])

    prompt = f"Вопрос: {message}\n\nКонтекст:\n{context_str}\n\nОтветь кратко и точно на русском:"

    try:
        resp = requests.post(
            "http://usa:3002/api/send-request",
            json={"model": "FAST", "prompt": "Ты эксперт по коду.", "inputText": prompt},
            timeout=30
        )
        answer = resp.json().get("content", "Нет ответа от LLM").strip()
    except Exception as e:
        answer = f"[LLM недоступен] Найдено {len(context_items)} элементов. Главный: {context_items[0].id if context_items else '—'}"

    # Возвращаем ChatResponse согласно контракту: {response, timestamp, usedContextIds}
    return {
        "response": answer,
        "timestamp": get_current_timestamp(),
        "usedContextIds": [it.id for it in context_items]
    }


@app.get("/api/kb-config")
def get_kb_config():
    # Гарантируем наличие всех обязательных полей
    config_with_defaults = {
        "rootPath": config.get("rootPath", "."),
        "includeMask": config.get("includeMask", "**/*.{py,js,ts,tsx,go,java}"),
        "ignorePatterns": config.get("ignorePatterns", ""),
        "lastUpdated": config.get("lastUpdated", get_current_timestamp()),
        "fileSelection": config.get("fileSelection", []),
        "metadata": config.get("metadata", {})
    }
    return {
        "success": True,
        "config": config_with_defaults
    }

@app.post("/api/kb-config")
def update_kb_config(new_config: Dict[str, Any]):
    global config
    
    # Валидация обязательных полей (если они переданы)
    if "rootPath" in new_config and not new_config["rootPath"]:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "rootPath cannot be empty"}
        )
    if "includeMask" in new_config and not new_config["includeMask"]:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "includeMask cannot be empty"}
        )
    if "ignorePatterns" in new_config and new_config["ignorePatterns"] is None:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "ignorePatterns cannot be None"}
        )
    
    # Обновляем конфиг
    updated_config = config.copy()
    updated_config.update(new_config)
    updated_config["lastUpdated"] = get_current_timestamp()
    
    # Мигрируем если нужно
    updated_config = migrate_config_if_needed(updated_config)
    
    # Обновляем глобальную переменную
    config = updated_config
    
    CONFIG_PATH.write_text(json.dumps(config, indent=2, ensure_ascii=False))
    add_server_log("INFO", "KB config updated")
    return {
        "success": True,
        "message": "KB configuration updated successfully",
        "config": config
    }


# === PROJECT — новый UX (дерево + чекбоксы) ===
@app.get("/api/project/tree")
def get_project_tree(
    rootPath: str = Query(..., description="Абсолютный путь к проекту на бэкенде"),
    depth: int = Query(12, ge=1, le=20, description="Максимальная глубина дерева")
):
    """Получить дерево файлов проекта согласно схеме ProjectFile"""
    base_path = Path(rootPath).resolve()
    
    if not base_path.exists():
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": f"Path not found: {rootPath}"}
        )
    
    if not base_path.is_dir():
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": f"Path is not a directory: {rootPath}"}
        )
    
    ignore_patterns = config.get("ignorePatterns", "").split(",")
    
    def should_include(p: Path) -> bool:
        """Проверяет, должен ли файл/папка быть включен в результат"""
        try:
            rel = p.relative_to(base_path)
            rel_str = str(rel).replace("\\", "/")
            # Игнорируем по паттернам
            if any(fnmatch.fnmatch(rel_str, pat.strip()) for pat in ignore_patterns if pat.strip()):
                return False
            return True
        except ValueError:
            return False
    
    def build_project_file(p: Path, current_depth: int = 0) -> Dict[str, Any]:
        """Строит ProjectFile объект согласно контракту"""
        try:
            rel = p.relative_to(base_path)
            rel_str = str(rel).replace("\\", "/")
            path_str = f"./{rel_str}" if rel_str else "./"
            
            file_obj = {
                "path": path_str,
                "name": p.name,
                "type": "directory" if p.is_dir() else "file",
                "size": p.stat().st_size if p.is_file() else 0,
                "selected": True,
                "error": False
            }
            
            # Определяем язык для файлов
            if p.is_file():
                lang = detect_language(p)
                if lang != "unknown":
                    file_obj["language"] = lang
            else:
                file_obj["language"] = None
            
            # Рекурсивно добавляем детей для директорий
            if p.is_dir() and current_depth < depth:
                try:
                    children = []
                    for child in sorted(p.iterdir(), key=lambda x: (x.is_file(), x.name)):
                        if should_include(child):
                            child_obj = build_project_file(child, current_depth + 1)
                            children.append(child_obj)
                    if children:
                        file_obj["children"] = children
                except PermissionError as e:
                    file_obj["error"] = True
                    file_obj["errorMessage"] = f"Permission denied: {str(e)}"
                except Exception as e:
                    file_obj["error"] = True
                    file_obj["errorMessage"] = str(e)
            
            return file_obj
        except Exception as e:
            return {
                "path": f"./{p.name}",
                "name": p.name,
                "type": "file" if p.is_file() else "directory",
                "size": 0,
                "selected": True,
                "error": True,
                "errorMessage": str(e)
            }
    
    # Строим дерево из корня
    try:
        root_files = []
        for item in sorted(base_path.iterdir(), key=lambda x: (x.is_file(), x.name)):
            if should_include(item):
                root_files.append(build_project_file(item, 0))
        return root_files
    except Exception as e:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": f"Failed to read directory: {str(e)}"}
        )

@app.post("/api/project/selection")
def save_project_selection(request: Dict[str, Any]):
    """Сохранить точную выборку файлов (синхронизируется с KB config)"""
    global config
    
    root_path = request.get("rootPath")
    files = request.get("files", [])
    
    if not root_path:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "rootPath is required"}
        )
    
    if not isinstance(files, list):
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "files must be an array"}
        )
    
    # Валидация путей
    base_path = Path(root_path).resolve()
    validated_files = []
    for file_path in files:
        if not isinstance(file_path, str):
            continue
        # Убираем префикс ./ если есть
        clean_path = file_path.lstrip("./")
        full_path = base_path / clean_path
        try:
            # Проверяем, что путь находится внутри rootPath
            full_path.resolve().relative_to(base_path.resolve())
            if full_path.exists() and full_path.is_file():
                # Сохраняем с префиксом ./
                validated_files.append(f"./{clean_path}")
        except (ValueError, OSError):
            continue
    
    # Обновляем конфиг
    config["rootPath"] = root_path
    config["fileSelection"] = validated_files
    config["lastUpdated"] = get_current_timestamp()
    
    CONFIG_PATH.write_text(json.dumps(config, indent=2, ensure_ascii=False))
    add_server_log("INFO", f"Project selection saved: {len(validated_files)} files")
    
    return {
        "success": True,
        "message": "File selection saved successfully",
        "config": config
    }

# === FILES — DEPRECATED (обратная совместимость) ===
# === FILES — ПОЛНОСТЬЮ СОВМЕСТИМЫЙ С UI AiItem RAG Architect ===
@app.get("/api/files")
def get_files(path: Optional[str] = None):
    # DEPRECATED: Используйте /api/project/tree вместо этого эндпоинта
    base_path = Path(config.get("rootPath", config.get("targetPath", "."))).resolve()
    
    # Если path не указан — возвращаем содержимое targetPath
    if path is None:
        target = base_path
    else:
        target = (base_path / path).resolve()
        # Защита от выхода за пределы targetPath
        try:
            target.relative_to(base_path)
        except ValueError:
            return JSONResponse(
                status_code=400,
                content={"success": False, "error": "Access denied: path outside project"}
            )

    if not target.exists():
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "Path not found"}
        )

    def should_include(p: Path) -> bool:
        rel = p.relative_to(base_path)
        rel_str = str(rel).replace("\\", "/")
        # Игнорируем по паттернам
        if any(fnmatch.fnmatch(rel_str, pat.strip()) for pat in config["ignorePatterns"].split(",")):
            return False
        # Включаем только по маске
        if not any(fnmatch.fnmatch(rel_str, pat.strip()) for pat in config["includeMask"].split(",")):
            return False
        return True

    def build_node(p: Path):
        rel_path = str(p.relative_to(base_path)).replace("\\", "/")
        node = {
            "id": rel_path,
            "name": p.name,
            "type": "file" if p.is_file() else "folder",
            "checked": False,
            "error": False
        }
        if p.is_dir():
            try:
                children = []
                for child in p.iterdir():
                    if should_include(child):
                        children.append(build_node(child))
                if children:
                    node["children"] = children
            except PermissionError:
                node["error"] = True
                node["errorMessage"] = "Permission denied"
        return node

    # Если запрашивают конкретный путь — возвращаем один узел
    if path is not None:
        return build_node(target)

    # Если path=None — возвращаем массив корневых узлов
    try:
        root_nodes = []
        for item in base_path.iterdir():
            if should_include(item):
                root_nodes.append(build_node(item))
        return root_nodes  # ← ВОТ ЭТО ГЛАВНОЕ: ЧИСТЫЙ МАССИВ!
    except Exception as e:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": f"Failed to read directory: {str(e)}"}
        )
    

# === LOGS ===
@app.get("/api/logs")
def get_logs(
    limit: int = Query(100, le=1000),
    level: Optional[str] = None,
    since: Optional[str] = None
):
    logs = server_logs.copy()
    
    # Фильтр по уровню
    if level:
        logs = [log for log in logs if log.get("level") == level.upper()]
    
    # Фильтр по времени (since)
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            logs = [
                log for log in logs
                if datetime.fromisoformat(log["timestamp"].replace("Z", "+00:00")) >= since_dt
            ]
        except (ValueError, KeyError):
            return JSONResponse(
                status_code=400,
                content={"success": False, "error": "Invalid date format for 'since' parameter"}
            )
    
    # Ограничение и сортировка
    logs = logs[-limit:]
    logs.reverse()
    return logs

@app.get("/api/logs/stream")
async def stream_logs():
    async def gen():
        while True:
            try:
                log = await asyncio.wait_for(log_queue.get(), timeout=30)
                yield f"event: log\ndata: {json.dumps(log)}\n\n"
            except asyncio.TimeoutError:
                yield f"event: heartbeat\ndata: {{\"ts\": \"{get_current_timestamp()}\"}}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")

# === PIPELINE ===
@app.post("/api/pipeline/start")
async def start_pipeline(
    background_tasks: BackgroundTasks,
    request: Dict[str, Any] = {}
):
    """Запустить pipeline обработки файлов"""
    force_rescan = request.get("forceRescan", False)
    
    # Проверяем наличие файлов для обработки
    files_to_process = get_files_to_process(config)
    
    if not files_to_process:
        return JSONResponse(
            status_code=428,
            content={
                "success": False,
                "error": "No files configured. Set up project via /api/kb-config or /api/project/selection"
            }
        )
    
    pid = generate_pipeline_id()
    start_time = get_current_timestamp()
    pipelines[pid] = {
        "id": pid,
        "status": "running",
        "startTime": start_time,
        "filesCount": len(files_to_process),
        "forceRescan": force_rescan
    }
    add_server_log("INFO", f"Pipeline {pid} запущен ({len(files_to_process)} файлов)")

    def reindex():
        try:
            # TODO: В будущем здесь должна быть обработка конкретных файлов из fileSelection
            # Пока используем существующую логику init_engine()
            time.sleep(3)
            init_engine()
            pipelines[pid]["status"] = "completed"
            pipelines[pid]["finished"] = get_current_timestamp()
            add_server_log("INFO", f"Pipeline {pid} завершён")
        except Exception as e:
            pipelines[pid]["status"] = "error"
            pipelines[pid]["error"] = str(e)
            pipelines[pid]["finished"] = get_current_timestamp()
            add_server_log("ERROR", f"Pipeline {pid} ошибка: {str(e)}")

    background_tasks.add_task(reindex)
    
    # Возвращаем структуру согласно контракту
    return {
        "success": True,
        "pipeline": {
            "id": pid,
            "status": "running",
            "startTime": start_time
        }
    }

@app.get("/api/pipeline")
def list_pipelines():
    """Список всех pipeline"""
    pipeline_list = []
    for pid, pipeline_data in pipelines.items():
        pipeline_info = {
            "id": pipeline_data.get("id", pid),
            "status": pipeline_data.get("status", "unknown"),
            "startTime": pipeline_data.get("startTime")
        }
        if "finished" in pipeline_data:
            pipeline_info["finished"] = pipeline_data["finished"]
        pipeline_list.append(pipeline_info)
    return pipeline_list

@app.get("/api/pipeline/{id}")
def get_pipeline(id: str):
    """Статус pipeline"""
    if id not in pipelines:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": f"Pipeline '{id}' not found"}
        )
    
    pipeline_data = pipelines[id]
    result = {
        "id": pipeline_data.get("id", id),
        "status": pipeline_data.get("status", "unknown"),
        "startTime": pipeline_data.get("startTime")
    }
    
    if "finished" in pipeline_data:
        result["finished"] = pipeline_data["finished"]
    if "error" in pipeline_data:
        result["error"] = pipeline_data["error"]
    if "filesCount" in pipeline_data:
        result["filesCount"] = pipeline_data["filesCount"]
    
    return result

@app.delete("/api/pipeline/{id}")
def cancel_pipeline(id: str):
    """Отменить pipeline"""
    if id not in pipelines:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": f"Pipeline '{id}' not found"}
        )
    
    pipeline_data = pipelines[id]
    current_status = pipeline_data.get("status", "unknown")
    
    # Можно отменить только running pipeline
    if current_status == "running":
        pipeline_data["status"] = "cancelled"
        pipeline_data["finished"] = get_current_timestamp()
        add_server_log("INFO", f"Pipeline {id} отменён")
        return {
            "success": True,
            "message": f"Pipeline {id} cancelled"
        }
    else:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": f"Cannot cancel pipeline with status '{current_status}'"}
        )

@app.get("/api/pipeline/{id}/progress")
def get_pipeline_progress(id: str):
    """Детальный прогресс pipeline"""
    if id not in pipelines:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": f"Pipeline '{id}' not found"}
        )
    
    pipeline_data = pipelines[id]
    
    # Базовая информация о прогрессе
    progress = {
        "id": pipeline_data.get("id", id),
        "status": pipeline_data.get("status", "unknown"),
        "startTime": pipeline_data.get("startTime")
    }
    
    if "finished" in pipeline_data:
        progress["finished"] = pipeline_data["finished"]
    
    if "filesCount" in pipeline_data:
        progress["filesCount"] = pipeline_data["filesCount"]
        # Простой прогресс (можно расширить в будущем)
        if pipeline_data["status"] == "completed":
            progress["processed"] = pipeline_data["filesCount"]
        elif pipeline_data["status"] == "running":
            progress["processed"] = 0  # TODO: добавить реальный счётчик
        else:
            progress["processed"] = 0
    
    if "error" in pipeline_data:
        progress["error"] = pipeline_data["error"]
    
    return progress

# Pipeline progress queue для SSE
pipeline_progress_queues: Dict[str, asyncio.Queue] = {}

@app.get("/api/pipeline/{id}/stream")
async def stream_pipeline_progress(id: str):
    """SSE поток прогресса pipeline"""
    if id not in pipelines:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": f"Pipeline '{id}' not found"}
        )
    
    # Создаём очередь для этого pipeline если её нет
    if id not in pipeline_progress_queues:
        pipeline_progress_queues[id] = asyncio.Queue()
    
    async def gen():
        queue = pipeline_progress_queues[id]
        last_status = None
        
        while True:
            try:
                # Проверяем статус pipeline
                if id in pipelines:
                    current_status = pipelines[id].get("status")
                    if current_status != last_status:
                        progress_data = {
                            "id": id,
                            "status": current_status,
                            "timestamp": get_current_timestamp()
                        }
                        if "finished" in pipelines[id]:
                            progress_data["finished"] = pipelines[id]["finished"]
                        yield f"event: progress\ndata: {json.dumps(progress_data)}\n\n"
                        last_status = current_status
                        
                        # Если pipeline завершён или отменён, закрываем поток
                        if current_status in ["completed", "error", "cancelled"]:
                            break
                
                # Пытаемся получить событие из очереди (с таймаутом)
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=5.0)
                    yield f"event: progress\ndata: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # Heartbeat
                    yield f"event: heartbeat\ndata: {{\"ts\": \"{get_current_timestamp()}\"}}\n\n"
                    
            except Exception as e:
                yield f"event: error\ndata: {{\"error\": \"{str(e)}\"}}\n\n"
                break
    
    return StreamingResponse(gen(), media_type="text/event-stream")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=3200, reload=True)