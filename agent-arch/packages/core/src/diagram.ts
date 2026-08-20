import type { Blueprint, BlueprintNode, Ontology, OntologyElement } from "./types.js";
import { elementById } from "./ontology.js";
import { activeRiskReport } from "./risk.js";

const NODE_H = 36;
const GAP_X = 18;
const GAP_Y = 44;
const PAD = 28;
const MIN_BOX_W = 150;
const BADGE_GAP = 6;

interface LNode {
  label: string;
  decision: boolean;
  resp: boolean;
  notes: number;
  boxW: number;
  subW: number;
  x: number;
  y: number;
  children: LNode[];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2000 ? 12.5 : 7.2;
  return Math.ceil(w);
}

function buildLayout(
  ontology: Ontology,
  notesByElement: Map<string, number>,
  nodes: BlueprintNode[],
): LNode[] {
  return nodes.map((n) => {
    const el = elementById(ontology, n.ref);
    const label = n.name ?? el?.name ?? n.ref;
    const children = buildLayout(ontology, notesByElement, n.children);
    let badgeW = 16;
    if (n.decision) badgeW += textWidth("●决策") + BADGE_GAP;
    if (n.responsibility) badgeW += textWidth("■职责") + BADGE_GAP;
    const notes = el ? (notesByElement.get(el.id) ?? 0) : 0;
    if (notes > 0) badgeW += textWidth(`▲${notes}`) + BADGE_GAP;
    const boxW = Math.max(MIN_BOX_W, textWidth(label) + 28, badgeW + 8);
    return {
      label,
      decision: n.decision !== null,
      resp: n.responsibility !== null,
      notes,
      boxW,
      subW: 0,
      x: 0,
      y: 0,
      children,
    };
  });
}

function subtreeWidth(n: LNode): number {
  let sw = 0;
  for (const c of n.children) sw += subtreeWidth(c);
  if (n.children.length > 0) sw += GAP_X * (n.children.length - 1);
  n.subW = Math.max(n.boxW, sw);
  return n.subW;
}

function position(n: LNode, x: number, y: number): void {
  n.x = x + (n.subW - n.boxW) / 2;
  n.y = y;
  let span = 0;
  for (const c of n.children) span += c.subW;
  if (n.children.length > 0) span += GAP_X * (n.children.length - 1);
  let cx = x + (n.subW - span) / 2;
  for (const c of n.children) {
    position(c, cx, y + NODE_H + GAP_Y);
    cx += c.subW + GAP_X;
  }
}

function maxHeight(n: LNode): number {
  let m = n.y + NODE_H;
  for (const c of n.children) m = Math.max(m, maxHeight(c));
  return m;
}

function drawBoxes(ontology: Ontology, n: LNode, out: string[]): void {
  out.push(
    `<rect x="${n.x}" y="${n.y}" width="${n.boxW}" height="${NODE_H}" rx="6" fill="#161b22" stroke="#30363d"/>`,
    `<text x="${n.x + n.boxW / 2}" y="${n.y + 16}" text-anchor="middle" font-size="12" fill="#e6edf3">${esc(n.label)}</text>`,
  );
  let bx = n.x + 12;
  const by = n.y + 28;
  if (n.decision) {
    out.push(`<circle cx="${bx + 3}" cy="${by - 3}" r="3.2" fill="#4f8ff7"/>`);
    out.push(`<text x="${bx + 9}" y="${by}" font-size="10" fill="#4f8ff7">决策</text>`);
    bx += textWidth("●决策") + BADGE_GAP;
  }
  if (n.resp) {
    out.push(`<rect x="${bx}" y="${by - 7}" width="6" height="6" fill="#a371f7"/>`);
    out.push(`<text x="${bx + 9}" y="${by}" font-size="10" fill="#a371f7">职责</text>`);
    bx += textWidth("■职责") + BADGE_GAP;
  }
  if (n.notes > 0) {
    out.push(`<text x="${bx}" y="${by}" font-size="10" fill="#d29922">▲待考量×${n.notes}</text>`);
  }
  for (const c of n.children) {
    const px = n.x + n.boxW / 2;
    const py = n.y + NODE_H;
    const cx = c.x + c.boxW / 2;
    const cy = c.y;
    const midY = py + GAP_Y / 2;
    out.push(
      `<path d="M ${px} ${py} L ${px} ${midY} L ${cx} ${midY} L ${cx} ${cy}" fill="none" stroke="#30363d"/>`,
    );
  }
  for (const c of n.children) drawBoxes(ontology, c, out);
}

export function renderBlueprintDiagram(ontology: Ontology, bp: Blueprint): string {
  const report = activeRiskReport(ontology, bp.nodes);
  const unresolved = new Set(report.statuses.filter((s) => s.unresolved).map((s) => s.riskId));
  const notesByElement = new Map<string, number>();
  for (const el of ontology.elements) {
    const c = el.introduces.filter((r) => unresolved.has(r)).length;
    if (c > 0) notesByElement.set(el.id, c);
  }

  const roots = buildLayout(ontology, notesByElement, bp.nodes);
  const rootSpan = roots.reduce((s, r) => s + subtreeWidth(r), 0) + GAP_X * Math.max(0, roots.length - 1);

  const family = ontology.families.find((f) => f.id === bp.runtimeFamily);
  const title = `${bp.name} — ${family?.name ?? bp.runtimeFamily}`;
  const meta = `v${bp.version} / sv${bp.structuralVersion} · ${bp.status} · ontology ${ontology.version}`;
  const titleW = Math.max(textWidth(title) + 10, textWidth(meta) + 10, MIN_BOX_W);
  const width = Math.max(titleW, rootSpan) + PAD * 2;
  const y0 = PAD + 44;

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${0}" viewBox="0 0 ${Math.ceil(width)} 0" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" style="background:#0d1117">`);
  out.push(`<rect x="0" y="0" width="${Math.ceil(width)}" height="4" fill="none"/>`);

  let cx = (width - rootSpan) / 2;
  const placed: LNode[] = [];
  for (const r of roots) {
    position(r, cx, y0);
    placed.push(r);
    cx += r.subW + GAP_X;
  }
  const bottomY = placed.length > 0 ? Math.max(...placed.map(maxHeight)) : y0;
  const legendY = bottomY + 30;
  const height = legendY + PAD + 8;

  out[0] = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" style="background:#0d1117">`;
  out[1] = `<rect x="0" y="0" width="${Math.ceil(width)}" height="${Math.ceil(height)}" fill="#0d1117"/>`;

  out.push(`<text x="${PAD}" y="${PAD}" font-size="15" font-weight="700" fill="#e6edf3">${esc(title)}</text>`);
  out.push(`<text x="${PAD}" y="${PAD + 20}" font-size="11" fill="#8b949e">${esc(meta)}</text>`);

  for (const r of placed) drawBoxes(ontology, r, out);

  let lx = PAD;
  out.push(`<circle cx="${lx + 4}" cy="${legendY - 3}" r="3.2" fill="#4f8ff7"/>`);
  lx += 14;
  out.push(`<text x="${lx}" y="${legendY}" font-size="10" fill="#8b949e">已记录设计决策（ADR）</text>`);
  lx += textWidth("已记录设计决策（ADR）") + 24;
  out.push(`<rect x="${lx}" y="${legendY - 8}" width="7" height="7" fill="#a371f7"/>`);
  lx += 14;
  out.push(`<text x="${lx}" y="${legendY}" font-size="10" fill="#8b949e">已声明职责边界</text>`);
  lx += textWidth("已声明职责边界") + 24;
  out.push(`<text x="${lx}" y="${legendY}" font-size="10" fill="#d29922">▲ = 待考量的架构注记</text>`);

  out.push("</svg>");
  return out.join("\n");
}
