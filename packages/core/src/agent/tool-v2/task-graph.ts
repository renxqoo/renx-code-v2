import type { TaskDependencyGraph } from './task-contracts';

function pushUnique(values: string[], next: string): void {
  if (!values.includes(next)) {
    values.push(next);
  }
}

export function ensureTaskGraphNode(graph: TaskDependencyGraph, taskId: string): void {
  if (!graph.adjacency[taskId]) {
    graph.adjacency[taskId] = [];
  }
  if (!graph.reverse[taskId]) {
    graph.reverse[taskId] = [];
  }
}

export function addTaskDependencyEdge(
  graph: TaskDependencyGraph,
  blockerId: string,
  dependentId: string
): void {
  ensureTaskGraphNode(graph, blockerId);
  ensureTaskGraphNode(graph, dependentId);
  pushUnique(graph.adjacency[blockerId], dependentId);
  pushUnique(graph.reverse[dependentId], blockerId);
}

export function removeTaskDependencyEdge(
  graph: TaskDependencyGraph,
  blockerId: string,
  dependentId: string
): void {
  ensureTaskGraphNode(graph, blockerId);
  ensureTaskGraphNode(graph, dependentId);
  graph.adjacency[blockerId] = graph.adjacency[blockerId].filter((id) => id !== dependentId);
  graph.reverse[dependentId] = graph.reverse[dependentId].filter((id) => id !== blockerId);
}

export function taskGraphHasPath(
  graph: TaskDependencyGraph,
  fromId: string,
  toId: string
): boolean {
  if (fromId === toId) {
    return true;
  }

  const visited = new Set<string>();
  const queue: string[] = [fromId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (current === toId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const next of graph.adjacency[current] || []) {
      if (!visited.has(next)) {
        queue.push(next);
      }
    }
  }

  return false;
}

export function taskDependencyWouldCycle(
  graph: TaskDependencyGraph,
  blockerId: string,
  dependentId: string
): boolean {
  if (blockerId === dependentId) {
    return true;
  }
  return taskGraphHasPath(graph, dependentId, blockerId);
}
