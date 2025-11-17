import json
import numpy as np
import pickle
import time
import requests
from typing import Dict, List, Any, Optional
import networkx as nx
from networkx import DiGraph
from sklearn.metrics.pairwise import cosine_similarity
import ast  # Для self-parsing

# Для реальной e5-small: pip install sentence-transformers
try:
    from sentence_transformers import SentenceTransformer
    REAL_MODEL = True
    print("SentenceTransformer imported successfully.")
except ImportError:
    REAL_MODEL = False
    print("SentenceTransformer not available, using mock.")

# Класс для AI_ITEM (без изменений)
class AIItem:
    def __init__(self, id: str, type: str, l0_snippet: str, contract: Dict[str, Any]):
        self.id = id
        self.type = type
        self.l0_snippet = l0_snippet
        self.contract = contract
        self.l1_edges = []
        self.l2 = None
        self.embedding = None

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


class L2Generator:
    """Генератор L2 c LLM и fallback."""

    def __init__(
        self,
        api_url: str = 'http://usa:3002/api/send-request',
        model: str = 'FAST',
        max_retries: int = 3,
        dry_run: bool = False
    ):
        self.api_url = api_url
        self.model = model
        self.max_retries = max_retries
        self.dry_run = dry_run
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
        for i in range(0, len(items), batch_size):
            batch = items[i:i + batch_size]
            for item in batch:
                if item.l2 is None:
                    item.l2 = self.generate_l2(item)
                    time.sleep(1)
        return items

    def _build_prompt(self, item: AIItem) -> str:
        args = item.contract.get('args', [])
        args_str = ', '.join(args) if args else 'N/A'
        docstring = item.contract.get('docstring', 'No docstring')
        calls = item.l1_edges if item.l1_edges else item.contract.get('uses', [])
        snippet = item.l0_snippet[:300]

        function_info = f"""
ID: {item.id}
Type: {item.type}
Args: {args_str}
Docstring: {docstring}
L0 Code: {snippet}...
L1 Calls/Edges: {calls}
"""
        prompt = (
            "Проанализируй код и сгенерируй L2 в JSON:\n"
            "- purpose: основная цель (1-2 предложения)\n"
            "- uses: список (2-4) примеров использования/зависимостей\n"
            "- returns: что возвращает (или 'None')\n"
            "- edge_cases: 1-2 особенности/ошибки\n\n"
            f"{function_info}\nВыводи ТОЛЬКО JSON."
        )
        return prompt

    def _fallback_l2(self, item: AIItem) -> Dict[str, Any]:
        contract = item.contract
        purpose = contract.get('purpose', f"{item.type.capitalize()} {item.id}")
        docstring = contract.get('docstring', 'No docstring')
        args = contract.get('args', [])
        uses = contract.get('uses', ['N/A'])
        returns = contract.get('returns', 'N/A')
        
        # Snippet parse: extract key phrases
        snippet = item.l0_snippet.lower()
        init_hint = "init" if "def __init__" in snippet else ""
        calls_hint = ', '.join([e['to'] for e in (item.l1_edges or [])[:2]]) or 'N/A'
        edge_hint = "handles conditions" if any(word in snippet for word in ['if', 'try', 'except']) else "N/A"
        
        # Enrich purpose
        purpose += f" (Doc: {docstring[:50]}...)" if docstring != 'No docstring' else ""
        if args:
            purpose += f" Args: {', '.join(args)}"
        purpose += f". Snippet: {item.l0_snippet[:80]}... Calls: {calls_hint}."
        
        return {
            'purpose': purpose,
            'uses': uses if uses != ['N/A'] else [f"Called by {calls_hint}" if calls_hint != 'N/A' else 'In RAG pipeline'],
            'returns': returns,
            'edge_cases': edge_hint
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
def build_graph(ai_items: List[AIItem], calls_dict: Dict[str, List[str]], save_cache: bool = False) -> DiGraph:
    G = DiGraph()
    for item in ai_items:
        G.add_node(item.id, type=item.type, weight=item.contract.get('weight', 1.0))
    # Хардкод закомментирован для теста auto
    # hardcode_edges = [
    #     ('AIItem', 'AIItem.__init__', {'type': 'contains', 'weight': 1.0}),
    #     # ... other hardcode
    # ]
    # G.add_edges_from(hardcode_edges)
    
    # Только auto-edges из calls_dict
    for caller, called_list in calls_dict.items():
        for called in called_list:
            called_id = called.split(' (')[0]  # Clean (assign/import)
            if called_id in [i.id for i in ai_items]:
                edge_type = 'calls' if not ' (' in called else called.split(' (')[1].rstrip(')')
                G.add_edge(caller, called_id, type=edge_type, weight=0.95)
    for item in ai_items:
        neighbors = list(G.successors(item.id)) + list(G.predecessors(item.id))
        item.l1_edges = [{'to': n, 'type': G[item.id][n].get('type', 'unknown') if n in G.successors(item.id) else G[n][item.id].get('type', 'unknown')} for n in set(neighbors)]
    
    # Опциональное сохранение кэша (source="AST")
    if save_cache:
        try:
            from l1_cache_utils import merge_l1_cache
            l1_cache_new = {}
            for item in ai_items:
                if item.l1_edges:
                    l1_cache_new[item.id] = {
                        "l1_edges": json.dumps(item.l1_edges, ensure_ascii=False),
                        "type": item.type,
                        "file_path": __file__,
                        "source": "AST",
                        "timestamp": time.time()
                    }
            if l1_cache_new:
                merge_l1_cache(l1_cache_new)
        except ImportError:
            pass  # l1_cache_utils может быть недоступен
    
    return G

def choose_levels(query: str) -> Dict[str, bool]:
    query_lower = query.lower()
    return {
        'L0': 'код' in query_lower or 'debug' in query_lower,
        'L1': 'связи' in query_lower,
        'L2': True
    }

# def build_rag(retrieved: List[AIItem], levels: Dict[str, bool], generator: Optional[L2Generator] = None) -> str:
    rag = []
    for item in retrieved:
        if levels['L2']:
            item.generate_l2(generator)
            l2_json = json.dumps(item.l2, ensure_ascii=False, separators=(', ', ': '))
            rag.append(f"[L2: {item.id}] {l2_json}")
        if levels['L1']:
            l1_json = json.dumps(item.l1_edges, ensure_ascii=False, separators=(', ', ': '))
            rag.append(f"[L1: {item.id}] Edges: {l1_json}")
        if levels['L0']:
            rag.append(f"[L0: {item.id}] {item.l0_snippet[:100]}...")
    return '\n'.join(rag)
def build_rag(retrieved: List[AIItem], levels: Dict[str, bool], generator: L2Generator = None) -> str:
    rag_parts = []
    for item in retrieved:
        # Lazy L2 gen с generator если передан
        if not item.l2 and generator:
            item.generate_l2(generator)
        elif not item.l2:
            item.generate_l2()  # Fallback auto
        
        # Header: ID + type для контекста
        rag_parts.append(f"\n=== {item.id} ({item.type}) ===")
        
        # L2: Flatten в факты (если LLM — structured, fallback — auto)
        l2 = item.l2 or {}  # Dict {'purpose': ..., 'uses': [...], ...}
        if levels['L2']:
            purpose = l2.get('purpose', 'N/A')
            uses = ', '.join(l2.get('uses', [])) if l2.get('uses') else 'N/A'
            returns = l2.get('returns', 'N/A')
            edge_cases = l2.get('edge_cases', 'N/A')
            rag_parts.append(f"Цель: {purpose}")
            if uses != 'N/A':
                rag_parts.append(f"Использование: {uses}")
            rag_parts.append(f"Возвращает: {returns}")
            if edge_cases != 'N/A':
                rag_parts.append(f"Особенности: {edge_cases}")
        
        # L1: Связи как список (если levels)
        if levels['L1'] and item.l1_edges:
            edges_str = ', '.join([f"{e['to']} ({e['type']}: {e.get('reason', 'N/A')})" for e in item.l1_edges[:3]])  # Top-3
            rag_parts.append(f"Связи: {edges_str}")
        
        # L0: Snippet только по запросу (e.g., 'код'), укороченный
        if levels['L0']:
            snippet = item.l0_snippet[:150].replace('\n', ' ')  # Inline, без multiline
            rag_parts.append(f"Код: {snippet}...")
    
    return '\n'.join(rag_parts)

def retrieve_ai_items(query: str, G: DiGraph, ai_items: Dict[str, AIItem], retriever: EmbedRetriever, top_k: int = 3) -> List[AIItem]:
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
            snippet = ""
            if node.body:
                # Углубление: Добавляем 'contains' edges к методам класса
                method_ids = [stmt.name for stmt in node.body if isinstance(stmt, ast.FunctionDef)]
                for m in method_ids:
                    self.calls_dict[self.current_class].append(f"{self.current_class}.{m} (contains)")
                snippet_lines = [ast.unparse(stmt) for stmt in node.body[:2] if not isinstance(stmt, ast.FunctionDef)]
                snippet = "; ".join(snippet_lines)
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
            self.items.append({
                "id": item_id,
                "type": "class",
                "l0_snippet": snippet[:200] + "..." if len(snippet) > 200 else snippet,
                "contract": contract
            })
            self.generic_visit(node)
            self.current_class = None

        def visit_FunctionDef(self, node):
            self.current_func = node.name
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
            self.items.append({
                "id": item_id,
                "type": "function",
                "l0_snippet": snippet[:200] + "..." if len(snippet) > 200 else snippet,
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
                lib = node.module.split('.')[0]
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

# Глобальная база (убрана, теперь lazy в CLI)
# ai_items_data, calls_dict = parse_self_to_ai_items()
# print(f"Self-indexed: {len(ai_items_data)} AI_ITEM из прототипа.")