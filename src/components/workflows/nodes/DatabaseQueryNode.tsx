import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Search } from "lucide-react";
import { NodeActionBar } from "./NodeActionBar";

export const DatabaseQueryNode = memo(({ data, selected, id }: NodeProps) => {
  const d = data as any;
  const subtitle = d.tableName ? `${d.operation ?? ""} ${d.tableName}`.trim() : "Query DB";
  return (
    <div
      className={`group relative rounded-xl border-2 px-4 py-3 min-w-[180px] bg-card shadow-sm transition-colors ${
        selected ? "border-cyan-500" : "border-cyan-500/50"
      }`}
    >
      <NodeActionBar nodeId={id} />
      <Handle type="target" position={Position.Left} className="!bg-cyan-500" />
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-500 flex items-center justify-center">
          <Search className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{d.label || "Query Banco"}</p>
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-cyan-500" />
    </div>
  );
});
DatabaseQueryNode.displayName = "DatabaseQueryNode";
