(function () {
  "use strict";

  const LAYOUT = {
    drive:    { x: 40,  y: 40  },
    notion:   { x: 40,  y: 120 },
    slack:    { x: 40,  y: 200 },
    schedule: { x: 40,  y: 280 },
    manual:   { x: 40,  y: 360 },
    approval: { x: 420, y: 200 },
    discord:  { x: 240, y: 380 },
    notes:    { x: 320, y: 380 },
    cad:      { x: 400, y: 380 },
    mcp:      { x: 480, y: 380 },
  };
  const NODE_W = 140;
  const NODE_H = 56;

  function renderNode(node) {
    const pos = LAYOUT[node.id];
    const el = document.createElement("div");
    el.className = "tako-canvas-node" +
      (node.kind === "approval" ? " tako-canvas-node--approval" : "") +
      (node.active === false ? " tako-canvas-node--inactive" : "");
    el.dataset.nodeId = node.id;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.style.width = `${NODE_W}px`;
    el.style.height = `${NODE_H}px`;
    el.textContent = node.label;
    return el;
  }

  function edgePath(fromId, toId) {
    const from = LAYOUT[fromId];
    const to = LAYOUT[toId];
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const midX = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  }

  function attachDragConnect(nodeEl, nodeId, onEdgeDragCreate, container) {
    nodeEl.addEventListener("pointerdown", (downEvent) => {
      downEvent.preventDefault();
      const tempLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      tempLine.setAttribute("class", "tako-canvas-drag-line");
      const svg = container.querySelector(".tako-canvas-edges");
      svg.appendChild(tempLine);
      const fromPos = LAYOUT[nodeId];
      const x1 = fromPos.x + NODE_W;
      const y1 = fromPos.y + NODE_H / 2;
      tempLine.setAttribute("x1", x1);
      tempLine.setAttribute("y1", y1);

      function onMove(moveEvent) {
        const rect = container.getBoundingClientRect();
        tempLine.setAttribute("x2", moveEvent.clientX - rect.left);
        tempLine.setAttribute("y2", moveEvent.clientY - rect.top);
      }
      function onUp(upEvent) {
        const approvalEl = container.querySelector('[data-node-id="approval"]');
        const rect = approvalEl.getBoundingClientRect();
        const hit = upEvent.clientX >= rect.left && upEvent.clientX <= rect.right &&
                    upEvent.clientY >= rect.top && upEvent.clientY <= rect.bottom;
        tempLine.remove();
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (hit) onEdgeDragCreate(nodeId);
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  function render(container, { nodes, edges, onEdgeDragCreate, onEdgeSelect }) {
    container.innerHTML = "";
    container.classList.add("tako-canvas-root");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "tako-canvas-edges");
    svg.setAttribute("viewBox", "0 0 600 440");

    for (const edge of edges) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", edgePath(edge.fromNodeId, edge.toNodeId));
      path.setAttribute("class", "tako-canvas-edge");
      path.dataset.edgeId = edge.id;
      path.addEventListener("click", () => onEdgeSelect(edge.id));
      svg.appendChild(path);
    }
    container.appendChild(svg);

    for (const node of nodes) {
      const el = renderNode(node);
      if (node.kind !== "approval" && node.active !== false) {
        attachDragConnect(el, node.id, onEdgeDragCreate, container);
      }
      container.appendChild(el);
    }
  }

  window.TakoNodeCanvas = { render };
})();
