# GIS Toolbox

浏览器里完成矢量作业的工作台。一次作业由图层、算子和把它们连起来的图组成。

## Language

**Layer**:
一次矢量作业里的一份 GeoJSON FeatureCollection。
_Avoid_: dataset, table, coverage, file

**Operator**:
对 Layer 做一次有名字的变换，例如 `spatial.buffer`。
_Avoid_: tool, function, operation, 功能

**Session**:
一次执行中的工作区：主 Layer、可选的第二份 Layer，以及已经跑过的 Operator 记录。
_Avoid_: state, store, context

**Source**:
图上的一个节点，持有一份已经解析好的 Layer。
_Avoid_: file node, input, upload

**Second input**:
进入某个 Operator 的第二条边，为它提供第二份 Layer。
_Avoid_: input B, overlay, 副图层

**Graph**:
一份矢量作业的文档：若干 Source、若干 Operator，以及它们之间的边。
_Avoid_: recipe, pipeline, DAG, workflow file

**Recipe**:
一条单路径 Graph 的逐步展示。
_Avoid_: chain, linear workflow, gistool.json

**Tool**:
人打开的一个页面。
_Avoid_: operator, feature
