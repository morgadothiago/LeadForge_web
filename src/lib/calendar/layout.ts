import type { Segment } from "./tz";

export interface LaneItem { lane: number; lanes: number }
/** Blocos sobrepostos lado a lado: lane gulosa por cluster de sobreposicao. Entrada ordenada por inicio (mantem a ordem). */
export function layoutLanes(segs: Segment[]): LaneItem[] {
  const order = segs.map((s, i) => ({ s, i })).sort((a, b) => a.s.startMin - b.s.startMin || a.s.endMin - b.s.endMin);
  const out: LaneItem[] = new Array(segs.length);
  let cluster: number[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];
  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const i of cluster) out[i].lanes = lanes;
    cluster = [];
    laneEnds.length = 0;
  };
  for (const { s, i } of order) {
    if (cluster.length && s.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= s.startMin);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = Math.max(s.endMin, s.startMin + 15);
    out[i] = { lane, lanes: 1 };
    cluster.push(i);
    clusterEnd = Math.max(clusterEnd, laneEnds[lane]);
  }
  flush();
  return out;
}
