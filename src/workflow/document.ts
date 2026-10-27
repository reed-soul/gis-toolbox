// 步骤列表和画布保存的是同一份作业。
// 没有分叉时，列表是从上到下的看法；分叉了，就在画布上看。

export const GRAPH_FORMAT = "gistool.dag";
export const GRAPH_VERSION = 1;

/** 免费版最多 5 个算子，沿用 featureRegistry 里 workflow.freeCaps.steps。 */
export const FREE_OPERATOR_CAP = 5;

/** 超过 8 个算子，或链接本身超过 8000 个字符，就改下载文件。 */
export const HASH_OPERATOR_CAP = 8;
export const HASH_MAX_LENGTH = 8000;

const WORKFLOW_OPERATORS = [
  "spatial.buffer",
  "spatial.simplify",
  "spatial.dissolve",
  "spatial.centroid",
  "spatial.bbox",
  "spatial.convexHull",
  "spatial.filter",
  "spatial.reproject",
  "spatial.explode",
  "spatial.flatten",
  "spatial.measure",
  "spatial.fixGeometry",
  "spatial.concaveHull",
  "spatial.polygonToLine",
  "spatial.smooth",
  "spatial.validateTopology",
  "spatial.h3Bin",
  "spatial.moransI",
  "data.fieldCalc",
  "spatial.intersect",
  "spatial.union",
  "spatial.difference",
  "spatial.clip",
  "spatial.nearestPoint",
  "spatial.spatialJoin",
  "spatial.selectByLocation",
  "data.merge",
  "data.attributeJoin",
] as const;

const SECOND_INPUT = new Set<string>([
  "spatial.intersect",
  "spatial.union",
  "spatial.difference",
  "spatial.clip",
  "spatial.nearestPoint",
  "spatial.spatialJoin",
  "spatial.selectByLocation",
  "data.merge",
  "data.attributeJoin",
]);

const REQUIRED_FIELDS: Record<string, string[]> = {
  "data.fieldCalc": ["targetField", "expression"],
  "data.attributeJoin": ["leftKey", "rightKey"],
  "spatial.moransI": ["valueField"],
};

const DEFAULTS: Record<string, Record<string, unknown>> = {
  "spatial.h3Bin": { cellSideKm: 10 },
  "spatial.smooth": { iterations: 3 },
  "spatial.concaveHull": { concavity: 2 },
  "spatial.spatialJoin": { predicate: "intersects" },
  "spatial.selectByLocation": { predicate: "intersects" },
  "spatial.moransI": { kNeighbors: 5 },
};

const PREDICATES = new Set(["intersects", "within", "contains"]);
const EPSG = /^EPSG:\d{1,6}$/i;

const COLUMN_X = 220;
const PRIMARY_Y = 100;
const SECOND_Y = 260;

export type Screen = "list" | "canvas";

export type SourceNode = {
  id: string;
  kind: "source";
  position: { x: number; y: number };
  source: { fileId: string; label: string };
};

export type OperatorNode = {
  id: string;
  kind: "operator";
  position: { x: number; y: number };
  operator: { opId: string; params: Record<string, unknown> };
};

export type GraphNode = SourceNode | OperatorNode;

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  inputIndex: 0 | 1;
};

export type Graph = {
  version: 1;
  name?: string;
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
  createdAt: string;
  updatedAt: string;
};

export type RecipeStep = {
  operator: string;
  params: Record<string, unknown>;
  inputBFileId?: string;
};

export type Recipe = {
  name: string;
  files: { id: string; name: string }[];
  steps: RecipeStep[];
};

export type LegacyStep = {
  id: string;
  operator: string;
  params: Record<string, unknown>;
  inputBFileId?: string;
};

export type LegacyRecipe = {
  version: 2;
  name: string;
  steps: LegacyStep[];
  files: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
};

export type OpenedJob = {
  screen: Screen;
  graph: Graph;
  path: Recipe | null;
};

export type Share =
  | { kind: "link"; hash: string }
  | { kind: "file"; filename: string; body: string };

export type CapCheck = {
  ok: boolean;
  unit: "steps";
  cap: number;
  actual: number;
};

export type RuntimeGraph = Graph & {
  results: Record<string, unknown>;
  dirty: Set<string>;
  errors: Record<string, string>;
  running: Set<string>;
};

export type NodeStatus =
  | "idle"
  | "ready"
  | "running"
  | "done"
  | "error"
  | "blocked";

export function isWorkflowOperator(opId: string): boolean {
  return (WORKFLOW_OPERATORS as readonly string[]).includes(opId);
}

export function takesSecondInput(opId: string): boolean {
  return SECOND_INPUT.has(opId);
}

export function operatorNodeCount(graph: Graph): number {
  return Object.values(graph.nodes).filter((node) => node.kind === "operator")
    .length;
}

export function checkOperatorCap(
  graph: Graph,
  cap = FREE_OPERATOR_CAP,
): CapCheck {
  const actual = operatorNodeCount(graph);
  return {
    ok: Number.isFinite(actual) && actual <= cap,
    unit: "steps",
    cap,
    actual,
  };
}

export function paramIssues(
  opId: string,
  params?: Record<string, unknown>,
): string[] {
  const value = params ?? {};
  const issues: string[] = [];
  for (const field of REQUIRED_FIELDS[opId] ?? []) {
    if (!filled(value[field])) issues.push(`缺 ${field}`);
  }
  if (opId === "spatial.moransI" && given(value.kNeighbors) && !wholeNumber(value.kNeighbors, 1)) {
    issues.push("kNeighbors 需要是大于等于 1 的整数");
  }
  if (opId === "spatial.h3Bin" && given(value.cellSideKm) && !positive(value.cellSideKm)) {
    issues.push("cellSideKm 需要是大于 0 的数");
  }
  if (opId === "spatial.smooth" && given(value.iterations) && !wholeNumber(value.iterations, 1)) {
    issues.push("iterations 需要是大于等于 1 的整数");
  }
  if (opId === "spatial.concaveHull" && given(value.concavity) && !atLeast(value.concavity, 1)) {
    issues.push("concavity 需要是大于等于 1 的数");
  }
  if (
    (opId === "spatial.spatialJoin" || opId === "spatial.selectByLocation") &&
    given(value.predicate) &&
    (typeof value.predicate !== "string" || !PREDICATES.has(value.predicate))
  ) {
    issues.push("predicate 只认 intersects、within、contains");
  }
  if (opId === "spatial.buffer" && given(value.distanceKm) && !atLeast(value.distanceKm, 0)) {
    issues.push("distanceKm 需要是大于等于 0 的数");
  }
  if (opId === "spatial.simplify" && given(value.tolerance) && !atLeast(value.tolerance, 0)) {
    issues.push("tolerance 需要是大于等于 0 的数");
  }
  if (opId === "spatial.reproject") {
    if (given(value.fromCrs) && !epsg(value.fromCrs)) issues.push("fromCrs 只认 EPSG 编号");
    if (given(value.toCrs) && !epsg(value.toCrs)) issues.push("toCrs 只认 EPSG 编号");
  }
  if (opId === "spatial.dissolve" && given(value.property) && typeof value.property !== "string") {
    issues.push("property 需要是文字");
  }
  if (opId === "spatial.filter") {
    if (given(value.property) && typeof value.property !== "string") issues.push("property 需要是文字");
    if (given(value.value) && typeof value.value !== "string") issues.push("value 需要是文字");
  }
  return issues;
}

export function resolvedParams(
  opId: string,
  params?: Record<string, unknown>,
): Record<string, unknown> {
  const input = { ...(params ?? {}) };
  const defaults = DEFAULTS[opId] ?? {};
  const resolved: Record<string, unknown> = { ...defaults, ...input };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (!given(resolved[key])) resolved[key] = fallback;
  }
  return resolved;
}

export function createGraph(name?: string): Graph {
  const now = new Date().toISOString();
  const graph: Graph = {
    version: 1,
    nodes: {},
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
  if (name) graph.name = name;
  return graph;
}

export function addSource(
  graph: Graph,
  input: { id: string; fileId: string; label: string; x?: number; y?: number },
): Graph {
  const node: SourceNode = {
    id: input.id,
    kind: "source",
    position: { x: input.x ?? 0, y: input.y ?? PRIMARY_Y },
    source: { fileId: input.fileId, label: input.label },
  };
  return touch(graph, { ...graph.nodes, [node.id]: node }, graph.edges);
}

export function addOperator(
  graph: Graph,
  input: {
    id: string;
    opId: string;
    params?: Record<string, unknown>;
    x?: number;
    y?: number;
  },
): Graph {
  const node: OperatorNode = {
    id: input.id,
    kind: "operator",
    position: { x: input.x ?? 0, y: input.y ?? PRIMARY_Y },
    operator: { opId: input.opId, params: { ...(input.params ?? {}) } },
  };
  return touch(graph, { ...graph.nodes, [node.id]: node }, graph.edges);
}

export function connect(
  graph: Graph,
  from: string,
  to: string,
  inputIndex: 0 | 1,
): Graph {
  const edge: GraphEdge = {
    id: `e_${graph.edges.length}_${from}_${to}_${inputIndex}`,
    from,
    to,
    inputIndex,
  };
  return touch(graph, graph.nodes, [...graph.edges, edge]);
}

export function parseRecipe(input: unknown): LegacyRecipe {
  if (!input || typeof input !== "object") throw new Error("作业格式不对");
  const raw = input as Record<string, unknown>;
  if (raw.version !== 1 && raw.version !== 2) throw new Error("不认识的作业版本");
  if (!raw.name || typeof raw.name !== "string") throw new Error("作业要有名字");
  if (!Array.isArray(raw.steps)) throw new Error("步骤得是数组");

  const files: { id: string; name: string }[] = [];
  const fileIds = new Set<string>();
  if (Array.isArray(raw.files)) {
    for (const file of raw.files) {
      if (!file || typeof file !== "object") throw new Error("图的记录不对");
      const entry = file as Record<string, unknown>;
      if (typeof entry.id !== "string" || typeof entry.name !== "string") {
        throw new Error("图的记录不对");
      }
      if (fileIds.has(entry.id)) throw new Error(`图的编号重复了：${entry.id}`);
      fileIds.add(entry.id);
      files.push({ id: entry.id, name: entry.name });
    }
  }

  const steps: LegacyStep[] = raw.steps.map((step, index) => {
    if (!step || typeof step !== "object") throw new Error("步骤不对");
    const entry = step as Record<string, unknown>;
    if (typeof entry.operator !== "string" || !isWorkflowOperator(entry.operator)) {
      throw new Error(`这个算子不能放进作业：${String(entry.operator)}`);
    }
    const params =
      entry.params && typeof entry.params === "object" && !Array.isArray(entry.params)
        ? { ...(entry.params as Record<string, unknown>) }
        : {};
    const issues = paramIssues(entry.operator, params);
    if (issues.length > 0 && checkedOnRead(entry.operator)) throw new Error(issues[0]);
    if (takesSecondInput(entry.operator)) {
      if (typeof entry.inputBFileId !== "string" || entry.inputBFileId === "") {
        throw new Error(`这一步要用第二张图：${entry.operator}`);
      }
      if (!fileIds.has(entry.inputBFileId)) {
        throw new Error(`找不到第二张图：${entry.inputBFileId}`);
      }
    } else if (entry.inputBFileId !== undefined && entry.inputBFileId !== null) {
      throw new Error(`这一步不用第二张图：${entry.operator}`);
    }
    const id = typeof entry.id === "string" && entry.id !== "" ? entry.id : `step_${index}`;
    return {
      id,
      operator: entry.operator,
      params,
      ...(typeof entry.inputBFileId === "string" ? { inputBFileId: entry.inputBFileId } : {}),
    };
  });

  const now = new Date().toISOString();
  return {
    version: 2,
    name: raw.name,
    steps,
    files,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
  };
}

export function recipeToGraph(recipe: LegacyRecipe): Graph {
  const graph = createGraph(recipe.name);
  graph.createdAt = recipe.createdAt;
  const nodes: Record<string, GraphNode> = {
    src_template: {
      id: "src_template",
      kind: "source",
      source: { fileId: "input", label: "input.geojson" },
      position: { x: 0, y: PRIMARY_Y },
    },
  };
  const edges: GraphEdge[] = [];
  let previous = "src_template";
  recipe.steps.forEach((step, index) => {
    const id = `op_${index}_${step.id}`;
    nodes[id] = {
      id,
      kind: "operator",
      operator: { opId: step.operator, params: { ...step.params } },
      position: { x: (index + 1) * COLUMN_X, y: PRIMARY_Y },
    };
    edges.push({ id: `e_${index}`, from: previous, to: id, inputIndex: 0 });
    if (takesSecondInput(step.operator) && step.inputBFileId) {
      const sourceId = `bsrc_${index}_${step.inputBFileId}`;
      const file = recipe.files.find((item) => item.id === step.inputBFileId);
      nodes[sourceId] = {
        id: sourceId,
        kind: "source",
        source: {
          fileId: step.inputBFileId,
          label: file?.name ?? "second-layer.geojson",
        },
        position: { x: (index + 1) * COLUMN_X, y: SECOND_Y },
      };
      edges.push({
        id: `e_${index}_b`,
        from: sourceId,
        to: id,
        inputIndex: 1,
      });
    }
    previous = id;
  });
  graph.nodes = nodes;
  graph.edges = edges;
  graph.updatedAt = new Date().toISOString();
  return graph;
}

export function toRecipe(graph: Graph): Recipe | null {
  const operators = Object.values(graph.nodes).filter(isOperator);
  if (operators.length === 0) {
    return { name: graph.name ?? "未命名", files: [], steps: [] };
  }
  for (const operator of operators) {
    const primary = incoming(graph, operator.id, 0);
    const secondary = incoming(graph, operator.id, 1);
    if (primary.length !== 1) return null;
    if (takesSecondInput(operator.operator.opId)) {
      if (secondary.length !== 1) return null;
      const source = graph.nodes[secondary[0].from];
      if (!source || source.kind !== "source") return null;
    } else if (secondary.length !== 0) {
      return null;
    }
    if (operatorSuccessors(graph, operator.id).length > 1) return null;
  }
  const heads = operators.filter((operator) => {
    const edge = incoming(graph, operator.id, 0)[0];
    return graph.nodes[edge.from]?.kind === "source";
  });
  if (heads.length !== 1) return null;

  const steps: RecipeStep[] = [];
  const files: { id: string; name: string }[] = [];
  const seenFiles = new Set<string>();
  const seenOps = new Set<string>();
  let current: OperatorNode | undefined = heads[0];
  while (current) {
    if (seenOps.has(current.id)) return null;
    seenOps.add(current.id);
    const secondary = incoming(graph, current.id, 1)[0];
    let inputBFileId: string | undefined;
    if (secondary) {
      const source = graph.nodes[secondary.from];
      if (!source || source.kind !== "source") return null;
      inputBFileId = source.source.fileId;
      if (!seenFiles.has(inputBFileId)) {
        seenFiles.add(inputBFileId);
        files.push({ id: inputBFileId, name: source.source.label });
      }
    }
    steps.push({
      operator: current.operator.opId,
      params: { ...current.operator.params },
      ...(inputBFileId ? { inputBFileId } : {}),
    });
    const next = operatorSuccessors(graph, current.id);
    current = next[0];
  }
  if (seenOps.size !== operators.length) return null;
  return { name: graph.name ?? "未命名", files, steps };
}

export function openJob(graph: Graph, from: Screen): OpenedJob {
  const path = toRecipe(graph);
  if (from === "list" && path === null) {
    return { screen: "canvas", graph, path: null };
  }
  return { screen: from, graph, path };
}

export function readJob(input: string): Graph | null {
  const text = input.trim();
  if (text.startsWith("{")) return fromJsonText(text);
  const payload = extractWf(text);
  if (payload === null) return null;
  try {
    return fromDecodedJson(JSON.parse(decodeBase64Url(payload)));
  } catch {
    return null;
  }
}

export function exportJob(graph: Graph, exportedAt = new Date().toISOString()): string {
  return JSON.stringify({
    $format: GRAPH_FORMAT,
    $version: GRAPH_VERSION,
    graph: toDocument(graph),
    exportedAt,
  });
}

export function shareJob(graph: Graph): Share {
  const hash = encodeGraphHash(graph);
  if (operatorNodeCount(graph) > HASH_OPERATOR_CAP || hash.length > HASH_MAX_LENGTH) {
    return {
      kind: "file",
      filename: "workflow.gistool-dag.json",
      body: exportJob(graph),
    };
  }
  return { kind: "link", hash };
}

export function toRuntime(graph: Graph): RuntimeGraph {
  return stampParamErrors({
    version: 1,
    name: graph.name,
    nodes: graph.nodes,
    edges: graph.edges,
    createdAt: graph.createdAt,
    updatedAt: graph.updatedAt,
    results: {},
    dirty: new Set(),
    errors: {},
    running: new Set(),
  });
}

export function setSourceResult(
  graph: RuntimeGraph,
  nodeId: string,
  result: unknown,
): RuntimeGraph {
  const dirty = new Set(graph.dirty);
  dirty.delete(nodeId);
  for (const id of descendants(nodeId, graph.edges)) dirty.add(id);
  const errors = { ...graph.errors };
  delete errors[nodeId];
  return stampParamErrors({
    ...graph,
    results: { ...graph.results, [nodeId]: result },
    dirty,
    errors,
    updatedAt: new Date().toISOString(),
  });
}

export function setOperatorParams(
  graph: RuntimeGraph,
  nodeId: string,
  params: Record<string, unknown>,
): RuntimeGraph {
  const node = graph.nodes[nodeId];
  if (!node || node.kind !== "operator") return graph;
  const dirty = new Set(graph.dirty);
  dirty.add(nodeId);
  for (const id of descendants(nodeId, graph.edges)) dirty.add(id);
  const errors = { ...graph.errors };
  delete errors[nodeId];
  return stampParamErrors({
    ...graph,
    nodes: {
      ...graph.nodes,
      [nodeId]: {
        ...node,
        operator: { ...node.operator, params: { ...params } },
      },
    },
    dirty,
    errors,
    updatedAt: new Date().toISOString(),
  });
}

export function nodeStatus(graph: RuntimeGraph, id: string): NodeStatus {
  const node = graph.nodes[id];
  if (!node) return "idle";
  if (node.kind === "operator" && paramIssues(node.operator.opId, node.operator.params).length > 0) {
    return "error";
  }
  if (graph.errors[id]) return "error";
  if (graph.running.has(id)) return "running";
  if (upstreamHasError(graph, id)) return "blocked";
  if (node.kind === "source") {
    return graph.results[id] !== undefined && !graph.dirty.has(id) ? "done" : "idle";
  }
  const indexes: Array<0 | 1> = takesSecondInput(node.operator.opId) ? [0, 1] : [0];
  const feeds = indexes.map((index) => graph.edges.find((edge) => edge.to === id && edge.inputIndex === index));
  if (feeds.some((edge) => !edge)) return "idle";
  const inputsDone = feeds.every(
    (edge) => edge && graph.results[edge.from] !== undefined && !graph.dirty.has(edge.from),
  );
  if (graph.dirty.has(id)) return inputsDone ? "ready" : "idle";
  if (graph.results[id] !== undefined) return "done";
  return inputsDone ? "ready" : "idle";
}

export function readyNodeIds(graph: RuntimeGraph): string[] {
  const order = topo(graph);
  const ids = order.length > 0 ? order : Object.keys(graph.nodes);
  return ids.filter((id) => graph.dirty.has(id) && nodeStatus(graph, id) === "ready");
}

export function toDocument(graph: Graph): Graph {
  const doc: Graph = {
    version: 1,
    nodes: graph.nodes,
    edges: graph.edges,
    createdAt: graph.createdAt,
    updatedAt: graph.updatedAt,
  };
  if (graph.name) doc.name = graph.name;
  return doc;
}

function stampParamErrors(graph: RuntimeGraph): RuntimeGraph {
  const errors = { ...graph.errors };
  for (const node of Object.values(graph.nodes)) {
    if (node.kind !== "operator") continue;
    const issues = paramIssues(node.operator.opId, node.operator.params);
    if (issues.length > 0) errors[node.id] = issues.join("；");
    else if (errors[node.id] && isParamIssueMessage(errors[node.id])) delete errors[node.id];
  }
  return { ...graph, errors };
}

function isParamIssueMessage(message: string): boolean {
  return message.split("；").every(
    (part) => part.startsWith("缺 ") || part.includes("需要") || part.includes("只认"),
  );
}

function checkedOnRead(opId: string): boolean {
  return (
    opId === "spatial.buffer" ||
    opId === "spatial.simplify" ||
    opId === "spatial.dissolve" ||
    opId === "spatial.filter" ||
    opId === "spatial.reproject" ||
    opId === "spatial.concaveHull"
  );
}

function fromJsonText(text: string): Graph | null {
  try {
    return fromDecodedJson(JSON.parse(text));
  } catch {
    return null;
  }
}

function fromDecodedJson(data: unknown): Graph | null {
  if (data && typeof data === "object" && "$format" in data) {
    const file = data as { $format?: unknown; graph?: unknown };
    if (file.$format !== GRAPH_FORMAT) return null;
    return parseGraph(file.graph);
  }
  const graph = parseGraph(data);
  if (graph) return graph;
  try {
    return recipeToGraph(parseRecipe(data));
  } catch {
    return null;
  }
}

function parseGraph(data: unknown): Graph | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = data as Record<string, unknown>;
  if (raw.version !== 1 || !raw.nodes || typeof raw.nodes !== "object" || Array.isArray(raw.nodes)) {
    return null;
  }
  if (!Array.isArray(raw.edges)) return null;
  const nodes: Record<string, GraphNode> = {};
  for (const key of Object.keys(raw.nodes as Record<string, unknown>)) {
    const node = (raw.nodes as Record<string, unknown>)[key];
    const parsed = parseNode(key, node);
    if (!parsed) return null;
    nodes[key] = parsed;
  }
  const edges: GraphEdge[] = [];
  for (const edge of raw.edges) {
    if (!edge || typeof edge !== "object") return null;
    const entry = edge as Record<string, unknown>;
    if (typeof entry.id !== "string" || typeof entry.from !== "string" || typeof entry.to !== "string") {
      return null;
    }
    if (entry.inputIndex !== 0 && entry.inputIndex !== 1) return null;
    if (!nodes[entry.from] || !nodes[entry.to]) return null;
    edges.push({
      id: entry.id,
      from: entry.from,
      to: entry.to,
      inputIndex: entry.inputIndex,
    });
  }
  const now = new Date().toISOString();
  const graph: Graph = {
    version: 1,
    nodes,
    edges,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
  };
  if (typeof raw.name === "string" && raw.name !== "") graph.name = raw.name;
  return graph;
}

function parseNode(key: string, node: unknown): GraphNode | null {
  if (!node || typeof node !== "object") return null;
  const raw = node as Record<string, unknown>;
  if (typeof raw.id === "string" && raw.id !== key) return null;
  const position = raw.position as { x?: unknown; y?: unknown } | undefined;
  if (!position || typeof position.x !== "number") return null;
  const y = typeof position.y === "number" ? position.y : 0;
  if (raw.kind === "source") {
    const source = raw.source as { fileId?: unknown; label?: unknown } | undefined;
    if (!source || typeof source.fileId !== "string") return null;
    return {
      id: key,
      kind: "source",
      position: { x: position.x, y },
      source: {
        fileId: source.fileId,
        label: typeof source.label === "string" ? source.label : "",
      },
    };
  }
  if (raw.kind === "operator") {
    const operator = raw.operator as { opId?: unknown; params?: unknown } | undefined;
    if (!operator || typeof operator.opId !== "string" || !isWorkflowOperator(operator.opId)) {
      return null;
    }
    const params =
      operator.params && typeof operator.params === "object" && !Array.isArray(operator.params)
        ? { ...(operator.params as Record<string, unknown>) }
        : {};
    return {
      id: key,
      kind: "operator",
      position: { x: position.x, y },
      operator: { opId: operator.opId, params },
    };
  }
  return null;
}

function encodeGraphHash(graph: Graph): string {
  return `#wf=${encodeBase64Url(JSON.stringify(toDocument(graph)))}`;
}

function extractWf(input: string): string | null {
  const hashAt = input.indexOf("#");
  const hash = hashAt >= 0 ? input.slice(hashAt + 1) : input;
  const match = /(?:^|&)wf=([^&]*)/.exec(hash);
  return match ? match[1] : null;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): string {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function touch(graph: Graph, nodes: Graph["nodes"], edges: GraphEdge[]): Graph {
  return {
    ...graph,
    nodes,
    edges,
    updatedAt: new Date().toISOString(),
  };
}

function incoming(graph: Graph, id: string, inputIndex: 0 | 1): GraphEdge[] {
  return graph.edges.filter((edge) => edge.to === id && edge.inputIndex === inputIndex);
}

function operatorSuccessors(graph: Graph, id: string): OperatorNode[] {
  const next: OperatorNode[] = [];
  for (const edge of graph.edges) {
    if (edge.from !== id || edge.inputIndex !== 0) continue;
    const node = graph.nodes[edge.to];
    if (node && node.kind === "operator") next.push(node);
  }
  return next;
}

function isOperator(node: GraphNode): node is OperatorNode {
  return node.kind === "operator";
}

export function descendants(nodeId: string, edges: GraphEdge[]): string[] {
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const list = next.get(edge.from) ?? [];
    list.push(edge.to);
    next.set(edge.from, list);
  }
  const seen = new Set<string>();
  const stack = [...(next.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    for (const child of next.get(id) ?? []) stack.push(child);
  }
  return [...seen];
}

function upstreamHasError(graph: RuntimeGraph, id: string, seen = new Set<string>()): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  for (const edge of graph.edges) {
    if (edge.to !== id) continue;
    const from = graph.nodes[edge.from];
    if (!from) continue;
    if (graph.errors[edge.from]) return true;
    if (from.kind === "operator" && paramIssues(from.operator.opId, from.operator.params).length > 0) {
      return true;
    }
    if (upstreamHasError(graph, edge.from, seen)) return true;
  }
  return false;
}

function topo(graph: Graph): string[] {
  const ids = Object.keys(graph.nodes);
  const indegree = new Map<string, number>();
  const next = new Map<string, string[]>();
  for (const id of ids) {
    indegree.set(id, 0);
    next.set(id, []);
  }
  for (const edge of graph.edges) {
    next.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    order.push(id);
    for (const child of next.get(id) ?? []) {
      const left = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, left);
      if (left === 0) queue.push(child);
    }
  }
  return order.length === ids.length ? order : [];
}

function filled(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== "";
  return value !== undefined && value !== null;
}

function given(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function positive(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function atLeast(value: unknown, min: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= min;
}

function wholeNumber(value: unknown, min: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}

function epsg(value: unknown): boolean {
  return typeof value === "string" && EPSG.test(value);
}
