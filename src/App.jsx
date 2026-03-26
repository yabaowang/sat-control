import { useState, useEffect, useRef, useCallback } from "react";

const DEG = "°";
const PI = Math.PI;
const TAU = PI * 2;

export default function App() {
  const canvasRef = useRef(null);
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [roll, setRoll] = useState(0);
  const [orbitSpeed, setOrbitSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const stateRef = useRef({ yaw: 0, pitch: 0, roll: 0, orbitSpeed: 1, paused: false });

  useEffect(() => {
    stateRef.current = { yaw, pitch, roll, orbitSpeed, paused };
  }, [yaw, pitch, roll, orbitSpeed, paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    let orbitAngle = 0;
    let camRotY = 0.3;
    let camRotX = 0.4;
    let isDragging = false;
    let lastMouse = { x: 0, y: 0 };

    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width * 2;
      canvas.height = rect.height * 2;
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
    };
    resize();
    window.addEventListener("resize", resize);

    canvas.addEventListener("mousedown", e => { isDragging = true; lastMouse = { x: e.clientX, y: e.clientY }; });
    window.addEventListener("mouseup", () => isDragging = false);
    window.addEventListener("mousemove", e => {
      if (!isDragging) return;
      camRotY += (e.clientX - lastMouse.x) * 0.005;
      camRotX = Math.max(-1.2, Math.min(1.2, camRotX + (e.clientY - lastMouse.y) * 0.005));
      lastMouse = { x: e.clientX, y: e.clientY };
    });

    // 3D math helpers
    function rotX(v, a) {
      const c = Math.cos(a), s = Math.sin(a);
      return [v[0], v[1]*c - v[2]*s, v[1]*s + v[2]*c];
    }
    function rotY(v, a) {
      const c = Math.cos(a), s = Math.sin(a);
      return [v[0]*c + v[2]*s, v[1], -v[0]*s + v[2]*c];
    }
    function rotZ(v, a) {
      const c = Math.cos(a), s = Math.sin(a);
      return [v[0]*c - v[1]*s, v[0]*s + v[1]*c, v[2]];
    }
    function project(v, w, h) {
      const fov = 600;
      const z = v[2] + 8;
      const scale = fov / (z + fov);
      return [v[0] * scale + w/2, -v[1] * scale + h/2, z, scale];
    }
    function applyCamera(v) {
      let r = rotY(v, camRotY);
      r = rotX(r, camRotX);
      return r;
    }
    function normalize(v) {
      const l = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);
      return l > 0 ? [v[0]/l, v[1]/l, v[2]/l] : [0,0,0];
    }
    function cross(a, b) {
      return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    }

    // Draw Earth
    function drawEarth(w, h) {
      const earthR = 2.0;
      const center = applyCamera([0, 0, 0]);
      const [cx, cy, cz, sc] = project(center, w, h);
      const screenR = earthR * sc;

      // Earth glow
      const glow = ctx.createRadialGradient(cx, cy, screenR * 0.9, cx, cy, screenR * 1.8);
      glow.addColorStop(0, "rgba(30,120,255,0.15)");
      glow.addColorStop(0.5, "rgba(30,120,255,0.05)");
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, screenR * 1.8, 0, TAU);
      ctx.fill();

      // Earth body
      const earthGrad = ctx.createRadialGradient(cx - screenR*0.3, cy - screenR*0.3, 0, cx, cy, screenR);
      earthGrad.addColorStop(0, "#4488cc");
      earthGrad.addColorStop(0.3, "#2266aa");
      earthGrad.addColorStop(0.7, "#1a4488");
      earthGrad.addColorStop(1, "#0a2244");
      ctx.fillStyle = earthGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, screenR, 0, TAU);
      ctx.fill();

      // Continent hints
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = "#44aa66";
      const t = Date.now() * 0.0001;
      for (let i = 0; i < 8; i++) {
        const a = t + i * 0.8;
        const px = cx + Math.cos(a) * screenR * 0.5;
        const py = cy + Math.sin(a * 1.3) * screenR * 0.4;
        ctx.beginPath();
        ctx.arc(px, py, screenR * (0.1 + Math.sin(i) * 0.08), 0, TAU);
        ctx.fill();
      }
      ctx.restore();

      // Atmosphere rim
      ctx.strokeStyle = "rgba(100,180,255,0.3)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, screenR + 2, 0, TAU);
      ctx.stroke();

      return { cx, cy, screenR, cz };
    }

    // Draw orbit path
    function drawOrbit(w, h, earthR) {
      const orbitR = 3.5;
      ctx.strokeStyle = "rgba(0,240,255,0.12)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const a = (i / 120) * TAU;
        const ox = Math.cos(a) * orbitR;
        const oz = Math.sin(a) * orbitR;
        const p = project(applyCamera([ox, 0, oz]), w, h);
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw satellite
    function drawSatellite(w, h, angle) {
      const { yaw: sy, pitch: sp, roll: sr } = stateRef.current;
      const yawRad = sy * PI / 180;
      const pitchRad = sp * PI / 180;
      const rollRad = sr * PI / 180;

      const orbitR = 3.5;
      const satPos = [Math.cos(angle) * orbitR, 0, Math.sin(angle) * orbitR];

      // Orbit frame: velocity dir, radial, normal
      const velDir = normalize([-Math.sin(angle), 0, Math.cos(angle)]);
      const radialDir = normalize([-Math.cos(angle), 0, -Math.sin(angle)]); // toward earth
      const normalDir = [0, 1, 0];

      // Transform a body-frame vector to world frame
      function bodyToWorld(bv) {
        // Apply attitude: roll(X) -> pitch(Y) -> yaw(Z) in body frame
        let v = bv;
        v = rotX(v, rollRad);
        v = rotY(v, pitchRad);  
        v = rotZ(v, yawRad);

        // Then orient to orbit frame (velocity=X, normal=Y, -radial=Z for nadir pointing)
        return [
          v[0]*velDir[0] + v[1]*normalDir[0] + v[2]*(-radialDir[0]),
          v[0]*velDir[1] + v[1]*normalDir[1] + v[2]*(-radialDir[1]),
          v[0]*velDir[2] + v[1]*normalDir[2] + v[2]*(-radialDir[2]),
        ];
      }

      function toScreen(bodyPt, scale = 1) {
        const wp = bodyToWorld(bodyPt.map(c => c * scale));
        const world = [satPos[0]+wp[0], satPos[1]+wp[1], satPos[2]+wp[2]];
        return project(applyCamera(world), w, h);
      }

      const S = 0.18; // satellite scale

      // --- Draw satellite body (box) ---
      const bodyVerts = [
        [-1,-0.6,-0.7], [1,-0.6,-0.7], [1,0.6,-0.7], [-1,0.6,-0.7],
        [-1,-0.6,0.7], [1,-0.6,0.7], [1,0.6,0.7], [-1,0.6,0.7],
      ];
      const faces = [
        { verts: [0,1,2,3], color: "rgba(0,180,200,0.8)", label: null },
        { verts: [4,5,6,7], color: "rgba(0,200,220,0.9)", label: null },
        { verts: [0,1,5,4], color: "rgba(0,160,180,0.7)", label: null },
        { verts: [2,3,7,6], color: "rgba(0,190,210,0.85)", label: null },
        { verts: [0,3,7,4], color: "rgba(0,170,190,0.75)", label: null },
        { verts: [1,2,6,5], color: "rgba(0,170,190,0.75)", label: null },
      ];

      const projVerts = bodyVerts.map(v => toScreen(v, S));

      // Sort faces by depth
      const facesWithDepth = faces.map(f => {
        const avgZ = f.verts.reduce((s, vi) => s + projVerts[vi][2], 0) / f.verts.length;
        return { ...f, avgZ };
      });
      facesWithDepth.sort((a, b) => a.avgZ - b.avgZ);

      facesWithDepth.forEach(f => {
        ctx.fillStyle = f.color;
        ctx.strokeStyle = "rgba(0,240,255,0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        f.verts.forEach((vi, i) => {
          if (i === 0) ctx.moveTo(projVerts[vi][0], projVerts[vi][1]);
          else ctx.lineTo(projVerts[vi][0], projVerts[vi][1]);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });

      // --- Solar panels ---
      const panelFaces = [
        // Left panel
        [[-1.2,-0.02,-0.5], [-3.2,-0.02,-0.5], [-3.2,-0.02,0.5], [-1.2,-0.02,0.5]],
        // Right panel
        [[1.2,-0.02,-0.5], [3.2,-0.02,-0.5], [3.2,-0.02,0.5], [1.2,-0.02,0.5]],
      ];
      panelFaces.forEach(pf => {
        const pp = pf.map(v => toScreen(v, S));
        ctx.fillStyle = "rgba(30,70,180,0.7)";
        ctx.strokeStyle = "rgba(60,130,255,0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        pp.forEach((p, i) => i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Cell lines
        ctx.strokeStyle = "rgba(20,50,120,0.6)";
        ctx.lineWidth = 0.5;
        for (let i = 1; i < 4; i++) {
          const t = i / 4;
          const x1 = pp[0][0] + (pp[3][0]-pp[0][0])*t;
          const y1 = pp[0][1] + (pp[3][1]-pp[0][1])*t;
          const x2 = pp[1][0] + (pp[2][0]-pp[1][0])*t;
          const y2 = pp[1][1] + (pp[2][1]-pp[1][1])*t;
          ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
        }
      });

      // Panel arms
      [[-1, 0, 0], [1, 0, 0]].forEach(armDir => {
        const a1 = toScreen([armDir[0]*1, 0, 0], S);
        const a2 = toScreen([armDir[0]*1.2, 0, 0], S);
        ctx.strokeStyle = "#888";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(a2[0], a2[1]); ctx.stroke();
      });

      // --- Payload (camera) pointing nadir ---
      const camP = toScreen([0, 0, 0.7], S);
      const camEnd = toScreen([0, 0, 1.1], S);
      ctx.fillStyle = "rgba(255,107,53,0.8)";
      ctx.beginPath();
      ctx.arc(camP[0], camP[1], 6 * projVerts[0][3], 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,140,80,0.6)";
      ctx.lineWidth = 1;
      ctx.stroke();
      // Lens
      ctx.fillStyle = "rgba(20,30,80,0.9)";
      ctx.beginPath();
      ctx.arc(camEnd[0], camEnd[1], 4 * projVerts[0][3], 0, TAU);
      ctx.fill();

      // --- Thruster flames ---
      const thrusterActive = Math.max(Math.abs(sy), Math.abs(sp), Math.abs(sr)) > 60;
      if (thrusterActive) {
        const thrPos = [[-0.8,-0.5,-0.7],[0.8,-0.5,-0.7],[-0.8,0.5,-0.7],[0.8,0.5,-0.7]];
        thrPos.forEach(tp => {
          const tp1 = toScreen(tp, S);
          const flameSize = 4 + Math.random() * 4;
          const fg = ctx.createRadialGradient(tp1[0], tp1[1], 0, tp1[0], tp1[1], flameSize * projVerts[0][3]);
          fg.addColorStop(0, "rgba(255,200,50,0.8)");
          fg.addColorStop(0.5, "rgba(255,100,0,0.4)");
          fg.addColorStop(1, "transparent");
          ctx.fillStyle = fg;
          ctx.beginPath();
          ctx.arc(tp1[0], tp1[1], flameSize * projVerts[0][3], 0, TAU);
          ctx.fill();
        });
      }

      // --- Body axes arrows ---
      const axisLen = 2.5;
      const axes = [
        { dir: [axisLen, 0, 0], color: "#00ff88", label: "X 滚动" },
        { dir: [0, axisLen, 0], color: "#ff6b35", label: "Y 俯仰" },
        { dir: [0, 0, -axisLen], color: "#00f0ff", label: "Z 偏航" },
      ];
      const origin = toScreen([0, 0, 0], S);
      axes.forEach(ax => {
        const end = toScreen(ax.dir, S);
        // Arrow line
        ctx.strokeStyle = ax.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(origin[0], origin[1]);
        ctx.lineTo(end[0], end[1]);
        ctx.stroke();
        // Arrowhead
        const dx = end[0]-origin[0], dy = end[1]-origin[1];
        const len = Math.sqrt(dx*dx+dy*dy);
        if (len > 10) {
          const ux = dx/len, uy = dy/len;
          ctx.fillStyle = ax.color;
          ctx.beginPath();
          ctx.moveTo(end[0], end[1]);
          ctx.lineTo(end[0]-ux*8+uy*4, end[1]-uy*8-ux*4);
          ctx.lineTo(end[0]-ux*8-uy*4, end[1]-uy*8+ux*4);
          ctx.closePath();
          ctx.fill();
        }
        // Label
        ctx.globalAlpha = 0.8;
        ctx.font = "bold 11px 'JetBrains Mono', monospace";
        ctx.fillStyle = ax.color;
        ctx.fillText(ax.label, end[0]+6, end[1]-4);
        ctx.globalAlpha = 1;
      });

      // --- Velocity direction indicator ---
      const velEnd = toScreen([5, 0, 0], S);
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(origin[0], origin[1]);
      ctx.lineTo(velEnd[0], velEnd[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillText("→ 飞行方向", velEnd[0]+4, velEnd[1]);

      // Nadir indicator
      const nadirEnd = toScreen([0, 0, 4], S);
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(origin[0], origin[1]);
      ctx.lineTo(nadirEnd[0], nadirEnd[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillText("↓ 对地(天底)", nadirEnd[0]+4, nadirEnd[1]);

      return { projVerts, satPos };
    }

    // Stars
    const stars = Array.from({length: 200}, () => ({
      x: (Math.random()-0.5)*20,
      y: (Math.random()-0.5)*20,
      z: (Math.random()-0.5)*20,
      s: 0.3 + Math.random()*1.2,
      b: 0.3 + Math.random()*0.7,
    }));

    function drawStars(w, h) {
      stars.forEach(st => {
        const p = project(applyCamera([st.x, st.y, st.z]), w, h);
        if (p[2] > 0) {
          ctx.globalAlpha = st.b * 0.6;
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(p[0], p[1], st.s * p[3] * 0.5, 0, TAU);
          ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
    }

    function draw() {
      const { paused: isPaused, orbitSpeed: spd } = stateRef.current;
      if (!isPaused) {
        orbitAngle += 0.003 * spd;
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // BG gradient
      const bg = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w*0.6);
      bg.addColorStop(0, "#0f172a");
      bg.addColorStop(1, "#050810");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      drawStars(w, h);
      drawOrbit(w, h);
      drawEarth(w, h);
      drawSatellite(w, h, orbitAngle);

      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const yawAbs = Math.abs(yaw);
  const pitchAbs = Math.abs(pitch);
  const rollAbs = Math.abs(roll);
  const maxAngle = Math.max(yawAbs, pitchAbs, rollAbs);
  const thrusterActive = maxAngle > 60;

  const reset = () => { setYaw(0); setPitch(0); setRoll(0); };
  const setPreset = (y, p, r) => { setYaw(y); setPitch(p); setRoll(r); };

  return (
    <div style={{
      width: "100vw", height: "100vh",
      background: "#050810", color: "#e2e8f0",
      fontFamily: "system-ui, -apple-system, sans-serif",
      display: "grid",
      gridTemplateColumns: "290px 1fr 250px",
      gridTemplateRows: "48px 1fr",
      overflow: "hidden",
    }}>
      <style>{`
        @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(-3px)} to{opacity:1;transform:translateY(0)} }
        input[type="range"] { -webkit-appearance:none; appearance:none; width:100%; height:4px; border-radius:2px; outline:none; cursor:pointer; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px; border-radius:50%; cursor:grab; border:none; }
        .preset-btn { width:100%; padding:7px 10px; border:1px solid rgba(255,255,255,0.06); background:rgba(0,0,0,0.2); color:#64748b; font-size:11px; border-radius:6px; cursor:pointer; text-align:left; transition:all 0.2s; }
        .preset-btn:hover { border-color:rgba(0,240,255,0.3); color:#94a3b8; background:rgba(0,240,255,0.03); }
      `}</style>

      {/* Header */}
      <header style={{
        gridColumn: "1/-1", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px",
        background: "rgba(10,14,26,0.95)", borderBottom: "1px solid rgba(0,240,255,0.1)",
      }}>
        <div style={{ fontWeight: 900, fontSize: "15px", letterSpacing: "3px", color: "#00f0ff", textShadow: "0 0 15px rgba(0,240,255,0.3)", fontFamily: "monospace" }}>
          ◎ SAT-CTRL
        </div>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <button onClick={() => setPaused(!paused)} style={{
            padding: "3px 12px", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.1)",
            background: paused ? "rgba(255,100,50,0.15)" : "rgba(0,255,136,0.1)",
            color: paused ? "#ff6b35" : "#00ff88", fontSize: "10px", cursor: "pointer", fontFamily: "monospace",
          }}>{paused ? "▶ 继续" : "⏸ 暂停"}</button>
          <div style={{ fontSize: "10px", color: "#475569", fontFamily: "monospace", display: "flex", alignItems: "center", gap: "5px" }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#00ff88", animation: "pulse-dot 2s infinite" }} />
            轨道仿真
          </div>
        </div>
      </header>

      {/* Left Panel */}
      <div style={{
        background: "rgba(10,14,26,0.9)", borderRight: "1px solid rgba(0,240,255,0.08)",
        padding: "14px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px",
      }}>
        <SectionLabel>姿态角控制</SectionLabel>
        <AngleSlider label="偏航 Yaw" axis="Z轴" color="#00f0ff" value={yaw} min={-180} max={180} onChange={setYaw} desc="绕天底方向旋转 · 改变侧视角" />
        <AngleSlider label="俯仰 Pitch" axis="Y轴" color="#ff6b35" value={pitch} min={-90} max={90} onChange={setPitch} desc="绕轨道法向旋转 · 改变前后视角" />
        <AngleSlider label="滚动 Roll" axis="X轴" color="#00ff88" value={roll} min={-180} max={180} onChange={setRoll} desc="绕飞行方向旋转 · 改变倾斜角" />

        <button onClick={reset} style={{
          width: "100%", padding: "8px", border: "1px solid rgba(0,240,255,0.12)",
          background: "rgba(0,0,0,0.3)", color: "#94a3b8", fontFamily: "monospace",
          fontSize: "11px", borderRadius: "6px", cursor: "pointer", letterSpacing: "1px",
        }}>⟳ 归零复位</button>

        <SectionLabel>快捷预设</SectionLabel>
        {[
          { l: "侧摆观测 — 偏航30°", a: [30,0,0] },
          { l: "前视成像 — 俯仰-25°", a: [0,-25,0] },
          { l: "倾斜观测 — 滚动45°", a: [0,0,45] },
          { l: "复合机动", a: [15,-10,5] },
          { l: "大角度偏航 — 推力器点火", a: [80,0,0] },
        ].map((p, i) => (
          <button key={i} className="preset-btn" onClick={() => setPreset(...p.a)}>{p.l}</button>
        ))}

        <SectionLabel>轨道速度</SectionLabel>
        <div style={{ display: "flex", gap: "6px" }}>
          {[0.5, 1, 2, 4].map(s => (
            <button key={s} onClick={() => setOrbitSpeed(s)} style={{
              flex: 1, padding: "5px", borderRadius: "4px", cursor: "pointer", fontSize: "10px", fontFamily: "monospace",
              border: `1px solid ${orbitSpeed === s ? "rgba(0,240,255,0.4)" : "rgba(255,255,255,0.06)"}`,
              background: orbitSpeed === s ? "rgba(0,240,255,0.08)" : "rgba(0,0,0,0.2)",
              color: orbitSpeed === s ? "#00f0ff" : "#475569",
            }}>{s}x</button>
          ))}
        </div>
      </div>

      {/* Viewport */}
      <div style={{ position: "relative", overflow: "hidden" }}>
        <canvas ref={canvasRef} style={{ display: "block", cursor: "grab" }} />
        <div style={{
          position: "absolute", bottom: 10, left: 12,
          fontSize: "9px", color: "#334155", fontFamily: "monospace", lineHeight: 1.8,
        }}>
          拖拽旋转视角 · 箭头=卫星体轴方向
        </div>
        <div style={{
          position: "absolute", top: 10, left: 12,
          fontSize: "10px", color: "#475569", fontFamily: "monospace", lineHeight: 1.6,
        }}>
          <span style={{ color: "#00ff88" }}>━</span> X 滚动轴（飞行方向）<br/>
          <span style={{ color: "#ff6b35" }}>━</span> Y 俯仰轴（轨道法向）<br/>
          <span style={{ color: "#00f0ff" }}>━</span> Z 偏航轴（天底方向）
        </div>
      </div>

      {/* Right Panel */}
      <div style={{
        background: "rgba(10,14,26,0.9)", borderLeft: "1px solid rgba(0,240,255,0.08)",
        padding: "14px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px",
      }}>
        <SectionLabel>执行机构状态</SectionLabel>
        <ComponentCard name="反作用轮 Z" color="#00f0ff" active={yawAbs > 0.5}
          desc="控制偏航 · 改变侧视方向" pct={yawAbs/180*100}
          torque={`${(yawAbs/180*0.5).toFixed(2)} Nm`} speed={`${Math.round(yawAbs/180*6000)} RPM`} />
        <ComponentCard name="反作用轮 Y" color="#ff6b35" active={pitchAbs > 0.5}
          desc="控制俯仰 · 调整前后观测角" pct={pitchAbs/90*100}
          torque={`${(pitchAbs/90*0.5).toFixed(2)} Nm`} speed={`${Math.round(pitchAbs/90*6000)} RPM`} />
        <ComponentCard name="反作用轮 X" color="#00ff88" active={rollAbs > 0.5}
          desc="控制滚动 · 绕飞行方向旋转" pct={rollAbs/180*100}
          torque={`${(rollAbs/180*0.5).toFixed(2)} Nm`} speed={`${Math.round(rollAbs/180*6000)} RPM`} />
        <ComponentCard name="推力器组" color="#fbbf24" active={thrusterActive}
          desc="大角度(>60°)时辅助姿态调整" pct={thrusterActive ? (maxAngle-60)/120*100 : 0}
          torque={thrusterActive ? `${((maxAngle-60)/120*22).toFixed(1)} N` : "0 N"} speed={thrusterActive ? "脉冲模式" : "未启用"} />

        <SectionLabel>姿态说明</SectionLabel>
        <div style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.9 }}>
          <strong style={{ color: "#00f0ff" }}>偏航</strong>：绕天底轴旋转，像人站着原地转身<br/>
          <strong style={{ color: "#ff6b35" }}>俯仰</strong>：绕侧向轴旋转，像人抬头低头<br/>
          <strong style={{ color: "#00ff88" }}>滚动</strong>：绕前进轴旋转，像飞机侧翻
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: "10px", fontWeight: 700, letterSpacing: "2px",
      color: "#334155", textTransform: "uppercase",
      paddingBottom: "6px", borderBottom: "1px solid rgba(255,255,255,0.04)",
      fontFamily: "monospace",
    }}>{children}</div>
  );
}

function AngleSlider({ label, axis, color, value, min, max, onChange, desc }) {
  const isActive = Math.abs(value) > 0.5;
  return (
    <div style={{
      background: "rgba(0,0,0,0.25)",
      border: `1px solid ${isActive ? color+"44" : "rgba(255,255,255,0.04)"}`,
      borderRadius: "8px", padding: "12px 14px", transition: "border-color 0.3s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
          <span style={{
            fontSize: "9px", padding: "1px 5px", borderRadius: "3px",
            background: color+"1a", color, fontFamily: "monospace", fontWeight: 600,
          }}>{axis}</span>
          <span style={{ fontSize: "12px", fontWeight: 600 }}>{label}</span>
        </div>
        <span style={{ fontFamily: "monospace", fontSize: "18px", fontWeight: 600, color, letterSpacing: "-1px" }}>
          {value.toFixed(1)}<span style={{ fontSize: "10px", color: "#334155" }}>{DEG}</span>
        </span>
      </div>
      <input type="range" min={min} max={max} step="0.5" value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ background: `linear-gradient(90deg, ${color}08, ${color}44)`, color }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "3px" }}>
        <span style={{ fontSize: "8px", color: "#334155", fontFamily: "monospace" }}>{min}{DEG}</span>
        <span style={{ fontSize: "9px", color: "#475569" }}>{desc}</span>
        <span style={{ fontSize: "8px", color: "#334155", fontFamily: "monospace" }}>+{max}{DEG}</span>
      </div>
    </div>
  );
}

function ComponentCard({ name, color, active, desc, pct, torque, speed }) {
  return (
    <div style={{
      background: active ? "rgba(0,240,255,0.02)" : "rgba(0,0,0,0.2)",
      border: `1px solid ${active ? color+"33" : "rgba(255,255,255,0.04)"}`,
      borderRadius: "8px", padding: "10px 12px",
      borderLeft: `3px solid ${active ? color : "#222"}`,
      transition: "all 0.3s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "12px", fontWeight: 700 }}>{name}</span>
        <span style={{
          fontSize: "9px", padding: "1px 7px", borderRadius: "8px", fontFamily: "monospace",
          background: active ? "rgba(0,255,136,0.12)" : "rgba(50,50,50,0.5)",
          color: active ? "#00ff88" : "#334155",
        }}>{active ? "工作中" : "待机"}</span>
      </div>
      <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>{desc}</div>
      {active && (
        <div style={{
          marginTop: "6px", paddingTop: "6px", borderTop: "1px solid rgba(255,255,255,0.04)",
          fontFamily: "monospace", fontSize: "10px", animation: "fadeIn 0.3s",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#334155" }}>力矩</span><span style={{ color }}>{torque}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#334155" }}>状态</span><span style={{ color }}>{speed}</span>
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "6px" }}>
        <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.03)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(100,pct)}%`, background: color, borderRadius: 2, transition: "width 0.3s" }} />
        </div>
        <span style={{ fontSize: "8px", color: "#334155", fontFamily: "monospace", minWidth: 24, textAlign: "right" }}>{Math.round(Math.min(100,pct))}%</span>
      </div>
    </div>
  );
}
