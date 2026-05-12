import { TriggerNode } from "./TriggerNode";
import { AINode } from "./AINode";
import { ActionNode } from "./ActionNode";
import { ConditionNode } from "./ConditionNode";
import { DelayNode } from "./DelayNode";
import { LoopNode } from "./LoopNode";
import { MemoryNode } from "./MemoryNode";
import { DatabaseQueryNode } from "./DatabaseQueryNode";
import { LeadCaptureNode } from "./LeadCaptureNode";
import { SentimentNode } from "./SentimentNode";
import { MultiAgentNode } from "./MultiAgentNode";
import { SubworkflowNode } from "./SubworkflowNode";
import { IntentNode } from "./IntentNode";
import type { NodeTypes } from "@xyflow/react";

export const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  ai: AINode,
  action: ActionNode,
  condition: ConditionNode,
  delay: DelayNode,
  loop: LoopNode,
  memory: MemoryNode,
  supabase_query: DatabaseQueryNode,
  lead_capture: LeadCaptureNode,
  sentiment: SentimentNode,
  multi_agent: MultiAgentNode,
  subworkflow: SubworkflowNode,
  intent: IntentNode,
};
