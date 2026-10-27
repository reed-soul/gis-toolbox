import { Worker } from "node:worker_threads";
import {
  paramIssues,
  readyNodeIds,
  resolvedParams,
  takesSecondInput,
  type RuntimeGraph,
} from "./document.ts";

export type NodeJob = {
  nodeId: string;
  opId: string;
  params: Record<string, unknown>;
  inputs: { nodeId: string; inputIndex: 0 | 1; result: unknown }[];
};

export type NodeOutput = {
  result: unknown;
  startedAt: number;
  finishedAt: number;
  threadId: number;
  inWorker: boolean;
};

export type StepEvent =
  | { phase: "start"; nodeId: string; opId: string; at: number }
  | {
      phase: "done";
      nodeId: string;
      opId: string;
      startedAt: number;
      finishedAt: number;
      threadId: number;
      inWorker: boolean;
    }
  | { phase: "error"; nodeId: string; opId: string; message: string };

export type RunOptions = {
  execute?: (job: NodeJob) => Promise<NodeOutput>;
  onUpdate?: (graph: RuntimeGraph) => void;
  onStep?: (event: StepEvent) => void;
};

// 谁也不用等谁的算子一起跑。没有开关可以改回一个一个跑。
export async function runJob(graph: RuntimeGraph, options: RunOptions = {}): Promise<RuntimeGraph> {
  const execute = options.execute ?? executeInWorker;
  let current = graph;
  const limit = Object.keys(graph.nodes).length + 1;
  for (let wave = 0; wave < limit; wave += 1) {
    const ready = readyNodeIds(current);
    if (ready.length === 0) return current;
    const jobs: NodeJob[] = [];
    for (const id of ready) {
      const node = current.nodes[id];
      if (!node || node.kind !== "operator") continue;
      const issues = paramIssues(node.operator.opId, node.operator.params);
      if (issues.length > 0) {
        current = failNode(current, id, issues.join("；"));
        options.onUpdate?.(current);
        continue;
      }
      jobs.push(buildJob(current, id));
    }
    if (jobs.length === 0) continue;
    current = markRunning(current, jobs.map((job) => job.nodeId));
    options.onUpdate?.(current);
    for (const job of jobs) {
      options.onStep?.({ phase: "start", nodeId: job.nodeId, opId: job.opId, at: Date.now() });
    }
    const settled = await Promise.all(
      jobs.map(async (job) => {
        try {
          const output = await execute(job);
          return { job, output };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { job, message };
        }
      }),
    );
    for (const item of settled) {
      if ("output" in item && item.output) {
        options.onStep?.({
          phase: "done",
          nodeId: item.job.nodeId,
          opId: item.job.opId,
          startedAt: item.output.startedAt,
          finishedAt: item.output.finishedAt,
          threadId: item.output.threadId,
          inWorker: item.output.inWorker,
        });
        current = finishNode(current, item.job.nodeId, item.output.result);
      } else if ("message" in item) {
        options.onStep?.({
          phase: "error",
          nodeId: item.job.nodeId,
          opId: item.job.opId,
          message: item.message,
        });
        current = failNode(current, item.job.nodeId, item.message);
      }
    }
    options.onUpdate?.(current);
  }
  throw new Error("作业没有往下走");
}

export function executeInWorker(job: NodeJob): Promise<NodeOutput> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./operator-worker.ts", import.meta.url), {
      execArgv: ["--experimental-strip-types"],
    });
    let done = false;
    const close = () => {
      void worker.terminate();
    };
    worker.once("message", (message: { ok?: boolean; output?: NodeOutput; error?: string }) => {
      if (done) return;
      done = true;
      close();
      if (message?.ok && message.output) resolve(message.output);
      else reject(new Error(message?.error ?? "算子没有结果"));
    });
    worker.once("error", (error) => {
      if (done) return;
      done = true;
      close();
      reject(error);
    });
    worker.once("exit", (code) => {
      if (done) return;
      done = true;
      reject(new Error(`算子线程退出了（${code}）`));
    });
    worker.postMessage(job);
  });
}

function buildJob(graph: RuntimeGraph, id: string): NodeJob {
  const node = graph.nodes[id];
  if (!node || node.kind !== "operator") throw new Error(`不是算子：${id}`);
  const indexes: Array<0 | 1> = takesSecondInput(node.operator.opId) ? [0, 1] : [0];
  const inputs = indexes.map((inputIndex) => {
    const edge = graph.edges.find((item) => item.to === id && item.inputIndex === inputIndex);
    if (!edge) throw new Error(`没有接上：${id}`);
    return { nodeId: edge.from, inputIndex, result: graph.results[edge.from] };
  });
  return {
    nodeId: id,
    opId: node.operator.opId,
    params: resolvedParams(node.operator.opId, node.operator.params),
    inputs,
  };
}

function markRunning(graph: RuntimeGraph, ids: string[]): RuntimeGraph {
  const running = new Set(graph.running);
  for (const id of ids) running.add(id);
  return { ...graph, running };
}

function finishNode(graph: RuntimeGraph, id: string, result: unknown): RuntimeGraph {
  const dirty = new Set(graph.dirty);
  dirty.delete(id);
  const running = new Set(graph.running);
  running.delete(id);
  const errors = { ...graph.errors };
  delete errors[id];
  return {
    ...graph,
    results: { ...graph.results, [id]: result },
    dirty,
    running,
    errors,
    updatedAt: new Date().toISOString(),
  };
}

function failNode(graph: RuntimeGraph, id: string, message: string): RuntimeGraph {
  const dirty = new Set(graph.dirty);
  dirty.delete(id);
  const running = new Set(graph.running);
  running.delete(id);
  return {
    ...graph,
    dirty,
    running,
    errors: { ...graph.errors, [id]: message },
    updatedAt: new Date().toISOString(),
  };
}
