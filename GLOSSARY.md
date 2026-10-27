# GIS Toolbox

在浏览器里处理地图数据的网站。一次作业就是：手里有几张图，对它们做了哪些动作，这些动作怎么连在一起。

## Language

**Layer**:
一张图里的那一堆点、线或面，每条都带着自己的属性。
_Avoid_: dataset, table, coverage, file

**Operator**:
对一张图做的一个动作，比如缓冲、相交、简化。
_Avoid_: tool, function, operation, 功能

**Session**:
正在跑的那一下：手头这张图、可能还有第二张图，以及已经做过哪些动作。
_Avoid_: state, store, context

**Source**:
画布上放进去的一张原始图。
_Avoid_: file node, input, upload

**Second input**:
某一步要用到的第二张图。相交时，拿来切的那张就是它。
_Avoid_: input B, overlay, 副图层

**Graph**:
保存下来的整份作业：有哪些图、做了哪些动作、谁连着谁。
_Avoid_: recipe, pipeline, DAG, workflow file

**Recipe**:
这份作业没有分叉时，从上到下看的步骤列表。
_Avoid_: chain, linear workflow, gistool.json

**Tool**:
网站上的一个工具页面，比如格式转换、山体阴影。
_Avoid_: operator, feature
