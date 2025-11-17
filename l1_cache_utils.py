"""

Утилиты для работы с ai_l1_cache.json

- быстрое чтение / запись

- мерж / дифф

- валидация

- статистика

"""

import json

import os

from pathlib import Path

from typing import Dict, Any, Set, Tuple, List

import time

L1_CACHE_FILE = "ai_l1_cache.json"

# ---------- 1. Быстрое чтение ----------

def load_l1_cache(path: str = L1_CACHE_FILE) -> Dict[str, Any]:

    """UTF-8, безопасно, возвращает пустой dict при ошибке."""

    if not Path(path).exists():

        return {}

    try:

        with open(path, "r", encoding="utf-8") as fh:

            data = json.load(fh)

        return data if isinstance(data, dict) else {}

    except Exception as exc:

        print(f"[L1-UTIL] Ошибка чтения {path}: {exc}")

        return {}

# ---------- 2. Безопасная запись ----------

def save_l1_cache(data: Dict[str, Any], path: str = L1_CACHE_FILE) -> Path:

    """UTF-8, ensure_ascii=False, indent=2, атомарная запись."""

    target = Path(path)

    tmp = target.with_suffix(".tmp")

    try:

        with tmp.open("w", encoding="utf-8") as fh:

            json.dump(data, fh, ensure_ascii=False, indent=2)

        tmp.replace(target)  # атомарно

    except Exception as exc:

        print(f"[L1-UTIL] Ошибка записи {path}: {exc}")

        raise

    return target

# ---------- 3. Мерж (новые > старые) ----------

def merge_l1_cache(new_data: Dict[str, Any], path: str = L1_CACHE_FILE) -> Dict[str, Any]:

    """Добавляет/перезаписывает только новые ключи."""

    old = load_l1_cache(path)

    old.update(new_data)

    save_l1_cache(old, path)

    return old

# ---------- 4. Дифф ----------

def diff_l1_cache(old_path: str = L1_CACHE_FILE, new_path: str = None) -> Tuple[Set[str], Set[str], Set[str]]:

    """

    Возвращает (added, removed, changed) по сравнению с new_path.

    Если new_path=None – сравнивает с текущим кэшом в памяти.

    """

    old = load_l1_cache(old_path)

    new = load_l1_cache(new_path) if new_path else old

    old_keys, new_keys = set(old), set(new)

    added = new_keys - old_keys

    removed = old_keys - new_keys

    changed = {k for k in old_keys & new_keys if old[k] != new[k]}

    return added, removed, changed

# ---------- 5. Валидация ----------

def validate_l1_cache(data: Dict[str, Any]) -> bool:

    """Проверяет структуру каждой записи."""

    for key, rec in data.items():

        if not isinstance(rec, dict):

            print(f"[L1-UTIL] Ключ {key} не dict")

            return False

        if not {"l1_edges", "type", "file_path", "source"}.issubset(rec):

            print(f"[L1-UTIL] Ключ {key} не содержит обязательные поля")

            return False

        edges_str = rec.get("l1_edges", "")

        try:

            edges: List[Dict] = json.loads(edges_str)

            if not isinstance(edges, list) or not all(isinstance(e, dict) and 'to' in e for e in edges):

                print(f"[L1-UTIL] Ключ {key} имеет invalid l1_edges")

                return False

        except json.JSONDecodeError:

            print(f"[L1-UTIL] Ключ {key} l1_edges не JSON")

            return False

    return True

# ---------- 6. Статистика ----------

def stat_l1_cache(path: str = L1_CACHE_FILE) -> Dict[str, Any]:

    """Кол-во записей, средняя длина edges, кол-во LLM/AST, уникальных файлов."""

    data = load_l1_cache(path)

    if not data:

        return {"total": 0, "avg_edges": 0, "llm_pct": 0, "files": 0}

    edges_lens = []

    llm_count = ast_count = 0

    for v in data.values():

        edges_str = v.get("l1_edges", "[]")

        try:

            edges = json.loads(edges_str)

            edges_lens.append(len(edges))

            source = v.get("source", "unknown")

            if source == "LLM":

                llm_count += 1

            elif source == "AST":

                ast_count += 1

        except:

            pass

    files = {v.get("file_path") for v in data.values() if v.get("file_path")}

    return {

        "total": len(data),

        "avg_edges": round(sum(edges_lens) / len(edges_lens), 1) if edges_lens else 0,

        "llm_pct": round((llm_count / len(data)) * 100, 1) if data else 0,

        "files": len(files),

    }

# ---------- 7. CLI-интерфейс ----------

def main():

    import argparse

    ap = argparse.ArgumentParser(description="Утилиты для ai_l1_cache.json")

    ap.add_argument("command", choices=["stat", "validate", "diff", "merge"], help="действие")

    ap.add_argument("--file", default=L1_CACHE_FILE, help="путь к кэшу")

    ap.add_argument("--other", help="второй файл для diff/merge")

    args = ap.parse_args()

    if args.command == "stat":

        print(stat_l1_cache(args.file))

    elif args.command == "validate":

        ok = validate_l1_cache(load_l1_cache(args.file))

        print("✅ Валиден" if ok else "❌ Ошибки выше")

    elif args.command == "diff":

        added, removed, changed = diff_l1_cache(args.file, args.other)

        print("added :", len(added), added)

        print("removed:", len(removed), removed)

        print("changed:", len(changed), changed)

    elif args.command == "merge":

        if not args.other:

            print("Укажите --other файл для мержа")

            return

        new_data = load_l1_cache(args.other)

        merge_l1_cache(new_data, args.file)

        print("✅ Мерж завершён")

if __name__ == "__main__":

    main()

