# rag_engine.py
import json
import pickle
import ast
import os
import time
from pathlib import Path
from typing import Dict, List, Any, Optional
import networkx as nx
import numpy as np

# Импорты для кэширования
from l0_cache_utils import load_l0_cache, merge_l0_cache
from l1_cache_utils import load_l1_cache, merge_l1_cache, stat_l1_cache
from l2_cache_utils import load_l2_cache, merge_l2_cache, stat_l2_cache

# === ТВОЙ КОД ИЗ prototype_rag.py ===

# Для реальной e5-small: pip install sentence-transformers
try:
    from sentence_transformers import SentenceTransformer
    REAL_MODEL = True
    print("SentenceTransformer imported successfully.")
except ImportError:
    REAL_MODEL = False
    print("SentenceTransformer not available, using mock.")

# Класс для AI_ITEM (l0_snippet убран — теперь берётся из L0-кэша)
class AIItem:
    def __init__(self, id: str, type: str, contract: Dict[str, Any]):
        self.id = id
        self.type = type
        self.contract = contract
        self.l1_edges = []
        self.l2 = None
        self.embedding = None
        # Добавляем поля для совместимости с сервером
        self.file_path: Optional[str] = None
        self.language: str = "python"

    def generate_l2(self, generator: Optional['L2Generator'] = None):
        if self.l2 is None:
            if generator:
                self.l2 = generator.generate_l2(self)
            else:
                self.l2 = {
                    'purpose': self.contract.get('purpose', 'N/A'),
                    'uses': self.contract.get('uses', []),
                    'returns': self.contract.get('returns', 'N/A'),
                    'edge_cases': self.contract.get('edge_cases', 'N/A')
                }
        return self.l2


def get_l0_snippet(item_id: str, max_len: int = None) -> str:
    """Получает L0 код из кэша по id."""
    cache = load_l0_cache()
    entry = cache.get(item_id, {})
    snippet = entry.get("l0_snippet", "")
    if max_len and len(snippet) > max_len:
        return snippet[:max_len] + "..."
    return snippet


def polish_l1_with_llm(item: AIItem, raw_edges: List[str], api_url: str, model: str, max_retries: int = 3, dry_run: bool = False, llm_raw: bool = False) -> List[Dict[str, Any]]:
    """LLM-polish: Генерирует аннотированные edges с retry."""
    raw_str = ', '.join(raw_edges) if raw_edges else 'no raw edges'
    l0_code = get_l0_snippet(item.id, 200)
    prompt = f"""Из кода [L0: {l0_code}] и raw edges [{raw_str}] сгенерируй аннотированные связи в JSON-массиве: [{{"to": "target", "type": "calls", "reason": "кратко, если условие"}}]. Макс 3 edges, только релевантные. Выводи ТОЛЬКО JSON-массив, без текста, без объяснений."""
    
    if dry_run:
        # Mock for test (валидный JSON без экранирования кавычек)
        if raw_edges:
            mock_content = json.dumps([{"to": raw_edges[0], "type": "calls", "reason": "fallback mock"}])
        else:
            mock_content = json.dumps([{"to": "self", "type": "unknown", "reason": "no raw"}])
        print(f"Mock content for {item.id}: {mock_content}")
        return json.loads(mock_content)
    
    payload = {
        "model": model,
        "prompt": "Ты парсер кода. Выводи только JSON-массив.",
        "inputText": prompt
    }
    
    for attempt in range(max_retries):
        if llm_raw and not dry_run:
            curl_cmd = f"""curl -X POST "{api_url}" \\
  -H "Content-Type: application/json" \\
  -d '{json.dumps(payload)}'"""
            print(f"CURL for {item.id} (attempt {attempt+1}):")
            print(curl_cmd)
            print()
        
        try:
            import requests
            response = requests.post(api_url, json=payload, timeout=10)
            print(f"LLM response status for {item.id}: {response.status_code}")
            response.raise_for_status()
            data = response.json()
            if data.get('success'):
                content = data['content'].strip()
                print(f"LLM content for {item.id}: {content[:100]}...")
                if content.startswith('[') and content.endswith(']'):
                    polished = json.loads(content)
                    return polished if isinstance(polished, list) else []
                else:
                    print(f"Non-JSON content for {item.id}: {content}")
            else:
                print(f"No success in data for {item.id}: {data}")
        except Exception as e:
            print(f"LLM L1 API error for {item.id} (attempt {attempt + 1}): {e}")
            if hasattr(e, 'response') and e.response is not None:
                print(f"Full model response: {e.response.text}")
            else:
                print("No response text available")
        if attempt < max_retries - 1:
            print(f"Retry {attempt+2}/{max_retries} in 2s...")
            time.sleep(2)
    
    # Fallback with placeholder if raw empty
    if raw_edges:
        return [{'to': e, 'type': 'unknown', 'reason': 'raw from AST'} for e in raw_edges]
    else:
        return [{'to': 'self', 'type': 'unknown', 'reason': 'LLM failed, no raw edges'}]


class L2Generator:
    """Генератор L2 c LLM и fallback."""

    def __init__(
        self,
        api_url: str = 'http://usa:3002/api/send-request',
        model: str = 'FAST',
        max_retries: int = 3,
        dry_run: bool = False,
        llm_raw: bool = False
    ):
        self.api_url = api_url
        self.model = model
        self.max_retries = max_retries
        self.dry_run = dry_run
        self.llm_raw = llm_raw
        self.use_llm = not dry_run

    def generate_l2(self, item: AIItem) -> Dict[str, Any]:
        if self.dry_run:
            return self._fallback_l2(item)

        prompt = self._build_prompt(item)
        system_prompt = (
            "Ты анализатор кода. Отвечай ТОЛЬКО JSON: "
            "{'purpose': str, 'uses': list[str], 'returns': str, 'edge_cases': str}. "
            "Кратко (50-80 токенов)."
        )

        for attempt in range(self.max_retries):
            try:
                import requests
                import time
                response = requests.post(
                    self.api_url,
                    json={
                        "model": self.model,
                        "prompt": system_prompt,
                        "inputText": prompt
                    },
                    timeout=10
                )
                response.raise_for_status()
                data = response.json()
                if data.get('success'):
                    content = data['content'].strip()
                    if content.startswith('{') and content.endswith('}'):
                        l2_data = json.loads(content)
                        required = ['purpose', 'uses', 'returns', 'edge_cases']
                        if all(k in l2_data for k in required):
                            print(f"L2 generated for {item.id}: {l2_data['purpose'][:50]}...")
                            return l2_data
            except Exception as e:
                print(f"L2 API error for {item.id} (attempt {attempt + 1}): {e}")
                if attempt < self.max_retries - 1:
                    time.sleep(2)

        print(f"L2 fallback for {item.id}")
        return self._fallback_l2(item)

    def generate_l2_batch(self, items: List[AIItem], batch_size: int = 5) -> List[AIItem]:
        """Генерирует L2 для батча items через LLM или fallback."""
        if self.dry_run:
            for item in items:
                if item.l2 is None:
                    item.l2 = self._fallback_l2(item)
            return items
        
        # Группируем в батчи
        batches = [items[i:i + batch_size] for i in range(0, len(items), batch_size)]
        
        for batch_idx, batch in enumerate(batches, 1):
            print(f"Processing L2 batch {batch_idx}/{len(batches)} ({len(batch)} items)...")
            
            # Собираем контекст для батча (конкатенация snippets)
            batch_context = "\n\n".join([f"Item {item.id}: {get_l0_snippet(item.id, 300)}" for item in batch])
            prompt = f"""Для следующих кодовых сниппетов сгенерируй L2-описания в JSON-массиве объектов. Каждый объект должен содержать: {{"id": "item_id", "purpose": "краткое объяснение", "uses": ["зависимость1", "зависимость2"], "returns": "что возвращает", "edge_cases": "особенности"}}.
Контекст: {batch_context}
Выводи ТОЛЬКО JSON-массив, без текста."""
            
            payload = {
                "model": self.model,
                "prompt": "Ты генератор L2 для RAG. Выводи только JSON-массив с объектами {id, purpose, uses, returns, edge_cases}.",
                "inputText": prompt
            }
            
            if self.llm_raw:
                curl_cmd = f"""curl -X POST "{self.api_url}" \\
  -H "Content-Type: application/json" \\
  -d '{json.dumps(payload)}'"""
                print(f"CURL for L2 batch {batch_idx}:")
                print(curl_cmd)
                print()
            
            try:
                import requests
                response = requests.post(self.api_url, json=payload, timeout=30)
                print(f"L2 batch {batch_idx} status: {response.status_code}")
                response.raise_for_status()
                data = response.json()
                if data.get('success'):
                    content = data['content'].strip()
                    if content.startswith('[') and content.endswith(']'):
                        l2_batch = json.loads(content)
                        # Распределяем по items (предполагаем порядок по id)
                        for item, l2_entry in zip(batch, l2_batch):
                            if isinstance(l2_entry, dict) and l2_entry.get('id') == item.id:
                                # Проверяем и адаптируем формат
                                if all(k in l2_entry for k in ['purpose', 'uses', 'returns', 'edge_cases']):
                                    item.l2 = {
                                        'purpose': l2_entry['purpose'],
                                        'uses': l2_entry.get('uses', []),
                                        'returns': l2_entry.get('returns', 'N/A'),
                                        'edge_cases': l2_entry.get('edge_cases', 'N/A')
                                    }
                                else:
                                    # Fallback если формат неполный
                                    item.l2 = self._fallback_l2(item)
                            else:
                                item.l2 = self._fallback_l2(item)
                        print(f"L2 batch {batch_idx} processed: {len(l2_batch)} entries.")
                    else:
                        print(f"Non-JSON L2 batch {batch_idx}: {content[:200]}...")
                        # Fallback для батча
                        for item in batch:
                            if item.l2 is None:
                                item.l2 = self._fallback_l2(item)
                else:
                    print(f"L2 batch {batch_idx} no success: {data}")
                    # Fallback
                    for item in batch:
                        if item.l2 is None:
                            item.l2 = self._fallback_l2(item)
            except Exception as e:
                print(f"L2 batch {batch_idx} error: {e}")
                # Fallback на весь батч
                for item in batch:
                    if item.l2 is None:
                        item.l2 = self._fallback_l2(item)
            time.sleep(2)  # Между батчами
        
        return items

    def _build_prompt(self, item: AIItem) -> str:
        args_str = ', '.join(item.contract.get('args', [])) if 'args' in item.contract else 'N/A'
        docstring = item.contract.get('docstring', 'No docstring')
        calls = item.l1_edges if item.l1_edges else item.contract.get('uses', [])  # Fallback на uses
        snippet = get_l0_snippet(item.id, 300) or "No code snippet available"

        function_info = f"""
ID: {item.id}
Type: {item.type}
Args: {args_str}
Docstring: {docstring}
L0 Code: {snippet}...
L1 Calls/Edges: {calls}
"""
        prompt = f"""Проанализируй код и сгенерируй L2 в JSON:
- purpose: основная цель (1-2 предложения)
- uses: список (2-4) примеров использования/зависимостей
- returns: что возвращает (или 'None')
- edge_cases: 1-2 особенности/ошибки



{function_info}

Выводи ТОЛЬКО JSON."""
        return prompt

    def _fallback_l2(self, item: AIItem) -> Dict[str, Any]:
        """Fallback: auto + docstring + snippet + edges для плотности."""
        contract = item.contract
        purpose = contract.get('purpose', f"{item.type.capitalize()} {item.id}")
        docstring = contract.get('docstring', 'No docstring')
        args = contract.get('args', [])
        returns = contract.get('returns', 'N/A')
        
        # Snippet parse: extract key phrases (из L0-кэша)
        full_snippet = get_l0_snippet(item.id) or ""
        snippet = full_snippet.lower()
        snippet_words = snippet.split()
        
        # Enrich uses from snippet/edges
        uses = []
        if item.l1_edges:
            uses = [f"Called by {e['to']}" for e in item.l1_edges[:3]]
        if not uses:
            # Extract from snippet patterns
            if 'self.' in snippet:
                uses.append("Handles instance methods")
            if 'def ' in snippet:
                uses.append("Function definition")
            if 'class ' in snippet:
                uses.append("Class structure")
        if not uses:
            uses = ['In RAG pipeline']
        
        # Enrich edge_cases from snippet
        edge_cases = []
        if any(word in snippet for word in ['if', 'elif']):
            edge_cases.append("Conditional logic")
        if 'try' in snippet or 'except' in snippet:
            edge_cases.append("Error handling")
        if 'for' in snippet or 'while' in snippet:
            edge_cases.append("Iteration")
        if not edge_cases:
            edge_cases = ['N/A']
        
        # Enrich purpose
        purpose += f" (Doc: {docstring[:50]}...)" if docstring != 'No docstring' else ""
        if args:
            purpose += f" Args: {', '.join(args)}"
        purpose += f". Snippet: {get_l0_snippet(item.id, 80)}"
        
        return {
            'purpose': purpose,
            'uses': uses,
            'returns': returns,
            'edge_cases': '; '.join(edge_cases)
        }

# EmbedRetriever (без изменений)
class EmbedRetriever:
    def __init__(self, dim: int = 384, model_name: str = 'intfloat/e5-small-v2', pickle_path: str = 'ai_embeddings.pkl'):
        self.dim = dim
        self.pickle_path = pickle_path
        self.model_name = model_name
        self.model = None
        self.embeddings_dict = {}
        self.texts = {}
        self.loaded = False
        self._try_load()

    def add_items(
        self,
        ai_items: Dict[str, AIItem],
        generator: Optional[L2Generator] = None,
        l2_batch_size: int = 5
    ):
        old_len = len(self.embeddings_dict)
        for iid, item in ai_items.items():
            self.texts[iid] = item.contract['purpose']
        new_items = [iid for iid in self.texts if iid not in self.embeddings_dict]
        if new_items:
            print(f"Updating embeddings for {len(new_items)} new items...")
            text_list = [self.texts[iid] for iid in new_items]
            embeddings = self._encode(text_list)
            for i, iid in enumerate(new_items):
                self.embeddings_dict[iid] = embeddings[i]
            self._save_pickle()
            print("Updated and saved.")
        elif not self.loaded:
            self._generate_if_needed()
        if generator:
            pending = [ai_items[iid] for iid in ai_items if ai_items[iid].l2 is None]
            if pending:
                generator.generate_l2_batch(pending, batch_size=l2_batch_size)

    def _try_load(self):
        try:
            with open(self.pickle_path, 'rb') as f:
                data = pickle.load(f)
                self.texts = data['texts']
                self.embeddings_dict = {tid: np.array(vec) for tid, vec in zip(data['ids'], data['embeddings'])}
            print(f"Loaded {len(self.embeddings_dict)} embeddings from {self.pickle_path}")
            self.loaded = True
        except FileNotFoundError:
            print("No pickle found.")
            self.loaded = False

    def _generate_if_needed(self):
        if self.loaded or not self.texts:
            return
        print("Generating embeddings...")
        text_list = list(self.texts.values())
        embeddings = self._encode(text_list)
        ids_list = list(self.texts.keys())
        for i, iid in enumerate(ids_list):
            self.embeddings_dict[iid] = embeddings[i]
        self._save_pickle()
        print("Generated and saved.")
        self.loaded = True

    def _encode(self, texts: List[str]) -> np.ndarray:
        global REAL_MODEL
        if REAL_MODEL and self.model is None:
            self.model = SentenceTransformer(self.model_name)
            print(f"Loaded model: {self.model_name}")
        if REAL_MODEL and self.model:
            prefixed_texts = ["passage: " + t for t in texts]
            return self.model.encode(prefixed_texts)
        else:
            np.random.seed(42)
            return np.random.normal(0, 1, (len(texts), self.dim)).astype(np.float32)

    def _save_pickle(self):
        data = {
            'ids': list(self.embeddings_dict.keys()),
            'texts': self.texts,
            'embeddings': np.stack([vec for vec in self.embeddings_dict.values()])
        }
        with open(self.pickle_path, 'wb') as f:
            pickle.dump(data, f)

    def encode_query(self, query: str) -> np.ndarray:
        if REAL_MODEL and self.model:
            return self.model.encode(["query: " + query])[0]
        else:
            np.random.seed(42)
            return np.random.normal(0, 1, self.dim).astype(np.float32)

    def get_similarities(self, query_emb: np.ndarray, item_ids: List[str]) -> np.ndarray:
        from sklearn.metrics.pairwise import cosine_similarity
        existing_ids = [iid for iid in item_ids if iid in self.embeddings_dict]
        if not existing_ids:
            return np.zeros(len(item_ids))
        vecs = np.stack([self.embeddings_dict[iid] for iid in existing_ids])
        sims = cosine_similarity(query_emb.reshape(1, -1), vecs).flatten()
        full_sims = np.zeros(len(item_ids))
        for i, iid in enumerate(item_ids):
            if iid in existing_ids:
                full_sims[i] = sims[existing_ids.index(iid)]
        return full_sims

# Функции (build_graph FIXED: только auto, хардкод закомментирован)
def build_graph(ai_items: Dict[str, AIItem], calls_dict: Dict[str, List[str]], save_cache: bool = False) -> nx.DiGraph:
    G = nx.DiGraph()
    for item_id, item in ai_items.items():
        G.add_node(item_id, type=item.type, weight=item.contract.get('weight', 1.0))
    
    # Только auto-edges из calls_dict
    for caller, called_list in calls_dict.items():
        for called in called_list:
            called_id = called.split(' (')[0]  # Clean (assign/import)
            if called_id in ai_items:
                edge_type = 'calls' if not ' (' in called else called.split(' (')[1].rstrip(')')
                G.add_edge(caller, called_id, type=edge_type, weight=0.95)
    
    for item_id, item in ai_items.items():
        neighbors = list(G.successors(item_id)) + list(G.predecessors(item_id))
        item.l1_edges = [{'to': n, 'type': G[item_id][n].get('type', 'unknown') if n in G.successors(item_id) else G[n][item_id].get('type', 'unknown')} for n in set(neighbors)]
    
    return G

def retrieve_hybrid(query: str, ai_items: Dict[str, AIItem], G: nx.DiGraph, 
                   retriever: EmbedRetriever, top_k: int = 4) -> List[AIItem]:
    """Гибридный поиск: векторный + граф"""
    item_ids = list(ai_items.keys())
    keyword_matched = [iid for iid in item_ids if any(pattern in query.lower() for pattern in ai_items[iid].contract.get('query_patterns', []))]
    query_emb = retriever.encode_query(query)
    sims = retriever.get_similarities(query_emb, item_ids)
    scores = sims.copy()
    for km in keyword_matched:
        idx = item_ids.index(km)
        scores[idx] += 0.5
    top_indices = np.argsort(scores)[-top_k:]
    matched = [ai_items[item_ids[i]] for i in top_indices]
    if matched:
        start = matched[0].id
        neighbors = [n for n in nx.descendants(G, start) if n in ai_items]
        for n in neighbors[:top_k - len(matched)]:
            matched.append(ai_items[n])
    return list(set(matched))[:top_k]

# UGLUBLENNY Self-indexing: Добавлен visit_Import и visit_Assign
def parse_self_to_ai_items(auto_l1: bool = True, llm_l1: bool = False, api_url: str = 'http://usa:3002/api/send-request') -> tuple[Dict[str, AIItem], Dict[str, List[str]]]:
    import ast
    with open(__file__, 'r', encoding='utf-8-sig') as f:
        code = f.read()
    tree = ast.parse(code)
    
    class ImprovedCodeParser(ast.NodeVisitor):
        def __init__(self):
            self.items = []
            self.current_class = None
            self.current_func = None
            self.calls_dict = {}
            self.assigns_dict = {}  # FIXED: Инициализация
            self.imports_dict = {}  # FIXED: Инициализация
            self.built_ins = ['print', 'len', 'str', 'list', 'dict', 'np', 'json', 'pickle', 'open', 'np.random', 'ast.parse', 'cosine_similarity', 'np.stack', 'torch', 'sklearn', 'networkx', 'SentenceTransformer']

        def visit_ClassDef(self, node):
            self.current_class = node.name
            self.calls_dict[self.current_class] = []
            self.assigns_dict[self.current_class] = []
            self.imports_dict[self.current_class] = []
            
            # Получаем ПОЛНЫЙ код класса для L0-кэша
            snippet = ast.unparse(node)
            
            if node.body:
                # Углубление: Добавляем 'contains' edges к методам класса
                method_ids = [stmt.name for stmt in node.body if isinstance(stmt, ast.FunctionDef)]
                for m in method_ids:
                    self.calls_dict[self.current_class].append(f"{self.current_class}.{m} (contains)")
            
            purpose = f"Класс {node.name} в прототипе RAG-системы."
            docstring = ast.get_docstring(node) or 'N/A'
            contract = {
                "purpose": purpose,
                "query_patterns": [node.name.lower()],
                "weight": 2.0,
                "uses": [],
                "returns": "instance",
                "edge_cases": "N/A",
                "docstring": docstring,
                "args": []
            }
            item_id = node.name
            
            # Сохраняем L0 в кэш (ПОЛНЫЙ код, без обрезки)
            merge_l0_cache({
                item_id: {
                    "l0_snippet": snippet,
                    "type": "class",
                    "file_path": __file__,
                    "source": "AST"
                }
            })
            
            # Создаём dict БЕЗ l0_snippet
            self.items.append({
                "id": item_id,
                "type": "class",
                "contract": contract
            })
            self.generic_visit(node)
            self.current_class = None

        def visit_FunctionDef(self, node):
            self.current_func = node.name
            # ПОЛНЫЙ код функции для L0-кэша
            snippet = ast.unparse(node)
            purpose = f"Функция {node.name} в прототипе RAG."
            docstring = ast.get_docstring(node) or 'N/A'
            args = [arg.arg for arg in node.args.args] if isinstance(node.args, ast.arguments) else []
            contract = {
                "purpose": purpose,
                "query_patterns": [node.name],
                "weight": 1.5,
                "uses": [],
                "returns": "result",
                "edge_cases": "N/A",
                "docstring": docstring,
                "args": args
            }
            item_id = f"{self.current_class}.{node.name}" if self.current_class else node.name
            
            # Сохраняем L0 в кэш (ПОЛНЫЙ код, без обрезки)
            merge_l0_cache({
                item_id: {
                    "l0_snippet": snippet,
                    "type": "function",
                    "file_path": __file__,
                    "source": "AST"
                }
            })
            
            # Создаём dict БЕЗ l0_snippet
            self.items.append({
                "id": item_id,
                "type": "function",
                "contract": contract
            })
            caller_id = item_id
            self.calls_dict[caller_id] = []
            self.assigns_dict[caller_id] = []
            self.imports_dict[caller_id] = []
            self.generic_visit(node)
            self.current_func = None

        def visit_Call(self, node):
            called = None
            if isinstance(node.func, ast.Attribute):
                if isinstance(node.func.value, ast.Name) and node.func.value.id == 'self':
                    called = node.func.attr
            elif isinstance(node.func, ast.Name):
                called = node.func.id
            if called and self.current_func is not None:
                caller_id = f"{self.current_class}.{self.current_func}" if self.current_class and self.current_func else self.current_func or 'global'
                called_id = f"{self.current_class}.{called}" if self.current_class else called
                if called_id not in self.built_ins and called_id not in self.calls_dict.get(caller_id, []):
                    self.calls_dict[caller_id] = self.calls_dict.get(caller_id, []) + [called_id]
            self.generic_visit(node)

        def visit_Assign(self, node):
            if self.current_func:
                caller_id = f"{self.current_class}.{self.current_func}" if self.current_class and self.current_func else self.current_func or 'global'
                if isinstance(node.value, ast.Call):
                    called = node.value.func.id if isinstance(node.value.func, ast.Name) else node.value.func.attr if isinstance(node.value.func, ast.Attribute) else None
                    if called and called not in self.built_ins:
                        called_id = f"{self.current_class}.{called}" if self.current_class else called
                        if called_id not in self.assigns_dict.get(caller_id, []):
                            self.assigns_dict[caller_id] = self.assigns_dict.get(caller_id, []) + [called_id]
            self.generic_visit(node)

        def visit_Import(self, node):
            if self.current_func or self.current_class:
                caller_id = f"{self.current_class}.{self.current_func}" if self.current_class and self.current_func else self.current_class or 'global'
                for alias in node.names:
                    lib = alias.name.split('.')[0]
                    if lib not in self.built_ins:
                        lib_id = f"lib.{lib}"
                        if lib_id not in self.imports_dict.get(caller_id, []):
                            self.imports_dict[caller_id] = self.imports_dict.get(caller_id, []) + [lib_id]
            self.generic_visit(node)

        def visit_ImportFrom(self, node):
            if self.current_func or self.current_class:
                caller_id = f"{self.current_class}.{self.current_func}" if self.current_class and self.current_func else self.current_class or 'global'
                lib = node.module.split('.')[0] if node.module else 'unknown'
                for alias in node.names:
                    imported = alias.name
                    lib_id = f"lib.{lib}.{imported}"
                    if lib_id not in self.built_ins and lib_id not in self.imports_dict.get(caller_id, []):
                        self.imports_dict[caller_id] = self.imports_dict.get(caller_id, []) + [lib_id]
            self.generic_visit(node)

    parser = ImprovedCodeParser()
    parser.visit(tree)
    
    ai_items = {}
    for item_data in parser.items:
        ai_items[item_data["id"]] = AIItem(**item_data)
    
    # Объединяем calls + assigns + imports в calls_dict для L1
    calls_dict = parser.calls_dict
    for k, v in parser.assigns_dict.items():
        calls_dict.setdefault(k, []).extend([f"{x} (assign)" for x in v])
    for k, v in parser.imports_dict.items():
        calls_dict.setdefault(k, []).extend([f"{x} (import)" for x in v])
    
    print(f"Parsed calls example: {list(calls_dict.items())[:3]}")  # Debug
    return ai_items, calls_dict

# === КОНЕЦ ТВОЕГО КОДА ===

# ------------------------------------------------------------------
# ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ И ИНИЦИАЛИЗАЦИЯ
# ------------------------------------------------------------------

# Глобальные переменные (будут инициализированы при старте сервера)
ai_items: Dict[str, AIItem] = {}
G = nx.DiGraph()
retriever: Optional[EmbedRetriever] = None
l2_generator: Optional[L2Generator] = None

embeddings_path = Path("data/ai_embeddings.pkl")
l1_cache_path = Path("data/ai_l1_cache.json")
l2_cache_path = Path("data/ai_l2_cache.json")

# Убеждаемся, что директория data/ существует
DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)

def init_engine(
    use_llm_l1: bool = False,
    load_cache: bool = True,
    save_cache: bool = True,
    api_url: str = 'http://usa:3002/api/send-request',
    model: str = 'FAST',
    llm_raw: bool = False
):
    """Инициализация RAG движка"""
    global ai_items, G, retriever, l2_generator
    
    print("Инициализация Kosmos Vector RAG Engine...")
    
    # 1. Self-parsing - теперь возвращает уже готовые AIItem объекты
    ai_items_data, calls_dict = parse_self_to_ai_items()
    
    # 2. ai_items_data уже содержит AIItem объекты
    ai_items.clear()
    ai_items.update(ai_items_data)
    
    # Добавляем обязательные поля по контракту
    for item in ai_items.values():
        item.file_path = __file__  # пока один файл
        item.language = "python"
    
    # 3. Загрузка L1 кэша
    l1_cache_loaded_ids = set()
    if load_cache and l1_cache_path.exists():
        print("Загрузка L1 кэша...")
        l1_cache = load_l1_cache(str(l1_cache_path))
        for item_id, item in ai_items.items():
            if item_id in l1_cache:
                cache_entry = l1_cache[item_id]
                try:
                    item.l1_edges = json.loads(cache_entry['l1_edges'])
                    l1_cache_loaded_ids.add(item_id)
                    print(f"Loaded L1 for {item_id} from cache (source: {cache_entry.get('source', 'unknown')})")
                except (json.JSONDecodeError, KeyError) as e:
                    print(f"Error loading L1 cache for {item_id}: {e}")
        print(f"Loaded {len(l1_cache_loaded_ids)} L1 items from cache")
    
    # 4. L1 граф (строится из calls_dict, если L1 не загружен из кэша)
    G = build_graph(ai_items, calls_dict)
    
    # 5. LLM полировка L1 (если включено)
    if use_llm_l1:
        print("Applying LLM polish to L1...")
        for item_id, item in ai_items.items():
            if item_id not in l1_cache_loaded_ids:  # Полируем только те, что не из кэша
                raw_edges = calls_dict.get(item_id, [])
                polished_edges = polish_l1_with_llm(item, raw_edges, api_url, model, dry_run=False, llm_raw=llm_raw)
                item.l1_edges = polished_edges
                time.sleep(1)  # Anti-overload sleep
        
        # Сохранение L1 кэша после LLM polish
        if save_cache:
            l1_cache_new = {}
            for item_id, item in ai_items.items():
                if item.l1_edges:
                    l1_cache_new[item_id] = {
                        "l1_edges": json.dumps(item.l1_edges, ensure_ascii=False),
                        "type": item.type,
                        "file_path": item.file_path or __file__,
                        "source": "LLM",
                        "timestamp": time.time()
                    }
            if l1_cache_new:
                merge_l1_cache(l1_cache_new, str(l1_cache_path))
                print(f"L1 cache updated: {len(l1_cache_new)} items (LLM).")
            print(f"L1 stats: {stat_l1_cache(str(l1_cache_path))}")
    elif save_cache:
        # Сохранение L1 кэша для AST-сгенерированных edges
        l1_cache_new = {}
        for item_id, item in ai_items.items():
            if item.l1_edges and item_id not in l1_cache_loaded_ids:
                l1_cache_new[item_id] = {
                    "l1_edges": json.dumps(item.l1_edges, ensure_ascii=False),
                    "type": item.type,
                    "file_path": item.file_path or __file__,
                    "source": "AST",
                    "timestamp": time.time()
                }
        if l1_cache_new:
            merge_l1_cache(l1_cache_new, str(l1_cache_path))
            print(f"L1 cache updated: {len(l1_cache_new)} items (AST).")
    
    # 6. Загрузка L2 кэша
    l2_cache_loaded_ids = set()
    if load_cache and l2_cache_path.exists():
        print("Загрузка L2 кэша...")
        l2_cache = load_l2_cache(str(l2_cache_path))
        for item_id, item in ai_items.items():
            if item_id in l2_cache:
                cache_entry = l2_cache[item_id]
                try:
                    item.l2 = json.loads(cache_entry['l2'])
                    l2_cache_loaded_ids.add(item_id)
                    print(f"Loaded L2 for {item_id} from cache (source: {cache_entry.get('source', 'unknown')})")
                except (json.JSONDecodeError, KeyError) as e:
                    print(f"Error loading L2 cache for {item_id}: {e}")
        print(f"Loaded {len(l2_cache_loaded_ids)} L2 items from cache")
    
    # 7. L2 генерация
    l2_generator = L2Generator(api_url=api_url, model=model, dry_run=False, llm_raw=llm_raw)
    items_to_generate = [item for item in ai_items.values() if item.l2 is None]
    
    if items_to_generate:
        print(f"Генерация L2 описаний для {len(items_to_generate)} элементов...")
        l2_generator.generate_l2_batch(items_to_generate, batch_size=5)
        
        # Сохранение L2 кэша после генерации
        if save_cache:
            l2_cache_new = {}
            for item in items_to_generate:
                if item.l2:
                    l2_cache_new[item.id] = {
                        "l2": json.dumps(item.l2, ensure_ascii=False),
                        "type": item.type,
                        "file_path": item.file_path or __file__,
                        "source": "LLM" if not l2_generator.dry_run else "Fallback",
                        "timestamp": time.time()
                    }
            if l2_cache_new:
                merge_l2_cache(l2_cache_new, str(l2_cache_path))
                print(f"L2 cache updated: {len(l2_cache_new)} items.")
            print(f"L2 stats: {stat_l2_cache(str(l2_cache_path))}")
    else:
        print("All L2 already loaded from cache.")
    
    # 8. Embeddings
    retriever = EmbedRetriever(pickle_path=str(embeddings_path))
    retriever.add_items(ai_items, generator=l2_generator)
    
    # 9. Сохранение fallback L2 (если были сгенерированы через EmbedRetriever)
    if save_cache:
        l2_cache_fallback = {}
        for item_id, item in ai_items.items():
            if item.l2 and item_id not in l2_cache_loaded_ids and item_id not in {it.id for it in items_to_generate}:
                # Новый L2, не из кэша и не из основной генерации - значит fallback из EmbedRetriever
                l2_cache_fallback[item_id] = {
                    "l2": json.dumps(item.l2, ensure_ascii=False),
                    "type": item.type,
                    "file_path": item.file_path or __file__,
                    "source": "Fallback",
                    "timestamp": time.time()
                }
        if l2_cache_fallback:
            merge_l2_cache(l2_cache_fallback, str(l2_cache_path))
            print(f"L2 cache updated (fallback): {len(l2_cache_fallback)} items.")
    
    print(f"Готово! Проиндексировано {len(ai_items)} элементов.")
