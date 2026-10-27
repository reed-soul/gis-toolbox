import { isMainThread, parentPort, threadId } from "node:worker_threads";

type Job = {
  nodeId: string;
  opId: string;
  params: Record<string, unknown>;
  inputs: { nodeId: string; inputIndex: 0 | 1; result: unknown }[];
};

// 算子在这条线程上跑，页面那条线程还能接着点。
if (parentPort) {
  parentPort.on("message", (job: Job) => {
    const startedAt = Date.now();
    const waitMs = typeof job.params.workMs === "number" ? job.params.workMs : 0;
    if (waitMs > 0) {
      const end = startedAt + waitMs;
      while (Date.now() < end) {
        // 占住这条线程，用来证明活不在页面那条线程上。
      }
    }
    const features = job.inputs.flatMap((input) => featuresOf(input.result));
    parentPort?.postMessage({
      ok: true,
      output: {
        result: {
          type: "FeatureCollection",
          features,
          opId: job.opId,
          applied: job.params,
        },
        startedAt,
        finishedAt: Date.now(),
        threadId,
        inWorker: !isMainThread,
      },
    });
  });
}

function featuresOf(result: unknown): unknown[] {
  if (!result || typeof result !== "object" || !("features" in result)) return [];
  const features = (result as { features?: unknown }).features;
  return Array.isArray(features) ? features : [];
}
