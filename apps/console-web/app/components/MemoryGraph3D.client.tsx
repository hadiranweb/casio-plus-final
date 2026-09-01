import { m } from '@casioplus/i18n/messages';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

export type MemoryGraphNode = {
  id: string;
  entityId: string;
  entityType: 'namespace' | 'memory' | 'claim' | 'semantic_record' | 'run' | 'flow';
  label: string;
  kind?: string;
  namespaceId?: string;
  sensitivity?: string;
  createdAt?: string;
};

export type MemoryGraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: 'belongs_to' | 'promoted_from' | 'derived_from' | 'recorded_in' | 'executed_by';
};

export type MemoryGraphData = {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
};

const colors: Record<MemoryGraphNode['entityType'], number> = {
  namespace: 0xf1c36a,
  memory: 0x72d8a2,
  claim: 0x7cb6ff,
  semantic_record: 0xb2a1ff,
  run: 0xff9b72,
  flow: 0xe8edf2,
};

const radii: Record<MemoryGraphNode['entityType'], number> = {
  namespace: 6,
  memory: 36,
  claim: 58,
  semantic_record: 78,
  run: 98,
  flow: 116,
};

function positionFor(node: MemoryGraphNode, index: number, total: number) {
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  if (node.entityType === 'namespace') {
    return new THREE.Vector3(Math.cos(angle) * 10, Math.sin(angle) * 10, 12);
  }
  const ring = radii[node.entityType];
  const variation = 0.82 + ((index * 29) % 31) / 100;
  const z = ((index % 9) - 4) * Math.max(2, 34 / Math.max(total, 1));
  return new THREE.Vector3(
    Math.cos(angle) * ring * variation,
    Math.sin(angle) * ring * variation,
    z,
  );
}

export default function MemoryGraph3D({ data }: { data: MemoryGraphData }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<() => void>(() => undefined);
  const [selectedId, setSelectedId] = useState<string | null>(data.nodes[0]?.id ?? null);
  const selected = useMemo(
    () => data.nodes.find((node) => node.id === selectedId) ?? null,
    [data.nodes, selectedId],
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || data.nodes.length === 0) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 1_000);
    camera.position.set(0, 0, 220);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.replaceChildren(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);
    const nodeIndex = new Map<string, number>();
    const positions = data.nodes.map((node, index) => {
      nodeIndex.set(node.id, index);
      return positionFor(node, index, data.nodes.length);
    });

    const pointGeometry = new THREE.BufferGeometry().setFromPoints(positions);
    pointGeometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(
        data.nodes.flatMap((node) => {
          const color = new THREE.Color(colors[node.entityType]);
          return [color.r, color.g, color.b];
        }),
        3,
      ),
    );
    const pointMaterial = new THREE.PointsMaterial({
      size: 7,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.96,
      vertexColors: true,
    });
    const points = new THREE.Points(pointGeometry, pointMaterial);
    group.add(points);

    const edgePositions: number[] = [];
    for (const edge of data.edges) {
      const sourceIndex = nodeIndex.get(edge.source);
      const targetIndex = nodeIndex.get(edge.target);
      if (sourceIndex === undefined || targetIndex === undefined) continue;
      edgePositions.push(
        ...positions[sourceIndex]!.toArray(),
        ...positions[targetIndex]!.toArray(),
      );
    }
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x526171,
      transparent: true,
      opacity: 0.42,
    });
    const lines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    group.add(lines);

    const render = () => renderer.render(scene, camera);
    const resize = () => {
      const width = Math.max(mount.clientWidth, 280);
      const height = Math.max(mount.clientHeight, 320);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 7 };
    const pointer = new THREE.Vector2();
    let dragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      moved = false;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const deltaX = event.clientX - lastX;
      const deltaY = event.clientY - lastY;
      moved ||= Math.abs(deltaX) + Math.abs(deltaY) > 2;
      group.rotation.y += deltaX * 0.006;
      group.rotation.x += deltaY * 0.004;
      group.rotation.x = Math.max(-0.8, Math.min(0.8, group.rotation.x));
      lastX = event.clientX;
      lastY = event.clientY;
      render();
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      if (moved) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const match = raycaster.intersectObject(points)[0];
      if (match?.index !== undefined) setSelectedId(data.nodes[match.index]?.id ?? null);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      camera.position.z = Math.max(90, Math.min(360, camera.position.z + event.deltaY * 0.14));
      render();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const controls: Record<string, () => void> = {
        ArrowLeft: () => (group.rotation.y -= 0.12),
        ArrowRight: () => (group.rotation.y += 0.12),
        ArrowUp: () => (group.rotation.x -= 0.1),
        ArrowDown: () => (group.rotation.x += 0.1),
        '+': () => (camera.position.z = Math.max(90, camera.position.z - 18)),
        '-': () => (camera.position.z = Math.min(360, camera.position.z + 18)),
      };
      const control = controls[event.key];
      if (!control) return;
      event.preventDefault();
      control();
      render();
    };
    resetRef.current = () => {
      group.rotation.set(0, 0, 0);
      camera.position.set(0, 0, 220);
      render();
    };

    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    mount.addEventListener('keydown', onKeyDown);

    return () => {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      mount.removeEventListener('keydown', onKeyDown);
      pointGeometry.dispose();
      pointMaterial.dispose();
      edgeGeometry.dispose();
      edgeMaterial.dispose();
      renderer.dispose();
      mount.replaceChildren();
    };
  }, [data]);

  return (
    <div className="memory-graph-explorer">
      <div
        className="memory-graph-canvas"
        ref={mountRef}
        role="group"
        tabIndex={0}
        aria-label={m.console_memory_graph_aria_label()}
      />
      <div className="memory-graph-controls">
        <button type="button" onClick={() => resetRef.current()}>
          {m.console_memory_graph_reset_view()}
        </button>
        <span>{m.console_memory_graph_node_count({ count: data.nodes.length })}</span>
        <span>{m.console_memory_graph_edge_count({ count: data.edges.length })}</span>
        <span className="memory-graph-hint">{m.console_memory_graph_hint()}</span>
      </div>
      <aside className="memory-graph-detail" aria-live="polite">
        {selected ? (
          <>
            <span>{selected.entityType.replace('_', ' ')}</span>
            <strong>{selected.label}</strong>
            <small>
              {selected.kind ??
                selected.sensitivity ??
                m.console_memory_graph_id({ id: selected.entityId.slice(0, 8) })}
            </small>
          </>
        ) : (
          <span>{m.console_memory_graph_select_node_hint()}</span>
        )}
      </aside>
      <nav
        className="memory-graph-node-list"
        aria-label={m.console_memory_graph_selectable_nodes()}
      >
        {data.nodes.slice(0, 24).map((node) => (
          <button
            type="button"
            key={node.id}
            className={node.id === selectedId ? 'active' : ''}
            onClick={() => setSelectedId(node.id)}
          >
            <i data-node-type={node.entityType} />
            <span>
              <strong>{node.label}</strong>
              <small>{node.entityType.replace('_', ' ')}</small>
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}
