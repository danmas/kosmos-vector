import argparse
import os
import requests  # Для LLM API
import json  # FIXED: Для json.loads
import time  # Для sleep
from typing import Dict, List, Any
from prototype_rag import (
    parse_self_to_ai_items,
    build_graph,
    choose_levels,
    build_rag,
    retrieve_ai_items,
    EmbedRetriever,
    AIItem,
    L2Generator,
)
from l1_cache_utils import load_l1_cache, save_l1_cache, merge_l1_cache, stat_l1_cache
from l2_cache_utils import load_l2_cache, save_l2_cache, merge_l2_cache, stat_l2_cache

def polish_l1_with_llm(item: AIItem, raw_edges: List[str], api_url: str, model: str, max_retries: int = 3, dry_run: bool = False) -> List[Dict[str, Any]]:
    """LLM-polish: Генерирует аннотированные edges с retry."""
    raw_str = ', '.join(raw_edges) if raw_edges else 'no raw edges'
    prompt = f"""Из кода [L0: {item.l0_snippet[:200]}...] и raw edges [{raw_str}] сгенерируй аннотированные связи в JSON-массиве: [{{"to": "target", "type": "calls", "reason": "кратко, если условие"}}]. Макс 3 edges, только релевантные. Выводи ТОЛЬКО JSON-массив, без текста, без объяснений."""
    
    if dry_run:
        # Mock for test (валидный JSON без экранирования кавычек)
        if raw_edges:
            mock_content = json.dumps([{"to": raw_edges[0], "type": "calls", "reason": "fallback mock"}])
        else:
            mock_content = json.dumps([{"to": "self", "type": "unknown", "reason": "no raw"}])
        print(f"Mock content for {item.id}: {mock_content}")
        return json.loads(mock_content)
    
    for attempt in range(max_retries):
        try:
            response = requests.post(api_url, json={
                "model": model,
                "prompt": "Ты парсер кода. Выводи только JSON-массив.",
                "inputText": prompt
            }, timeout=10)
            print(f"LLM response status for {item.id}: {response.status_code}")  # Debug status
            response.raise_for_status()
            data = response.json()
            if data.get('success'):
                content = data['content'].strip()
                print(f"LLM content for {item.id}: {content[:100]}...")  # Debug content
                if content.startswith('[') and content.endswith(']'):
                    polished = json.loads(content)
                    return polished if isinstance(polished, list) else []
                else:
                    print(f"Non-JSON content for {item.id}: {content}")
            else:
                print(f"No success in data for {item.id}: {data}")
        except requests.RequestException as e:
            print(f"LLM L1 API error for {item.id} (attempt {attempt+1}): {e}")
            if hasattr(e, 'response') and e.response is not None:
                print(f"Full model response: {e.response.text}")  # FIXED: Full response on error
            else:
                print("No response text available")
        except json.JSONDecodeError as e:
            print(f"LLM L1 JSON error for {item.id}: {e}")
        except KeyError as e:
            print(f"LLM L1 key error for {item.id}: {e}")
        if attempt < max_retries - 1:
            print(f"Retry {attempt+2}/{max_retries} in 2s...")
            time.sleep(2)
    # FIXED: Fallback with placeholder if raw empty
    if raw_edges:
        return [{'to': e, 'type': 'unknown', 'reason': 'raw from AST'} for e in raw_edges]
    else:
        return [{'to': 'self', 'type': 'unknown', 'reason': 'LLM failed, no raw edges'}]

def cli_chat(
    pickle_path: str = 'ai_embeddings.pkl',
    clean: bool = False,
    no_auto_l1: bool = False,
    llm_l1: bool = False,
    api_url: str = 'http://usa:3002/api/send-request',
    model: str = 'FAST',
    dry_run: bool = False,
    llm_l2: bool = False,
    l2_batch_size: int = 5,
    load_l1_cache_flag: bool = False,
    l1_stat_flag: bool = False,
    load_l2_cache_flag: bool = False,
    l2_stat_flag: bool = False,
):
    if clean:
        # Очистка pickle
        if os.path.exists(pickle_path):
            os.remove(pickle_path)
            print(f"Pickle cleared: {pickle_path}")
        else:
            print(f"Pickle not found: {pickle_path} (nothing to clear)")
        
        # Очистка L1 кэша
        from l1_cache_utils import L1_CACHE_FILE
        if os.path.exists(L1_CACHE_FILE):
            os.remove(L1_CACHE_FILE)
            print(f"L1 cache cleared: {L1_CACHE_FILE}")
        else:
            print(f"L1 cache not found: {L1_CACHE_FILE} (nothing to clear)")
        
        # Очистка L2 кэша
        from l2_cache_utils import L2_CACHE_FILE
        if os.path.exists(L2_CACHE_FILE):
            os.remove(L2_CACHE_FILE)
            print(f"L2 cache cleared: {L2_CACHE_FILE}")
        else:
            print(f"L2 cache not found: {L2_CACHE_FILE} (nothing to clear)")
    
    # Lazy parse с флагами
    auto_l1 = not no_auto_l1  # FIXED: Default True, --no-auto-l1 отключает
    ai_items_data, raw_calls_dict = parse_self_to_ai_items(auto_l1=auto_l1)
    
    # Загрузка L1 кэша
    if load_l1_cache_flag:
        l1_cache = load_l1_cache()
        for item_id, item in ai_items_data.items():
            if item_id in l1_cache:
                cache_entry = l1_cache[item_id]
                item.l1_edges = json.loads(cache_entry['l1_edges'])
                print(f"Loaded L1 for {item_id} from cache (source: {cache_entry.get('source', 'unknown')})")
    
    # Загрузка L2 кэша
    l2_cache = {}
    l2_cache_loaded_ids = set()  # Отслеживаем загруженные из кэша
    if load_l2_cache_flag:
        l2_cache = load_l2_cache()
        for item_id, item in ai_items_data.items():
            if item_id in l2_cache:
                cache_entry = l2_cache[item_id]
                item.l2 = json.loads(cache_entry['l2'])
                l2_cache_loaded_ids.add(item_id)
                print(f"Loaded L2 for {item_id} from cache (source: {cache_entry.get('source', 'unknown')})")
    
    # Создаем generator для LLM или fallback
    # Если llm_l2=False, создаем generator с dry_run=True для fallback генерации
    # Generator нужен всегда, чтобы L2 генерировался через fallback, если не указан --llm-l2
    # dry_run=True если: не указан --llm-l2 (fallback) ИЛИ указан --dry-run (тест)
    generator_dry_run = (not llm_l2) or dry_run
    generator = L2Generator(api_url=api_url, model=model, dry_run=generator_dry_run)
    l2_llm_generated_ids = set()  # Отслеживаем сгенерированные LLM

    if llm_l2:
        print("Generating L2 with LLM...")
        # Генерируем только для тех, у кого нет L2
        items_to_generate = [item for item in ai_items_data.values() if item.l2 is None]
        if items_to_generate:
            generator.generate_l2_batch(items_to_generate, batch_size=l2_batch_size)
            
            # Сохранение L2 кэша после LLM генерации
            l2_cache_new = {}
            for item in items_to_generate:
                if item.l2:
                    l2_llm_generated_ids.add(item.id)
                    # source = "LLM" только если llm_l2=True и не dry_run, иначе "Fallback"
                    source = "LLM" if (llm_l2 and not dry_run) else "Fallback"
                    l2_cache_new[item.id] = {
                        "l2": json.dumps(item.l2, ensure_ascii=False),
                        "type": item.type,
                        "file_path": __file__,
                        "source": source,
                        "timestamp": time.time()
                    }
            if l2_cache_new:
                merge_l2_cache(l2_cache_new)
                print("L2 cache updated.")
            print(f"L2 stats: {stat_l2_cache()}")
        else:
            print("All L2 already loaded from cache.")
        print("L2 done.")
    
    if llm_l1:
        print("Applying LLM polish to L1...")
        # Генерируем только для тех, у кого нет L1
        items_to_generate = [item for item in ai_items_data.values() if not item.l1_edges]
        if items_to_generate:
            for item in items_to_generate:
                raw_edges = raw_calls_dict.get(item.id, [])
                polished_edges = polish_l1_with_llm(item, raw_edges, api_url, model, dry_run=dry_run)
                # Update item.l1_edges with polished (build_graph позже использует)
                item.l1_edges = polished_edges  # Override raw
                time.sleep(1)  # FIXED: Anti-overload sleep 1s between calls
            
            # Сохранение L1 кэша после LLM polish
            l1_cache_new = {}
            for item in items_to_generate:
                if item.l1_edges:
                    l1_cache_new[item.id] = {
                        "l1_edges": json.dumps(item.l1_edges, ensure_ascii=False),
                        "type": item.type,
                        "file_path": __file__,
                        "source": "LLM",
                        "timestamp": time.time()
                    }
            if l1_cache_new:
                merge_l1_cache(l1_cache_new)
                print("L1 cache updated.")
            print(f"L1 stats: {stat_l1_cache()}")
        else:
            print("All L1 already loaded from cache.")
        print("LLM L1 polish done.")
    
    # После if llm_l2: ... L2 done.
    
    retriever = EmbedRetriever(dim=384, pickle_path=pickle_path)
    retriever.add_items(ai_items_data)  # Без generator/l2_batch_size — L2 lazy в build_rag
    
    G = build_graph(list(ai_items_data.values()), raw_calls_dict if not llm_l1 else {k: [] for k in ai_items_data})
    
    ai_index = ai_items_data
    
    # Сохранение L1 кэша после auto_l1 (build_graph)
    if auto_l1 and not llm_l1:
        l1_cache_new = {}
        for item_id, item in ai_items_data.items():
            if item.l1_edges:
                l1_cache_new[item_id] = {
                    "l1_edges": json.dumps(item.l1_edges, ensure_ascii=False),
                    "type": item.type,
                    "file_path": __file__,
                    "source": "AST",
                    "timestamp": time.time()
                }
        if l1_cache_new:
            merge_l1_cache(l1_cache_new)
            print("L1 cache updated (AST).")
    
    # Вывод статистики L1 кэша
    if l1_stat_flag:
        print(f"L1 stats: {stat_l1_cache()}")
    
    # Вывод статистики L2 кэша
    if l2_stat_flag:
        print(f"L2 stats: {stat_l2_cache()}")
    
    print("=== RAG Chat по прототипу RAG-системы ===")
    print(f"Pickle path: {pickle_path}")
    print(f"Auto L1: {auto_l1}, LLM L1: {llm_l1}, Dry run: {dry_run}")
    
    # Подсчитываем статистику L2
    l2_llm_count = len(l2_llm_generated_ids)
    l2_cache_count = len(l2_cache_loaded_ids)
    l2_fallback_count = len([item for item in ai_items_data.values() if item.l2 and item.id not in l2_cache_loaded_ids and item.id not in l2_llm_generated_ids])
    l2_total = len([item for item in ai_items_data.values() if item.l2])
    
    l2_info = []
    if l2_cache_count > 0:
        l2_info.append(f"cache: {l2_cache_count}")
    if l2_llm_count > 0:
        l2_info.append(f"LLM: {l2_llm_count}")
    if l2_fallback_count > 0:
        l2_info.append(f"Fallback: {l2_fallback_count}")
    
    l2_status = f"L2: {l2_total}/{len(ai_items_data)} items"
    if l2_info:
        l2_status += f" ({', '.join(l2_info)})"
    else:
        l2_status += " (none generated)"
    
    print(f"L2: {l2_status}")
    print("Задавай вопросы по коду (e.g., 'Как работает AIItem?', 'связи AIItem'). Выход: 'exit'")
    
    while True:
        query = input("\nТвой вопрос: ").strip()
        if query.lower() in ['exit', 'quit', 'выход']:
            print("Пока!")
            break
        
        if not query:
            print("Вопрос пустой, попробуй снова.")
            continue
        
        retrieved = retrieve_ai_items(query, G, ai_index, retriever)
        levels = choose_levels(query)
        rag = build_rag(retrieved, levels, generator=generator)
        
        prompt = f"""Ты эксперт по прототипу RAG-системы. Ответь на вопрос на русском, кратко, опираясь только на RAG. Если не покрыто — "Информация не найдена".

Вопрос: {query}

Контекст (RAG из AI_ITEM прототипа):
{rag}

Ответ:"""
        
        print(f"\n--- Готовый промпт для LLM (скопируй) ---")
        print(prompt)
        print("--- Конец промпта ---")
        print(f"Retrieved: {[item.id for item in retrieved]}")
        print(f"Токены в RAG (примерно): {len(rag.split())}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='RAG CLI Chat')
    parser.add_argument('-c', '--custom-pickle', type=str, default='ai_embeddings.pkl', help='Path to pickle file for embeddings')
    parser.add_argument('--clean', action='store_true', help='Clear the pickle file before starting')
    parser.add_argument('--no-auto-l1', action='store_true', help='Disable algorithmic L1 (default enabled)')
    parser.add_argument('--llm-l1', action='store_true', default=False, help='Use LLM for L1 polish (default False)')
    parser.add_argument('--api-url', type=str, default='http://usa:3002/api/send-request', help='API URL for LLM L1 (default your server)')
    parser.add_argument('--model', type=str, default='FAST', help='Model for LLM L1 (default FAST)')
    parser.add_argument('--dry-run', action='store_true', help='Mock LLM for testing (default False)')  # FIXED: Added to parser
    parser.add_argument('--llm-l2', action='store_true', help='Use LLM for L2 generation')
    parser.add_argument('--l2-batch-size', type=int, default=5, help='Batch size for L2 generation (default 5)')
    parser.add_argument('--load-l1-cache', action='store_true', help='Load L1 from cache')
    parser.add_argument('--l1-stat', action='store_true', help='Print L1 cache stats')
    parser.add_argument('--load-l2-cache', action='store_true', help='Load L2 from cache')
    parser.add_argument('--l2-stat', action='store_true', help='Print L2 cache stats')
    args = parser.parse_args()
    cli_chat(
        args.custom_pickle,
        args.clean,
        args.no_auto_l1,
        args.llm_l1,
        args.api_url,
        args.model,
        args.dry_run,
        args.llm_l2,
        args.l2_batch_size,
        args.load_l1_cache,
        args.l1_stat,
        args.load_l2_cache,
        args.l2_stat,
    )