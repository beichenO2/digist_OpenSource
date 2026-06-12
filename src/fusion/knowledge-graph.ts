import type { ContentItem } from '../types/index.js';
import { compressContent, type EntityMention } from '../digestion/context-compressor.js';
import GraphConstructor from 'graphology';
import louvainDefault from 'graphology-communities-louvain';

const Graph = (GraphConstructor as any).default ?? GraphConstructor;
const louvain: (graph: any, options?: any) => Record<string, number> =
  (louvainDefault as any).default ?? louvainDefault;

export interface GraphNode {
  id: string;
  label: string;
  type: 'entity' | 'topic' | 'source' | 'platform';
  properties: Record<string, unknown>;
  weight: number;
  community: number;
  linkCount: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'mentions' | 'related_to' | 'corroborates' | 'contradicts' | 'belongs_to' | 'co_occurs';
  weight: number;
  evidence: string[];
}

export interface CommunityInfo {
  id: number;
  nodeCount: number;
  cohesion: number;
  topNodes: string[];
}

export interface SurprisingConnection {
  source: GraphNode;
  target: GraphNode;
  score: number;
  reasons: string[];
}

export interface KnowledgeGap {
  type: 'isolated-node' | 'sparse-community' | 'bridge-node';
  title: string;
  description: string;
  nodeIds: string[];
  suggestion: string;
}

const RELEVANCE_WEIGHTS = {
  directLink: 3.0,
  sourceOverlap: 4.0,
  adamicAdar: 1.5,
  typeAffinity: 1.0,
} as const;

const TYPE_AFFINITY: Record<string, Record<string, number>> = {
  entity: { topic: 1.2, entity: 0.8, source: 1.0 },
  topic: { entity: 1.2, topic: 0.8, source: 1.0 },
  source: { entity: 1.0, topic: 1.0, source: 0.5 },
  platform: { entity: 0.5, topic: 0.5, source: 0.8, platform: 0.3 },
};

export class KnowledgeGraph {
  private nodes = new Map<string, GraphNode>();
  private edges: GraphEdge[] = [];
  private adjacency = new Map<string, Set<string>>();
  private communitiesComputed = false;
  private communityInfoCache: CommunityInfo[] = [];

  addItem(item: ContentItem): void {
    const digest = compressContent(item);
    this.communitiesComputed = false;

    const sourceId = `source:${item.id}`;
    this.addNode({
      id: sourceId,
      label: item.title.slice(0, 80),
      type: 'source',
      properties: { url: item.source_url, platform: item.platform, timestamp: item.timestamp },
      weight: 1,
      community: 0,
      linkCount: 0,
    });

    const platformId = `platform:${item.platform}`;
    if (!this.nodes.has(platformId)) {
      this.addNode({
        id: platformId,
        label: item.platform,
        type: 'platform',
        properties: {},
        weight: 0,
        community: 0,
        linkCount: 0,
      });
    }
    this.incrementWeight(platformId);
    this.addEdge(sourceId, platformId, 'belongs_to', 1, [item.source_url]);

    for (const entity of digest.entities) {
      const entityId = normalizeEntityId(entity);
      if (!this.nodes.has(entityId)) {
        this.addNode({
          id: entityId,
          label: entity.text,
          type: 'entity',
          properties: { entity_type: entity.type },
          weight: 0,
          community: 0,
          linkCount: 0,
        });
      }
      this.incrementWeight(entityId, entity.frequency);
      this.addEdge(sourceId, entityId, 'mentions', entity.frequency, [item.source_url]);
    }

    for (const phrase of digest.key_phrases) {
      const topicId = `topic:${phrase.toLowerCase().replace(/\s+/g, '_')}`;
      if (!this.nodes.has(topicId)) {
        this.addNode({
          id: topicId,
          label: phrase,
          type: 'topic',
          properties: {},
          weight: 0,
          community: 0,
          linkCount: 0,
        });
      }
      this.incrementWeight(topicId);
      this.addEdge(sourceId, topicId, 'related_to', 1, [item.source_url]);
    }

    const entityIds = digest.entities.map(normalizeEntityId);
    for (let i = 0; i < entityIds.length; i++) {
      for (let j = i + 1; j < entityIds.length; j++) {
        this.addEdge(entityIds[i], entityIds[j], 'co_occurs', 1, [item.source_url]);
      }
    }
  }

  addBatch(items: ContentItem[]): void {
    for (const item of items) this.addItem(item);
  }

  private ensureCommunities(): void {
    if (this.communitiesComputed) return;
    this.computeLouvainCommunities();
    this.communitiesComputed = true;
  }

  private computeLouvainCommunities(): void {
    if (this.nodes.size === 0) {
      this.communityInfoCache = [];
      return;
    }

    const g = new Graph({ type: 'undirected' });
    for (const [id] of this.nodes) {
      g.addNode(id);
    }

    const seenEdges = new Set<string>();
    for (const edge of this.edges) {
      const key = [edge.source, edge.target].sort().join(':::');
      if (!seenEdges.has(key) && g.hasNode(edge.source) && g.hasNode(edge.target)) {
        seenEdges.add(key);
        g.addEdgeWithKey(key, edge.source, edge.target, { weight: edge.weight });
      }
    }

    const communityMap: Record<string, number> = louvain(g, { resolution: 1 });

    for (const [nodeId, commId] of Object.entries(communityMap)) {
      const node = this.nodes.get(nodeId);
      if (node) node.community = commId;
    }

    this.updateLinkCounts();

    const groups = new Map<number, string[]>();
    for (const [nodeId, node] of this.nodes) {
      const list = groups.get(node.community) ?? [];
      list.push(nodeId);
      groups.set(node.community, list);
    }

    const edgeSet = new Set<string>();
    for (const edge of this.edges) {
      edgeSet.add(`${edge.source}:::${edge.target}`);
      edgeSet.add(`${edge.target}:::${edge.source}`);
    }

    const communities: CommunityInfo[] = [];
    for (const [commId, memberIds] of groups) {
      const n = memberIds.length;
      let intraEdges = 0;
      for (let i = 0; i < memberIds.length; i++) {
        for (let j = i + 1; j < memberIds.length; j++) {
          if (edgeSet.has(`${memberIds[i]}:::${memberIds[j]}`)) intraEdges++;
        }
      }
      const possibleEdges = n > 1 ? (n * (n - 1)) / 2 : 1;
      const cohesion = intraEdges / possibleEdges;

      const sorted = [...memberIds].sort((a, b) =>
        (this.nodes.get(b)?.weight ?? 0) - (this.nodes.get(a)?.weight ?? 0)
      );
      const topNodes = sorted.slice(0, 5).map(id => this.nodes.get(id)?.label ?? id);

      communities.push({ id: commId, nodeCount: n, cohesion, topNodes });
    }

    communities.sort((a, b) => b.nodeCount - a.nodeCount);

    const idRemap = new Map<number, number>();
    communities.forEach((c, idx) => {
      idRemap.set(c.id, idx);
      c.id = idx;
    });
    for (const [, node] of this.nodes) {
      node.community = idRemap.get(node.community) ?? 0;
    }

    this.communityInfoCache = communities;
  }

  private updateLinkCounts(): void {
    for (const [id, node] of this.nodes) {
      node.linkCount = this.adjacency.get(id)?.size ?? 0;
    }
  }

  calculateRelevance(nodeA: GraphNode, nodeB: GraphNode): number {
    if (nodeA.id === nodeB.id) return 0;

    const neighborsA = this.adjacency.get(nodeA.id) ?? new Set();
    const neighborsB = this.adjacency.get(nodeB.id) ?? new Set();

    const directLink = (neighborsA.has(nodeB.id) ? 1 : 0) * RELEVANCE_WEIGHTS.directLink;

    const sourcesA = this.edges
      .filter(e => (e.source === nodeA.id || e.target === nodeA.id) && e.type === 'mentions')
      .map(e => e.source.startsWith('source:') ? e.source : e.target);
    const sourcesB = this.edges
      .filter(e => (e.source === nodeB.id || e.target === nodeB.id) && e.type === 'mentions')
      .map(e => e.source.startsWith('source:') ? e.source : e.target);
    const sourceSetA = new Set(sourcesA);
    let sourceOverlap = 0;
    for (const s of sourcesB) { if (sourceSetA.has(s)) sourceOverlap++; }
    const sourceScore = sourceOverlap * RELEVANCE_WEIGHTS.sourceOverlap;

    let adamicAdar = 0;
    for (const neighborId of neighborsA) {
      if (neighborsB.has(neighborId)) {
        const degree = this.adjacency.get(neighborId)?.size ?? 0;
        adamicAdar += 1 / Math.log(Math.max(degree, 2));
      }
    }
    const commonNeighborScore = adamicAdar * RELEVANCE_WEIGHTS.adamicAdar;

    const affinityMap = TYPE_AFFINITY[nodeA.type];
    const typeAffinityScore = (affinityMap?.[nodeB.type] ?? 0.5) * RELEVANCE_WEIGHTS.typeAffinity;

    return directLink + sourceScore + commonNeighborScore + typeAffinityScore;
  }

  findSurprisingConnections(limit = 5): SurprisingConnection[] {
    this.ensureCommunities();
    const maxDegree = Math.max(...[...this.nodes.values()].map(n => n.linkCount), 1);

    const scored: SurprisingConnection[] = [];

    for (const edge of this.edges) {
      const source = this.nodes.get(edge.source);
      const target = this.nodes.get(edge.target);
      if (!source || !target) continue;
      if (source.type === 'platform' || target.type === 'platform') continue;

      let score = 0;
      const reasons: string[] = [];

      if (source.community !== target.community) {
        score += 3;
        reasons.push('跨社区连接');
      }

      if (source.type !== target.type) {
        const distantPairs = new Set(['source-topic', 'topic-source', 'entity-source', 'source-entity']);
        const pair = `${source.type}-${target.type}`;
        if (distantPairs.has(pair)) {
          score += 2;
          reasons.push(`连接 ${source.type} 和 ${target.type}`);
        } else {
          score += 1;
          reasons.push('不同类型节点');
        }
      }

      const minDeg = Math.min(source.linkCount, target.linkCount);
      const maxDeg = Math.max(source.linkCount, target.linkCount);
      if (minDeg <= 2 && maxDeg >= maxDegree * 0.5) {
        score += 2;
        reasons.push('边缘节点连接枢纽');
      }

      if (edge.weight < 2 && edge.weight > 0) {
        score += 1;
        reasons.push('弱但存在的连接');
      }

      if (score >= 3 && reasons.length > 0) {
        scored.push({ source, target, score, reasons });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  detectKnowledgeGaps(limit = 8): KnowledgeGap[] {
    this.ensureCommunities();
    const gaps: KnowledgeGap[] = [];

    const isolated = [...this.nodes.values()].filter(
      n => n.linkCount <= 1 && n.type !== 'platform'
    );
    if (isolated.length > 0) {
      const topIsolated = isolated.slice(0, 5);
      gaps.push({
        type: 'isolated-node',
        title: `${isolated.length} 个孤立节点`,
        description: topIsolated.map(n => n.label).join(', ') +
          (isolated.length > 5 ? ` 及 ${isolated.length - 5} 个更多` : ''),
        nodeIds: isolated.map(n => n.id),
        suggestion: '这些节点几乎没有连接。考虑爬取更多相关内容以建立知识链接，或检查是否为噪声数据。',
      });
    }

    for (const comm of this.communityInfoCache) {
      if (comm.cohesion < 0.15 && comm.nodeCount >= 3) {
        gaps.push({
          type: 'sparse-community',
          title: `稀疏社区: ${comm.topNodes[0] ?? `Community ${comm.id}`}`,
          description: `${comm.nodeCount} 个节点，内聚度 ${comm.cohesion.toFixed(2)} — 内部交叉引用薄弱`,
          nodeIds: [...this.nodes.values()]
            .filter(n => n.community === comm.id)
            .map(n => n.id),
          suggestion: '该知识领域缺少内部关联。建议爬取更多该领域的深度内容或从不同平台补充信息。',
        });
      }
    }

    const communityNeighbors = new Map<string, Set<number>>();
    for (const [id] of this.nodes) {
      communityNeighbors.set(id, new Set());
    }
    for (const edge of this.edges) {
      const s = this.nodes.get(edge.source);
      const t = this.nodes.get(edge.target);
      if (s && t) {
        communityNeighbors.get(edge.source)?.add(t.community);
        communityNeighbors.get(edge.target)?.add(s.community);
      }
    }

    const bridgeNodes = [...this.nodes.values()]
      .filter(n => {
        if (n.type === 'platform') return false;
        const neighborComms = communityNeighbors.get(n.id);
        return neighborComms && neighborComms.size >= 3;
      })
      .sort((a, b) => {
        const aComms = communityNeighbors.get(a.id)?.size ?? 0;
        const bComms = communityNeighbors.get(b.id)?.size ?? 0;
        return bComms - aComms;
      })
      .slice(0, 3);

    for (const bridge of bridgeNodes) {
      const commCount = communityNeighbors.get(bridge.id)?.size ?? 0;
      gaps.push({
        type: 'bridge-node',
        title: `关键桥接: ${bridge.label}`,
        description: `连接 ${commCount} 个不同知识集群。这是知识图谱中的关键枢纽节点。`,
        nodeIds: [bridge.id],
        suggestion: '该节点连接多个知识领域。确保围绕它的内容充实 — 如果信息薄弱，整个图谱的连通性会受影响。',
      });
    }

    return gaps.slice(0, limit);
  }

  findConnections(nodeId: string, depth = 2): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const visited = new Set<string>();
    const resultNodes: GraphNode[] = [];
    const resultEdges: GraphEdge[] = [];

    const queue: Array<{ id: string; level: number }> = [{ id: nodeId, level: 0 }];

    while (queue.length > 0) {
      const { id, level } = queue.shift()!;
      if (visited.has(id) || level > depth) continue;
      visited.add(id);

      const node = this.nodes.get(id);
      if (node) resultNodes.push(node);

      const neighbors = this.adjacency.get(id) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push({ id: neighbor, level: level + 1 });
        }
      }

      for (const edge of this.edges) {
        if ((edge.source === id || edge.target === id) && !resultEdges.includes(edge)) {
          const other = edge.source === id ? edge.target : edge.source;
          if (visited.has(other) || level < depth) {
            resultEdges.push(edge);
          }
        }
      }
    }

    return { nodes: resultNodes, edges: resultEdges };
  }

  findBridgingEntities(): GraphNode[] {
    const betweenness = new Map<string, number>();

    const entityNodes = [...this.nodes.values()].filter(n => n.type === 'entity');
    for (const node of entityNodes) {
      const neighbors = this.adjacency.get(node.id) || new Set();
      const sourceNeighbors = [...neighbors].filter(n => n.startsWith('source:'));
      const platformSet = new Set<string>();
      for (const sn of sourceNeighbors) {
        const sourceNode = this.nodes.get(sn);
        if (sourceNode?.properties?.platform) {
          platformSet.add(sourceNode.properties.platform as string);
        }
      }
      if (platformSet.size > 1) {
        betweenness.set(node.id, platformSet.size * sourceNeighbors.length);
      }
    }

    return [...betweenness.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id]) => this.nodes.get(id)!)
      .filter(Boolean);
  }

  getHubs(topN = 10): GraphNode[] {
    return [...this.nodes.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, topN);
  }

  getClusters(): Map<string, string[]> {
    this.ensureCommunities();
    const clusters = new Map<string, string[]>();
    for (const [nodeId, node] of this.nodes) {
      const key = String(node.community);
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key)!.push(nodeId);
    }
    return clusters;
  }

  getCommunityInfo(): CommunityInfo[] {
    this.ensureCommunities();
    return [...this.communityInfoCache];
  }

  toSnapshot(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    this.ensureCommunities();
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges],
    };
  }

  exportSnapshot(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return this.toSnapshot();
  }

  getStats(): {
    nodes: number;
    edges: number;
    by_type: Record<string, number>;
    avg_degree: number;
    clusters: number;
  } {
    this.ensureCommunities();
    const byType: Record<string, number> = {};
    for (const node of this.nodes.values()) {
      byType[node.type] = (byType[node.type] || 0) + 1;
    }

    let totalDegree = 0;
    for (const neighbors of this.adjacency.values()) {
      totalDegree += neighbors.size;
    }

    return {
      nodes: this.nodes.size,
      edges: this.edges.length,
      by_type: byType,
      avg_degree: this.nodes.size > 0 ? totalDegree / this.nodes.size : 0,
      clusters: this.communityInfoCache.length,
    };
  }

  // Legacy compatibility methods
  getIsolatedNodes(): GraphNode[] {
    this.ensureCommunities();
    return [...this.nodes.values()].filter(n => n.linkCount <= 1);
  }

  getSparseCommunities(cohesionThreshold = 0.15): Array<{ label: string; nodes: string[]; cohesion: number }> {
    this.ensureCommunities();
    return this.communityInfoCache
      .filter(c => c.cohesion < cohesionThreshold && c.nodeCount >= 3)
      .map(c => ({
        label: c.topNodes[0] ?? `Community ${c.id}`,
        nodes: [...this.nodes.values()].filter(n => n.community === c.id).map(n => n.id),
        cohesion: c.cohesion,
      }));
  }

  getBridgeNodes(minClusters = 3): GraphNode[] {
    this.ensureCommunities();
    const gaps = this.detectKnowledgeGaps();
    return gaps
      .filter(g => g.type === 'bridge-node')
      .flatMap(g => g.nodeIds.map(id => this.nodes.get(id)!))
      .filter(Boolean);
  }

  private addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.adjacency.has(node.id)) {
      this.adjacency.set(node.id, new Set());
    }
  }

  private addEdge(source: string, target: string, type: GraphEdge['type'], weight: number, evidence: string[]): void {
    const existing = this.edges.find(
      e => e.source === source && e.target === target && e.type === type
    );

    if (existing) {
      existing.weight += weight;
      existing.evidence.push(...evidence);
    } else {
      this.edges.push({ source, target, type, weight, evidence });
      this.adjacency.get(source)?.add(target);
      this.adjacency.get(target)?.add(source);
    }
  }

  private incrementWeight(nodeId: string, amount = 1): void {
    const node = this.nodes.get(nodeId);
    if (node) node.weight += amount;
  }
}

function normalizeEntityId(entity: EntityMention): string {
  return `entity:${entity.type}:${entity.text.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}
