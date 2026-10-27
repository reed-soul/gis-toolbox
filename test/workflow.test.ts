import assert from "node:assert/strict";
import test from "node:test";
import { threadId } from "node:worker_threads";
import {
  addOperator,
  addSource,
  checkOperatorCap,
  connect,
  createGraph,
  exportJob,
  isWorkflowOperator,
  nodeStatus,
  openJob,
  paramIssues,
  parseRecipe,
  readJob,
  recipeToGraph,
  resolvedParams,
  runJob,
  setOperatorParams,
  setSourceResult,
  shareJob,
  toRuntime,
  type Graph,
  type StepEvent,
} from "../src/workflow/index.ts";

const LEGACY_V2 =
  "#wf=eyJ2ZXJzaW9uIjoyLCJuYW1lIjoi57yT5YayIiwic3RlcHMiOlt7ImlkIjoic3RlcF9idWZmZXIiLCJvcGVyYXRvciI6InNwYXRpYWwuYnVmZmVyIiwicGFyYW1zIjp7ImRpc3RhbmNlS20iOjF9fV0sImZpbGVzIjpbXSwiY3JlYXRlZEF0IjoiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaIiwidXBkYXRlZEF0IjoiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaIn0";

const LEGACY_V1 =
  "#wf=eyJ2ZXJzaW9uIjoxLCJuYW1lIjoi566A5YyWIiwic3RlcHMiOlt7ImlkIjoic3RlcF9zaW1wbGlmeSIsIm9wZXJhdG9yIjoic3BhdGlhbC5zaW1wbGlmeSIsInBhcmFtcyI6eyJ0b2xlcmFuY2UiOjAuMDF9fV0sImNyZWF0ZWRBdCI6IjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWiIsInVwZGF0ZWRBdCI6IjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWiJ9";

const WHEN = "2026-01-01T00:00:00.000Z";

test("旧的步骤列表链接打开后，列表和画布是同一条路径", () => {
  const fromV2 = readJob(`https://gis.taoliapp.com/zh/tools/workflow${LEGACY_V2}`);
  const fromV1 = readJob(LEGACY_V1);
  assert.ok(fromV2);
  assert.ok(fromV1);

  assert.equal(fromV2.nodes.src_template?.kind, "source");
  assert.equal(fromV2.nodes.op_0_step_buffer?.kind, "operator");
  assert.deepEqual(
    fromV2.edges.find((edge) => edge.id === "e_0"),
    { id: "e_0", from: "src_template", to: "op_0_step_buffer", inputIndex: 0 },
  );

  const list = openJob(fromV2, "list");
  const canvas = openJob(fromV2, "canvas");
  assert.equal(list.screen, "list");
  assert.equal(canvas.screen, "canvas");
  assert.deepEqual(list.path, canvas.path);
  assert.deepEqual(list.path?.steps, [
    { operator: "spatial.buffer", params: { distanceKm: 1 } },
  ]);
  assert.equal(list.path?.name, "缓冲");

  const oldList = openJob(fromV1, "list");
  const oldCanvas = openJob(fromV1, "canvas");
  assert.deepEqual(oldList.path, oldCanvas.path);
  assert.deepEqual(oldCanvas.path?.steps, [
    { operator: "spatial.simplify", params: { tolerance: 0.01 } },
  ]);
  assert.equal(oldList.path?.name, "简化");
  assert.equal(fromV1.nodes.op_0_step_simplify?.kind, "operator");
});

test("分叉的作业从步骤列表打开，叉还在，并改去画布", () => {
  const graph = branchedJob();
  const before = nodeIds(graph);
  const opened = openJob(graph, "list");
  assert.equal(opened.screen, "canvas");
  assert.equal(opened.path, null);
  assert.deepEqual(nodeIds(opened.graph), before);
  assert.ok(opened.graph.edges.some((edge) => edge.to === "simplify" && edge.from === "srcB"));
  assert.ok(opened.graph.edges.some((edge) => edge.to === "intersect" && edge.from === "buffer"));
  assert.equal(openJob(graph, "canvas").screen, "canvas");
});

test("没有分叉、用了第二张图的作业，列表和画布还是同一条路径", () => {
  const recipe = parseRecipe({
    version: 2,
    name: "缓冲再相交",
    createdAt: WHEN,
    updatedAt: WHEN,
    files: [{ id: "file_b", name: "另一张.geojson" }],
    steps: [
      { id: "step_buffer", operator: "spatial.buffer", params: { distanceKm: 0.5 } },
      {
        id: "step_intersect",
        operator: "spatial.intersect",
        params: {},
        inputBFileId: "file_b",
      },
    ],
  });
  const graph = recipeToGraph(recipe);
  const list = openJob(graph, "list");
  const canvas = openJob(graph, "canvas");
  assert.deepEqual(list.path, canvas.path);
  assert.deepEqual(list.path?.steps, [
    { operator: "spatial.buffer", params: { distanceKm: 0.5 } },
    { operator: "spatial.intersect", params: {}, inputBFileId: "file_b" },
  ]);
  assert.deepEqual(list.path?.files, [{ id: "file_b", name: "另一张.geojson" }]);
  const second = graph.nodes.bsrc_1_file_b;
  assert.ok(second && second.kind === "source");
  assert.deepEqual(second.position, { x: 440, y: 260 });
  assert.equal(graph.edges.find((edge) => edge.id === "e_1_b")?.inputIndex, 1);
});

test("导出去的只有图，不再写步骤列表那份文件", () => {
  const graph = readJob(LEGACY_V2);
  assert.ok(graph);
  const parsed = JSON.parse(exportJob(graph, WHEN)) as {
    $format?: string;
    $version?: number;
    steps?: unknown;
    version?: unknown;
    graph?: { version?: number; nodes?: unknown; results?: unknown };
  };
  assert.equal(parsed.$format, "gistool.dag");
  assert.equal(parsed.$version, 1);
  assert.equal(parsed.version, undefined);
  assert.equal(parsed.steps, undefined);
  assert.equal(parsed.graph?.version, 1);
  assert.equal(parsed.graph?.results, undefined);
  const again = readJob(exportJob(graph, WHEN));
  assert.deepEqual(openJob(again!, "list").path, openJob(graph, "canvas").path);
});

test("缓冲之后和另一张图相交，链接换一场会话还能跑出结果", async () => {
  const recipe = parseRecipe({
    version: 2,
    name: "缓冲再相交",
    createdAt: WHEN,
    updatedAt: WHEN,
    files: [{ id: "file_b", name: "另一张.geojson" }],
    steps: [
      { id: "step_buffer", operator: "spatial.buffer", params: { distanceKm: 0.5 } },
      {
        id: "step_intersect",
        operator: "spatial.intersect",
        params: {},
        inputBFileId: "file_b",
      },
    ],
  });
  const shared = shareJob(recipeToGraph(recipe));
  assert.equal(shared.kind, "link");
  if (shared.kind !== "link") return;
  assert.ok(shared.hash.startsWith("#wf="));

  const fresh = readJob(`https://gis.taoliapp.com/en/tools/workflow-dag${shared.hash}`);
  assert.ok(fresh);
  assert.equal("results" in fresh, false);
  assert.equal(openJob(fresh, "list").path?.steps[1]?.inputBFileId, "file_b");

  let session = toRuntime(fresh);
  session = setSourceResult(session, "src_template", layer("a"));
  session = setSourceResult(session, "bsrc_1_file_b", layer("b"));
  const done = await runJob(session);
  const buffer = done.results.op_0_step_buffer as Layer & { applied: { distanceKm: number } };
  const intersect = done.results.op_1_step_intersect as Layer;
  assert.equal(buffer.type, "FeatureCollection");
  assert.equal(buffer.applied.distanceKm, 0.5);
  assert.equal(buffer.features.length, 1);
  assert.equal(intersect.type, "FeatureCollection");
  assert.equal(intersect.opId, "spatial.intersect");
  assert.deepEqual(
    intersect.features.map((feature) => feature.properties.id).sort(),
    ["a", "b"],
  );
});

test("链接太长时改下载图文件，第二张图本身不再拦分享", () => {
  let eight = createGraph("八步");
  eight = addSource(eight, { id: "src", fileId: "input", label: "input.geojson" });
  let previous = "src";
  for (let index = 0; index < 8; index += 1) {
    const id = `op_${index}`;
    eight = addOperator(eight, { id, opId: "spatial.simplify", params: { tolerance: 0.01 } });
    eight = connect(eight, previous, id, 0);
    previous = id;
  }
  assert.equal(shareJob(eight).kind, "link");

  const nine = addOperator(eight, { id: "op_8", opId: "spatial.simplify", params: { tolerance: 0.01 } });
  const tooMany = shareJob(connect(nine, "op_7", "op_8", 0));
  assert.equal(tooMany.kind, "file");
  if (tooMany.kind !== "file") return;
  assert.equal(tooMany.filename, "workflow.gistool-dag.json");
  const tooManyBody = JSON.parse(tooMany.body) as { $format: string; $version: number };
  assert.equal(tooManyBody.$format, "gistool.dag");
  assert.equal(tooManyBody.$version, 1);

  let bulky = createGraph("太长");
  bulky = addSource(bulky, { id: "src", fileId: "input", label: "input.geojson" });
  bulky = addOperator(bulky, {
    id: "op",
    opId: "spatial.buffer",
    params: { distanceKm: 1, note: "a".repeat(9000) },
  });
  bulky = connect(bulky, "src", "op", 0);
  const tooLong = shareJob(bulky);
  assert.equal(tooLong.kind, "file");
  if (tooLong.kind !== "file") return;
  const roundTrip = readJob(tooLong.body);
  assert.equal(roundTrip?.nodes.op && roundTrip.nodes.op.kind === "operator" && roundTrip.nodes.op.operator.opId, "spatial.buffer");
});

test("缺的字段在运行前就标在节点上，点运行也不会抛出去", async () => {
  assert.deepEqual(paramIssues("data.fieldCalc", {}), ["缺 targetField", "缺 expression"]);
  assert.deepEqual(paramIssues("data.attributeJoin", { leftKey: "id" }), ["缺 rightKey"]);
  assert.deepEqual(paramIssues("spatial.moransI", {}), ["缺 valueField"]);
  assert.deepEqual(paramIssues("spatial.moransI", { valueField: "pop" }), []);

  let fieldCalc = createGraph("算字段");
  fieldCalc = addSource(fieldCalc, { id: "src", fileId: "input", label: "input.geojson" });
  fieldCalc = addOperator(fieldCalc, { id: "calc", opId: "data.fieldCalc", params: {} });
  fieldCalc = connect(fieldCalc, "src", "calc", 0);
  let session = setSourceResult(toRuntime(fieldCalc), "src", layer("a"));
  assert.equal(session.errors.calc, "缺 targetField；缺 expression");
  assert.equal(nodeStatus(session, "calc"), "error");
  const skipped = await runJob(session);
  assert.equal(skipped.errors.calc, "缺 targetField；缺 expression");
  assert.equal(skipped.results.calc, undefined);

  session = setOperatorParams(session, "calc", { targetField: "area", expression: "1" });
  assert.equal(session.errors.calc, undefined);
  const calculated = await runJob(session);
  assert.equal((calculated.results.calc as Layer).opId, "data.fieldCalc");

  let join = createGraph("按属性拼");
  join = addSource(join, { id: "left", fileId: "left", label: "left.geojson" });
  join = addSource(join, { id: "right", fileId: "right", label: "right.geojson" });
  join = addOperator(join, { id: "join", opId: "data.attributeJoin", params: {} });
  join = connect(join, "left", "join", 0);
  join = connect(join, "right", "join", 1);
  let joined = setSourceResult(toRuntime(join), "left", layer("a"));
  joined = setSourceResult(joined, "right", layer("b"));
  assert.equal(joined.errors.join, "缺 leftKey；缺 rightKey");
  const joinSkipped = await runJob(joined);
  assert.equal(joinSkipped.results.join, undefined);

  let moran = createGraph("莫兰");
  moran = addSource(moran, { id: "src", fileId: "input", label: "input.geojson" });
  moran = addOperator(moran, { id: "moran", opId: "spatial.moransI", params: {} });
  moran = connect(moran, "src", "moran", 0);
  const moranSession = setSourceResult(toRuntime(moran), "src", layer("a"));
  assert.equal(moranSession.errors.moran, "缺 valueField");
  const moranSkipped = await runJob(moranSession);
  assert.equal(moranSkipped.results.moran, undefined);
  const moranDone = await runJob(setOperatorParams(moranSession, "moran", { valueField: "pop" }));
  const moranResult = moranDone.results.moran as Layer & { applied: { kNeighbors: number; valueField: string } };
  assert.equal(moranResult.applied.valueField, "pop");
  assert.equal(moranResult.applied.kNeighbors, 5);
});

test("已经有默认值的项可以改，不填也能跑", async () => {
  assert.equal(resolvedParams("spatial.h3Bin", {}).cellSideKm, 10);
  assert.equal(resolvedParams("spatial.smooth", {}).iterations, 3);
  assert.equal(resolvedParams("spatial.concaveHull", {}).concavity, 2);
  assert.equal(resolvedParams("spatial.spatialJoin", {}).predicate, "intersects");
  assert.equal(resolvedParams("spatial.selectByLocation", {}).predicate, "intersects");
  assert.equal(resolvedParams("spatial.h3Bin", { cellSideKm: 2 }).cellSideKm, 2);
  assert.equal(resolvedParams("spatial.smooth", { iterations: 1 }).iterations, 1);
  assert.equal(resolvedParams("spatial.concaveHull", { concavity: 4 }).concavity, 4);
  assert.equal(resolvedParams("spatial.spatialJoin", { predicate: "within" }).predicate, "within");
  assert.equal(resolvedParams("spatial.selectByLocation", { predicate: "contains" }).predicate, "contains");
  assert.equal(resolvedParams("spatial.moransI", { valueField: "pop", kNeighbors: 8 }).kNeighbors, 8);
  assert.equal(paramIssues("spatial.h3Bin", {}).length, 0);
  assert.ok(paramIssues("spatial.h3Bin", { cellSideKm: 0 }).some((issue) => issue.includes("cellSideKm")));
  assert.ok(paramIssues("spatial.concaveHull", { concavity: 0 }).some((issue) => issue.includes("concavity")));
  assert.ok(paramIssues("spatial.spatialJoin", { predicate: "touches" }).some((issue) => issue.includes("predicate")));
  assert.deepEqual(paramIssues("spatial.reproject", { fromCrs: "EPSG:4326", toCrs: "EPSG:3857" }), []);
  assert.ok(paramIssues("spatial.reproject", { toCrs: "GCJ-02" }).some((issue) => issue.includes("EPSG")));
  assert.throws(
    () =>
      parseRecipe({
        version: 2,
        name: "换坐标系",
        steps: [{ id: "s", operator: "spatial.reproject", params: { toCrs: "BD-09" } }],
        files: [],
      }),
    /EPSG/,
  );

  let bins = createGraph("六边形");
  bins = addSource(bins, { id: "src", fileId: "input", label: "input.geojson" });
  bins = addOperator(bins, { id: "bins", opId: "spatial.h3Bin", params: {} });
  bins = connect(bins, "src", "bins", 0);
  const session = setSourceResult(toRuntime(bins), "src", layer("a"));
  assert.equal(session.errors.bins, undefined);
  const done = await runJob(session);
  assert.equal((done.results.bins as Layer & { applied: { cellSideKm: number } }).applied.cellSideKm, 10);
});

test("格式转换和按字段拆开不进这份作业", () => {
  for (const opId of ["format.convert", "format.parse", "format.write", "data.split"]) {
    assert.equal(isWorkflowOperator(opId), false);
    assert.throws(() => parseRecipe({ version: 2, name: "不行", steps: [{ operator: opId, params: {} }], files: [] }), new RegExp(opId.replace(".", "\\.")));
  }
  assert.equal(isWorkflowOperator("spatial.buffer"), true);
});

test("免费版按算子节点数到 5，图的来源不算第二份名额", () => {
  let graph = createGraph("免费");
  for (let index = 0; index < 3; index += 1) {
    graph = addSource(graph, { id: `src_${index}`, fileId: `f_${index}`, label: `${index}.geojson` });
  }
  for (let index = 0; index < 5; index += 1) {
    graph = addOperator(graph, { id: `op_${index}`, opId: "spatial.buffer", params: { distanceKm: 1 } });
  }
  const within = checkOperatorCap(graph);
  assert.equal(within.ok, true);
  assert.equal(within.actual, 5);
  assert.equal(within.cap, 5);
  assert.equal(within.unit, "steps");

  const over = checkOperatorCap(
    addOperator(graph, { id: "op_5", opId: "spatial.simplify", params: { tolerance: 0.01 } }),
  );
  assert.equal(over.ok, false);
  assert.equal(over.actual, 6);
  assert.equal(over.cap, 5);
});

test("一条线做缓冲、另一条线做简化，两步同时在算，相交等缓冲结束", { timeout: 20_000 }, async () => {
  const graph = branchedJob({ bufferMs: 300, simplifyMs: 300 });
  let session = toRuntime(graph);
  session = setSourceResult(session, "srcA", layer("a"));
  session = setSourceResult(session, "srcB", layer("b"));
  session = setSourceResult(session, "srcC", layer("c"));
  assert.equal(nodeStatus(session, "buffer"), "ready");
  assert.equal(nodeStatus(session, "simplify"), "ready");
  assert.notEqual(nodeStatus(session, "intersect"), "ready");

  let sawBoth = false;
  let intersectWhileBuffer = false;
  const doneEvents: Extract<StepEvent, { phase: "done" }>[] = [];
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
  }, 20);
  let done;
  try {
    done = await runJob(session, {
      onUpdate(current) {
        if (current.running.has("buffer") && current.running.has("simplify")) sawBoth = true;
        if (current.running.has("intersect") && current.running.has("buffer")) intersectWhileBuffer = true;
      },
      onStep(event) {
        if (event.phase === "done") doneEvents.push(event);
      },
    });
  } finally {
    clearInterval(timer);
  }

  assert.equal(sawBoth, true);
  assert.equal(intersectWhileBuffer, false);
  assert.ok(ticks >= 2, `页面那条线程在计算时只走了 ${ticks} 下`);

  const buffer = eventByNode(doneEvents, "buffer");
  const simplify = eventByNode(doneEvents, "simplify");
  const intersect = eventByNode(doneEvents, "intersect");
  assert.ok(buffer.startedAt < simplify.finishedAt);
  assert.ok(simplify.startedAt < buffer.finishedAt);
  assert.ok(intersect.startedAt >= buffer.finishedAt);
  for (const event of [buffer, simplify, intersect]) {
    assert.equal(event.inWorker, true);
    assert.notEqual(event.threadId, threadId);
    assert.ok(event.threadId > 0);
  }

  const result = done.results.intersect as Layer;
  assert.equal(result.type, "FeatureCollection");
  assert.equal(result.opId, "spatial.intersect");
  assert.deepEqual(
    result.features.map((feature) => feature.properties.id).sort(),
    ["a", "c"],
  );
  assert.ok(done.results.simplify);
});

type Layer = {
  type: "FeatureCollection";
  features: Array<{ type: "Feature"; properties: { id: string }; geometry: { type: "Point"; coordinates: number[] } }>;
  opId: string;
};

function layer(id: string): Layer {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { id },
        geometry: { type: "Point", coordinates: [0, 0] },
      },
    ],
    opId: id,
  };
}

function branchedJob(timing: { bufferMs?: number; simplifyMs?: number } = {}): Graph {
  let graph = createGraph("分叉");
  graph = addSource(graph, { id: "srcA", fileId: "a", label: "a.geojson", x: 0, y: 100 });
  graph = addSource(graph, { id: "srcB", fileId: "b", label: "b.geojson", x: 0, y: 280 });
  graph = addSource(graph, { id: "srcC", fileId: "c", label: "c.geojson", x: 440, y: 260 });
  graph = addOperator(graph, {
    id: "buffer",
    opId: "spatial.buffer",
    params: { distanceKm: 1, ...(timing.bufferMs ? { workMs: timing.bufferMs } : {}) },
    x: 220,
    y: 100,
  });
  graph = addOperator(graph, {
    id: "simplify",
    opId: "spatial.simplify",
    params: { tolerance: 0.01, ...(timing.simplifyMs ? { workMs: timing.simplifyMs } : {}) },
    x: 220,
    y: 280,
  });
  graph = addOperator(graph, {
    id: "intersect",
    opId: "spatial.intersect",
    params: {},
    x: 440,
    y: 100,
  });
  graph = connect(graph, "srcA", "buffer", 0);
  graph = connect(graph, "srcB", "simplify", 0);
  graph = connect(graph, "buffer", "intersect", 0);
  graph = connect(graph, "srcC", "intersect", 1);
  return graph;
}

function nodeIds(graph: Graph): string[] {
  return Object.keys(graph.nodes).sort();
}

function eventByNode(events: Extract<StepEvent, { phase: "done" }>[], nodeId: string) {
  const event = events.find((item) => item.nodeId === nodeId);
  assert.ok(event, nodeId);
  return event;
}
