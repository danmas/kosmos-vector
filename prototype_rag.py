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
                item.l2 = self.generate_l2(item)
                time.sleep(1)  # Anti-overload
        return items

    def _build_prompt(self, item: AIItem) -> str:
        args_str = ', '.join(item.contract.get('args', [])) if 'args' in item.contract else 'N/A'
        docstring = item.contract.get('docstring', 'No docstring')
        calls = item.l1_edges if item.l1_edges else item.contract.get('uses', [])  # Fallback на uses

        function_info = f"""
ID: {item.id}
Type: {item.type}
Args: {args_str}
Docstring: {docstring}
L0 Code: {item.l0_snippet[:300]}...  # Snippet для контекста
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
        uses = contract.get('uses', ['N/A'])
        returns = contract.get('returns', 'N/A')

        # Snippet parse: extract key phrases
        snippet = item.l0_snippet.lower()
        init_hint = "init" if "def __init__" in snippet else ""
        calls_hint = ', '.join([e['to'] for e in (item.l1_edges or [])[:2]]) if item.l1_edges else 'N/A'
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

# EmbedRetriever (улучшенный с FAISS fallback, но сначала retrieval boosts)
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

    def add_items(self, ai_items: Dict[str, AIItem]):
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
        if REAL_MODEL:
            return self.model.encode(texts)
        else:
            # Mock
            print(f"Mock encoding {len(texts)} texts with model {self.model_name}")
            vectors = []
            for text in texts:
                text_hash = hash(text) % 10000
                np.random.seed(text_hash)
                vector = np.random.normal(0, 1, self.dim)
                vector = vector / np.linalg.norm(vector)
                vectors.append(vector)
            return np.array(vectors)

    def _save_pickle(self):
        data = {
            'ids': list(self.texts.keys()),
            'texts': self.texts,
            'embeddings': [emb.tolist() for emb in self.embeddings_dict.values()]
        }
        with open(self.pickle_path, 'wb') as f:
            pickle.dump(data, f)

    def encode_query(self, query: str) -> np.ndarray:
        global REAL_MODEL
        if REAL_MODEL and self.model is None:
            self.model = SentenceTransformer(self.model_name)
            print(f"Loaded model: {self.model_name}")
        if REAL_MODEL and self.model:
            return self.model.encode([f"query: {query}"])
        else:
            np.random.seed(42)
            return np.random.normal(0, 1, self.dim).reshape(1, -1) / np.linalg.norm(np.random.normal(0, 1, self.dim))

    def get_similarities(self, query_embedding: np.ndarray, ai_items: Dict[str, AIItem], top_k: int = 3) -> List[AIItem]:
        similarities = []
        for iid, item in ai_items.items():
            if iid in self.embeddings_dict:
                item_emb = self.embeddings_dict[iid]
                sim = cosine_similarity(query_embedding, item_emb.reshape(1, -1))[0][0]
                similarities.append((sim, iid))
        similarities.sort(reverse=True)
        return [ai_items[iid] for _, iid in similarities[:top_k]]

# Остальные функции (build_graph, choose_levels, build_rag) без изменений
def build_graph(ai_items_list: List[AIItem], calls_dict: Dict[str, List[str]]) -> DiGraph:
    G = DiGraph()
    for item in ai_items_list:
        G.add_node(item.id, type=item.type, l2=item.l2, weight=item.contract.get('weight', 1.0))
    for caller, targets in calls_dict.items():
        for target in targets:
            edge_type = 'unknown'
            if '(contains)' in target:
                edge_type = 'contains'
            elif '(assign)' in target:
                edge_type = 'assign'
            elif '(import)' in target:
                edge_type = 'import'
            else:
                edge_type = 'calls'
            clean_target = target.split(' ')[0]
            if clean_target in G.nodes:
                G.add_edge(caller, clean_target, type=edge_type, weight=0.95)
    return G

def choose_levels(query: str) -> Dict[str, bool]:
    query_lower = query.lower()
    levels = {'L0': False, 'L1': False, 'L2': True}  # L2 always
    if any(word in query_lower for word in ['код', 'snippet', 'debug']):
        levels['L0'] = True
    if any(word in query_lower for word in ['связи', 'edges', 'graph', 'depends']):
        levels['L1'] = True
    return levels

def build_rag(retrieved: List[AIItem], levels: Dict[str, bool], generator: Optional[L2Generator] = None) -> str:
    rag_parts = []
    for item in retrieved:
        # Lazy L2 gen
        if not item.l2 and generator:
            item.generate_l2(generator)
        elif not item.l2:
            item.generate_l2()

        # Header
        rag_parts.append(f"\n=== {item.id} ({item.type}) ===")

        # L2 flatten
        l2 = item.l2 or {}
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

        # L1 edges
        if levels['L1'] and item.l1_edges:
            edges_str = ', '.join([f"{e['to']} ({e['type']}: {e.get('reason', 'N/A')})" for e in item.l1_edges[:3]])
            rag_parts.append(f"Связи: {edges_str}")

        # L0 snippet
        if levels['L0']:
            snippet = item.l0_snippet[:150].replace('\n', ' ')
            rag_parts.append(f"Код: {snippet}...")

    return '\n'.join(rag_parts)

# Улучшенный retrieve_ai_items с keyword boost, graph expansion, min_weight
def retrieve_ai_items(query: str, G: DiGraph, ai_index: Dict[str, AIItem], retriever: EmbedRetriever, top_k: int = 3, min_weight: float = 0.8) -> List[AIItem]:
    """Hybrid retrieval: cosine + keyword boost + graph neighbors с centrality + min_weight filter."""
    if not ai_index:
        return []

    query_embedding = retriever.encode_query(query)
    q_words = query.lower().split()  # Для keyword match

    # Base sim scores
    sim_scores = {}
    for iid, item in ai_index.items():
        if iid in retriever.embeddings_dict:
            item_emb = retriever.embeddings_dict[iid]
            sim = cosine_similarity(query_embedding, item_emb.reshape(1, -1))[0][0]
            # Keyword boost
            patterns = item.contract.get('query_patterns', [])
            keyword_score = sum(1 for word in q_words if any(word in pat.lower() for pat in patterns)) / max(len(q_words), 1)
            total_score = sim + keyword_score * 0.2  # Boost 0.2
            sim_scores[iid] = total_score

    # Min_weight filter
    filtered_scores = {iid: score for iid, score in sim_scores.items() if ai_index[iid].contract.get('weight', 1.0) >= min_weight}

    # Graph expansion: +neighbors с pagerank boost
    pagerank = nx.pagerank(G)  # Precompute centrality
    expanded_scores = filtered_scores.copy()
    for iid, score in filtered_scores.items():
        # Neighbors (successors, depth=1)
        neighbors = list(nx.descendants(G, iid))[:5]  # Limit
        for n in neighbors:
            if n in ai_index:
                graph_boost = pagerank.get(n, 0) * 0.15  # Centrality boost
                expanded_scores[n] = expanded_scores.get(n, 0) + graph_boost

    # Re-rank и top-k
    sorted_items = sorted(expanded_scores.items(), key=lambda x: x[1], reverse=True)
    top_ids = [iid for iid, _ in sorted_items[:top_k]]
    retrieved = [ai_index[iid] for iid in top_ids]

    print(f"Retrieved with boosts: {len(retrieved)} items (sim+keyword+graph)")
    return retrieved

def parse_self_to_ai_items(auto_l1: bool = True, llm_l1: bool = False, api_url: str = 'http://usa:3002/api/send-request') -> tuple[Dict[str, AIItem], Dict[str, List[str]]]:
    with open(__file__, 'r', encoding='utf-8-sig') as f:
        code = f.read()
    tree = ast.parse(code)

    # Парсер (без изменений, но с args/docstring)
    class ImprovedCodeParser(ast.NodeVisitor):
        def __init__(self):
            self.items = []
            self.calls_dict = {}
            self.assigns_dict = {}
            self.imports_dict = {}
            self.current_class = None
            self.current_func = None
            self.built_ins = {'print', 'len', 'str', 'int', 'list', 'dict', 'np', 'torch', 'time', 'json', 'requests', 'ast', 'nx', 'pickle'}

        def visit_ClassDef(self, node):
            self.current_class = node.name
            self.current_func = None
            purpose = f"Class {node.name} in RAG prototype."
            contract = {
                "purpose": purpose,
                "query_patterns": [node.name],
                "weight": 1.5,
                "uses": [],
                "returns": "instance",
                "edge_cases": "N/A",
                "args": [],  # Classes no args
                "docstring": ast.get_docstring(node) or "No docstring"
            }
            snippet = ast.unparse(node)[:200] + "..."
            self.items.append({"id": node.name, "type": "class", "l0_snippet": snippet, "contract": contract})
            self.generic_visit(node)
            self.current_class = None

        def visit_FunctionDef(self, node):
            self.current_func = node.name
            purpose = f"Function {node.name} in RAG prototype."
            args = [arg.arg for arg in node.args.args]
            docstring = ast.get_docstring(node) or "No docstring"
            contract = {
                "purpose": purpose,
                "query_patterns": [node.name],
                "weight": 1.0,
                "uses": [],
                "returns": "result",
                "edge_cases": "N/A",
                "args": args,
                "docstring": docstring
            }
            snippet = ast.unparse(node)[:200] + "..."
            self.items.append({"id": f"{self.current_class}.{node.name}" if self.current_class else node.name, "type": "function", "l0_snippet": snippet, "contract": contract})
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