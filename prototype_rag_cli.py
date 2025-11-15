import argparse
import os
from prototype_rag import (
    ai_items_data, calls_dict, build_graph, choose_levels, build_rag, retrieve_ai_items, EmbedRetriever
)

def cli_chat(pickle_path: str = 'ai_embeddings.pkl', clean: bool = False):
    if clean:
        if os.path.exists(pickle_path):
            os.remove(pickle_path)
            print(f"Pickle cleared: {pickle_path}")
        else:
            print(f"Pickle not found: {pickle_path} (nothing to clear)")
    
    retriever = EmbedRetriever(dim=384, pickle_path=pickle_path)
    retriever.add_items(ai_items_data)
    G = build_graph(list(ai_items_data.values()), calls_dict)
    ai_index = ai_items_data
    
    print("=== RAG Chat по прототипу RAG-системы ===")
    print(f"Pickle path: {pickle_path}")
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
    args = parser.parse_args()
    cli_chat(args.custom_pickle, args.clean)
    