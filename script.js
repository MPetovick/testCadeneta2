// Utilidades
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
};

// Constantes
const STITCH_TYPES = new Map([
    ['cadeneta', { symbol: '#', color: '#e74c3c', desc: 'Cadena base' }],
    ['punt_baix', { symbol: '•', color: '#2ecc71', desc: 'Punto bajo' }],
    ['punt_pla', { symbol: '-', color: '#3498db', desc: 'Punto plano' }],
    ['punt_mitja', { symbol: '●', color: '#f1c40f', desc: 'Punto medio' }],
    ['punt_alt', { symbol: '↑', color: '#9b59b6', desc: 'Punto alto' }],
    ['punt_doble_alt', { symbol: '⇑', color: '#e67e22', desc: 'Punto doble alto' }],
    ['picot', { symbol: '¤', color: '#1abc9c', desc: 'Picot decorativo' }]
]);

const DEFAULT_STATE = {
    rings: [{ segments: 8, points: Array(8).fill('cadeneta') }],
    history: [],
    historyIndex: 0,
    scale: 1,
    targetScale: 1,
    offset: { x: 0, y: 0 },
    targetOffset: { x: 0, y: 0 },
    selectedStitch: 'punt_baix',
    guideLines: 8,
    ringSpacing: 50,
    isDragging: false,
    lastPos: { x: 0, y: 0 },
    pinchDistance: null
};

// Clase para manejar el estado del patrón
class PatternState {
    constructor() {
        this.state = structuredClone(DEFAULT_STATE);
        this.state.history = [this.cloneRings()];
    }

    reset() {
        this.state = structuredClone(DEFAULT_STATE);
        this.state.rings[0].points = Array(this.state.guideLines).fill('cadeneta');
        this.state.history = [this.cloneRings()];
        this.state.historyIndex = 0;
    }

    saveState() {
        if (this.state.historyIndex < this.state.history.length - 1) {
            this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
        }
        this.state.history.push(this.cloneRings());
        this.state.historyIndex++;
        this.state.history = this.state.history.slice(-100);
    }

    undo() {
        if (this.state.historyIndex <= 0) return false;
        this.state.historyIndex--;
        this.state.rings = this.cloneRings(this.state.history[this.state.historyIndex]);
        return true;
    }

    redo() {
        if (this.state.historyIndex >= this.state.history.length - 1) return false;
        this.state.historyIndex++;
        this.state.rings = this.cloneRings(this.state.history[this.state.historyIndex]);
        return true;
    }

    cloneRings(rings = this.state.rings) {
        return structuredClone(rings);
    }

    setRings(rings) {
        this.state.rings = this.cloneRings(rings);
        this.state.history = [this.cloneRings()];
        this.state.historyIndex = 0;
    }

    updateGuideLines(value) {
        this.state.guideLines = clamp(value, 4, 24);
        this.state.rings[0].segments = this.state.guideLines;
        this.state.rings[0].points = Array(this.state.guideLines).fill('cadeneta');
    }

    updateRingSpacing(value) {
        this.state.ringSpacing = clamp(value, 30, 80);
    }

    addRing() {
        const lastRing = this.state.rings.at(-1);
        if (!lastRing) throw new Error('No rings available');
        this.state.rings.push({
            segments: lastRing.segments,
            points: Array(lastRing.segments).fill('cadeneta')
        });
        this.saveState();
    }

    increasePoints(ringIndex, segmentIndex, stitch) {
        const nextRingIndex = ringIndex + 1;
        const currentRing = this.state.rings[ringIndex];
        if (nextRingIndex >= this.state.rings.length) {
            this.state.rings.push({
                segments: currentRing.segments * 2,
                points: Array(currentRing.segments * 2).fill(stitch)
            });
        } else {
            const nextRing = this.state.rings[nextRingIndex];
            const newPoints = nextRing.points.flatMap((point, idx) =>
                idx === segmentIndex ? [point, `${stitch}_increase`] : point
            );
            nextRing.segments = newPoints.length;
            nextRing.points = newPoints;
        }
        this.saveState();
    }

    decreasePoints(ringIndex, segmentIndex, stitch) {
        const nextRingIndex = ringIndex + 1;
        if (nextRingIndex >= this.state.rings.length || this.state.rings[nextRingIndex].segments <= this.state.guideLines) return;
        const nextRing = this.state.rings[nextRingIndex];
        if (nextRing.segments % 2 !== 0) return;
        nextRing.points = nextRing.points.reduce((acc, point, i) => {
            if (i % 2 === 0) acc.push(i === segmentIndex ? `${stitch}_decrease` : point);
            return acc;
        }, []);
        nextRing.segments = nextRing.points.length;
        this.saveState();
    }
}

// Clase para renderizar en el canvas
class CanvasRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.resize();
    }

    resize() {
        const { clientWidth: w, clientHeight: h } = this.canvas.parentElement;
        this.canvas.width = w;
        this.canvas.height = h;
    }

    render(state, mouseX = null, mouseY = null) {
        requestAnimationFrame(() => {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.updateTransform(state);
            this.applyTransform(state);
            this.drawRings(state);
            this.drawStitches(state);
            if (mouseX !== null && mouseY !== null) this.drawHoverEffect(state, mouseX, mouseY);
            this.ctx.restore();
        });
    }

    updateTransform(state) {
        state.offset.x += (state.targetOffset.x - state.offset.x) * 0.1;
        state.offset.y += (state.targetOffset.y - state.offset.y) * 0.1;
        state.scale += (state.targetScale - state.scale) * 0.1;
    }

    applyTransform(state) {
        this.ctx.save();
        this.ctx.translate(this.canvas.width / 2 + state.offset.x, this.canvas.height / 2 + state.offset.y);
        this.ctx.scale(state.scale, state.scale);
    }

    drawRings(state) {
        this.ctx.strokeStyle = '#ddd';
        this.ctx.lineWidth = 1 / state.scale;
        state.rings.forEach((_, r) => {
            const radius = (r + 1) * state.ringSpacing;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
            this.ctx.stroke();
        });
        this.drawGuideLines(state);
    }

    drawGuideLines(state) {
        const segments = state.guideLines;
        const angleStep = Math.PI * 2 / segments;
        const maxRadius = state.rings.length * state.ringSpacing;
        this.ctx.strokeStyle = '#eee';
        this.ctx.beginPath();
        for (let i = 0; i < segments; i++) {
            const angle = i * angleStep;
            const x = Math.cos(angle) * maxRadius;
            const y = Math.sin(angle) * maxRadius;
            this.ctx.moveTo(0, 0);
            this.ctx.lineTo(x, y);
        }
        this.ctx.stroke();
    }

    drawStitches(state) {
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.font = `${20 / state.scale}px Arial`;
        state.rings.forEach((ring, ringIndex) => {
            const segments = ring.segments;
            const angleStep = Math.PI * 2 / segments;
            const radius = (ringIndex + 0.5) * state.ringSpacing;
            ring.points.forEach((type, segmentIndex) => {
                const angle = segmentIndex * angleStep + (angleStep / 2);
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                let stitchType = type;
                let isSpecial = false;
                let symbol = STITCH_TYPES.get(stitchType).symbol;

                if (type.includes('_increase')) {
                    stitchType = type.replace('_increase', '');
                    isSpecial = true;
                    symbol = '▿';
                } else if (type.includes('_decrease')) {
                    stitchType = type.replace('_decrease', '');
                    isSpecial = true;
                    symbol = '▵';
                }

                this.ctx.fillStyle = STITCH_TYPES.get(stitchType).color;
                this.ctx.fillText(symbol, x, y);

                if (isSpecial) {
                    this.ctx.beginPath();
                    this.ctx.arc(x, y, 5 / state.scale, 0, Math.PI * 2);
                    this.ctx.strokeStyle = '#ff0000';
                    this.ctx.lineWidth = 1 / state.scale;
                    this.ctx.stroke();
                }
            });
        });
    }

    drawHoverEffect(state, mouseX, mouseY) {
        const { ring, segment } = this.getRingAndSegment(state, mouseX, mouseY);
        if (ring >= 0 && ring < state.rings.length) {
            const segments = state.rings[ring].segments;
            const angleStep = Math.PI * 2 / segments;
            const radius = (ring + 0.5) * state.ringSpacing;
            const angle = segment * angleStep + (angleStep / 2);
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            const stitch = STITCH_TYPES.get(state.selectedStitch);
            this.ctx.fillStyle = stitch.color + '80';
            this.ctx.fillText(stitch.symbol, x, y);
        }
    }

    getRingAndSegment(state, x, y) {
        const distance = Math.sqrt(x * x + y * y);
        const ring = Math.floor(distance / state.ringSpacing);
        if (ring < 0 || ring >= state.rings.length) return { ring: -1, segment: -1 };
        const segments = state.rings[ring].segments;
        const angle = Math.atan2(y, x) + Math.PI * 2;
        const segment = Math.floor((angle / (Math.PI * 2)) * segments) % segments;
        return { ring, segment };
    }

    exportAsImage(state, projectName) {
        const exportCanvas = document.createElement('canvas');
        const exportCtx = exportCanvas.getContext('2d');
        const maxRadius = state.rings.length * state.ringSpacing;
        const padding = 100;
        const canvasSize = Math.max(800, (maxRadius * 2) + padding * 2);

        exportCanvas.width = canvasSize;
        exportCanvas.height = canvasSize + 200;
        exportCtx.fillStyle = '#ffffff';
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

        exportCtx.save();
        exportCtx.translate(canvasSize / 2, canvasSize / 2);
        this.drawRingsOnContext(exportCtx, state, 1);
        this.drawStitchesOnContext(exportCtx, state, 1);
        exportCtx.restore();

        this.drawLegendOnCanvas(exportCtx, padding, canvasSize + 20);

        const dataUrl = exportCanvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `${projectName || 'patron_crochet'}.png`;
        link.href = dataUrl;
        link.click();
    }

    drawRingsOnContext(ctx, state, scale) {
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1 / scale;
        state.rings.forEach((_, r) => {
            const radius = (r + 1) * state.ringSpacing;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.stroke();
        });
        this.drawGuideLinesOnContext(ctx, state, scale);
    }

    drawGuideLinesOnContext(ctx, state, scale) {
        const segments = state.guideLines;
        const angleStep = Math.PI * 2 / segments;
        const maxRadius = state.rings.length * state.ringSpacing;
        ctx.strokeStyle = '#eee';
        ctx.beginPath();
        for (let i = 0; i < segments; i++) {
            const angle = i * angleStep;
            const x = Math.cos(angle) * maxRadius;
            const y = Math.sin(angle) * maxRadius;
            ctx.moveTo(0, 0);
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    drawStitchesOnContext(ctx, state, scale) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${20 / scale}px Arial`;
        state.rings.forEach((ring, ringIndex) => {
            const segments = ring.segments;
            const angleStep = Math.PI * 2 / segments;
            const radius = (ringIndex + 0.5) * state.ringSpacing;
            ring.points.forEach((type, segmentIndex) => {
                const angle = segmentIndex * angleStep + (angleStep / 2);
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                let stitchType = type;
                let isSpecial = false;
                let symbol = STITCH_TYPES.get(stitchType).symbol;

                if (type.includes('_increase')) {
                    stitchType = type.replace('_increase', '');
                    isSpecial = true;
                    symbol = '▿';
                } else if (type.includes('_decrease')) {
                    stitchType = type.replace('_decrease', '');
                    isSpecial = true;
                    symbol = '▵';
                }

                ctx.fillStyle = STITCH_TYPES.get(stitchType).color;
                ctx.fillText(symbol, x, y);

                if (isSpecial) {
                    ctx.beginPath();
                    ctx.arc(x, y, 5 / scale, 0, Math.PI * 2);
                    ctx.strokeStyle = '#ff0000';
                    ctx.lineWidth = 1 / scale;
                    ctx.stroke();
                }
            });
        });
    }

    drawLegendOnCanvas(ctx, x, y) {
        ctx.font = '16px Arial';
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'left';
        ctx.fillText('Leyenda de puntadas:', x, y);
        y += 20;
        for (const [, stitch] of STITCH_TYPES) {
            ctx.fillStyle = stitch.color;
            ctx.fillText(`${stitch.symbol} - ${stitch.desc}`, x, y);
            y += 20;
        }
        ctx.fillStyle = '#000000';
        ctx.fillText('▿ - Aumento', x, y);
        y += 20;
        ctx.fillText('▵ - Disminución', x, y);
    }
}

// Clase para manejar entradas del usuario
class InputHandler {
    constructor(canvas, state, renderer) {
        this.canvas = canvas;
        this.state = state;
        this.renderer = renderer;
        this.setupListeners();
    }

    setupListeners() {
        const eventMap = [
            ['click', this.handleClick],
            ['mousemove', this.handleMouseMove],
            ['wheel', this.handleWheel, { passive: false }],
            ['mousedown', this.startDrag],
            ['touchstart', this.handleTouchStart, { passive: false }],
            ['touchmove', debounce(this.handleTouchMove, 16), { passive: false }],
            ['touchend', this.handleTouchEnd]
        ];
        eventMap.forEach(([ev, fn, opts]) => this.canvas.addEventListener(ev, fn.bind(this), opts));
        document.addEventListener('mousemove', debounce(this.handleDrag.bind(this), 16));
        document.addEventListener('mouseup', this.endDrag.bind(this));
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        window.addEventListener('resize', this.renderer.resize.bind(this.renderer));
    }

    handleClick(e) {
        const { x, y } = this.getCanvasCoordinates(e);
        const { ring, segment } = this.renderer.getRingAndSegment(this.state.state, x, y);
        if (ring >= 0 && ring < this.state.state.rings.length) {
            if (e.shiftKey) {
                this.state.increasePoints(ring, segment, this.state.state.selectedStitch);
            } else if (e.ctrlKey) {
                this.state.decreasePoints(ring, segment, this.state.state.selectedStitch);
            } else {
                this.state.state.rings[ring].points[segment] = this.state.state.selectedStitch;
            }
            this.state.saveState();
            this.renderer.render(this.state.state);
        }
    }

    handleMouseMove(e) {
        const { x, y } = this.getCanvasCoordinates(e);
        this.renderer.render(this.state.state, x, y);
    }

    handleWheel(e) {
        e.preventDefault();
        this.adjustZoom(e.deltaY > 0 ? -0.1 : 0.1);
    }

    startDrag(e) {
        this.state.state.isDragging = true;
        this.state.state.lastPos = { x: e.clientX, y: e.clientY };
    }

    handleDrag(e) {
        if (!this.state.state.isDragging) return;
        const deltaX = e.clientX - this.state.state.lastPos.x;
        const deltaY = e.clientY - this.state.state.lastPos.y;
        this.state.state.targetOffset.x += deltaX;
        this.state.state.targetOffset.y += deltaY;
        this.state.state.lastPos = { x: e.clientX, y: e.clientY };
        this.animate();
    }

    endDrag() {
        this.state.state.isDragging = false;
        this.state.state.offset.x = this.state.state.targetOffset.x;
        this.state.state.offset.y = this.state.state.targetOffset.y;
    }

    handleTouchStart(e) {
        e.preventDefault();
        const touches = e.touches;
        if (touches.length === 1) this.startDrag(touches[0]);
        else if (touches.length === 2) {
            this.state.state.pinchDistance = this.getPinchDistance(touches);
            this.state.state.isDragging = false;
        }
    }

    handleTouchMove(e) {
        e.preventDefault();
        const touches = e.touches;
        if (touches.length === 1 && this.state.state.isDragging) this.handleDrag(touches[0]);
        else if (touches.length === 2) {
            const newDistance = this.getPinchDistance(touches);
            if (this.state.state.pinchDistance) this.adjustZoom((newDistance - this.state.state.pinchDistance) * 0.005);
            this.state.state.pinchDistance = newDistance;
        }
    }

    handleTouchEnd(e) {
        if (e.touches.length === 0) {
            this.endDrag();
            this.state.state.pinchDistance = null;
        }
    }

    getPinchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    getCanvasCoordinates(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - this.state.state.offset.x - this.canvas.width / 2) / this.state.state.scale,
            y: (e.clientY - rect.top - this.state.state.offset.y - this.canvas.height / 2) / this.state.state.scale
        };
    }

    handleKeyDown(e) {
        if (e.ctrlKey) {
            if (e.key === 'z' && this.state.undo()) this.renderer.render(this.state.state);
            else if (e.key === 'y' && this.state.redo()) this.renderer.render(this.state.state);
            else if (e.key === 's') e.preventDefault();
        } else if (e.key === '+') this.adjustZoom(0.2);
        else if (e.key === '-') this.adjustZoom(-0.2);
    }

    adjustZoom(amount) {
        this.state.state.targetScale = clamp(this.state.state.targetScale + amount, 0.3, 3);
        this.animate();
    }

    resetView() {
        this.state.state.targetScale = 1;
        this.state.state.targetOffset = { x: 0, y: 0 };
        this.state.state.offset = { x: 0, y: 0 };
        this.animate();
    }

    animate() {
        this.renderer.render(this.state.state);
        if (this.needsAnimation()) requestAnimationFrame(this.animate.bind(this));
    }

    needsAnimation() {
        return (
            Math.abs(this.state.state.scale - this.state.state.targetScale) > 0.01 ||
            Math.abs(this.state.state.offset.x - this.state.state.targetOffset.x) > 1 ||
            Math.abs(this.state.state.offset.y - this.state.state.targetOffset.y) > 1
        );
    }
}

// Clase para la interfaz de usuario
class UIController {
    constructor(state, renderer, inputHandler) { // Añadimos inputHandler como parámetro
        this.state = state;
        this.renderer = renderer;
        this.inputHandler = inputHandler; // Usamos la instancia existente
        this.currentProjectName = null;
        this.tooltip = null;
        this.setupListeners();
        this.setupStitchPalette();
        this.updateRingCounter();
    }

    setupListeners() {
        const buttons = [
            { id: 'newBtn', fn: this.newProject.bind(this) },
            { id: 'saveBtn', fn: this.saveProject.bind(this) },
            { id: 'saveAsBtn', fn: this.saveProjectAs.bind(this) },
            { id: 'undoBtn', fn: () => this.state.undo() && this.renderer.render(this.state.state) },
            { id: 'redoBtn', fn: () => this.state.redo() && this.renderer.render(this.state.state) },
            { id: 'zoomIn', fn: () => this.inputHandler.adjustZoom(0.2) }, // Usamos la instancia existente
            { id: 'zoomOut', fn: () => this.inputHandler.adjustZoom(-0.2) },
            { id: 'resetView', fn: () => this.inputHandler.resetView() },
            { id: 'stitchHelpBtn', fn: this.toggleStitchTooltip.bind(this) },
            { id: 'exportTxt', fn: this.exportAsText.bind(this) },
            { id: 'exportPng', fn: this.exportAsImage.bind(this) },
            { id: 'exportPdf', fn: this.generatePDF.bind(this) },
            { id: 'addRingBtn', fn: () => { this.state.addRing(); this.updateRingCounter(); this.renderer.render(this.state.state); } }
        ];

        buttons.forEach(({ id, fn }) => {
            const btn = document.getElementById(id);
            if (btn) btn.addEventListener('click', fn);
        });

        const guideLines = document.getElementById('guideLines');
        if (guideLines) {
            guideLines.addEventListener('input', () => {
                const value = parseInt(guideLines.value);
                this.state.updateGuideLines(value);
                document.getElementById('guideLinesValue').textContent = value;
                this.renderer.render(this.state.state);
            });
        }

        const ringSpacing = document.getElementById('ringSpacing');
        if (ringSpacing) {
            ringSpacing.addEventListener('input', () => {
                const value = parseInt(ringSpacing.value);
                this.state.updateRingSpacing(value);
                document.getElementById('ringSpacingValue').textContent = `${value}px`;
                this.renderer.render(this.state.state);
            });
        }
    }

    newProject() {
        this.state.reset();
        this.currentProjectName = null;
        this.renderer.render(this.state.state);
        this.updateUI();
        this.updateRingCounter();
    }

    saveProject() {
        const defaultName = `Patrón ${new Date().toLocaleDateString()}`;
        this.currentProjectName = this.currentProjectName || defaultName;
        const projects = this.getProjects();
        projects[this.currentProjectName] = this.state.state.rings;
        localStorage.setItem('crochetProjects', JSON.stringify(projects));
        this.loadProjects();
        alert(`Proyecto "${this.currentProjectName}" guardado!`);
    }

    saveProjectAs() {
        const suggestedName = this.currentProjectName || `Patrón ${new Date().toLocaleDateString()}`;
        const name = prompt('Nombre del proyecto:', suggestedName);
        if (name) {
            this.currentProjectName = name;
            const projects = this.getProjects();
            projects[name] = this.state.state.rings;
            localStorage.setItem('crochetProjects', JSON.stringify(projects));
            this.loadProjects();
            alert(`Proyecto "${name}" guardado!`);
        }
    }

    loadFromLocalStorage() {
        const saved = localStorage.getItem('crochetPattern');
        if (saved) {
            this.state.setRings(JSON.parse(saved));
            this.currentProjectName = null;
            this.renderer.resize();
            this.renderer.render(this.state.state);
            this.updateUI();
        }
    }

    getProjects() {
        return JSON.parse(localStorage.getItem('crochetProjects') || '{}');
    }

    loadProjects() {
        const projects = this.getProjects();
        const select = document.getElementById('loadProjects');
        const controls = select.parentElement;
        const existingDeleteBtn = controls.querySelector('.delete-btn');
        if (existingDeleteBtn) existingDeleteBtn.remove();

        select.innerHTML = '<option value="">Cargar...</option>' +
            Object.keys(projects).map(name =>
                `<option value="${name}" ${name === this.currentProjectName ? 'selected' : ''}>${name}</option>`
            ).join('');

        select.onchange = () => {
            const deleteBtn = controls.querySelector('.delete-btn');
            if (deleteBtn) deleteBtn.remove();

            if (select.value) {
                this.state.setRings(JSON.parse(JSON.stringify(projects[select.value])));
                this.currentProjectName = select.value;
                this.renderer.resize();
                this.renderer.render(this.state.state);
                this.updateUI();

                const btn = document.createElement('button');
                btn.className = 'delete-btn';
                btn.innerHTML = '<i class="fas fa-trash"></i>';
                btn.title = 'Eliminar proyecto';
                btn.onclick = () => this.deleteProject(select.value);
                controls.insertBefore(btn, select.nextSibling);
            }
        };
    }

    deleteProject(projectName) {
        if (confirm(`¿Seguro que quieres eliminar el proyecto "${projectName}"?`)) {
            const projects = this.getProjects();
            delete projects[projectName];
            localStorage.setItem('crochetProjects', JSON.stringify(projects));
            this.loadProjects();
            this.newProject();
            alert(`Proyecto "${projectName}" eliminado.`);
        }
    }

    updateUI() {
        document.getElementById('undoBtn').disabled = this.state.state.historyIndex === 0;
        document.getElementById('redoBtn').disabled = this.state.state.historyIndex === this.state.history.length - 1;
        this.updateExportPreview();
        this.updateRingCounter();
    }

    updateExportPreview() {
        const text = this.state.state.rings
            .map((ring, ringIndex) =>
                ring.points.map((type, segmentIndex) => {
                    let desc = STITCH_TYPES.get(type.replace(/(_increase|_decrease)/, '')).desc;
                    if (type.includes('_increase')) desc += ' (Aumento)';
                    else if (type.includes('_decrease')) desc += ' (Disminución)';
                    return `Anillo ${ringIndex + 1}, Segmento ${segmentIndex}: ${desc}`;
                }).join('\n')
            )
            .join('\n') || 'Patrón vacío';
        document.getElementById('exportText').value = text;
    }

    exportAsText() {
        this.updateExportPreview();
        const text = document.getElementById('exportText').value;
        const blob = new Blob([text], { type: 'text/plain' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${this.currentProjectName || 'patron_crochet'}.txt`;
        link.click();
    }

    exportAsImage() {
        this.renderer.exportAsImage(this.state.state, this.currentProjectName);
    }

    generatePDF() {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageWidth = doc.internal.pageSize.width;
        const pageHeight = doc.internal.pageSize.height;
        const margin = 15;
        const contentWidth = pageWidth - 2 * margin;

        this.addPDFTitle(doc, pageWidth, margin);
        const legendHeight = this.addPDFLegend(doc, margin);
        this.addPDFPattern(doc, pageWidth, pageHeight, margin, contentWidth, legendHeight);

        doc.save(`${this.currentProjectName || 'patron_crochet'}.pdf`);
    }

    addPDFTitle(doc, pageWidth, margin) {
        doc.setFontSize(18);
        doc.setTextColor('#2c3e50');
        doc.text(this.currentProjectName || 'Patrón de Crochet Radial', pageWidth / 2, margin + 10, { align: 'center' });
    }

    addPDFLegend(doc, margin) {
        doc.setFontSize(12);
        doc.setTextColor('#000000');
        let y = margin + 25;
        doc.text('Leyenda de puntadas:', margin, y);
        y += 10;

        for (const [, stitch] of STITCH_TYPES) {
            doc.setTextColor(stitch.color);
            doc.text(`${stitch.symbol} - ${stitch.desc}`, margin + 5, y);
            y += 8;
        }
        doc.setTextColor('#000000');
        doc.text('▿ - Aumento', margin + 5, y);
        y += 8;
        doc.text('▵ - Disminución', margin + 5, y);
        return y + 10;
    }

    addPDFPattern(doc, pageWidth, pageHeight, margin, contentWidth, legendHeight) {
        const maxRadius = this.state.state.rings.length * this.state.state.ringSpacing;
        const availableHeight = pageHeight - legendHeight - margin;
        const scale = Math.min(contentWidth / (maxRadius * 2), availableHeight / (maxRadius * 2));
        const centerX = pageWidth / 2;
        const centerY = legendHeight + (availableHeight / 2);

        doc.setDrawColor('#ddd');
        doc.setLineWidth(0.2);
        this.state.state.rings.forEach((ring, ringIndex) => {
            const radius = (ringIndex + 1) * this.state.state.ringSpacing * scale * 0.0353;
            doc.circle(centerX, centerY, radius);

            const segments = ring.segments;
            const angleStep = Math.PI * 2 / segments;
            const stitchRadius = (ringIndex + 0.5) * this.state.state.ringSpacing * scale * 0.0353;
            ring.points.forEach((type, segmentIndex) => {
                const angle = segmentIndex * angleStep + (angleStep / 2);
                const x = centerX + Math.cos(angle) * stitchRadius;
                const y = centerY + Math.sin(angle) * stitchRadius;
                let stitchType = type;
                let symbol = STITCH_TYPES.get(stitchType).symbol;

                if (type.includes('_increase')) {
                    stitchType = type.replace('_increase', '');
                    symbol = '▿';
                } else if (type.includes('_decrease')) {
                    stitchType = type.replace('_decrease', '');
                    symbol = '▵';
                }

                doc.setTextColor(STITCH_TYPES.get(stitchType).color);
                doc.setFontSize(12 * scale);
                doc.text(symbol, x, y, { align: 'center', baseline: 'middle' });
            });
        });

        doc.setDrawColor('#eee');
        const maxRadiusMM = maxRadius * scale * 0.0353;
        const angleStep = Math.PI * 2 / this.state.state.guideLines;
        for (let i = 0; i < this.state.state.guideLines; i++) {
            const angle = i * angleStep;
            const xEnd = centerX + Math.cos(angle) * maxRadiusMM;
            const yEnd = centerY + Math.sin(angle) * maxRadiusMM;
            doc.line(centerX, centerY, xEnd, yEnd);
        }
    }

    setupStitchPalette() {
        const palette = document.getElementById('stitchPalette');
        if (!palette) return console.error('El elemento #stitchPalette no se encontró');

        palette.innerHTML = '';
        let isFirst = true;
        for (const [key, stitch] of STITCH_TYPES) {
            const btn = document.createElement('button');
            btn.className = 'stitch-btn';
            btn.innerHTML = stitch.symbol;
            btn.style.color = stitch.color;
            btn.title = stitch.desc;
            btn.onclick = () => {
                this.state.state.selectedStitch = key;
                palette.querySelectorAll('.stitch-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.renderer.render(this.state.state);
            };
            if (isFirst) {
                btn.classList.add('active');
                isFirst = false;
            }
            palette.appendChild(btn);
        }
    }

    toggleStitchTooltip(e) {
        this.tooltip = this.tooltip || document.getElementById('stitchTooltip');
        if (this.tooltip.classList.contains('hidden')) {
            const content = Array.from(STITCH_TYPES)
                .map(([, stitch]) => `<span style="color: ${stitch.color}">${stitch.symbol}</span> - ${stitch.desc}`)
                .join('<br>') + '<br><span>▿</span> - Aumento<br><span>▵</span> - Disminución';
            this.tooltip.innerHTML = content;

            const rect = e.target.getBoundingClientRect();
            this.tooltip.style.left = `${rect.right + 5}px`;
            this.tooltip.style.top = `${rect.top - 5}px`;
            this.tooltip.classList.remove('hidden');
        } else {
            this.tooltip.classList.add('hidden');
        }
    }

    updateRingCounter() {
        const addRingBtn = document.getElementById('addRingBtn');
        let counter = addRingBtn.querySelector('.ring-counter');
        if (!counter) {
            counter = document.createElement('span');
            counter.className = 'ring-counter';
            addRingBtn.appendChild(counter);
        }
        counter.textContent = this.state.state.rings.length;
    }
}

// Clase principal
class CrochetEditor {
    constructor() {
        this.state = new PatternState();
        this.renderer = new CanvasRenderer(document.getElementById('patternCanvas'));
        this.inputHandler = new InputHandler(this.renderer.canvas, this.state, this.renderer);
        this.uiController = new UIController(this.state, this.renderer, this.inputHandler); // Pasamos inputHandler
        this.initialize();
    }

    initialize() {
        try {
            this.uiController.loadProjects();
            this.uiController.loadFromLocalStorage();
            this.renderer.render(this.state.state);
        } catch (error) {
            console.error('Error initializing editor:', error);
        }
    }
}

window.addEventListener('DOMContentLoaded', () => new CrochetEditor());