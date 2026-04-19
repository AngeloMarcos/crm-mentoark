import { useCallback, useRef, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useWorkflowStore } from "@/stores/workflowStore";
import { nodeTypes } from "./nodes/nodeTypes";
import type { WorkflowNode } from "@/types/workflow";

let nodeId = 0;
const nextId = () => `n_${Date.now()}_${++nodeId}`;

export function WorkflowCanvas() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    setSelectedNodeId,
    nodeStatusMap,
    validationErrors,
  } = useWorkflowStore();

  const rfRef = useRef<ReactFlowInstance<any, any> | null>(null);

  const errorIds = useMemo(
    () => new Set(validationErrors.map((e: any) => e.nodeId)),
    [validationErrors],
  );

  const styledEdges = useMemo(
    () =>
      edges.map((e: any) => {
        const s = nodeStatusMap[e.source];
        if (s?.status === "success")
          return { ...e, animated: false, style: { stroke: "hsl(142,71%,45%)", strokeWidth: 2 } };
        if (s?.status === "error")
          return { ...e, animated: false, style: { stroke: "hsl(0,84%,60%)", strokeWidth: 2 } };
        if (s?.status === "running")
          return { ...e, animated: true, style: { stroke: "hsl(217,91%,60%)", strokeWidth: 2 } };
        return e;
      }),
    [edges, nodeStatusMap],
  );

  const styledNodes = useMemo(
    () =>
      nodes.map((n: any) => {
        const status = nodeStatusMap[n.id]?.status;
        const hasError = errorIds.has(n.id);
        let ring = "";
        if (status === "running") ring = "ring-2 ring-primary";
        else if (status === "success") ring = "ring-2 ring-emerald-500";
        else if (status === "error") ring = "ring-2 ring-destructive";
        else if (hasError) ring = "ring-2 ring-amber-500";
        return ring ? { ...n, className: `${n.className ?? ""} ${ring}`.trim() } : n;
      }),
    [nodes, nodeStatusMap, errorIds],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/reactflow");
      if (!raw || !rfRef.current) return;
      const { type, label, defaults } = JSON.parse(raw);
      const position = rfRef.current.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      const node: WorkflowNode = {
        id: nextId(),
        type,
        position,
        data: { label, ...(defaults ?? {}) },
      };
      addNode(node);
    },
    [addNode],
  );

  const onNodeClick = useCallback(
    (_: any, node: any) => setSelectedNodeId(node.id),
    [setSelectedNodeId],
  );

  const onPaneClick = useCallback(() => setSelectedNodeId(null), [setSelectedNodeId]);

  return (
    <div className="flex-1 h-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={styledNodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={(instance) => (rfRef.current = instance)}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls className="!bg-card !border-border" />
        <MiniMap
          className="!bg-card !border-border"
          nodeColor={() => "hsl(var(--primary))"}
          maskColor="hsl(var(--background) / 0.6)"
        />
      </ReactFlow>
    </div>
  );
}
