"""

Утилиты для работы с ai_l0_cache.json

- быстрое чтение / запись

- мерж / дифф

- валидация

- статистика

"""

import json

import os

from pathlib import Path

from typing import Dict, Any, Set, Tuple

import time

L0_CACHE_FILE = "data/ai_l0_cache.json"

# ---------- 1. Быстрое чтение ----------

def load_l0_cache(path: str = L0_CACHE_FILE) -> Dict[str, Any]:

    """UTF-8, безопасно, возвращает пустой dict при ошибке."""

    if not Path(path).exists():

        return {}

    try:

        with open(path, "r", encoding="utf-8") as fh:

            data = json.load(fh)

        return data if isinstance(data, dict) else {}

    except Exception as exc:

        print(f"[L0-UTIL] Ошибка чтения {path}: {exc}")

        return {}

# ---------- 2. Безопасная запись ----------

def save_l0_cache(data: Dict[str, Any], path: str = L0_CACHE_FILE) -> Path:

    """UTF-8, ensure_ascii=False, indent=2, атомарная запись."""

    target = Path(path)

    tmp = target.with_suffix(".tmp")

    try:

        with tmp.open("w", encoding="utf-8") as fh:

            json.dump(data, fh, ensure_ascii=False, indent=2)

        tmp.replace(target)  # атомарно

    except Exception as exc:

        print(f"[L0-UTIL] Ошибка записи {path}: {exc}")

        raise

    return target

# ---------- 3. Мерж (новые > старые) ----------

def merge_l0_cache(new_data: Dict[str, Any], path: str = L0_CACHE_FILE) -> Dict[str, Any]:

    """Добавляет/перезаписывает только новые ключи."""

    old = load_l0_cache(path)

    old.update(new_data)

    save_l0_cache(old, path)

    return old

# ---------- 4. Дифф ----------

def diff_l0_cache(old_path: str = L0_CACHE_FILE, new_path: str = None) -> Tuple[Set[str], Set[str], Set[str]]:

    """

    Возвращает (added, removed, changed) по сравнению с new_path.

    Если new_path=None – сравнивает с текущим кэшом в памяти.

    """

    old = load_l0_cache(old_path)

    new = load_l0_cache(new_path) if new_path else old

    old_keys, new_keys = set(old), set(new)

    added = new_keys - old_keys

    removed = old_keys - new_keys

    changed = {k for k in old_keys & new_keys if old[k] != new[k]}

    return added, removed, changed

# ---------- 5. Валидация ----------

def validate_l0_cache(data: Dict[str, Any]) -> bool:

    """Проверяет структуру каждой записи."""

    for key, rec in data.items():

        if not isinstance(rec, dict):

            print(f"[L0-UTIL] Ключ {key} не dict")

            return False

        if not {"l0_snippet", "type", "file_path", "source"}.issubset(rec):

            print(f"[L0-UTIL] Ключ {key} не содержит обязательные поля")

            return False

        l0_snippet = rec.get("l0_snippet", "")

        if not isinstance(l0_snippet, str) or not l0_snippet.strip():

            print(f"[L0-UTIL] Ключ {key} l0_snippet пустой или не строка")

            return False

        item_type = rec.get("type", "")

        if item_type not in ["class", "function"]:

            print(f"[L0-UTIL] Ключ {key} type должен быть 'class' или 'function', получен: {item_type}")

            return False

    return True

# ---------- 6. Статистика ----------

def stat_l0_cache(path: str = L0_CACHE_FILE) -> Dict[str, Any]:

    """Кол-во записей, средняя длина сниппетов, кол-во AST, уникальных файлов."""

    data = load_l0_cache(path)

    if not data:

        return {"total": 0, "avg_snippet_len": 0, "ast_pct": 0, "files": 0}

    snippet_lens = []

    ast_count = 0

    for v in data.values():

        l0_snippet = v.get("l0_snippet", "")

        if isinstance(l0_snippet, str):

            snippet_lens.append(len(l0_snippet))

            source = v.get("source", "unknown")

            if source == "AST":

                ast_count += 1

    files = {v.get("file_path") for v in data.values() if v.get("file_path")}

    return {

        "total": len(data),

        "avg_snippet_len": round(sum(snippet_lens) / len(snippet_lens), 1) if snippet_lens else 0,

        "ast_pct": round((ast_count / len(data)) * 100, 1) if data else 0,

        "files": len(files),

    }

# ---------- 7. CLI-интерфейс ----------

def main():

    import argparse

    ap = argparse.ArgumentParser(description="Утилиты для ai_l0_cache.json")

    ap.add_argument("command", choices=["stat", "validate", "diff", "merge"], help="действие")

    ap.add_argument("--file", default=L0_CACHE_FILE, help="путь к кэшу")

    ap.add_argument("--other", help="второй файл для diff/merge")

    args = ap.parse_args()

    if args.command == "stat":

        print(stat_l0_cache(args.file))

    elif args.command == "validate":

        ok = validate_l0_cache(load_l0_cache(args.file))

        print("✅ Валиден" if ok else "❌ Ошибки выше")

    elif args.command == "diff":

        added, removed, changed = diff_l0_cache(args.file, args.other)

        print("added :", len(added), added)

        print("removed:", len(removed), removed)

        print("changed:", len(changed), changed)

    elif args.command == "merge":

        if not args.other:

            print("Укажите --other файл для мержа")

            return

        new_data = load_l0_cache(args.other)

        merge_l0_cache(new_data, args.file)

        print("✅ Мерж завершён")

if __name__ == "__main__":

    main()

