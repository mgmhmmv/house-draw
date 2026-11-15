# ArchStudio BIM — AI-Assisted 2D/3D Building CAD, Engineering Drawing Set & BOQ

An interactive, web-deployable architectural & structural engineering CAD/BIM studio built with **React 18**, **TypeScript**, **Three.js**, **Tailwind CSS**, and a custom **Vector CAD + Parametric BIM + BOQ Engine**.

## Capabilities

- **2D Precision CAD & Floor Plan (`A-101`)**: Parametric walls with thicknesses, doors with swing arcs, glazed windows, room area & finish tags, furniture, structural grid bubbles, overall dimensions, and interactive drawing/measuring tools.
- **AI Hand-Drawing Sketch Pad**: Draw freehand walls, doors, and windows (or upload a hand-sketch / plan image underlay) and convert strokes into orthogonal snapped BIM geometry via Douglas-Peucker simplification & corner welding.
- **AI Prompt-Derived House Generator & Mutator**: Create full single/multi-story buildings from natural-language prompts or apply live incremental changes (e.g., *"Add a 4x3.5m study room on the east side"*, *"Change roof to hip roof 28 deg"*, *"Make exterior walls 250mm thick"*, *"Add a second floor"*). Works 100% offline with an optional Gemini API connector.
- **Interactive 3D Three.js Viewport (`3D`)**: Real-time 3D building with window/door cutouts, roof geometries (Gable, Hip, Flat Parapet, Shed), PBR Render, White Clay Maquette, Structural & MEP X-Ray mode, Wireframe mode, interactive 3D section cutaway height slider, and solar shadow simulation.
- **Full Engineering Drawing Set**:
  - `A-201`: 4-Way Orthographic Exterior Elevations (North, South, East, West)
  - `A-301`: Architectural & Foundation Cross-Section with interactive cut-plane slider
  - `S-101`: Foundation Pad Footings, Plinth Beams, Columns & 2-Way Slab Framing Plan
  - `M-101`: MEP Floor Plan Overlay (Lighting, Power, HVAC, Cold/Drain Piping)
  - `E-101`: IEC Electrical Single-Line Diagram (SLD) & Circuit Load Schedule
  - `P-101`: Plumbing Water Supply & Sanitary Drainage Riser Schematic
  - `Q-101`: Live Bill of Quantities (BOQ), Raw Civil Material Take-Off & Editable Unit Rates
- **Engineering Exports**: AutoCAD `.DXF` (R12/2000 layers), Vector `.SVG`, `.CSV` BOQ, `.JSON` BIM Save/Load, and Print/PDF Drawing Binder (`A-000`).

## Local Development & Deployment

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Web Deployment (Static Bundle)

This app requires zero backend services to run core CAD, 3D, Schematics, Sketch Conversion, and BOQ features:

```bash
npm run build
```

Deploy the generated `dist/` folder directly to **Vercel**, **Netlify**, **Cloudflare Pages**, **GitHub Pages**, or any static web server / CDN.
