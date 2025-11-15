import json
import numpy as np
import pickle
from typing import Dict, List, Any
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

    def generate_l2(self):
        purpose = self.contract.get('purpose', 'N/A')
        uses = self.contract.get('uses', [])
        returns = self.contract.get('returns', 'N/A')
        edge_cases = self.contract.get('edge_cases', 'N/A')
        self.l2 = {'purpose': purpose, 'uses': uses, 'returns': returns, 'edge_cases': edge_cases}
        return self.l2

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

# Функции (build_graph FIXED: хардкод + auto для L1)
def build_graph(ai_items: List[AIItem], calls_dict: Dict[str, List[str]]) -> DiGraph:
    G = DiGraph()
    for item in ai_items:
        G.add_node(item.id, type=item.type, weight=item.contract.get('weight', 1.0))
    # Хардкод релевантных edges (для демонстрации L1)
    hardcode_edges = [
        ('AIItem', 'AIItem.__init__', {'type': 'contains', 'weight': 1.0}),
        ('AIItem.__init__', 'AIItem.generate_l2', {'type': 'calls', 'weight': 0.95}),
        ('EmbedRetriever', 'EmbedRetriever._generate_if_needed', {'type': 'contains', 'weight': 1.0}),
        ('EmbedRetriever._generate_if_needed', 'EmbedRetriever._encode', {'type': 'calls', 'weight': 0.95}),
        ('retrieve_ai_items', 'EmbedRetriever.get_similarities', {'type': 'uses', 'weight': 0.9}),
        ('build_rag', 'AIItem.generate_l2', {'type': 'calls', 'weight': 0.95}),
        ('parse_self_to_ai_items', 'ImprovedCodeParser.visit_Call', {'type': 'calls', 'weight': 0.95}),
        ('ImprovedCodeParser.visit_Call', 'ast.NodeVisitor.generic_visit', {'type': 'calls', 'weight': 0.9}),
    ]
    # Auto-edges из calls_dict
    for caller, called_list in calls_dict.items():
        for called in called_list:
            called_id = f"{caller.split('.')[0]}.{called}" if caller.split('.') and called.startswith('_') else called
            if called_id in [i.id for i in ai_items]:
                hardcode_edges.append((caller, called_id, {'type': 'calls', 'weight': 0.95}))
    G.add_edges_from(hardcode_edges)
    for item in ai_items:
        neighbors = list(G.successors(item.id)) + list(G.predecessors(item.id))
        item.l1_edges = [{'to': n, 'type': G[item.id][n].get('type', 'unknown') if n in G.successors(item.id) else G[n][item.id].get('type', 'unknown')} for n in set(neighbors)]
    return G

def choose_levels(query: str) -> Dict[str, bool]:
    query_lower = query.lower()
    return {
        'L0': 'код' in query_lower or 'debug' in query_lower,
        'L1': 'связи' in query_lower,
        'L2': True
    }

def build_rag(retrieved: List[AIItem], levels: Dict[str, bool]) -> str:
    rag = []
    for item in retrieved:
        if not item.l2:
            item.generate_l2()
        if levels['L2']:
            l2_json = json.dumps(item.l2, ensure_ascii=False, separators=(', ', ': '))
            rag.append(f"[L2: {item.id}] {l2_json}")
        if levels['L1']:
            l1_json = json.dumps(item.l1_edges, ensure_ascii=False, separators=(', ', ': '))
            rag.append(f"[L1: {item.id}] Edges: {l1_json}")
        if levels['L0']:
            rag.append(f"[L0: {item.id}] {item.l0_snippet[:100]}...")
    return '\n'.join(rag)

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

# FIXED Self-indexing: ImprovedCodeParser с full ID и фильтром built-ins
def parse_self_to_ai_items() -> tuple[Dict[str, AIItem], Dict[str, List[str]]]:
    with open(__file__, 'r', encoding='utf-8-sig') as f:
        code = f.read()
    tree = ast.parse(code)
    
    class ImprovedCodeParser(ast.NodeVisitor):
        def __init__(self):
            self.items = []
            self.current_class = None
            self.current_func = None
            self.calls_dict = {}
            self.built_ins = ['print', 'len', 'str', 'list', 'dict', 'np', 'json', 'pickle', 'open', 'np.random', 'ast.parse']  # Фильтр

        def visit_ClassDef(self, node):
            self.current_class = node.name
            self.calls_dict[self.current_class] = []
            snippet = ""
            if node.body:
                snippet_lines = [ast.unparse(stmt) for stmt in node.body[:2] if not isinstance(stmt, ast.FunctionDef)]
                snippet = "; ".join(snippet_lines)
            purpose = f"Класс {node.name} в прототипе RAG-системы."
            contract = {
                "purpose": purpose,
                "query_patterns": [node.name.lower()],
                "weight": 2.0,
                "uses": [],
                "returns": "instance",
                "edge_cases": "N/A"
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
            contract = {
                "purpose": purpose,
                "query_patterns": [node.name],
                "weight": 1.5,
                "uses": [],
                "returns": "result",
                "edge_cases": "N/A"
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
                called_id = f"{self.current_class}.{called}" if self.current_class else called  # FIXED: Full ID for self.calls
                if called_id not in self.built_ins and called_id not in self.calls_dict.get(caller_id, []):  # FIXED: Фильтр built-ins
                    self.calls_dict[caller_id] = self.calls_dict.get(caller_id, []) + [called_id]
            self.generic_visit(node)

    parser = ImprovedCodeParser()
    parser.visit(tree)
    
    ai_items = {}
    for item_data in parser.items:
        ai_items[item_data["id"]] = AIItem(**item_data)
    calls_dict = parser.calls_dict
    print(f"Parsed calls example: {list(calls_dict.items())[:3]}")  # Debug
    return ai_items, calls_dict

# Глобальная база
ai_items_data, calls_dict = parse_self_to_ai_items()
print(f"Self-indexed: {len(ai_items_data)} AI_ITEM из прототипа.")