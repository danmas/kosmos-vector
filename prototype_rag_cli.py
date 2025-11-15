import argparse
import os
import requests  # Для LLM API
import json  # FIXED: Для json.loads
import time  # Для sleep
from typing import Dict, List, Any
from prototype_rag import (
    parse_self_to_ai_items, build_graph, choose_levels, build_rag, retrieve_ai_items, EmbedRetriever, AIItem
)

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

def cli_chat(pickle_path: str = 'ai_embeddings.pkl', clean: bool = False, no_auto_l1: bool = False, llm_l1: bool = False, api_url: str = 'http://usa:3002/api/send-request', model: str = 'FAST', dry_run: bool = False):
    if clean:
        if os.path.exists(pickle_path):
            os.remove(pickle_path)
            print(f"Pickle cleared: {pickle_path}")
        else:
            print(f"Pickle not found: {pickle_path} (nothing to clear)")
    
    # Lazy parse с флагами
    auto_l1 = not no_auto_l1  # FIXED: Default True, --no-auto-l1 отключает
    ai_items_data, raw_calls_dict = parse_self_to_ai_items(auto_l1=auto_l1)
    
    if llm_l1:
        print("Applying LLM polish to L1...")
        for item_id, item in ai_items_data.items():
            raw_edges = raw_calls_dict.get(item_id, [])
            polished_edges = polish_l1_with_llm(item, raw_edges, api_url, model, dry_run=dry_run)
            # Update item.l1_edges with polished (build_graph позже использует)
            item.l1_edges = polished_edges  # Override raw
            time.sleep(1)  # FIXED: Anti-overload sleep 1s between calls
        print("LLM L1 polish done.")
    
    retriever = EmbedRetriever(dim=384, pickle_path=pickle_path)
    retriever.add_items(ai_items_data)
    G = build_graph(list(ai_items_data.values()), raw_calls_dict if not llm_l1 else {k: [] for k in ai_items_data})  # If LLM, G from polished
    ai_index = ai_items_data
    
    print("=== RAG Chat по прототипу RAG-системы ===")
    print(f"Pickle path: {pickle_path}")
    print(f"Auto L1: {auto_l1}, LLM L1: {llm_l1}, Dry run: {dry_run}")
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
        rag = build_rag(retrieved, levels)
        
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
    args = parser.parse_args()
    cli_chat(
        args.custom_pickle,
        args.clean,
        args.no_auto_l1,
        args.llm_l1,
        args.api_url,
        args.model,
        args.dry_run,
    )